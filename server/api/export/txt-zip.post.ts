import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const exportRequestSchema = z
  .object({
    includeDeleted: z.boolean().default(false),
  })
  .strict()
  .default({ includeDeleted: false })

export default defineProtectedEventHandler(async (event, session) => {
  const { includeDeleted } = await validateBody(event, exportRequestSchema)
  const createdAt = Date.now()
  const exportPlan = await loadWriterExportPlan(event, {
    includeDeleted,
    maximumEstimatedBytes: CLIENT_EXPORT_PAGE_SOURCE_BYTES,
  })
  const job = {
    id: randomUUID(),
    status: 'ready' as const,
    fileName: createFullExportFileName(new Date(createdAt)),
    format: browserExportJobFormat(
      includeDeleted,
      exportPlan.parts.length,
    ),
    createdAt,
  }

  await withDatabaseWriteTransaction(event, async (transaction) => {
    await transaction.execute({
      sql: `
        INSERT INTO app_export_job (
          id,
          user_id,
          format,
          status,
          file_name,
          error,
          created_at,
          completed_at
        )
        VALUES (?, ?, ?, 'ready', ?, NULL, ?, NULL)
      `,
      args: [job.id, session.user.id, job.format, job.fileName, createdAt],
    })

    await writeAuditLog(
      event,
      {
        action: 'export.job.create',
        entityType: 'app_export_job',
        entityId: job.id,
        metadata: {
          format: 'txt-zip-browser',
          includeDeleted,
          pageCount: exportPlan.parts.length,
          articleCount: exportPlan.articleCount,
        },
      },
      transaction,
    )
  })

  setCompatibleResponseStatus(event, 201)

  return {
    job: {
      id: job.id,
      status: job.status,
      fileName: job.fileName,
      createdAt: job.createdAt,
    },
    pageCount: exportPlan.parts.length,
  }
})
