import { z } from 'zod'
import {
  getPrimaryKeyColumns,
  getTableColumns,
  parseRowKey,
  quoteIdentifier,
  requireExplorableTable,
  rowIdSelect,
  serializeDetailRow,
} from '../../../utils/table-explorer'

const paramsSchema = z.object({ name: entityIdSchema })
const querySchema = z.object({ key: z.string().min(1).max(8_000) })

export default defineProtectedEventHandler(async (event) => {
  const { name } = validateRouteParams(event, paramsSchema)
  const query = validateQuery(event, querySchema)
  const client = getDatabaseClient(event)
  const table = await requireExplorableTable(client, name)
  const columns = await getTableColumns(client, table.name)
  const primaryKey = getPrimaryKeyColumns(columns)
  const rowKey = parseRowKey(query.key, primaryKey, table.withoutRowid)
  const result = await client.execute({
    sql: `
      SELECT ${rowIdSelect(table, columns)}
      FROM ${quoteIdentifier(table.name)}
      WHERE ${rowKey.whereSql}
      LIMIT 1
    `,
    args: rowKey.args,
  })
  const row = result.rows[0]

  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Table row not found.',
    })
  }

  return {
    table: {
      name: table.name,
      primaryKey: primaryKey.map((column) => column.name),
    },
    columns,
    row: serializeDetailRow(row, columns),
  }
})
