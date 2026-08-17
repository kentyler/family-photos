# Production deployment checklist

The application is designed to deploy from the repository root as one Render Blueprint.

## Information required

- The Google email address for the first application administrator.
- A Google Cloud OAuth web client ID and secret.
- The final Render service URL, which becomes `APP_ORIGIN`.

## Google identity setup

1. Create or select a Google Cloud project.
2. Configure the OAuth branding for **Family Photo Archive**.
3. Create an OAuth client of type **Web application**.
4. Add the exact production redirect URI: `https://<render-service-host>/auth/google/callback`.
5. Keep the client ID and secret out of Git; enter them only as Render environment values.

Identity requests only `openid email profile`. Do not add a Google Drive scope during Step 1.

## Render setup

1. Push `main` to GitHub.
2. In Render, create a Blueprint from the `family-photos` repository.
3. Review the paid `starter` web service and `basic-256mb` PostgreSQL database before confirming creation.
4. Set the prompted values:
   - `APP_ORIGIN`: the HTTPS origin with no trailing path.
   - `GOOGLE_CLIENT_ID`: the Google OAuth web client ID.
   - `GOOGLE_CLIENT_SECRET`: the Google OAuth client secret.
   - `BOOTSTRAP_ADMIN_EMAIL`: the normalized email for the first administrator.
5. Sync the Blueprint. Render generates `SESSION_SECRET`, supplies `DATABASE_URL`, builds the application, runs migrations before deployment, and checks `/ready` against PostgreSQL.

## Acceptance check

1. Visit `/health` and confirm `{"status":"ok"}`.
2. Visit `/ready` and confirm `{"status":"ready"}`.
3. Sign in as the bootstrap administrator and confirm `/admin/members` loads.
4. Add a second Google email as a member.
5. Confirm an unlisted Google email is denied entry.
6. Confirm the listed second member can sign in but cannot open `/admin/members`.
7. Sign out and confirm `/api/me` returns an authentication-required response.
8. Confirm the Google consent screen requests identity only and does not mention Drive.
