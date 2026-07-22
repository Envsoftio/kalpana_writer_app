<script setup lang="ts">
import type {
  ArticleRecord,
  FolderRecord,
  SaveState,
} from '#shared/types/writer'
import {
  apiErrorMessage,
  countWords,
  formatWriterDate,
  isDeleted,
} from '~/utils/writer'

const props = defineProps<{
  article: ArticleRecord | null
  folders: FolderRecord[]
  loading: boolean
  highlight?: string
}>()

const emit = defineEmits<{
  back: []
  saved: [article: ArticleRecord]
  removed: [article: ArticleRecord]
}>()

const title = ref('')
const content = ref('')
const mode = ref<'read' | 'edit'>('read')
const saveState = ref<SaveState>('saved')
const errorMessage = ref('')
const metadataOpen = ref(false)
const focusMode = ref(false)
const findOpen = ref(false)
const findQuery = ref('')
const activeFindIndex = ref(-1)
const contentEditor = ref<HTMLTextAreaElement | null>(null)
const editorSurface = ref<HTMLElement | null>(null)
const recoveryDraft = ref<{
  title: string
  content: string
  savedAt: number
} | null>(null)
const movedFolderId = ref('')
let saveTimer: ReturnType<typeof setTimeout> | undefined
let loadingArticle = true
let editRevision = 0
let appliedHighlightKey = ''

const dirty = computed(
  () =>
    !!props.article &&
    (title.value !== props.article.title ||
      content.value !== props.article.content),
)
const wordCount = computed(() => countWords(content.value))
const characterCount = computed(() => content.value.length)
const findMatches = computed(() => {
  const query = findQuery.value.toLocaleLowerCase()
  if (!query) return []

  const matches: number[] = []
  const source = content.value.toLocaleLowerCase()
  let offset = 0

  while (matches.length < 10_000) {
    const index = source.indexOf(query, offset)
    if (index === -1) break
    matches.push(index)
    offset = index + Math.max(1, query.length)
  }

  return matches
})
const findCount = computed(() => findMatches.value.length)
const readerSegments = computed(() => {
  if (findMatches.value.length === 0 || !findQuery.value) {
    return [{ text: content.value, matchIndex: null }]
  }

  const segments: Array<{ text: string; matchIndex: number | null }> = []
  let offset = 0

  for (const [matchIndex, start] of findMatches.value.entries()) {
    if (start > offset) {
      segments.push({
        text: content.value.slice(offset, start),
        matchIndex: null,
      })
    }

    const end = start + findQuery.value.length
    segments.push({ text: content.value.slice(start, end), matchIndex })
    offset = end
  }

  if (offset < content.value.length) {
    segments.push({ text: content.value.slice(offset), matchIndex: null })
  }

  return segments
})
const stateLabel = computed(() => {
  const labels: Record<SaveState, string> = {
    saved: 'Saved',
    unsaved: 'Unsaved changes',
    saving: 'Saving…',
    offline: 'Offline · draft kept locally',
    error: 'Save failed · draft kept locally',
  }
  return labels[saveState.value]
})
const stateIcon = computed(() => {
  const icons: Record<SaveState, string> = {
    saved: 'i-lucide-check',
    unsaved: 'i-lucide-circle-dot-dashed',
    saving: 'i-lucide-loader-circle',
    offline: 'i-lucide-cloud-off',
    error: 'i-lucide-triangle-alert',
  }
  return icons[saveState.value]
})

function folderNameFor(folderId: string): string {
  return (
    props.folders.find((folder) => folder.id === folderId)?.name ?? folderId
  )
}

async function goToMatch(direction: 1 | -1) {
  if (findMatches.value.length === 0) return

  activeFindIndex.value =
    (activeFindIndex.value + direction + findMatches.value.length) %
    findMatches.value.length

  await nextTick()

  if (mode.value === 'read') {
    const match = editorSurface.value?.querySelector<HTMLElement>(
      `[data-find-match="${activeFindIndex.value}"]`,
    )
    match?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }

  const start = findMatches.value[activeFindIndex.value] ?? 0
  const editor = contentEditor.value
  editor?.focus()
  editor?.setSelectionRange(start, start + findQuery.value.length)
}

function closeFind() {
  findOpen.value = false
  findQuery.value = ''
  activeFindIndex.value = -1
}

function toggleFind() {
  if (findOpen.value) {
    closeFind()
    return
  }

  findOpen.value = true
}

