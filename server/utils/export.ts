import { strToU8, zipSync, type Zippable } from 'fflate'
import type { H3Event } from 'h3'

const ARCHIVE_ROOT = 'Writer Export'
const EXPORT_VERSION = 1
const MAX_EXPORT_NAME_LENGTH = 120
const ARTICLE_PAGE_SIZE = 200
const INITIAL_EXPORT_PART_SOURCE_BYTES = 10_000_000
// Browser export pages are JSON responses, so keep the source-text target well
// below host response limits after serialization overhead is added.
export const CLIENT_EXPORT_PAGE_SOURCE_BYTES = 1_000_000
export const MAX_EXPORT_PART_BYTES = 4_000_000
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
// C0 controls are intentionally rejected because archive paths must be portable.
// eslint-disable-next-line no-control-regex
const UNSAFE_EXPORT_CHARACTER = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g

export const FULL_TEXT_ZIP_FORMAT = 'txt-zip' as const
export const FULL_TEXT_ZIP_WITH_DELETED_FORMAT = 'txt-zip+deleted' as const

export interface WriterFolderExport {
  id: string
  name: string
  createdTime: number
  description: string | null
  rank: number
  deleted: boolean
  deletedTime: number
  updateTime: number
}

export interface WriterArticleExport {
  id: string
  title: string
  content: string
  summary: string | null
  count: number | null
  extension: string
  updateTime: number
  createTime: number
  folderId: string
  folderName: string
  categoryId: string | null
  rank: number
  deleted: boolean
  deletedTime: number
  orderKey: string | null
}

export interface WriterCategoryExport {
  id: string
  folderId: string
  name: string
  createdTime: number
  rank: number
  description: string | null
  updateTime: number
  deleted: boolean
  deletedTime: number
  orderKey: string | null
}

export interface WriterExportData {
  folders: WriterFolderExport[]
  articles: WriterArticleExport[]
  categories: WriterCategoryExport[]
}

export interface WriterExportMetadata {
  exportInfo: {
    version: number
    format: 'writer-text-zip'
    exportedAt: string
    includeDeleted: boolean
    folderCount: number
    articleCount: number
    categoryCount: number
  }
  folders: Array<WriterFolderExport & { path: string }>
  articles: Array<Omit<WriterArticleExport, 'content'> & { path: string }>
  categories: WriterCategoryExport[]
}

export interface WriterExportPathContext {
  folderPaths: Map<string, string>
  articlePaths: Map<string, string>
}

export interface BuiltWriterZip {
  bytes: Uint8Array<ArrayBuffer>
  metadata: WriterExportMetadata
}

export interface BuiltWriterZipPart extends BuiltWriterZip {
  data: WriterExportData
}

export interface FullExportJobFormat {
  includeDeleted: boolean
  partIndex: number
  partCount: number
}

export interface WriterExportPartPlan {
  articleOffset: number
  articleCount: number
  estimatedBytes: number
}

export interface WriterExportPlan {
  parts: WriterExportPartPlan[]
  pathContext: WriterExportPathContext
  articleCount: number
  articleIds: string[]
  folderArticleCounts: WriterExportFolderArticleCount[]
  articleNameOccurrences: number[]
}

export interface WriterExportFolderArticleCount {
  folderId: string
  articleCount: number
}

export interface BrowserExportSnapshot {
  pageArticleCounts: number[]
  articleIds: string[]
  folderArticleCounts: WriterExportFolderArticleCount[]
  articleNameOccurrences: number[]
}

export interface BrowserExportJobFormat {
  includeDeleted: boolean
  pageCount: number
  snapshot: BrowserExportSnapshot | null
}

/**
 * Turns untrusted Writer titles into a safe, portable path segment.
 * Unicode is retained, while path separators, controls and Windows-reserved
 * basenames are removed or rewritten.
 */
export function sanitizeExportName(
  value: unknown,
  fallback = 'Untitled',
  maxLength = MAX_EXPORT_NAME_LENGTH,
): string {
  const safeFallback = String(fallback || 'Untitled')
    .normalize('NFKC')
    .replace(UNSAFE_EXPORT_CHARACTER, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '')

  let name = String(value ?? '')
    .normalize('NFKC')
    .replace(UNSAFE_EXPORT_CHARACTER, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '')

  name = truncateCodePoints(name, maxLength).replace(/^[. ]+|[. ]+$/g, '')

  if (!name || name === '.' || name === '..') {
    name = truncateCodePoints(safeFallback, maxLength) || 'Untitled'
  }

  if (WINDOWS_RESERVED_NAME.test(name)) {
    name = `${name}_`
  }

  return name
}

