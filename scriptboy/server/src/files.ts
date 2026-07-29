import { createHash } from "crypto";
import { createReadStream } from "fs";
import { mkdir, stat } from "fs/promises";
import path from "path";

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function assertRegularFile(filePath: string): Promise<void> {
  const info = await stat(filePath);
  if (!info.isFile()) {
    throw new Error(`Not a regular file: ${filePath}`);
  }
}

export async function fileSize(filePath: string): Promise<number> {
  const info = await stat(filePath);
  return info.size;
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function resolvePath(inputPath: string): string {
  return path.resolve(inputPath);
}
