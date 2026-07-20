export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()
  const isLoginRoute = to.path === '/login'

  if (!loggedIn.value && !isLoginRoute) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath },
    })
  }

  if (loggedIn.value && isLoginRoute) {
    return navigateTo('/')
  }
})
