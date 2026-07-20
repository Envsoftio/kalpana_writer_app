import { z } from 'zod'

const routeParamsSchema = z.object({ id: entityIdSchema })

export default defineProtectedEventHandler(async (event, session) => {
  const { id } = validateRouteParams(event, routeParamsSchema)
  const client = getDatabaseClient(event)
  const result = await client.execute({
    sql: `
      SELECT id, user_id, format, status, file_name, created_at
      FROM app_export_job
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `,
    args: [id, session.user.id],
  })
  const job = result.rows[0]

  if (!job) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Export job not found.',
    })
  }

  try {
    const jobFormat = parseFullExportJobFormat(String(job.format))
    const { includeDeleted } = jobFormat
    const exportPlan = await loadWriterExportPlan(event, { includeDeleted })

    if (jobFormat.partCount !== exportPlan.parts.length) {
      throw createError({
        statusCode: 409,
        statusMessage: 'The archive changed. Please create a new backup.',
      })
    }

    const part = exportPlan.parts[jobFormat.partIndex]

    if (!part) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Export part not found.',
      })
    }

    const data = await loadWriterExportData(event, {
      includeDeleted,
      articleOffset: part.articleOffset,
      articleLimit: part.articleCount,
    })
    const archive = buildWriterTextZip(data, {
      includeDeleted,
      pathContext: exportPlan.pathContext,
    })

    if (archive.bytes.byteLength > MAX_EXPORT_PART_BYTES) {
      throw createError({
        statusCode: 413,
        statusMessage: 'This export part is too large. Please contact support.',
      })
    }

    const completedAt = Date.now()
    const fileName =
      typeof job.file_name === 'string' && job.file_name
        ? job.file_name
        : createFullExportFileName(new Date(Number(job.created_at)))

    await withDatabaseWriteTransaction(event, async (transaction) => {
      await writeAuditLog(
        event,
        {
          action: 'export.txt_zip',
          entityType: 'app_export_job',
          entityId: id,
          metadata: {
            format: 'txt-zip',
            includeDeleted,
            fileName,
            folderCount: archive.metadata.exportInfo.folderCount,
            articleCount: archive.metadata.exportInfo.articleCount,
            categoryCount: archive.metadata.exportInfo.categoryCount,
            archiveBytes: archive.bytes.byteLength,
          },
        },
        transaction,
      )

      await transaction.execute({
        sql: `
          UPDATE app_export_job
          SET status = 'completed', error = NULL, completed_at = ?
          WHERE id = ? AND user_id = ?
        `,
        args: [completedAt, id, session.user.id],
      })
    })

    return sendAttachmentStream(event, archive.bytes, {
      contentType: 'application/zip',
      fileName,
    })
  } catch (error) {
    try {
      await client.execute({
        sql: `
          UPDATE app_export_job
          SET status = 'failed', error = ?, completed_at = ?
          WHERE id = ? AND user_id = ?
        `,
        args: [safeExportError(error), Date.now(), id, session.user.id],
      })
    } catch {
      // Preserve the generation error when recording its status also fails.
    }

    throw error
  }
})

function safeExportError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 500)
  }

  return 'Export generation failed.'
}
