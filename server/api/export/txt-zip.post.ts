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
  const exportPlan = await loadWriterExportPlan(event, { includeDeleted })
  const jobs = exportPlan.parts.map((part, partIndex) => ({
    id: randomUUID(),
    status: 'ready' as const,
    fileName: createFullExportFileName(
      new Date(createdAt),
      partIndex + 1,
      exportPlan.parts.length,
    ),
    format: fullExportPartFormat(
      includeDeleted,
      partIndex,
      exportPlan.parts.length,
    ),
    createdAt,
    estimatedBytes: part.estimatedBytes,
  }))

  await withDatabaseWriteTransaction(event, async (transaction) => {
    for (const job of jobs) {
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
        args: [
          job.id,
          session.user.id,
          job.format,
          job.fileName,
          createdAt,
        ],
      })
    }

    await writeAuditLog(
      event,
      {
        action: 'export.job.create',
        entityType: 'app_export_job',
        entityId: jobs[0]?.id ?? null,
        metadata: {
          format: 'txt-zip-parts',
          includeDeleted,
          partCount: jobs.length,
          totalEstimatedSourceBytes: jobs.reduce(
            (total, job) => total + job.estimatedBytes,
            0,
          ),
        },
      },
      transaction,
    )
  })

  setCompatibleResponseStatus(event, 201)

  const responseParts = jobs.map(({ format: _format, estimatedBytes, ...job }) => ({
    job,
    estimatedBytes,
    downloadUrl: `/api/export/${encodeURIComponent(job.id)}/download`,
  }))
  const firstPart = responseParts[0]

  return {
    job: firstPart?.job,
    downloadUrl: firstPart?.downloadUrl,
    parts: responseParts,
  }
})
