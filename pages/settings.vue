<script setup lang="ts">
import type { PublicAdminUser } from '#shared/types/writer'
import { apiErrorMessage } from '~/utils/writer'

useHead({ title: 'Settings · Writer Archive' })

const colorMode = useColorMode()
const user = ref<PublicAdminUser | null>(null)
const password = ref('')
const confirming = ref(false)
const confirmationMessage = ref('')
const errorMessage = ref('')

async function loadSession() {
  try {
    const response = await $fetch<{ authenticated: boolean; user: PublicAdminUser | null }>('/api/auth/session')
    user.value = response.user
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Session details could not be loaded.')
  }
}

async function confirmPassword() {
  confirming.value = true
  confirmationMessage.value = ''
  errorMessage.value = ''
  try {
    await $fetch('/api/auth/confirm-password', { method: 'POST', body: { password: password.value } })
    confirmationMessage.value = 'Password confirmed. Sensitive actions are unlocked for this request.'
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Password confirmation failed.')
  } finally {
    password.value = ''
    confirming.value = false
  }
}

onMounted(loadSession)
</script>

<template>
  <div class="content-page settings-page">
    <header class="page-heading"><p class="eyebrow">Workspace preferences</p><h1>Settings</h1><p>Manage the local appearance and verify your admin session.</p></header>
    <p v-if="errorMessage" class="page-alert" role="alert">{{ errorMessage }}</p>

    <div class="settings-grid">
      <section class="settings-card">
        <header><span class="settings-icon"><UIcon name="i-lucide-palette" /></span><div><h2>Appearance</h2><p>Applied on this browser.</p></div></header>
        <label class="field-label"><span>Theme</span><select v-model="colorMode.preference" class="native-select"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      </section>

      <section class="settings-card">
        <header><span class="settings-icon"><UIcon name="i-lucide-user-round" /></span><div><h2>Admin account</h2><p>Created and reset through the server setup script.</p></div></header>
        <dl class="account-details"><div><dt>Name</dt><dd>{{ user?.name || 'Admin' }}</dd></div><div><dt>Email</dt><dd>{{ user?.email || 'Loading…' }}</dd></div><div><dt>Role</dt><dd>Single administrator</dd></div></dl>
      </section>

      <section class="settings-card wide">
        <header><span class="settings-icon"><UIcon name="i-lucide-shield-check" /></span><div><h2>Confirm password</h2><p>Re-verify your password before a sensitive operation.</p></div></header>
        <form class="confirmation-form" @submit.prevent="confirmPassword">
          <UInput v-model="password" type="password" autocomplete="current-password" placeholder="Current password" required />
          <UButton type="submit" label="Confirm" :loading="confirming" />
        </form>
        <p v-if="confirmationMessage" class="success-message"><UIcon name="i-lucide-check" /> {{ confirmationMessage }}</p>
      </section>
    </div>
  </div>
</template>
