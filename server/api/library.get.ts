import { z } from 'zod'

const querySchema = paginationQuerySchema.extend({
  folderStatus: z.enum(['active', 'deleted', 'all']).default('active'),
  articleStatus: z.enum(['active', 'deleted', 'all']).default('active'),
  sort: z
    .enum(['rank', 'updated', 'created', 'title', 'count'])
    .default('rank'),
  direction: z.enum(['asc', 'desc']).optional(),
  folderId: entityIdSchema.optional(),
  articleId: entityIdSchema.optional(),
})

/**
 * Loads the complete initial Library workspace in one database batch.
 * This avoids a high-latency folder -> list -> article request waterfall.
 */
export default defineProtectedEventHandler(async (event) => {
  const query = validateQuery(event, querySchema)
  const target = createTargetFolder(query)
  const articleStatements = createArticleListStatements(target, {
    page: query.page,
    pageSize: query.pageSize,
    status: query.articleStatus,
    sort: query.sort,
    direction: query.direction,
  })
  const statements = [
    createFolderListStatement('all'),
    articleStatements.count,
    articleStatements.items,
  ]

  if (query.articleId) {
    statements.push(createArticleDetailStatement(query.articleId))
  }

  const results = await getDatabaseClient(event).batch(statements)
  const allFolders = mapFolderRows(results[0]!.rows)
  const article = query.articleId ? articleFromResult(results[3]!) : null
  const selectedFolderId = resolveSelectedFolderId({
    allFolders,
    articleFolderId: article?.folderId,
    requestedFolderId: query.folderId,
    requestedStatus: query.folderStatus,
  })
  const effectiveFolderStatus = selectedFolderId
    ? includeSelectedFolder(allFolders, selectedFolderId, query.folderStatus)
    : query.folderStatus
  const articleList = createArticleListResponse(results[1]!, results[2]!, query)

  return {
    folders: filterFolders(allFolders, effectiveFolderStatus),
    activeFolders: filterFolders(allFolders, 'active'),
    folderStatus: effectiveFolderStatus,
    selectedFolderId,
    ...articleList,
    article,
  }
})

interface LibraryTargetQuery {
  folderStatus: WriterFolderStatus
  folderId?: string
  articleId?: string
}

function createTargetFolder(query: LibraryTargetQuery): ArticleFolderTarget {
  const candidates: string[] = []
  const args: Array<string | number | null> = []

  if (query.articleId) {
    candidates.push('(SELECT folderId FROM Article WHERE id = ? LIMIT 1)')
    args.push(query.articleId)
  }

  if (query.folderId) {
    candidates.push('(SELECT id FROM Folder WHERE id = ? LIMIT 1)')
    args.push(query.folderId)
  }

  const statusFilter =
    query.folderStatus === 'all'
      ? ''
      : query.folderStatus === 'active'
        ? 'WHERE folder.deleted = 0'
        : 'WHERE folder.deleted = 1'
  candidates.push(`(
    SELECT folder.id
    FROM Folder AS folder
    ${statusFilter}
    ORDER BY folder.rank ASC, folder.name COLLATE NOCASE ASC, folder.id ASC
    LIMIT 1
  )`)

  return {
    sql:
      candidates.length === 1
        ? candidates[0]!
        : `COALESCE(${candidates.join(', ')})`,
    args,
  }
}

function resolveSelectedFolderId(options: {
  allFolders: WriterFolderRecord[]
  articleFolderId?: string
  requestedFolderId?: string
  requestedStatus: WriterFolderStatus
}): string | null {
  if (
    options.articleFolderId &&
    options.allFolders.some((folder) => folder.id === options.articleFolderId)
  ) {
    return options.articleFolderId
  }

  if (
    options.requestedFolderId &&
    options.allFolders.some((folder) => folder.id === options.requestedFolderId)
  ) {
    return options.requestedFolderId
  }

  return (
    filterFolders(options.allFolders, options.requestedStatus)[0]?.id ?? null
  )
}

function includeSelectedFolder(
  folders: WriterFolderRecord[],
  selectedFolderId: string,
  requestedStatus: WriterFolderStatus,
): WriterFolderStatus {
  const selected = folders.find((folder) => folder.id === selectedFolderId)

  return selected && folderMatchesStatus(selected, requestedStatus)
    ? requestedStatus
    : 'all'
}

function filterFolders(
  folders: WriterFolderRecord[],
  status: WriterFolderStatus,
): WriterFolderRecord[] {
  return folders.filter((folder) => folderMatchesStatus(folder, status))
}

function folderMatchesStatus(
  folder: WriterFolderRecord,
  status: WriterFolderStatus,
): boolean {
  if (status === 'all') return true

  return status === 'deleted' ? folder.deleted !== 0 : folder.deleted === 0
}
