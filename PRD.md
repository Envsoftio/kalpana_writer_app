# Writer Web Archive PRD

Status: Draft  
Date: 2026-07-20  
Target stack: Nuxt, Netlify, Turso/libSQL  
Source database: `WriterBackup-40books-3983articles-0719201745-v28.9.2-Galaxy-S9+.db`

## 1. Summary

Build a secure hosted web application for browsing, editing, searching, and exporting a Writer backup database. The application will use the existing SQLite schema and data as the foundation, hosted in Turso as a SQLite-compatible/libSQL database. Nuxt will provide the frontend and server API routes, deployed on Netlify.

The app is primarily a private writer workspace. It must expose a polished folder/article writing interface while also supporting full database-table visibility for backup inspection and recovery workflows.

## 2. Background

The current Writer backup is a SQLite 3 database, approximately 98 MB. Initial inspection found these tables:

| Table | Rows | Notes |
| --- | ---: | --- |
| `Article` | 4,472 | Main writing content table |
| `Folder` | 46 | Books/folders |
| `Category` | 2 | Folder-linked groups/categories |
| `Daily` | 14,541 | Writing statistics by day/article/folder |
| `Setting` | 3 | App settings |
| `UserMessage` | 1 | App message data |
| `History` | 0 | Article history table |
| `room_master_table` | 1 | Android Room metadata |

Important counts:

| Entity | Active | Deleted |
| --- | ---: | ---: |
| Articles | 4,233 | 239 |
| Folders | 41 | 5 |
| Categories | 2 | 0 |

Content range:

| Metric | Value |
| --- | --- |
| First article created | 2021-03-26 |
| Last article updated | 2026-07-19 |
| Stored article count sum | 8,386,725 |
| Article content characters | 39,103,317 |
| Largest active article | 477,197 characters |

## 3. Goals

1. Use the Writer SQLite database structure as the live application data model.
2. Host the database securely using Turso/libSQL.
3. Deploy the Nuxt application on Netlify using server routes for all database access.
4. Provide secure login before any writing data is visible.
5. Build a fast, ergonomic writer interface focused on folders and articles.
6. Support read/write operations for articles, folders, categories, and settings where safe.
7. Preserve deleted records and allow filtering/restoring where possible.
8. Provide an all-tables database explorer for inspection.
9. Support backup downloads as a ZIP containing folder structure and `.txt` article files.
10. Keep Turso credentials and write APIs server-side only.

## 4. Non-Goals

1. Do not expose the database directly to the browser.
2. Do not migrate the main data model to Postgres.
3. Do not store the live `.db` file in Netlify's filesystem.
4. Do not make the MVP a public publishing platform.
5. Do not support simultaneous collaborative editing in the MVP.
6. Do not guarantee that exported SQLite backups can be re-imported into the Writer Android app in MVP.
7. Do not include public registration, invitations, teams, or role management in the MVP.

## 5. Product Scope

### MVP

The MVP should include:

1. Single-admin login/logout.
2. Protected app shell.
3. Folder sidebar.
4. Article list for selected folder.
5. Article reader/editor.
6. Article search by title and content.
7. Soft delete and restore for articles.
8. Folder create, rename, update description, soft delete, restore.
9. Basic all-tables explorer with pagination.
10. Download ZIP export with folders and `.txt` article files.
11. Download raw SQL or SQLite-compatible backup export where Turso support allows.
12. Mobile-responsive browsing, reading, searching, and editing.
13. Manual save, debounced autosave, and local draft recovery for article editing.

### Post-MVP

Potential later features:

1. Full writing analytics dashboard from `Daily`.
2. Article version history.
3. Markdown preview mode.
4. Tags and custom collections.
5. Import another Writer backup.
6. Conflict detection for multi-device editing.
7. Full Writer compatible SQLite export.
8. Role-based multi-user access.
9. Password reset email flow.

## 6. Users

### Primary User: Single Admin Writer

Needs:

1. Securely access their writing backup online.
2. Browse folders/books.
3. Search old writing quickly.
4. Edit and preserve articles.
5. Export backups in human-readable text format.
6. Inspect raw tables when debugging or recovering data.

### Future User: Read-Only Reviewer

