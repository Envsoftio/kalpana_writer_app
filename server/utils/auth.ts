import type { UserSessionRequired } from '#auth-utils'
import type { H3Event } from 'h3'

export const ADMIN_USER_ID = 'admin' as const

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

/** Returns a valid admin session, or null when the request is anonymous. */
export async function getAdminSession(
  event: H3Event,
): Promise<AdminSession | null> {
  const session = await getUserSession(event)

  if (!isAdminSession(session)) {
    if (isRecord(session) && session.user !== undefined) {
      await clearUserSession(event)
    }

    return null
  }

  return (await isCurrentAdminSession(event, session)) ? session : null
}

/** Rejects anonymous or malformed sessions with a consistent API response. */
export async function requireAdminSession(
  event: H3Event,
): Promise<AdminSession> {
  const session = await requireUserSession(event, {
    statusCode: 401,
    message: 'Authentication required.',
  })

  if (
    !isAdminSession(session) ||
    !(await isCurrentAdminSession(event, session))
  ) {
    await clearUserSession(event)

    throw createError({
      statusCode: 401,
      statusMessage: 'Authentication required.',
    })
  }

  return session
}

export async function endAdminSession(event: H3Event): Promise<void> {
  await clearUserSession(event)
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

  if (!valid) {
    await clearUserSession(event)
  }

  return valid
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
