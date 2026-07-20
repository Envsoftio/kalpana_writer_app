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
  const data = await loadWriterExportData(event, { includeDeleted })
  const archives = buildWriterTextZipParts(data, { includeDeleted })
  const jobs = archives.map((archive, partIndex) => ({
    id: randomUUID(),
    status: 'ready' as const,
    fileName: createFullExportFileName(
      new Date(createdAt),
      partIndex + 1,
      archives.length,
    ),
    format: fullExportPartFormat(includeDeleted, partIndex, archives.length),
    createdAt,
    archiveBytes: archive.bytes.byteLength,
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
          totalArchiveBytes: jobs.reduce(
            (total, job) => total + job.archiveBytes,
            0,
          ),
        },
      },
      transaction,
    )
  })

  setCompatibleResponseStatus(event, 201)

  const responseParts = jobs.map(({ format: _format, archiveBytes, ...job }) => ({
    job,
    archiveBytes,
    downloadUrl: `/api/export/${encodeURIComponent(job.id)}/download`,
  }))
  const firstPart = responseParts[0]

  return {
    job: firstPart?.job,
    downloadUrl: firstPart?.downloadUrl,
    parts: responseParts,
  }
})
