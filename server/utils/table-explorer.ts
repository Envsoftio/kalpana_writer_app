import type { DatabaseClient } from './db'

const GRID_TEXT_LIMIT = 240
const DETAIL_BLOB_LIMIT = 5_000_000
const SENSITIVE_COLUMN = /(password|secret|token|credential)/i
const INTERNAL_ROW_ID = '__explorerRowId'

export interface TableColumn {
  name: string
  type: string
  nullable: boolean
  defaultValue: string | null
  primaryKeyPosition: number
}

export interface ExplorableTable {
  name: string
  sql: string | null
  withoutRowid: boolean
}

export async function listExplorableTables(
  client: DatabaseClient,
): Promise<ExplorableTable[]> {
  const result = await client.execute(`
    SELECT name, sql
    FROM sqlite_schema
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name COLLATE NOCASE, name
  `)

  return result.rows.map((row) => {
    const sql = row.sql === null ? null : String(row.sql)

    return {
      name: String(row.name),
      sql,
      withoutRowid: /\bWITHOUT\s+ROWID\b/iu.test(sql ?? ''),
    }
  })
}

export async function requireExplorableTable(
  client: DatabaseClient,
  tableName: string,
): Promise<ExplorableTable> {
  const tables = await listExplorableTables(client)
  const table = tables.find((candidate) => candidate.name === tableName)

  if (!table) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Table not found.',
    })
  }

  return table
}

export async function getTableColumns(
  client: DatabaseClient,
  tableName: string,
): Promise<TableColumn[]> {
  const result = await client.execute(
    `PRAGMA table_info(${quoteIdentifier(tableName)})`,
  )

  return result.rows.map((row) => ({
    name: String(row.name),
    type: String(row.type ?? ''),
    nullable: Number(row.notnull ?? 0) === 0,
    defaultValue: row.dflt_value === null ? null : String(row.dflt_value),
    primaryKeyPosition: Number(row.pk ?? 0),
  }))
}

export function getPrimaryKeyColumns(columns: TableColumn[]): TableColumn[] {
  return columns
    .filter((column) => column.primaryKeyPosition > 0)
    .sort((a, b) => a.primaryKeyPosition - b.primaryKeyPosition)
}

export function buildTableSelect(columns: TableColumn[]): string {
  return columns
    .map((column) => {
      const identifier = quoteIdentifier(column.name)

      // libSQL rejects SQLite integers outside Number.MAX_SAFE_INTEGER. Casting
      // declared integer columns keeps values such as Daily.id exact and JSON-safe.
      return isIntegerColumn(column)
        ? `CAST(${identifier} AS TEXT) AS ${identifier}`
        : identifier
    })
    .join(', ')
}

export function serializeGridRow(
  row: Record<string, unknown>,
  columns: TableColumn[],
  rowKey: string,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = {}
  const truncatedColumns: string[] = []

  for (const column of columns) {
    const value = row[column.name]

    if (SENSITIVE_COLUMN.test(column.name)) {
      serialized[column.name] = value === null ? null : '[redacted]'
      truncatedColumns.push(column.name)
      continue
    }

    if (typeof value === 'string' && value.length > GRID_TEXT_LIMIT) {
      serialized[column.name] = `[TEXT: ${value.length} characters]`
      truncatedColumns.push(column.name)
      continue
    }

    const blob = asByteArray(value)

    if (blob) {
      serialized[column.name] = `[BLOB: ${blob.byteLength} bytes]`
      truncatedColumns.push(column.name)
      continue
    }

    serialized[column.name] = toJsonValue(value)
  }

  serialized.__rowKey = rowKey
  serialized.__truncated = truncatedColumns

  return serialized
}

export function serializeDetailRow(
  row: Record<string, unknown>,
  columns: TableColumn[],
): Record<string, unknown> {
  const serialized: Record<string, unknown> = {}

  for (const column of columns) {
    const value = row[column.name]

    if (SENSITIVE_COLUMN.test(column.name)) {
      serialized[column.name] = value === null ? null : '[redacted]'
      continue
    }

    const blob = asByteArray(value)

    if (blob) {
      serialized[column.name] = {
        type: 'blob',
        byteLength: blob.byteLength,
        base64:
          blob.byteLength <= DETAIL_BLOB_LIMIT
            ? Buffer.from(blob).toString('base64')
            : null,
        truncated: blob.byteLength > DETAIL_BLOB_LIMIT,
      }
      continue
    }

    serialized[column.name] = toJsonValue(value)
  }

  return serialized
}

export function createRowKey(
  row: Record<string, unknown>,
  primaryKey: TableColumn[],
): string {
  if (primaryKey.length === 0) {
    return JSON.stringify({ $rowid: String(row[INTERNAL_ROW_ID]) })
  }

  return JSON.stringify(
    Object.fromEntries(
      primaryKey.map((column) => [column.name, toJsonValue(row[column.name])]),
    ),
  )
}

export function parseRowKey(
  value: string,
  primaryKey: TableColumn[],
  withoutRowid: boolean,
): { whereSql: string; args: Array<string | number | null> } {
  let parsed: unknown

  try {
    parsed = JSON.parse(value)
  } catch {
    throw invalidRowKeyError()
  }

  if (!isRecord(parsed)) {
    throw invalidRowKeyError()
  }

  if (primaryKey.length === 0) {
    if (withoutRowid || typeof parsed.$rowid !== 'string') {
      throw invalidRowKeyError()
    }

    return { whereSql: 'rowid = ?', args: [parsed.$rowid] }
  }

  const expectedNames = new Set(primaryKey.map((column) => column.name))

  if (
    Object.keys(parsed).length !== expectedNames.size ||
    Object.keys(parsed).some((key) => !expectedNames.has(key))
  ) {
    throw invalidRowKeyError()
  }

  const args = primaryKey.map((column) => {
    const keyValue = parsed[column.name]

    if (
      keyValue !== null &&
      typeof keyValue !== 'string' &&
      typeof keyValue !== 'number'
    ) {
      throw invalidRowKeyError()
    }

    return keyValue
  })

  return {
    whereSql: primaryKey
      .map((column) => `${quoteIdentifier(column.name)} IS ?`)
      .join(' AND '),
    args,
  }
}

export function rowIdSelect(table: ExplorableTable, columns: TableColumn[]) {
  const prefix =
    getPrimaryKeyColumns(columns).length === 0 && !table.withoutRowid
      ? `CAST(rowid AS TEXT) AS ${quoteIdentifier(INTERNAL_ROW_ID)}, `
      : ''

  return `${prefix}${buildTableSelect(columns)}`
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function isIntegerColumn(column: TableColumn): boolean {
  return /INT/iu.test(column.type)
}

function asByteArray(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }

  return null
}

function toJsonValue(value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidRowKeyError() {
  return createError({
    statusCode: 400,
    statusMessage: 'The table row key is invalid.',
  })
}