async function applyRequestedHighlight() {
  const articleId = props.article?.id
  const requested = props.highlight?.trim()

  if (!articleId || !requested) return

  const requestKey = `${articleId}:${requested}`
  if (requestKey === appliedHighlightKey) return

  appliedHighlightKey = requestKey
  findOpen.value = true
  findQuery.value = requested
  activeFindIndex.value = -1
  await nextTick()

  if (findMatches.value.length > 0) {
    await goToMatch(1)
  }
}

function draftKey(id: string) {
  return `writer-draft:${id}`
}

function loadArticle(article: ArticleRecord | null) {
  loadingArticle = true
  editRevision = 0
  appliedHighlightKey = ''
  clearTimeout(saveTimer)
  recoveryDraft.value = null
  title.value = article?.title ?? ''
  content.value = article?.content ?? ''
  movedFolderId.value = article?.folderId ?? ''
  mode.value = 'read'
  findOpen.value = false
  findQuery.value = ''
  activeFindIndex.value = -1
  saveState.value = 'saved'
  errorMessage.value = ''

  if (article && import.meta.client) {
    try {
      const stored = localStorage.getItem(draftKey(article.id))
      const draft = stored
        ? (JSON.parse(stored) as {
            title?: unknown
            content?: unknown
            savedAt?: unknown
          })
        : null
      if (
        draft &&
        typeof draft.title === 'string' &&
        typeof draft.content === 'string' &&
        typeof draft.savedAt === 'number' &&
        (draft.title !== article.title || draft.content !== article.content)
      ) {
        recoveryDraft.value = {
          title: draft.title,
          content: draft.content,
          savedAt: draft.savedAt,
        }
      }
    } catch {
      removePersistedDraft(article.id)
    }
  }

  nextTick(async () => {
    loadingArticle = false
    await applyRequestedHighlight()
  })
}

function persistDraft(): boolean {
  if (!props.article || !import.meta.client) return false

  try {
    localStorage.setItem(
      draftKey(props.article.id),
      JSON.stringify({
        title: title.value,
        content: content.value,
        savedAt: Date.now(),
      }),
    )
    return true
  } catch {
    errorMessage.value =
      'Browser draft storage is unavailable; remote autosave is still active.'
    return false
  }
}

function removePersistedDraft(id: string) {
  if (!import.meta.client) return
  try {
    localStorage.removeItem(draftKey(id))
  } catch {
    // Storage may be disabled; there is no recoverable cleanup action here.
  }
}

function recoverDraft() {
  if (!recoveryDraft.value) return
  title.value = recoveryDraft.value.title
  content.value = recoveryDraft.value.content
  recoveryDraft.value = null
  mode.value = 'edit'
  saveState.value = 'unsaved'
}

function discardDraft() {
  if (props.article) removePersistedDraft(props.article.id)
  recoveryDraft.value = null
}

async function save() {
  if (!props.article || !dirty.value) return true
  if (saveState.value === 'saving') return false

  persistDraft()
  if (import.meta.client && !navigator.onLine) {
    saveState.value = 'offline'
    return false
  }

  saveState.value = 'saving'
  errorMessage.value = ''
  const revisionAtStart = editRevision
  const titleAtStart = title.value
  const contentAtStart = content.value
  const articleId = props.article.id

  try {
    const response = await $fetch<{ article: ArticleRecord }>(
      `/api/articles/${encodeURIComponent(articleId)}`,
      {
        method: 'PATCH',
        body: { title: titleAtStart, content: contentAtStart },
      },
    )

    emit('saved', response.article)

    if (editRevision === revisionAtStart) {
      removePersistedDraft(articleId)
      saveState.value = 'saved'
      return true
    }

    // More typing happened while this request was in flight. Keep the newer
    // local draft and immediately queue another save instead of calling the
    // stale response "saved".
    persistDraft()
    saveState.value = 'unsaved'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void save(), 350)
    return false
  } catch (error) {
    saveState.value =
      import.meta.client && !navigator.onLine ? 'offline' : 'error'
    errorMessage.value = apiErrorMessage(
      error,
      'Your changes could not be saved.',
    )
    return false
  }
}

async function moveArticle() {
  if (
    !props.article ||
    !movedFolderId.value ||
    movedFolderId.value === props.article.folderId
  )
    return
  if (dirty.value && !(await save())) return

  try {
    const response = await $fetch<{ article: ArticleRecord }>(
      `/api/articles/${encodeURIComponent(props.article.id)}/move`,
      { method: 'POST', body: { folderId: movedFolderId.value } },
    )
    emit('saved', response.article)
  } catch (error) {
    errorMessage.value = apiErrorMessage(
      error,
      'The article could not be moved.',
    )
    movedFolderId.value = props.article.folderId
  }
}

