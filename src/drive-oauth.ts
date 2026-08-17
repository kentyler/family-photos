import * as oauth from "openid-client";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface DriveAuthorizationClient {
  begin(): Promise<{ url: string; state: string; codeVerifier: string }>;
  finish(currentUrl: URL, expectedState: string, codeVerifier: string): Promise<{ refreshToken: string; scope: string }>;
  getAccessToken(refreshToken: string): Promise<string>;
  getFolder(accessToken: string, folderId: string): Promise<{ id: string; name: string }>;
  listChildren(accessToken: string, folderId: string): Promise<Array<{ id: string; name: string; mimeType: string; modifiedTime: string | null; sizeBytes: number | null }>>;
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
    async getAccessToken(refreshToken) {
      const tokens = await oauth.refreshTokenGrant(await getConfiguration(), refreshToken);
      if (!tokens.access_token) throw new Error("Google Drive did not return an access token");
      return tokens.access_token;
    },
    async getFolder(accessToken, folderId) {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error(`Google Drive folder lookup failed (${response.status})`);
      const file = await response.json() as { id?: string; name?: string; mimeType?: string; trashed?: boolean };
      if (!file.id || !file.name || file.mimeType !== "application/vnd.google-apps.folder" || file.trashed) {
        throw new Error("The selected Drive item is not an available folder");
      }
      return { id: file.id, name: file.name };
    },
    async listChildren(accessToken, folderId) {
      const files: Array<{ id: string; name: string; mimeType: string; modifiedTime: string | null; sizeBytes: number | null }> = [];
      let pageToken: string | undefined;
      do {
        const parameters = new URLSearchParams({
          q: `'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false`,
          fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
          pageSize: "1000",
        });
        if (pageToken) parameters.set("pageToken", pageToken);
        const response = await fetch(`https://www.googleapis.com/drive/v3/files?${parameters}`, { headers: { authorization: `Bearer ${accessToken}` } });
        if (!response.ok) throw new Error(`Google Drive listing failed (${response.status})`);
        const page = await response.json() as { nextPageToken?: string; files?: Array<{ id?: string; name?: string; mimeType?: string; modifiedTime?: string; size?: string }> };
        for (const file of page.files ?? []) {
          if (file.id && file.name && file.mimeType) files.push({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            modifiedTime: file.modifiedTime ?? null,
            sizeBytes: file.size && Number.isSafeInteger(Number(file.size)) ? Number(file.size) : null,
          });
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
      return files;
    },
  };
}
