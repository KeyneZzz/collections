import { promises as fs } from "node:fs";
import path from "node:path";

export async function withFileLock(lockFile, operation) {
  await fs.mkdir(path.dirname(lockFile), { recursive: true, mode: 0o700 });
  const handle = await acquire(lockFile);
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, { encoding: "utf8" });
    return await operation();
  } finally {
    await handle.close();
    await fs.rm(lockFile, { force: true });
  }
}

async function acquire(lockFile) {
  try {
    return await fs.open(lockFile, "wx", 0o600);
  } catch (error) {
    if (!isCode(error, "EEXIST")) throw error;
    const owner = await readOwner(lockFile);
    if (owner && processIsAlive(owner.pid)) throw new Error(`Publisher lock is held by pid ${owner.pid}`);
    try {
      await fs.rm(lockFile);
    } catch (removeError) {
      if (!isCode(removeError, "ENOENT")) throw removeError;
    }
    try {
      return await fs.open(lockFile, "wx", 0o600);
    } catch (retryError) {
      if (isCode(retryError, "EEXIST")) throw new Error("Publisher lock was acquired concurrently");
      throw retryError;
    }
  }
}

async function readOwner(lockFile) {
  try {
    const value = JSON.parse(await fs.readFile(lockFile, "utf8"));
    return Number.isSafeInteger(value?.pid) && value.pid > 0 ? value : null;
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isCode(error, "EPERM");
  }
}

function isCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}
