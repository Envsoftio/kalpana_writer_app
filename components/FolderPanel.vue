<script setup lang="ts">
import type { FolderRecord } from '#shared/types/writer'
import {
  isDeleted,
  readWriterPreference,
  writeWriterPreference,
} from '~/utils/writer'

type FolderSort = 'rank' | 'name' | 'updated' | 'created' | 'articles'
type FolderStatus = 'active' | 'deleted' | 'all'

const FOLDER_FILTERS_KEY = 'writer:filters:folders:v1'

const props = defineProps<{
  folders: FolderRecord[]
  selectedId: string | null
  loading: boolean
  status: FolderStatus
  viewActive: boolean
}>()

const emit = defineEmits<{
  select: [folder: FolderRecord]
  status: [value: FolderStatus]
  create: [value: { name: string; description: string }]
  update: [id: string, value: { name: string; description: string }]
  remove: [folder: FolderRecord]
  restore: [folder: FolderRecord]
}>()

const showCreate = ref(false)
const showEdit = ref(false)
const name = ref('')
const description = ref('')
const folderSearch = ref('')
const folderSort = ref<FolderSort>('rank')
const folderListElement = ref<HTMLElement | null>(null)

const folderSortOptions: Array<{ value: FolderSort; label: string }> = [
  { value: 'rank', label: 'Folder order' },
  { value: 'name', label: 'Name' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Recently created' },
  { value: 'articles', label: 'Article count' },
]
const folderStatusOptions: Array<{ value: FolderStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'all', label: 'All' },
]

const filteredFolders = computed(() => {
  const query = folderSearch.value.trim().toLocaleLowerCase()
  const matchingFolders = query
    ? props.folders.filter((folder) =>
        [folder.name, folder.description]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLocaleLowerCase().includes(query)),
      )
    : props.folders

  return [...matchingFolders].sort(compareFolders)
})

const selectedFolder = computed(
  () => props.folders.find((folder) => folder.id === props.selectedId) ?? null,
)

function compareFolders(first: FolderRecord, second: FolderRecord): number {
  switch (folderSort.value) {
    case 'name':
      return compareText(first.name, second.name) || compareText(first.id, second.id)
    case 'updated':
      return second.updateTime - first.updateTime || compareText(first.name, second.name)
    case 'created':
      return second.createdTime - first.createdTime || compareText(first.name, second.name)
    case 'articles':
      return (
        (second.articleCount ?? 0) - (first.articleCount ?? 0) ||
        compareText(first.name, second.name)
      )
    case 'rank':
    default:
      return first.rank - second.rank || compareText(first.name, second.name) || compareText(first.id, second.id)
  }
}

function compareText(first: string, second: string): number {
  return first.localeCompare(second, undefined, { sensitivity: 'base' })
}

function restoreFolderFilters(): void {
  const stored = readWriterPreference(FOLDER_FILTERS_KEY)

  if (
    stored &&
    typeof stored === 'object' &&
    'sort' in stored &&
    isFolderSort(stored.sort)
  ) {
    folderSort.value = stored.sort
  }
}

function isFolderSort(value: unknown): value is FolderSort {
  return (
    value === 'rank' ||
    value === 'name' ||
    value === 'updated' ||
    value === 'created' ||
    value === 'articles'
  )
}

function startCreate() {
  name.value = ''
  description.value = ''
  showEdit.value = false
  showCreate.value = true
}

function startEdit() {
  if (!selectedFolder.value) return
  name.value = selectedFolder.value.name
  description.value = selectedFolder.value.description ?? ''
  showCreate.value = false
  showEdit.value = true
}

function submitCreate() {
  if (!name.value.trim()) return
  emit('create', {
    name: name.value.trim(),
    description: description.value.trim(),
  })
  showCreate.value = false
}

function submitEdit() {
  if (!selectedFolder.value || !name.value.trim()) return
  emit('update', selectedFolder.value.id, {
    name: name.value.trim(),
    description: description.value.trim(),
  })
  showEdit.value = false
}

function scrollSelectedFolderIntoView() {
  if (!import.meta.client || props.loading || !props.selectedId) return

  nextTick(() => {
    const list = folderListElement.value
    const selectedRow = list?.querySelector<HTMLElement>(
      '[data-selected="true"]',
    )

    if (!list || !selectedRow || list.clientHeight === 0) return

    const listBounds = list.getBoundingClientRect()
    const rowBounds = selectedRow.getBoundingClientRect()

    if (rowBounds.top < listBounds.top || rowBounds.bottom > listBounds.bottom) {
      list.scrollTop = Math.max(
        0,
        list.scrollTop +
          rowBounds.top -
          listBounds.top -
          (list.clientHeight - rowBounds.height) / 2,
      )
    }
  })
}

