import bcrypt from 'bcryptjs'
import type { H3Event } from 'h3'

export const ADMIN_LOCKOUT_FAILURES = 5
export const ADMIN_LOCKOUT_MS = 15 * 60 * 1_000

const DUMMY_PASSWORD_HASH =
  '$2b$12$kBovzb7.0YYWf4M50kRMs.0QDnym/6bytJnV8MF7qlhZ6agbMrCcC'

export interface AdminCredentialRecord {
  email: string
  passwordHash: string
  name: string | null
  passwordUpdatedAt: number
  failedLoginCount: number
  lockedUntil: number | null
}

export async function loadAdminCredentials(
  event: H3Event,
  normalizedEmail: string,
): Promise<AdminCredentialRecord | null> {
  const result = await getDatabaseClient(event).execute({
    sql: `
      SELECT
        email,
        password_hash AS passwordHash,
        name,
        password_updated_at AS passwordUpdatedAt,
        failed_login_count AS failedLoginCount,
        locked_until AS lockedUntil
      FROM app_user
      WHERE id = ? AND lower(email) = ? AND role = 'admin' AND deleted = 0
      LIMIT 1
    `,
    args: [ADMIN_USER_ID, normalizedEmail],
  })
  const row = result.rows[0]

  if (
    !row ||
    typeof row.email !== 'string' ||
    typeof row.passwordHash !== 'string'
  ) {
    return null
  }

  return {
    email: row.email.trim().toLowerCase(),
    passwordHash: row.passwordHash,
    name: typeof row.name === 'string' ? row.name : null,
    passwordUpdatedAt: Number(row.passwordUpdatedAt),
    failedLoginCount: Number(row.failedLoginCount),
    lockedUntil: row.lockedUntil === null ? null : Number(row.lockedUntil),
  }
}

/** Always performs bcrypt work, including for an unknown email. */
export async function passwordMatchesAdmin(
  password: string,
  admin: AdminCredentialRecord | null,
): Promise<boolean> {
  return bcrypt.compare(password, admin?.passwordHash ?? DUMMY_PASSWORD_HASH)
}

export async function recordDatabaseLoginFailure(
  event: H3Event,
  now = Date.now(),
): Promise<number | null> {
  const lockUntil = now + ADMIN_LOCKOUT_MS

  await getDatabaseClient(event).execute({
    sql: `
      UPDATE app_user
      SET
        failed_login_count =
          CASE
            WHEN locked_until IS NOT NULL AND locked_until <= ? THEN 1
            ELSE failed_login_count + 1
          END,
        locked_until =
          CASE
            WHEN (
              CASE
                WHEN locked_until IS NOT NULL AND locked_until <= ? THEN 1
                ELSE failed_login_count + 1
              END
            ) >= ? THEN ?
            WHEN locked_until IS NOT NULL AND locked_until <= ? THEN NULL
            ELSE locked_until
          END,
        updated_at = ?
      WHERE id = ?
    `,
    args: [
      now,
      now,
      ADMIN_LOCKOUT_FAILURES,
      lockUntil,
      now,
      now,
      ADMIN_USER_ID,
    ],
  })

  const result = await getDatabaseClient(event).execute({
    sql: 'SELECT locked_until AS lockedUntil FROM app_user WHERE id = ? LIMIT 1',
    args: [ADMIN_USER_ID],
  })
  const value = result.rows[0]?.lockedUntil

  return value === null || value === undefined ? null : Number(value)
}

export async function recordSuccessfulLogin(
  event: H3Event,
  now = Date.now(),
): Promise<void> {
  await getDatabaseClient(event).execute({
    sql: `
      UPDATE app_user
      SET
        failed_login_count = 0,
        locked_until = NULL,
        last_login_at = ?,
        updated_at = ?
      WHERE id = ?
    `,
    args: [now, now, ADMIN_USER_ID],
  })
}

export async function clearDatabaseLoginFailures(
  event: H3Event,
  now = Date.now(),
): Promise<void> {
  await getDatabaseClient(event).execute({
    sql: `
      UPDATE app_user
      SET failed_login_count = 0, locked_until = NULL, updated_at = ?
      WHERE id = ?
    `,
    args: [now, ADMIN_USER_ID],
  })
}
