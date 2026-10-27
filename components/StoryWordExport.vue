<script setup lang="ts">
import type { FolderRecord } from '#shared/types/writer'
import { apiErrorMessage, isDeleted } from '~/utils/writer'
import {
  buildStoryDocx,
  storyDocxFileName,
  type StoryDocumentEpisode,
} from '~/utils/story-docx'

interface EpisodeChoice {
  id: string
  title: string
  deleted: boolean
  contentLength: number
}

const props = defineProps<{
  open: boolean
  folder: FolderRecord | null
}>()
const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const includeDeleted = ref(false)
const episodes = ref<EpisodeChoice[]>([])
const selectedIds = ref<Set<string>>(new Set())
const selectionMode = ref<'all' | 'selected'>('all')
const search = ref('')
const loading = ref(false)
const exporting = ref(false)
const progress = ref(0)
const error = ref('')
let requestNumber = 0

const visibleEpisodes = computed(() =>
  episodes.value.filter((episode) =>
    episode.title
      .toLocaleLowerCase()
      .includes(search.value.trim().toLocaleLowerCase()),
  ),
)
const chosenEpisodes = computed(() =>
  selectionMode.value === 'all'
    ? episodes.value
    : episodes.value.filter((episode) => selectedIds.value.has(episode.id)),
)

watch(
  () => props.open,
  async (open) => {
    if (open) {
      includeDeleted.value = props.folder
        ? isDeleted(props.folder.deleted)
        : false
      selectionMode.value = 'all'
      search.value = ''
      error.value = ''
      await nextTick()
      dialog.value?.showModal()
      await loadEpisodes()
    } else {
      requestNumber++
      dialog.value?.close()
    }
  },
)

async function loadEpisodes(): Promise<void> {
  if (!props.folder) return
  const request = ++requestNumber
  loading.value = true
  error.value = ''
  episodes.value = []
  selectedIds.value = new Set()

  try {
    const response = await $fetch<{ episodes: EpisodeChoice[] }>(
      `/api/export/folders/${encodeURIComponent(props.folder.id)}/episodes`,
      { query: { includeDeleted: includeDeleted.value } },
    )
    if (request !== requestNumber) return
    episodes.value = response.episodes
    selectedIds.value = new Set(response.episodes.map((episode) => episode.id))
  } catch (cause) {
    if (request === requestNumber)
      error.value = apiErrorMessage(cause, 'Could not load episodes.')
  } finally {
    if (request === requestNumber) loading.value = false
  }
}

