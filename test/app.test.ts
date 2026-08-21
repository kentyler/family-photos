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
    async detachDriveFolder(_userId, folderId) { const index = folders.findIndex((folder) => folder.id === folderId); if (index < 0) return false; folders.splice(index, 1); return true; },
    async replaceIndexedDriveItems(_userId, _folderId, items) { return items.length; },
    async getIndexedDriveFolder(_userId, _folderId, driveFolderId) { return driveFolderId === "subfolder-1" ? { driveFolderId, parentDriveId: "drive-folder-1", name: "1940s", relativePath: "1940s", modifiedTime: null } : null; },
    async replaceIndexedDriveSubtree(_userId, _folderId, _driveFolderId, items) { return items.length; },
    async countIndexedDriveItems() { return 0; },
    async countLegacyDriveMatches() { return 0; },
    async reconcileLegacyDriveItems() { return { matched: 0, exactPath: 0, uniqueNameSize: 0, unmatched: 0, ambiguous: 0 }; },
    async createDriveScanJob() { return { id: "job-1", status: "pending", foldersScanned: 0, itemsDiscovered: 0, matchedItems: null, unmatchedItems: null, ambiguousItems: null, errorMessage: null }; },
    async updateDriveScanJob() {},
    async getLatestDriveScanJob() { return null; },
    async getReconciliationReview() { return { total: 0, items: [] }; },
    async getDriveBrowserPage() { return { parentName: "Family Album", parentDriveId: null, total: 0, items: [] }; },
    async canAccessIndexedDriveFile() { return true; },
    async getPhotoText() { return { caption: "", notes: "", updatedAt: null, updatedBy: null }; },
    async savePhotoText(_userId, _folderId, _fileId, caption, notes) { return { caption, notes, updatedAt: "2026-08-18T00:00:00.000Z", updatedBy: "Ken" }; },
    async listPhotoSubjectRegions() { return []; },
    async listPersonAliasChoices() { return [{ personId: "person-1", aliasId: "alias-1", alias: "Grandma Claire", isPrimary: false }]; },
    async createPersonWithAlias(_userId, alias) { return { personId: "person-2", aliasId: "alias-2", alias, isPrimary: true }; },
    async addPersonAlias(_userId, personId, alias) { return { personId, aliasId: "alias-3", alias, isPrimary: false }; },
    async updatePersonAlias(_userId, personId, aliasId, alias) { return personId === "person-1" ? { personId, aliasId, alias, isPrimary: aliasId === "alias-primary" } : null; },
    async createPhotoSubjectRegion(_userId, _folderId, _fileId, subjectType, label, personId, aliasId, x, y, width, height) { return { id: "region-1", subjectType, personId, aliasId, label: label ?? "Grandma Claire", x, y, width, height, createdBy: "Ken", createdAt: "2026-08-18T00:00:00.000Z" }; },
    async deletePhotoSubjectRegion() { return true; },
    async searchPeople(_userId, query) { return query ? [{ id: "person-1", primaryName: "Claire Atwood", aliases: ["Claire Atwood", "Grandma Claire"] }] : []; },
    async getPersonExplorer(_userId, personId) { return personId === "person-1" ? { id: personId, primaryName: "Claire Atwood", aliases: ["Claire Atwood", "Grandma Claire"], parents: [], spouses: [], children: [], stories: [], photos: [] } : null; },
    async listFamilyStories() { return [{ id: "story-existing", title: "Lake days", body: "A family memory.", people: [{ id: "person-1", primaryName: "Claire Atwood" }], createdAt: "2026-08-18T00:00:00.000Z", createdBy: "Ken" }]; },
    async createFamilyStory(_userId, title, body, personIds) { return { id: "story-1", title, body, people: personIds.map((id) => ({ id, primaryName: "Claire Atwood" })), createdAt: "2026-08-19T00:00:00.000Z", createdBy: "Ken" }; },
    async addFamilyRelationship() { return true; },
    async deleteFamilyRelationship() { return true; },
    async recordActivity() { return true; },
    async listRecentActivity() { return []; },
    async listGenealogyExport() { return [{ personId: "person-1", primaryName: "Claire Atwood", aliases: ["Claire Atwood", "Grandma Claire"], parentIds: ["person-2"], parents: ["Mary Atwood"], spouseIds: ["person-3"], spouses: ["Larry Atwood"], childIds: ["person-4"], children: ["June Atwood"], identifiedPhotoCount: 4 }]; },
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

