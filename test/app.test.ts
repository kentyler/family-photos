import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import type { ApplicationMembership, DataStore, IdentityProfile } from "../src/data.js";
import type { IdentityClient } from "../src/oidc.js";

const config = { nodeEnv: "test", port: 3000, appOrigin: "http://localhost:3000", sessionSecret: "test-secret-long-enough-for-session-signing", tokenEncryptionKey: "test-token-encryption-key-long-enough" };

function fakeData(applicationRole: "administrator" | "member" = "administrator"): DataStore {
  const members: ApplicationMembership[] = [{ id: "membership-1", email: "ken@example.com", role: applicationRole, joined: true }];
  let driveConnected = false;
  let encryptedDriveToken: string | null = null;
  const folders: Array<{ id: string; driveFolderId: string; name: string; attachedAt: string }> = [];
  return {
    async isReady() { return true; },
    async admitGoogleUser(_profile: IdentityProfile) { return { id: "user-1", email: "ken@example.com", displayName: "Ken", avatarUrl: null }; },
    async getUser(userId) { return userId === "user-1" ? { id: userId, email: "ken@example.com", displayName: "Ken", avatarUrl: null } : null; },
    async getApplicationRole(userId) { return userId === "user-1" ? applicationRole : null; },
    async listApplicationMembers() { return members; },
    async addApplicationMember(email, role) {
      const member = { id: `membership-${members.length + 1}`, email, role, joined: false };
      members.push(member);
      return member;
    },
    async saveDriveConnection(_userId, encryptedToken) { driveConnected = true; encryptedDriveToken = encryptedToken; },
    async hasDriveConnection() { return driveConnected; },
    async getEncryptedDriveRefreshToken() { return encryptedDriveToken; },
    async attachDriveFolder(_userId, driveFolderId, name) {
      const folder = { id: `folder-${folders.length + 1}`, driveFolderId, name, attachedAt: "2026-08-17T00:00:00.000Z" };
      folders.push(folder);
      return folder;
    },
    async listAttachedFolders() { return folders; },
    async getAttachedFolder(_userId, folderId) { return folders.find((folder) => folder.id === folderId) ?? null; },
    async replaceIndexedDriveItems(_userId, _folderId, items) { return items.length; },
    async countIndexedDriveItems() { return 0; },
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

test("readiness verifies the application data store", () => withServer(async (origin) => {
  const response = await fetch(`${origin}/ready`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ready" });
}, { data: fakeData() }));

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

test("verified Google identities not on the membership list are denied", () => withServer(async (origin) => {
  const start = await fetch(`${origin}/auth/google`, { redirect: "manual" });
  const callback = await fetch(`${origin}/auth/google/callback?code=code-1&state=state-1`, {
    redirect: "manual",
    headers: { cookie: cookie(start) },
  });
  assert.equal(callback.status, 403);
  assert.match(await callback.text(), /Membership required/);
}, { data: (() => { const data = fakeData(); data.admitGoogleUser = async () => null; return data; })(), identity }));

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

test("administrators can add an approved application member", () => withServer(async (origin) => {
  const sessionCookie = await signIn(origin);
  const added = await fetch(`${origin}/api/admin/members`, {
    method: "POST",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
    body: JSON.stringify({ email: "relative@example.com", role: "member" }),
  });
  assert.equal(added.status, 201);
  assert.deepEqual(await added.json(), { id: "membership-2", email: "relative@example.com", role: "member", joined: false });
}, { data: fakeData(), identity }));

test("ordinary members cannot manage the application membership list", () => withServer(async (origin) => {
  const sessionCookie = await signIn(origin);
  const response = await fetch(`${origin}/api/admin/members`, { headers: { cookie: sessionCookie } });
  assert.equal(response.status, 403);
}, { data: fakeData("member"), identity }));

test("Drive authorization is separate and stores an encrypted refresh token", () => {
  const data = fakeData();
  let storedToken = "";
  data.saveDriveConnection = async (_userId, encryptedToken) => { storedToken = encryptedToken; };
  const driveAuthorization = {
    async begin() { return { url: "https://accounts.google.com/o/oauth2/auth?scope=https://www.googleapis.com/auth/drive.file", state: "drive-state", codeVerifier: "drive-verifier" }; },
    async finish(_url: URL, state: string, verifier: string) {
      assert.equal(state, "drive-state");
      assert.equal(verifier, "drive-verifier");
      return { refreshToken: "plain-refresh-token", scope: "https://www.googleapis.com/auth/drive.file" };
    },
    async getAccessToken() { return "access-token"; },
    async getFolder(_accessToken: string, folderId: string) { return { id: folderId, name: "Family Album" }; },
    async listChildren() { return []; },
  };
  return withServer(async (origin) => {
    const sessionCookie = await signIn(origin);
    const connect = await fetch(`${origin}/drive/connect`, { redirect: "manual", headers: { cookie: sessionCookie } });
    assert.equal(connect.status, 302);
    assert.match(connect.headers.get("location") ?? "", /drive\.file/);
    const callback = await fetch(`${origin}/drive/callback?code=drive-code&state=drive-state`, {
      redirect: "manual",
      headers: { cookie: cookie(connect) },
    });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), "/app?drive=connected");
    assert(storedToken);
    assert.doesNotMatch(storedToken, /plain-refresh-token/);
  }, { data, identity, driveAuthorization });
});

test("a connected member can attach a Picker-selected Drive folder", () => {
  const data = fakeData();
  const driveAuthorization = {
    async begin() { return { url: "https://accounts.google.com", state: "drive-state", codeVerifier: "drive-verifier" }; },
    async finish() { return { refreshToken: "refresh-token", scope: "https://www.googleapis.com/auth/drive.file" }; },
    async getAccessToken(refreshToken: string) { assert.equal(refreshToken, "refresh-token"); return "access-token"; },
    async getFolder(accessToken: string, folderId: string) {
      assert.equal(accessToken, "access-token");
      assert.equal(folderId, "drive-folder-1");
      return { id: folderId, name: "Grandma's Photos" };
    },
    async listChildren() { return []; },
  };
  return withServer(async (origin) => {
    const sessionCookie = await signIn(origin);
    const connect = await fetch(`${origin}/drive/connect`, { redirect: "manual", headers: { cookie: sessionCookie } });
    await fetch(`${origin}/drive/callback?code=drive-code&state=drive-state`, { redirect: "manual", headers: { cookie: cookie(connect) } });
    const attached = await fetch(`${origin}/api/drive/folders`, {
      method: "POST",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({ folderId: "drive-folder-1" }),
    });
    assert.equal(attached.status, 201);
    assert.deepEqual(await attached.json(), { id: "folder-1", driveFolderId: "drive-folder-1", name: "Grandma's Photos", attachedAt: "2026-08-17T00:00:00.000Z" });
  }, { data, identity, driveAuthorization });
});
