import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import type { AppConfig } from "./config.js";

export function createApp(config: AppConfig) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  if (config.databaseUrl && config.sessionSecret) {
    const PgStore = connectPgSimple(session);
    app.use(session({
      name: "family.sid",
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: new PgStore({ pool: new pg.Pool({ connectionString: config.databaseUrl }), tableName: "user_sessions" }),
      cookie: { httpOnly: true, sameSite: "lax", secure: config.nodeEnv === "production", maxAge: 30 * 24 * 60 * 60 * 1000 },
    }));
  }

  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.get("/api/auth/status", (request, response) => {
    response.json({ authenticated: Boolean(request.session?.userId) });
  });
  app.get("/api/me", (request, response) => {
    if (!request.session?.userId) return response.status(401).json({ error: "authentication_required" });
    return response.json({ id: request.session.userId });
  });
  app.get("/", (_request, response) => response.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Family Photo Archive</title><style>body{font:18px system-ui;max-width:48rem;margin:15vh auto;padding:0 1.5rem;color:#29251f;background:#faf7f0}main{background:white;padding:3rem;border-radius:1rem;box-shadow:0 12px 40px #352d2014}h1{font-family:Georgia,serif;font-size:2.6rem;margin-top:0}p{line-height:1.6}.muted{color:#6d655b}</style></head>
<body><main><h1>Family Photo Archive</h1><p>A private place for family photographs and the stories that belong with them.</p><p class="muted">Google sign-in is being prepared. Drive access will remain a separate permission.</p></main></body></html>`));

  return app;
}
