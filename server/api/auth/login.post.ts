import { z } from 'zod'

const loginBodySchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1).max(200),
})

export default defineEventHandler(async (event) => {
  const { email, password } = await validateBody(event, loginBodySchema)
  const rateLimitIdentity = getLoginRateLimitIdentity(event, email)
  assertLoginRateLimit(event, rateLimitIdentity)

  const admin = await loadAdminCredentials(event, email)
  const now = Date.now()

  if (admin?.lockedUntil && admin.lockedUntil > now) {
    rejectDatabaseLockout(event, admin.lockedUntil)
  }

  const passwordMatches = await passwordMatchesAdmin(password, admin)

  if (!admin || !passwordMatches) {
    recordLoginFailure(rateLimitIdentity)

    if (admin) {
      const lockedUntil = await recordDatabaseLoginFailure(event, now)

      if (lockedUntil && lockedUntil > now) {
        rejectDatabaseLockout(event, lockedUntil)
      }
    }

    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid email or password.',
    })
  }

  await recordSuccessfulLogin(event, now)
  clearLoginFailures(rateLimitIdentity)
  const session = await startAdminSession(event, {
    email: admin.email,
    name: admin.name,
    passwordUpdatedAt: admin.passwordUpdatedAt,
  })

  try {
    await startAdminRefreshToken(event)
  } catch (error) {
    await endAdminSession(event)
    throw error
  }

  return {
    authenticated: true,
    user: session.user,
  }
})
