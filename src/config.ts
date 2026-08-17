export type AppConfig = {
  nodeEnv: string;
  port: number;
  databaseUrl?: string;
  sessionSecret?: string;
};

export function loadConfig(env = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be valid");

  if (nodeEnv === "production") {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required in production");
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters in production");
    }
  }

  return { nodeEnv, port, databaseUrl: env.DATABASE_URL, sessionSecret: env.SESSION_SECRET };
}
