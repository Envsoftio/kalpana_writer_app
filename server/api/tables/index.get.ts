import {
  getPrimaryKeyColumns,
  getTableColumns,
  listExplorableTables,
  quoteIdentifier,
} from '../../utils/table-explorer'

export default defineProtectedEventHandler(async (event) => {
  const client = getDatabaseClient(event)
  const availableTables = await listExplorableTables(client)
  const tables = await Promise.all(
    availableTables.map(async (table) => {
      const [columns, countResult] = await Promise.all([
        getTableColumns(client, table.name),
        client.execute(
          `SELECT COUNT(*) AS total FROM ${quoteIdentifier(table.name)}`,
        ),
      ])

      return {
        name: table.name,
        rowCount: Number(countResult.rows[0]?.total ?? 0),
        columnCount: columns.length,
        primaryKey: getPrimaryKeyColumns(columns).map((column) => column.name),
        supportsRowDetail:
          getPrimaryKeyColumns(columns).length > 0 || !table.withoutRowid,
      }
    }),
  )

  return { tables }
})
