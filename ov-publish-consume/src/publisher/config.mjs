import path from "node:path";
import { normalizeHttpUrl, positiveInteger, relativeGitPath, required, resourceUri, safeGitRef } from "../common/env.mjs";

export function loadPublisherConfig(env = process.env) {
  const stateDir = path.resolve(env.OV_STATE_DIR ?? path.join(process.cwd(), ".ov-state"));
  const taskTimeoutMs = positiveInteger(env, "OV_TASK_TIMEOUT_MS", 15 * 60_000);
  const taskPollIntervalMs = positiveInteger(env, "OV_TASK_POLL_INTERVAL_MS", 2_000);
  if (taskPollIntervalMs >= taskTimeoutMs) {
    throw new Error("OV_TASK_POLL_INTERVAL_MS must be less than OV_TASK_TIMEOUT_MS");
  }
  return {
    baseUrl: normalizeHttpUrl(required(env, "OV_BASE_URL"), "OV_BASE_URL"),
    apiKey: required(env, "OV_API_KEY"),
    targetUri: resourceUri(required(env, "OV_RESOURCE_ROOT"), "OV_RESOURCE_ROOT"),
    sourceName: required(env, "OV_SOURCE_NAME"),
    repoRoot: path.resolve(env.OV_REPO_ROOT ?? process.cwd()),
    sourceDir: relativeGitPath(env.OV_SOURCE_DIR ?? "knowledge", "OV_SOURCE_DIR"),
    gitRef: safeGitRef(env.OV_GIT_REF ?? "HEAD"),
    stateDir,
    lockFile: path.resolve(env.OV_LOCK_FILE ?? path.join(stateDir, "publish.lock")),
    timeoutMs: positiveInteger(env, "OV_TIMEOUT_MS", 60_000),
    maxResponseBytes: positiveInteger(env, "OV_MAX_RESPONSE_BYTES", 2 * 1024 * 1024),
    maxArchiveBytes: positiveInteger(env, "OV_MAX_ARCHIVE_BYTES", 64 * 1024 * 1024),
    taskTimeoutMs,
    taskPollIntervalMs,
    generatedNames: new Set((env.OV_GENERATED_NAMES ?? ".abstract.md,.overview.md,.relations.json").split(",").map((item) => item.trim()).filter(Boolean)),
  };
}
