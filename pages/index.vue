<script setup lang="ts">
import type {
  ArticleRecord,
  ArticleSummary,
  FolderRecord,
  Pagination,
} from '#shared/types/writer'
import {
  apiErrorMessage,
  apiErrorStatusCode,
  clearWriterPreference,
  isDeleted,
  readWriterPreference,
  writeWriterPreference,
} from '~/utils/writer'

useHead({ title: 'Library · Writer Archive' })

type FolderStatus = 'active' | 'deleted' | 'all'
type ArticleStatus = 'active' | 'deleted' | 'all'
type ArticleSort = 'rank' | 'updated' | 'created' | 'title' | 'count'

interface LibraryResponse {
  folders: FolderRecord[]
  activeFolders: FolderRecord[]
  folderStatus: FolderStatus
  selectedFolderId: string | null
  items: ArticleSummary[]
  pagination: Pagination
  article: ArticleRecord | null
}

const LIBRARY_FILTERS_KEY = 'writer:filters:library:v1'
const LAST_OPENED_ARTICLE_KEY = 'writer:last-opened-article:v1'

const route = useRoute()
const router = useRouter()
const { clear: clearSession } = useUserSession()

const folders = ref<FolderRecord[]>([])
const activeFolders = ref<FolderRecord[]>([])
const articles = ref<ArticleSummary[]>([])
const article = ref<ArticleRecord | null>(null)
const folderStatus = ref<FolderStatus>(getInitialFolderStatus())
const articleStatus = ref<ArticleStatus>('active')
const articleSort = ref<ArticleSort>('rank')
const articleSearch = ref('')
const pagination = ref<Pagination>({
  page: 1,
  pageSize: 100,
  total: 0,
  totalPages: 1,
})
const foldersLoading = ref(true)
const articlesLoading = ref(false)
const articleLoading = ref(false)
const pageError = ref('')
let articleSearchTimer: ReturnType<typeof setTimeout> | undefined
let folderRequestId = 0
let articleRequestId = 0
let articleDetailRequestId = 0
let initializingLibrary = true

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
  return getRouteFolderStatus() ?? 'active'
}

function getRouteFolderStatus(): FolderStatus | null {
  const status = route.query.folderStatus

  return status === 'active' || status === 'deleted' || status === 'all'
    ? status
    : null
}

function restoreLibraryFilters(): void {
  const stored = readWriterPreference(LIBRARY_FILTERS_KEY)

  if (!isRecord(stored)) return

  if (!getRouteFolderStatus() && isStatusFilter(stored.folderStatus)) {
    folderStatus.value = stored.folderStatus
  }

  if (isStatusFilter(stored.articleStatus)) {
    articleStatus.value = stored.articleStatus
  }

  if (isArticleSort(stored.articleSort)) {
    articleSort.value = stored.articleSort
  }
}

function persistLibraryFilters(): void {
  writeWriterPreference(LIBRARY_FILTERS_KEY, {
    folderStatus: folderStatus.value,
    articleStatus: articleStatus.value,
    articleSort: articleSort.value,
  })
}

async function restoreLastOpenedArticle(): Promise<void> {
  // A direct folder/article URL always wins over the saved location.
  if (selectedFolderId.value || selectedArticleId.value) return

  const stored = readWriterPreference(LAST_OPENED_ARTICLE_KEY)

  if (
    !isRecord(stored) ||
    !isStoredId(stored.folderId) ||
    !isStoredId(stored.articleId)
  ) {
    return
  }

  await setRoute(
    {
      folder: stored.folderId,
      article: stored.articleId,
      view: 'editor',
    },
    true,
  )
}

function rememberLastOpenedArticle(opened: ArticleRecord): void {
  writeWriterPreference(LAST_OPENED_ARTICLE_KEY, {
    folderId: opened.folderId,
    articleId: opened.id,
  })
}

function forgetLastOpenedArticle(expected: {
  folderId?: string
  articleId?: string
}): void {
  const stored = readWriterPreference(LAST_OPENED_ARTICLE_KEY)

  if (!isRecord(stored)) return
  if (expected.folderId && stored.folderId !== expected.folderId) return
  if (expected.articleId && stored.articleId !== expected.articleId) return

  clearWriterPreference(LAST_OPENED_ARTICLE_KEY)
}

function isStoredId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
}

function isStatusFilter(value: unknown): value is FolderStatus {
  return value === 'active' || value === 'deleted' || value === 'all'
}

