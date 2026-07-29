import { constants } from "fs";
import { access, copyFile } from "fs/promises";
import path from "path";
import { assertRegularFile, ensureDir, fileSize, resolvePath, sha256File } from "./files";

export const ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function validateAlias(alias: string): void {
  if (!ALIAS_PATTERN.test(alias)) {
    throw new Error(
      "Invalid alias. Use 1-128 characters: letters, numbers, dot, underscore, hyphen; first character must be alphanumeric."
    );
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export interface StoredScript {
  sha256: string;
  sizeBytes: number;
  filename: string;
  contentPath: string;
}

export async function storeScriptFile(filePath: string, storeDir: string): Promise<StoredScript> {
  const source = resolvePath(filePath);
  await assertRegularFile(source);
  await ensureDir(storeDir);

  const sha256 = await sha256File(source);
  const sizeBytes = await fileSize(source);
  const filename = path.basename(source);
  const contentPath = sha256;
  const target = path.join(storeDir, contentPath);

  if (!(await exists(target))) {
    await copyFile(source, target);
  }

  return { sha256, sizeBytes, filename, contentPath };
}

export function contentFilePath(storeDir: string, contentPath: string): string {
  if (contentPath.includes("/") || contentPath.includes("\\") || contentPath.includes("..")) {
    throw new Error(`Unsafe content path in database: ${contentPath}`);
  }
  return path.join(storeDir, contentPath);
}
