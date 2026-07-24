import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createGateway } from "../src/gateway/server.mjs";

test("gateway authenticates clients and confines reads to configured roots", async (t) => {
  const root = "viking://resources/example";
  const calls = [];
  const client = {
    async find(input) { calls.push(input); return [{ uri: `${root}/topic.md` }]; },
    async list() { return []; },
  };
  const server = createGateway({
    clientToken: "client-secret",
    allowedRoots: [root],
    defaultRoot: root,
    maxResults: 20,
    requestBodyBytes: 4096,
  }, client);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const unauthenticated = await fetch(`${base}/v1/search/find`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "topic" }),
  });
  assert.equal(unauthenticated.status, 401);

  const allowed = await fetch(`${base}/v1/search/find`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer client-secret" },
    body: JSON.stringify({ query: "topic", limit: 5 }),
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual((await allowed.json()).result, [{ uri: `${root}/topic.md` }]);
  assert.equal(calls[0].target_uri, root);

  const denied = await fetch(`${base}/v1/search/find`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer client-secret" },
    body: JSON.stringify({ query: "topic", target_uri: "viking://resources/other" }),
  });
  assert.equal(denied.status, 403);
});
