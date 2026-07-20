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
  const likePattern = `%${escapeLike(query.q)}%`
  const conditions = [
    `(a.title LIKE ? ESCAPE '\\' OR a.content LIKE ? ESCAPE '\\')`,
  ]
  const filterArgs: Array<string | number> = [likePattern, likePattern]

  if (!query.includeDeleted) {
    conditions.push('a.deleted = 0')
  }

  const whereSql = conditions.join(' AND ')
  const totalResult = await client.execute({
    sql: `SELECT COUNT(*) AS total FROM Article a WHERE ${whereSql}`,
    args: filterArgs,
  })
  const total = Number(totalResult.rows[0]?.total ?? 0)
  const offset = (query.page - 1) * query.pageSize
  const result = await client.execute({
    sql: `
      SELECT
        a.id,
        a.title,
        a.folderId,
        f.name AS folderName,
        a.categoryId,
        c.name AS categoryName,
        CASE
          WHEN INSTR(LOWER(a.content), LOWER(?)) > 0 THEN
            TRIM(REPLACE(REPLACE(
              SUBSTR(
                a.content,
                MAX(INSTR(LOWER(a.content), LOWER(?)) - 80, 1),
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
    args: [query.q, query.q, ...filterArgs, query.pageSize, offset],
  })

  return {
    items: result.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      folderId: String(row.folderId),
      folderName: row.folderName === null ? null : String(row.folderName),
      categoryId: row.categoryId === null ? null : String(row.categoryId),
      categoryName: row.categoryName === null ? null : String(row.categoryName),
      excerpt: row.excerpt === null ? null : String(row.excerpt),
      count: Number(row.count ?? 0),
      updateTime: Number(row.updateTime),
      createTime: Number(row.createTime),
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

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, '\\$&')
}
