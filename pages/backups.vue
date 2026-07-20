<script setup lang="ts">
import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import initSqlJs, { type BindParams, type Database } from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { apiErrorMessage } from '~/utils/writer'

interface PreparedExport {
  job: { id: string; status: string; fileName: string; createdAt: number }
  pageCount: number
}

interface ExportDataPage {
  fileName: string
  page: number
  pageCount: number
  exportInfo: Record<string, unknown>
  folders: Array<Record<string, unknown> & { path: string }>
  categories: Array<Record<string, unknown>>
  articles: Array<Record<string, unknown>>
  files: Array<{ path: string; text: string }>
}

interface SQLiteExportColumn {
  name: string
  type: string
  integer: boolean
  primaryKeyPosition: number
}

interface SQLiteExportTable {
  name: string
  sql: string
  columns: SQLiteExportColumn[]
  rowCount: number
  pageRowCounts: number[]
  withoutRowid: boolean
}

interface PreparedSQLiteExport {
  job: { id: string; status: string; fileName: string; createdAt: number }
  definition: {
    version: number
    userVersion: number
    applicationId: number
    tables: SQLiteExportTable[]
    indexes: string[]
    totalRows: number
    totalPages: number
  }
}

type SQLiteExportValue =
  | string
  | number
  | null
  | { type: 'blob'; base64: string }

interface SQLiteExportPage {
  table: string
  page: number
  pageCount: number
  rows: SQLiteExportValue[][]
}

useHead({ title: 'Backups · Writer Archive' })

const includeDeleted = ref(false)
const generating = ref(false)
const progress = ref(0)
const generatingDatabase = ref(false)
const databaseProgress = ref(0)
const errorMessage = ref('')
const lastFileName = ref('')

async function createExport() {
  generating.value = true
  progress.value = 0
  errorMessage.value = ''
  lastFileName.value = ''
  try {
    const prepared = await $fetch<PreparedExport>('/api/export/txt-zip', {
      method: 'POST',
      body: { includeDeleted: includeDeleted.value },
    })
    const archive = await buildArchive(prepared)
    downloadBlob(archive, prepared.job.fileName)
    lastFileName.value = prepared.job.fileName
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, 'The export could not be prepared.')
  } finally {
    generating.value = false
  }
}

async function createDatabaseExport() {
  generatingDatabase.value = true
  databaseProgress.value = 0
  errorMessage.value = ''
  lastFileName.value = ''

  try {
    const prepared = await $fetch<PreparedSQLiteExport>('/api/export/sqlite', {
      method: 'POST',
    })
    const database = await buildSQLiteDatabase(prepared)
    downloadBlob(database, prepared.job.fileName)
    lastFileName.value = prepared.job.fileName
  } catch (error) {
    errorMessage.value = apiErrorMessage(
      error,
      'The SQLite backup could not be prepared.',
    )
  } finally {
    generatingDatabase.value = false
  }
}

async function buildSQLiteDatabase(
  prepared: PreparedSQLiteExport,
): Promise<Blob> {
  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl })
  const database = new SQL.Database()
  let completedPages = 0

  try {
    database.run('PRAGMA foreign_keys = OFF')

    for (const table of prepared.definition.tables) {
      database.run(table.sql)
    }

    for (const table of prepared.definition.tables) {
      for (let page = 1; page <= table.pageRowCounts.length; page += 1) {
        const data = await $fetch<SQLiteExportPage>(
          `/api/export/${encodeURIComponent(prepared.job.id)}/sqlite/${encodeURIComponent(table.name)}/${page}`,
        )

        if (
          data.table !== table.name ||
          data.page !== page ||
          data.pageCount !== table.pageRowCounts.length ||
          data.rows.length !== table.pageRowCounts[page - 1]
        ) {
          throw new Error(
            'The database pages changed while the backup was running.',
          )
        }

        insertSQLiteRows(database, table, data.rows)
        completedPages += 1
        databaseProgress.value = Math.round(
          (completedPages / prepared.definition.totalPages) * 100,
        )
      }
    }

    for (const indexSql of prepared.definition.indexes) {
      database.run(indexSql)
    }

    database.run(`PRAGMA user_version = ${prepared.definition.userVersion}`)
    database.run(`PRAGMA application_id = ${prepared.definition.applicationId}`)

    const bytes = database.export()
    return new Blob([new Uint8Array(bytes)], {
      type: 'application/vnd.sqlite3',
    })
  } finally {
    database.close()
  }
}

