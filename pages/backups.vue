<script setup lang="ts">
import { apiErrorMessage } from '~/utils/writer'

interface ExportPart {
  job: { id: string; status: string; fileName: string; createdAt: number }
  archiveBytes: number
  downloadUrl: string
}

interface ExportResponse {
  parts: ExportPart[]
}

useHead({ title: 'Backups · Writer Archive' })

const includeDeleted = ref(false)
const generating = ref(false)
const errorMessage = ref('')
const lastExport = ref<ExportResponse | null>(null)

async function createExport() {
  generating.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<ExportResponse>('/api/export/txt-zip', {
      method: 'POST',
      body: { includeDeleted: includeDeleted.value },
    })

    if (!response.parts[0]) {
      throw new Error('The export did not contain any downloadable parts.')
    }

    lastExport.value = response
    if (import.meta.client)
      window.location.assign(response.parts[0].downloadUrl)
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, 'The export could not be prepared.')
  } finally {
    generating.value = false
  }
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
        <UButton label="Create & download ZIP" icon="i-lucide-download" size="lg" :loading="generating" @click="createExport" />
      </div>
    </section>

    <section v-if="lastExport" class="last-export">
      <UIcon name="i-lucide-circle-check" />
      <div class="last-export-content">
        <strong>Backup ready in {{ lastExport.parts.length }} ZIP {{ lastExport.parts.length === 1 ? 'file' : 'parts' }}</strong>
        <span>Part 1 should download automatically. Download every listed part to keep a complete backup.</span>
        <div class="export-parts">
          <a v-for="(part, index) in lastExport.parts" :key="part.job.id" :href="part.downloadUrl">
            <UIcon name="i-lucide-download" />
            <span>{{ part.job.fileName }}</span>
            <small>{{ (part.archiveBytes / 1_048_576).toFixed(1) }} MB</small>
            <strong v-if="index === 0">Download again</strong>
          </a>
        </div>
      </div>
    </section>

    <section class="info-card">
      <UIcon name="i-lucide-shield-check" />
      <div><h2>Private by design</h2><p>Exports are generated only after authentication, are not placed in the public directory, and are recorded in the audit log.</p></div>
    </section>
  </div>
</template>
