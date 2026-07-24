import http from "node:http";
import { timingSafeEqual } from "node:crypto";

export function createGateway(config, client) {
  return http.createServer(async (request, response) => {
    setHeaders(response);
    try {
      if (!authorized(request, config.clientToken)) return sendError(response, 401, "UNAUTHENTICATED", "A valid bearer token is required");
      const url = new URL(request.url ?? "/", "http://gateway.local");
      if (request.method === "GET" && url.pathname === "/health/live") return send(response, 200, { status: "ok" });
      if (request.method === "GET" && url.pathname === "/health/ready") {
        await client.list(config.defaultRoot, { recursive: false });
        return send(response, 200, { status: "ok" });
      }
      const result = await route(request, url, config, client);
      return send(response, 200, { result });
    } catch (error) {
      const status = Number.isSafeInteger(error?.status) ? error.status : 500;
      return sendError(response, status, error?.code ?? "INTERNAL", status === 500 ? "Internal gateway error" : error.message);
    }
  });
}

async function route(request, url, config, client) {
  if (request.method === "GET") {
    const uri = validateUri(url.searchParams.get("uri") ?? config.defaultRoot, config.allowedRoots);
    if (url.pathname === "/v1/content/read") return client.read(uri);
    if (url.pathname === "/v1/content/abstract") return client.abstract(uri);
    if (url.pathname === "/v1/content/overview") return client.overview(uri);
    if (url.pathname === "/v1/resources") {
      const recursive = booleanQuery(url.searchParams.get("recursive"));
      return client.list(uri, { recursive });
    }
  }
  if (request.method === "POST") {
    const body = await readJson(request, config.requestBodyBytes);
    if (url.pathname === "/v1/search/find" || url.pathname === "/v1/search/deep") {
      exactKeys(body, ["query", "target_uri", "limit"]);
      const query = text(body.query, "query");
      const target_uri = validateUri(body.target_uri ?? config.defaultRoot, config.allowedRoots);
      const limit = searchLimit(body.limit, config.maxResults);
      return url.pathname.endsWith("/find") ? client.find({ query, target_uri, limit }) : client.search({ query, target_uri, limit });
    }
    if (url.pathname === "/v1/search/grep") {
      exactKeys(body, ["uri", "pattern"]);
      return client.grep({ uri: validateUri(body.uri, config.allowedRoots), pattern: text(body.pattern, "pattern") });
    }
    if (url.pathname === "/v1/search/glob") {
      exactKeys(body, ["pattern", "uri"]);
      return client.glob({ pattern: text(body.pattern, "pattern"), uri: validateUri(body.uri ?? config.defaultRoot, config.allowedRoots) });
    }
  }
  throw gatewayError(404, "NOT_FOUND", "Route not found");
}

export function validateUri(value, allowedRoots) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) throw gatewayError(400, "INVALID_URI", "Invalid resource URI");
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { throw gatewayError(400, "INVALID_URI", "Invalid resource URI"); }
  if (/[\x00-\x1f\x7f\\?#%]/.test(decoded) || decoded.split("/").some((part) => part === "." || part === "..")) {
    throw gatewayError(400, "INVALID_URI", "Invalid resource URI");
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw gatewayError(400, "INVALID_URI", "Invalid resource URI"); }
  if (parsed.protocol !== "viking:" || parsed.hostname !== "resources") throw gatewayError(400, "INVALID_URI", "Invalid resource URI");
  if (!allowedRoots.some((root) => value === root || value.startsWith(`${root}/`))) {
    throw gatewayError(403, "PERMISSION_DENIED", "Resource URI is outside the allowed roots");
  }
  return value;
}

async function readJson(request, maximumBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > maximumBytes) throw gatewayError(413, "REQUEST_TOO_LARGE", "Request body is too large");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw gatewayError(400, "INVALID_ARGUMENT", "Request body must be a JSON object");
  }
}

function authorized(request, expected) {
  if (!expected) return true;
  const actual = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function exactKeys(value, allowed) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw gatewayError(400, "INVALID_ARGUMENT", `Unknown field: ${unknown}`);
}

function text(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) throw gatewayError(400, "INVALID_ARGUMENT", `${name} must be non-empty text`);
  return value.trim();
}

function searchLimit(value, maximum) {
  const result = value ?? 10;
  if (!Number.isSafeInteger(result) || result <= 0 || result > maximum) throw gatewayError(400, "INVALID_ARGUMENT", `limit must be between 1 and ${maximum}`);
  return result;
}

function booleanQuery(value) {
  if (value === null || value === "false") return false;
  if (value === "true") return true;
  throw gatewayError(400, "INVALID_ARGUMENT", "recursive must be true or false");
}

function gatewayError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function setHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function send(response, status, value) {
  response.statusCode = status;
  response.end(`${JSON.stringify(value)}\n`);
}

function sendError(response, status, code, message) {
  send(response, status, { error: { code, message } });
}