/** Formats one article as a self-describing, UTF-8 plain-text document. */
export function formatArticleText(article: WriterArticleExport): string {
  const header = [
    `Title: ${formatHeaderValue(article.title, 'Untitled')}`,
    `Folder: ${formatHeaderValue(article.folderName, 'Unknown Folder')}`,
    `Created: ${formatWriterTimestamp(article.createTime)}`,
    `Updated: ${formatWriterTimestamp(article.updateTime)}`,
    `Deleted: ${article.deleted ? 'true' : 'false'}`,
    `Article ID: ${formatHeaderValue(article.id, 'Unknown')}`,
  ]

  return `${header.join('\n')}\n\n${article.content}`
}

/** Builds the reconstruction metadata used both in the ZIP and by tests/UI. */
export function buildExportMetadata(
  data: WriterExportData,
  options: {
    includeDeleted: boolean
    exportedAt?: Date
    pathContext?: WriterExportPathContext
  } = {
    includeDeleted: false,
  },
): WriterExportMetadata {
  const exportedAt = (options.exportedAt ?? new Date()).toISOString()
  const paths = options.pathContext ?? createWriterExportPathContext(data)

  return {
    exportInfo: {
      version: EXPORT_VERSION,
      format: 'writer-text-zip',
      exportedAt,
      includeDeleted: options.includeDeleted,
      folderCount: data.folders.length,
      articleCount: data.articles.length,
      categoryCount: data.categories.length,
    },
    folders: data.folders.map((folder) => ({
      ...folder,
      path: paths.folderPaths.get(folder.id) ?? '',
    })),
    articles: data.articles.map(({ content: _content, ...article }) => ({
      ...article,
      path: paths.articlePaths.get(article.id) ?? '',
    })),
    categories: data.categories,
  }
}

/** Creates the required folder-based text ZIP entirely in request memory. */
export function buildWriterTextZip(
  data: WriterExportData,
  options: {
    includeDeleted: boolean
    exportedAt?: Date
    pathContext?: WriterExportPathContext
  } = {
    includeDeleted: false,
  },
): BuiltWriterZip {
  const metadata = buildExportMetadata(data, options)
  const files: Zippable = {}
  const articlePaths = new Map(
    metadata.articles.map((article) => [article.id, article.path]),
  )

  for (const folder of metadata.folders) {
    if (folder.path) {
      files[`${folder.path}/`] = new Uint8Array()
    }
  }

  for (const article of data.articles) {
    const path = articlePaths.get(article.id)

    if (path) {
      files[path] = strToU8(formatArticleText(article))
    }
  }

  files[`${ARCHIVE_ROOT}/_metadata/export-info.json`] = encodeJson(
    metadata.exportInfo,
  )
  files[`${ARCHIVE_ROOT}/_metadata/folders.json`] = encodeJson(metadata.folders)
  files[`${ARCHIVE_ROOT}/_metadata/articles.json`] = encodeJson(
    metadata.articles,
  )
  files[`${ARCHIVE_ROOT}/_metadata/categories.json`] = encodeJson(
    metadata.categories,
  )

  return {
    bytes: zipSync(files, { level: 6 }),
    metadata,
  }
}

export function buildWriterTextZipParts(
  data: WriterExportData,
  options: {
    includeDeleted: boolean
    exportedAt?: Date
    initialSourceBytes?: number
    maximumPartBytes?: number
  },
): BuiltWriterZipPart[] {
  const pathContext = createWriterExportPathContext(data)
  const initialParts = partitionArticlesBySourceSize(
    data.articles,
    options.initialSourceBytes ?? INITIAL_EXPORT_PART_SOURCE_BYTES,
  )
  const parts: BuiltWriterZipPart[] = []

  for (const articles of initialParts) {
    addSizeCappedPart(articles)
  }

  return parts

  function addSizeCappedPart(articles: WriterArticleExport[]): void {
    const partData = {
      folders: data.folders,
      articles,
      categories: data.categories,
    }
    const archive = buildWriterTextZip(partData, {
      ...options,
      pathContext,
    })

    if (
      archive.bytes.byteLength <=
      (options.maximumPartBytes ?? MAX_EXPORT_PART_BYTES)
    ) {
      parts.push({ ...archive, data: partData })
      return
    }

    if (articles.length <= 1) {
      throw createError({
        statusCode: 413,
        statusMessage: 'One article is too large to export on this host.',
      })
    }

    const midpoint = Math.ceil(articles.length / 2)
    addSizeCappedPart(articles.slice(0, midpoint))
    addSizeCappedPart(articles.slice(midpoint))
  }
}

