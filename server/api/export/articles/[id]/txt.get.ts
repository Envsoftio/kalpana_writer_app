import { z } from 'zod'

const routeParamsSchema = z.object({ id: entityIdSchema })
const querySchema = z.object({
  includeDeleted: z.enum(['true', 'false', '1', '0']).default('false'),
})

export default defineProtectedEventHandler(async (event) => {
  const { id } = validateRouteParams(event, routeParamsSchema)
  const query = validateQuery(event, querySchema)
  const includeDeleted =
    query.includeDeleted === 'true' || query.includeDeleted === '1'
  const article = await loadWriterArticleForExport(
    event,
    id,
    includeDeleted,
  )
  const fileName = createArticleExportFileName(article.title)

  await writeAuditLog(event, {
    action: 'export.article_txt',
    entityType: 'Article',
    entityId: article.id,
    metadata: {
      format: 'txt',
      includeDeleted,
      fileName,
      folderId: article.folderId,
      deleted: article.deleted,
    },
  })

  return createAttachmentResponse(formatArticleText(article), {
    contentType: 'text/plain; charset=utf-8',
    fileName,
  })
})
