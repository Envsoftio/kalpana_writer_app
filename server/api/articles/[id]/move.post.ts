import { z } from 'zod'
import {
  requireArticleById,
  validateArticleDestination,
} from '../../../utils/articles'

const paramsSchema = z.object({ id: entityIdSchema })
const moveArticleSchema = z.object({
  folderId: entityIdSchema,
  categoryId: entityIdSchema.nullable().optional().default(null),
})

export default defineProtectedEventHandler(async (event) => {
  const { id } = validateRouteParams(event, paramsSchema)
  const body = await validateBody(event, moveArticleSchema)
  const current = await requireArticleById(event, id)
  if (
    current.folderId === body.folderId &&
    current.categoryId === body.categoryId
  ) {
    return { article: current }
  }

  const now = Date.now()

  await withDatabaseWriteTransaction(event, async (transaction) => {
    await validateArticleDestination(transaction, body)
    await transaction.execute({
      sql: `
        UPDATE Article
        SET
          folderId = ?,
          categoryId = ?,
          folderIdUpdateTime = ?,
          categoryIdUpdateTime = ?,
          structureUpdateTime = ?,
          updateTime = ?
        WHERE id = ?
      `,
      args: [body.folderId, body.categoryId, now, now, now, now, id],
    })

    await writeAuditLog(event, {
      action: 'article.move',
      entityType: 'article',
      entityId: id,
      metadata: {
        fromFolderId: current.folderId,
        toFolderId: body.folderId,
        fromCategoryId: current.categoryId,
        toCategoryId: body.categoryId,
      },
    }, transaction)
  })

  return { article: await requireArticleById(event, id) }
})
