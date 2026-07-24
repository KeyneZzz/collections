import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGitSnapshot } from "../src/publisher/snapshot.mjs";

test("Git snapshots are pinned, root-stripped ZIPs with hashed Markdown inventory", async (t) => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "ov-snapshot-"));
  t.after(() => rm(repo, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
  await mkdir(path.join(repo, "knowledge", "guide"), { recursive: true });
  await writeFile(path.join(repo, "knowledge", "guide", "intro.md"), "# Intro\n\nReference content.\n");
  await writeFile(path.join(repo, "outside.txt"), "not published\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "fixture"]);

  const snapshot = await createGitSnapshot({
    repoRoot: repo,
    gitRef: "HEAD",
    sourceDir: "knowledge",
    targetUri: "viking://resources/example",
    generatedNames: new Set([".abstract.md"]),
    maxArchiveBytes: 1024 * 1024,
  });

  assert.match(snapshot.revision, /^[0-9a-f]{40}$/);
  assert.equal(snapshot.files.length, 1);
  assert.deepEqual(snapshot.files[0].relativePath, "guide/intro.md");
  assert.equal(snapshot.files[0].sourceUri, "viking://resources/example/guide/intro.md");
  assert.match(snapshot.files[0].sha256, /^[0-9a-f]{64}$/);
  assert.ok(snapshot.archive.subarray(0, 2).equals(Buffer.from("PK")));
});

test("snapshot validation rejects non-Markdown content", async (t) => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "ov-snapshot-invalid-"));
  t.after(() => rm(repo, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
  await mkdir(path.join(repo, "knowledge"));
  await writeFile(path.join(repo, "knowledge", "data.json"), "{}\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "fixture"]);
  await assert.rejects(createGitSnapshot({
    repoRoot: repo,
    gitRef: "HEAD",
    sourceDir: "knowledge",
    targetUri: "viking://resources/example",
    generatedNames: new Set(),
    maxArchiveBytes: 1024 * 1024,
  }), /Only Markdown/);
});
