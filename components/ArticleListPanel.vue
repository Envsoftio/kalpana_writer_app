<script setup lang="ts">
import type { ArticleSummary, FolderRecord, Pagination } from '#shared/types/writer'
import { formatWriterDate, isDeleted } from '~/utils/writer'

defineProps<{
  folder: FolderRecord | null
  articles: ArticleSummary[]
  selectedId: string | null
  loading: boolean
  status: 'active' | 'deleted' | 'all'
  sort: string
  pagination: Pagination
}>()

const emit = defineEmits<{
  back: []
  select: [article: ArticleSummary]
  create: []
  status: [value: 'active' | 'deleted' | 'all']
  sort: [value: string]
  page: [value: number]
}>()

const sortOptions = [
  { value: 'rank', label: 'Folder order' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Recently created' },
  { value: 'title', label: 'Title' },
  { value: 'count', label: 'Word count' },
]
</script>

<template>
  <section class="pane article-list-pane" aria-label="Articles">
    <header class="pane-header">
      <UButton
        class="mobile-back"
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="ghost"
        aria-label="Back to folders"
        @click="emit('back')"
      />
      <div class="min-w-0 flex-1">
        <p class="eyebrow">Folder</p>
        <h1 class="truncate">{{ folder?.name ?? 'Choose a folder' }}</h1>
      </div>
      <UButton
        icon="i-lucide-file-plus-2"
        size="sm"
        :disabled="!folder"
        aria-label="Create article"
        @click="emit('create')"
      />
    </header>

    <div class="list-controls">
      <select
        :value="sort"
        class="native-select"
        aria-label="Sort articles"
        @change="emit('sort', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="option in sortOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <select
        :value="status"
        class="native-select"
        aria-label="Article status"
        @change="emit('status', ($event.target as HTMLSelectElement).value as 'active' | 'deleted' | 'all')"
      >
        <option value="active">Active</option>
        <option value="deleted">Deleted</option>
        <option value="all">All</option>
      </select>
    </div>

    <div v-if="!folder" class="pane-state grow">
      <UIcon name="i-lucide-mouse-pointer-click" />
      Select a folder to browse its articles.
    </div>
    <div v-else-if="loading" class="pane-state grow">
      <UIcon name="i-lucide-loader-circle" class="animate-spin" />
      Loading articles…
    </div>
    <div v-else-if="articles.length === 0" class="pane-state grow">
      <UIcon name="i-lucide-file-text" />
      No articles match this filter.
    </div>

    <div v-else class="article-list scroll-region">
      <button
        v-for="article in articles"
        :key="article.id"
        class="article-row"
        :class="{ selected: article.id === selectedId }"
        @click="emit('select', article)"
      >
        <span class="row-title">
          {{ article.title || 'Untitled' }}
          <span v-if="article.id === selectedId" class="active-dot" />
        </span>
        <span class="row-excerpt">{{ article.summary || article.excerpt || 'No preview available' }}</span>
        <span class="row-meta">
          <UBadge v-if="isDeleted(article.deleted)" color="error" variant="subtle" size="sm">Deleted</UBadge>
          <span>{{ Number(article.count ?? 0).toLocaleString() }} words</span>
          <span>·</span>
          <span>{{ formatWriterDate(article.updateTime) }}</span>
        </span>
      </button>
    </div>

    <footer v-if="pagination.totalPages > 1" class="pane-footer pagination-bar">
      <UButton
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="ghost"
        size="sm"
        :disabled="pagination.page <= 1"
        aria-label="Previous page"
        @click="emit('page', pagination.page - 1)"
      />
      <span>Page {{ pagination.page }} of {{ pagination.totalPages }}</span>
      <UButton
        icon="i-lucide-chevron-right"
        color="neutral"
        variant="ghost"
        size="sm"
        :disabled="pagination.page >= pagination.totalPages"
        aria-label="Next page"
        @click="emit('page', pagination.page + 1)"
      />
    </footer>
  </section>
</template>
