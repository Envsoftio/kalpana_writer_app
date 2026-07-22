import type { InStatement, InValue, ResultSet } from '@libsql/client'
import type { ArticleSummary, Pagination } from '#shared/types/writer'

export type ArticleListStatus = 'active' | 'deleted' | 'all'
export type ArticleListSort = 'rank' | 'updated' | 'created' | 'title' | 'count'

export interface ArticleListOptions {
  page: number
  pageSize: number
  status: ArticleListStatus
  sort: ArticleListSort
  direction?: 'asc' | 'desc'
  categoryId?: string
  q?: string
}

export interface ArticleFolderTarget {
  sql: string
  args: InValue[]
}

export interface ArticleListStatements {
  count: InStatement
  items: InStatement
}

export interface ArticleListResponse {
  items: ArticleSummary[]
  pagination: Pagination
}

const sortColumns = {
  rank: 'a.rank',
  updated: 'a.updateTime',
  created: 'a.createTime',
  title: 'a.title COLLATE NOCASE',
  count: 'a.count',
} as const

/** Builds the count and bounded-row queries so callers can send them in one batch. */
export function createArticleListStatements(
  folder: ArticleFolderTarget,
  options: ArticleListOptions,
): ArticleListStatements {
  const conditions = [`a.folderId = ${folder.sql}`]
  const args: InValue[] = [...folder.args]

  if (options.status !== 'all') {
    conditions.push('a.deleted = ?')
    args.push(options.status === 'deleted' ? 1 : 0)
  }

  if (options.categoryId === 'uncategorized') {
    conditions.push('a.categoryId IS NULL')
  } else if (options.categoryId) {
    conditions.push('a.categoryId = ?')
    args.push(options.categoryId)
  }

  if (options.q) {
    conditions.push('INSTR(LOWER(a.title), LOWER(?)) > 0')
    args.push(options.q)
  }

  const whereSql = conditions.join(' AND ')
  const defaultDirection =
    options.sort === 'rank' || options.sort === 'title' ? 'asc' : 'desc'
  const direction = (options.direction ?? defaultDirection).toUpperCase()
  const primarySort = sortColumns[options.sort]
  const rankOrderKey =
    options.sort === 'rank'
      ? `, CASE WHEN a.orderKey IS NULL THEN 1 ELSE 0 END ASC, a.orderKey ${direction}`
      : ''
  const offset = (options.page - 1) * options.pageSize

  return {
    count: {
      sql: `SELECT COUNT(*) AS total FROM Article a WHERE ${whereSql}`,
      args,
    },
    items: {
      sql: `
        SELECT
          a.id,
          a.title,
          COALESCE(NULLIF(a.summary, ''),
            SUBSTR(REPLACE(REPLACE(a.content, char(10), ' '), char(13), ' '), 1, 220)
          ) AS excerpt,
          a.count,
          a.updateTime,
          a.createTime,
          a.folderId,
          a.categoryId,
          c.name AS categoryName,
          a.rank,
          a.orderKey,
          a.deleted,
          a.deletedTime
        FROM Article a
        LEFT JOIN Category c ON c.id = a.categoryId
        WHERE ${whereSql}
        ORDER BY ${primarySort} ${direction}${rankOrderKey}, a.id ASC
        LIMIT ? OFFSET ?
      `,
      args: [...args, options.pageSize, offset],
    },
  }
}

export function createArticleListResponse(
  totalResult: ResultSet,
  itemsResult: ResultSet,
  options: Pick<ArticleListOptions, 'page' | 'pageSize'>,
): ArticleListResponse {
  const total = Number(totalResult.rows[0]?.total ?? 0)

  return {
    items: itemsResult.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      summary: row.excerpt === null ? null : String(row.excerpt),
      excerpt: row.excerpt === null ? null : String(row.excerpt),
      count: Number(row.count ?? 0),
      updateTime: Number(row.updateTime),
      createTime: Number(row.createTime),
      folderId: String(row.folderId),
      categoryId: row.categoryId === null ? null : String(row.categoryId),
      categoryName: row.categoryName === null ? null : String(row.categoryName),
      rank: Number(row.rank),
      orderKey: row.orderKey === null ? null : String(row.orderKey),
      deleted: Number(row.deleted) !== 0,
      deletedTime: Number(row.deletedTime),
    })),
    pagination: {
      page: options.page,
      pageSize: options.pageSize,
      total,
      totalPages: Math.ceil(total / options.pageSize),
    },
  }
}
