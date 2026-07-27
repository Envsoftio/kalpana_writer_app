const SESSION_REFRESH_INTERVAL_MS = 45 * 60 * 1000

export default defineNuxtPlugin(() => {
  const { fetch: refreshSession } = useUserSession()
  let refreshPromise: Promise<void> | null = null

  const refresh = () => {
    refreshPromise ??= refreshSession()
      .catch(() => {
        // The route middleware/API guards handle anonymous sessions.
      })
      .finally(() => {
        refreshPromise = null
      })

    return refreshPromise
  }

  refresh()

  const intervalId = window.setInterval(refresh, SESSION_REFRESH_INTERVAL_MS)
  const refreshWhenVisible = () => {
    if (document.visibilityState === 'visible') {
      refresh()
    }
  }

  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', refreshWhenVisible)

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    })
  }
})
