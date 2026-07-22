/**
 * Restore an expired access session before nuxt-auth-utils reads it. Protected
 * API handlers have the same fallback in requireAdminSession; this middleware
 * covers Nuxt's session discovery endpoint and server-rendered page requests.
 */
export default defineEventHandler(async (event) => {
  if (!getCompatibleCookie(event, ADMIN_REFRESH_COOKIE_NAME)) {
    return
  }

  const pathname = getCompatibleRequestPath(event)
  const acceptsHtml = getCompatibleRequestHeader(event, 'accept')?.includes(
    'text/html',
  )

  if (pathname === '/api/_auth/session' || acceptsHtml) {
    await getAdminSession(event)
  }
})
