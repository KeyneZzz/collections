import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { publishOnce } from "../src/publisher/publish.mjs";

test("publisher uploads, verifies projection, records state, and then skips an identical revision", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "ov-publish-state-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const root = "viking://resources/example";
  const snapshot = {
    revision: "a".repeat(40),
    archive: Buffer.from("zip"),
    files: [{ relativePath: "topic.md", sourceUri: `${root}/topic.md`, sha256: "b".repeat(64) }],
  };
  const calls = [];
  const client = {
    async addSnapshot(input) { calls.push(["add", input.targetUri]); return { rootUri: root, taskId: "task-1" }; },
    async waitForTask(taskId) { calls.push(["wait", taskId]); return { taskId, status: "completed", result: { root_uri: root } }; },
    async list(uri) {
      calls.push(["list", uri]);
      if (uri === root) return [{ uri: `${root}/topic`, isDir: true }];
      return [{ uri: `${root}/topic/part.md`, isDir: false }];
    },
    async read(uri) { calls.push(["read", uri]); return "# Projected topic\n"; },
  };
  const config = {
    stateDir,
    lockFile: path.join(stateDir, "publish.lock"),
    targetUri: root,
    sourceName: "example",
    generatedNames: new Set([".abstract.md"]),
  };
  const createSnapshot = async () => snapshot;
  const logger = { log() {} };

  const first = await publishOnce(config, client, { createSnapshot, logger });
  assert.equal(first.changed, true);
  assert.deepEqual(calls.slice(0, 2), [["add", root], ["wait", "task-1"]]);
  const state = JSON.parse(await readFile(path.join(stateDir, "last-published.json"), "utf8"));
  assert.equal(state.revision, snapshot.revision);
  assert.equal(state.projection[0].l2Uris[0], `${root}/topic/part.md`);

  calls.length = 0;
  const second = await publishOnce(config, client, { createSnapshot, logger });
  assert.equal(second.changed, false);
  assert.equal(calls.some(([name]) => name === "add"), false);
});