Needs:

1. View selected folders/articles.
2. Search accessible content.
3. No write or export permissions unless explicitly granted.

## 7. Technical Architecture

```txt
Browser
  |
  | HTTPS
  v
Nuxt app on Netlify
  pages/ and components/     UI
  server/api/                protected API routes
  server/utils/              auth, database, export helpers
  |
  | server-only Turso token
  v
Turso/libSQL
  imported Writer schema and data
```

### Hosting

The Nuxt app will be deployed to Netlify with SSR/server routes enabled. It must not be deployed using static-only generation because authentication and protected server API routes are required.

### Database

Turso/libSQL will be the live hosted SQLite-compatible database.

Initial import:

```bash
turso db create writer --from-file ./WriterBackup-40books-3983articles-0719201745-v28.9.2-Galaxy-S9+.db
```

Application connection:

```txt
TURSO_DATABASE_URL=...
TURSO_AUTH_TOKEN=...
```

Nuxt server code should connect using `@libsql/client`.

### Auth

Preferred implementation:

1. `nuxt-auth-utils` for sealed cookie sessions.
2. Server-side email/password login.
3. Password hashes stored in app-owned auth tables.
4. Session required for all protected routes.
5. Single admin account only in MVP.
6. No public signup route.

Alternative:

1. Use Supabase Auth only for identity.
2. Validate Supabase JWT in Nuxt server routes.
3. Continue using Turso for writing data.

MVP recommendation: use `nuxt-auth-utils` to keep the stack compact.

### Single-Admin Auth Flow

The MVP should use one administrator account for the entire app.

Setup:

1. Create the admin account through a server-side setup script, not through public registration.
2. The setup script reads Turso credentials from local environment variables.
3. The setup script creates or updates the single admin row with ID `admin`.
4. The setup script hashes the password before saving it.
5. If the password is forgotten, run the setup/reset script again with a new password.

Login:

1. User submits email and password.
2. Server route normalizes the email and loads the single active admin row.
3. Server verifies the password hash.
4. Server creates a sealed session cookie with admin identity.
5. Browser receives only session state, never the password hash or Turso token.

Authorization:

1. Every protected API route requires an active admin session.
2. There are no per-record ownership checks in MVP because there is only one admin.
3. Dangerous operations such as table explorer writes, bulk delete, and full backup export may require password re-confirmation.
4. All write/export actions are recorded in `app_audit_log`.

## 8. Data Model

### Preserve Existing Writer Tables

Existing tables should be preserved:

1. `Article`
2. `Folder`
3. `Category`
4. `Daily`
5. `Setting`
6. `UserMessage`
7. `History`
8. `room_master_table`

### Add App-Owned Tables

Use a clear prefix to avoid collision with Writer tables.

```sql
CREATE TABLE app_user (
  id TEXT PRIMARY KEY CHECK (id = 'admin'),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  password_updated_at INTEGER NOT NULL,
  last_login_at INTEGER,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE app_audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'admin',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE app_export_job (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'admin',
  format TEXT NOT NULL,
  status TEXT NOT NULL,
  file_name TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
```

### Key Relationships

| Relationship | Meaning |
| --- | --- |
| `Article.folderId -> Folder.id` | Article belongs to folder/book |
| `Article.categoryId -> Category.id` | Article optionally belongs to category |
| `Category.folderId -> Folder.id` | Category belongs to folder |
| `Daily.articleId -> Article.id` | Daily writing stats by article |
| `Daily.folderId -> Folder.id` | Daily writing stats by folder |

## 9. Functional Requirements

### 9.1 Authentication

1. Single admin can log in with email and password.
2. Single admin can log out.
3. Unauthenticated visitors are redirected to login.
4. Server API routes reject unauthenticated requests.
5. Initial admin account is created through a setup script, not public registration.
6. Admin password can be reset by rerunning the setup/reset script.
7. Passwords must never be stored in plain text.
8. Login attempts are rate-limited.
9. Repeated failed attempts temporarily lock the admin account.
10. Session cookies are sealed, HTTP-only, secure in production, and same-site protected.

### 9.2 Folder Interface

