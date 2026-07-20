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

## Server Foundation

Server API routes use the utilities in `server/utils`:

- `getDatabaseClient(event)` returns a cached, server-only Turso/libSQL client.
- `startAdminSession`, `getAdminSession`, and `endAdminSession` manage the sealed admin session.
- `defineProtectedEventHandler` rejects requests without a valid admin session before running a route handler.
- `validateBody`, `validateQuery`, and `validateRouteParams` produce consistent validation errors without echoing submitted values.
- `writeAuditLog` records write/export activity while redacting credential and article-content fields.

Private Turso values live only in Nuxt's private runtime config or the server process environment. Nothing under `runtimeConfig.public` contains database credentials.

## Deployment

Netlify builds the SSR Nuxt app with:

```bash
npm run build
```

The included `netlify.toml` publishes `.output/public` and uses the Netlify Nitro preset. Configure the environment variables in Netlify before deploying so Turso credentials remain server-side only.
