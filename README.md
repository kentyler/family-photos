# Family Photo Archive

A private hosted application for connecting family photographs in Google Drive with the people and stories they preserve.

## Local development

1. Install Node.js 22 and PostgreSQL.
2. Copy `.env.example` to `.env` and supply local values.
3. Enable Corepack, then run `pnpm install`, `pnpm run migrate`, and `pnpm run dev`.

Google login uses identity scopes only. Google Drive authorization is intentionally separate and will be implemented in Step 2.
