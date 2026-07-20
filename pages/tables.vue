<script setup lang="ts">
import type { Pagination } from '#shared/types/writer'
import { apiErrorMessage } from '~/utils/writer'

type CellValue = string | number | boolean | null | { preview?: string; truncated?: boolean; type?: string }
type TableRow = Record<string, CellValue> & { __rowKey: string }

useHead({ title: 'Tables · Writer Archive' })

const route = useRoute()
const router = useRouter()
const tables = ref<string[]>([])
const selectedTable = ref(typeof route.query.table === 'string' ? route.query.table : '')
const columns = ref<string[]>([])
const rows = ref<TableRow[]>([])
const pagination = ref<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 1 })
const selectedRow = ref<Record<string, unknown> | null>(null)
const loading = ref(true)
const rowLoading = ref(false)
const errorMessage = ref('')

function columnName(column: unknown): string {
  if (typeof column === 'string') return column
  if (column && typeof column === 'object' && 'name' in column) return String((column as { name: unknown }).name)
  return String(column)
}

function renderCell(value: CellValue | undefined): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return value.preview ?? `[${value.type || 'hidden value'}]`
  return String(value)
}

async function loadTables() {
  loading.value = true
  try {
    const response = await $fetch<{ tables: Array<string | { name: string }> }>('/api/tables')
    tables.value = response.tables.map((table) => typeof table === 'string' ? table : table.name)
    if (!selectedTable.value && tables.value[0]) selectedTable.value = tables.value[0]
    if (selectedTable.value) await loadRows(1)
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, 'Database tables could not be loaded.')
  } finally {
    loading.value = false
  }
}

async function loadRows(page = 1) {
  if (!selectedTable.value) return
  loading.value = true
  errorMessage.value = ''
  selectedRow.value = null
  try {
    const response = await $fetch<{
      columns: unknown[]
      rows: TableRow[]
      pagination: Pagination
    }>(`/api/tables/${encodeURIComponent(selectedTable.value)}`, {
      query: { page, pageSize: 25 },
    })
    columns.value = response.columns.map(columnName)
    rows.value = response.rows
    pagination.value = response.pagination
    await router.replace({ query: { table: selectedTable.value } })
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, 'This table could not be opened.')
  } finally {
    loading.value = false
  }
}

async function openRow(row: TableRow) {
  rowLoading.value = true
  try {
    const response = await $fetch<{ row: Record<string, unknown> }>(
      `/api/tables/${encodeURIComponent(selectedTable.value)}/row`,
      { query: { key: row.__rowKey } },
    )
    selectedRow.value = response.row
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, 'The full row could not be loaded.')
  } finally {
    rowLoading.value = false
  }
}

function formatDetail(value: unknown): string {
  if (value === null) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

onMounted(loadTables)
</script>

<template>
  <div class="content-page table-page">
    <header class="page-heading split-heading">
      <div>
        <p class="eyebrow">Read-only explorer</p>
        <h1>Database tables</h1>
        <p>Inspect allowlisted SQLite tables. Large text and blobs stay collapsed in the grid.</p>
      </div>
      <label class="field-label table-picker">
        <span>Table</span>
        <select v-model="selectedTable" class="native-select" @change="loadRows(1)">
          <option v-for="table in tables" :key="table" :value="table">{{ table }}</option>
        </select>
      </label>
    </header>

    <p v-if="errorMessage" class="page-alert" role="alert">{{ errorMessage }}</p>
    <div v-if="loading" class="large-state"><UIcon name="i-lucide-loader-circle" class="animate-spin" /> Loading table…</div>

    <section v-else class="table-card">
      <header>
        <div><h2>{{ selectedTable }}</h2><span>{{ pagination.total.toLocaleString() }} rows</span></div>
        <UBadge color="neutral" variant="subtle">Read only</UBadge>
      </header>
      <div class="table-scroll">
        <table>
          <thead><tr><th v-for="column in columns" :key="column">{{ column }}</th><th>Detail</th></tr></thead>
          <tbody>
            <tr v-for="row in rows" :key="row.__rowKey">
              <td v-for="column in columns" :key="column" :class="{ muted: row[column] === null }">{{ renderCell(row[column]) }}</td>
              <td><UButton icon="i-lucide-panel-right-open" color="neutral" variant="ghost" size="sm" aria-label="View full row" @click="openRow(row)" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer v-if="pagination.totalPages > 1" class="pagination-bar page-pagination">
        <UButton label="Previous" color="neutral" variant="outline" :disabled="pagination.page <= 1" @click="loadRows(pagination.page - 1)" />
        <span>Page {{ pagination.page }} of {{ pagination.totalPages }}</span>
        <UButton label="Next" color="neutral" variant="outline" :disabled="pagination.page >= pagination.totalPages" @click="loadRows(pagination.page + 1)" />
      </footer>
    </section>

    <aside v-if="selectedRow || rowLoading" class="metadata-drawer table-detail">
      <div class="drawer-header"><div><p class="eyebrow">{{ selectedTable }}</p><h2>Full row</h2></div><UButton icon="i-lucide-x" color="neutral" variant="ghost" @click="selectedRow = null" /></div>
      <div v-if="rowLoading" class="pane-state"><UIcon name="i-lucide-loader-circle" class="animate-spin" /> Loading…</div>
      <dl v-else-if="selectedRow" class="metadata-list row-detail-list">
        <div v-for="(value, key) in selectedRow" :key="key"><dt>{{ key }}</dt><dd><pre>{{ formatDetail(value) }}</pre></dd></div>
      </dl>
    </aside>
  </div>
</template>
