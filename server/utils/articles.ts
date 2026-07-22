import type { InStatement, ResultSet } from '@libsql/client'
import type { H3Event } from 'h3'

const ARTICLE_SUMMARY_LENGTH = 220
export const MAX_ARTICLE_CONTENT_LENGTH = 1_000_000

export interface ArticleDestination {
  folderId: string
  categoryId: string | null
}

export interface ServerArticleRecord {
  id: string
  title: string
  content: string
  summary: string | null
  count: number
  extension: string
  preview: number
  preview1: number
  updateTime: number
  createTime: number
  folderId: string
  folder: {
    id: string
    name: string
    deleted: boolean
  } | null
  categoryId: string | null
  category: {
    id: string
    name: string
    deleted: boolean
  } | null
  editorId: number
  rank: number
  titleUpdateTime: number
  rankUpdateTime: number
  folderIdUpdateTime: number
  categoryIdUpdateTime: number
  extensionUpdateTime: number
  deleted: boolean
  deletedTime: number
  autoChapter: number
  autoChapterUpdateTime: number
  orderKey: string | null
  structureUpdateTime: number
}

const ARTICLE_DETAIL_SQL = `
  SELECT
    a.*,
    f.name AS _folderName,
    f.deleted AS _folderDeleted,
    c.name AS _categoryName,
    c.deleted AS _categoryDeleted
  FROM Article a
  LEFT JOIN Folder f ON f.id = a.folderId
  LEFT JOIN Category c ON c.id = a.categoryId
  WHERE a.id = ?
  LIMIT 1
`

export function createArticleDetailStatement(id: string): InStatement {
  return { sql: ARTICLE_DETAIL_SQL, args: [id] }
}

export function articleFromResult(
  result: ResultSet,
): ServerArticleRecord | null {
  const row = result.rows[0]

  return row ? mapArticleRow(row) : null
}

export async function getArticleById(
  event: H3Event,
  id: string,
  database: DatabaseExecutor = getDatabaseClient(event),
): Promise<ServerArticleRecord | null> {
  const result = await database.execute(createArticleDetailStatement(id))

  return articleFromResult(result)
}

export async function requireArticleById(
  event: H3Event,
  id: string,
  database: DatabaseExecutor = getDatabaseClient(event),
): Promise<ServerArticleRecord> {
  const article = await getArticleById(event, id, database)

  if (!article) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Article not found.',
    })
  }

  return article
}

/** Ensures a write never leaves an article pointing at an invalid parent. */
export async function validateArticleDestination(
  client: DatabaseExecutor,
  destination: ArticleDestination,
): Promise<void> {
  const folderResult = await client.execute({
    sql: 'SELECT id, deleted FROM Folder WHERE id = ? LIMIT 1',
    args: [destination.folderId],
  })
  const folder = folderResult.rows[0]

  if (!folder) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The selected folder does not exist.',
    })
  }

  if (toBoolean(folder.deleted)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Articles cannot be saved in a deleted folder.',
    })
  }

  if (!destination.categoryId) {
    return
  }

  const categoryResult = await client.execute({
    sql: `
      SELECT id, folderId, deleted
      FROM Category
      WHERE id = ?
      LIMIT 1
    `,
    args: [destination.categoryId],
  })
  const category = categoryResult.rows[0]

  if (!category) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The selected category does not exist.',
    })
  }

  if (String(category.folderId) !== destination.folderId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The selected category does not belong to the folder.',
    })
  }

  if (toBoolean(category.deleted)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Articles cannot be saved in a deleted category.',
    })
  }
}

export async function getNextArticleRank(
  client: DatabaseExecutor,
  folderId: string,
): Promise<number> {
  const result = await client.execute({
    sql: `
      SELECT COALESCE(MAX(rank), 0) + 1 AS nextRank
      FROM Article
      WHERE folderId = ?
    `,
    args: [folderId],
  })

  return toNumber(result.rows[0]?.nextRank)
}

/** Pure Writer stores a simple count; web saves use whitespace-delimited words. */
export function calculateArticleCount(content: string): number {
  const normalized = content.trim()

  return normalized ? normalized.split(/\s+/u).length : 0
}

export function createArticleSummary(content: string): string | null {
  const normalized = content.replace(/\s+/gu, ' ').trim()

  if (!normalized) {
    return null
  }

  return normalized.length > ARTICLE_SUMMARY_LENGTH
    ? `${normalized.slice(0, ARTICLE_SUMMARY_LENGTH).trimEnd()}…`
    : normalized
}

function mapArticleRow(row: Record<string, unknown>): ServerArticleRecord {
  const folderName = nullableString(row._folderName)
  const categoryName = nullableString(row._categoryName)
  const folderId = String(row.folderId)
  const categoryId = nullableString(row.categoryId)

  return {
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    summary: nullableString(row.summary),
    count: toNumber(row.count),
    extension: String(row.extension),
    preview: toNumber(row.preview),
    preview1: toNumber(row.preview1),
    updateTime: toNumber(row.updateTime),
    createTime: toNumber(row.createTime),
    folderId,
    folder: folderName
      ? {
          id: folderId,
          name: folderName,
          deleted: toBoolean(row._folderDeleted),
        }
      : null,
    categoryId,
    category:
      categoryId && categoryName
        ? {
            id: categoryId,
            name: categoryName,
            deleted: toBoolean(row._categoryDeleted),
          }
        : null,
    editorId: toNumber(row.editorId),
    rank: toNumber(row.rank),
    titleUpdateTime: toNumber(row.titleUpdateTime),
    rankUpdateTime: toNumber(row.rankUpdateTime),
    folderIdUpdateTime: toNumber(row.folderIdUpdateTime),
    categoryIdUpdateTime: toNumber(row.categoryIdUpdateTime),
    extensionUpdateTime: toNumber(row.extensionUpdateTime),
    deleted: toBoolean(row.deleted),
    deletedTime: toNumber(row.deletedTime),
    autoChapter: toNumber(row.autoChapter),
    autoChapterUpdateTime: toNumber(row.autoChapterUpdateTime),
    orderKey: nullableString(row.orderKey),
    structureUpdateTime: toNumber(row.structureUpdateTime),
  }
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function toNumber(value: unknown): number {
  if (typeof value === 'bigint') {
    return Number(value)
  }

  const number = Number(value ?? 0)

  return Number.isFinite(number) ? number : 0
}

function toBoolean(value: unknown): boolean {
  return toNumber(value) !== 0
}
