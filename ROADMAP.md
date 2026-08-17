# Family Photo Archive — Living Project Plan

Last updated: 2026-08-17

## Purpose

Build a private web application that lets a family connect existing Google Drive photo folders, browse them naturally, preserve what relatives know about each photograph, and move seamlessly between people in photographs and their place in the family tree.

This file is the human- and AI-readable source of truth for product direction. Update it whenever scope, architecture, status, or an important decision changes.

## Product boundaries

The application owns:

- Google-account identity and archive access.
- Connections to user-selected Google Drive folders.
- Folder indexing and navigation.
- Photo descriptions, discussions, person identifications, and genealogy links.
- Relationships between photos, people, and family-tree records.

The application does not own:

- Uploading photos into Google Drive.
- Organizing or synchronizing the user's Drive filesystem.
- Replacing Google Drive as the source of the original files.

## Target architecture

```text
Browser
  -> hosted web application
       -> Google OAuth (identity only)
       -> Google Drive OAuth (separate consent, Step 2)
       -> application database
       -> Google Drive files selected by the user
```

The existing local-server application is the working prototype. Useful catalog, metadata, genealogy, and interface code will be retained where it fits. Local filesystem paths, desktop launchers, and filesystem watchers are legacy implementation details rather than requirements for the hosted product.

## Stabilization milestones

### Step 1 — Web application and identity

Goal: establish a deployable application shell and trustworthy user identity.

Scope:

- [x] Sign in with a Google account using OpenID Connect scopes only.
- [x] Persistent application users and server-side sessions.
- [x] Login, logout, current-user, and authentication-status endpoints.
- [x] Login screen and authenticated application shell.
- [x] Enforce authorization for all private application data.
- [x] Gate application entry through an administrator-managed membership list after Google authentication.
- [x] Add archive membership and roles (`owner`, `administrator`, `member`).
- [x] Choose and configure the production hosting environment.
- [x] Define account removal, privacy, and session-expiration behavior.
- [x] Establish production migrations, secrets, and deployment checks.

Current status: **complete**. On 2026-08-17 the hosted stack and deployable shell were completed, followed by Google OIDC identity, an administrator-managed application admission list, persistent user linking, session rotation and logout invalidation, the authenticated shell, and membership-scoped archive reads. The first administrator is bootstrapped by configured email only while the admission table is empty; administrators can then add pending members by verified Google email. Automated tests cover login, admission denial, member entry, current-user access, archive isolation, logout, production configuration failure, credential normalization, and database readiness. The production `familyphotos` PostgreSQL database and `familyphotos-web` service are managed through the Render Blueprint, migrations `001` and `002` ran successfully, and the service is live at `https://familyphotos-web.onrender.com`. Live checks confirm process health, PostgreSQL readiness, the public login shell, a Google authorization redirect containing state, PKCE, and exactly `openid email profile`, and successful Google sign-in by the bootstrap administrator. No Drive scope is included in identity login.

Selected stack:

- Node.js 22 and TypeScript, using Express 5 with server-rendered HTML for the smallest single-service application that can grow incrementally.
- Render Web Service for production hosting, described by `render.yaml`, with health checks and automatic deploys from GitHub.
- Managed Render PostgreSQL, accessed through `DATABASE_URL`; versioned SQL migrations run as the Render pre-deploy command and locally through the same script.
- Google OpenID Connect through `openid-client`, using authorization code flow with PKCE and exactly `openid email profile` for identity.
- `express-session` with a PostgreSQL session store. Cookies are HTTP-only, `SameSite=Lax`, secure in production, and expire after 30 days of inactivity. Logout destroys the server-side session.
- Application tables own archive membership. Membership role is constrained to `owner`, `administrator`, or `member`; authorization checks will resolve permissions through membership rather than trusting browser state.
- Local development uses Node's watch mode and a local PostgreSQL `DATABASE_URL`; production secrets are injected by Render and are never committed.

Exit criteria:

- A family member can visit the hosted site, sign in with Google, return later, and access only archives for which they have membership.
- Signing out invalidates the server-side session.
- Drive permission has not been requested as part of login.

### Step 2 — Connect Google Drive folders

Goal: let an authenticated user attach existing folders without making the application responsible for placing files in Drive.

Scope:

- [~] Separate Google Drive authorization and consent.
- [x] Request the least Drive access needed.
- [x] Select and attach one or more folders.
- [x] Store Drive IDs rather than filesystem paths.
- [x] Import all legacy database tables intact before asking members to recreate metadata.
- [~] Index Drive files and reconcile them to the preserved legacy catalog.
- [ ] Handle revoked access and moved, renamed, or deleted folders.
- [ ] Provide reconnect and rescan controls.

Exit criteria: a user can connect a folder and the application reliably discovers supported photos and subfolders.

Current status: **in progress**. Step 2 began on 2026-08-17 with a separate authorization-code flow for Google Drive. It requests only the non-sensitive `drive.file` scope recommended for per-file access, stores refresh tokens encrypted at rest under a key separate from the session secret, and records connection status per application user. Migrations `003` and `004` and the separate encryption secret are live on Render; production health and database-readiness checks pass. The Google Drive and Google Picker APIs are enabled, both identity and Drive callback URIs are registered on the OAuth client, and a Picker-only browser key restricted to the production site plus the Cloud project number are configured in Render. Live production use confirmed that administrators can add members and members can attach multiple Drive folders. On 2026-08-17 all 31 legacy `catalog` tables were copied intact into the isolated production `legacy_catalog` schema: 258,219 rows total, including all 256,923 file records, thumbnails, face data, people, narratives, genealogy, relationships, settings, and empty tables. Every source and target table count matched, the source database remained read-only, and temporary migration credentials were deleted. Drive indexing and deterministic reconciliation to this preserved copy are next.

### Step 3 — Folder navigation and lightbox

Goal: deliver a dependable, read-only photo browsing experience.

Scope:

- [ ] Navigate attached folder hierarchies.
- [ ] Responsive thumbnail grid with incremental loading.
- [ ] Sorting and basic filtering.
- [ ] Lightbox with previous/next navigation.
- [ ] Preserve navigation context when returning from a photo.
- [ ] Handle images, videos, missing files, and unsupported formats clearly.

Exit criteria: a user can comfortably browse a large Drive collection without editing anything.

### Step 4 — Individual photo record

Goal: turn a Drive file into an enrichable, collaborative archive item.

Scope:

- [ ] Stable photo identity across Drive rename or move operations.
- [ ] Individual photo page.
- [ ] Caption, notes/stories, and comments as distinct concepts.
- [ ] Person identification.
- [ ] Contributor attribution and edit history.
- [ ] Dates and descriptive metadata.
- [ ] Support uncertain or disputed information.

Exit criteria: relatives can enrich the same photograph without overwriting one another or losing provenance.

### Step 5 — Family-tree integration

Goal: connect photo identifications to canonical family identities.

Scope:

- [ ] Import or create a family tree.
- [ ] Canonical person profiles with aliases and relationships.
- [ ] Match photo identities to canonical people.
- [ ] Prevent or reconcile duplicate people.
- [ ] Represent tentative matches and conflicting evidence.
- [ ] Show relevant family context in the photo view.

Exit criteria: a person identified in a photo can be connected to one canonical family-tree identity, with uncertainty retained when appropriate.

### Step 6 — Bidirectional exploration

Goal: make the photo archive and family tree feel like one connected product.

Scope:

- [ ] Photo person -> family-tree profile.
- [ ] Family-tree person -> all associated photos.
- [ ] Filter a person's photos by date, folder, event, or companion.
- [ ] Preserve context while moving between photos and the tree.

Exit criteria: users can repeatedly move between photos and people without encountering disconnected screens or losing their place.

## Deferred until the core loop is stable

