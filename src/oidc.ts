import * as oidc from "openid-client";
import type { IdentityProfile } from "./data.js";

export interface IdentityClient {
  begin(): Promise<{ url: string; state: string; codeVerifier: string }>;
  finish(currentUrl: URL, expectedState: string, codeVerifier: string): Promise<IdentityProfile>;
}

export function createGoogleIdentityClient(options: {
  clientId: string;
  clientSecret: string;
  appOrigin: string;
}): IdentityClient {
  const redirectUri = new URL("/auth/google/callback", options.appOrigin).href;
  let configuration: Promise<oidc.Configuration> | undefined;
  const getConfiguration = () => configuration ??= oidc.discovery(
    new URL("https://accounts.google.com"),
    options.clientId,
    options.clientSecret,
  );

  return {
    async begin() {
      const codeVerifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const url = oidc.buildAuthorizationUrl(await getConfiguration(), {
        redirect_uri: redirectUri,
        scope: "openid email profile",
        code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: "S256",
        state,
      });
      return { url: url.href, state, codeVerifier };
    },

    async finish(currentUrl, expectedState, codeVerifier) {
      const tokens = await oidc.authorizationCodeGrant(await getConfiguration(), currentUrl, {
        expectedState,
        pkceCodeVerifier: codeVerifier,
      });
      const claims = tokens.claims();
      if (!claims?.sub || typeof claims.email !== "string" || claims.email_verified !== true) {
        throw new Error("Google did not return a verified email identity");
      }
      return {
        googleSubject: claims.sub,
        email: claims.email,
        displayName: typeof claims.name === "string" ? claims.name : claims.email,
        avatarUrl: typeof claims.picture === "string" ? claims.picture : null,
      };
    },
  };
}
