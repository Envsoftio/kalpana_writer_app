export default defineNuxtConfig({
  compatibilityDate: '2026-07-20',
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  modules: ['nuxt-auth-utils', '@nuxt/ui', '@nuxt/eslint'],
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
