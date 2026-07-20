import { z } from 'zod'

const confirmPasswordBodySchema = z.object({
  password: z.string().min(1).max(200),
})

export default defineProtectedEventHandler(async (event, session) => {
  const { password } = await validateBody(event, confirmPasswordBodySchema)
  const rateLimitIdentity = getLoginRateLimitIdentity(event, session.user.email)
  assertLoginRateLimit(event, rateLimitIdentity)

  const admin = await loadAdminCredentials(event, session.user.email)
  const now = Date.now()

  if (admin?.lockedUntil && admin.lockedUntil > now) {
    rejectDatabaseLockout(event, admin.lockedUntil)
  }

  if (!admin || !(await passwordMatchesAdmin(password, admin))) {
    recordLoginFailure(rateLimitIdentity)

    if (admin) {
      const lockedUntil = await recordDatabaseLoginFailure(event, now)

      if (lockedUntil && lockedUntil > now) {
        rejectDatabaseLockout(event, lockedUntil)
      }
    }

    throw createError({
      statusCode: 401,
      statusMessage: 'Password confirmation failed.',
    })
  }

  await clearDatabaseLoginFailures(event, now)
  clearLoginFailures(rateLimitIdentity)

  return { confirmed: true }
})
