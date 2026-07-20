import { randomUUID } from 'node:crypto'

export default defineProtectedEventHandler(async (event, session) => {
  const createdAt = Date.now()
  const definition = await loadSQLiteExportDefinition(event)
  const job = {
    id: randomUUID(),
    status: 'ready' as const,
    fileName: createSQLiteExportFileName(new Date(createdAt)),
    format: browserSQLiteExportJobFormat(definition),
    createdAt,
  }

  await withDatabaseWriteTransaction(event, async (transaction) => {
    await transaction.execute({
      sql: `
        INSERT INTO app_export_job (
          id, user_id, format, status, file_name, error, created_at, completed_at
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
          format: SQLITE_EXPORT_FORMAT,
          tableCount: definition.tables.length,
          rowCount: definition.totalRows,
          pageCount: definition.totalPages,
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
    definition,
  }
})
