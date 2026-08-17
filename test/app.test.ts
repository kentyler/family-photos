import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import type { DataStore, IdentityProfile } from "../src/data.js";
import type { IdentityClient } from "../src/oidc.js";

const config = { nodeEnv: "test", port: 3000, appOrigin: "http://localhost:3000", sessionSecret: "test-secret-long-enough-for-session-signing" };

function fakeData(): DataStore {
  return {
    async upsertGoogleUser(_profile: IdentityProfile) { return { id: "user-1", email: "ken@example.com", displayName: "Ken", avatarUrl: null }; },
    async getUser(userId) { return userId === "user-1" ? { id: userId, email: "ken@example.com", displayName: "Ken", avatarUrl: null } : null; },
    async listArchives(userId) { return userId === "user-1" ? [{ id: "11111111-1111-4111-8111-111111111111", name: "Tyler Family", role: "owner" }] : []; },
    async getArchive(userId, archiveId) { return userId === "user-1" && archiveId === "11111111-1111-4111-8111-111111111111" ? { id: archiveId, name: "Tyler Family", role: "owner" } : null; },
  };
}

const identity: IdentityClient = {
  async begin() { return { url: "https://accounts.google.com/o/oauth2/auth?scope=openid+email+profile", state: "state-1", codeVerifier: "verifier-1" }; },
  async finish(_url, state, verifier) {
    assert.equal(state, "state-1");
    assert.equal(verifier, "verifier-1");
    return { googleSubject: "google-1", email: "ken@example.com", displayName: "Ken", avatarUrl: null };
  },
};

async function withServer(run: (origin: string) => Promise<void>, dependencies = {}) {
  const server = createApp(config, dependencies).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await run(origin); } finally { server.close(); }
}

function cookie(response: Response) {
  const value = response.headers.get("set-cookie");
  assert(value);
  return value.split(";", 1)[0]!;
}

async function signIn(origin: string) {
  const start = await fetch(`${origin}/auth/google`, { redirect: "manual" });
  assert.equal(start.status, 302);
  assert.match(start.headers.get("location") ?? "", /^https:\/\/accounts\.google\.com/);
  const callback = await fetch(`${origin}/auth/google/callback?code=code-1&state=state-1`, {
    redirect: "manual",
    headers: { cookie: cookie(start) },
  });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "/app");
  return cookie(callback);
}

test("health endpoint reports ready", () => withServer(async (origin) => {
  const response = await fetch(`${origin}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
}));

test("current user is private without a session", () => withServer(async (origin) => {
  const response = await fetch(`${origin}/api/me`);
  assert.equal(response.status, 401);
}));

test("Google login persists the user and establishes a fresh session", () => withServer(async (origin) => {
  const sessionCookie = await signIn(origin);
  const response = await fetch(`${origin}/api/me`, { headers: { cookie: sessionCookie } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: "user-1", email: "ken@example.com", displayName: "Ken", avatarUrl: null });
}, { data: fakeData(), identity }));

test("archive endpoints expose only the signed-in user's memberships", () => withServer(async (origin) => {
  const sessionCookie = await signIn(origin);
  const list = await fetch(`${origin}/api/archives`, { headers: { cookie: sessionCookie } });
  assert.deepEqual(await list.json(), { archives: [{ id: "11111111-1111-4111-8111-111111111111", name: "Tyler Family", role: "owner" }] });

  const absent = await fetch(`${origin}/api/archives/22222222-2222-4222-8222-222222222222`, { headers: { cookie: sessionCookie } });
  assert.equal(absent.status, 404);
}, { data: fakeData(), identity }));

test("logout destroys the server-side session", () => withServer(async (origin) => {
  const sessionCookie = await signIn(origin);
  const logout = await fetch(`${origin}/auth/logout`, { method: "POST", headers: { cookie: sessionCookie } });
  assert.equal(logout.status, 204);
  const current = await fetch(`${origin}/api/me`, { headers: { cookie: sessionCookie } });
  assert.equal(current.status, 401);
}, { data: fakeData(), identity }));
