#!/usr/bin/env node

const [command, ...args] = process.argv.slice(2);
if (!command || command === "help" || command === "-h" || command === "--help") {
  usage();
  process.exit(command ? 0 : 2);
}

try {
  const baseUrl = normalizeBase(process.env.OV_GATEWAY_URL ?? "http://127.0.0.1:3000");
  const token = process.env.OV_GATEWAY_TOKEN?.trim();
  const request = buildRequest(command, args);
  const response = await fetch(new URL(request.path, baseUrl), {
    method: request.body ? "POST" : "GET",
    headers: {
      Accept: "application/json",
      ...(request.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(request.body ? { body: JSON.stringify(request.body) } : {}),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Gateway HTTP ${response.status}: ${payload?.error?.message ?? JSON.stringify(payload)}`);
  console.log(JSON.stringify(payload.result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

function buildRequest(name, values) {
  switch (name) {
    case "find":
    case "search": {
      const [query, target_uri, rawLimit] = values;
      requireValue(query, `${name} requires <query>`);
      const limit = rawLimit === undefined ? undefined : number(rawLimit, "limit");
      return {
        path: name === "find" ? "/v1/search/find" : "/v1/search/deep",
        body: compact({ query, target_uri, limit }),
      };
    }
    case "read":
    case "abstract":
    case "overview": {
      const [uri] = values;
      requireValue(uri, `${name} requires <uri>`);
      return { path: `/v1/content/${name}?uri=${encodeURIComponent(uri)}` };
    }
    case "list": {
      const [uri, recursive = "false"] = values;
      return { path: `/v1/resources?${uri ? `uri=${encodeURIComponent(uri)}&` : ""}recursive=${encodeURIComponent(recursive)}` };
    }
    case "grep": {
      const [uri, pattern] = values;
      requireValue(uri, "grep requires <uri> <pattern>");
      requireValue(pattern, "grep requires <uri> <pattern>");
      return { path: "/v1/search/grep", body: { uri, pattern } };
    }
    case "glob": {
      const [pattern, uri] = values;
      requireValue(pattern, "glob requires <pattern> [uri]");
      return { path: "/v1/search/glob", body: compact({ pattern, uri }) };
    }
    default:
      throw new Error(`Unknown command: ${name}`);
  }
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function requireValue(value, message) {
  if (!value) throw new Error(message);
}

function number(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function normalizeBase(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("OV_GATEWAY_URL must use http or https");
  return value.replace(/\/+$/, "");
}

function usage() {
  console.log(`Usage:
  ov-consume find <query> [root] [limit]
  ov-consume search <query> [root] [limit]
  ov-consume read <uri>
  ov-consume abstract <uri>
  ov-consume overview <uri>
  ov-consume list [uri] [true|false]
  ov-consume grep <uri> <pattern>
  ov-consume glob <pattern> [uri]`);
}
