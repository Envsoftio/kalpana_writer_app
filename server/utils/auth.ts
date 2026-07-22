import { createHash, randomBytes } from 'node:crypto'
import type { UserSessionRequired } from '#auth-utils'
import type { H3Event } from 'h3'

export const ADMIN_USER_ID = 'admin' as const
export const ADMIN_REFRESH_COOKIE_NAME = 'writer-refresh-token'

const REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 90
const REFRESH_TOKEN_RETENTION_MS = 60 * 60 * 24 * 7 * 1000
let refreshTokenSchemaPromise: Promise<void> | undefined

export interface AdminSessionUser {
  id: typeof ADMIN_USER_ID
  email: string
  name: string | null
  role: 'admin'
}

export type AdminSession = UserSessionRequired & {
  user: AdminSessionUser
  loggedInAt: number
  passwordUpdatedAt: number
}

export interface StartAdminSessionInput {
  email: string
  name?: string | null
  passwordUpdatedAt: number
}

/** Creates a fresh sealed-cookie session after the password has been verified. */
export async function startAdminSession(
  event: H3Event,
  input: StartAdminSessionInput,
): Promise<AdminSession> {
  await replaceUserSession(event, {
    user: {
      id: ADMIN_USER_ID,
      email: input.email.trim().toLowerCase(),
      name: input.name?.trim() || null,
      role: 'admin',
    },
    loggedInAt: Date.now(),
    passwordUpdatedAt: input.passwordUpdatedAt,
  })

  return assertAdminSession(await getUserSession(event))
}

/**
 * Creates a persistent, revocable credential used only to renew the sealed
 * access session. Only its SHA-256 digest is stored in the database.
 */
export async function startAdminRefreshToken(event: H3Event): Promise<void> {
  await ensureRefreshTokenSchema(event)

  const token = randomBytes(48).toString('base64url')
  const tokenHash = hashRefreshToken(token)
  const previousToken = getCompatibleCookie(event, ADMIN_REFRESH_COOKIE_NAME)
  const now = Date.now()
  const expiresAt = getRefreshTokenExpiry(now)
  const database = getDatabaseClient(event)

  await database.execute({
    sql: `
      INSERT INTO app_refresh_token (
        token_hash,
        user_id,
        password_updated_at,
        created_at,
        expires_at,
        last_used_at,
        revoked_at
      )
      SELECT ?, id, password_updated_at, ?, ?, ?, NULL
      FROM app_user
      WHERE id = ? AND role = 'admin' AND deleted = 0
    `,
    args: [tokenHash, now, expiresAt, now, ADMIN_USER_ID],
  })

  if (previousToken) {
    await revokeRefreshToken(event, previousToken, now)
  }

  await database.execute({
    sql: `
      DELETE FROM app_refresh_token
      WHERE expires_at <= ?
         OR (revoked_at IS NOT NULL AND revoked_at <= ?)
    `,
    args: [now, now - REFRESH_TOKEN_RETENTION_MS],
  })

  setRefreshTokenCookie(event, token)
}

/** Returns a valid admin session, or null when the request is anonymous. */
export async function getAdminSession(
  event: H3Event,
): Promise<AdminSession | null> {
  const session = await getUserSession(event)

  if (
    isAdminSession(session) &&
    (await isCurrentAdminSession(event, session))
  ) {
    return session
  }

  if (isRecord(session) && session.user !== undefined) {
    await clearUserSession(event)
  }

  return refreshAdminSession(event)
}

/** Rejects anonymous or malformed sessions with a consistent API response. */
export async function requireAdminSession(
  event: H3Event,
): Promise<AdminSession> {
  const session = await getAdminSession(event)

  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Authentication required.',
    })
  }

  return session
}

export async function endAdminSession(event: H3Event): Promise<void> {
  const refreshToken = getCompatibleCookie(event, ADMIN_REFRESH_COOKIE_NAME)

  try {
    if (refreshToken) {
      await ensureRefreshTokenSchema(event)
      await revokeRefreshToken(event, refreshToken, Date.now())
    }
  } catch {
    // Local logout must still succeed if the database is temporarily down.
  } finally {
    clearRefreshTokenCookie(event)
    await clearUserSession(event)
  }
}