1. Show active folders by default.
2. Show deleted folders when the user enables a deleted filter.
3. Sort folders by `rank`, then `orderKey`, then `name`.
4. Show article count per folder.
5. Show folder metadata:
   - name
   - description
   - created time
   - updated time
   - deleted state
   - tags
6. Allow create folder.
7. Allow rename folder.
8. Allow update folder description.
9. Allow soft delete folder.
10. Allow restore deleted folder.

### 9.3 Article List

1. Show articles for the selected folder.
2. Sort by rank/order key by default.
3. Provide alternate sort options:
   - recently updated
   - recently created
   - title
   - count/word count
4. Show article preview data:
   - title
   - summary or content excerpt
   - count
   - created time
   - updated time
   - deleted state
5. Support pagination or virtualization.
6. Support active/deleted/all filter.
7. Support category filter.

### 9.4 Article Reader/Editor

1. Open an article by ID.
2. Show full article title and content.
3. Edit article title.
4. Edit article content.
5. Save updates through server API.
6. Update `updateTime` on save.
7. Preserve original Writer metadata fields unless the edited action requires changes.
8. Soft delete article.
9. Restore article.
10. Move article to another folder.
11. Debounced autosave should save changed title/content after a short idle period.
12. Manual save should always be available.
13. Local draft recovery should protect unsaved edits if the browser closes or the network fails.
14. Save status should show states such as saved, unsaved, saving, offline/local draft, and error.
15. Show metadata drawer:
    - id
    - folder
    - category
    - created time
    - updated time
    - count
    - rank
    - deleted/deletedTime

### 9.5 Search

1. Search across article title and content.
2. Search results must show folder name, title, excerpt, and updated time.
3. Search must support active-only by default.
4. Search must support including deleted articles.
5. Future enhancement: add FTS index if supported cleanly in Turso.

### 9.6 All Tables Explorer

1. Show a list of all database tables.
2. Selecting a table shows paginated rows.
3. Hide large text/blob fields by default in table grid.
4. Provide row detail drawer for full row view.
5. Support table-level search/filter where safe.
6. Write operations in all-tables explorer are admin-only and may be disabled for MVP except for app-owned tables.

### 9.7 Daily Stats

MVP:

1. Show basic totals from `Daily`.
2. Show words by date range.
3. Show top folders by word count.

Post-MVP:

1. Calendar heatmap.
2. Writing streaks.
3. Month/year summaries.
4. Time spent writing.

### 9.8 Backup and Export

Required export: ZIP folder with `.txt` files.

ZIP structure:

```txt
Writer Export/
  Folder Name/
    001 - Article Title.txt
    002 - Another Article.txt
  _metadata/
    export-info.json
    folders.json
    articles.json
    categories.json
```

Text file format:

```txt
Title: Article Title
Folder: Folder Name
Created: 2021-03-26 08:51:20
Updated: 2026-07-19 14:47:42
Deleted: false
Article ID: ...

Article content starts here...
```

Export requirements:

1. Export all active folders/articles by default.
2. Offer option to include deleted folders/articles.
3. Sanitize file and folder names.
4. Preserve ordering with numeric prefixes.
5. Include metadata JSON for reconstruction.
6. Stream or background-generate large exports if needed.
7. Audit log export action.

Optional exports:

1. Single article `.txt`.
2. Single folder ZIP.
3. All data JSON.
4. SQL dump.
5. SQLite-compatible backup, if Turso export path supports the needed fidelity.

## 10. Security Requirements

1. The Turso auth token must only exist in Netlify environment variables.
2. Browser code must never receive Turso credentials.
3. All database access must happen through Nuxt server routes.
4. API routes must validate user session before running queries.
5. Use parameterized queries for every user-provided value.
6. Disable arbitrary SQL execution from the browser.
7. Rate-limit login attempts.
8. Add CSRF protection where session cookie flows need it.
9. Set secure cookie settings in production.
10. Do not store generated export files publicly unless explicitly configured.
11. Log sensitive operations, but never log article content.
12. Do not ship public signup, invite, or user-management endpoints in MVP.
13. Store the single admin row in the same Turso database using app-owned tables.

## 11. API Requirements

