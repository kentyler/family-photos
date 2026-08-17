import * as oauth from "openid-client";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface DriveAuthorizationClient {
  begin(): Promise<{ url: string; state: string; codeVerifier: string }>;
  finish(currentUrl: URL, expectedState: string, codeVerifier: string): Promise<{ refreshToken: string; scope: string }>;
}

export function createDriveAuthorizationClient(options: { clientId: string; clientSecret: string; appOrigin: string }): DriveAuthorizationClient {
  const redirectUri = new URL("/drive/callback", options.appOrigin).href;
  let configuration: Promise<oauth.Configuration> | undefined;
  const getConfiguration = () => configuration ??= oauth.discovery(new URL("https://accounts.google.com"), options.clientId, options.clientSecret);

  return {
    async begin() {
      const codeVerifier = oauth.randomPKCECodeVerifier();
      const state = oauth.randomState();
      const url = oauth.buildAuthorizationUrl(await getConfiguration(), {
        redirect_uri: redirectUri,
        scope: DRIVE_FILE_SCOPE,
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "false",
        code_challenge: await oauth.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: "S256",
        state,
      });
      return { url: url.href, state, codeVerifier };
    },
    async finish(currentUrl, expectedState, codeVerifier) {
      const tokens = await oauth.authorizationCodeGrant(await getConfiguration(), currentUrl, { expectedState, pkceCodeVerifier: codeVerifier });
      if (!tokens.refresh_token) throw new Error("Google Drive did not return a refresh token");
      return { refreshToken: tokens.refresh_token, scope: tokens.scope ?? DRIVE_FILE_SCOPE };
    },
  };
}
