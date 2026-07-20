import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  calculateArticleCount,
  createArticleSummary,
  getNextArticleRank,
  MAX_ARTICLE_CONTENT_LENGTH,
  requireArticleById,
  validateArticleDestination,
} from '../../utils/articles'

const createArticleSchema = z.object({
  title: z.string().max(2_000).default('Untitled'),
  content: z.string().max(MAX_ARTICLE_CONTENT_LENGTH).default(''),
  folderId: entityIdSchema,
  categoryId: entityIdSchema.nullable().optional().default(null),
  extension: z.string().trim().min(1).max(32).default('txt'),
  rank: z.number().int().safe().optional(),
  orderKey: z.string().max(512).nullable().optional().default(null),
})

export default defineProtectedEventHandler(async (event) => {
  const body = await validateBody(event, createArticleSchema)
  const id = randomUUID()
  const now = Date.now()
  const article = await withDatabaseWriteTransaction(event, async (transaction) => {
    await validateArticleDestination(transaction, {
      folderId: body.folderId,
      categoryId: body.categoryId,
    })
    const rank = body.rank ?? (await getNextArticleRank(transaction, body.folderId))

    await transaction.execute({
      sql: `
        INSERT INTO Article (
          id, title, content, summary, count, extension, preview, preview1,
          updateTime, createTime, folderId, categoryId, editorId, rank,
          titleUpdateTime, rankUpdateTime, folderIdUpdateTime,
          categoryIdUpdateTime, extensionUpdateTime, deleted, deletedTime,
          autoChapter, autoChapterUpdateTime, orderKey, structureUpdateTime
        )
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
      `,
      args: [
        id,
        body.title,
        body.content,
        createArticleSummary(body.content),
        calculateArticleCount(body.content),
        body.extension,
        now,
        now,
        body.folderId,
        body.categoryId,
        rank,
        now,
        now,
        now,
        now,
        now,
        body.orderKey,
        now,
      ],
    })

    await writeAuditLog(event, {
      action: 'article.create',
      entityType: 'article',
      entityId: id,
      metadata: {
        folderId: body.folderId,
        categoryId: body.categoryId,
        count: calculateArticleCount(body.content),
      },
    }, transaction)

    return requireArticleById(event, id, transaction)
  })

  setResponseStatus(event, 201)

  return { article }
})
