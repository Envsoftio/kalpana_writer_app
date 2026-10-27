import { z } from 'zod'

const paramsSchema = z.object({ id: entityIdSchema })
const bodySchema = z
  .object({
    includeDeleted: z.boolean().default(false),
    articleIds: z.array(entityIdSchema).min(1).max(50),
  })
  .strict()

/** Returns a bounded batch of episode bodies for browser-side DOCX creation. */
export default defineProtectedEventHandler(async (event) => {
  const { id } = validateRouteParams(event, paramsSchema)
  const { includeDeleted, articleIds } = await validateBody(event, bodySchema)

  if (new Set(articleIds).size !== articleIds.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Duplicate episode IDs.',
    })
  }

  const sizeResult = await getDatabaseClient(event).execute({
    sql: `
      SELECT COUNT(*) AS articleCount, COALESCE(SUM(LENGTH(a.content)), 0) AS contentLength
      FROM Article a INNER JOIN Folder f ON f.id = a.folderId
      WHERE f.id = ? AND a.id IN (${articleIds.map(() => '?').join(', ')})
        ${includeDeleted ? '' : 'AND a.deleted = 0 AND f.deleted = 0'}
    `,
    args: [id, ...articleIds],
  })
  const size = sizeResult.rows[0]

  if (Number(size?.articleCount) !== articleIds.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The story changed. Reopen Word export and try again.',
    })
  }

  if (Number(size?.contentLength) > 1_000_000) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Too many episode characters in one batch.',
    })
  }

  const data = await loadWriterExportData(event, {
    folderId: id,
    includeDeleted,
    articleIds,
  })

  if (data.articles.length !== articleIds.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The story changed. Reopen Word export and try again.',
    })
  }

  await writeAuditLog(event, {
    action: 'export.folder_docx_batch',
    entityType: 'Folder',
    entityId: id,
    metadata: {
      format: 'docx',
      episodeCount: articleIds.length,
      includeDeleted,
    },
  })

  setCompatibleResponseHeader(event, 'Cache-Control', 'private, no-store')
  return { articles: data.articles }
})
