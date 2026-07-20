import { z } from 'zod'
import {
  calculateArticleCount,
  createArticleSummary,
  MAX_ARTICLE_CONTENT_LENGTH,
  requireArticleById,
  validateArticleDestination,
} from '../../utils/articles'

const paramsSchema = z.object({ id: entityIdSchema })
const updateArticleSchema = z
  .object({
    title: z.string().max(2_000).optional(),
    content: z.string().max(MAX_ARTICLE_CONTENT_LENGTH).optional(),
    folderId: entityIdSchema.optional(),
    categoryId: entityIdSchema.nullable().optional(),
    extension: z.string().trim().min(1).max(32).optional(),
    rank: z.number().int().safe().optional(),
    orderKey: z.string().max(512).nullable().optional(),
    autoChapter: z.number().int().min(0).max(1).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one article field is required.',
  })

export default defineProtectedEventHandler(async (event) => {
  const { id } = validateRouteParams(event, paramsSchema)
  const body = await validateBody(event, updateArticleSchema)
  const current = await requireArticleById(event, id)
  const folderChanged =
    hasOwn(body, 'folderId') && body.folderId !== current.folderId
  const categoryWasProvided = hasOwn(body, 'categoryId')
  const folderId = body.folderId ?? current.folderId
  const categoryId = categoryWasProvided
    ? (body.categoryId ?? null)
    : folderChanged
      ? null
      : current.categoryId

  const now = Date.now()
  const titleWasProvided = hasOwn(body, 'title')
  const contentWasProvided = hasOwn(body, 'content')
  const rankWasProvided = hasOwn(body, 'rank')
  const extensionWasProvided = hasOwn(body, 'extension')
  const autoChapterWasProvided = hasOwn(body, 'autoChapter')
  const title = body.title ?? current.title
  const content = body.content ?? current.content
  const shouldRecalculateCount = titleWasProvided || contentWasProvided

  await withDatabaseWriteTransaction(event, async (transaction) => {
    await validateArticleDestination(transaction, { folderId, categoryId })
    await transaction.execute({
      sql: `
        UPDATE Article
        SET
          title = ?,
          content = ?,
          summary = ?,
          count = ?,
          extension = ?,
          updateTime = ?,
          folderId = ?,
          categoryId = ?,
          rank = ?,
          titleUpdateTime = ?,
          rankUpdateTime = ?,
          folderIdUpdateTime = ?,
          categoryIdUpdateTime = ?,
          extensionUpdateTime = ?,
          autoChapter = ?,
          autoChapterUpdateTime = ?,
          orderKey = ?,
          structureUpdateTime = ?
        WHERE id = ?
      `,
      args: [
        title,
        content,
        contentWasProvided ? createArticleSummary(content) : current.summary,
        shouldRecalculateCount ? calculateArticleCount(content) : current.count,
        body.extension ?? current.extension,
        now,
        folderId,
        categoryId,
        body.rank ?? current.rank,
        titleWasProvided ? now : current.titleUpdateTime,
        rankWasProvided ? now : current.rankUpdateTime,
        folderChanged ? now : current.folderIdUpdateTime,
        categoryWasProvided || folderChanged ? now : current.categoryIdUpdateTime,
        extensionWasProvided ? now : current.extensionUpdateTime,
        body.autoChapter ?? current.autoChapter,
        autoChapterWasProvided ? now : current.autoChapterUpdateTime,
        hasOwn(body, 'orderKey') ? (body.orderKey ?? null) : current.orderKey,
        rankWasProvided || folderChanged || categoryWasProvided
          ? now
          : current.structureUpdateTime,
        id,
      ],
    })

    await writeAuditLog(event, {
      action: 'article.update',
      entityType: 'article',
      entityId: id,
      metadata: {
        changedFields: Object.keys(body),
        previousFolderId: folderChanged ? current.folderId : undefined,
        folderId: folderChanged ? folderId : undefined,
        count: shouldRecalculateCount
          ? calculateArticleCount(content)
          : current.count,
      },
    }, transaction)
  })

  return { article: await requireArticleById(event, id) }
})

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}