function toggleEpisode(id: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function setVisibleSelection(checked: boolean): void {
  const next = new Set(selectedIds.value)
  for (const episode of visibleEpisodes.value) {
    if (checked) next.add(episode.id)
    else next.delete(episode.id)
  }
  selectedIds.value = next
}

function close(): void {
  if (!exporting.value) emit('close')
}

async function exportWord(): Promise<void> {
  if (!props.folder || exporting.value || chosenEpisodes.value.length === 0)
    return
  exporting.value = true
  progress.value = 0
  error.value = ''
  const folder = props.folder
  const chosen = [...chosenEpisodes.value]
  const articles: StoryDocumentEpisode[] = []

  try {
    // Size by source characters so each JSON response stays within serverless limits.
    const batches: EpisodeChoice[][] = []
    let batch: EpisodeChoice[] = []
    let characters = 0
    for (const episode of chosen) {
      if (
        batch.length &&
        (batch.length >= 50 || characters + episode.contentLength > 500_000)
      ) {
        batches.push(batch)
        batch = []
        characters = 0
      }
      batch.push(episode)
      characters += episode.contentLength
    }
    if (batch.length) batches.push(batch)

    for (const group of batches) {
      const response = await $fetch<{ articles: StoryDocumentEpisode[] }>(
        `/api/export/folders/${encodeURIComponent(folder.id)}/episodes`,
        {
          method: 'POST',
          body: {
            includeDeleted: includeDeleted.value,
            articleIds: group.map((episode) => episode.id),
          },
        },
      )
      if (
        response.articles.length !== group.length ||
        response.articles.some(
          (article, index) => article.id !== group[index]?.id,
        )
      ) {
        throw new Error(
          'The story changed during export. Reopen Word export and try again.',
        )
      }
      articles.push(...response.articles)
      progress.value = Math.round((articles.length / chosen.length) * 100)
    }

    const bytes = buildStoryDocx(folder.name, articles)
    const blob = new Blob([new Uint8Array(bytes)], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = storyDocxFileName(folder.name)
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    emit('close')
  } catch (cause) {
    error.value = apiErrorMessage(cause, 'Could not create the Word document.')
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="word-export-dialog"
    aria-labelledby="word-export-title"
    @close="close"
    @cancel="exporting && $event.preventDefault()"
  >
    <div class="word-export-heading">
      <div>
        <p class="eyebrow">Story export</p>
        <h2 id="word-export-title">
          Export {{ folder?.name || 'story' }} to Word
        </h2>
      </div>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        aria-label="Close Word export"
        :disabled="exporting"
        @click="close"
      />
    </div>

    <p class="word-export-intro">
      Create one .docx from saved episodes, with each episode as a heading in
      story order.
    </p>
    <p v-if="error" class="page-alert" role="alert">{{ error }}</p>

    <label class="check-label word-export-deleted">
      <input
        v-model="includeDeleted"
        type="checkbox"
        :disabled="exporting || loading || isDeleted(folder?.deleted)"
        @change="loadEpisodes"
      />
      Include deleted episodes
    </label>

    <div class="word-export-modes" role="group" aria-label="Episodes to export">
      <label
        ><input
          v-model="selectionMode"
          type="radio"
          value="all"
          :disabled="exporting"
        />
        All episodes</label
      >
      <label
        ><input
          v-model="selectionMode"
          type="radio"
          value="selected"
          :disabled="exporting"
        />
        Selected episodes</label
      >
    </div>

    <template v-if="selectionMode === 'selected'">
      <div class="word-export-selection-tools">
        <UInput
          v-model="search"
          type="search"
          icon="i-lucide-search"
          placeholder="Find an episode"
          aria-label="Find an episode to select"
          :disabled="exporting"
        />
        <button
          class="text-action"
          type="button"
          :disabled="exporting"
          @click="setVisibleSelection(true)"
        >
          Select shown
        </button>
        <button
          class="text-action"
          type="button"
          :disabled="exporting"
          @click="setVisibleSelection(false)"
        >
          Clear shown
        </button>
      </div>
      <div class="word-export-list" role="group" aria-label="Episode selection">
        <label
          v-for="episode in visibleEpisodes"
          :key="episode.id"
          class="word-export-episode"
        >
          <input
            type="checkbox"
            :checked="selectedIds.has(episode.id)"
            :disabled="exporting"
            @change="toggleEpisode(episode.id)"
          />
          <span>{{ episode.title || 'Untitled episode' }}</span>
          <UBadge
            v-if="episode.deleted"
            color="error"
            variant="subtle"
            size="sm"
            >Deleted</UBadge
          >
        </label>
        <p
          v-if="!loading && visibleEpisodes.length === 0"
          class="word-export-empty"
        >
          No episodes match.
        </p>
      </div>
    </template>

    <div class="word-export-footer">
      <span v-if="loading">Loading episodes…</span>
      <span v-else
        >{{ chosenEpisodes.length }} of {{ episodes.length }} episodes</span
      >
      <UButton
        color="neutral"
        variant="ghost"
        label="Cancel"
        :disabled="exporting"
        @click="close"
      />
      <UButton
        icon="i-lucide-download"
        :label="exporting ? `Preparing ${progress}%` : 'Download Word'"
        :loading="exporting"
        :disabled="loading || !chosenEpisodes.length"
        @click="exportWord"
      />
    </div>
  </dialog>
</template>
