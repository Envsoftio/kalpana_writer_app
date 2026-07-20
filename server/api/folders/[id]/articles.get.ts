import { z } from 'zod'

const paramsSchema = z.object({ id: entityIdSchema })
const querySchema = paginationQuerySchema.extend({
  status: z.enum(['active', 'deleted', 'all']).default('active'),
  sort: z
    .enum(['rank', 'updated', 'created', 'title', 'count'])
    .default('rank'),
  direction: z.enum(['asc', 'desc']).optional(),
  categoryId: z.union([entityIdSchema, z.literal('uncategorized')]).optional(),
  q: z.string().trim().max(200).optional(),
})

const sortColumns = {
  rank: 'a.rank',
  updated: 'a.updateTime',
  created: 'a.createTime',
  title: 'a.title COLLATE NOCASE',
  count: 'a.count',
} as const

export default defineProtectedEventHandler(async (event) => {
  const { id } = validateRouteParams(event, paramsSchema)
  const query = validateQuery(event, querySchema)
  const client = getDatabaseClient(event)
  const folderResult = await client.execute({
    sql: 'SELECT id FROM Folder WHERE id = ? LIMIT 1',
    args: [id],
  })

  if (!folderResult.rows[0]) {
    throw createError({ statusCode: 404, statusMessage: 'Folder not found.' })
  }

  const conditions = ['a.folderId = ?']
  const args: Array<string | number | null> = [id]

  if (query.status !== 'all') {
    conditions.push('a.deleted = ?')
    args.push(query.status === 'deleted' ? 1 : 0)
  }

  if (query.categoryId === 'uncategorized') {
    conditions.push('a.categoryId IS NULL')
  } else if (query.categoryId) {
    conditions.push('a.categoryId = ?')
    args.push(query.categoryId)
  }

  if (query.q) {
    conditions.push('INSTR(LOWER(a.title), LOWER(?)) > 0')
    args.push(query.q)
  }

  const whereSql = conditions.join(' AND ')
  const totalResult = await client.execute({
    sql: `SELECT COUNT(*) AS total FROM Article a WHERE ${whereSql}`,
    args,
  })
  const total = Number(totalResult.rows[0]?.total ?? 0)
  const defaultDirection =
    query.sort === 'rank' || query.sort === 'title' ? 'asc' : 'desc'
  const direction = (query.direction ?? defaultDirection).toUpperCase()
  const primarySort = sortColumns[query.sort]
  const rankOrderKey =
    query.sort === 'rank'
      ? `, CASE WHEN a.orderKey IS NULL THEN 1 ELSE 0 END ASC, a.orderKey ${direction}`
      : ''
  const offset = (query.page - 1) * query.pageSize
  const result = await client.execute({
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
    args: [...args, query.pageSize, offset],
  })

  return {
    items: result.rows.map((row) => ({
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
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  }
})
