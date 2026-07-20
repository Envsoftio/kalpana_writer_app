export default defineEventHandler(async (event) => {
  const session = await getAdminSession(event)

  return session
    ? { authenticated: true, user: session.user }
    : { authenticated: false, user: null }
})
