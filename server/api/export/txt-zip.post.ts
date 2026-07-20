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
  const id = randomUUID()
  const createdAt = Date.now()
  const fileName = createFullExportFileName(new Date(createdAt))
  const format = fullExportFormat(includeDeleted)

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
      args: [id, session.user.id, format, fileName, createdAt],
    })

    await writeAuditLog(event, {
      action: 'export.job.create',
      entityType: 'app_export_job',
      entityId: id,
      metadata: {
        format: 'txt-zip',
        includeDeleted,
        fileName,
      },
    }, transaction)
  })

  setCompatibleResponseStatus(event, 201)

  return {
    job: {
      id,
      status: 'ready' as const,
      fileName,
      createdAt,
    },
    downloadUrl: `/api/export/${encodeURIComponent(id)}/download`,
  }
})
