import path from "node:path";

export function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function positiveInteger(env, name, fallback) {
  const raw = env[name] ?? String(fallback);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function normalizeHttpUrl(value, name) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, query, or fragment`);
  }
  return value.replace(/\/+$/, "");
}

export function resourceUri(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid resource URI`);
  }
  if (parsed.protocol !== "viking:" || parsed.hostname !== "resources") {
    throw new Error(`${name} must be below viking://resources`);
  }
  const decoded = decodeURIComponent(value);
  if (/[\x00-\x1f\x7f\\?#%]/.test(decoded) || decoded.split("/").some((part) => part === "." || part === "..")) {
    throw new Error(`${name} contains an unsafe path`);
  }
  return value.replace(/\/+$/, "");
}

export function relativeGitPath(value, name) {
  const normalized = value.replace(/^\.\//, "").replace(/\/+$/, "");
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.includes("\\")) {
    throw new Error(`${name} must be a relative Git path`);
  }
  if (normalized.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new Error(`${name} contains an unsafe path segment`);
  }
  return normalized;
}

export function safeGitRef(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@{}+-]*$/.test(value) || value.includes("..") || value.endsWith(".lock")) {
    throw new Error("OV_GIT_REF is not a safe Git ref");
  }
  return value;
}
