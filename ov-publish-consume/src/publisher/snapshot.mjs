import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const METADATA_LIMIT = 16 * 1024 * 1024;

export async function createGitSnapshot(config) {
  const revision = (await runGit(config.repoRoot, ["rev-parse", `${config.gitRef}^{commit}`], METADATA_LIMIT))
    .toString("utf8").trim();
  if (!/^[0-9a-f]{40,64}$/.test(revision)) throw new Error("Git returned an invalid revision");

  const tree = await runGit(config.repoRoot, ["ls-tree", "-r", "-z", revision, "--", config.sourceDir], METADATA_LIMIT);
  const entries = parseTree(tree, config.sourceDir);
  if (entries.length === 0) throw new Error(`No publishable files found under ${config.sourceDir}`);

  const files = [];
  for (const entry of entries) {
    validateMarkdownPath(entry.relativePath, config.generatedNames);
    const content = await runGit(config.repoRoot, ["cat-file", "blob", entry.objectId], config.maxArchiveBytes);
    new TextDecoder("utf-8", { fatal: true }).decode(content);
    files.push({
      relativePath: entry.relativePath,
      sourceUri: `${config.targetUri}/${entry.relativePath}`,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }

  const archive = await runGit(
    config.repoRoot,
    ["archive", "--format=zip", `${revision}:${config.sourceDir}`],
    config.maxArchiveBytes,
  );
  return { revision, archive, files: files.sort((a, b) => a.sourceUri.localeCompare(b.sourceUri)) };
}

function parseTree(buffer, sourceDir) {
  const prefix = `${sourceDir}/`;
  const entries = [];
  for (const record of buffer.toString("utf8").split("\0")) {
    if (!record) continue;
    const match = /^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/.exec(record);
    if (!match) throw new Error("Git returned an invalid tree entry");
    const [, mode, type, objectId, filePath] = match;
    if (type !== "blob" || (mode !== "100644" && mode !== "100755")) {
      throw new Error(`Unsupported Git entry: ${filePath}`);
    }
    if (!filePath.startsWith(prefix)) throw new Error(`Git returned an out-of-scope path: ${filePath}`);
    entries.push({ objectId, relativePath: filePath.slice(prefix.length) });
  }
  return entries;
}

export function validateMarkdownPath(relativePath, generatedNames = new Set()) {
  if (!relativePath || relativePath.includes("\\") || relativePath.split("/").some((part) => !part || part.startsWith(".") || part === "..")) {
    throw new Error(`Unsafe source path: ${relativePath}`);
  }
  if (!relativePath.endsWith(".md")) throw new Error(`Only Markdown files are publishable: ${relativePath}`);
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  if (generatedNames.has(name)) throw new Error(`Generated artifact is not publishable: ${relativePath}`);
}

function runGit(repoRoot, args, maximumBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repoRoot, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let oversized = false;
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maximumBytes) {
        oversized = true;
        child.kill();
      } else {
        stdout.push(chunk);
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderrBytes < METADATA_LIMIT) {
        stderr.push(chunk);
        stderrBytes += chunk.byteLength;
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (oversized) reject(new Error(`git ${args[0]} output exceeded the configured limit`));
      else if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`git ${args.join(" ")} failed (${code}): ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
  });
}
