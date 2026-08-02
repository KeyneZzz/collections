export function parseArgs(argv) {
  const args = {};
  const rest = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }

    const eqIndex = arg.indexOf("=");
    if (eqIndex !== -1) {
      args[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }

  return { args, rest };
}

export async function listTargets(endpoint, { fetchImpl = globalThis.fetch } = {}) {
  if (!endpoint) {
    throw new Error("CDP endpoint is required");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available");
  }

  const response = await fetchImpl(new URL("/json/list", endpoint));
  if (!response.ok) {
    throw new Error(`failed to list CDP targets: HTTP ${response.status}`);
  }

  const targets = await response.json();
  if (!Array.isArray(targets)) {
    throw new Error("CDP target list response was not an array");
  }
  return targets;
}

export function selectTarget(targets, { pattern } = {}) {
  const pages = targets.filter((target) => {
    return target?.type === "page" && typeof target.webSocketDebuggerUrl === "string";
  });

  if (pages.length === 0) {
    throw new Error("no page targets with WebSocket debugger URLs were found");
  }

  if (pattern) {
    const regex = new RegExp(pattern);
    const selected = pages.find((target) => regex.test(String(target.url ?? "")));
    if (!selected) {
      throw new Error(`no page target matched BROWSER_RUNTIME_PAGE_URL_PATTERN: ${pattern}`);
    }
    return selected;
  }

  return pages[pages.length - 1];
}

export async function selectPage({ endpoint, pattern, fetchImpl } = {}) {
  return selectTarget(await listTargets(endpoint, { fetchImpl }), { pattern });
}

export function compactTarget(target) {
  return {
    id: target.id,
    type: target.type,
    title: target.title ?? "",
    url: target.url ?? "",
    webSocketDebuggerUrl: target.webSocketDebuggerUrl,
  };
}

function addWsListener(ws, type, handler) {
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener(type, handler);
    return () => ws.removeEventListener?.(type, handler);
  }
  if (typeof ws.on === "function") {
    ws.on(type, handler);
    return () => ws.off?.(type, handler) ?? ws.removeListener?.(type, handler);
  }
  throw new Error("WebSocket implementation does not support event listeners");
}

function messageData(event) {
  // Node's global WebSocket dispatches MessageEvent whose `data` is an inherited
  // getter, not an own property. Use `in` (own or inherited) and guard against
  // primitives so `"data" in <primitive>` does not throw.
  if (event && typeof event === "object" && "data" in event) {
    return event.data;
  }
  return event;
}

async function normalizeMessageData(data) {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  if (data && typeof data.text === "function") {
    return data.text();
  }
  return String(data);
}

export class CdpSession {
  #nextId = 0;
  #pending = new Map();
  #eventHandlers = new Map();

  constructor(ws) {
    this.ws = ws;
    this.unsubscribeMessage = addWsListener(ws, "message", (event) => {
      void this.#handleMessage(messageData(event));
    });
    this.unsubscribeClose = addWsListener(ws, "close", () => {
      for (const { reject } of this.#pending.values()) {
        reject(new Error("CDP WebSocket closed"));
      }
      this.#pending.clear();
    });
  }

  on(method, handler) {
    const handlers = this.#eventHandlers.get(method) ?? new Set();
    handlers.add(handler);
    this.#eventHandlers.set(method, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.#eventHandlers.delete(method);
      }
    };
  }

  send(method, params = {}) {
    const id = ++this.#nextId;
    const payload = JSON.stringify({ id, method, params });
    const result = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });

    try {
      this.ws.send(payload);
    } catch (error) {
      this.#pending.delete(id);
      throw error;
    }
    return result;
  }

  close() {
    this.unsubscribeMessage?.();
    this.unsubscribeClose?.();
    this.ws.close?.();
  }

  async #handleMessage(rawData) {
    const data = await normalizeMessageData(rawData);
    const message = JSON.parse(data);

    if (message.id && this.#pending.has(message.id)) {
      const pending = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "CDP command failed"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      for (const handler of this.#eventHandlers.get(message.method) ?? []) {
        handler(message.params ?? {});
      }
    }
  }
}

export async function openCdpSession(webSocketDebuggerUrl, { WebSocketCtor = globalThis.WebSocket } = {}) {
  if (!webSocketDebuggerUrl) {
    throw new Error("webSocketDebuggerUrl is required");
  }
  if (typeof WebSocketCtor !== "function") {
    throw new Error("WebSocket is not available in this Node.js runtime");
  }

  const ws = new WebSocketCtor(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const cleanupOpen = addWsListener(ws, "open", () => {
      cleanupOpen?.();
      cleanupError?.();
      resolve();
    });
    const cleanupError = addWsListener(ws, "error", (error) => {
      cleanupOpen?.();
      cleanupError?.();
      reject(error instanceof Error ? error : new Error("CDP WebSocket connection failed"));
    });
  });
  return new CdpSession(ws);
}