function partitionArticlesBySourceSize(
  articles: WriterArticleExport[],
  maximumBytes: number,
): WriterArticleExport[][] {
  if (articles.length === 0) return [[]]

  const parts: WriterArticleExport[][] = []
  let current: WriterArticleExport[] = []
  let currentBytes = 0

  for (const article of articles) {
    const articleBytes = strToU8(formatArticleText(article)).byteLength + 1024

    if (current.length > 0 && currentBytes + articleBytes > maximumBytes) {
      parts.push(current)
      current = []
      currentBytes = 0
    }

    current.push(article)
    currentBytes += articleBytes
  }

  if (current.length > 0) parts.push(current)

  return parts
}

/** Loads a complete, consistently ordered export without one huge DB response. */
export async function loadWriterExportData(
  event: H3Event,
  options: {
    includeDeleted: boolean
    folderId?: string
    articleOffset?: number
    articleLimit?: number
    articleIds?: string[]
  },
): Promise<WriterExportData> {
  const client = getDatabaseClient(event)
  const folderPredicate = options.folderId ? 'AND f.id = ?' : ''
  const activeFolderPredicate = options.includeDeleted
    ? ''
    : 'AND f.deleted = 0'
  const folderArgs = options.folderId ? [options.folderId] : []

  const folderResult = await client.execute({
    sql: `
      SELECT
        f.id,
        f.name,
        f.createdTime,
        f.description,
        f.rank,
        f.deleted,
        f.deletedTime,
        f.updateTime
      FROM Folder AS f
      WHERE 1 = 1
        ${folderPredicate}
        ${activeFolderPredicate}
      ORDER BY f.rank ASC, f.name COLLATE NOCASE ASC, f.id ASC
    `,
    args: folderArgs,
  })

  const folders = folderResult.rows.map(mapFolderRow)

  if (options.folderId && folders.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Folder not found.',
    })
  }

  if (folders.length === 0) {
    return { folders, articles: [], categories: [] }
  }

  const articles: WriterArticleExport[] = []
  const preparedArticleIds = options.articleIds

  if (preparedArticleIds) {
    await appendArticlesById(preparedArticleIds)
  } else {
    let offset = options.articleOffset ?? 0
    let remaining = options.articleLimit ?? Number.POSITIVE_INFINITY

    while (remaining > 0) {
      const pageSize = Math.min(ARTICLE_PAGE_SIZE, remaining)
      const articleIdResult = await client.execute({
        sql: `
          SELECT a.id
          FROM Article AS a
          INNER JOIN Folder AS f ON f.id = a.folderId
          WHERE 1 = 1
            ${folderPredicate}
            ${activeFolderPredicate}
            ${options.includeDeleted ? '' : 'AND a.deleted = 0'}
          ORDER BY
            f.rank ASC,
            f.name COLLATE NOCASE ASC,
            f.id ASC,
            a.rank ASC,
            CASE WHEN a.orderKey IS NULL OR a.orderKey = '' THEN 1 ELSE 0 END ASC,
            a.orderKey COLLATE NOCASE ASC,
            a.title COLLATE NOCASE ASC,
            a.createTime ASC,
            a.id ASC
          LIMIT ? OFFSET ?
        `,
        args: [...folderArgs, pageSize, offset],
      })
      const articleIds = articleIdResult.rows.map((row) =>
        requiredString(row.id),
      )

      await appendArticlesById(articleIds)
      remaining -= articleIds.length

      if (articleIds.length < pageSize) {
        break
      }

      offset += pageSize
    }
  }

  const categoryResult = await client.execute({
    sql: `
      SELECT
        c.id,
        c.folderId,
        c.name,
        c.createdTime,
        c.rank,
        c.description,
        c.updateTime,
        c.deleted,
        c.deletedTime,
        c.orderKey
      FROM Category AS c
      INNER JOIN Folder AS f ON f.id = c.folderId
      WHERE 1 = 1
        ${folderPredicate}
        ${activeFolderPredicate}
        ${options.includeDeleted ? '' : 'AND c.deleted = 0'}
      ORDER BY
        f.rank ASC,
        f.name COLLATE NOCASE ASC,
        f.id ASC,
        c.rank ASC,
        CASE WHEN c.orderKey IS NULL OR c.orderKey = '' THEN 1 ELSE 0 END ASC,
        c.orderKey COLLATE NOCASE ASC,
        c.name COLLATE NOCASE ASC,
        c.id ASC
    `,
    args: folderArgs,
  })

  return {
    folders,
    articles,
    categories: categoryResult.rows.map(mapCategoryRow),
  }

  async function appendArticlesById(articleIds: string[]): Promise<void> {
    for (let start = 0; start < articleIds.length; start += ARTICLE_PAGE_SIZE) {
      const idBatch = articleIds.slice(start, start + ARTICLE_PAGE_SIZE)
      const placeholders = idBatch.map(() => '?').join(', ')
      const articleResult = await client.execute({
        sql: `
          SELECT
            a.id,
            a.title,
            a.content,
            a.summary,
            a.count,
            a.extension,
            a.updateTime,
            a.createTime,
            a.folderId,
            f.name AS folderName,
            a.categoryId,
            a.rank,
            a.deleted,
            a.deletedTime,
            a.orderKey
          FROM Article AS a
          INNER JOIN Folder AS f ON f.id = a.folderId
          WHERE 1 = 1
            ${folderPredicate}
            ${activeFolderPredicate}
            ${options.includeDeleted ? '' : 'AND a.deleted = 0'}
            AND a.id IN (${placeholders})
        `,
        args: [...folderArgs, ...idBatch],
      })
      const articlesById = new Map(
        articleResult.rows.map((row) => {
          const article = mapArticleRow(row)
          return [article.id, article] as const
        }),
      )

      for (const articleId of idBatch) {
        const article = articlesById.get(articleId)

        if (article) articles.push(article)
      }
    }
  }
}

