import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import type { AppConfig } from "./config.js";
import { createPostgresDataStore, type DataStore } from "./data.js";
import { createGoogleIdentityClient, type IdentityClient } from "./oidc.js";

export type AppDependencies = { data?: DataStore; identity?: IdentityClient };

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
      return response.type("html").send(page(`<p class="eyebrow">Private family archive</p><h1>Your photographs</h1><p>You are signed in. Archives shared with you will appear here.</p>${isAdmin ? '<p><a href="/admin/members">Manage application members</a></p>' : ""}<form method="post" action="/auth/logout"><button type="submit" class="secondary">Sign out</button></form>`));
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Family Photo Archive</title><style>body{font:18px system-ui;max-width:48rem;margin:12vh auto;padding:0 1.5rem;color:#29251f;background:#f3eee5}main{background:#fff;padding:clamp(2rem,6vw,4rem);border-radius:1.2rem;box-shadow:0 18px 50px #352d2018}h1{font:700 clamp(2.5rem,7vw,4.6rem)/1.05 Georgia,serif;margin:.25rem 0 1.5rem;max-width:12ch}p{line-height:1.6}.eyebrow{color:#765b38;font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.muted{color:#6d655b;font-size:.88rem;margin-top:1.5rem}.button,button{display:inline-block;border:0;border-radius:.6rem;padding:.85rem 1.15rem;background:#493a29;color:white;font:600 .95rem system-ui;text-decoration:none;cursor:pointer}.secondary{background:#e9e0d4;color:#493a29}form{display:flex;gap:.75rem;flex-wrap:wrap;align-items:end;margin:2rem 0}label{display:grid;gap:.35rem;font-size:.85rem;font-weight:700}input,select{font:inherit;padding:.65rem;border:1px solid #b9aa96;border-radius:.4rem}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.7rem;border-bottom:1px solid #e9e0d4;font-size:.9rem}</style></head><body><main>${content}</main></body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}