function insertSQLiteRows(
  database: Database,
  table: SQLiteExportTable,
  rows: SQLiteExportValue[][],
): void {
  if (rows.length === 0) return

  const columns = table.columns.map((column) => quoteIdentifier(column.name))
  const placeholders = table.columns.map((column) =>
    column.integer ? 'CAST(? AS INTEGER)' : '?',
  )
  const statement = database.prepare(
    `INSERT INTO ${quoteIdentifier(table.name)} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
  )

  database.run('BEGIN')
  try {
    for (const row of rows) {
      statement.run(row.map(decodeSQLiteValue) as BindParams)
    }
    database.run('COMMIT')
  } catch (error) {
    database.run('ROLLBACK')
    throw error
  } finally {
    statement.free()
  }
}

function decodeSQLiteValue(value: SQLiteExportValue): string | number | null | Uint8Array {
  if (value === null || typeof value === 'string' || typeof value === 'number') {
    return value
  }

  const binary = window.atob(value.base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

async function buildArchive(prepared: PreparedExport): Promise<Blob> {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  const completed = new Promise<Blob>((resolve, reject) => {
    const zip = new Zip((error, data, final) => {
      if (error) {
        reject(error)
        return
      }

      chunks.push(new Uint8Array(data))
      if (final) resolve(new Blob(chunks, { type: 'application/zip' }))
    })

    void fillArchive(zip, prepared).catch(reject)
  })

  return completed
}

async function fillArchive(zip: Zip, prepared: PreparedExport): Promise<void> {
  let exportInfo: Record<string, unknown> | null = null
  let folders: ExportDataPage['folders'] = []
  let categories: ExportDataPage['categories'] = []
  const articles: ExportDataPage['articles'] = []

  for (let page = 1; page <= prepared.pageCount; page += 1) {
    const data = await $fetch<ExportDataPage>(
      `/api/export/${encodeURIComponent(prepared.job.id)}/pages/${page}`,
    )

    if (data.pageCount !== prepared.pageCount || data.page !== page) {
      throw new Error('The export pages changed while the backup was running.')
    }

    if (page === 1) {
      exportInfo = data.exportInfo
      folders = data.folders
      categories = data.categories

      for (const folder of folders) addZipDirectory(zip, folder.path)
    }

    articles.push(...data.articles)
    for (const file of data.files) addZipText(zip, file.path, file.text)
    progress.value = Math.round((page / prepared.pageCount) * 100)
  }

  addZipText(zip, 'Writer Export/_metadata/export-info.json', encodeJson(exportInfo))
  addZipText(zip, 'Writer Export/_metadata/folders.json', encodeJson(folders))
  addZipText(zip, 'Writer Export/_metadata/articles.json', encodeJson(articles))
  addZipText(zip, 'Writer Export/_metadata/categories.json', encodeJson(categories))
  zip.end()
}

function addZipText(zip: Zip, path: string, value: string): void {
  if (!path) return
  const entry = new ZipDeflate(path, { level: 6 })
  zip.add(entry)
  entry.push(strToU8(value), true)
}

function addZipDirectory(zip: Zip, path: string): void {
  if (!path) return
  const entry = new ZipPassThrough(`${path}/`)
  zip.add(entry)
  entry.push(new Uint8Array(), true)
}

function encodeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
</script>

<template>
  <div class="content-page backups-page">
    <header class="page-heading">
      <p class="eyebrow">Recovery and portability</p>
      <h1>Backups</h1>
      <p>Download human-readable archives or a complete portable SQLite database.</p>
    </header>

    <p v-if="errorMessage" class="page-alert" role="alert">{{ errorMessage }}</p>

    <section class="export-card">
      <div class="export-icon"><UIcon name="i-lucide-file-archive" /></div>
      <div class="export-copy">
        <h2>Full TXT archive</h2>
        <p>Creates a ZIP with ordered folders and title-based article files, plus JSON metadata for reconstruction.</p>
        <ul>
          <li><UIcon name="i-lucide-check" /> Active folders and articles</li>
          <li><UIcon name="i-lucide-check" /> Stable ordering and sanitized names</li>
          <li><UIcon name="i-lucide-check" /> Export, folder, article, and category metadata</li>
        </ul>
      </div>
      <div class="export-actions">
        <label class="check-label"><input v-model="includeDeleted" type="checkbox"> Include deleted items</label>
        <UButton :label="generating ? `Preparing ZIP ${progress}%` : 'Create & download ZIP'" icon="i-lucide-download" size="lg" :loading="generating" :disabled="generatingDatabase" @click="createExport" />
      </div>
    </section>

    <section class="export-card">
      <div class="export-icon"><UIcon name="i-lucide-database-backup" /></div>
      <div class="export-copy">
        <h2>Full SQLite database</h2>
        <p>Creates a real <code>.db</code> file containing all Writer tables and their current data.</p>
        <ul>
          <li><UIcon name="i-lucide-check" /> Articles, folders, categories, history, and daily statistics</li>
          <li><UIcon name="i-lucide-check" /> Settings, shortcuts, BLOBs, schema, and indexes</li>
          <li><UIcon name="i-lucide-check" /> Web login and audit tables are excluded for security</li>
        </ul>
      </div>
      <div class="export-actions">
        <UButton :label="generatingDatabase ? `Building database ${databaseProgress}%` : 'Download SQLite .db'" icon="i-lucide-database-backup" size="lg" :loading="generatingDatabase" :disabled="generating" @click="createDatabaseExport" />
      </div>
    </section>

    <section v-if="lastFileName" class="last-export">
      <UIcon name="i-lucide-circle-check" />
      <div class="last-export-content">
        <strong>Backup downloaded</strong>
        <span>{{ lastFileName }} contains the complete archive.</span>
      </div>
    </section>

    <section class="info-card">
      <UIcon name="i-lucide-shield-check" />
      <div><h2>Private by design</h2><p>Exports are generated only after authentication, are not placed in the public directory, and are recorded in the audit log.</p></div>
    </section>
  </div>
</template>
