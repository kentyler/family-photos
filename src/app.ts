import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { Readable } from "node:stream";
import type { AppConfig } from "./config.js";
import { createPostgresDataStore, type DataStore, type DriveScanJob, type IndexedDriveFolder } from "./data.js";
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
        const indexedFolders: IndexedDriveFolder[] = [];
        while (pending.length) {
          const { driveId: parentDriveId, relativePath: parentPath } = pending.shift()!;
          if (visited.has(parentDriveId)) continue;
          visited.add(parentDriveId);
          for (const item of await driveAuthorization.listChildren(accessToken, parentDriveId)) {
            if (item.mimeType === "application/vnd.google-apps.folder") {
              const relativePath = parentPath ? `${parentPath}/${item.name}` : item.name;
              indexedFolders.push({ driveFolderId: item.id, parentDriveId, name: item.name, relativePath, modifiedTime: item.modifiedTime });
              pending.push({ driveId: item.id, relativePath });
            }
            else if (item.mimeType.startsWith("image/") || item.mimeType.startsWith("video/")) indexed.push({ driveFileId: item.id, parentDriveId, name: item.name, mimeType: item.mimeType, relativePath: parentPath ? `${parentPath}/${item.name}` : item.name, md5Checksum: item.md5Checksum, modifiedTime: item.modifiedTime, sizeBytes: item.sizeBytes });
          }
          if (visited.size % 25 === 0) await data!.updateDriveScanJob(jobId, { foldersScanned: visited.size, itemsDiscovered: indexed.length });
        }
        await data!.replaceIndexedDriveItems(userId, folder.id, indexed, indexedFolders);
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
        ? `<ul>${foldersWithCounts.map(({ folder, count, matched, job }) => `<li><strong>${escapeHtml(folder.name)}</strong> — ${count} indexed, ${matched} matched to the legacy catalog. ${scanStatus(job)} ${(job?.status === "pending" || job?.status === "running") ? "" : `<form class="inline" method="post" action="/api/drive/folders/${folder.id}/rescan"><button class="secondary" type="submit">${count ? "Rescan and reconcile" : "Scan and reconcile"}</button></form>${count ? ` <a class="button" href="/drive/folders/${folder.id}/browse">Browse photos</a> <a href="/drive/folders/${folder.id}/reconciliation">Review reconciliation</a>` : ""}`}</li>`).join("")}</ul>`
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

  app.get("/drive/folders/:folderId/browse", requireMember, async (request, response, next) => {
    try {
      const folderId = String(request.params.folderId);
      const folder = await data!.getAttachedFolder(request.session.userId!, folderId);
      if (!folder) return response.status(404).json({ error: "folder_not_found" });
      const parent = typeof request.query.parent === "string" ? request.query.parent : folder.driveFolderId;
      const pageNumber = Math.max(1, Number.parseInt(String(request.query.page ?? "1"), 10) || 1);
      const pageSize = 60;
      const browserPage = await data!.getDriveBrowserPage(request.session.userId!, folderId, parent, (pageNumber - 1) * pageSize, pageSize);
      if (!browserPage) return response.status(404).json({ error: "folder_not_found" });
      const needsFolderIndex = parent === folder.driveFolderId && browserPage.total === 0 && await data!.countIndexedDriveItems(request.session.userId!, folderId) > 0;
      const cards = browserPage.items.map((item) => item.mimeType === "application/vnd.google-apps.folder"
        ? `<a class="photo-card folder-card" href="?parent=${encodeURIComponent(item.driveFileId)}"><span class="folder-icon">📁</span><strong>${escapeHtml(item.name)}</strong></a>`
        : item.mimeType.startsWith("image/")
          ? `<button class="photo-card image-card" data-id="${escapeHtml(item.driveFileId)}" data-name="${escapeHtml(item.name)}" data-full="/api/drive/folders/${folderId}/files/${encodeURIComponent(item.driveFileId)}/content"><img loading="lazy" src="/api/drive/folders/${folderId}/files/${encodeURIComponent(item.driveFileId)}/thumbnail" alt=""><span class="thumbnail-caption" title="${escapeHtml(item.caption ?? item.name)}">${escapeHtml(item.caption ?? item.name)}</span></button>`
          : `<div class="photo-card file-card"><span class="folder-icon">${item.mimeType.startsWith("video/") ? "🎞️" : "📄"}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.mimeType)}</small></div>`).join("");
      const back = browserPage.parentDriveId ? `<a href="?parent=${encodeURIComponent(browserPage.parentDriveId)}">← Parent folder</a>` : `<a href="/drive/folders">← Photo folders</a>`;
      const previous = pageNumber > 1 ? `<a href="?parent=${encodeURIComponent(parent)}&page=${pageNumber - 1}">Previous</a>` : "";
      const following = pageNumber * pageSize < browserPage.total ? `<a href="?parent=${encodeURIComponent(parent)}&page=${pageNumber + 1}">Next</a>` : "";
      return response.type("html").send(page(`<div class="browser-head"><div><p class="eyebrow">Photo browser</p><h1>${escapeHtml(browserPage.parentName)}</h1></div><p>${back}</p></div>${needsFolderIndex ? '<p>This collection was scanned before folder navigation was added. Return to Photo folders and run <strong>Rescan and reconcile</strong> once.</p>' : `<p>${browserPage.total} items</p><div class="photo-grid">${cards || "<p>This folder is empty.</p>"}</div><p class="pager">${previous} ${following}</p>`}<dialog id="photo-viewer" data-folder-id="${folderId}"><button class="viewer-close" aria-label="Close">×</button><div class="viewer-layout"><section class="viewer-photo"><figure><div class="image-stage"><img alt=""><canvas class="subject-canvas"></canvas></div><figcaption class="viewer-caption"></figcaption></figure><button class="viewer-prev" aria-label="Previous photo">←</button><button class="viewer-next" aria-label="Next photo">→</button></section><form class="viewer-text"><p class="eyebrow">About this photograph</p><h2 class="viewer-name"></h2><label>Caption<input required name="caption" maxlength="500" placeholder="A short description"></label><label>Story or notes<textarea name="notes" maxlength="50000" rows="8" placeholder="Who, where, when, and what your family remembers…"></textarea></label><div><button type="submit">Save text</button> <span class="viewer-status muted" role="status"></span></div><section class="subjects"><div class="subjects-head"><strong>People and things</strong><button class="secondary mark-subject" type="button">Mark a subject</button></div><p class="subject-help muted">Draw a box around a face, person, or thing.</p><div class="subject-editor" hidden><label>Type<select class="subject-type"><option value="person">Person</option><option value="thing">Thing</option></select></label><label class="person-choice-label">Known as<input class="person-choice" list="person-aliases" maxlength="200" placeholder="Search aliases or enter a new person"><datalist id="person-aliases"></datalist></label><label class="thing-label" hidden>Thing<input class="thing-name" maxlength="200" placeholder="For example: wedding cake"></label><div><button class="save-subject" type="button">Save subject</button> <button class="secondary cancel-subject" type="button">Cancel</button></div><p class="subject-status muted" role="status"></p></div><ul class="subject-list"></ul></section></form></div></dialog>${viewerScript()}`));
    } catch (error) { next(error); }
  });

  app.get("/api/drive/folders/:folderId/files/:fileId/:variant", requireMember, async (request, response, next) => {
    try {
      const folderId = String(request.params.folderId), fileId = String(request.params.fileId), variant = String(request.params.variant);
      if (variant !== "thumbnail" && variant !== "content") return response.status(404).end();
      if (!await data!.canAccessIndexedDriveFile(request.session.userId!, folderId, fileId)) return response.status(404).end();
      const accessToken = await getDriveAccessToken(request.session.userId!);
      if (!accessToken || !driveAuthorization) return response.status(409).json({ error: "drive_connection_required" });
      const driveResponse = await driveAuthorization.getFileResponse(accessToken, fileId, variant === "thumbnail");
      if (!driveResponse.ok || !driveResponse.body) return response.status(driveResponse.status).end();
      response.setHeader("content-type", driveResponse.headers.get("content-type") ?? "application/octet-stream");
      response.setHeader("cache-control", "private, max-age=300");
      Readable.fromWeb(driveResponse.body as any).pipe(response);
    } catch (error) { next(error); }
  });

  app.get("/api/drive/folders/:folderId/photos/:fileId/text", requireMember, async (request, response, next) => {
    try {
      const record = await data!.getPhotoText(request.session.userId!, String(request.params.folderId), String(request.params.fileId));
      return record ? response.json(record) : response.status(404).json({ error: "photo_not_found" });
    } catch (error) { next(error); }
  });

  app.put("/api/drive/folders/:folderId/photos/:fileId/text", requireMember, async (request, response, next) => {
    const caption = typeof request.body.caption === "string" ? request.body.caption.trim() : "";
    const notes = typeof request.body.notes === "string" ? request.body.notes.trim() : "";
    if (!caption || caption.length > 500 || notes.length > 50000) return response.status(400).json({ error: "valid_photo_text_required" });
    try {
      const record = await data!.savePhotoText(request.session.userId!, String(request.params.folderId), String(request.params.fileId), caption, notes);
      return record ? response.json(record) : response.status(404).json({ error: "photo_not_found" });
    } catch (error) { next(error); }
  });

  app.get("/api/people/aliases", requireMember, async (request, response, next) => {
    try { response.json({ aliases: await data!.listPersonAliasChoices(request.session.userId!) }); }
    catch (error) { next(error); }
  });

  app.post("/api/people", requireMember, async (request, response, next) => {
    const alias = typeof request.body.alias === "string" ? request.body.alias.trim() : "";
    if (!alias || alias.length > 200) return response.status(400).json({ error: "valid_alias_required" });
    try { response.status(201).json(await data!.createPersonWithAlias(request.session.userId!, alias)); }
    catch (error) { next(error); }
  });

  app.post("/api/people/:personId/aliases", requireMember, async (request, response, next) => {
    const alias = typeof request.body.alias === "string" ? request.body.alias.trim() : "";
    if (!alias || alias.length > 200) return response.status(400).json({ error: "valid_alias_required" });
    try {
      const created = await data!.addPersonAlias(request.session.userId!, String(request.params.personId), alias);
      return created ? response.status(201).json(created) : response.status(404).json({ error: "person_not_found" });
    } catch (error) { next(error); }
  });

  app.get("/api/drive/folders/:folderId/photos/:fileId/subjects", requireMember, async (request, response, next) => {
    try {
      const regions = await data!.listPhotoSubjectRegions(request.session.userId!, String(request.params.folderId), String(request.params.fileId));
      return regions ? response.json({ regions }) : response.status(404).json({ error: "photo_not_found" });
    } catch (error) { next(error); }
  });

  app.post("/api/drive/folders/:folderId/photos/:fileId/subjects", requireMember, async (request, response, next) => {
    const subjectType = request.body.subjectType === "thing" ? "thing" : "person";
    const label = subjectType === "thing" && typeof request.body.label === "string" ? request.body.label.trim() : null;
    const personId = subjectType === "person" && typeof request.body.personId === "string" ? request.body.personId : null;
    const aliasId = subjectType === "person" && typeof request.body.aliasId === "string" ? request.body.aliasId : null;
    const coordinates = ["x", "y", "width", "height"].map((key) => Number(request.body[key]));
    const [x, y, width, height] = coordinates;
    if ((subjectType === "thing" && (!label || label.length > 200)) || (subjectType === "person" && (!personId || !aliasId)) || coordinates.some((value) => !Number.isFinite(value)) || x! < 0 || y! < 0 || width! <= 0 || height! <= 0 || x! + width! > 1.000001 || y! + height! > 1.000001) return response.status(400).json({ error: "valid_subject_region_required" });
    try {
      const region = await data!.createPhotoSubjectRegion(request.session.userId!, String(request.params.folderId), String(request.params.fileId), subjectType, label, personId, aliasId, x!, y!, width!, height!);
      return region ? response.status(201).json(region) : response.status(404).json({ error: "photo_not_found" });
    } catch (error) { next(error); }
  });

  app.delete("/api/drive/folders/:folderId/photos/:fileId/subjects/:regionId", requireMember, async (request, response, next) => {
    try {
      return await data!.deletePhotoSubjectRegion(request.session.userId!, String(request.params.folderId), String(request.params.fileId), String(request.params.regionId))
        ? response.status(204).end() : response.status(404).json({ error: "subject_region_not_found" });
    } catch (error) { next(error); }
  });

  app.get("/api/people/search", requireMember, async (request, response, next) => {
    const query = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 200) : "";
    try { response.json({ people: query ? await data!.searchPeople(request.session.userId!, query, 30) : [] }); }
    catch (error) { next(error); }
  });

  app.get("/api/people/:personId/explorer", requireMember, async (request, response, next) => {
    try {
      const person = await data!.getPersonExplorer(request.session.userId!, String(request.params.personId));
      return person ? response.json(person) : response.status(404).json({ error: "person_not_found" });
    } catch (error) { next(error); }
  });

  app.get("/people", requireMember, async (_request, response) => response.type("html").send(page(`
    <style>.people-explorer{display:grid;grid-template-columns:minmax(0,3fr) minmax(360px,2fr);gap:1.5rem;min-height:70vh}.people-photos,.person-panel{min-width:0}.people-photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:1rem;max-height:68vh;overflow-y:auto}.person-photo{display:grid;gap:.4rem;padding:.55rem;background:#f3eee5;border-radius:.6rem;color:#29251f;text-decoration:none;font-size:.85rem}.person-photo img{width:100%;height:130px;object-fit:cover;border-radius:.35rem}.person-search{display:flex;align-items:end;margin:0 0 1rem}.person-search label{flex:1}.search-results,.family-list{display:grid;gap:.4rem;padding:0;list-style:none}.person-link{width:100%;text-align:left;background:#f3eee5;color:#493a29}.person-panel section{border-top:1px solid #e9e0d4;margin-top:1rem;padding-top:.7rem}.person-aliases{color:#6d655b}@media(max-width:800px){.people-explorer{grid-template-columns:1fr}.people-photo-grid{max-height:none}}</style>
    <p class="eyebrow">Family explorer</p><div class="people-explorer"><section class="people-photos"><h1 class="photo-heading">Choose a person</h1><p class="photo-summary">Search by any known name or alias.</p><div class="people-photo-grid"></div></section><aside class="person-panel"><form class="person-search"><label>Find a person<input class="person-query" maxlength="200" placeholder="Name or alias"></label><button type="submit">Search</button></form><ul class="search-results"></ul><div class="person-detail" hidden><h2 class="person-name"></h2><p class="person-aliases"></p><section><strong>Parents</strong><ul class="family-list parents"></ul></section><section><strong>Marriages</strong><ul class="family-list spouses"></ul></section><section><strong>Children</strong><ul class="family-list children"></ul></section></div><p><a href="/app">Back to archive</a></p></aside></div>
    <script>const searchForm=document.querySelector(".person-search"),query=document.querySelector(".person-query"),results=document.querySelector(".search-results"),detail=document.querySelector(".person-detail"),photoGrid=document.querySelector(".people-photo-grid"),heading=document.querySelector(".photo-heading"),summary=document.querySelector(".photo-summary");function personButton(person){const li=document.createElement("li"),button=document.createElement("button");button.type="button";button.className="person-link";button.textContent=person.primaryName+(person.aliases.length>1?" — "+person.aliases.filter(a=>a!==person.primaryName).join(", "):"")+"    View →";button.addEventListener("click",()=>focusPerson(person.id));li.append(button);return li}function family(target,people){target.replaceChildren(...(people.length?people.map(personButton):[Object.assign(document.createElement("li"),{textContent:"None recorded"})]))}async function focusPerson(id){heading.textContent="Loading person…";summary.textContent="";const response=await fetch("/api/people/"+encodeURIComponent(id)+"/explorer");if(!response.ok){heading.textContent="That person could not be opened";summary.textContent="Please try again or choose another search result.";return}const person=await response.json();history.replaceState(null,"","/people?person="+encodeURIComponent(id));detail.hidden=false;document.querySelector(".person-name").textContent=person.primaryName;document.querySelector(".person-aliases").textContent=person.aliases.length>1?"Also known as: "+person.aliases.filter(a=>a!==person.primaryName).join(", "):"";family(document.querySelector(".parents"),person.parents);family(document.querySelector(".spouses"),person.spouses);family(document.querySelector(".children"),person.children);heading.textContent=person.primaryName;summary.textContent=person.photos.length+" identified "+(person.photos.length===1?"photo":"photos");photoGrid.replaceChildren(...person.photos.map(photo=>{const link=document.createElement("a"),img=document.createElement("img"),caption=document.createElement("span");link.className="person-photo";link.href="/drive/folders/"+encodeURIComponent(photo.folderId)+"/browse?parent="+encodeURIComponent(photo.parentDriveId)+"&photo="+encodeURIComponent(photo.driveFileId);img.loading="lazy";img.src="/api/drive/folders/"+encodeURIComponent(photo.folderId)+"/files/"+encodeURIComponent(photo.driveFileId)+"/thumbnail";caption.textContent=photo.caption;link.append(img,caption);return link}))}searchForm.addEventListener("submit",async event=>{event.preventDefault();const value=query.value.trim();if(!value)return;const response=await fetch("/api/people/search?q="+encodeURIComponent(value)),data=await response.json();results.replaceChildren(...(data.people.length?data.people.map(personButton):[Object.assign(document.createElement("li"),{textContent:"No matching person"})]));if(data.people.length===1||data.people.filter(person=>person.aliases.some(alias=>alias.toLowerCase()===value.toLowerCase())).length===1){const exact=data.people.find(person=>person.aliases.some(alias=>alias.toLowerCase()===value.toLowerCase()))||data.people[0];focusPerson(exact.id)}});const initial=new URLSearchParams(location.search).get("person");if(initial)focusPerson(initial);</script>
  `)));

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
      return response.type("html").send(page(`<p class="eyebrow">Private family archive</p><h1>Your photographs</h1><p>You are signed in. Archives shared with you will appear here.</p><p>${driveConnected ? '<a class="button" href="/drive/folders">Choose photo folders</a>' : '<a class="button" href="/drive/connect">Connect Google Drive</a>'} <a class="button secondary" href="/people">Explore people and family</a></p>${isAdmin ? '<p><a href="/admin/members">Manage application members</a></p>' : ""}<form method="post" action="/auth/logout"><button type="submit" class="secondary">Sign out</button></form>`));
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Family Photo Archive</title><style>body{font:18px system-ui;max-width:80rem;margin:6vh auto;padding:0 1.5rem;color:#29251f;background:#f3eee5}main{background:#fff;padding:clamp(2rem,6vw,4rem);border-radius:1.2rem;box-shadow:0 18px 50px #352d2018}h1{font:700 clamp(2.5rem,7vw,4.6rem)/1.05 Georgia,serif;margin:.25rem 0 1.5rem;max-width:12ch}p,li{line-height:1.6}.eyebrow{color:#765b38;font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.muted{color:#6d655b;font-size:.88rem;margin-top:1.5rem}.button,button{display:inline-block;border:0;border-radius:.6rem;padding:.85rem 1.15rem;background:#493a29;color:white;font:600 .95rem system-ui;text-decoration:none;cursor:pointer}.secondary{background:#e9e0d4;color:#493a29}form{display:flex;gap:.75rem;flex-wrap:wrap;align-items:end;margin:2rem 0}form.inline{display:inline;margin-left:.6rem}form.inline button{padding:.45rem .7rem}label{display:grid;gap:.35rem;font-size:.85rem;font-weight:700;min-width:0}input,select,textarea{box-sizing:border-box;width:100%;min-width:0;font:inherit;padding:.65rem;border:1px solid #b9aa96;border-radius:.4rem}textarea{resize:vertical}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.7rem;border-bottom:1px solid #e9e0d4;font-size:.9rem}.browser-head{display:flex;justify-content:space-between;align-items:end;gap:1rem}.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:1rem}.photo-card{box-sizing:border-box;min-height:170px;width:100%;padding:.65rem;background:#f3eee5;color:#29251f;text-align:left;text-decoration:none;display:flex;flex-direction:column;gap:.45rem;border-radius:.7rem;overflow:hidden}.photo-card img{width:100%;height:130px;object-fit:cover;border-radius:.35rem;background:#ddd}.photo-card span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.photo-card small{color:#6d655b}.folder-card{justify-content:center;align-items:center;text-align:center}.folder-icon{font-size:3rem}.pager{display:flex;justify-content:space-between}dialog{box-sizing:border-box;border:0;border-radius:1rem;background:#171512;color:white;width:min(98vw,1600px);max-width:none;padding:0;overflow:hidden}dialog::backdrop{background:#000c}.viewer-layout{display:grid;grid-template-columns:minmax(0,3fr) minmax(460px,2fr);min-height:min(88vh,900px)}.viewer-photo{position:relative;display:grid;align-items:center;justify-items:start;padding:1.25rem;background:#171512;min-width:0}.viewer-photo figure{display:grid;gap:.75rem;justify-items:center;margin:0;max-width:100%}.image-stage{position:relative;display:inline-block;line-height:0;max-width:100%}.viewer-photo img{display:block;max-width:100%;max-height:78vh}.subject-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.subject-canvas.drawing{pointer-events:auto;cursor:crosshair;touch-action:none}.viewer-caption{max-width:65ch;text-align:center;color:#f5f0e8;font:1.1rem Georgia,serif}.viewer-text{box-sizing:border-box;min-width:0;display:flex;flex-direction:column;align-items:stretch;gap:.8rem;margin:0;padding:2rem;background:#fff;color:#29251f;overflow-x:hidden;overflow-y:auto;max-height:88vh}.viewer-text h2{font:700 1.5rem Georgia,serif;margin:0;overflow-wrap:anywhere}.viewer-text .eyebrow{margin:0}.viewer-text textarea{min-height:8rem}.subjects{min-width:0;border-top:1px solid #e9e0d4;padding-top:1rem}.subjects-head{display:flex;justify-content:space-between;align-items:center;gap:.5rem;flex-wrap:wrap}.subjects-head button{padding:.5rem .7rem}.subject-help{margin:.4rem 0}.subject-editor{box-sizing:border-box;min-width:0;display:grid;gap:.6rem;padding:.8rem;background:#f3eee5;border-radius:.6rem}.subject-editor>div{display:flex;gap:.5rem;flex-wrap:wrap}.subject-list{display:grid;gap:.4rem;padding:0;margin:.8rem 0;list-style:none}.subject-list li{display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.45rem .6rem;background:#f3eee5;border-radius:.4rem;font-size:.85rem}.subject-list button{padding:.25rem .45rem;background:transparent;color:#765b38}.viewer-close,.viewer-prev,.viewer-next{position:absolute;z-index:2;background:#fff;color:#171512;padding:.5rem .75rem}.viewer-close{right:1rem;top:1rem}.viewer-prev{left:1rem;top:50%}.viewer-next{right:1rem;top:50%}@media(max-width:900px){main{padding:1.2rem}.photo-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.browser-head{display:block}.viewer-layout{grid-template-columns:1fr;max-height:94vh;overflow:auto}.viewer-photo{min-height:42vh;justify-items:center}.viewer-photo img{max-height:42vh}.viewer-text{padding:1.25rem;max-height:none}.viewer-close{position:fixed}}</style></head><body><main>${content}</main></body></html>`;
}