async function toggleDeleted() {
  if (!props.article) return
  const deleted = isDeleted(props.article.deleted)
  if (
    !deleted &&
    !confirm(`Move “${props.article.title || 'Untitled'}” to deleted items?`)
  )
    return

  try {
    const action = deleted ? 'restore' : 'delete'
    const response = await $fetch<{ article: ArticleRecord }>(
      `/api/articles/${encodeURIComponent(props.article.id)}/${action}`,
      { method: 'POST' },
    )
    emit('removed', response.article)
  } catch (error) {
    errorMessage.value = apiErrorMessage(
      error,
      `The article could not be ${deleted ? 'restored' : 'deleted'}.`,
    )
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return
  event.preventDefault()
}

function handleOnline() {
  if (dirty.value) void save()
}

watch(
  () => props.article?.id,
  () => loadArticle(props.article),
  { immediate: true },
)

watch([title, content], () => {
  if (loadingArticle || !props.article || !dirty.value) return
  editRevision += 1
  saveState.value =
    import.meta.client && !navigator.onLine ? 'offline' : 'unsaved'
  persistDraft()
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void save(), 1400)
})

watch(findQuery, () => {
  activeFindIndex.value = -1
})

watch(
  () => props.highlight,
  (highlight) => {
    appliedHighlightKey = ''

    if (highlight?.trim()) {
      void applyRequestedHighlight()
    } else {
      closeFind()
    }
  },
)

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('online', handleOnline)
})

onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('online', handleOnline)
})

onBeforeRouteUpdate(() => {
  if (!dirty.value) return true
  return confirm('This article still has unsaved changes. Leave anyway?')
})

onBeforeRouteLeave(() => {
  if (!dirty.value) return true
  return confirm('This article still has unsaved changes. Leave anyway?')
})
</script>