/** Builds a multipart plan without loading article bodies or creating ZIPs. */
export async function loadWriterExportPlan(
  event: H3Event,
  options: { includeDeleted: boolean; maximumEstimatedBytes?: number },
): Promise<WriterExportPlan> {
  const client = getDatabaseClient(event)
  const activeFolderPredicate = options.includeDeleted ? '' : 'AND f.deleted = 0'
  const folderResult = await client.execute({
    sql: `
      SELECT id, name
      FROM Folder AS f
      WHERE 1 = 1 ${activeFolderPredicate}
      ORDER BY f.rank ASC, f.name COLLATE NOCASE ASC, f.id ASC
    `,
    args: [],
  })
  const articleResult = await client.execute({
    sql: `
      SELECT
        a.id,
        a.title,
        a.folderId,
        length(CAST(COALESCE(a.content, '') AS BLOB))
          + length(CAST(COALESCE(a.title, '') AS BLOB))
          + length(CAST(COALESCE(a.summary, '') AS BLOB))
          + 4096 AS estimatedBytes
      FROM Article AS a
      INNER JOIN Folder AS f ON f.id = a.folderId
      WHERE 1 = 1
        ${activeFolderPredicate}
        ${options.includeDeleted ? '' : 'AND a.deleted = 0'}
      ORDER BY
        f.rank ASC,
        f.name COLLATE NOCASE ASC,
        f.id ASC,
        a.rank ASC,
        CASE WHEN a.orderKey IS NULL OR a.orderKey = '' THEN 1 ELSE 0 END ASC,
        a.orderKey COLLATE NOCASE ASC,
        a.title COLLATE NOCASE ASC,
        a.createTime ASC,
        a.id ASC
    `,
    args: [],
  })
  const folders = folderResult.rows.map((row) => ({
    id: requiredString(row.id),
    name: requiredString(row.name),
  }))
  const articles = articleResult.rows.map((row) => ({
    id: requiredString(row.id),
    title: requiredString(row.title),
    folderId: requiredString(row.folderId),
    estimatedBytes: Math.max(1, numericValue(row.estimatedBytes)),
  }))
  const parts: WriterExportPartPlan[] = []
  let articleOffset = 0
  let articleCount = 0
  let estimatedBytes = 0

  for (const article of articles) {
    if (
      articleCount > 0 &&
      estimatedBytes + article.estimatedBytes >
        (options.maximumEstimatedBytes ?? INITIAL_EXPORT_PART_SOURCE_BYTES)
    ) {
      parts.push({ articleOffset, articleCount, estimatedBytes })
      articleOffset += articleCount
      articleCount = 0
      estimatedBytes = 0
    }

    articleCount += 1
    estimatedBytes += article.estimatedBytes
  }

  if (articleCount > 0 || articles.length === 0) {
    parts.push({ articleOffset, articleCount, estimatedBytes })
  }

  return {
    parts,
    pathContext: createWriterExportPathContext({ folders, articles }),
    articleCount: articles.length,
    articleIds: articles.map((article) => article.id),
    folderArticleCounts: collectFolderArticleCounts(articles),
    articleNameOccurrences: collectArticleNameOccurrences(articles),
  }
}

