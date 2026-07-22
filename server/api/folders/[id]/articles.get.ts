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

export default defineProtectedEventHandler(async (event) => {
  const { id } = validateRouteParams(event, paramsSchema)
  const query = validateQuery(event, querySchema)
  const client = getDatabaseClient(event)
  const statements = createArticleListStatements(
    { sql: '?', args: [id] },
    query,
  )
  const results = await client.batch([
    {
      sql: 'SELECT id FROM Folder WHERE id = ? LIMIT 1',
      args: [id],
    },
    statements.count,
    statements.items,
  ])
  const folderResult = results[0]!
  const totalResult = results[1]!
  const itemsResult = results[2]!

  if (!folderResult.rows[0]) {
    throw createError({ statusCode: 404, statusMessage: 'Folder not found.' })
  }

  return createArticleListResponse(totalResult, itemsResult, query)
})
