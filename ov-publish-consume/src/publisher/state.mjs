import { promises as fs } from "node:fs";
import path from "node:path";

const STATE_FILE = "last-published.json";

export async function readPublishedState(stateDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(stateDir, STATE_FILE), "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writePublishedState(stateDir, value) {
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  const target = path.join(stateDir, STATE_FILE);
  const temporary = path.join(stateDir, `.${STATE_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export function projectionsEqual(left, right) {
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function normalize(projection = []) {
  return projection.map((source) => ({
    ...source,
    l2Uris: [...source.l2Uris].sort(),
    l2Sha256: Object.fromEntries(Object.entries(source.l2Sha256).sort(([a], [b]) => a.localeCompare(b))),
  })).sort((a, b) => a.anchorUri.localeCompare(b.anchorUri));
}