function collectFolderArticleCounts(
  articles: Array<Pick<WriterArticleExport, 'folderId'>>,
): WriterExportFolderArticleCount[] {
  const counts: WriterExportFolderArticleCount[] = []

  for (const article of articles) {
    const current = counts[counts.length - 1]

    if (current?.folderId === article.folderId) {
      current.articleCount += 1
    } else {
      counts.push({ folderId: article.folderId, articleCount: 1 })
    }
  }

  return counts
}

function collectArticleNameOccurrences(
  articles: Array<Pick<WriterArticleExport, 'title' | 'folderId'>>,
): number[] {
  const usedNamesByFolder = new Map<string, Set<string>>()
  const nextOccurrenceByFolder = new Map<string, Map<string, number>>()

  return articles.map((article) => {
    const baseName = sanitizeExportName(article.title)
    const baseKey = portableExportNameKey(baseName)
    const usedNames = usedNamesByFolder.get(article.folderId) ?? new Set<string>()
    const nextOccurrences =
      nextOccurrenceByFolder.get(article.folderId) ?? new Map<string, number>()
    let occurrence = 1
    let candidate = baseName

    while (usedNames.has(portableExportNameKey(candidate))) {
      occurrence = nextOccurrences.get(baseKey) ?? 2
      candidate = articleExportBaseName(baseName, occurrence)
      nextOccurrences.set(baseKey, occurrence + 1)
    }

    usedNames.add(portableExportNameKey(candidate))
    usedNamesByFolder.set(article.folderId, usedNames)
    nextOccurrenceByFolder.set(article.folderId, nextOccurrences)
    return occurrence
  })
}

/** Loads one article and applies the same active/deleted policy as ZIP export. */
export async function loadWriterArticleForExport(
  event: H3Event,
  articleId: string,
  includeDeleted: boolean,
): Promise<WriterArticleExport> {
  const result = await getDatabaseClient(event).execute({
    sql: `
      SELECT
        a.id,
        a.title,
        a.content,
        a.summary,
        a.count,
        a.extension,
        a.updateTime,
        a.createTime,
        a.folderId,
        f.name AS folderName,
        a.categoryId,
        a.rank,
        a.deleted,
        a.deletedTime,
        a.orderKey
      FROM Article AS a
      INNER JOIN Folder AS f ON f.id = a.folderId
      WHERE a.id = ?
        ${includeDeleted ? '' : 'AND a.deleted = 0 AND f.deleted = 0'}
      LIMIT 1
    `,
    args: [articleId],
  })

  const row = result.rows[0]

  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Article not found.',
    })
  }

  return mapArticleRow(row)
}

export function fullExportFormat(includeDeleted: boolean): string {
  return includeDeleted
    ? FULL_TEXT_ZIP_WITH_DELETED_FORMAT
    : FULL_TEXT_ZIP_FORMAT
}

export function fullExportPartFormat(
  includeDeleted: boolean,
  partIndex: number,
  partCount: number,
): string {
  const base = fullExportFormat(includeDeleted)
  return `${base};part=${partIndex + 1}/${partCount}`
}

export function parseFullExportJobFormat(format: string): FullExportJobFormat {
  if (format === FULL_TEXT_ZIP_FORMAT) {
    return { includeDeleted: false, partIndex: 0, partCount: 1 }
  }

  if (format === FULL_TEXT_ZIP_WITH_DELETED_FORMAT) {
    return { includeDeleted: true, partIndex: 0, partCount: 1 }
  }

  const match = /^(txt-zip(?:\+deleted)?);part=(\d+)\/(\d+)$/.exec(format)
  const partNumber = Number(match?.[2])
  const partCount = Number(match?.[3])

  if (
    !match ||
    !Number.isInteger(partNumber) ||
    !Number.isInteger(partCount) ||
    partNumber < 1 ||
    partCount < 1 ||
    partNumber > partCount
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This export job format is not supported.',
    })
  }

  return {
    includeDeleted: match[1] === FULL_TEXT_ZIP_WITH_DELETED_FORMAT,
    partIndex: partNumber - 1,
    partCount,
  }
}

