# Writer Web Archive Implementation Tasks

Status: Draft  
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

- [ ] Create Turso database from the Writer SQLite file.
- [ ] Verify imported table list matches local backup.
- [ ] Verify key row counts:
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

- [ ] Create `server/utils/db.ts` for server-only Turso client.
- [ ] Create `server/utils/auth.ts` for session helpers.
- [ ] Create `server/utils/validation.ts` for shared request validation.
- [ ] Create `server/utils/audit.ts` for audit logging.
- [ ] Create protected-route helper that rejects unauthenticated API calls.
- [ ] Ensure no Turso credentials are exposed to client runtime config.

## Phase 3: Single Admin Auth

- [ ] Implement `POST /api/auth/login`.
- [ ] Implement `POST /api/auth/logout`.
- [ ] Implement `GET /api/auth/session`.
- [ ] Implement `POST /api/auth/confirm-password`.
- [ ] Add login rate limiting.
- [ ] Add temporary lockout after repeated failed attempts.
- [ ] Add route middleware to redirect unauthenticated users to `/login`.
- [ ] Build `/login` page.
- [ ] Confirm no public signup route exists.

## Phase 4: Folder APIs

- [ ] Implement `GET /api/folders`.
- [ ] Include article counts per folder.
- [ ] Support active/deleted/all filter.
- [ ] Implement `GET /api/folders/:id`.
- [ ] Implement `POST /api/folders`.
- [ ] Implement `PATCH /api/folders/:id`.
- [ ] Implement `POST /api/folders/:id/delete`.
- [ ] Implement `POST /api/folders/:id/restore`.
- [ ] Add audit logs for folder writes.

## Phase 5: Article APIs

- [ ] Implement `GET /api/folders/:id/articles`.
- [ ] Support pagination.
- [ ] Support sort by rank, updated date, created date, title, and count.
- [ ] Support active/deleted/all filter.
- [ ] Implement `GET /api/articles/:id`.
- [ ] Implement `POST /api/articles`.
- [ ] Implement `PATCH /api/articles/:id`.
- [ ] Implement `POST /api/articles/:id/delete`.
- [ ] Implement `POST /api/articles/:id/restore`.
- [ ] Implement article move between folders.
- [ ] Update `updateTime` on article saves.
- [ ] Recalculate `count` on title/content save if agreed.
- [ ] Add audit logs for article writes.

## Phase 6: Search APIs

- [ ] Implement `GET /api/search`.
- [ ] Search article title and content.
- [ ] Return title, folder, excerpt, count, and updated time.
- [ ] Do not return full content in search results.
- [ ] Support include-deleted toggle.
- [ ] Add basic pagination.
- [ ] Evaluate Turso FTS later if basic search is too slow.

## Phase 7: Table Explorer APIs

- [ ] Implement `GET /api/tables`.
- [ ] Implement `GET /api/tables/:name`.
- [ ] Allowlist table names from SQLite schema.
- [ ] Paginate table rows.
- [ ] Hide large text/blob values in grid response.
- [ ] Add row detail response for full row viewing.
- [ ] Keep table explorer read-only in MVP except app-owned admin maintenance.

## Phase 8: Export APIs

- [ ] Implement filename/folder-name sanitizer.
- [ ] Implement article `.txt` formatter.
- [ ] Implement metadata JSON builders.
- [ ] Implement `POST /api/export/txt-zip`.
- [ ] Implement `GET /api/export/:id/download`.
- [ ] Export active folders/articles by default.
- [ ] Add include-deleted option.
- [ ] Preserve folder/article ordering with numeric prefixes.
- [ ] Add single article `.txt` export.
- [ ] Add single folder ZIP export.
- [ ] Add audit logs for exports.

## Phase 9: App Shell UI

- [ ] Build authenticated app layout.
- [ ] Add primary navigation:
  - Library
  - Search
  - Stats
  - Tables
  - Backups
  - Settings
- [ ] Build desktop three-pane layout.
- [ ] Build tablet two-pane layout.
- [ ] Build mobile drill-down layout.
- [ ] Preserve selected folder/article in route state.
- [ ] Preserve scroll position when navigating back on mobile.

## Phase 10: Library UI

- [ ] Build folder sidebar/list.
- [ ] Build deleted folder toggle.
- [ ] Build folder create/rename/edit description flows.
- [ ] Build article list.
- [ ] Build article filters and sort controls.
- [ ] Build article create flow.
- [ ] Build article move flow.
- [ ] Build soft delete/restore controls.
- [ ] Add loading, empty, and error states.

## Phase 11: Writer UI

- [ ] Build article reader mode.
- [ ] Build article editor mode.
- [ ] Add title editor.
- [ ] Add large plain-text content editor.
- [ ] Add manual save button.
- [ ] Add debounced autosave.
- [ ] Add local draft recovery.
- [ ] Add visible save states:
  - saved
  - unsaved
  - saving
  - offline/local draft
  - error
- [ ] Warn before leaving with unsaved changes.
- [ ] Add focus mode.
- [ ] Add subtle word/character count.
- [ ] Add in-article search.
- [ ] Add metadata drawer.
- [ ] Confirm mobile keyboard does not cover editor controls.

## Phase 12: Search, Stats, Tables, Backups UI

- [ ] Build global search page.
- [ ] Build search results with folder/title/excerpt.
- [ ] Build basic stats page from `Daily`.
- [ ] Show total words, date range, and top folders.
- [ ] Build all-tables explorer page.
- [ ] Build table row detail drawer.
- [ ] Build backups/export page.
- [ ] Add export option toggles.
- [ ] Add export download flow.

## Phase 13: QA and Hardening

- [ ] Test login/logout on local dev.
- [ ] Test protected API rejection while logged out.
- [ ] Test article save persists in Turso.
- [ ] Test soft delete and restore.
- [ ] Test search with and without deleted articles.
- [ ] Test full ZIP export opens correctly.
- [ ] Test mobile views at common phone widths.
- [ ] Test editing a large article.
- [ ] Check no article content appears in server logs.
- [ ] Check no Turso token appears in client bundle/runtime config.

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
- [ ] Document recovery process:
  - reset admin password
  - export TXT ZIP
  - verify Turso data

## MVP Completion Checklist

- [ ] Single admin can log in securely.
- [ ] No writing content is visible without login.
- [ ] Folders and articles can be browsed on desktop and mobile.
- [ ] Articles can be created, edited, saved, soft-deleted, and restored.
- [ ] Search works across title/content.
- [ ] All tables can be inspected safely.
- [ ] Backup ZIP exports folder-based `.txt` files.
- [ ] App deploys successfully on Netlify.
- [ ] Live data persists in Turso.
