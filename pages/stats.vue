<script setup lang="ts">
import { apiErrorMessage } from '~/utils/writer'

interface DailyPoint {
  date: string
  wordCount: number
}

interface FolderTotal {
  folderId: string
  folderName?: string
  folderTitle?: string
  wordCount: number
}

interface StatsResponse {
  range: { from: string | null; to: string | null }
  totals: { words: number; days?: number; entries?: number }
  byDate: DailyPoint[]
  topFolders: FolderTotal[]
}

useHead({ title: 'Stats · Writer Archive' })

const stats = ref<StatsResponse | null>(null)
const loading = ref(true)
const errorMessage = ref('')
const from = ref('')
const to = ref('')

const maxWords = computed(() => Math.max(1, ...(stats.value?.byDate.map((item) => item.wordCount) ?? [1])))

async function loadStats() {
  loading.value = true
  errorMessage.value = ''
  try {
    stats.value = await $fetch<StatsResponse>('/api/stats/daily', {
      query: { ...(from.value ? { from: from.value } : {}), ...(to.value ? { to: to.value } : {}) },
    })
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Writing statistics could not be loaded.')
  } finally {
    loading.value = false
  }
}

onMounted(loadStats)
</script>

<template>
  <div class="content-page">
    <header class="page-heading split-heading">
      <div>
        <p class="eyebrow">Daily table</p>
        <h1>Writing stats</h1>
        <p>A compact view of recorded words, dates, and your most active folders.</p>
      </div>
      <form class="date-filter" @submit.prevent="loadStats">
        <label>From <input v-model="from" type="date"></label>
        <label>To <input v-model="to" type="date"></label>
        <UButton type="submit" label="Apply" size="sm" :loading="loading" />
      </form>
    </header>

    <p v-if="errorMessage" class="page-alert" role="alert">{{ errorMessage }}</p>
    <div v-if="loading" class="large-state"><UIcon name="i-lucide-loader-circle" class="animate-spin" /> Loading stats…</div>

    <template v-else-if="stats">
      <section class="stat-grid">
        <article class="stat-card">
          <span>Total words</span>
          <strong>{{ Number(stats.totals.words ?? 0).toLocaleString() }}</strong>
        </article>
        <article class="stat-card">
          <span>Date range</span>
          <strong class="stat-date">{{ stats.range.from || '—' }} <small>to</small> {{ stats.range.to || '—' }}</strong>
        </article>
        <article class="stat-card">
          <span>Recorded days</span>
          <strong>{{ Number(stats.totals.days ?? stats.byDate.length).toLocaleString() }}</strong>
        </article>
      </section>

      <div class="dashboard-grid">
        <section class="data-card">
          <header><h2>Words by date</h2><span>Latest {{ stats.byDate.length }} points</span></header>
          <div v-if="stats.byDate.length" class="mini-chart" aria-label="Daily word count bar chart">
            <div v-for="point in stats.byDate.slice(-60)" :key="point.date" class="chart-column" :title="`${point.date}: ${point.wordCount.toLocaleString()} words`">
              <span :style="{ height: `${Math.max(2, (point.wordCount / maxWords) * 100)}%` }" />
            </div>
          </div>
          <p v-else class="card-empty">No daily records in this date range.</p>
        </section>

        <section class="data-card">
          <header><h2>Top folders</h2><span>By recorded words</span></header>
          <ol class="ranking-list">
            <li v-for="(folder, index) in stats.topFolders" :key="folder.folderId">
              <span class="rank-number">{{ index + 1 }}</span>
              <span class="min-w-0 flex-1 truncate">{{ folder.folderName || folder.folderTitle || folder.folderId }}</span>
              <strong>{{ Number(folder.wordCount ?? 0).toLocaleString() }}</strong>
            </li>
          </ol>
          <p v-if="!stats.topFolders.length" class="card-empty">No folder totals are available.</p>
        </section>
      </div>
    </template>
  </div>
</template>