export function includeDeletedFromExportFormat(format: string): boolean {
  return parseFullExportJobFormat(format).includeDeleted
}

export function browserExportJobFormat(
  includeDeleted: boolean,
  plan: Pick<
    WriterExportPlan,
    | 'parts'
    | 'articleIds'
    | 'folderArticleCounts'
    | 'articleNameOccurrences'
  >,
): string {
  const pageArticleCounts = plan.parts.map((part) => part.articleCount)
  const snapshot = Buffer.from(
    JSON.stringify({
      v: 2,
      p: pageArticleCounts,
      i: plan.articleIds,
      f: plan.folderArticleCounts.map(
        ({ folderId, articleCount }) => [folderId, articleCount] as const,
      ),
      n: plan.articleNameOccurrences,
    }),
  ).toString('base64url')

  return `txt-zip-browser${includeDeleted ? '+deleted' : ''};pages=${pageArticleCounts.length};snapshot=${snapshot}`
}

export function parseBrowserExportJobFormat(
  format: string,
): BrowserExportJobFormat {
  const match =
    /^(txt-zip-browser(?:\+deleted)?);pages=(\d+)(?:;snapshot=([A-Za-z0-9_-]+))?$/.exec(
      format,
    )
  const pageCount = Number(match?.[2])

  if (!match || !Number.isInteger(pageCount) || pageCount < 1) {
    throwUnsupportedBrowserExport()
  }

  const includeDeleted = match[1] === 'txt-zip-browser+deleted'
  const encodedSnapshot = match[3]

  if (!encodedSnapshot) {
    return { includeDeleted, pageCount, snapshot: null }
  }

  let value: unknown

  try {
    value = JSON.parse(Buffer.from(encodedSnapshot, 'base64url').toString())
  } catch {
    throwUnsupportedBrowserExport()
  }

  if (!isRecord(value) || value.v !== 2) {
    throwUnsupportedBrowserExport()
  }

  const pageArticleCounts = value.p
  const articleIds = value.i
  const serializedFolderCounts = value.f
  const articleNameOccurrences = value.n

  if (
    !Array.isArray(pageArticleCounts) ||
    pageArticleCounts.length !== pageCount ||
    !pageArticleCounts.every(
      (count) => Number.isInteger(count) && Number(count) >= 0,
    ) ||
    !Array.isArray(articleIds) ||
    !articleIds.every(isExportEntityId) ||
    new Set(articleIds).size !== articleIds.length ||
    !Array.isArray(serializedFolderCounts) ||
    !Array.isArray(articleNameOccurrences) ||
    articleNameOccurrences.length !== articleIds.length ||
    !articleNameOccurrences.every(
      (occurrence) => Number.isInteger(occurrence) && Number(occurrence) >= 1,
    )
  ) {
    throwUnsupportedBrowserExport()
  }

  const totalArticleCount = pageArticleCounts.reduce<number>(
    (total, count) => total + Number(count),
    0,
  )

  if (
    totalArticleCount !== articleIds.length ||
    (pageArticleCounts.some((count) => Number(count) === 0) &&
      !(pageCount === 1 && articleIds.length === 0))
  ) {
    throwUnsupportedBrowserExport()
  }

  const folderArticleCounts: WriterExportFolderArticleCount[] = []

  for (const entry of serializedFolderCounts) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !isExportEntityId(entry[0]) ||
      !Number.isInteger(entry[1]) ||
      Number(entry[1]) < 1
    ) {
      throwUnsupportedBrowserExport()
    }

    folderArticleCounts.push({
      folderId: entry[0],
      articleCount: Number(entry[1]),
    })
  }

  if (
    new Set(folderArticleCounts.map(({ folderId }) => folderId)).size !==
      folderArticleCounts.length ||
    folderArticleCounts.reduce(
      (total, { articleCount }) => total + articleCount,
      0,
    ) !== articleIds.length
  ) {
    throwUnsupportedBrowserExport()
  }

  return {
    includeDeleted,
    pageCount,
    snapshot: {
      pageArticleCounts: pageArticleCounts.map(Number),
      articleIds,
      folderArticleCounts,
      articleNameOccurrences: articleNameOccurrences.map(Number),
    },
  }
}