- Face recognition and automatic clustering.
- Voice transcription.
- AI descriptions and automatic tagging.
- Advanced document management.
- Rating and high-volume triage workflows.
- Generated high-resolution derivatives.

These may be useful later, but they must build on the photo-person-family-tree loop rather than delay it.

## Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-08-17 | Use Google OAuth for identity; do not request Gmail access. | Authentication needs identity, not mailbox data. |
| 2026-08-17 | Authorize Google Drive separately in Step 2. | Keeps consent understandable and permissions minimal. |
| 2026-08-17 | Treat Drive as the owner of file storage and organization. | Avoids rebuilding upload, sync, and filesystem management. |
| 2026-08-17 | Use canonical person records when genealogy is introduced. | A nickname, GEDCOM record, and photo identification may refer to the same human. |
| 2026-08-17 | Keep legacy local mode working during the hosted transition. | Allows incremental stabilization without discarding the usable prototype. |
| 2026-08-17 | Build the hosted product in a new `family-photos` repository. | The target architecture differs enough from the local prototype to warrant a clean foundation. |
| 2026-08-17 | Use Node.js 22, TypeScript, Express 5, and server-rendered HTML. | A single conventional web service is the smallest deployable shell and avoids a separate frontend/API boundary before the product needs one. |
| 2026-08-17 | Host the web service and managed PostgreSQL on Render. | Render directly supports Node web services, PostgreSQL, health checks, environment secrets, and pre-deploy migrations in one declarative blueprint. |
| 2026-08-17 | Use versioned SQL migrations and the `pg` driver. | The initial relational model is small; explicit SQL keeps deployment behavior transparent and avoids committing to a larger ORM prematurely. |
| 2026-08-17 | Use `openid-client` for Google OIDC and PostgreSQL-backed `express-session` sessions. | Standards-based OIDC keeps login limited to identity scopes, while server-side sessions make logout and revocation enforceable by the application. |
| 2026-08-17 | Sessions expire after 30 idle days; account removal deletes profile data after ownership is transferred or the archive is deleted. | Provides a practical return-visit window while preventing orphaned archives and defining the privacy boundary early. |
| 2026-08-17 | Rotate the session after Google login and return `404` for archives outside the user's membership. | Prevents session fixation and avoids revealing whether an unshared private archive exists. |
| 2026-08-17 | Separate application admission from archive membership: Google verifies identity, the application membership list permits entry, and archive membership controls data access. | Being a valid Google user must not imply access to this private family application or to every archive. |
| 2026-08-17 | Bootstrap the first application administrator from a configured email only while the membership table is empty. | Solves initial setup without leaving a permanent configuration-based bypass after administrators can manage members themselves. |
| 2026-08-17 | Use the non-sensitive `drive.file` scope with Google Picker instead of restricted `drive.readonly`. | Limits access to files explicitly shared with the application and avoids broad access to every file in a family member's Drive. |
| 2026-08-17 | Encrypt Drive refresh tokens at rest with a deployment secret separate from the session secret. | Long-lived Drive access must remain revocable and must not be stored as plaintext or coupled to browser-session signing. |
| 2026-08-17 | Use the Cloud project number as the Picker app ID and a browser-restricted Google API key for Picker. | Google requires the app ID with `drive.file`; restricting the public browser key to the production origin and Picker API limits misuse. |
| 2026-08-17 | Import every legacy PostgreSQL catalog table intact before normalization or metadata re-entry. | A complete isolated copy preserves file records, thumbnails, face data, genealogy, relationships, settings, and even currently unused tables; later transformations remain reproducible and auditable. |

## Working agreement for maintaining this file

When work changes the project, update at least one of:

1. The relevant checklist and current-status paragraph.
2. The Decisions table when a consequential choice is made.
3. Target architecture or product boundaries when responsibilities change.
4. Exit criteria when the definition of done changes.

Use `[ ]` for not started, `[~]` for in progress, and `[x]` for complete. Do not mark an item complete merely because scaffolding exists.
