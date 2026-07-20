<script setup lang="ts">
import type {
  ArticleRecord,
  ArticleSummary,
  FolderRecord,
  Pagination,
} from '#shared/types/writer'
import { apiErrorMessage, isDeleted } from '~/utils/writer'

useHead({ title: 'Library · Writer Archive' })

type FolderStatus = 'active' | 'deleted' | 'all'
type ArticleStatus = 'active' | 'deleted' | 'all'

const route = useRoute()
const router = useRouter()

const folders = ref<FolderRecord[]>([])
const activeFolders = ref<FolderRecord[]>([])
const articles = ref<ArticleSummary[]>([])
const article = ref<ArticleRecord | null>(null)
const folderStatus = ref<FolderStatus>(getInitialFolderStatus())
const articleStatus = ref<ArticleStatus>('active')
const articleSort = ref('rank')
const articleSearch = ref('')
const pagination = ref<Pagination>({
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 1,
})
const foldersLoading = ref(true)
const articlesLoading = ref(false)
const articleLoading = ref(false)
const pageError = ref('')
let articleSearchTimer: ReturnType<typeof setTimeout> | undefined
let articleRequestId = 0

const selectedFolderId = computed(() =>
  typeof route.query.folder === 'string' ? route.query.folder : null,
)
const selectedArticleId = computed(() =>
  typeof route.query.article === 'string' ? route.query.article : null,
)
const selectedFolder = computed(() => {
  const combined = [...folders.value, ...activeFolders.value]
  return combined.find((folder) => folder.id === selectedFolderId.value) ?? null
})
const mobileView = computed<'folders' | 'articles' | 'editor'>(() => {
  const requested = route.query.view
  if (
    requested === 'folders' ||
    requested === 'articles' ||
    requested === 'editor'
  )
    return requested
  if (selectedArticleId.value) return 'editor'
  if (selectedFolderId.value) return 'articles'
  return 'folders'
})
const editorFolders = computed(() => {
  const map = new Map<string, FolderRecord>()
  for (const folder of [...activeFolders.value, ...folders.value])
    map.set(folder.id, folder)
  return [...map.values()]
})

function getInitialFolderStatus(): FolderStatus {
  const status = route.query.folderStatus

  return status === 'deleted' || status === 'all' ? status : 'active'
}

async function loadFolders(selectFirst = false) {
  foldersLoading.value = true
  pageError.value = ''
  try {
    const response = await $fetch<{ folders: FolderRecord[] }>('/api/folders', {
      query: { status: folderStatus.value },
    })
    folders.value = response.folders

    if (folderStatus.value === 'active') {
      activeFolders.value = response.folders
    } else if (activeFolders.value.length === 0) {
      const active = await $fetch<{ folders: FolderRecord[] }>('/api/folders', {
        query: { status: 'active' },
      })
      activeFolders.value = active.folders
    }

    if (selectFirst && !selectedFolderId.value && folders.value[0]) {
      await setRoute(
        { folder: folders.value[0].id, article: undefined, view: undefined },
        true,
      )
    }
  } catch (error) {
    pageError.value = apiErrorMessage(error, 'Folders could not be loaded.')
  } finally {
    foldersLoading.value = false
  }
}

async function loadArticles(page = 1) {
  const requestId = ++articleRequestId

  if (!selectedFolderId.value) {
    articles.value = []
    article.value = null
    articlesLoading.value = false
    return
  }

  articlesLoading.value = true
  pageError.value = ''
  try {
    const response = await $fetch<{
      items: ArticleSummary[]
      pagination: Pagination
    }>(`/api/folders/${encodeURIComponent(selectedFolderId.value)}/articles`, {
      query: {
        page,
        pageSize: 50,
        status: articleStatus.value,
        sort: articleSort.value,
        q: articleSearch.value.trim() || undefined,
      },
    })

    if (requestId !== articleRequestId) return

    articles.value = response.items
    pagination.value = response.pagination
    restoreScroll('articles')
  } catch (error) {
    if (requestId !== articleRequestId) return
    pageError.value = apiErrorMessage(error, 'Articles could not be loaded.')
  } finally {
    if (requestId === articleRequestId) articlesLoading.value = false
  }
}