function viewerScript() {
  return `<script>
const cards=[...document.querySelectorAll(".image-card")],viewer=document.getElementById("photo-viewer"),image=viewer.querySelector(".image-stage img"),canvas=viewer.querySelector(".subject-canvas"),ctx=canvas.getContext("2d"),name=viewer.querySelector(".viewer-name"),displayCaption=viewer.querySelector(".viewer-caption"),form=viewer.querySelector(".viewer-text"),caption=form.elements.caption,notes=form.elements.notes,status=viewer.querySelector(".viewer-status"),folderId=viewer.dataset.folderId,markButton=viewer.querySelector(".mark-subject"),editor=viewer.querySelector(".subject-editor"),subjectType=viewer.querySelector(".subject-type"),personChoice=viewer.querySelector(".person-choice"),personChoiceLabel=viewer.querySelector(".person-choice-label"),thingLabel=viewer.querySelector(".thing-label"),thingName=viewer.querySelector(".thing-name"),subjectStatus=viewer.querySelector(".subject-status"),subjectList=viewer.querySelector(".subject-list"),aliasOptions=viewer.querySelector("#person-aliases");
form.style.flexWrap="nowrap";
let current=0,loadToken=0,regions=[],aliases=[],pendingRect=null,drawing=false,start=null,marksVisible=true;
const marksButton=document.createElement("button");marksButton.type="button";marksButton.className="secondary toggle-marks";marksButton.textContent="Hide marks";markButton.before(marksButton,document.createTextNode(" "));
const viewerStyle=document.createElement("style");viewerStyle.textContent="#photo-viewer [hidden]{display:none!important}#photo-viewer .subject-list{max-height:15rem;overflow-y:auto;overscroll-behavior:contain;padding-right:.25rem}#photo-viewer .subjects{min-height:0}";document.head.append(viewerStyle);const subjectHelp=viewer.querySelector(".subject-help");
const aliasOwnerLabel=document.createElement("label"),aliasOwner=document.createElement("select");aliasOwnerLabel.textContent="If this is a new alias";aliasOwner.className="alias-owner";aliasOwnerLabel.append(aliasOwner);personChoiceLabel.after(aliasOwnerLabel);
const photoBase=card=>"/api/drive/folders/"+encodeURIComponent(folderId)+"/photos/"+encodeURIComponent(card.dataset.id),textEndpoint=card=>photoBase(card)+"/text",subjectsEndpoint=card=>photoBase(card)+"/subjects";
function sizeCanvas(){const w=image.clientWidth,h=image.clientHeight;if(!w||!h)return;canvas.width=w;canvas.height=h;drawRegions()}
function drawRegions(){ctx.clearRect(0,0,canvas.width,canvas.height);if(!marksVisible)return;regions.forEach((region,index)=>{const x=region.x*canvas.width,y=region.y*canvas.height,w=region.width*canvas.width,h=region.height*canvas.height,color=region.subjectType==="person"?"#ffd166":"#67d5b5";ctx.strokeStyle=color;ctx.fillStyle=color+"33";ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);ctx.fillRect(x,y,w,h);ctx.font="12px system-ui";const label=region.label,tw=ctx.measureText(label).width;ctx.fillStyle="#171512dd";ctx.fillRect(x,Math.max(0,y-20),tw+10,20);ctx.fillStyle=color;ctx.fillText(label,x+5,Math.max(14,y-6))});if(pendingRect){ctx.strokeStyle="#fff";ctx.setLineDash([6,4]);ctx.strokeRect(pendingRect.x*canvas.width,pendingRect.y*canvas.height,pendingRect.width*canvas.width,pendingRect.height*canvas.height);ctx.setLineDash([])}}
function renderRegions(){subjectList.replaceChildren();regions.forEach((region,index)=>{const li=document.createElement("li"),text=document.createElement("span"),remove=document.createElement("button");text.textContent=(index+1)+". "+(region.subjectType==="person"?"Person: ":"Thing: ")+region.label;remove.type="button";remove.textContent="Remove";remove.addEventListener("click",async()=>{if(!confirm("Remove this marked region?"))return;const response=await fetch(subjectsEndpoint(cards[current])+"/"+encodeURIComponent(region.id),{method:"DELETE"});if(response.ok){regions=regions.filter(item=>item.id!==region.id);renderRegions();drawRegions()}});li.append(text,remove);subjectList.append(li)});if(!drawing)markButton.textContent=regions.length?"Mark another subject":"Mark a subject";subjectHelp.textContent=regions.length?regions.length+" marked "+(regions.length===1?"subject":"subjects")+". Draw another box or review the list below.":"Draw a box around a face, person, or thing.";drawRegions()}
async function loadRegions(card,token){const response=await fetch(subjectsEndpoint(card));if(!response.ok)throw new Error();const data=await response.json();if(token!==loadToken)return;regions=data.regions;renderRegions()}
function renderAliasChoices(){aliasOptions.replaceChildren(...aliases.map(choice=>{const option=document.createElement("option");option.value=choice.alias;return option}));const people=new Map;aliases.forEach(choice=>{const current=people.get(choice.personId);if(!current||choice.isPrimary)people.set(choice.personId,choice)});const fresh=document.createElement("option");fresh.value="";fresh.textContent="Create a new person";aliasOwner.replaceChildren(fresh,...[...people.values()].map(choice=>{const option=document.createElement("option");option.value=choice.personId;option.textContent="Add alias to "+choice.alias;return option}))}
async function loadAliases(){if(aliases.length)return;const response=await fetch("/api/people/aliases");if(!response.ok)return;aliases=(await response.json()).aliases;renderAliasChoices()}
function cancelDrawing(){drawing=false;start=null;pendingRect=null;canvas.classList.remove("drawing");editor.hidden=true;markButton.textContent=regions.length?"Mark another subject":"Mark a subject";subjectStatus.textContent="";drawRegions()}
markButton.addEventListener("click",()=>{if(drawing)return cancelDrawing();drawing=true;pendingRect=null;editor.hidden=true;canvas.classList.add("drawing");markButton.textContent="Cancel marking";subjectStatus.textContent="Drag a box on the photo."});
marksButton.addEventListener("click",()=>{marksVisible=!marksVisible;marksButton.textContent=marksVisible?"Hide marks":"Show marks";drawRegions()});
canvas.addEventListener("pointerdown",event=>{if(!drawing)return;canvas.setPointerCapture(event.pointerId);const rect=canvas.getBoundingClientRect();start={x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};pendingRect={x:start.x,y:start.y,width:0,height:0}});
canvas.addEventListener("pointermove",event=>{if(!start)return;const rect=canvas.getBoundingClientRect(),x=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y=Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));pendingRect={x:Math.min(start.x,x),y:Math.min(start.y,y),width:Math.abs(x-start.x),height:Math.abs(y-start.y)};drawRegions()});
canvas.addEventListener("pointerup",()=>{if(!start||!pendingRect)return;start=null;if(pendingRect.width*canvas.width<6||pendingRect.height*canvas.height<6){pendingRect=null;drawRegions();return}editor.hidden=false;subjectType.focus();subjectStatus.textContent="Describe the selected area."});
subjectType.addEventListener("change",()=>{const person=subjectType.value==="person";personChoiceLabel.hidden=!person;aliasOwnerLabel.hidden=!person;thingLabel.hidden=person;(person?personChoice:thingName).focus()});
viewer.querySelector(".cancel-subject").addEventListener("click",cancelDrawing);
viewer.querySelector(".save-subject").addEventListener("click",async()=>{if(!pendingRect)return;subjectStatus.textContent="Saving…";let payload={subjectType:subjectType.value,...pendingRect};if(subjectType.value==="person"){const value=personChoice.value.trim();if(!value)return subjectStatus.textContent="Choose or enter a name.";let choice=aliases.find(item=>item.alias.toLowerCase()===value.toLowerCase());if(!choice){const url=aliasOwner.value?"/api/people/"+encodeURIComponent(aliasOwner.value)+"/aliases":"/api/people",created=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({alias:value})});if(!created.ok)return subjectStatus.textContent="That person or alias could not be created.";choice=await created.json();aliases.push(choice);renderAliasChoices()}payload.personId=choice.personId;payload.aliasId=choice.aliasId}else{payload.label=thingName.value.trim();if(!payload.label)return subjectStatus.textContent="Enter a name for the thing."}const response=await fetch(subjectsEndpoint(cards[current]),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});if(!response.ok)return subjectStatus.textContent="The region could not be saved.";regions.push(await response.json());personChoice.value="";aliasOwner.value="";thingName.value="";cancelDrawing();renderRegions()});
async function show(index){current=(index+cards.length)%cards.length;const card=cards[current],token=++loadToken,thumbnailCaption=card.querySelector(".thumbnail-caption").textContent;cancelDrawing();regions=[];image.src=card.dataset.full;name.textContent=card.dataset.name;caption.value=thumbnailCaption;displayCaption.textContent=thumbnailCaption;notes.value="";status.textContent="Loading notes…";subjectList.replaceChildren();if(!viewer.open)viewer.showModal();loadAliases();loadRegions(card,token).catch(()=>{if(token===loadToken)subjectStatus.textContent="Marked subjects could not be loaded."});try{const response=await fetch(textEndpoint(card));if(!response.ok)throw new Error();const record=await response.json();if(token!==loadToken)return;caption.value=record.caption;displayCaption.textContent=record.caption;notes.value=record.notes;status.textContent=record.updatedAt?("Last saved by "+(record.updatedBy||"a family member")):"Default caption"}catch{if(token===loadToken)status.textContent="Notes could not be loaded."}}
image.addEventListener("load",sizeCanvas);new ResizeObserver(sizeCanvas).observe(image);cards.forEach((card,index)=>card.addEventListener("click",()=>show(index)));
form.addEventListener("submit",async event=>{event.preventDefault();const card=cards[current];status.textContent="Saving…";const response=await fetch(textEndpoint(card),{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({caption:caption.value,notes:notes.value})});if(response.ok){const record=await response.json(),thumbnailCaption=card.querySelector(".thumbnail-caption");caption.value=record.caption;displayCaption.textContent=record.caption;thumbnailCaption.textContent=record.caption;thumbnailCaption.title=record.caption;status.textContent="Saved"}else status.textContent="Could not save. Please try again."});
viewer.querySelector(".viewer-close").addEventListener("click",()=>viewer.close());viewer.querySelector(".viewer-prev").addEventListener("click",()=>show(current-1));viewer.querySelector(".viewer-next").addEventListener("click",()=>show(current+1));viewer.addEventListener("click",event=>{if(event.target===viewer)viewer.close()});document.addEventListener("keydown",event=>{if(!viewer.open||event.target.matches("input,textarea,select"))return;if(event.key==="Escape"&&drawing)cancelDrawing();else if(event.key==="ArrowLeft")show(current-1);else if(event.key==="ArrowRight")show(current+1)});
const requestedPhoto=new URLSearchParams(location.search).get("photo"),requestedIndex=cards.findIndex(card=>card.dataset.id===requestedPhoto);if(requestedIndex>=0)show(requestedIndex);
</script>`;
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
