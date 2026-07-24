import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { evaluateExpression } from "../src/cdp-eval.mjs";
import { selectTarget } from "../src/cdp.mjs";
import {
  sanitizeHeaders,
  sanitizeRequestWillBeSent,
  sanitizeResponseReceived,
  stripUrlQuery,
} from "../src/cdp-trace.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeBin = path.join(root, "bin", "browser-runtime");
const midsceneBin = path.join(root, "bin", "browser-midscene");
const playwrightBin = path.join(root, "bin", "browser-playwright");

async function tempDir(prefix) {
  return mkdtemp(path.join(tmpdir(), `${prefix}-`));
}

function run(command, args, { env = {}, cwd = root } = {}) {
  return spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function createLiveRuntime(t, stateDir, endpoint = "http://127.0.0.1:9333") {
  mkdirSync(stateDir, { recursive: true });
  const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
    stdio: "ignore",
  });
  t.after(() => {
    sleeper.kill();
  });
  writeFileSync(path.join(stateDir, "browser.pid"), `${sleeper.pid}\n`);
  writeFileSync(path.join(stateDir, "endpoint"), `${endpoint}\n`);
  return { endpoint, pid: sleeper.pid };
}

function createRunner(t, dir) {
  const runner = path.join(dir, "runner.mjs");
  const out = path.join(dir, "runner-output.json");
  writeFileSync(
    runner,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(process.env.RUNNER_OUT, JSON.stringify({
  argv: process.argv.slice(2),
  env: {
    MIDSCENE_CDP_ENDPOINT: process.env.MIDSCENE_CDP_ENDPOINT,
    BROWSER_PLAYWRIGHT_CDP_ENDPOINT: process.env.BROWSER_PLAYWRIGHT_CDP_ENDPOINT,
    PLAYWRIGHT_CDP_ENDPOINT: process.env.PLAYWRIGHT_CDP_ENDPOINT,
    BROWSER_PLAYWRIGHT_SESSION_NAME: process.env.BROWSER_PLAYWRIGHT_SESSION_NAME
  }
}));
`
  );
  chmodSync(runner, 0o755);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { runner, out };
}

test("operation lock rejects concurrent runtime actions", async (t) => {
  const stateDir = await tempDir("browser-runtime-lock");
  mkdirSync(stateDir, { recursive: true });
  const lockFile = path.join(stateDir, "operation.lock");
  writeFileSync(lockFile, "");

  const hasFlock = run("bash", ["-lc", "command -v flock >/dev/null"]).status === 0;
  if (!hasFlock) {
    t.skip("flock is unavailable");
    return;
  }

  const holder = spawn("flock", [lockFile, "sleep", "3"], { stdio: "ignore" });
  t.after(() => holder.kill());
  await delay(200);

  const result = run(runtimeBin, ["endpoint"], {
    env: { BROWSER_RUNTIME_STATE_DIR: stateDir },
  });
  assert.equal(result.status, 75);
  assert.match(result.stderr, /busy/);
});

test("page selection uses a configurable URL pattern", () => {
  const targets = [
    { type: "page", url: "https://example.test/first", webSocketDebuggerUrl: "ws://first" },
    { type: "iframe", url: "https://example.test/frame", webSocketDebuggerUrl: "ws://frame" },
    { type: "page", url: "https://docs.test/guide", webSocketDebuggerUrl: "ws://docs" },
  ];

  assert.equal(selectTarget(targets, { pattern: "docs\\.test" }).webSocketDebuggerUrl, "ws://docs");
  assert.equal(selectTarget(targets).webSocketDebuggerUrl, "ws://docs");
});

test("CDP eval sends Runtime.evaluate with controlled defaults", async () => {
  class FakeWebSocket {
    static instances = [];

    constructor(url) {
      this.url = url;
      this.sent = [];
      this.listeners = new Map();
      FakeWebSocket.instances.push(this);
      queueMicrotask(() => this.emit("open", {}));
    }

    addEventListener(type, handler) {
      const handlers = this.listeners.get(type) ?? new Set();
      handlers.add(handler);
      this.listeners.set(type, handlers);
    }

    removeEventListener(type, handler) {
      this.listeners.get(type)?.delete(handler);
    }

    emit(type, event) {
      for (const handler of this.listeners.get(type) ?? []) {
        handler(event);
      }
    }

    send(data) {
      this.sent.push(JSON.parse(data));
      const id = this.sent.at(-1).id;
      queueMicrotask(() => {
        this.emit("message", {
          data: JSON.stringify({ id, result: { result: { type: "string", value: "ok" } } }),
        });
      });
    }

    close() {}
  }

  const result = await evaluateExpression({
    expression: "document.title",
    webSocketDebuggerUrl: "ws://cdp/page",
    WebSocketCtor: FakeWebSocket,
  });

  assert.deepEqual(result, { type: "string", value: "ok" });
  assert.equal(FakeWebSocket.instances[0].url, "ws://cdp/page");
  assert.deepEqual(FakeWebSocket.instances[0].sent[0], {
    id: 1,
    method: "Runtime.evaluate",
    params: {
      expression: "document.title",
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
      throwOnSideEffect: true,
    },
  });
});

test("trace sanitization omits query, headers, and bodies by default", () => {
  const request = sanitizeRequestWillBeSent(
    {
      requestId: "1",
      request: {
        method: "POST",
        url: "https://example.test/path?token=secret#frag",
        headers: { Authorization: "Bearer abc", Accept: "application/json" },
        postData: "secret body",
      },
    },
    {}
  );

  assert.equal(request.url, "https://example.test/path");
  assert.equal(request.headers, undefined);
  assert.equal(request.body, undefined);
  assert.equal(stripUrlQuery("not-a-url?secret=1#frag"), "not-a-url");
});

test("trace header capture redacts sensitive headers", () => {
  assert.deepEqual(
    sanitizeHeaders(
      {
        Authorization: "Bearer abc",
        Cookie: "a=b",
        "X-Api-Key": "key",
        "X-Trace": "visible",
      },
      { captureHeaders: true }
    ),
    {
      Authorization: "[redacted]",
      Cookie: "[redacted]",
      "X-Api-Key": "[redacted]",
      "X-Trace": "visible",
    }
  );

  const response = sanitizeResponseReceived(
    {
      requestId: "2",
      response: {
        status: 200,
        mimeType: "application/json",
        url: "https://example.test/data?debug=true",
        headers: { "Set-Cookie": "sid=1", Etag: "abc" },
      },
    },
    { captureHeaders: true }
  );
  assert.equal(response.headers["Set-Cookie"], "[redacted]");
  assert.equal(response.headers.Etag, "abc");
});

test("midscene adapter injects shared endpoint and blocks overrides", async (t) => {
  const dir = await tempDir("browser-midscene");
  const stateDir = path.join(dir, "state");
  const { endpoint } = createLiveRuntime(t, stateDir);
  const { runner, out } = createRunner(t, dir);

  const result = run(midsceneBin, ["tap", "--locate", "button"], {
    env: {
      BROWSER_RUNTIME_STATE_DIR: stateDir,
      BROWSER_MIDSCENE_PACKAGE: "@example/midscene@1.2.3",
      BROWSER_MIDSCENE_RUNNER: runner,
      RUNNER_OUT: out,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const captured = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(captured.argv, ["tap", "--locate", "button", "--cdp"]);
  assert.equal(captured.env.MIDSCENE_CDP_ENDPOINT, endpoint);

  const blocked = run(midsceneBin, ["tap", "--cdp"], {
    env: {
      BROWSER_RUNTIME_STATE_DIR: stateDir,
      BROWSER_MIDSCENE_PACKAGE: "@example/midscene@1.2.3",
      BROWSER_MIDSCENE_RUNNER: runner,
      RUNNER_OUT: out,
    },
  });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /owns CDP/);
});

test("playwright adapter attaches to shared endpoint and supports detach", async (t) => {
  const dir = await tempDir("browser-playwright");
  const stateDir = path.join(dir, "state");
  const { endpoint } = createLiveRuntime(t, stateDir);
  const { runner, out } = createRunner(t, dir);

  const result = run(playwrightBin, ["snapshot"], {
    env: {
      BROWSER_RUNTIME_STATE_DIR: stateDir,
      BROWSER_PLAYWRIGHT_RUNNER: runner,
      RUNNER_OUT: out,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const captured = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(captured.argv, [
    "snapshot",
    "--cdp-endpoint",
    endpoint,
    "--session",
    "shared-browser",
  ]);
  assert.equal(captured.env.BROWSER_PLAYWRIGHT_CDP_ENDPOINT, endpoint);
  assert.equal(captured.env.PLAYWRIGHT_CDP_ENDPOINT, endpoint);
  assert.equal(captured.env.BROWSER_PLAYWRIGHT_SESSION_NAME, "shared-browser");

  const status = run(playwrightBin, ["status"], {
    env: { BROWSER_RUNTIME_STATE_DIR: stateDir },
  });
  assert.equal(JSON.parse(status.stdout).attached, true);

  const blocked = run(playwrightBin, ["snapshot", "--cdp-endpoint", "ws://elsewhere"], {
    env: {
      BROWSER_RUNTIME_STATE_DIR: stateDir,
      BROWSER_PLAYWRIGHT_RUNNER: runner,
      RUNNER_OUT: out,
    },
  });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /owns session and CDP/);

  const detached = run(playwrightBin, ["detach"], {
    env: { BROWSER_RUNTIME_STATE_DIR: stateDir },
  });
  assert.equal(detached.status, 0);
  assert.equal(existsSync(path.join(stateDir, "playwright-session.json")), false);
});
