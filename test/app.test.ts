import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";

test("health endpoint reports ready", async () => {
  const app = createApp({ nodeEnv: "test", port: 0 });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
  server.close();
});

test("current user is private without a session", async () => {
  const app = createApp({ nodeEnv: "test", port: 0 });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/me`);
  assert.equal(response.status, 401);
  server.close();
});