async function loadArticle() {
  if (!selectedArticleId.value) {
    article.value = null
    return
  }

  articleLoading.value = true
  pageError.value = ''
  try {
    const response = await $fetch<{ article: ArticleRecord }>(
      `/api/articles/${encodeURIComponent(selectedArticleId.value)}`,
    )
    article.value = response.article
  } catch (error) {
    article.value = null
    pageError.value = apiErrorMessage(error, 'The article could not be loaded.')
  } finally {
    articleLoading.value = false
  }
}

async function setRoute(
  values: {
    folder?: string
    article?: string
    view?: 'folders' | 'articles' | 'editor'
  },
  replace = false,
) {
  const query = { ...route.query, ...values }
  await (replace ? router.replace({ query }) : router.push({ query }))
}

async function selectFolder(folder: FolderRecord) {
  saveScroll('folders')
  await setRoute({ folder: folder.id, article: undefined, view: 'articles' })
}

async function selectArticle(selected: ArticleSummary) {
  saveScroll('articles')
  await setRoute({ article: selected.id, view: 'editor' })
}

async function createFolder(value: { name: string; description: string }) {
  pageError.value = ''
  try {
    const response = await $fetch<{ folder: FolderRecord }>('/api/folders', {
      method: 'POST',
      body: value,
    })
    folderStatus.value = 'active'
    await loadFolders()
    await setRoute({
      folder: response.folder.id,
      article: undefined,
      view: 'articles',
    })
  } catch (error) {
    pageError.value = apiErrorMessage(error, 'The folder could not be created.')
  }
}

