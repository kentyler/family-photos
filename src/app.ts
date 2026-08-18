import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import type { AppConfig } from "./config.js";
import { createPostgresDataStore, type DataStore, type DriveScanJob } from "./data.js";
import { createGoogleIdentityClient, type IdentityClient } from "./oidc.js";
import { createDriveAuthorizationClient, type DriveAuthorizationClient } from "./drive-oauth.js";
import { decryptToken, encryptToken } from "./token-crypto.js";

export type AppDependencies = { data?: DataStore; identity?: IdentityClient; driveAuthorization?: DriveAuthorizationClient };

function regenerate(request: Request) {
  return new Promise<void>((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
}

function destroy(request: Request) {
  return new Promise<void>((resolve, reject) => request.session.destroy((error) => error ? reject(error) : resolve()));
}

export function createApp(config: AppConfig, supplied: AppDependencies = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  const pool = config.databaseUrl ? new pg.Pool({ connectionString: config.databaseUrl }) : undefined;
  const data = supplied.data ?? (pool ? createPostgresDataStore(pool) : undefined);
  const identity = supplied.identity ?? (
    config.googleClientId && config.googleClientSecret
      ? createGoogleIdentityClient({ clientId: config.googleClientId, clientSecret: config.googleClientSecret, appOrigin: config.appOrigin })
      : undefined
  );
  const driveAuthorization = supplied.driveAuthorization ?? (
    config.googleClientId && config.googleClientSecret
      ? createDriveAuthorizationClient({ clientId: config.googleClientId, clientSecret: config.googleClientSecret, appOrigin: config.appOrigin })
      : undefined
  );

  const PgStore = connectPgSimple(session);
  app.use(session({
    name: "family.sid",
    secret: config.sessionSecret ?? "development-only-session-secret-change-me",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: pool ? new PgStore({ pool, tableName: "user_sessions" }) : undefined,
    cookie: { httpOnly: true, sameSite: "lax", secure: config.nodeEnv === "production", maxAge: 30 * 24 * 60 * 60 * 1000 },
  }));

  const requireMember = async (request: Request, response: Response, next: NextFunction) => {
    if (!request.session.userId || !data) return response.status(401).json({ error: "authentication_required" });
    try {
      if (!await data.getApplicationRole(request.session.userId)) {
        await destroy(request);
        return response.status(401).json({ error: "membership_required" });
      }
      next();
    } catch (error) { next(error); }
  };

  const requireAdministrator = async (request: Request, response: Response, next: NextFunction) => {
    if (!request.session.userId || !data) return response.status(401).json({ error: "authentication_required" });
    try {
      return await data.getApplicationRole(request.session.userId) === "administrator"
        ? next()
        : response.status(403).json({ error: "administrator_required" });
    } catch (error) { next(error); }
  };

  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.get("/ready", async (_request, response) => {
    try {
      return data && await data.isReady()
        ? response.json({ status: "ready" })
        : response.status(503).json({ status: "unavailable" });
    } catch {
      return response.status(503).json({ status: "unavailable" });
    }
  });

  app.get("/auth/google", async (request, response, next) => {
    if (!identity) return response.status(503).json({ error: "google_identity_not_configured" });
    try {
      const started = await identity.begin();
      request.session.oidc = { state: started.state, codeVerifier: started.codeVerifier };
      response.redirect(started.url);
    } catch (error) { next(error); }
  });

  app.get("/auth/google/callback", async (request, response, next) => {
    const attempt = request.session.oidc;
    delete request.session.oidc;
    if (!identity || !data || !attempt) return response.status(400).json({ error: "invalid_login_attempt" });
    try {
      const profile = await identity.finish(new URL(request.originalUrl, config.appOrigin), attempt.state, attempt.codeVerifier);
      const user = await data.admitGoogleUser(profile, config.bootstrapAdminEmail);
      if (!user) return response.status(403).type("html").send(page(`<p class="eyebrow">Private family archive</p><h1>Membership required</h1><p>Your Google identity was verified, but this email address is not on the archive membership list. Ask an administrator to add it.</p><a class="button" href="/">Return home</a>`));
      await regenerate(request);
      request.session.userId = user.id;
      response.redirect("/app");
    } catch (error) { next(error); }
  });

  app.post("/auth/logout", async (request, response, next) => {
    try {
      await destroy(request);
      response.clearCookie("family.sid", { httpOnly: true, sameSite: "lax", secure: config.nodeEnv === "production" });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.get("/api/auth/status", (request, response) => response.json({ authenticated: Boolean(request.session.userId) }));

  app.get("/api/me", requireMember, async (request, response, next) => {
    try {
      const user = await data?.getUser(request.session.userId!);
      return user ? response.json(user) : response.status(401).json({ error: "authentication_required" });
    } catch (error) { next(error); }
  });

  app.get("/api/archives", requireMember, async (request, response, next) => {
    try { response.json({ archives: await data!.listArchives(request.session.userId!) }); }
    catch (error) { next(error); }
  });

  app.get("/api/archives/:archiveId", requireMember, async (request, response, next) => {
    try {
      const archiveId = Array.isArray(request.params.archiveId) ? request.params.archiveId[0] : request.params.archiveId;
      if (!archiveId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(archiveId)) {
        return response.status(404).json({ error: "archive_not_found" });
      }
      const archive = await data!.getArchive(request.session.userId!, archiveId);
      return archive ? response.json(archive) : response.status(404).json({ error: "archive_not_found" });
    } catch (error) { next(error); }
  });

  app.get("/drive/connect", requireMember, async (request, response, next) => {
    if (!driveAuthorization) return response.status(503).json({ error: "drive_authorization_not_configured" });
    try {
      const started = await driveAuthorization.begin();
      request.session.driveOauth = { state: started.state, codeVerifier: started.codeVerifier };
      response.redirect(started.url);
    } catch (error) { next(error); }
  });

  app.get("/drive/callback", requireMember, async (request, response, next) => {
    const attempt = request.session.driveOauth;
    delete request.session.driveOauth;
    if (!driveAuthorization || !attempt || !config.tokenEncryptionKey) return response.status(400).json({ error: "invalid_drive_authorization_attempt" });
    try {
      const grant = await driveAuthorization.finish(new URL(request.originalUrl, config.appOrigin), attempt.state, attempt.codeVerifier);
      await data!.saveDriveConnection(request.session.userId!, encryptToken(grant.refreshToken, config.tokenEncryptionKey), grant.scope);
      response.redirect("/app?drive=connected");
    } catch (error) { next(error); }
  });

  app.get("/api/drive/status", requireMember, async (request, response, next) => {
    try { response.json({ connected: await data!.hasDriveConnection(request.session.userId!), folders: await data!.listAttachedFolders(request.session.userId!) }); }
    catch (error) { next(error); }
  });

  const getDriveAccessToken = async (userId: string) => {
    if (!driveAuthorization || !config.tokenEncryptionKey) return null;
    const encryptedToken = await data!.getEncryptedDriveRefreshToken(userId);
    return encryptedToken ? driveAuthorization.getAccessToken(decryptToken(encryptedToken, config.tokenEncryptionKey)) : null;
  };

  app.get("/api/drive/picker", requireMember, async (request, response, next) => {
    if (!config.googlePickerApiKey || !config.googleCloudProjectNumber) {
      return response.status(503).json({ error: "google_picker_not_configured" });
    }
    try {
      const accessToken = await getDriveAccessToken(request.session.userId!);
      return accessToken
        ? response.json({ accessToken, developerKey: config.googlePickerApiKey, appId: config.googleCloudProjectNumber })
        : response.status(409).json({ error: "drive_connection_required" });
    } catch (error) { next(error); }
  });

  app.post("/api/drive/folders", requireMember, async (request, response, next) => {
    const folderId = typeof request.body.folderId === "string" ? request.body.folderId.trim() : "";
    if (!folderId || folderId.length > 256) return response.status(400).json({ error: "valid_folder_id_required" });
    try {
      const accessToken = await getDriveAccessToken(request.session.userId!);
      if (!accessToken || !driveAuthorization) return response.status(409).json({ error: "drive_connection_required" });
      const folder = await driveAuthorization.getFolder(accessToken, folderId);
      return response.status(201).json(await data!.attachDriveFolder(request.session.userId!, folder.id, folder.name));
    } catch (error) { next(error); }
  });

  let scanQueue = Promise.resolve();
  const enqueueScan = (jobId: string, userId: string, folder: Awaited<ReturnType<DataStore["getAttachedFolder"]>>) => {
    scanQueue = scanQueue.then(async () => {
      if (!folder) return;
      try {
        await data!.updateDriveScanJob(jobId, { status: "running" });
        const accessToken = await getDriveAccessToken(userId);
        if (!accessToken || !driveAuthorization) throw new Error("Google Drive connection must be renewed");
        const pending = [{ driveId: folder.driveFolderId, relativePath: "" }];
        const visited = new Set<string>();
        const indexed = [];
        while (pending.length) {
          const { driveId: parentDriveId, relativePath: parentPath } = pending.shift()!;
          if (visited.has(parentDriveId)) continue;
          visited.add(parentDriveId);
          for (const item of await driveAuthorization.listChildren(accessToken, parentDriveId)) {
            if (item.mimeType === "application/vnd.google-apps.folder") pending.push({ driveId: item.id, relativePath: parentPath ? `${parentPath}/${item.name}` : item.name });
            else if (item.mimeType.startsWith("image/") || item.mimeType.startsWith("video/")) indexed.push({ driveFileId: item.id, parentDriveId, name: item.name, mimeType: item.mimeType, relativePath: parentPath ? `${parentPath}/${item.name}` : item.name, md5Checksum: item.md5Checksum, modifiedTime: item.modifiedTime, sizeBytes: item.sizeBytes });
          }
          if (visited.size % 25 === 0) await data!.updateDriveScanJob(jobId, { foldersScanned: visited.size, itemsDiscovered: indexed.length });
        }
        await data!.replaceIndexedDriveItems(userId, folder.id, indexed);
        const result = await data!.reconcileLegacyDriveItems(userId, folder.id);
        await data!.updateDriveScanJob(jobId, { status: "completed", foldersScanned: visited.size, itemsDiscovered: indexed.length, matchedItems: result.matched, unmatchedItems: result.unmatched, ambiguousItems: result.ambiguous });
      } catch (error) {
        console.error("Drive scan failed", error);
        await data!.updateDriveScanJob(jobId, { status: "failed", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Drive scan failed" });
      }
    });
  };

  app.post("/api/drive/folders/:folderId/rescan", requireMember, async (request, response, next) => {
    const folderId = Array.isArray(request.params.folderId) ? request.params.folderId[0] : request.params.folderId;
    if (!folderId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(folderId)) {
      return response.status(404).json({ error: "folder_not_found" });
    }
    try {
      const folder = await data!.getAttachedFolder(request.session.userId!, folderId);
      if (!folder) return response.status(404).json({ error: "folder_not_found" });
      const job = await data!.createDriveScanJob(request.session.userId!, folder.id);
      enqueueScan(job.id, request.session.userId!, folder);
      return request.is("application/x-www-form-urlencoded")
        ? response.redirect(303, "/drive/folders?scan=queued")
        : response.status(202).json({ job });
    } catch (error) { next(error); }
  });

  app.get("/drive/folders", requireMember, async (request, response, next) => {
    try {
      const connected = await data!.hasDriveConnection(request.session.userId!);
      if (!connected) return response.redirect("/drive/connect");
      const folders = await data!.listAttachedFolders(request.session.userId!);
      const foldersWithCounts = await Promise.all(folders.map(async (folder) => ({ folder, count: await data!.countIndexedDriveItems(request.session.userId!, folder.id), matched: await data!.countLegacyDriveMatches(request.session.userId!, folder.id), job: await data!.getLatestDriveScanJob(request.session.userId!, folder.id) })));
      const active = foldersWithCounts.some(({ job }) => job?.status === "pending" || job?.status === "running");
      const list = folders.length
        ? `<ul>${foldersWithCounts.map(({ folder, count, matched, job }) => `<li><strong>${escapeHtml(folder.name)}</strong> — ${count} indexed, ${matched} matched to the legacy catalog. ${scanStatus(job)} ${(job?.status === "pending" || job?.status === "running") ? "" : `<form class="inline" method="post" action="/api/drive/folders/${folder.id}/rescan"><button class="secondary" type="submit">${count ? "Rescan and reconcile" : "Scan and reconcile"}</button></form>${count ? ` <a href="/drive/folders/${folder.id}/reconciliation">Review reconciliation</a>` : ""}`}</li>`).join("")}</ul>`
        : "<p>No folders attached yet.</p>";
      const pickerReady = Boolean(config.googlePickerApiKey && config.googleCloudProjectNumber);
      return response.type("html").send(page(`<p class="eyebrow">Google Drive</p><h1>Photo folders</h1>${active ? '<p class="muted">Scanning continues in the background. This page refreshes automatically.</p>' : ""}${list}${pickerReady ? '<button id="choose-folder" type="button">Choose a folder</button><p id="picker-message" class="muted"></p>' : '<p>Folder selection needs one final Google Cloud setting.</p>'}<p><a href="/drive/connect">Reconnect Google Drive</a></p><p><a href="/app">Back to archive</a></p>${active ? '<script>setTimeout(()=>location.reload(),10000)</script>' : ""}${pickerReady ? pickerScript() : ""}`));
    } catch (error) { next(error); }
  });

  app.get("/drive/folders/:folderId/reconciliation", requireMember, async (request, response, next) => {
    try {
      const folderId = String(request.params.folderId);
      const folder = await data!.getAttachedFolder(request.session.userId!, folderId);
      if (!folder) return response.status(404).json({ error: "folder_not_found" });
      const requested = String(request.query.category ?? "matched");
      const category = requested === "ambiguous" || requested === "unmatched" ? requested : "matched";
      const pageNumber = Math.max(1, Number.parseInt(String(request.query.page ?? "1"), 10) || 1);
      const pageSize = category === "matched" ? 20 : 100;
      const review = await data!.getReconciliationReview(request.session.userId!, folderId, category, (pageNumber - 1) * pageSize, pageSize);
      const tabs = (["matched", "ambiguous", "unmatched"] as const).map((value) => `<a href="?category=${value}">${value === "matched" ? "Random matched sample" : value[0]!.toUpperCase() + value.slice(1)}</a>`).join(" · ");
      const rows = review.items.map((item) => `<tr><td>${escapeHtml(item.relativePath || item.name)}</td><td>${escapeHtml(item.mimeType)}</td><td>${item.sizeBytes ?? "—"}</td><td>${escapeHtml(item.matchMethod ?? category)}</td><td>${item.legacyPaths.length ? item.legacyPaths.map(escapeHtml).join("<br>") : "No legacy candidate"}</td></tr>`).join("");
      const next = category !== "matched" && pageNumber * pageSize < review.total ? ` <a href="?category=${category}&page=${pageNumber + 1}">Next page</a>` : "";
      const previous = category !== "matched" && pageNumber > 1 ? `<a href="?category=${category}&page=${pageNumber - 1}">Previous page</a> ` : "";
      return response.type("html").send(page(`<p class="eyebrow">Reconciliation review</p><h1>${escapeHtml(folder.name)}</h1><p>${tabs}</p><p>Showing ${review.items.length} of ${review.total} ${category} items.${category === "matched" ? " Refresh this page for another random sample." : ""}</p><table><thead><tr><th>Drive path</th><th>Type</th><th>Bytes</th><th>Result</th><th>Legacy path candidates</th></tr></thead><tbody>${rows}</tbody></table><p>${previous}${next}</p><p><a href="/drive/folders">Back to photo folders</a></p>`));
    } catch (error) { next(error); }
  });

  app.get("/api/admin/members", requireAdministrator, async (_request, response, next) => {
    try { response.json({ members: await data!.listApplicationMembers() }); }
    catch (error) { next(error); }
  });

  app.post("/api/admin/members", requireAdministrator, async (request, response, next) => {
    const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const role = request.body.role === "administrator" ? "administrator" : "member";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: "valid_email_required" });
    try {
      const member = await data!.addApplicationMember(email, role, request.session.userId!);
      return request.is("application/x-www-form-urlencoded")
        ? response.redirect(303, "/admin/members")
        : response.status(201).json(member);
    } catch (error) { next(error); }
  });

  app.get("/admin/members", requireAdministrator, async (_request, response, next) => {
    try {
      const members = await data!.listApplicationMembers();
      const rows = members.map((member) => `<tr><td>${escapeHtml(member.email)}</td><td>${member.role}</td><td>${member.joined ? "Joined" : "Invited"}</td></tr>`).join("");
      response.type("html").send(page(`<p class="eyebrow">Administration</p><h1>Application members</h1><p>Only listed email addresses may enter after Google verifies their identity.</p><form method="post" action="/api/admin/members"><label>Email <input required type="email" name="email"></label><label>Access <select name="role"><option value="member">Member</option><option value="administrator">Administrator</option></select></label><button type="submit">Add member</button></form><table><thead><tr><th>Email</th><th>Access</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table><p><a href="/app">Back to archive</a></p>`));
    } catch (error) { next(error); }
  });

  app.get("/app", requireMember, async (request, response, next) => {
    try {
      const isAdmin = await data!.getApplicationRole(request.session.userId!) === "administrator";
      const driveConnected = await data!.hasDriveConnection(request.session.userId!);
      return response.type("html").send(page(`<p class="eyebrow">Private family archive</p><h1>Your photographs</h1><p>You are signed in. Archives shared with you will appear here.</p><p>${driveConnected ? '<a class="button" href="/drive/folders">Choose photo folders</a>' : '<a class="button" href="/drive/connect">Connect Google Drive</a>'}</p>${isAdmin ? '<p><a href="/admin/members">Manage application members</a></p>' : ""}<form method="post" action="/auth/logout"><button type="submit" class="secondary">Sign out</button></form>`));
    } catch (error) { next(error); }
  });

  app.get("/", (request, response) => {
    if (request.session.userId) return response.redirect("/app");
    return response.type("html").send(page(`<p class="eyebrow">Private family archive</p><h1>Keep the story with the photograph.</h1><p>A quiet place for family photographs, names, memories, and connections across generations.</p><a class="button" href="/auth/google">Continue with Google</a><p class="muted">Sign-in requests your name and email only. Google Drive access is separate and optional.</p>`));
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error);
    response.status(500).json({ error: "internal_error" });
  });

  return app;
}

function page(content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Family Photo Archive</title><style>body{font:18px system-ui;max-width:48rem;margin:12vh auto;padding:0 1.5rem;color:#29251f;background:#f3eee5}main{background:#fff;padding:clamp(2rem,6vw,4rem);border-radius:1.2rem;box-shadow:0 18px 50px #352d2018}h1{font:700 clamp(2.5rem,7vw,4.6rem)/1.05 Georgia,serif;margin:.25rem 0 1.5rem;max-width:12ch}p,li{line-height:1.6}.eyebrow{color:#765b38;font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.muted{color:#6d655b;font-size:.88rem;margin-top:1.5rem}.button,button{display:inline-block;border:0;border-radius:.6rem;padding:.85rem 1.15rem;background:#493a29;color:white;font:600 .95rem system-ui;text-decoration:none;cursor:pointer}.secondary{background:#e9e0d4;color:#493a29}form{display:flex;gap:.75rem;flex-wrap:wrap;align-items:end;margin:2rem 0}form.inline{display:inline;margin-left:.6rem}form.inline button{padding:.45rem .7rem}label{display:grid;gap:.35rem;font-size:.85rem;font-weight:700}input,select{font:inherit;padding:.65rem;border:1px solid #b9aa96;border-radius:.4rem}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.7rem;border-bottom:1px solid #e9e0d4;font-size:.9rem}</style></head><body><main>${content}</main></body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

function scanStatus(job: DriveScanJob | null) {
  if (!job) return "";
  if (job.status === "pending") return "Scan queued.";
  if (job.status === "running") return `Scanning: ${job.foldersScanned} folders, ${job.itemsDiscovered} items found.`;
  if (job.status === "completed") return `Last scan completed: ${job.matchedItems ?? 0} matched, ${job.unmatchedItems ?? 0} unmatched, ${job.ambiguousItems ?? 0} ambiguous.`;
  return `Last scan failed: ${escapeHtml(job.errorMessage ?? "unknown error")}.`;
}

function pickerScript() {
  return `<script src="https://apis.google.com/js/api.js"></script><script>
const button=document.getElementById("choose-folder"),message=document.getElementById("picker-message");
button.addEventListener("click",async()=>{
  button.disabled=true; message.textContent="Opening Google Drive…";
  try {
    const response=await fetch("/api/drive/picker");
    if(!response.ok) throw new Error("Google Drive connection is unavailable.");
    const config=await response.json();
    gapi.load("picker",{callback:()=>{
      const view=new google.picker.DocsView(google.picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMode(google.picker.DocsViewMode.LIST);
      new google.picker.PickerBuilder().addView(view).setSelectableMimeTypes("application/vnd.google-apps.folder").setOAuthToken(config.accessToken).setDeveloperKey(config.developerKey).setAppId(config.appId).setOrigin(window.location.origin).setCallback(async data=>{
        if(data.action===google.picker.Action.PICKED){
          const folder=data.docs[0]; message.textContent="Attaching "+folder.name+"…";
          const saved=await fetch("/api/drive/folders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({folderId:folder.id})});
          if(!saved.ok) return message.textContent="That folder could not be attached.";
          window.location.reload();
        } else if(data.action===google.picker.Action.CANCEL){ button.disabled=false; message.textContent=""; }
      }).build().setVisible(true);
      button.disabled=false;
    }});
  } catch(error){ button.disabled=false; message.textContent=error.message; }
});
</script>`;
}
