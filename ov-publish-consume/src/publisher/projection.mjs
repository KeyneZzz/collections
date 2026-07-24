import { createHash } from "node:crypto";

const DIRECTORY_LIMIT = 10_000;

export async function verifyProjection(client, snapshot, config) {
  const inventory = await inventoryTree(client, config.targetUri, config.generatedNames);
  const sources = snapshot.files.map((file) => ({
    sourceUri: file.sourceUri,
    anchorUri: file.sourceUri.slice(0, -3),
  })).sort((a, b) => a.anchorUri.localeCompare(b.anchorUri));

  const mapped = new Map(sources.map((item) => [item.anchorUri, []]));
  const unmanaged = [];
  for (const uri of inventory.files) {
    const source = [...sources].sort((a, b) => b.anchorUri.length - a.anchorUri.length)
      .find((candidate) => uri.startsWith(`${candidate.anchorUri}/`));
    if (source) mapped.get(source.anchorUri).push(uri);
    else unmanaged.push(uri);
  }
  const missing = sources.filter((source) => !inventory.directories.has(source.anchorUri) || mapped.get(source.anchorUri).length === 0);
  if (missing.length || unmanaged.length) {
    throw new Error(`Projection mismatch: missing=${missing.map((item) => item.sourceUri).join(",") || "none"}; unmanaged=${unmanaged.join(",") || "none"}`);
  }

  const hashes = new Map();
  for (const uri of inventory.files) {
    const content = await client.read(uri);
    if (typeof content !== "string" || !content.trim()) throw new Error(`Projected Markdown is empty: ${uri}`);
    hashes.set(uri, createHash("sha256").update(content).digest("hex"));
  }
  return sources.map((source) => {
    const l2Uris = mapped.get(source.anchorUri).sort();
    return {
      ...source,
      l2Uris,
      l2Sha256: Object.fromEntries(l2Uris.map((uri) => [uri, hashes.get(uri)])),
    };
  });
}

async function inventoryTree(client, root, generatedNames) {
  const directories = new Set([root]);
  const files = new Set();
  const queue = [root];
  while (queue.length) {
    const parent = queue.shift();
    const entries = parseEntries(await client.list(parent, { showAllHidden: true, nodeLimit: DIRECTORY_LIMIT }));
    if (entries.length >= DIRECTORY_LIMIT) throw new Error(`Directory listing reached its safe limit: ${parent}`);
    for (const entry of entries) {
      assertChild(root, parent, entry.uri);
      const name = entry.uri.slice(entry.uri.lastIndexOf("/") + 1);
      if (entry.isDir) {
        if (name.startsWith(".")) throw new Error(`Unmanaged directory in projection: ${entry.uri}`);
        if (!directories.has(entry.uri)) {
          directories.add(entry.uri);
          queue.push(entry.uri);
        }
      } else if (!generatedNames.has(name)) {
        if (!entry.uri.endsWith(".md") || name.startsWith(".")) throw new Error(`Unmanaged file in projection: ${entry.uri}`);
        files.add(entry.uri);
      }
    }
  }
  return { directories, files: [...files].sort() };
}

export function parseEntries(value) {
  if (!Array.isArray(value)) throw new Error("Directory listing is not an array");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.uri !== "string") throw new Error("Directory listing contains an invalid entry");
    const isDir = typeof entry.isDir === "boolean" ? entry.isDir : entry.is_dir;
    if (typeof isDir !== "boolean") throw new Error("Directory entry is missing its directory flag");
    return { uri: entry.uri, isDir };
  });
}

function assertChild(root, parent, uri) {
  if (uri !== root && !uri.startsWith(`${root}/`)) throw new Error(`Projection URI is outside ${root}: ${uri}`);
  if (uri.slice(0, uri.lastIndexOf("/")) !== parent) throw new Error(`Directory returned a non-child URI: ${uri}`);
  const relative = uri.slice(root.length);
  if (/[\x00-\x1f\x7f\\?#%]/.test(relative) || relative.split("/").some((part) => part === "." || part === "..")) {
    throw new Error(`Projection contains an unsafe URI: ${uri}`);
  }
}