async function updateFolder(
  id: string,
  value: { name: string; description: string },
) {
  try {
    await $fetch(`/api/folders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: value,
    })
    await loadFolders()
  } catch (error) {
    pageError.value = apiErrorMessage(error, 'The folder could not be updated.')
  }
}

async function changeFolderDeleted(folder: FolderRecord, restore: boolean) {
  if (
    !restore &&
    !confirm(
      `Move “${folder.name}” to deleted items? Its articles will remain recoverable.`,
    )
  )
    return
  try {
    await $fetch(
      `/api/folders/${encodeURIComponent(folder.id)}/${restore ? 'restore' : 'delete'}`,
      {
        method: 'POST',
      },
    )
    await loadFolders()
    if (!folders.value.some((item) => item.id === selectedFolderId.value)) {
      await setRoute(
        { folder: undefined, article: undefined, view: 'folders' },
        true,
      )
    }
  } catch (error) {
    pageError.value = apiErrorMessage(
      error,
      `The folder could not be ${restore ? 'restored' : 'deleted'}.`,
    )
  }
}

async function createArticle() {
  if (!selectedFolderId.value) return
  try {
    const response = await $fetch<{ article: ArticleRecord }>('/api/articles', {
      method: 'POST',
      body: {
        folderId: selectedFolderId.value,
        title: 'Untitled',
        content: '',
      },
    })
    await loadArticles(1)
    await setRoute({ article: response.article.id, view: 'editor' })
  } catch (error) {
    pageError.value = apiErrorMessage(
      error,
      'The article could not be created.',
    )
  }
}

async function handleArticleSaved(saved: ArticleRecord) {
  article.value = saved
  if (saved.folderId !== selectedFolderId.value) {
    await setRoute(
      { folder: saved.folderId, article: saved.id, view: 'editor' },
      true,
    )
  }
  await loadArticles(pagination.value.page)
  await loadFolders()
}

async function handleArticleDeleted(saved: ArticleRecord) {
  article.value = saved
  await loadArticles(pagination.value.page)
  await loadFolders()
}

async function changeFolderStatus(value: FolderStatus) {
  folderStatus.value = value
  await loadFolders()
}

async function changeArticleStatus(value: ArticleStatus) {
  articleStatus.value = value
  cancelArticleSearchTimer()
  await loadArticles(1)
}

async function changeSort(value: string) {
  articleSort.value = value
  cancelArticleSearchTimer()
  await loadArticles(1)
}

function changeArticleSearch(value: string) {
  articleSearch.value = value
  cancelArticleSearchTimer()
  articleSearchTimer = setTimeout(() => void loadArticles(1), 300)
}

function cancelArticleSearchTimer() {
  if (articleSearchTimer) clearTimeout(articleSearchTimer)
  articleSearchTimer = undefined
}

function saveScroll(name: string) {
  if (!import.meta.client) return
  const element = document.querySelector<HTMLElement>(
    `.${name === 'folders' ? 'folder-list' : 'article-list'}.scroll-region`,
  )
  if (element)
    sessionStorage.setItem(`writer-scroll:${name}`, String(element.scrollTop))
}

function restoreScroll(name: string) {
  if (!import.meta.client) return
  nextTick(() => {
    const element = document.querySelector<HTMLElement>(
      `.${name === 'folders' ? 'folder-list' : 'article-list'}.scroll-region`,
    )
    const saved = Number(sessionStorage.getItem(`writer-scroll:${name}`))
    if (element && Number.isFinite(saved)) element.scrollTop = saved
  })
}

watch(selectedFolderId, () => {
  articleSearch.value = ''
  cancelArticleSearchTimer()
  void loadArticles(1)
})
watch(selectedArticleId, () => void loadArticle())

onBeforeUnmount(cancelArticleSearchTimer)

onMounted(async () => {
  const hasFolderRoute = Boolean(selectedFolderId.value)

  await loadFolders(true)

  if (
    selectedFolderId.value &&
    !selectedFolder.value &&
    folderStatus.value === 'active'
  ) {
    folderStatus.value = 'all'
    await loadFolders()
  }

  if (selectedFolderId.value) await loadArticles(1)
  if (selectedArticleId.value) await loadArticle()
  if (!hasFolderRoute) restoreScroll('folders')
})
</script>

<template>
  <div class="library-page">
    <div v-if="pageError" class="page-alert" role="alert">
      <UIcon name="i-lucide-triangle-alert" />
      <span>{{ pageError }}</span>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        aria-label="Dismiss"
        @click="pageError = ''"
      />
    </div>

    <div class="library-grid" :data-mobile-view="mobileView">
      <FolderPanel
        :folders="folders"
        :selected-id="selectedFolderId"
        :loading="foldersLoading"
        :status="folderStatus"
        @select="selectFolder"
        @status="changeFolderStatus"
        @create="createFolder"
        @update="updateFolder"
        @remove="(folder) => changeFolderDeleted(folder, false)"
        @restore="(folder) => changeFolderDeleted(folder, true)"
      />

      <ArticleListPanel
        :folder="selectedFolder"
        :articles="articles"
        :selected-id="selectedArticleId"
        :loading="articlesLoading"
        :status="articleStatus"
        :sort="articleSort"
        :search="articleSearch"
        :pagination="pagination"
        @back="setRoute({ view: 'folders' })"
        @select="selectArticle"
        @create="createArticle"
        @status="changeArticleStatus"
        @sort="changeSort"
        @search="changeArticleSearch"
        @page="loadArticles"
      />

      <ArticleEditor
        :article="article"
        :folders="editorFolders.filter((folder) => !isDeleted(folder.deleted))"
        :loading="articleLoading"
        @back="setRoute({ view: 'articles' })"
        @saved="handleArticleSaved"
        @removed="handleArticleDeleted"
      />
    </div>
  </div>
</template>