watch(
  [
    () => props.selectedId,
    () => props.loading,
    () => props.viewActive,
    () => filteredFolders.value.length,
  ],
  scrollSelectedFolderIntoView,
  { flush: 'post' },
)
watch(folderSort, (sort) => {
  writeWriterPreference(FOLDER_FILTERS_KEY, { sort })
})

onMounted(() => {
  restoreFolderFilters()
  scrollSelectedFolderIntoView()
})
</script>

<template>
  <section class="pane folder-pane" aria-label="Folders">
    <header class="pane-header">
      <div>
        <p class="eyebrow">Library</p>
        <h1>Folders</h1>
      </div>
      <UButton
        icon="i-lucide-folder-plus"
        size="sm"
        aria-label="Create folder"
        @click="startCreate"
      />
    </header>

    <div class="list-controls folder-controls">
      <select
        v-model="folderSort"
        class="native-select"
        aria-label="Sort folders"
      >
        <option
          v-for="option in folderSortOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
      <select
        :value="status"
        class="native-select"
        aria-label="Folder status"
        @change="emit('status', ($event.target as HTMLSelectElement).value as FolderStatus)"
      >
        <option
          v-for="option in folderStatusOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
    </div>

    <div class="pane-search">
      <UInput
        v-model="folderSearch"
        type="search"
        icon="i-lucide-search"
        placeholder="Search folders"
        aria-label="Search folders by name or description"
      />
    </div>

    <form
      v-if="showCreate || showEdit"
      class="inline-editor"
      @submit.prevent="showCreate ? submitCreate() : submitEdit()"
    >
      <strong>{{ showCreate ? 'New folder' : 'Edit folder' }}</strong>
      <UInput v-model="name" placeholder="Folder name" autofocus required />
      <UTextarea
        v-model="description"
        placeholder="Description (optional)"
        :rows="3"
      />
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="showCreate = showEdit = false"
        />
        <UButton
          type="submit"
          :label="showCreate ? 'Create' : 'Save'"
          size="sm"
        />
      </div>
    </form>

    <div v-if="loading" class="pane-state">
      <UIcon name="i-lucide-loader-circle" class="animate-spin" />
      Loading folders…
    </div>

    <div v-else-if="folders.length === 0" class="pane-state">
      <UIcon name="i-lucide-folder-open" />
      <span>No {{ status === 'all' ? '' : status }} folders found.</span>
    </div>

    <div v-else-if="filteredFolders.length === 0" class="pane-state">
      <UIcon name="i-lucide-search-x" />
      <span>No folders match “{{ folderSearch.trim() }}”.</span>
    </div>

    <div v-else ref="folderListElement" class="folder-list scroll-region">
      <button
        v-for="folder in filteredFolders"
        :key="folder.id"
        class="folder-row"
        :class="{ selected: folder.id === selectedId }"
        :data-selected="folder.id === selectedId"
        @click="emit('select', folder)"
      >
        <span class="folder-icon"><UIcon name="i-lucide-folder" /></span>
        <span class="min-w-0 flex-1">
          <span class="row-title">
            {{ folder.name }}
            <UBadge
              v-if="isDeleted(folder.deleted)"
              color="error"
              variant="subtle"
              size="sm"
              >Deleted</UBadge
            >
          </span>
          <span class="row-meta">{{ folder.articleCount ?? 0 }} articles</span>
        </span>
        <UIcon name="i-lucide-chevron-right" class="row-chevron" />
      </button>
    </div>

    <footer v-if="selectedFolder" class="pane-footer folder-actions">
      <a
        :href="`/api/export/folders/${encodeURIComponent(selectedFolder.id)}/txt-zip?includeDeleted=true`"
        class="text-action folder-export"
        title="Export this folder"
      >
        <UIcon name="i-lucide-download" />
        <span>ZIP</span>
      </a>
      <UButton
        icon="i-lucide-pencil"
        label="Edit"
        color="neutral"
        variant="ghost"
        size="sm"
        @click="startEdit"
      />
      <UButton
        v-if="isDeleted(selectedFolder.deleted)"
        icon="i-lucide-rotate-ccw"
        label="Restore"
        color="success"
        variant="soft"
        size="sm"
        @click="emit('restore', selectedFolder)"
      />
      <UButton
        v-else
        icon="i-lucide-trash-2"
        label="Delete"
        color="error"
        variant="ghost"
        size="sm"
        @click="emit('remove', selectedFolder)"
      />
    </footer>
  </section>
</template>