function throwUnsupportedBrowserExport(): never {
  throw createError({
    statusCode: 409,
    statusMessage: 'This browser export job is not supported.',
  })
}

export function createFullExportFileName(
  now = new Date(),
  partNumber?: number,
  partCount?: number,
): string {
  const date = now.toISOString().slice(0, 10)

  if (partNumber && partCount && partCount > 1) {
    const width = String(partCount).length
    return `Writer Export - ${date} - Part ${String(partNumber).padStart(width, '0')} of ${partCount}.zip`
  }

  return `Writer Export - ${date}.zip`
}

export function createArticleExportFileName(articleTitle: string): string {
  return `${sanitizeExportName(articleTitle)}.txt`
}

export function createFolderExportFileName(folderName: string): string {
  return `${sanitizeExportName(folderName, 'Untitled Folder', 90)} - Writer Export.zip`
}

export function createAttachmentResponse(
  body: string | Uint8Array<ArrayBuffer>,
  options: { contentType: string; fileName: string },
): Response {
  return new Response(body, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': contentDisposition(options.fileName),
      'Content-Type': options.contentType,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export function sendAttachmentStream(
  event: H3Event,
  body: Uint8Array<ArrayBuffer>,
  options: { contentType: string; fileName: string },
): ReadableStream<Uint8Array<ArrayBuffer>> {
  setAttachmentResponseHeader(event, 'Cache-Control', 'private, no-store')
  setAttachmentResponseHeader(
    event,
    'Content-Disposition',
    contentDisposition(options.fileName),
  )
  setAttachmentResponseHeader(event, 'Content-Length', String(body.byteLength))
  setAttachmentResponseHeader(event, 'Content-Type', options.contentType)
  setAttachmentResponseHeader(event, 'X-Content-Type-Options', 'nosniff')

  return createByteStream(body)
}

export function createWriterExportPathContext(
  data: {
    folders: Array<Pick<WriterFolderExport, 'id' | 'name'>>
    articles: Array<Pick<WriterArticleExport, 'id' | 'title' | 'folderId'>>
  },
): WriterExportPathContext {
  const folderPaths = new Map<string, string>()
  const articlePaths = new Map<string, string>()
  const folderWidth = prefixWidth(data.folders.length)

  data.folders.forEach((folder, folderIndex) => {
    const folderName = `${numericPrefix(folderIndex, folderWidth)} - ${sanitizeExportName(folder.name, 'Untitled Folder')}`
    folderPaths.set(folder.id, `${ARCHIVE_ROOT}/${folderName}`)
  })

  const articleNameOccurrences = collectArticleNameOccurrences(data.articles)

  data.articles.forEach((article, articleIndex) => {
    const folderPath = folderPaths.get(article.folderId)

    if (!folderPath) {
      return
    }

    const articleName = createArticleFileName(
      article.title,
      articleNameOccurrences[articleIndex] ?? 1,
    )
    articlePaths.set(article.id, `${folderPath}/${articleName}`)
  })

  return { folderPaths, articlePaths }
}

/** Builds paths for one prepared browser page without reloading every title. */
export function createWriterExportPagePathContext(
  data: {
    folders: Array<Pick<WriterFolderExport, 'id' | 'name'>>
    articles: Array<Pick<WriterArticleExport, 'id' | 'title' | 'folderId'>>
  },
  options: {
    articleOffset: number
    folderArticleCounts: WriterExportFolderArticleCount[]
    articleNameOccurrences: number[]
  },
): WriterExportPathContext {
  const { folderPaths } = createWriterExportPathContext({
    folders: data.folders,
    articles: [],
  })
  const articlePaths = new Map<string, string>()
  const folderRanges = new Map<
    string,
    { articleOffset: number; articleCount: number }
  >()
  let articleOffset = 0

  for (const folder of options.folderArticleCounts) {
    folderRanges.set(folder.folderId, {
      articleOffset,
      articleCount: folder.articleCount,
    })
    articleOffset += folder.articleCount
  }

  data.articles.forEach((article, pageArticleIndex) => {
    const folderPath = folderPaths.get(article.folderId)
    const folderRange = folderRanges.get(article.folderId)

    if (!folderPath || !folderRange) return

    const globalArticleIndex = options.articleOffset + pageArticleIndex
    const folderArticleIndex = globalArticleIndex - folderRange.articleOffset

    if (
      folderArticleIndex < 0 ||
      folderArticleIndex >= folderRange.articleCount
    ) {
      return
    }

    const articleName = createArticleFileName(
      article.title,
      options.articleNameOccurrences[globalArticleIndex] ?? 1,
    )
    articlePaths.set(article.id, `${folderPath}/${articleName}`)
  })

  return { folderPaths, articlePaths }
}

function createArticleFileName(title: string, occurrence: number): string {
  const baseName = sanitizeExportName(title)
  return `${articleExportBaseName(baseName, occurrence)}.txt`
}

function articleExportBaseName(baseName: string, occurrence: number): string {
  return occurrence > 1 ? `${baseName} (${occurrence})` : baseName
}

function portableExportNameKey(value: string): string {
  return value.toLocaleLowerCase('en-US')
}

function prefixWidth(itemCount: number): number {
  return Math.max(3, String(Math.max(1, itemCount)).length)
}

function numericPrefix(index: number, width: number): string {
  return String(index + 1).padStart(width, '0')
}

function formatHeaderValue(value: unknown, fallback: string): string {
  const singleLine = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return singleLine || fallback
}

function formatWriterTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return 'Unknown'
  }

  return `${new Date(value).toISOString().slice(0, 19).replace('T', ' ')} UTC`
}

