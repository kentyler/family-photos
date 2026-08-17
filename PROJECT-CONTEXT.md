# Project Handoff

Updated: 2026-08-17

## Read first

Read `ROADMAP.md` completely before planning or changing the application. It is the living human/AI-readable source of truth and must be updated whenever implementation status, scope, architecture, or an important decision changes.

## What happened before this repository was created

An older application exists at `D:\photo-app`. It is a local Node/Express photo-triage prototype built around local or Google Drive Desktop filesystem paths, a shared PostgreSQL database, file scanning, metadata extraction, photo notes, people, genealogy, documents, and experimental face recognition.

The target product is architecturally different, so this new repository was intentionally created instead of continuing to modify the old application. Do not copy the legacy application wholesale. Reuse individual ideas or modules later only after confirming that they fit the new architecture.

## Agreed product direction

Build a private hosted family-photo web application in these stabilization steps:

1. Web application and Google-account identity.
2. Attach existing Google Drive folders using separately authorized Drive access.
3. Folder navigation, thumbnail browsing, and lightbox display.
4. Individual photo pages with captions, stories/notes, comments, and person identification.
5. Connect identified people to canonical family-tree records.
6. Bidirectional navigation from photo person to family tree and from family-tree person to their photos.

The application does not manage how photos are uploaded to or organized in Google Drive. Drive remains the source of the original files.

Google login must request identity scopes only (`openid`, email, profile). Gmail access is not needed. Google Drive consent belongs to Step 2 and must remain separate from login.

## Current repository state

- GitHub repository: `https://github.com/kentyler/family-photos`
- Local folder: `C:\Users\Ken\Desktop\family-photos`
- The repository was empty when cloned.
- `ROADMAP.md` has been added locally but has not yet been committed.
- No application stack or implementation has been selected or created.
- Step 1 is correctly marked **not started**.

Provisional authentication code was created in the old repository before the decision to start fresh. It was deliberately not copied here because the new stack and deployment model should be selected first.

## Immediate next task

Begin Step 1 by evaluating and selecting the smallest suitable hosted web stack. The decision should cover:

- Web framework and language.
- Hosting target.
- PostgreSQL/database hosting and migrations.
- Google OpenID Connect authentication.
- Server-side sessions.
- Archive membership and the roles `owner`, `administrator`, and `member`.
- Local development and production deployment.

Record the selected stack and rationale in `ROADMAP.md` before scaffolding. Then create the minimal deployable application shell and make the initial commit.

## Suggested opening prompt for a new Codex task

> Read `PROJECT-CONTEXT.md` and `ROADMAP.md` completely. Continue the project from the immediate next task. Keep `ROADMAP.md` current as decisions are made and work is completed.

