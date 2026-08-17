import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";

test("production refuses to start without required secrets", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production", PORT: "3000", APP_ORIGIN: "https://photos.example.com" }), /DATABASE_URL/);
});

test("production accepts the complete deployment environment", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    PORT: "10000",
    APP_ORIGIN: "https://photos.example.com",
    DATABASE_URL: "postgresql://example.invalid/photos",
    SESSION_SECRET: "a-secure-session-secret-with-32-characters",
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    BOOTSTRAP_ADMIN_EMAIL: "ADMIN@EXAMPLE.COM",
  });
  assert.equal(config.bootstrapAdminEmail, "admin@example.com");
});

test("application origin must be an origin without a path", () => {
  assert.throws(() => loadConfig({ APP_ORIGIN: "https://photos.example.com/path" }), /APP_ORIGIN/);
});

test("copied Google credentials discard surrounding whitespace", () => {
  const config = loadConfig({
    GOOGLE_CLIENT_ID: "  client-id\r\n",
    GOOGLE_CLIENT_SECRET: "\tclient-secret\n",
  });
  assert.equal(config.googleClientId, "client-id");
  assert.equal(config.googleClientSecret, "client-secret");
});
