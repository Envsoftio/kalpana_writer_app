# Writer Web Archive

A private Nuxt application for browsing, editing, searching, and exporting a Writer backup through a Turso/libSQL database.

## Requirements

- Node.js 24 or newer
- npm 11 or newer
- Turso CLI access for the database import phase

## Local Setup

Install dependencies:

```bash
npm install
```

Copy the environment template:

```bash
cp .env.example .env
```

Fill in:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `NUXT_SESSION_PASSWORD`
- `ADMIN_EMAIL`

Start the Nuxt development server:

```bash
npm run dev
```

The local app will be available at the URL printed by Nuxt, usually `http://localhost:3000`.

Run the complete repository verification before deploying:

```bash
npm run verify
```

## UI Direction

The application uses Nuxt UI with Tailwind CSS for the component system. Nuxt UI is the default UI foundation because it is Nuxt-native, accessible, themeable, and includes the dashboard, navigation, form, table, overlay, editor, icon, and color-mode pieces this private writing workspace needs.

Theme selection is enabled through Nuxt UI's built-in color-mode integration. The app supports `system`, `light`, and `dark` preferences and stores the choice in local storage.

## Database Source

The original Writer backup in this workspace is:

```txt
WriterBackup-40books-3983articles-0719201745-v28.9.2-Galaxy-S9+.db
```

Phase 1 imports this SQLite file into Turso and adds the app-owned tables required for authentication, audit logging, and exports.

## Phase 1 Database Setup

Verify the local backup before importing:

```bash
npm run db:verify-source
```

Create the Turso database from the SQLite file:

```bash
turso db create writer --from-file ./WriterBackup-40books-3983articles-0719201745-v28.9.2-Galaxy-S9+.db
```

Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env`, then verify the imported Writer tables and key row counts:

```bash
npm run db:verify-import
```

Create the app-owned tables and create or reset the single admin account:

```bash
npm run db:setup-admin
```

For non-interactive setup, provide the password through the shell instead of storing it in `.env`:

```bash
ADMIN_PASSWORD='replace-with-a-long-password' npm run db:setup-admin
```

After app tables are created, verify the production database shape and key counts:

```bash
npm run db:verify-production
```

`db:setup-admin` is idempotent. Rerun it with the same `ADMIN_EMAIL` and a new password to reset the admin login.

## Recovery Process

### Reset the admin password

Set the same `ADMIN_EMAIL`, then run `npm run db:setup-admin`. Use the hidden interactive prompt, or pass `ADMIN_PASSWORD` as a one-off shell variable in non-interactive environments. Existing sessions are invalidated when the password timestamp changes.

### Export a human-readable backup

Sign in, open **Backups**, choose whether deleted items should be included, and create the TXT ZIP. Individual article and folder exports are also available from the Library.

### Verify Turso data

Run the table-list and key-count checks against the configured database:

```bash
npm run db:verify-production
```

Expected source counts are `Article=4472`, `Folder=46`, `Category=2`, and `Daily=14541`. Run this after imports, recovery operations, or environment changes.

## Server Foundation

Server API routes use the utilities in `server/utils`:

- `getDatabaseClient(event)` returns a cached, server-only Turso/libSQL client.
- `startAdminSession`, `getAdminSession`, and `endAdminSession` manage the sealed admin session.
- `defineProtectedEventHandler` rejects requests without a valid admin session before running a route handler.
- `validateBody`, `validateQuery`, and `validateRouteParams` produce consistent validation errors without echoing submitted values.
- `writeAuditLog` records write/export activity while redacting credential and article-content fields.

Private Turso values live only in Nuxt's private runtime config or the server process environment. Nothing under `runtimeConfig.public` contains database credentials.

## Application Features

- A responsive three-pane desktop library, two-pane tablet workspace, and mobile drill-down flow.
- Folder and article create/edit, move, soft-delete, restore, filters, ordering, and pagination.
- Plain-text reading and editing with manual save, debounced autosave, local draft recovery, focus mode, in-article search, and metadata.
- Global title/content search that returns excerpts instead of full article bodies.
- Daily writing totals, date range, and top folders.
- A read-only, allowlisted table explorer with truncated grid cells, protected full-row detail, and credential-field redaction.
- Full TXT ZIP, single-folder ZIP, and single-article TXT exports with stable ordering and reconstruction metadata.

All API routes except login and session discovery require the sealed admin session. There is intentionally no signup endpoint.

## Export Validation and Hosting Limit

Run the deterministic export checks with `npm run validate:export`.

The source backup currently produces roughly 23 MB of compressed data, which is larger than a Netlify Function response. Full backups are assembled incrementally in the authenticated browser from bounded data pages, producing one complete ZIP without loading all source text into memory at once. Single-article and normal single-folder exports remain separate downloads.

## Deployment

Netlify builds the SSR Nuxt app with:

```bash
npm run build
```

The included `netlify.toml` publishes `dist` and uses the Netlify Nitro preset. Configure the environment variables in Netlify before deploying so Turso credentials remain server-side only.

After deployment, verify anonymous redirects and API rejection, HTTPS login/logout, browsing/search/stats/table detail, a reversible create/edit/delete/restore flow, downloads, and `npm run db:verify-production`. Do not deploy as a static-generated site: authentication and database operations rely on Nitro server routes.
