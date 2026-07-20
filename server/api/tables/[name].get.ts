import { z } from 'zod'
import {
  createRowKey,
  getPrimaryKeyColumns,
  getTableColumns,
  quoteIdentifier,
  requireExplorableTable,
  rowIdSelect,
  serializeGridRow,
} from '../../utils/table-explorer'

const paramsSchema = z.object({ name: entityIdSchema })
const querySchema = paginationQuerySchema.extend({
  sort: z.string().trim().min(1).max(128).optional(),
  direction: z.enum(['asc', 'desc']).default('asc'),
})

export default defineProtectedEventHandler(async (event) => {
  const { name } = validateRouteParams(event, paramsSchema)
  const query = validateQuery(event, querySchema)
  const client = getDatabaseClient(event)
  const table = await requireExplorableTable(client, name)
  const columns = await getTableColumns(client, table.name)
  const primaryKey = getPrimaryKeyColumns(columns)
  const sortColumn = query.sort
    ? columns.find((column) => column.name === query.sort)
    : undefined

  if (query.sort && !sortColumn) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The requested sort column does not exist.',
    })
  }

  const totalResult = await client.execute(
    `SELECT COUNT(*) AS total FROM ${quoteIdentifier(table.name)}`,
  )
  const total = Number(totalResult.rows[0]?.total ?? 0)
  const offset = (query.page - 1) * query.pageSize
  const orderSql = sortColumn
    ? `${quoteIdentifier(sortColumn.name)} ${query.direction.toUpperCase()}`
    : primaryKey.length > 0
      ? primaryKey.map((column) => quoteIdentifier(column.name)).join(', ')
      : 'rowid'
  const result = await client.execute({
    sql: `
      SELECT ${rowIdSelect(table, columns)}
      FROM ${quoteIdentifier(table.name)}
      ORDER BY ${orderSql}
      LIMIT ? OFFSET ?
    `,
    args: [query.pageSize, offset],
  })

  return {
    table: {
      name: table.name,
      rowCount: total,
      primaryKey: primaryKey.map((column) => column.name),
      supportsRowDetail: primaryKey.length > 0 || !table.withoutRowid,
    },
    columns,
    rows: result.rows.map((row) =>
      serializeGridRow(row, columns, createRowKey(row, primaryKey)),
    ),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  }
})
