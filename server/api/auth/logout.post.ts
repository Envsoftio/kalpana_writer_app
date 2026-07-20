export default defineEventHandler(async (event) => {
  await endAdminSession(event)

  return {
    authenticated: false,
    user: null,
  }
})
