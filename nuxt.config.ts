export default defineNuxtConfig({
  compatibilityDate: '2026-07-20',
  css: ['~/assets/css/main.css'],
  devtools: { enabled: process.env.NODE_ENV !== 'production' },
  modules: ['nuxt-auth-utils', '@nuxt/ui', '@nuxt/eslint'],
  experimental: {
    emitRouteChunkError: 'automatic-immediate',
  },
  nitro: {
    preset: 'netlify',
  },
  colorMode: {
    preference: 'system',
    fallback: 'light',
    classSuffix: '',
    storageKey: 'writer-theme',
  },
  runtimeConfig: {
    tursoDatabaseUrl: '',
    tursoAuthToken: '',
    adminEmail: '',
    session: {
      password: '',
      // Keep access sessions short-lived. The server transparently renews
      // them from the longer-lived, revocable refresh token.
      maxAge: 60 * 60,
      cookie: {
        sameSite: 'lax',
      },
    },
    public: {},
  },
  typescript: {
    strict: true,
  },
  ui: {
    theme: {
      colors: [
        'primary',
        'secondary',
        'success',
        'info',
        'warning',
        'error',
        'neutral',
      ],
    },
  },
})
