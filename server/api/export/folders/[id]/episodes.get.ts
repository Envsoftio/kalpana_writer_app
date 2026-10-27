import { z } from 'zod'

const paramsSchema = z.object({ id: entityIdSchema })
const querySchema = z.object({
  includeDeleted: z.enum(['true', 'false', '1', '0']).default('false'),
})

/** Lists the whole story, independently of the Library's current page/filter. */
export default defineProtectedEventHandler(async (event) => {
  const { id } = validateRouteParams(event, paramsSchema)
  const { includeDeleted: requestedDeleted } = validateQuery(event, querySchema)
  const includeDeleted = requestedDeleted === 'true' || requestedDeleted === '1'
  const client = getDatabaseClient(event)
  const folderResult = await client.execute({
    sql: `SELECT id, name, deleted FROM Folder WHERE id = ?
      ${includeDeleted ? '' : 'AND deleted = 0'} LIMIT 1`,
    args: [id],
  })
  const folder = folderResult.rows[0]

  if (!folder) {
    throw createError({ statusCode: 404, statusMessage: 'Folder not found.' })
  }

  setCompatibleResponseHeader(event, 'Cache-Control', 'private, no-store')

  const result = await client.execute({
    sql: `
      SELECT id, title, deleted, LENGTH(content) AS contentLength
      FROM Article
      WHERE folderId = ? ${includeDeleted ? '' : 'AND deleted = 0'}
      ORDER BY rank ASC,
        CASE WHEN orderKey IS NULL OR orderKey = '' THEN 1 ELSE 0 END ASC,
        orderKey COLLATE NOCASE ASC,
        title COLLATE NOCASE ASC,
        createTime ASC,
        id ASC
    `,
    args: [id],
  })

  return {
    folder: { id: String(folder.id), name: String(folder.name) },
    episodes: result.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      deleted: Number(row.deleted) !== 0,
      contentLength: Number(row.contentLength ?? 0),
    })),
  }
})
