# Writer Web Archive Implementation Tasks

Status: Implemented locally; production deployment pending
Date: 2026-07-20  
Scope: Small single-admin Nuxt app using Turso/libSQL and Netlify

## Phase 0: Project Setup

- [x] Scaffold Nuxt app in this workspace.
- [x] Add TypeScript, ESLint, and basic formatting.
- [x] Add dependencies:
  - `@libsql/client`
  - `@nuxt/ui`
  - `nuxt-auth-utils`
  - password hashing package
  - ZIP generation package
  - lightweight validation package
- [x] Choose Nuxt UI as the UI component system.
- [x] Add light, dark, and system theme foundation.
- [x] Add `.env.example` with:
  - `TURSO_DATABASE_URL`
  - `TURSO_AUTH_TOKEN`
  - `NUXT_SESSION_PASSWORD`
  - `ADMIN_EMAIL`
- [x] Add `netlify.toml` for Nuxt build/deploy.
- [x] Add `README.md` setup instructions.

## Phase 1: Turso Database Setup

- [x] Create Turso database from the Writer SQLite file.
- [x] Verify imported table list matches local backup.
- [x] Verify key row counts:
  - `Article`: 4,472
  - `Folder`: 46
  - `Category`: 2
  - `Daily`: 14,541
- [x] Add app-owned tables:
  - `app_user`
  - `app_audit_log`
  - `app_export_job`
- [x] Add setup/reset admin script.
- [x] Add a script to verify production table counts.

## Phase 2: Server Foundation

- [x] Create `server/utils/db.ts` for server-only Turso client.
- [x] Create `server/utils/auth.ts` for session helpers.
- [x] Create `server/utils/validation.ts` for shared request validation.
- [x] Create `server/utils/audit.ts` for audit logging.
- [x] Create protected-route helper that rejects unauthenticated API calls.
- [x] Ensure no Turso credentials are exposed to client runtime config.

## Phase 3: Single Admin Auth

- [x] Implement `POST /api/auth/login`.
- [x] Implement `POST /api/auth/logout`.
- [x] Implement `GET /api/auth/session`.
- [x] Implement `POST /api/auth/confirm-password`.
- [x] Add login rate limiting.
- [x] Add temporary lockout after repeated failed attempts.
- [x] Add route middleware to redirect unauthenticated users to `/login`.
- [x] Build `/login` page.
- [x] Confirm no public signup route exists.

## Phase 4: Folder APIs

- [x] Implement `GET /api/folders`.
- [x] Include article counts per folder.
- [x] Support active/deleted/all filter.
- [x] Implement `GET /api/folders/:id`.
- [x] Implement `POST /api/folders`.
- [x] Implement `PATCH /api/folders/:id`.
- [x] Implement `POST /api/folders/:id/delete`.
- [x] Implement `POST /api/folders/:id/restore`.
- [x] Add audit logs for folder writes.

## Phase 5: Article APIs

- [x] Implement `GET /api/folders/:id/articles`.
- [x] Support pagination.
- [x] Support sort by rank, updated date, created date, title, and count.
- [x] Support active/deleted/all filter.
- [x] Implement `GET /api/articles/:id`.
- [x] Implement `POST /api/articles`.
- [x] Implement `PATCH /api/articles/:id`.
- [x] Implement `POST /api/articles/:id/delete`.
- [x] Implement `POST /api/articles/:id/restore`.
- [x] Implement article move between folders.
- [x] Update `updateTime` on article saves.
- [x] Recalculate `count` on title/content save if agreed.
- [x] Add audit logs for article writes.

## Phase 6: Search APIs

- [x] Implement `GET /api/search`.
- [x] Search article title and content.
- [x] Return title, folder, excerpt, count, and updated time.
- [x] Do not return full content in search results.
- [x] Support include-deleted toggle.
- [x] Add basic pagination.
- [x] Evaluate Turso FTS later if basic search is too slow.

## Phase 7: Table Explorer APIs