test("the public welcome screen links to a tutorial that does not require authentication", () => withServer(async (origin) => {
  const welcome = await fetch(`${origin}/`);
  assert.equal(welcome.status, 200);
  assert.match(await welcome.text(), /href="\/tutorial">Take the tutorial/);

  const tutorial = await fetch(`${origin}/tutorial`);
  assert.equal(tutorial.status, 200);
  const html = await tutorial.text();
  assert.match(html, /Step 1 of 6/);
  assert.match(html, /Continue with Google/);
  assert.match(html, /Connect Google Drive/);
  assert.match(html, /Choose photo folders/);
  assert.match(html, /Keep the story with the photograph/);
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(script[1] ?? ""));
}));

test("signed-in members can launch the tutorial from the archive screen", () => withServer(async (origin) => {
  const sessionCookie = await signIn(origin);
  const archive = await fetch(`${origin}/app`, { headers: { cookie: sessionCookie } });
  assert.equal(archive.status, 200);
  const html = await archive.text();
  assert.match(html, /href="\/tutorial">Tutorial<\/a>/);
  assert.match(html, /href="\/tutorial">Take the tutorial<\/a>/);
}, { data: fakeData(), identity }));

test("Google login persists the user and establishes a fresh session", () => withServer(async (origin) => {
  const sessionCookie = await signIn(origin);
  const response = await fetch(`${origin}/api/me`, { headers: { cookie: sessionCookie } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: "user-1", email: "ken@example.com", displayName: "Ken", avatarUrl: null });
}, { data: fakeData(), identity }));

test("successful logins and photo interactions are recorded", () => {
  const data = fakeData();
  const events: Array<{ eventType: string; folderId?: string; fileId?: string }> = [];
  data.recordActivity = async (_userId, eventType, folderId, fileId) => { events.push({ eventType, folderId, fileId }); return true; };
  return withServer(async (origin) => {
    const sessionCookie = await signIn(origin);
    const headers = { cookie: sessionCookie };
    assert.equal((await fetch(`${origin}/api/drive/folders/folder-1/photos/photo-1/view`, { method: "POST", headers })).status, 204);
    assert.equal((await fetch(`${origin}/api/drive/folders/folder-1/photos/photo-1/text`, { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ caption: "At the lake", notes: "Summer 1952" }) })).status, 200);
    assert.equal((await fetch(`${origin}/api/people`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ alias: "Mary Atwood" }) })).status, 201);
    assert.equal((await fetch(`${origin}/api/people/person-1/relationships`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ relationshipType: "child", relatedPersonId: "person-2" }) })).status, 201);
    assert.equal((await fetch(`${origin}/api/people/person-1/relationships/relationship-1`, { method: "DELETE", headers })).status, 204);
    assert.deepEqual(events.map((event) => event.eventType), ["login", "photo_viewed", "photo_notes_updated", "family_person_created", "family_relationship_added", "family_relationship_removed"]);
  }, { data, identity });
});

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

test("only administrators can review recent activity", async () => {
  await withServer(async (origin) => {
    const sessionCookie = await signIn(origin);
    assert.equal((await fetch(`${origin}/api/admin/activity`, { headers: { cookie: sessionCookie } })).status, 200);
  }, { data: fakeData(), identity });
  await withServer(async (origin) => {
    const sessionCookie = await signIn(origin);
    assert.equal((await fetch(`${origin}/api/admin/activity`, { headers: { cookie: sessionCookie } })).status, 403);
  }, { data: fakeData("member"), identity });
});