function isArticleSort(value: unknown): value is ArticleSort {
  return (
    value === 'rank' ||
    value === 'updated' ||
    value === 'created' ||
    value === 'title' ||
    value === 'count'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function loadFolders(selectFirst = false) {
  const requestId = ++folderRequestId
  const requestedStatus = folderStatus.value

  foldersLoading.value = true
  pageError.value = ''
  try {
    const response = await $fetch<{ folders: FolderRecord[] }>('/api/folders', {
      query: { status: requestedStatus },
    })

    if (requestId !== folderRequestId) return

    folders.value = response.folders

    if (requestedStatus === 'active') {
      activeFolders.value = response.folders
    } else if (activeFolders.value.length === 0) {
      const active = await $fetch<{ folders: FolderRecord[] }>('/api/folders', {
        query: { status: 'active' },
      })

      if (requestId !== folderRequestId) return

      activeFolders.value = active.folders
    }

    if (selectFirst && !selectedFolderId.value && folders.value[0]) {
      await setRoute(
        { folder: folders.value[0].id, article: undefined, view: undefined },
        true,
      )
    }
  } catch (error) {
    if (requestId !== folderRequestId) return
    pageError.value = apiErrorMessage(error, 'Folders could not be loaded.')
  } finally {
    if (requestId === folderRequestId) foldersLoading.value = false
  }
}

async function loadInitialLibrary() {
  const requestedFolderId = selectedFolderId.value
  const requestedArticleId = selectedArticleId.value
  const requestedPath = route.fullPath

  foldersLoading.value = true
  articlesLoading.value = Boolean(requestedFolderId)
  articleLoading.value = Boolean(requestedArticleId)
  pageError.value = ''

  try {
    const response = await $fetch<LibraryResponse>('/api/library', {
      query: {
        page: 1,
        pageSize: 100,
        folderStatus: folderStatus.value,
        articleStatus: articleStatus.value,
        sort: articleSort.value,
        folderId: requestedFolderId ?? undefined,
        articleId: requestedArticleId ?? undefined,
      },
    })

    folders.value = response.folders
    activeFolders.value = response.activeFolders
    folderStatus.value = response.folderStatus
    articles.value = response.items
    pagination.value = response.pagination
    article.value = response.article

    if (response.article) {
      rememberLastOpenedArticle(response.article)
    } else if (requestedArticleId) {
      forgetLastOpenedArticle({ articleId: requestedArticleId })
      pageError.value = 'The previously opened article is no longer available.'
    }

    const availableFolderIds = new Set(
      [...response.folders, ...response.activeFolders].map(
        (folder) => folder.id,
      ),
    )

    if (requestedFolderId && !availableFolderIds.has(requestedFolderId)) {
      forgetLastOpenedArticle({ folderId: requestedFolderId })
    }

    const routeValues: {
      folder?: string
      article?: string
      view?: 'folders' | 'articles' | 'editor'
    } = {}

    if (response.selectedFolderId !== selectedFolderId.value) {
      routeValues.folder = response.selectedFolderId ?? undefined
    }

    if (requestedArticleId && !response.article) {
      routeValues.article = undefined
      routeValues.view = response.selectedFolderId ? 'articles' : 'folders'
    } else if (response.article) {
      routeValues.folder = response.article.folderId
      routeValues.article = response.article.id
    }

    if (Object.keys(routeValues).length > 0) {
      await setRoute(routeValues, true)
    }

    restoreScroll('articles')
  } catch (error) {
    if (apiErrorStatusCode(error) === 401) {
      try {
        await clearSession()
      } catch {
        // The API response already invalidated the server-side session.
      }

      await navigateTo(
        { path: '/login', query: { redirect: requestedPath } },
        { replace: true },
      )
      return
    }

    pageError.value = apiErrorMessage(error, 'The Library could not be loaded.')
  } finally {
    foldersLoading.value = false
    articlesLoading.value = false
    articleLoading.value = false
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
        pageSize: 100,
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
  const requestId = ++articleDetailRequestId
  const requestedArticleId = selectedArticleId.value
  const requestedPath = route.fullPath

  if (!requestedArticleId) {
    article.value = null
    articleLoading.value = false
    return
  }

  articleLoading.value = true
  pageError.value = ''
  try {
    const response = await $fetch<{ article: ArticleRecord }>(
      `/api/articles/${encodeURIComponent(requestedArticleId)}`,
      { retry: 1, retryDelay: 250 },
    )

    if (requestId !== articleDetailRequestId) return

    article.value = response.article
    rememberLastOpenedArticle(response.article)
  } catch (error) {
    if (requestId !== articleDetailRequestId) return

    article.value = null

    if (apiErrorStatusCode(error) === 401) {
      try {
        await clearSession()
      } catch {
        // The API response already invalidated the server-side session.
      }

      if (requestId === articleDetailRequestId) {
        await navigateTo(
          { path: '/login', query: { redirect: requestedPath } },
          { replace: true },
        )
      }
      return
    }

    if (apiErrorStatusCode(error) === 404) {
      forgetLastOpenedArticle({ articleId: requestedArticleId })

      if (requestId === articleDetailRequestId) {
        await setRoute({ article: undefined, view: 'articles' }, true)
        pageError.value =
          'The previously opened article is no longer available.'
      }
      return
    }

    pageError.value = apiErrorMessage(error, 'The article could not be loaded.')
  } finally {
    if (requestId === articleDetailRequestId) articleLoading.value = false
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
  rememberLastOpenedArticle(saved)
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
  if (!isArticleSort(value)) return
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
  if (initializingLibrary) return
  articleSearch.value = ''
  cancelArticleSearchTimer()
  void loadArticles(1)
})
watch(selectedArticleId, () => {
  if (!initializingLibrary) void loadArticle()
})
watch([folderStatus, articleStatus, articleSort], persistLibraryFilters)

onBeforeUnmount(cancelArticleSearchTimer)

onMounted(async () => {
  try {
    restoreLibraryFilters()
    await restoreLastOpenedArticle()
    const hasFolderRoute = Boolean(selectedFolderId.value)

    await loadInitialLibrary()
    if (!hasFolderRoute) restoreScroll('folders')
  } finally {
    initializingLibrary = false
  }
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
        :view-active="mobileView === 'folders'"
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