<template>
  <section
    class="pane editor-pane"
    :class="{ 'focus-mode': focusMode }"
    aria-label="Article reader and editor"
  >
    <div v-if="loading" class="pane-state grow">
      <UIcon name="i-lucide-loader-circle" class="animate-spin" />
      Loading article…
    </div>

    <div v-else-if="!article" class="pane-state grow">
      <UIcon name="i-lucide-book-open-text" />
      <strong>Select an article to begin.</strong>
      <span>Full content is fetched only when you open it.</span>
    </div>

    <template v-else>
      <header class="editor-toolbar">
        <UButton
          class="mobile-back"
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="ghost"
          aria-label="Back to articles"
          @click="emit('back')"
        />
        <div class="mode-switch">
          <button :class="{ active: mode === 'read' }" @click="mode = 'read'">
            Read
          </button>
          <button :class="{ active: mode === 'edit' }" @click="mode = 'edit'">
            Edit
          </button>
        </div>
        <span class="save-state" :class="saveState">
          <UIcon
            :name="stateIcon"
            :class="{ 'animate-spin': saveState === 'saving' }"
          />
          {{ stateLabel }}
        </span>
        <div class="toolbar-spacer" />
        <UButton
          icon="i-lucide-search"
          color="neutral"
          variant="ghost"
          aria-label="Find in article"
          @click="toggleFind"
        />
        <UButton
          :icon="focusMode ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
          color="neutral"
          variant="ghost"
          :aria-label="focusMode ? 'Exit focus mode' : 'Enter focus mode'"
          @click="focusMode = !focusMode"
        />
        <UButton
          icon="i-lucide-panel-right-open"
          color="neutral"
          variant="ghost"
          aria-label="Article metadata"
          @click="metadataOpen = !metadataOpen"
        />
        <UButton
          v-if="mode === 'edit'"
          icon="i-lucide-save"
          label="Save"
          size="sm"
          :loading="saveState === 'saving'"
          :disabled="!dirty"
          @click="save"
        />
      </header>

      <div v-if="findOpen" class="find-bar">
        <UInput
          v-model="findQuery"
          icon="i-lucide-search"
          placeholder="Find in this article"
          autofocus
          @keydown.enter.prevent="goToMatch($event.shiftKey ? -1 : 1)"
        />
        <span>
          {{
            findQuery
              ? `${activeFindIndex >= 0 ? activeFindIndex + 1 : 0} of ${findCount}`
              : 'Type to search'
          }}
        </span>
        <UButton
          icon="i-lucide-chevron-up"
          color="neutral"
          variant="ghost"
          :disabled="findCount === 0"
          aria-label="Previous match"
          @click="goToMatch(-1)"
        />
        <UButton
          icon="i-lucide-chevron-down"
          color="neutral"
          variant="ghost"
          :disabled="findCount === 0"
          aria-label="Next match"
          @click="goToMatch(1)"
        />
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          aria-label="Close search"
          @click="closeFind"
        />
      </div>

      <div v-if="recoveryDraft" class="recovery-banner">
        <UIcon name="i-lucide-history" />
        <span class="min-w-0 flex-1">
          A local draft from
          {{ formatWriterDate(recoveryDraft.savedAt, true) }} is available.
        </span>
        <UButton
          label="Recover"
          size="sm"
          color="warning"
          @click="recoverDraft"
        />
        <UButton
          label="Discard"
          size="sm"
          color="neutral"
          variant="ghost"
          @click="discardDraft"
        />
      </div>

      <p v-if="errorMessage" class="editor-error" role="alert">
        <UIcon name="i-lucide-triangle-alert" /> {{ errorMessage }}
      </p>

      <div ref="editorSurface" class="editor-surface scroll-region">
        <template v-if="mode === 'edit'">
          <input
            v-model="title"
            class="title-editor"
            aria-label="Article title"
            placeholder="Untitled"
          >
          <textarea
            ref="contentEditor"
            v-model="content"
            class="content-editor"
            aria-label="Article content"
            placeholder="Start writing…"
            spellcheck="true"
          />
        </template>
        <article v-else class="reader">
          <h1>{{ title || 'Untitled' }}</h1>
          <p class="reader-meta">
            Updated {{ formatWriterDate(article.updateTime, true) }}
          </p>
          <div class="reader-content">
            <template
              v-for="(segment, segmentIndex) in readerSegments"
              :key="`${segmentIndex}:${segment.matchIndex ?? 'text'}`"
            >
              <mark
                v-if="segment.matchIndex !== null"
                class="reader-find-match"
                :class="{ active: segment.matchIndex === activeFindIndex }"
                :data-find-match="segment.matchIndex"
                >{{ segment.text }}</mark
              ><span v-else>{{ segment.text }}</span>
            </template>
          </div>
        </article>
      </div>

      <footer class="editor-footer">
        <span>{{ wordCount.toLocaleString() }} words</span>
        <span>{{ characterCount.toLocaleString() }} characters</span>
        <div class="toolbar-spacer" />
        <a
          :href="`/api/export/articles/${encodeURIComponent(article.id)}/txt?includeDeleted=true`"
          class="text-action"
        >
          <UIcon name="i-lucide-download" /> Export TXT
        </a>
        <UButton
          :icon="
            isDeleted(article.deleted)
              ? 'i-lucide-rotate-ccw'
              : 'i-lucide-trash-2'
          "
          :label="isDeleted(article.deleted) ? 'Restore' : 'Delete'"
          :color="isDeleted(article.deleted) ? 'success' : 'error'"
          variant="ghost"
          size="sm"
          @click="toggleDeleted"
        />
      </footer>

      <aside v-if="metadataOpen" class="metadata-drawer">
        <div class="drawer-header">
          <div>
            <p class="eyebrow">Article</p>
            <h2>Metadata</h2>
          </div>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            aria-label="Close metadata"
            @click="metadataOpen = false"
          />
        </div>
        <dl class="metadata-list">
          <div>
            <dt>ID</dt>
            <dd>{{ article.id }}</dd>
          </div>
          <div>
            <dt>Folder</dt>
            <dd>{{ folderNameFor(article.folderId) }}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{{ article.categoryId || 'None' }}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{{ formatWriterDate(article.createTime, true) }}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{{ formatWriterDate(article.updateTime, true) }}</dd>
          </div>
          <div>
            <dt>Stored count</dt>
            <dd>{{ Number(article.count ?? 0).toLocaleString() }}</dd>
          </div>
          <div>
            <dt>Rank</dt>
            <dd>{{ article.rank }}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{{ isDeleted(article.deleted) ? 'Deleted' : 'Active' }}</dd>
          </div>
        </dl>
        <label class="field-label">
          <span>Move to folder</span>
          <select
            v-model="movedFolderId"
            class="native-select"
            @change="moveArticle"
          >
            <option
              v-for="folder in folders.filter(
                (item) => !isDeleted(item.deleted),
              )"
              :key="folder.id"
              :value="folder.id"
            >
              {{ folder.name }}
            </option>
          </select>
        </label>
      </aside>
    </template>
  </section>
</template>
