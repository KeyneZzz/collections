import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { evaluateExpression } from "../scripts/cdp-eval.mjs";
import { selectTarget } from "../scripts/cdp.mjs";
import {
  sanitizeHeaders,
  sanitizeRequestWillBeSent,
  sanitizeResponseReceived,
  stripUrlQuery,
} from "../scripts/cdp-trace.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeBin = path.join(root, "scripts", "browser-runtime");
const midsceneBin = path.join(root, "scripts", "browser-midscene");
const midsceneReadyBin = path.join(root, "scripts", "browser-midscene-ready");
const playwrightBin = path.join(root, "scripts", "browser-playwright");

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
const argv = process.argv.slice(2);
if (argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
  console.log("connect tap rightclick hover input clearinput keyboardpress scroll take_screenshot assert act");
  process.exit(0);
}
writeFileSync(process.env.RUNNER_OUT, JSON.stringify({
  argv,
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

  const blockedAct = run(midsceneBin, ["act", "--prompt", "guard-check"], {
    env: {
      BROWSER_RUNTIME_STATE_DIR: stateDir,
      BROWSER_MIDSCENE_PACKAGE: "@example/midscene@1.2.3",
      BROWSER_MIDSCENE_RUNNER: runner,
      RUNNER_OUT: out,
    },
  });
  assert.equal(blockedAct.status, 2);
  assert.match(blockedAct.stderr, /forbids Midscene act/);

  const blockedDeepLocate = run(midsceneBin, ["tap", "--deep-locate", "--locate", "button"], {
    env: {
      BROWSER_RUNTIME_STATE_DIR: stateDir,
      BROWSER_MIDSCENE_PACKAGE: "@example/midscene@1.2.3",
      BROWSER_MIDSCENE_RUNNER: runner,
      RUNNER_OUT: out,
    },
  });
  assert.equal(blockedDeepLocate.status, 2);
  assert.match(blockedDeepLocate.stderr, /forbids Midscene deep/);

  const help = run(midsceneBin, ["--help"], {
    env: {
      BROWSER_MIDSCENE_RUNNER: runner,
      RUNNER_OUT: out,
    },
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /take_screenshot/);
});

test("midscene readiness reports missing package explicitly", async (t) => {
  const dir = await tempDir("browser-midscene-ready");
  const fakeChrome = path.join(dir, "chromium");
  writeFileSync(
    fakeChrome,
    `#!/usr/bin/env bash
echo "Chromium fake"
`
  );
  chmodSync(fakeChrome, 0o755);
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = run(midsceneReadyBin, [], {
    env: {
      BROWSER_RUNTIME_CHROME: fakeChrome,
      BROWSER_MIDSCENE_PACKAGE: "",
      BROWSER_MIDSCENE_RUNNER: "",
      MIDSCENE_MODEL_API_KEY: "test-key",
      MIDSCENE_MODEL_NAME: "test-model",
      MIDSCENE_MODEL_BASE_URL: "https://example.test",
      MIDSCENE_MODEL_FAMILY: "test-family",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Midscene package/);
  assert.match(result.stdout, /BROWSER_MIDSCENE_PACKAGE is not set/);
  assert.doesNotMatch(result.stdout, /browser-midscene --help failed/);
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
  assert.deepEqual(captured.argv, ["snapshot", "--session", "shared-browser"]);
  assert.equal(captured.env.BROWSER_PLAYWRIGHT_CDP_ENDPOINT, endpoint);
  assert.equal(captured.env.PLAYWRIGHT_CDP_ENDPOINT, endpoint);
  assert.equal(captured.env.BROWSER_PLAYWRIGHT_SESSION_NAME, "shared-browser");

  const attachRun = run(playwrightBin, ["attach"], {
    env: {
      BROWSER_RUNTIME_STATE_DIR: stateDir,
      BROWSER_PLAYWRIGHT_RUNNER: runner,
      RUNNER_OUT: out,
    },
  });
  assert.equal(attachRun.status, 0, attachRun.stderr);
  const attachCaptured = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(attachCaptured.argv, [
    "attach",
    "--cdp",
    endpoint,
    "--session",
    "shared-browser",
  ]);

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
    env: {
      BROWSER_RUNTIME_STATE_DIR: stateDir,
      BROWSER_PLAYWRIGHT_COMMAND: "no-such-playwright-cli",
    },
  });
  assert.equal(detached.status, 0);
  assert.equal(existsSync(path.join(stateDir, "playwright-session.json")), false);
});

test("playwright adapter auto-attaches when the CLI session is not open", async (t) => {
  const dir = await tempDir("browser-playwright-autoattach");
  const stateDir = path.join(dir, "state");
  const { endpoint } = createLiveRuntime(t, stateDir);
  const fakeCli = path.join(dir, "fake-playwright-cli");
  const calls = path.join(dir, "calls.log");
  writeFileSync(
    fakeCli,
    `#!/usr/bin/env bash
echo "$*" >> ${JSON.stringify(calls)}
if [[ "$1" == "snapshot" ]] && [[ "$(wc -l < ${JSON.stringify(calls)})" == "1" ]]; then
  echo "The browser 'shared-browser' is not open, please run open first"
  exit 1
fi
if [[ "$1" == "attach" ]]; then
  echo "attached"
  exit 0
fi
echo "SNAPSHOT-OK"
`
  );
  chmodSync(fakeCli, 0o755);
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = run(playwrightBin, ["snapshot"], {
    env: {
      BROWSER_RUNTIME_STATE_DIR: stateDir,
      BROWSER_PLAYWRIGHT_COMMAND: fakeCli,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "SNAPSHOT-OK");
  const logged = readFileSync(calls, "utf8").trim().split("\n");
  assert.equal(logged.length, 3);
  assert.equal(logged[0], "snapshot --session shared-browser");
  assert.equal(logged[1], `attach --cdp ${endpoint} --session shared-browser`);
  assert.equal(logged[2], "snapshot --session shared-browser");
});

test("lock is not leaked to a daemonizing playwright runner", async (t) => {
  const dir = await tempDir("browser-playwright-lock");
  const stateDir = path.join(dir, "state");
  createLiveRuntime(t, stateDir);
  const runner = path.join(dir, "daemon-runner");
  const pidOut = path.join(dir, "daemon.pid");
  writeFileSync(
    runner,
    `#!/usr/bin/env bash
# Mimics a CLI that forks a resident daemon inheriting open fds, then exits.
# The daemon's stdio is dropped so it does not hold the test's pipes; fd 207
# would still be inherited by a leaking wrapper.
bash -c 'exec sleep 30' >/dev/null 2>&1 &
echo $! > ${JSON.stringify(pidOut)}
exit 0
`
  );
  chmodSync(runner, 0o755);
  t.after(() => {
    try {
      process.kill(Number(readFileSync(pidOut, "utf8").trim()), "SIGKILL");
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  });

  const hasFlock = run("bash", ["-lc", "command -v flock >/dev/null"]).status === 0;
  if (!hasFlock) {
    t.skip("flock is unavailable");
    return;
  }

  const result = run(playwrightBin, ["snapshot"], {
    env: {
      BROWSER_RUNTIME_STATE_DIR: stateDir,
      BROWSER_PLAYWRIGHT_RUNNER: runner,
    },
  });
  assert.equal(result.status, 0, result.stderr);

  const daemonPid = readFileSync(pidOut, "utf8").trim();
  assert.match(daemonPid, /^\d+$/);
  await delay(200);
  assert.equal(existsSync(`/proc/${daemonPid}/fd/207`), false, "daemon must not hold the lock fd");

  const followUp = run(runtimeBin, ["status"], {
    env: { BROWSER_RUNTIME_STATE_DIR: stateDir },
  });
  assert.equal(followUp.status, 0, followUp.stderr);
  assert.doesNotMatch(followUp.stderr, /busy/);
});

test("playwright adapter fails fast when the CLI is missing", async (t) => {
  const dir = await tempDir("browser-playwright-missing");
  const stateDir = path.join(dir, "state");
  createLiveRuntime(t, stateDir);
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = run(playwrightBin, ["snapshot"], {
    env: {
      BROWSER_RUNTIME_STATE_DIR: stateDir,
      BROWSER_PLAYWRIGHT_COMMAND: "definitely-missing-playwright-cli",
    },
  });
  assert.equal(result.status, 127);
  assert.match(result.stderr, /definitely-missing-playwright-cli/);
  assert.match(result.stderr, /@playwright\/cli/);
  assert.equal(existsSync(path.join(stateDir, "playwright-session.json")), false);
});
