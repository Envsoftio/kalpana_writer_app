import { strToU8, zipSync, type Zippable } from 'fflate'
import type { H3Event } from 'h3'

const ARCHIVE_ROOT = 'Writer Export'
const EXPORT_VERSION = 1
const MAX_EXPORT_NAME_LENGTH = 120
const ARTICLE_PAGE_SIZE = 200
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

export interface BuiltWriterZip {
  bytes: Uint8Array<ArrayBuffer>
  metadata: WriterExportMetadata
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
  options: { includeDeleted: boolean; exportedAt?: Date } = {
    includeDeleted: false,
  },
): WriterExportMetadata {
  const exportedAt = (options.exportedAt ?? new Date()).toISOString()
  const paths = buildExportPaths(data)

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
  options: { includeDeleted: boolean; exportedAt?: Date } = {
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

/** Loads a complete, consistently ordered export without one huge DB response. */
export async function loadWriterExportData(
  event: H3Event,
  options: { includeDeleted: boolean; folderId?: string },
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
  let offset = 0

  while (true) {
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
      args: [...folderArgs, ARTICLE_PAGE_SIZE, offset],
    })

    articles.push(...articleResult.rows.map(mapArticleRow))

    if (articleResult.rows.length < ARTICLE_PAGE_SIZE) {
      break
    }

    offset += ARTICLE_PAGE_SIZE
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

export function includeDeletedFromExportFormat(format: string): boolean {
  if (format === FULL_TEXT_ZIP_FORMAT) {
    return false
  }

  if (format === FULL_TEXT_ZIP_WITH_DELETED_FORMAT) {
    return true
  }

  throw createError({
    statusCode: 409,
    statusMessage: 'This export job format is not supported.',
  })
}

export function createFullExportFileName(now = new Date()): string {
  return `Writer Export - ${now.toISOString().slice(0, 10)}.zip`
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

function buildExportPaths(data: WriterExportData) {
  const folderPaths = new Map<string, string>()
  const articlePaths = new Map<string, string>()
  const folderWidth = prefixWidth(data.folders.length)
  const articleCounts = new Map<string, number>()

  data.articles.forEach((article) => {
    articleCounts.set(
      article.folderId,
      (articleCounts.get(article.folderId) ?? 0) + 1,
    )
  })

  data.folders.forEach((folder, folderIndex) => {
    const folderName = `${numericPrefix(folderIndex, folderWidth)} - ${sanitizeExportName(folder.name, 'Untitled Folder')}`
    folderPaths.set(folder.id, `${ARCHIVE_ROOT}/${folderName}`)
  })

  const articleIndexes = new Map<string, number>()

  data.articles.forEach((article) => {
    const folderPath = folderPaths.get(article.folderId)

    if (!folderPath) {
      return
    }

    const articleIndex = articleIndexes.get(article.folderId) ?? 0
    const articleWidth = prefixWidth(articleCounts.get(article.folderId) ?? 0)
    const articleName = `${numericPrefix(articleIndex, articleWidth)} - ${sanitizeExportName(article.title)}.txt`
    articleIndexes.set(article.folderId, articleIndex + 1)
    articlePaths.set(article.id, `${folderPath}/${articleName}`)
  })

  return { folderPaths, articlePaths }
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

function truncateCodePoints(value: string, maxLength: number): string {
  return Array.from(value).slice(0, Math.max(1, maxLength)).join('')
}