function encodeJson(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`)
}

function contentDisposition(fileName: string): string {
  const safeName = sanitizeExportName(fileName, 'download')
  const asciiFallback = safeName
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]+/g, '_')
    .replace(/["\\]/g, '_')
  const encodedName = encodeURIComponent(safeName).replace(
    /['()*]/g,
    (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`,
  )

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`
}

function createByteStream(
  body: Uint8Array<ArrayBuffer>,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  const chunkSize = 64 * 1024
  let offset = 0

  return new ReadableStream({
    pull(controller) {
      if (offset >= body.byteLength) {
        controller.close()
        return
      }

      const nextOffset = Math.min(offset + chunkSize, body.byteLength)
      controller.enqueue(body.subarray(offset, nextOffset))
      offset = nextOffset
    },
  })
}

function setAttachmentResponseHeader(
  event: H3Event,
  name: string,
  value: string,
): void {
  const compatibleEvent = event as unknown as AttachmentResponseEvent

  if (compatibleEvent.node?.res?.setHeader) {
    compatibleEvent.node.res.setHeader(name, value)
    return
  }

  compatibleEvent.res?.headers?.set(name, value)
}

interface AttachmentResponseEvent {
  node?: {
    res?: {
      setHeader(name: string, value: string): void
    }
  }
  res?: {
    headers?: Headers
  }
}

function mapFolderRow(row: Record<string, unknown>): WriterFolderExport {
  return {
    id: requiredString(row.id),
    name: requiredString(row.name),
    createdTime: numericValue(row.createdTime),
    description: nullableString(row.description),
    rank: numericValue(row.rank),
    deleted: booleanValue(row.deleted),
    deletedTime: numericValue(row.deletedTime),
    updateTime: numericValue(row.updateTime),
  }
}

function mapArticleRow(row: Record<string, unknown>): WriterArticleExport {
  return {
    id: requiredString(row.id),
    title: requiredString(row.title),
    content: requiredString(row.content),
    summary: nullableString(row.summary),
    count: nullableNumber(row.count),
    extension: requiredString(row.extension),
    updateTime: numericValue(row.updateTime),
    createTime: numericValue(row.createTime),
    folderId: requiredString(row.folderId),
    folderName: requiredString(row.folderName),
    categoryId: nullableString(row.categoryId),
    rank: numericValue(row.rank),
    deleted: booleanValue(row.deleted),
    deletedTime: numericValue(row.deletedTime),
    orderKey: nullableString(row.orderKey),
  }
}

function mapCategoryRow(row: Record<string, unknown>): WriterCategoryExport {
  return {
    id: requiredString(row.id),
    folderId: requiredString(row.folderId),
    name: requiredString(row.name),
    createdTime: numericValue(row.createdTime),
    rank: numericValue(row.rank),
    description: nullableString(row.description),
    updateTime: numericValue(row.updateTime),
    deleted: booleanValue(row.deleted),
    deletedTime: numericValue(row.deletedTime),
    orderKey: nullableString(row.orderKey),
  }
}

function requiredString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function numericValue(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }

  return numericValue(value)
}

function booleanValue(value: unknown): boolean {
  return numericValue(value) !== 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isExportEntityId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function truncateCodePoints(value: string, maxLength: number): string {
  return Array.from(value).slice(0, Math.max(1, maxLength)).join('')
}
