import path from "path";

export function resolveDbPath(input = "./scriptboy.db"): string {
  return path.resolve(input);
}

export function resolveStoreDir(input = "./store"): string {
  return path.resolve(input);
}

export function defaultPublicUrl(host: string, port: number): string {
  const publicHost = host === "0.0.0.0" ? "localhost" : host;
  return `http://${publicHost}:${port}`;
}
