import { z } from 'zod'
import { requireArticleById } from '../../../utils/articles'

const paramsSchema = z.object({ id: entityIdSchema })

export default defineProtectedEventHandler(async (event) => {
  const { id } = validateRouteParams(event, paramsSchema)
  const current = await requireArticleById(event, id)

  if (current.deleted) {
    return { article: current }
  }

  const now = Date.now()

  await withDatabaseWriteTransaction(event, async (transaction) => {
    await transaction.execute({
      sql: `
        UPDATE Article
        SET deleted = 1, deletedTime = ?, updateTime = ?
        WHERE id = ?
      `,
      args: [now, now, id],
    })

    await writeAuditLog(event, {
      action: 'article.delete',
      entityType: 'article',
      entityId: id,
      metadata: { folderId: current.folderId },
    }, transaction)
  })

  return { article: await requireArticleById(event, id) }
})