Proposed Nuxt server routes:

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Login |
| `POST` | `/api/auth/logout` | Logout |
| `GET` | `/api/auth/session` | Current session |
| `POST` | `/api/auth/confirm-password` | Re-confirm admin password for sensitive actions |
| `GET` | `/api/folders` | List folders |
| `POST` | `/api/folders` | Create folder |
| `GET` | `/api/folders/:id` | Folder detail |
| `PATCH` | `/api/folders/:id` | Update folder |
| `POST` | `/api/folders/:id/delete` | Soft delete folder |
| `POST` | `/api/folders/:id/restore` | Restore folder |
| `GET` | `/api/folders/:id/articles` | List articles in folder |
| `GET` | `/api/articles/:id` | Article detail |
| `POST` | `/api/articles` | Create article |
| `PATCH` | `/api/articles/:id` | Update article |
| `POST` | `/api/articles/:id/delete` | Soft delete article |
| `POST` | `/api/articles/:id/restore` | Restore article |
| `GET` | `/api/search` | Search articles |
| `GET` | `/api/tables` | List tables |
| `GET` | `/api/tables/:name` | Paginated table rows |
| `GET` | `/api/stats/daily` | Daily writing stats |
| `POST` | `/api/export/txt-zip` | Generate TXT ZIP export |
| `GET` | `/api/export/:id/download` | Download generated export |

## 12. UI Requirements

### App Layout

Use a dense, calm writing workspace instead of a marketing layout.

Primary screen:

```txt
+----------------+----------------------+-----------------------------+
| Folder Sidebar | Article List         | Article Reader/Editor       |
|                |                      |                             |
| Search         | Sort/filter controls | Title                       |
| Folders        | Article rows         | Content                     |
| Deleted toggle |                      | Metadata/actions            |
+----------------+----------------------+-----------------------------+
```

Navigation:

1. Library
2. Search
3. Stats
4. Tables
5. Backups
6. Settings

### Responsive Layout

Desktop layout:

1. Three-pane workspace with folder sidebar, article list, and reader/editor.
2. Resizable or collapsible panes.
3. Keyboard-friendly navigation between list and editor.
4. Metadata/actions available in a side drawer.

Tablet layout:

1. Two-pane workspace by default.
2. Folder sidebar can collapse into a navigation drawer.
3. Article list and editor can share space or switch using tabs.
4. Touch targets must be comfortable without wasting reading space.

Mobile layout:

1. Single-column drill-down flow:
   - folders
   - articles in selected folder
   - article reader/editor
2. Persistent bottom navigation or compact command bar for Library, Search, Stats, and Settings.
3. Back navigation must preserve scroll position and selected folder/article.
4. Search should be reachable from the top of the Library screen and bottom navigation.
5. Article reading should use the full viewport with minimal chrome.
6. Editing must be supported on mobile, not read-only.
7. Save status must remain visible without covering text.
8. Toolbars must avoid being hidden behind the mobile keyboard.
9. Long titles and folder names must wrap or truncate cleanly without layout overlap.
10. Export and all-tables explorer may use simplified mobile views, but must remain usable.

### Design Tone

The app should feel like a private writing desk:

1. Quiet, focused, and fast.
2. High readability for long text.
3. No decorative landing page as the primary experience.
4. Responsive layout for desktop and tablet.
5. Mobile should support browsing, reading, searching, and editing.

### Writer Experience

1. Reading mode uses a comfortable measure, strong contrast, and adjustable font size.
2. Editor uses a distraction-light layout with title, content, save status, and essential actions only.
3. Save behavior should combine manual save, debounced remote autosave, and local draft recovery.
4. Unsaved changes are clearly indicated.
5. Navigating away with unsaved changes requires confirmation.
6. Large articles must stay responsive while typing.
7. The editor should support plain text faithfully, preserving Writer line breaks and spacing.
8. The app should avoid visual noise while writing: no marketing panels, decorative hero sections, or oversized cards.
9. Common writing actions should be one tap/click away:
   - new article
   - save
   - search
   - move article
   - export article
   - soft delete/restore
10. Article metadata should be available but not constantly competing with the writing surface.
11. Focus mode should hide sidebars and nonessential navigation while writing.
12. Word/character count should be visible but subtle.
13. Search within the current article should be available for long documents.