- [x] Implement `GET /api/tables`.
- [x] Implement `GET /api/tables/:name`.
- [x] Allowlist table names from SQLite schema.
- [x] Paginate table rows.
- [x] Hide large text/blob values in grid response.
- [x] Add row detail response for full row viewing.
- [x] Keep table explorer read-only in MVP except app-owned admin maintenance.

## Phase 8: Export APIs

- [x] Implement filename/folder-name sanitizer.
- [x] Implement article `.txt` formatter.
- [x] Implement metadata JSON builders.
- [x] Implement `POST /api/export/txt-zip`.
- [x] Implement `GET /api/export/:id/download`.
- [x] Export active folders/articles by default.
- [x] Add include-deleted option.
- [x] Preserve folder/article ordering with numeric prefixes.
- [x] Add single article `.txt` export.
- [x] Add single folder ZIP export.
- [x] Add audit logs for exports.

## Phase 9: App Shell UI

- [x] Build authenticated app layout.
- [x] Add primary navigation:
  - Library
  - Search
  - Stats
  - Tables
  - Backups
  - Settings
- [x] Build desktop three-pane layout.
- [x] Build tablet two-pane layout.
- [x] Build mobile drill-down layout.
- [x] Preserve selected folder/article in route state.
- [x] Preserve scroll position when navigating back on mobile.

## Phase 10: Library UI

- [x] Build folder sidebar/list.
- [x] Build deleted folder toggle.
- [x] Build folder create/rename/edit description flows.
- [x] Build article list.
- [x] Build article filters and sort controls.
- [x] Build article create flow.
- [x] Build article move flow.
- [x] Build soft delete/restore controls.
- [x] Add loading, empty, and error states.

## Phase 11: Writer UI

- [x] Build article reader mode.
- [x] Build article editor mode.
- [x] Add title editor.
- [x] Add large plain-text content editor.
- [x] Add manual save button.
- [x] Add debounced autosave.
- [x] Add local draft recovery.
- [x] Add visible save states:
  - saved
  - unsaved
  - saving
  - offline/local draft
  - error
- [x] Warn before leaving with unsaved changes.
- [x] Add focus mode.
- [x] Add subtle word/character count.
- [x] Add in-article search.
- [x] Add metadata drawer.
- [ ] Confirm mobile keyboard does not cover editor controls.

## Phase 12: Search, Stats, Tables, Backups UI

- [x] Build global search page.
- [x] Build search results with folder/title/excerpt.
- [x] Build basic stats page from `Daily`.
- [x] Show total words, date range, and top folders.
- [x] Build all-tables explorer page.
- [x] Build table row detail drawer.
- [x] Build backups/export page.
- [x] Add export option toggles.
- [x] Add export download flow.

## Phase 13: QA and Hardening

- [x] Test login/logout on local dev.
- [x] Test protected API rejection while logged out.
- [x] Test article save persists in Turso.
- [x] Test soft delete and restore.
- [x] Test search with and without deleted articles.
- [x] Test full ZIP export opens correctly.
- [ ] Test mobile views at common phone widths.
- [ ] Test editing a large article.
- [x] Check no article content appears in server logs.
- [x] Check no Turso token appears in client bundle/runtime config.

## Phase 14: Deployment

- [ ] Push code to Git repository.
- [ ] Create/import Turso production database.
- [ ] Set Netlify environment variables.
- [ ] Deploy Nuxt app to Netlify.
- [ ] Run admin setup/reset script for production.
- [ ] Verify production login.
- [ ] Verify production table counts.
- [ ] Verify production edit/save.
- [ ] Verify production ZIP export.
- [x] Document recovery process:
  - reset admin password
  - export TXT ZIP
  - verify Turso data

## MVP Completion Checklist

- [x] Single admin can log in securely.
- [x] No writing content is visible without login.
- [x] Folders and articles can be browsed on desktop and mobile.
- [x] Articles can be created, edited, saved, soft-deleted, and restored.
- [x] Search works across title/content.
- [x] All tables can be inspected safely.
- [x] Backup ZIP exports folder-based `.txt` files.
- [ ] App deploys successfully on Netlify.
- [x] Live data persists in Turso.
