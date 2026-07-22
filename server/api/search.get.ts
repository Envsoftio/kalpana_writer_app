import { z } from 'zod'

const booleanQuerySchema = z.preprocess((value) => {
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  return value
}, z.boolean())

const searchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(200),
  includeDeleted: booleanQuerySchema.default(false),
})

export default defineProtectedEventHandler(async (event) => {
  const query = validateQuery(event, searchQuerySchema)
  const client = getDatabaseClient(event)
  const conditions = [
    `(
      INSTR(LOWER(COALESCE(a.title, '')), LOWER(?)) > 0
      OR INSTR(LOWER(COALESCE(a.content, '')), LOWER(?)) > 0
    )`,
  ]
  const filterArgs: Array<string | number> = [query.q, query.q]

  if (!query.includeDeleted) {
    conditions.push('a.deleted = 0')
  }

  const whereSql = conditions.join(' AND ')
  const offset = (query.page - 1) * query.pageSize
  const results = await client.batch([
    {
      sql: `SELECT COUNT(*) AS total FROM Article a WHERE ${whereSql}`,
      args: filterArgs,
    },
    {
      sql: `
        SELECT
          a.id,
          a.title,
          a.folderId,
          f.name AS folderName,
          a.categoryId,
          c.name AS categoryName,
          CASE
            WHEN INSTR(LOWER(COALESCE(a.title, '')), LOWER(?)) > 0 THEN 1
            ELSE 0
          END AS titleMatched,
          CASE
            WHEN INSTR(LOWER(COALESCE(a.content, '')), LOWER(?)) > 0 THEN 1
            ELSE 0
          END AS contentMatched,
          CASE
            WHEN INSTR(LOWER(COALESCE(a.content, '')), LOWER(?)) > 0 THEN
              TRIM(REPLACE(REPLACE(
                SUBSTR(
                  a.content,
                  MAX(
                    INSTR(LOWER(COALESCE(a.content, '')), LOWER(?)) - 80,
                    1
                  ),
                  240
                ),
                char(10), ' '
              ), char(13), ' '))
            ELSE COALESCE(
              NULLIF(a.summary, ''),
              SUBSTR(REPLACE(REPLACE(a.content, char(10), ' '), char(13), ' '), 1, 240)
            )
          END AS excerpt,
          a.count,
          a.updateTime,
          a.createTime,
          a.deleted,
          a.deletedTime
        FROM Article a
        LEFT JOIN Folder f ON f.id = a.folderId
        LEFT JOIN Category c ON c.id = a.categoryId
        WHERE ${whereSql}
        ORDER BY a.updateTime DESC, a.id ASC
        LIMIT ? OFFSET ?
      `,
      args: [
        query.q,
        query.q,
        query.q,
        query.q,
        ...filterArgs,
        query.pageSize,
        offset,
      ],
    },
  ])
  const totalResult = results[0]!
  const result = results[1]!
  const total = Number(totalResult.rows[0]?.total ?? 0)

  return {
    items: result.rows.map((row) => {
      const titleMatched = Number(row.titleMatched) !== 0
      const contentMatched = Number(row.contentMatched) !== 0

      return {
        id: String(row.id),
        title: String(row.title),
        folderId: String(row.folderId),
        folderName: row.folderName === null ? null : String(row.folderName),
        categoryId: row.categoryId === null ? null : String(row.categoryId),
        categoryName:
          row.categoryName === null ? null : String(row.categoryName),
        excerpt: row.excerpt === null ? null : String(row.excerpt),
        matchSource:
          titleMatched && contentMatched
            ? 'title-and-content'
            : contentMatched
              ? 'content'
              : 'title',
        count: Number(row.count ?? 0),
        updateTime: Number(row.updateTime),
        createTime: Number(row.createTime),
        deleted: Number(row.deleted) !== 0,
        deletedTime: Number(row.deletedTime),
      }
    }),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  }
})
