import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { openCdpSession, parseArgs, selectPage } from "./cdp.mjs";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
]);

export function traceOptionsFromEnv(env = process.env) {
  return {
    includeQuery: env.BROWSER_TRACE_INCLUDE_QUERY === "true",
    captureHeaders: env.BROWSER_TRACE_CAPTURE_HEADERS === "true",
    captureBodies: env.BROWSER_TRACE_CAPTURE_BODIES === "true",
  };
}

export function stripUrlQuery(rawUrl, { includeQuery = false } = {}) {
  if (includeQuery) {
    return rawUrl;
  }

  try {
    const url = new URL(rawUrl);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return String(rawUrl).split("?")[0].split("#")[0];
  }
}

export function isSensitiveHeader(name) {
  const normalized = String(name).toLowerCase();
  return (
    SENSITIVE_HEADER_NAMES.has(normalized) ||
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("api-key")
  );
}

export function sanitizeHeaders(headers = {}, { captureHeaders = false } = {}) {
  if (!captureHeaders) {
    return undefined;
  }

  const sanitized = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    sanitized[name] = isSensitiveHeader(name) ? "[redacted]" : String(value);
  }
  return sanitized;
}

export function sanitizeRequestWillBeSent(params, options = {}) {
  const request = params.request ?? {};
  const output = {
    type: "request",
    requestId: params.requestId,
    method: request.method,
    url: stripUrlQuery(request.url ?? "", options),
    timestamp: params.wallTime ?? params.timestamp,
  };

  const headers = sanitizeHeaders(request.headers, options);
  if (headers) {
    output.headers = headers;
  }
  if (options.captureBodies && request.postData) {
    output.body = request.postData;
  }
  return output;
}

export function sanitizeResponseReceived(params, options = {}) {
  const response = params.response ?? {};
  const output = {
    type: "response",
    requestId: params.requestId,
    status: response.status,
    mimeType: response.mimeType,
    url: stripUrlQuery(response.url ?? "", options),
    timestamp: params.timestamp,
  };

  const headers = sanitizeHeaders(response.headers, options);
  if (headers) {
    output.headers = headers;
  }
  return output;
}

export function sanitizeConsoleEvent(params) {
  return {
    type: "console",
    level: params.type,
    timestamp: params.timestamp,
    args: (params.args ?? []).map((arg) => {
      if (Object.hasOwn(arg, "value")) {
        return arg.value;
      }
      return arg.description ?? arg.type ?? "";
    }),
  };
}

async function appendJsonLine(file, record) {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`);
}

export async function collectTrace({
  endpoint,
  pattern,
  out,
  fetchImpl,
  WebSocketCtor,
  options = traceOptionsFromEnv(),
} = {}) {
  if (!out) {
    throw new Error("--out is required");
  }

  const page = await selectPage({ endpoint, pattern, fetchImpl });
  const session = await openCdpSession(page.webSocketDebuggerUrl, { WebSocketCtor });

  session.on("Network.requestWillBeSent", (params) => {
    void appendJsonLine(out, sanitizeRequestWillBeSent(params, options));
  });
  session.on("Network.responseReceived", (params) => {
    void appendJsonLine(out, sanitizeResponseReceived(params, options));
  });
  session.on("Runtime.consoleAPICalled", (params) => {
    void appendJsonLine(out, sanitizeConsoleEvent(params));
  });

  await session.send("Network.enable");
  await session.send("Runtime.enable");
  await appendJsonLine(out, {
    type: "trace-started",
    page: {
      id: page.id,
      title: page.title ?? "",
      url: stripUrlQuery(page.url ?? "", options),
    },
    timestamp: new Date().toISOString(),
  });

  await new Promise((resolve) => {
    const shutdown = () => {
      session.close();
      resolve();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  });
}

async function main() {
  const { args, rest } = parseArgs(process.argv.slice(2));
  const command = rest[0];
  if (command !== "collect") {
    throw new Error("usage: cdp-trace.mjs collect --endpoint <url> --out <file>");
  }

  await collectTrace({
    endpoint: args.endpoint ?? process.env.BROWSER_RUNTIME_CDP_ENDPOINT,
    pattern: args.pattern ?? process.env.BROWSER_RUNTIME_PAGE_URL_PATTERN,
    out: args.out,
    options: traceOptionsFromEnv(),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