async function refreshAdminSession(
  event: H3Event,
): Promise<AdminSession | null> {
  const token = getCompatibleCookie(event, ADMIN_REFRESH_COOKIE_NAME)

  if (!token) {
    return null
  }

  await ensureRefreshTokenSchema(event)

  const tokenHash = hashRefreshToken(token)
  const now = Date.now()
  const result = await getDatabaseClient(event).execute({
    sql: `
      SELECT
        user.email,
        user.name,
        user.password_updated_at AS passwordUpdatedAt
      FROM app_refresh_token AS refresh
      JOIN app_user AS user ON user.id = refresh.user_id
      WHERE refresh.token_hash = ?
        AND refresh.user_id = ?
        AND refresh.revoked_at IS NULL
        AND refresh.expires_at > ?
        AND refresh.password_updated_at = user.password_updated_at
        AND user.role = 'admin'
        AND user.deleted = 0
      LIMIT 1
    `,
    args: [tokenHash, ADMIN_USER_ID, now],
  })
  const row = result.rows[0]

  if (
    !row ||
    typeof row.email !== 'string' ||
    (row.name !== null && typeof row.name !== 'string') ||
    !Number.isFinite(Number(row.passwordUpdatedAt))
  ) {
    clearRefreshTokenCookie(event)
    return null
  }

  const expiresAt = getRefreshTokenExpiry(now)
  const renewed = await getDatabaseClient(event).execute({
    sql: `
      UPDATE app_refresh_token
      SET last_used_at = ?, expires_at = ?
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
    `,
    args: [now, expiresAt, tokenHash, now],
  })

  if (renewed.rowsAffected !== 1) {
    clearRefreshTokenCookie(event)
    return null
  }

  const session = await startAdminSession(event, {
    email: row.email,
    name: row.name,
    passwordUpdatedAt: Number(row.passwordUpdatedAt),
  })

  // Sliding refresh expiry keeps active writers signed in while still
  // expiring credentials that have not been used for 90 days.
  setRefreshTokenCookie(event, token)
  return session
}

function assertAdminSession(session: unknown): AdminSession {
  if (!isAdminSession(session)) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Unable to create the admin session.',
    })
  }

  return session
}

function isAdminSession(value: unknown): value is AdminSession {
  if (!isRecord(value) || !isRecord(value.user)) {
    return false
  }

  return (
    value.user.id === ADMIN_USER_ID &&
    value.user.role === 'admin' &&
    typeof value.user.email === 'string' &&
    value.user.email.length > 0 &&
    (value.user.name === null || typeof value.user.name === 'string') &&
    typeof value.loggedInAt === 'number' &&
    Number.isFinite(value.loggedInAt) &&
    typeof value.passwordUpdatedAt === 'number' &&
    Number.isFinite(value.passwordUpdatedAt)
  )
}

async function isCurrentAdminSession(
  event: H3Event,
  session: AdminSession,
): Promise<boolean> {
  const result = await getDatabaseClient(event).execute({
    sql: `
      SELECT email, password_updated_at AS passwordUpdatedAt
      FROM app_user
      WHERE id = ? AND role = 'admin' AND deleted = 0
      LIMIT 1
    `,
    args: [ADMIN_USER_ID],
  })
  const row = result.rows[0]
  const valid =
    row !== undefined &&
    typeof row.email === 'string' &&
    row.email.trim().toLowerCase() === session.user.email &&
    Number(row.passwordUpdatedAt) === session.passwordUpdatedAt

  return valid
}

async function ensureRefreshTokenSchema(event: H3Event): Promise<void> {
  refreshTokenSchemaPromise ??= (async () => {
    const database = getDatabaseClient(event)

    await database.execute(`
      CREATE TABLE IF NOT EXISTS app_refresh_token (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'admin',
        password_updated_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        revoked_at INTEGER
      )
    `)
    await database.execute(`
      CREATE INDEX IF NOT EXISTS idx_app_refresh_token_user_expires
      ON app_refresh_token (user_id, expires_at)
    `)
  })().catch((error: unknown) => {
    refreshTokenSchemaPromise = undefined
    throw error
  })

  await refreshTokenSchemaPromise
}

async function revokeRefreshToken(
  event: H3Event,
  token: string,
  revokedAt: number,
): Promise<void> {
  await getDatabaseClient(event).execute({
    sql: `
      UPDATE app_refresh_token
      SET revoked_at = ?
      WHERE token_hash = ? AND revoked_at IS NULL
    `,
    args: [revokedAt, hashRefreshToken(token)],
  })
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function getRefreshTokenExpiry(now: number): number {
  return now + REFRESH_TOKEN_MAX_AGE_SECONDS * 1000
}

function setRefreshTokenCookie(event: H3Event, token: string): void {
  setCompatibleCookie(event, ADMIN_REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isCompatibleHttpsRequest(event),
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS,
  })
}

function clearRefreshTokenCookie(event: H3Event): void {
  deleteCompatibleCookie(event, ADMIN_REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isCompatibleHttpsRequest(event),
    sameSite: 'lax',
    path: '/',
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
