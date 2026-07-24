export class OvError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "OvError";
    this.status = options.status;
    this.code = options.code;
  }
}

export async function requestOv(config, fetchImpl, pathOrUrl, init = {}) {
  const url = pathOrUrl instanceof URL ? pathOrUrl : new URL(`${config.baseUrl}${pathOrUrl}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          ...init.headers,
        },
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new OvError("OpenViking request timed out", { code: "DEADLINE_EXCEEDED", cause: error });
      }
      throw new OvError("OpenViking is unavailable", { code: "UNAVAILABLE", cause: error });
    }

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > config.maxResponseBytes) {
      throw new OvError("OpenViking response exceeded the configured size limit", { code: "RESPONSE_TOO_LARGE" });
    }
    const bytes = await readLimited(response.body, config.maxResponseBytes);
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new OvError("OpenViking returned invalid JSON", { status: response.status, code: "INVALID_RESPONSE" });
    }
    if (!response.ok) {
      throw new OvError(apiMessage(payload, response.status), { status: response.status, code: "UPSTREAM_ERROR" });
    }
    if (!payload || typeof payload !== "object" || !("result" in payload)) {
      throw new OvError("OpenViking response is missing result", { status: response.status, code: "INVALID_RESPONSE" });
    }
    if (payload.status === "error" || payload.error) {
      throw new OvError(apiMessage(payload, response.status), { status: response.status, code: "UPSTREAM_ERROR" });
    }
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(body, maximumBytes) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new OvError("OpenViking response exceeded the configured size limit", { code: "RESPONSE_TOO_LARGE" });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function apiMessage(payload, status) {
  const error = payload && typeof payload === "object" ? payload.error : undefined;
  if (error && typeof error === "object" && typeof error.message === "string") {
    return typeof error.code === "string" ? `OpenViking [${error.code}]: ${error.message}` : `OpenViking: ${error.message}`;
  }
  return `OpenViking returned HTTP ${status}`;
}
