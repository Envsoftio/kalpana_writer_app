<script setup lang="ts">
definePageMeta({ layout: 'blank' })

useHead({ title: 'Sign in · Writer Archive' })

const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')
const route = useRoute()
const { fetch: refreshSession, loggedIn } = useUserSession()

function getSafeRedirect(): string {
  const redirect = route.query.redirect

  return typeof redirect === 'string' &&
    redirect.startsWith('/') &&
    !redirect.startsWith('//')
    ? redirect
    : '/'
}

async function login() {
  errorMessage.value = ''
  loading.value = true

  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { email: email.value, password: password.value },
    })

    // The login endpoint updates the cookie, but the route middleware reads
    // nuxt-auth-utils' client state. Refresh it before navigating so the
    // middleware does not immediately send the user back to /login.
    await refreshSession()

    if (!loggedIn.value) {
      throw new Error('The session could not be refreshed after signing in.')
    }

    password.value = ''
    await navigateTo(getSafeRedirect(), { replace: true })
  } catch (error) {
    const response = error as {
      data?: { statusMessage?: string; message?: string }
      statusMessage?: string
    }
    errorMessage.value =
      response.data?.statusMessage ||
      response.data?.message ||
      response.statusMessage ||
      'Unable to sign in. Check your credentials and try again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-card">
      <div class="brand login-brand">
        <span class="brand-mark"><UIcon name="i-lucide-pen-line" /></span>
        <span>
          <strong>Writer Archive</strong>
          <small>Private writing workspace</small>
        </span>
      </div>

      <div>
        <h1>Welcome back</h1>
        <p>Your archive is protected. Sign in with the admin account.</p>
      </div>

      <form class="grid gap-4" @submit.prevent="login">
        <label class="field-label">
          <span>Email</span>
          <UInput
            v-model="email"
            type="email"
            autocomplete="username"
            icon="i-lucide-mail"
            size="lg"
            required
            autofocus
          />
        </label>
        <label class="field-label">
          <span>Password</span>
          <UInput
            v-model="password"
            type="password"
            autocomplete="current-password"
            icon="i-lucide-lock-keyhole"
            size="lg"
            required
          />
        </label>

        <p v-if="errorMessage" class="form-error" role="alert">
          {{ errorMessage }}
        </p>

        <UButton
          type="submit"
          label="Sign in"
          icon="i-lucide-log-in"
          size="lg"
          block
          :loading="loading"
        />
      </form>

      <p class="login-footnote">
        There is no public signup. The admin account is managed with the server-side
        setup script.
      </p>
    </section>
  </main>
</template>
