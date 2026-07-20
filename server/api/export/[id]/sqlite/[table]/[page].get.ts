import { z } from 'zod'

const routeParamsSchema = z.object({
  id: entityIdSchema,
  table: z.string().min(1).max(128),
  page: z.coerce.number().int().min(1),
})

export default defineProtectedEventHandler(async (event, session) => {
  const { id, table: tableName, page } = validateRouteParams(
    event,
    routeParamsSchema,
  )
  const client = getDatabaseClient(event)
  const result = await client.execute({
    sql: `
      SELECT format, status, file_name
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

  const definition = parseBrowserSQLiteExportJobFormat(String(job.format))
  const tableIndex = definition.tables.findIndex(
    (candidate) => candidate.name === tableName,
  )
  const table = definition.tables[tableIndex]

  if (!table) {
    throw createError({ statusCode: 404, statusMessage: 'Export table not found.' })
  }

  const rows = await loadSQLiteExportPage(event, table, page)
  setCompatibleResponseHeader(event, 'Cache-Control', 'private, no-store')

  const isLastPage =
    tableIndex === definition.tables.length - 1 &&
    page === table.pageRowCounts.length

  if (isLastPage && String(job.status) !== 'completed') {
    const completedAt = Date.now()

    await withDatabaseWriteTransaction(event, async (transaction) => {
      await transaction.execute({
        sql: `
          UPDATE app_export_job
          SET status = 'completed', error = NULL, completed_at = ?
          WHERE id = ? AND user_id = ?
        `,
        args: [completedAt, id, session.user.id],
      })

      await writeAuditLog(
        event,
        {
          action: 'export.sqlite_db',
          entityType: 'app_export_job',
          entityId: id,
          metadata: {
            format: SQLITE_EXPORT_FORMAT,
            fileName: String(job.file_name),
            tableCount: definition.tables.length,
            rowCount: definition.totalRows,
            pageCount: definition.totalPages,
          },
        },
        transaction,
      )
    })
  }

  return {
    table: table.name,
    page,
    pageCount: table.pageRowCounts.length,
    rows,
  }
})
