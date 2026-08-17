export type AppConfig = {
  nodeEnv: string;
  port: number;
  databaseUrl?: string;
  sessionSecret?: string;
  appOrigin: string;
  googleClientId?: string;
  googleClientSecret?: string;
  bootstrapAdminEmail?: string;
};

export function loadConfig(env = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const port = Number(env.PORT ?? 3000);
  const appOrigin = env.APP_ORIGIN?.trim() || `http://localhost:${port}`;
  const googleClientId = env.GOOGLE_CLIENT_ID?.trim() || undefined;
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim() || undefined;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be valid");
  if (!URL.canParse(appOrigin) || new URL(appOrigin).pathname !== "/") throw new Error("APP_ORIGIN must be an origin URL");

  if (nodeEnv === "production") {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required in production");
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters in production");
    }
    if (!googleClientId || !googleClientSecret) {
      throw new Error("Google identity credentials are required in production");
    }
  }

  return {
    nodeEnv,
    port,
    databaseUrl: env.DATABASE_URL,
    sessionSecret: env.SESSION_SECRET,
    appOrigin,
    googleClientId,
    googleClientSecret,
    bootstrapAdminEmail: env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase(),
  };
}
