import assert from "node:assert/strict";
import test from "node:test";
import { OpenVikingClient } from "../src/ov/client.mjs";

test("OpenViking client maps read operations and keeps the credential in the upstream request", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ result: "content" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const client = new OpenVikingClient({
    baseUrl: "https://ov.example",
    apiKey: "server-secret",
    timeoutMs: 1000,
    maxResponseBytes: 4096,
    taskTimeoutMs: 2000,
    taskPollIntervalMs: 10,
  }, fetchImpl);

  assert.equal(await client.read("viking://resources/example/topic.md"), "content");
  assert.match(seen[0].url, /\/api\/v1\/content\/read\?uri=/);
  assert.equal(seen[0].init.headers.Authorization, "Bearer server-secret");
});
