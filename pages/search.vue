<script setup lang="ts">
import type { Pagination } from '#shared/types/writer'
import { apiErrorMessage, formatWriterDate, isDeleted } from '~/utils/writer'

interface SearchResult {
  id: string
  folderId: string
  folderName?: string
  title: string
  excerpt: string
  count: number | null
  updateTime: number
  deleted: number | boolean
}

useHead({ title: 'Search · Writer Archive' })

const route = useRoute()
const router = useRouter()
const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const includeDeleted = ref(route.query.deleted === '1')
const items = ref<SearchResult[]>([])
const pagination = ref<Pagination>({
  page: 1,
  pageSize: 25,
  total: 0,
  totalPages: 1,
})
const loading = ref(false)
const searched = ref(false)
const errorMessage = ref('')

async function search(page = 1) {
  const normalized = query.value.trim()
  if (!normalized) {
    items.value = []
    searched.value = false
    return
  }

  loading.value = true
  errorMessage.value = ''
  await router.replace({
    query: { q: normalized, ...(includeDeleted.value ? { deleted: '1' } : {}) },
  })

  try {
    const response = await $fetch<{
      items: SearchResult[]
      pagination: Pagination
    }>('/api/search', {
      query: {
        q: normalized,
        includeDeleted: includeDeleted.value,
        page,
        pageSize: 25,
      },
    })
    items.value = response.items
    pagination.value = response.pagination
    searched.value = true
  } catch (error) {
    errorMessage.value = apiErrorMessage(
      error,
      'Search is unavailable right now.',
    )
  } finally {
    loading.value = false
  }
}

function folderLink(item: SearchResult) {
  return {
    path: '/',
    query: {
      folder: item.folderId,
      view: 'folders',
      ...(includeDeleted.value ? { folderStatus: 'all' } : {}),
    },
  }
}

onMounted(() => {
  if (query.value.trim()) void search()
})
</script>

<template>
  <div class="content-page search-page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Across your archive</p>
        <h1>Search</h1>
        <p>
          Find phrases in article titles and content without loading full
          documents.
        </p>
      </div>
    </header>

    <form class="search-form" @submit.prevent="search(1)">
      <UInput
        v-model="query"
        icon="i-lucide-search"
        placeholder="Search titles and article text"
        size="xl"
        autofocus
      />
      <label class="check-label">
        <input v-model="includeDeleted" type="checkbox">
        Include deleted articles
      </label>
      <UButton
        type="submit"
        label="Search"
        icon="i-lucide-search"
        size="lg"
        :loading="loading"
      />
    </form>

    <p v-if="errorMessage" class="page-alert" role="alert">
      {{ errorMessage }}
    </p>

    <div v-if="loading" class="large-state">
      <UIcon name="i-lucide-loader-circle" class="animate-spin" /> Searching…
    </div>
    <div v-else-if="searched && items.length === 0" class="large-state">
      <UIcon name="i-lucide-search-x" />
      <strong>No matches found</strong>
      <span>Try a shorter or broader phrase.</span>
    </div>
    <div v-else-if="!searched" class="large-state">
      <UIcon name="i-lucide-text-search" />
      <strong>Search your writing</strong>
      <span
        >Results include only a short excerpt; full content stays in article
        view.</span
      >
    </div>

    <section v-else class="results-list" aria-live="polite">
      <header class="results-summary">
        <strong>{{ pagination.total.toLocaleString() }} results</strong>
        <span>for “{{ route.query.q }}”</span>
      </header>
      <NuxtLink
        v-for="item in items"
        :key="item.id"
        :to="folderLink(item)"
        class="search-result"
      >
        <span class="result-kicker">
          <UIcon name="i-lucide-folder" />
          {{ item.folderName || item.folderId }}
          <UBadge
            v-if="isDeleted(item.deleted)"
            color="error"
            variant="subtle"
            size="sm"
            >Deleted</UBadge
          >
        </span>
        <strong>{{ item.title || 'Untitled' }}</strong>
        <p>{{ item.excerpt }}</p>
        <span class="row-meta">
          {{ Number(item.count ?? 0).toLocaleString() }} words · Updated
          {{ formatWriterDate(item.updateTime) }}
        </span>
      </NuxtLink>

      <footer
        v-if="pagination.totalPages > 1"
        class="pagination-bar page-pagination"
      >
        <UButton
          label="Previous"
          color="neutral"
          variant="outline"
          :disabled="pagination.page <= 1"
          @click="search(pagination.page - 1)"
        />
        <span>Page {{ pagination.page }} of {{ pagination.totalPages }}</span>
        <UButton
          label="Next"
          color="neutral"
          variant="outline"
          :disabled="pagination.page >= pagination.totalPages"
          @click="search(pagination.page + 1)"
        />
      </footer>
    </section>
  </div>
</template>
