import { normalizeHttpUrl, positiveInteger, required, resourceUri } from "../common/env.mjs";

export function loadGatewayConfig(env = process.env) {
  const allowedRoots = required(env, "OV_ALLOWED_ROOTS").split(",").map((value, index) => resourceUri(value.trim(), `OV_ALLOWED_ROOTS[${index}]`));
  return {
    host: env.GATEWAY_HOST?.trim() || "127.0.0.1",
    port: port(env.GATEWAY_PORT ?? "3000"),
    clientToken: env.GATEWAY_BEARER_TOKEN?.trim() || null,
    allowedRoots,
    defaultRoot: allowedRoots[0],
    maxResults: positiveInteger(env, "OV_MAX_RESULTS", 100),
    requestBodyBytes: positiveInteger(env, "GATEWAY_MAX_REQUEST_BYTES", 16 * 1024),
    baseUrl: normalizeHttpUrl(required(env, "OV_BASE_URL"), "OV_BASE_URL"),
    apiKey: required(env, "OV_API_KEY"),
    timeoutMs: positiveInteger(env, "OV_TIMEOUT_MS", 60_000),
    maxResponseBytes: positiveInteger(env, "OV_MAX_RESPONSE_BYTES", 2 * 1024 * 1024),
    taskTimeoutMs: positiveInteger(env, "OV_TASK_TIMEOUT_MS", 15 * 60_000),
    taskPollIntervalMs: positiveInteger(env, "OV_TASK_POLL_INTERVAL_MS", 2_000),
  };
}

function port(raw) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 65535) throw new Error("GATEWAY_PORT must be between 0 and 65535");
  return value;
}
