# Family Photo Archive

A private hosted application for connecting family photographs in Google Drive with the people and stories they preserve.

## Local development

1. Install Node.js 22 and PostgreSQL.
2. Copy `.env.example` to `.env` and supply local values.
3. Enable Corepack, then run `pnpm install`, `pnpm run migrate`, and `pnpm run dev`.

Google login uses identity scopes only. Google Drive authorization is intentionally separate and will be implemented in Step 2.

For Google login, create an OAuth web client and register `http://localhost:3000/auth/google/callback` for local development. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `APP_ORIGIN` in the environment. Production uses the same callback path on the deployed origin.

Set `BOOTSTRAP_ADMIN_EMAIL` to the verified Google email for the first administrator. It is used only while the application membership table is empty. After that first login, administrators manage the approved email list at `/admin/members`.
