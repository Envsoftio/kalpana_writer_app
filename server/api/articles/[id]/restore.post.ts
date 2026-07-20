import { z } from 'zod'
import {
  requireArticleById,
  validateArticleDestination,
} from '../../../utils/articles'

const paramsSchema = z.object({ id: entityIdSchema })

export default defineProtectedEventHandler(async (event) => {
  const { id } = validateRouteParams(event, paramsSchema)
  const current = await requireArticleById(event, id)

  if (!current.deleted) {
    return { article: current }
  }

  const now = Date.now()

  await withDatabaseWriteTransaction(event, async (transaction) => {
    await validateArticleDestination(transaction, {
      folderId: current.folderId,
      categoryId: current.categoryId,
    })
    await transaction.execute({
      sql: `
        UPDATE Article
        SET deleted = 0, deletedTime = 0, updateTime = ?
        WHERE id = ?
      `,
      args: [now, id],
    })

    await writeAuditLog(event, {
      action: 'article.restore',
      entityType: 'article',
      entityId: id,
      metadata: { folderId: current.folderId },
    }, transaction)
  })

  return { article: await requireArticleById(event, id) }
})
