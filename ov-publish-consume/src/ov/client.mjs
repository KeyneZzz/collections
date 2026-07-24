import { requestOv } from "../common/http.mjs";

export class OpenVikingClient {
  constructor(config, fetchImpl = fetch, sleep = delay) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  find(input) {
    return this.#post("/api/v1/search/find", input);
  }

  search(input) {
    return this.#post("/api/v1/search/search", input);
  }

  read(uri) {
    return this.#get("/api/v1/content/read", { uri });
  }

  abstract(uri) {
    return this.#get("/api/v1/content/abstract", { uri });
  }

  overview(uri) {
    return this.#get("/api/v1/content/overview", { uri });
  }

  list(uri, options = {}) {
    return this.#get("/api/v1/fs/ls", {
      uri,
      recursive: String(options.recursive ?? false),
      output: options.output ?? "original",
      show_all_hidden: String(options.showAllHidden ?? false),
      node_limit: String(options.nodeLimit ?? 1000),
    });
  }

  grep(input) {
    return this.#post("/api/v1/search/grep", input);
  }

  glob(input) {
    return this.#post("/api/v1/search/glob", input);
  }

  async addSnapshot({ archive, sourceName, targetUri }) {
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(archive)], { type: "application/zip" }), `${sourceName}.zip`);
    const upload = await this.#request("/api/v1/resources/temp_upload", { method: "POST", body: form });
    const tempFileId = stringField(upload, "temp_file_id", "temporary upload");
    const result = await this.#post("/api/v1/resources", {
      temp_file_id: tempFileId,
      source_name: sourceName,
      to: targetUri,
      wait: false,
      strict: true,
      preserve_structure: true,
      directly_upload_media: false,
      watch_interval: 0,
    });
    return {
      rootUri: stringField(result, "root_uri", "resource submission"),
      taskId: stringField(result, "task_id", "resource submission"),
    };
  }

  async waitForTask(taskId, expectedRoot) {
    const deadline = Date.now() + this.config.taskTimeoutMs;
    while (true) {
      const raw = await this.#request(`/api/v1/tasks/${encodeURIComponent(taskId)}`, { method: "GET" });
      const task = parseTask(raw);
      if (task.taskId !== taskId) throw new Error(`Task response does not match ${taskId}`);
      if (task.status === "completed") {
        if (expectedRoot && task.result?.root_uri !== expectedRoot) {
          throw new Error(`Task completed for unexpected root ${String(task.result?.root_uri ?? "missing")}`);
        }
        return task;
      }
      if (task.status === "failed") throw new Error(`Task ${taskId} failed${task.error ? `: ${task.error}` : ""}`);
      if (Date.now() >= deadline) throw new Error(`Task ${taskId} timed out`);
      await this.sleep(Math.min(this.config.taskPollIntervalMs, Math.max(1, deadline - Date.now())));
    }
  }

  #get(path, query) {
    const url = new URL(`${this.config.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    return this.#request(url, { method: "GET" });
  }

  #post(path, value) {
    return this.#request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  }

  #request(pathOrUrl, init) {
    return requestOv(this.config, this.fetchImpl, pathOrUrl, init);
  }
}

function stringField(value, field, context) {
  const result = value && typeof value === "object" ? value[field] : undefined;
  if (typeof result !== "string" || !result) throw new Error(`${context} is missing ${field}`);
  return result;
}

function parseTask(value) {
  if (!value || typeof value !== "object") throw new Error("Task response is invalid");
  const status = value.status;
  if (!["pending", "running", "completed", "failed"].includes(status)) {
    throw new Error(`Task status is invalid: ${String(status)}`);
  }
  return {
    taskId: stringField(value, "task_id", "task response"),
    status,
    ...(typeof value.stage === "string" ? { stage: value.stage } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(value.result && typeof value.result === "object" ? { result: value.result } : {}),
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