test("administrators can export re-importable genealogy CSV with stable IDs", () => withServer(async (origin) => {
  const sessionCookie = await signIn(origin);
  const response = await fetch(`${origin}/admin/genealogy.csv`, { headers: { cookie: sessionCookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/csv/);
  assert.match(response.headers.get("content-disposition") ?? "", /family-genealogy-\d{4}-\d{2}-\d{2}\.csv/);
  const csv = await response.text();
  assert.match(csv, /^\uFEFF?"Person ID","Primary name","Aliases","Parent IDs","Parents","Spouse IDs","Spouses","Child IDs","Children","Identified photo count"/);
  assert.match(csv, /"person-1","Claire Atwood"/);
  assert.match(csv, /"person-2","Mary Atwood"/);
}, { data: fakeData(), identity }));

test("ordinary members cannot export genealogy CSV", () => withServer(async (origin) => {
  const sessionCookie = await signIn(origin);
  assert.equal((await fetch(`${origin}/admin/genealogy.csv`, { headers: { cookie: sessionCookie } })).status, 403);
}, { data: fakeData("member"), identity }));

test("Drive authorization is separate and stores an encrypted refresh token", () => {
  const data = fakeData();
  let storedToken = "";
  data.saveDriveConnection = async (_userId, encryptedToken) => { storedToken = encryptedToken; };
  const driveAuthorization = {
    async begin() { return { url: "https://accounts.google.com/o/oauth2/auth?scope=https://www.googleapis.com/auth/drive.readonly", state: "drive-state", codeVerifier: "drive-verifier" }; },
    async finish(_url: URL, state: string, verifier: string) {
      assert.equal(state, "drive-state");
      assert.equal(verifier, "drive-verifier");
      return { refreshToken: "plain-refresh-token", scope: "https://www.googleapis.com/auth/drive.readonly" };
    },
    async getAccessToken() { return "access-token"; },
    async getFolder(_accessToken: string, folderId: string) { return { id: folderId, name: "Family Album" }; },
    async listChildren() { return []; },
    async getFileResponse() { return new Response(); },
  };
  return withServer(async (origin) => {
    const sessionCookie = await signIn(origin);
    const connect = await fetch(`${origin}/drive/connect`, { redirect: "manual", headers: { cookie: sessionCookie } });
    assert.equal(connect.status, 302);
    assert.match(connect.headers.get("location") ?? "", /drive\.readonly/);
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
    async finish() { return { refreshToken: "refresh-token", scope: "https://www.googleapis.com/auth/drive.readonly" }; },
    async getAccessToken(refreshToken: string) { assert.equal(refreshToken, "refresh-token"); return "access-token"; },
    async getFolder(accessToken: string, folderId: string) {
      assert.equal(accessToken, "access-token");
      assert.equal(folderId, "drive-folder-1");
      return { id: folderId, name: "Grandma's Photos" };
    },
    async listChildren() { return []; },
    async getFileResponse() { return new Response(); },
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

test("returning members see saved folders and can remove them from the archive", () => {
  const data = fakeData();
  data.hasDriveConnection = async () => true;
  return withServer(async (origin) => {
    const sessionCookie = await signIn(origin);
    await data.attachDriveFolder("user-1", "drive-folder-1", "Grandma's Photos");

    const archive = await fetch(`${origin}/app`, { headers: { cookie: sessionCookie } });
    const archiveHtml = await archive.text();
    assert.match(archiveHtml, /Your saved photo folders are ready below/);
    assert.match(archiveHtml, /Grandma&#0?39;s Photos/);
    assert.match(archiveHtml, /Add or remove folders/);

    const folderPage = await fetch(`${origin}/drive/folders`, { headers: { cookie: sessionCookie } });
    assert.match(await folderPage.text(), /Remove folder/);
    const removed = await fetch(`${origin}/api/drive/folders/folder-1/remove`, { method: "POST", redirect: "manual", headers: { cookie: sessionCookie } });
    assert.equal(removed.status, 303);
    assert.equal(removed.headers.get("location"), "/drive/folders?removed=1");
    assert.deepEqual(await data.listAttachedFolders("user-1"), []);
  }, { data, identity });
});

test("members can review reconciliation samples for their attached folder", () => {
  const data = fakeData();
  data.getReconciliationReview = async (_userId, folderId, category) => {
    assert.equal(folderId, "folder-1");
    assert.equal(category, "ambiguous");
    return { total: 1, items: [{ name: "portrait.jpg", relativePath: "Album/portrait.jpg", mimeType: "image/jpeg", sizeBytes: 1234, matchMethod: null, legacyPaths: ["old/portrait.jpg", "copy/portrait.jpg"] }] };
  };
  return withServer(async (origin) => {
    const sessionCookie = await signIn(origin);
    await data.attachDriveFolder("user-1", "drive-folder-1", "Family Album");
    const response = await fetch(`${origin}/drive/folders/folder-1/reconciliation?category=ambiguous`, { headers: { cookie: sessionCookie } });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Family Album/);
    assert.match(html, /Album\/portrait\.jpg/);
    assert.match(html, /old\/portrait\.jpg/);
  }, { data, identity });
});

test("members can browse indexed folders and open image cards", () => {
  const data = fakeData();
  data.getDriveBrowserPage = async () => ({ parentName: "Family Album", parentDriveId: null, total: 2, items: [
    { driveFileId: "subfolder-1", name: "1940s", caption: null, mimeType: "application/vnd.google-apps.folder", modifiedTime: null, sizeBytes: null, matched: false },
    { driveFileId: "photo-1", name: "Portrait.jpg", caption: "Claire and Larry", mimeType: "image/jpeg", modifiedTime: null, sizeBytes: 1234, matched: true },
  ] });
  return withServer(async (origin) => {
    const sessionCookie = await signIn(origin);
    await data.attachDriveFolder("user-1", "drive-folder-1", "Family Album");
    const response = await fetch(`${origin}/drive/folders/folder-1/browse`, { headers: { cookie: sessionCookie } });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /1940s/);
    assert.match(html, /Portrait\.jpg/);
    assert.match(html, /Claire and Larry/);
    assert.match(html, /title="Claire and Larry"/);
    assert.doesNotMatch(html, /Legacy details linked/);
    assert.match(html, /photo-viewer/);
    assert.match(html, /About this photograph/);
    assert.match(html, /Notes/);
    assert.match(html, /data-id="photo-1"/);
    assert.match(html, /viewer-caption/);
    assert.match(html, /Mark a subject/);
    assert.match(html, /subject-canvas/);
    assert.match(html, /Hide marks/);
    assert.match(html, /minmax\(460px,2fr\)/);
    assert.match(html, /flexWrap="nowrap"/);
    assert.match(html, /Mark another subject/);
    assert.match(html, /subject-list\{max-height:15rem;overflow-y:auto/);
    assert.match(html, /Main navigation/);
    assert.match(html, /People &amp; family/);
    assert.match(html, /people\?person=/);
    for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(script[1] ?? ""));
    data.getDriveBrowserPage = async () => ({ parentName: "1940s", parentDriveId: "drive-folder-1", total: 0, items: [] });
    const subfolder = await fetch(`${origin}/drive/folders/folder-1/browse?parent=subfolder-1`, { headers: { cookie: sessionCookie } });
    const subfolderHtml = await subfolder.text();
    assert.match(subfolderHtml, /Rescan this folder/);
    assert.match(subfolderHtml, /name="driveFolderId" value="subfolder-1"/);
    const targeted = await fetch(`${origin}/api/drive/folders/folder-1/rescan-subtree`, { method: "POST", redirect: "manual", headers: { cookie: sessionCookie, "content-type": "application/x-www-form-urlencoded" }, body: "driveFolderId=subfolder-1" });
    assert.equal(targeted.status, 303);
    assert.match(targeted.headers.get("location") ?? "", /parent=subfolder-1&scan=queued/);
  }, { data, identity });
});

test("members can load and save caption and story text for an indexed photo", () => {
  const data = fakeData();
  data.getPhotoText = async (_userId, folderId, fileId) => {
    assert.equal(folderId, "folder-1");
    assert.equal(fileId, "photo-1");
    return { caption: "Family picnic", notes: "Taken near the old house.", updatedAt: null, updatedBy: null };
  };
  return withServer(async (origin) => {
    const sessionCookie = await signIn(origin);
    const loaded = await fetch(`${origin}/api/drive/folders/folder-1/photos/photo-1/text`, { headers: { cookie: sessionCookie } });
    assert.equal(loaded.status, 200);
    assert.deepEqual(await loaded.json(), { caption: "Family picnic", notes: "Taken near the old house.", updatedAt: null, updatedBy: null });
    const saved = await fetch(`${origin}/api/drive/folders/folder-1/photos/photo-1/text`, {
      method: "PUT",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({ caption: "Summer picnic", notes: "Grandma remembered the red blanket." }),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { caption: "Summer picnic", notes: "Grandma remembered the red blanket.", updatedAt: "2026-08-18T00:00:00.000Z", updatedBy: "Ken" });
  }, { data, identity });
});

test("members can create person aliases and mark people or things in a photo", () => {
  const data = fakeData();
  return withServer(async (origin) => {
    const sessionCookie = await signIn(origin);
    const aliases = await fetch(`${origin}/api/people/aliases`, { headers: { cookie: sessionCookie } });
    assert.deepEqual(await aliases.json(), { aliases: [{ personId: "person-1", aliasId: "alias-1", alias: "Grandma Claire", isPrimary: false }] });
    const person = await fetch(`${origin}/api/people`, { method: "POST", headers: { cookie: sessionCookie, "content-type": "application/json" }, body: JSON.stringify({ alias: "Aunt Jo" }) });
    assert.equal(person.status, 201);
    const addedAlias = await fetch(`${origin}/api/people/person-1/aliases`, { method: "POST", headers: { cookie: sessionCookie, "content-type": "application/json" }, body: JSON.stringify({ alias: "Claire" }) });
    assert.equal(addedAlias.status, 201);
    assert.deepEqual(await addedAlias.json(), { personId: "person-1", aliasId: "alias-3", alias: "Claire", isPrimary: false });
    const updatedAlias = await fetch(`${origin}/api/people/person-1/aliases/alias-1`, { method: "PATCH", headers: { cookie: sessionCookie, "content-type": "application/json" }, body: JSON.stringify({ alias: "Grandma C" }) });
    assert.equal(updatedAlias.status, 200);
    assert.deepEqual(await updatedAlias.json(), { personId: "person-1", aliasId: "alias-1", alias: "Grandma C", isPrimary: false });
    const marked = await fetch(`${origin}/api/drive/folders/folder-1/photos/photo-1/subjects`, { method: "POST", headers: { cookie: sessionCookie, "content-type": "application/json" }, body: JSON.stringify({ subjectType: "person", personId: "person-1", aliasId: "alias-1", x: 0.1, y: 0.2, width: 0.3, height: 0.4 }) });
    assert.equal(marked.status, 201);
    assert.deepEqual(await marked.json(), { id: "region-1", subjectType: "person", personId: "person-1", aliasId: "alias-1", label: "Grandma Claire", x: 0.1, y: 0.2, width: 0.3, height: 0.4, createdBy: "Ken", createdAt: "2026-08-18T00:00:00.000Z" });
  }, { data, identity });
});

test("members can search people and open the genealogy explorer", () => {
  const data = fakeData();
  return withServer(async (origin) => {
    const sessionCookie = await signIn(origin);
    const search = await fetch(`${origin}/api/people/search?q=grandma`, { headers: { cookie: sessionCookie } });
    assert.deepEqual(await search.json(), { people: [{ id: "person-1", primaryName: "Claire Atwood", aliases: ["Claire Atwood", "Grandma Claire"] }] });
    const person = await fetch(`${origin}/api/people/person-1/explorer`, { headers: { cookie: sessionCookie } });
    assert.equal(person.status, 200);
    const page = await fetch(`${origin}/people?person=person-1`, { headers: { cookie: sessionCookie } });
    const html = await page.text();
    assert.match(html, /Family explorer/);
    assert.match(html, /Marriages/);
    assert.match(html, /people-photo-grid/);
    assert.match(html, /Photo folders/);
    assert.match(html, /Add marriage/);
    assert.match(html, /Add child/);
    assert.match(html, /Edit names and aliases/);
    assert.match(html, /method:\"PATCH\"/);
    const relationship = await fetch(`${origin}/api/people/person-1/relationships`, { method: "POST", headers: { cookie: sessionCookie, "content-type": "application/json" }, body: JSON.stringify({ relationshipType: "spouse", relatedPersonId: "person-2", dateText: "June 1952" }) });
    assert.equal(relationship.status, 201);
    assert.match(html, /View →/);
    assert.match(html, /data\.people\.length===1/);
    assert.match(html, /That person could not be opened/);
  }, { data, identity });
});

test("the family explorer can add a parent with the correct relationship direction", () => {
  const data = fakeData();
  let relationship: { parentId: string; childId: string; type: string } | undefined;
  let deleted: { personId: string; relationshipId: string } | undefined;
  data.addFamilyRelationship = async (_userId, parentId, childId, type) => { relationship = { parentId, childId, type }; return true; };
  data.deleteFamilyRelationship = async (_userId, personId, relationshipId) => { deleted = { personId, relationshipId }; return true; };
  return withServer(async (origin) => {
    const sessionCookie = await signIn(origin);
    const explorer = await fetch(`${origin}/people`, { headers: { cookie: sessionCookie } });
    assert.match(await explorer.text(), /relationshipEditor\("\.parents","parent","Add parent"\)/);
    const saved = await fetch(`${origin}/api/people/person-1/relationships`, {
      method: "POST",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({ relationshipType: "parent", relatedPersonId: "person-2" }),
    });
    assert.equal(saved.status, 201);
    assert.deepEqual(relationship, { parentId: "person-2", childId: "person-1", type: "parent" });
    const removed = await fetch(`${origin}/api/people/person-1/relationships/relationship-1`, { method: "DELETE", headers: { cookie: sessionCookie } });
    assert.equal(removed.status, 204);
    assert.deepEqual(deleted, { personId: "person-1", relationshipId: "relationship-1" });
  }, { data, identity });
});

test("members can open a collapsible family tree linked to genealogy and photos", () => withServer(async (origin) => {
  const sessionCookie = await signIn(origin);
  const response = await fetch(`${origin}/tree?person=person-1`, { headers: { cookie: sessionCookie } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Branches load as you expand them/);
  assert.match(html, /Individual genealogy form/);
  assert.match(html, /Photos/);
  assert.match(html, /branch\("Parents"/);
  assert.match(html, /branch\("Marriages"/);
  assert.match(html, /branch\("Children"/);
  assert.match(html, /function addEditor/);
  assert.match(html, /Remove this relationship/);
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(script[1] ?? ""));
}, { data: fakeData(), identity }));

test("members can create stories linked to genealogy people", () => {
  const data = fakeData();
  return withServer(async (origin) => {
    const sessionCookie = await signIn(origin);
    const page = await fetch(`${origin}/stories`, { headers: { cookie: sessionCookie } });
    const html = await page.text();
    assert.match(html, /Add a story/);
    assert.match(html, /Link people/);
    assert.match(html, /href="\/people\?person=/);
    const created = await fetch(`${origin}/api/stories`, { method: "POST", headers: { cookie: sessionCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "The lake picnic", body: "Claire always brought the red blanket.", personIds: ["person-1"] }) });
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { id: "story-1", title: "The lake picnic", body: "Claire always brought the red blanket.", people: [{ id: "person-1", primaryName: "Claire Atwood" }], createdAt: "2026-08-19T00:00:00.000Z", createdBy: "Ken" });
  }, { data, identity });
});
