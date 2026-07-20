<script setup lang="ts">
const route = useRoute()

const navItems = [
  { label: 'Library', icon: 'i-lucide-library', to: '/' },
  { label: 'Search', icon: 'i-lucide-search', to: '/search' },
  { label: 'Stats', icon: 'i-lucide-chart-no-axes-column', to: '/stats' },
  { label: 'Tables', icon: 'i-lucide-table-2', to: '/tables' },
  { label: 'Backups', icon: 'i-lucide-archive', to: '/backups' },
  { label: 'Settings', icon: 'i-lucide-settings-2', to: '/settings' },
]

const loggingOut = ref(false)

async function logout() {
  loggingOut.value = true
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
    await navigateTo('/login')
  } finally {
    loggingOut.value = false
  }
}

function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}
</script>

<template>
  <div class="app-frame">
    <header class="app-header">
      <NuxtLink to="/" class="brand" aria-label="Writer Archive home">
        <span class="brand-mark"><UIcon name="i-lucide-pen-line" /></span>
        <span class="min-w-0">
          <strong>Writer Archive</strong>
          <small>Private writing workspace</small>
        </span>
      </NuxtLink>

      <div class="header-actions">
        <UColorModeSelect
          color="neutral"
          variant="subtle"
          size="sm"
          class="hidden w-32 sm:block"
          aria-label="Theme"
        />
        <UButton
          icon="i-lucide-log-out"
          color="neutral"
          variant="ghost"
          :loading="loggingOut"
          aria-label="Log out"
          @click="logout"
        />
      </div>
    </header>

    <div class="app-body">
      <aside class="primary-sidebar" aria-label="Primary navigation">
        <nav class="grid gap-1">
          <UButton
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            :icon="item.icon"
            :label="item.label"
            :color="isActive(item.to) ? 'primary' : 'neutral'"
            :variant="isActive(item.to) ? 'soft' : 'ghost'"
            class="justify-start"
          />
        </nav>
      </aside>

      <main class="app-main">
        <slot />
      </main>
    </div>

    <nav class="mobile-nav" aria-label="Mobile navigation">
      <NuxtLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        :class="{ active: isActive(item.to) }"
      >
        <UIcon :name="item.icon" />
        <span>{{ item.label }}</span>
      </NuxtLink>
    </nav>
  </div>
</template>