## 13. Performance Requirements

1. Folder list should load in under 1 second after authentication on normal network.
2. Article list should paginate or virtualize to avoid rendering thousands of rows.
3. Article detail should fetch full content only when opened.
4. Search should avoid returning full article bodies in list results.
5. Large exports should not block normal browsing.
6. Largest article currently observed is approximately 477k characters, so editor must handle large documents.

## 14. Data Integrity Requirements

1. Preserve Writer IDs.
2. Prefer soft delete over hard delete.
3. Wrap multi-step writes in transactions.
4. Record audit log entries for create/update/delete/restore/export.
5. Create backup/export before destructive bulk operations.
6. Maintain `createTime`, `updateTime`, `deleted`, and `deletedTime` semantics.
7. Validate folder/category references before moving articles.

## 15. Deployment Requirements

1. Deploy Nuxt app to Netlify.
2. Configure environment variables:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `NUXT_SESSION_PASSWORD`
   - `ADMIN_EMAIL` for the setup/reset script
3. Build command:
   - `npm run build`
4. Do not use static generation for the protected app.
5. Add production-only secure cookie settings.
6. Add deployment documentation for Turso import, admin setup, and Netlify env setup.

## 16. Migration and Setup Plan

1. Create Turso account and database.
2. Import local Writer `.db` into Turso.
3. Verify table counts after import.
4. Apply app-owned auth/audit/export tables.
5. Create or reset the single admin user with the setup script.
6. Configure Nuxt environment variables locally.
7. Build and test API routes against Turso.
8. Deploy to Netlify.
9. Configure Netlify environment variables.
10. Verify production login, browsing, editing, and export.

## 17. Testing Requirements

### Unit Tests

1. Filename sanitization.
2. Date conversion helpers.
3. Query parameter validation.
4. Export text formatting.
5. Mobile layout state transitions.

### API Tests

1. Unauthenticated requests are rejected.
2. Folder list works.
3. Article detail works.
4. Article update changes content and `updateTime`.
5. Soft delete and restore work.
6. Search returns expected rows without full content leakage in results.
7. Table explorer blocks invalid table names.
8. ZIP export contains expected files.
9. Login fails safely for wrong password and rate-limited attempts.
10. No signup endpoint exists in MVP.

### Manual QA

1. Login works on Netlify.
2. Can browse folders and articles.
3. Can edit and save a large article.
4. Can search content.
5. Can include/exclude deleted items.
6. Can download backup ZIP and inspect text files.
7. Turso table counts match expected data.
8. Mobile folder, article list, reader, editor, and search flows work at phone widths.
9. Mobile keyboard does not cover save status or core editor controls.

## 18. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Turso/libSQL differences from Android SQLite | Some schema/query behavior may differ | Validate import and all critical writes early |
| Large content fields | Slow list/search pages | Fetch content only on detail view; add indexes/FTS later |
| Editing Writer schema directly | App compatibility risk | Preserve existing fields; add app tables with prefix |
| Auth misconfiguration | Private writing data exposed | Server-only database token, protected routes, secure cookies |
| Export timeouts on Netlify | Failed full backup export | Stream ZIP or use background/persisted export jobs |
| Concurrent writes | Lost edits | Save timestamps, optimistic checks, transactions |

## 19. Open Questions

1. Should deleted articles be visible by default in search?
2. Should article edits update the Writer `count` field automatically?
3. Should exports include deleted content by default or require an explicit toggle?
4. Should MVP include a SQLite/SQL backup download, or only TXT ZIP export?
5. Is Writer app re-import compatibility required later?

## 20. Success Criteria

The first production-ready version is successful when:

1. The imported Turso database matches the local backup table counts.
2. A user can securely log in on the Netlify-hosted Nuxt app.
3. The user can browse folders and articles without exposing database credentials.
4. The user can edit an article and see the change persist in Turso.
5. The user can soft-delete and restore articles.
6. The user can inspect all tables safely.
7. The user can download a ZIP export containing folder-based `.txt` backups.
8. No writing content is visible without authentication.
9. The mobile UI supports browsing, reading, editing, searching, and saving without layout overlap.
