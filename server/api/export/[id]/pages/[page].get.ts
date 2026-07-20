import { z } from 'zod'

const routeParamsSchema = z.object({
  id: entityIdSchema,
  page: z.coerce.number().int().min(1),
})

export default defineProtectedEventHandler(async (event, session) => {
  const { id, page } = validateRouteParams(event, routeParamsSchema)
  const client = getDatabaseClient(event)
  const result = await client.execute({
    sql: `
      SELECT id, format, file_name, created_at
      FROM app_export_job
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `,
    args: [id, session.user.id],
  })
  const job = result.rows[0]

  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'Export job not found.' })
  }

  const jobFormat = parseBrowserExportJobFormat(String(job.format))
  const exportPlan = await loadWriterExportPlan(event, {
    includeDeleted: jobFormat.includeDeleted,
    maximumEstimatedBytes: CLIENT_EXPORT_PAGE_SOURCE_BYTES,
  })

  if (jobFormat.pageCount !== exportPlan.parts.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The archive changed. Please create a new backup.',
    })
  }

  const part = exportPlan.parts[page - 1]

  if (!part) {
    throw createError({ statusCode: 404, statusMessage: 'Export page not found.' })
  }

  const data = await loadWriterExportData(event, {
    includeDeleted: jobFormat.includeDeleted,
    articleOffset: part.articleOffset,
    articleLimit: part.articleCount,
  })
  const metadata = buildExportMetadata(data, {
    includeDeleted: jobFormat.includeDeleted,
    exportedAt: new Date(Number(job.created_at)),
    pathContext: exportPlan.pathContext,
  })
  const paths = new Map(
    metadata.articles.map((article) => [article.id, article.path]),
  )

  setHeader(event, 'Cache-Control', 'private, no-store')

  if (page === jobFormat.pageCount) {
    await client.execute({
      sql: `
        UPDATE app_export_job
        SET status = 'completed', error = NULL, completed_at = ?
        WHERE id = ? AND user_id = ?
      `,
      args: [Date.now(), id, session.user.id],
    })
  }

  return {
    fileName: String(job.file_name),
    page,
    pageCount: jobFormat.pageCount,
    exportInfo: {
      ...metadata.exportInfo,
      folderCount: data.folders.length,
      articleCount: exportPlan.articleCount,
      categoryCount: data.categories.length,
    },
    folders: page === 1 ? metadata.folders : [],
    categories: page === 1 ? metadata.categories : [],
    articles: metadata.articles,
    files: data.articles.map((article) => ({
      path: paths.get(article.id) ?? '',
      text: formatArticleText(article),
    })),
  }
})
