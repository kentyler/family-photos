import "express-session";

declare module "express-session" {
  interface SessionData {
    userId: string;
    oidc?: {
      state: string;
      codeVerifier: string;
    };
    driveOauth?: {
      state: string;
      codeVerifier: string;
    };
  }
}
