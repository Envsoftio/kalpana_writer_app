<script setup lang="ts">
import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate'
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

useHead({ title: 'Backups · Writer Archive' })

const includeDeleted = ref(false)
const generating = ref(false)
const progress = ref(0)
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
      <p>Download human-readable text files grouped into their original folder structure.</p>
    </header>

    <p v-if="errorMessage" class="page-alert" role="alert">{{ errorMessage }}</p>

    <section class="export-card">
      <div class="export-icon"><UIcon name="i-lucide-file-archive" /></div>
      <div class="export-copy">
        <h2>Full TXT archive</h2>
        <p>Creates a ZIP with numbered folders and articles, plus JSON metadata for reconstruction.</p>
        <ul>
          <li><UIcon name="i-lucide-check" /> Active folders and articles</li>
          <li><UIcon name="i-lucide-check" /> Stable ordering and sanitized names</li>
          <li><UIcon name="i-lucide-check" /> Export, folder, article, and category metadata</li>
        </ul>
      </div>
      <div class="export-actions">
        <label class="check-label"><input v-model="includeDeleted" type="checkbox"> Include deleted items</label>
        <UButton :label="generating ? `Preparing ZIP ${progress}%` : 'Create & download ZIP'" icon="i-lucide-download" size="lg" :loading="generating" @click="createExport" />
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
