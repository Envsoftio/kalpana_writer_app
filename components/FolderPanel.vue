<script setup lang="ts">
import type { FolderRecord } from '#shared/types/writer'
import { isDeleted } from '~/utils/writer'

const props = defineProps<{
  folders: FolderRecord[]
  selectedId: string | null
  loading: boolean
  status: 'active' | 'deleted' | 'all'
}>()

const emit = defineEmits<{
  select: [folder: FolderRecord]
  status: [value: 'active' | 'deleted' | 'all']
  create: [value: { name: string; description: string }]
  update: [id: string, value: { name: string; description: string }]
  remove: [folder: FolderRecord]
  restore: [folder: FolderRecord]
}>()

const showCreate = ref(false)
const showEdit = ref(false)
const name = ref('')
const description = ref('')

const selectedFolder = computed(
  () => props.folders.find((folder) => folder.id === props.selectedId) ?? null,
)

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
  emit('create', { name: name.value.trim(), description: description.value.trim() })
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

    <div class="segmented-control" aria-label="Folder status filter">
      <button
        v-for="option in ['active', 'deleted', 'all'] as const"
        :key="option"
        :class="{ active: status === option }"
        @click="emit('status', option)"
      >
        {{ option }}
      </button>
    </div>

    <form v-if="showCreate || showEdit" class="inline-editor" @submit.prevent="showCreate ? submitCreate() : submitEdit()">
      <strong>{{ showCreate ? 'New folder' : 'Edit folder' }}</strong>
      <UInput v-model="name" placeholder="Folder name" autofocus required />
      <UTextarea v-model="description" placeholder="Description (optional)" :rows="3" />
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="showCreate = showEdit = false"
        />
        <UButton type="submit" :label="showCreate ? 'Create' : 'Save'" size="sm" />
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

    <div v-else class="folder-list scroll-region">
      <button
        v-for="folder in folders"
        :key="folder.id"
        class="folder-row"
        :class="{ selected: folder.id === selectedId }"
        @click="emit('select', folder)"
      >
        <span class="folder-icon"><UIcon name="i-lucide-folder" /></span>
        <span class="min-w-0 flex-1">
          <span class="row-title">
            {{ folder.name }}
            <UBadge v-if="isDeleted(folder.deleted)" color="error" variant="subtle" size="sm">Deleted</UBadge>
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
