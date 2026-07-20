import type { H3Event } from 'h3'

const SQLITE_EXPORT_VERSION = 1
const SQLITE_EXPORT_PAGE_SOURCE_BYTES = 750_000

export const SQLITE_EXPORT_FORMAT = 'sqlite-browser' as const

// These are the Writer/Android tables required for a portable application
// backup. Web-only credential, audit, and export-job tables are deliberately
// excluded from the file downloaded to the browser.
const WRITER_SQLITE_TABLES = [
  'Article',
  'Category',
  'Daily',
  'Folder',
  'History',
  'License',
  'Setting',
  'Shortcut',
  'UserMessage',
  'android_metadata',
  'room_master_table',
] as const

export interface SQLiteExportColumn {
  name: string
  type: string
  integer: boolean
  primaryKeyPosition: number
}

export interface SQLiteExportTable {
  name: string
  sql: string
  columns: SQLiteExportColumn[]
  rowCount: number
  pageRowCounts: number[]
  withoutRowid: boolean
}

export interface SQLiteExportDefinition {
  version: number
  userVersion: number
  applicationId: number
  tables: SQLiteExportTable[]
  indexes: string[]
  totalRows: number
  totalPages: number
}

export type SQLiteExportValue =
  | string
  | number
  | null
  | { type: 'blob'; base64: string }

export async function loadSQLiteExportDefinition(
  event: H3Event,
): Promise<SQLiteExportDefinition> {
  const client = getDatabaseClient(event)
  const placeholders = WRITER_SQLITE_TABLES.map(() => '?').join(', ')
  const [schemaResult, userVersionResult, applicationIdResult] =
    await Promise.all([
      client.execute({
        sql: `
          SELECT name, sql
          FROM sqlite_schema
          WHERE type = 'table'
            AND name IN (${placeholders})
          ORDER BY name COLLATE NOCASE, name
        `,
        args: [...WRITER_SQLITE_TABLES],
      }),
      client.execute('PRAGMA user_version'),
      client.execute('PRAGMA application_id'),
    ])
  const schemaByName = new Map(
    schemaResult.rows.map((row) => [String(row.name), String(row.sql ?? '')]),
  )
  const plannedTables = await Promise.all(
    WRITER_SQLITE_TABLES.map(async (tableName) => {
      const sql = schemaByName.get(tableName)

      if (!sql) return null

      const columns = await loadSQLiteExportColumns(event, tableName)
      const withoutRowid = /\bWITHOUT\s+ROWID\b/iu.test(sql)
      const pageRowCounts = await planSQLiteTablePages(
        event,
        tableName,
        columns,
        withoutRowid,
      )

      return {
        name: tableName,
        sql,
        columns,
        rowCount: pageRowCounts.reduce((total, count) => total + count, 0),
        pageRowCounts,
        withoutRowid,
      } satisfies SQLiteExportTable
    }),
  )
  const tables: SQLiteExportTable[] = plannedTables.filter(
    (
      table,
    ): table is NonNullable<(typeof plannedTables)[number]> => table !== null,
  )

  const includedNames = tables.map((table) => table.name)
  let indexes: string[] = []

  if (includedNames.length > 0) {
    const indexPlaceholders = includedNames.map(() => '?').join(', ')
    const indexResult = await client.execute({
      sql: `
        SELECT sql
        FROM sqlite_schema
        WHERE type = 'index'
          AND sql IS NOT NULL
          AND tbl_name IN (${indexPlaceholders})
        ORDER BY name COLLATE NOCASE, name
      `,
      args: includedNames,
    })
    indexes = indexResult.rows.map((row) => String(row.sql))
  }

  return {
    version: SQLITE_EXPORT_VERSION,
    userVersion: Number(userVersionResult.rows[0]?.user_version ?? 0),
    applicationId: Number(applicationIdResult.rows[0]?.application_id ?? 0),
    tables,
    indexes,
    totalRows: tables.reduce((total, table) => total + table.rowCount, 0),
    totalPages: tables.reduce(
      (total, table) => total + table.pageRowCounts.length,
      0,
    ),
  }
}

export async function loadSQLiteExportPage(
  event: H3Event,
  table: SQLiteExportTable,
  page: number,
): Promise<SQLiteExportValue[][]> {
  const pageRowCount = table.pageRowCounts[page - 1]

  if (pageRowCount === undefined) {
    throw createError({ statusCode: 404, statusMessage: 'Export page not found.' })
  }

  if (pageRowCount === 0) return []

  const offset = table.pageRowCounts
    .slice(0, page - 1)
    .reduce((total, count) => total + count, 0)
  const selectedColumns = table.columns
    .map((column) => {
      const identifier = quoteSQLiteIdentifier(column.name)
      return column.integer
        ? `CAST(${identifier} AS TEXT) AS ${identifier}`
        : identifier
    })
    .join(', ')
  const orderBy = sqliteExportOrderBy(table)
  const result = await getDatabaseClient(event).execute({
    sql: `
      SELECT ${selectedColumns}
      FROM ${quoteSQLiteIdentifier(table.name)}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `,
    args: [pageRowCount, offset],
  })

  if (result.rows.length !== pageRowCount) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The database changed. Please create a new backup.',
    })
  }

  return result.rows.map((row) =>
    table.columns.map((column) => serializeSQLiteValue(row[column.name])),
  )
}

export function browserSQLiteExportJobFormat(
  definition: SQLiteExportDefinition,
): string {
  const snapshot = Buffer.from(JSON.stringify(definition)).toString('base64url')
  return `${SQLITE_EXPORT_FORMAT};snapshot=${snapshot}`
}

export function parseBrowserSQLiteExportJobFormat(
  format: string,
): SQLiteExportDefinition {
  const match = /^sqlite-browser;snapshot=([A-Za-z0-9_-]+)$/.exec(format)

  if (!match) throwUnsupportedSQLiteExport()
  const encodedSnapshot = match[1]

  if (!encodedSnapshot) throwUnsupportedSQLiteExport()

  let value: unknown

  try {
    value = JSON.parse(Buffer.from(encodedSnapshot, 'base64url').toString())
  } catch {
    throwUnsupportedSQLiteExport()
  }

  if (!isSQLiteExportDefinition(value)) throwUnsupportedSQLiteExport()
  return value
}

export function createSQLiteExportFileName(now = new Date()): string {
  return `Writer Backup - ${now.toISOString().slice(0, 10)}.db`
}

async function loadSQLiteExportColumns(
  event: H3Event,
  tableName: string,
): Promise<SQLiteExportColumn[]> {
  const result = await getDatabaseClient(event).execute(
    `PRAGMA table_info(${quoteSQLiteIdentifier(tableName)})`,
  )

  return result.rows.map((row) => {
    const type = String(row.type ?? '')
    return {
      name: String(row.name),
      type,
      integer: /\bINT(?:EGER)?\b/iu.test(type),
      primaryKeyPosition: Number(row.pk ?? 0),
    }
  })
}

async function planSQLiteTablePages(
  event: H3Event,
  tableName: string,
  columns: SQLiteExportColumn[],
  withoutRowid: boolean,
): Promise<number[]> {
  const estimatedBytes = columns
    .map(
      (column) =>
        `COALESCE(length(CAST(${quoteSQLiteIdentifier(column.name)} AS BLOB)), 0) + 32`,
    )
    .join(' + ')
  const orderBy = sqliteExportOrderBy({
    columns,
    withoutRowid,
  })
  const result = await getDatabaseClient(event).execute(`
    SELECT ${estimatedBytes || '1'} AS estimatedBytes
    FROM ${quoteSQLiteIdentifier(tableName)}
    ORDER BY ${orderBy}
  `)
  const pages: number[] = []
  let pageRows = 0
  let pageBytes = 0

  for (const row of result.rows) {
    const rowBytes = Math.max(1, Number(row.estimatedBytes ?? 1))

    if (
      pageRows > 0 &&
      pageBytes + rowBytes > SQLITE_EXPORT_PAGE_SOURCE_BYTES
    ) {
      pages.push(pageRows)
      pageRows = 0
      pageBytes = 0
    }

    pageRows += 1
    pageBytes += rowBytes
  }

  if (pageRows > 0) pages.push(pageRows)
  return pages.length > 0 ? pages : [0]
}

function sqliteExportOrderBy(
  table: Pick<SQLiteExportTable, 'columns' | 'withoutRowid'>,
): string {
  const primaryKey = table.columns
    .filter((column) => column.primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition)

  if (primaryKey.length > 0) {
    return primaryKey
      .map((column) => quoteSQLiteIdentifier(column.name))
      .join(', ')
  }

  return table.withoutRowid
    ? table.columns.map((column) => quoteSQLiteIdentifier(column.name)).join(', ')
    : 'rowid'
}

function serializeSQLiteValue(value: unknown): SQLiteExportValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') {
    return value
  }

  if (typeof value === 'bigint') return value.toString()

  const bytes = asByteArray(value)
  if (bytes) {
    return { type: 'blob', base64: Buffer.from(bytes).toString('base64') }
  }

  return String(value)
}

function asByteArray(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  return null
}

function quoteSQLiteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function isSQLiteExportDefinition(value: unknown): value is SQLiteExportDefinition {
  if (!isRecord(value) || value.version !== SQLITE_EXPORT_VERSION) return false
  if (
    !Number.isInteger(value.userVersion) ||
    Number(value.userVersion) < 0 ||
    !Number.isInteger(value.applicationId)
  ) {
    return false
  }
  if (!Array.isArray(value.tables) || !Array.isArray(value.indexes)) return false
  if (!value.indexes.every((sql) => typeof sql === 'string')) return false
  if (!Number.isInteger(value.totalRows) || !Number.isInteger(value.totalPages)) {
    return false
  }

  const allowedTables = new Set<string>(WRITER_SQLITE_TABLES)
  const names = new Set<string>()

  for (const table of value.tables) {
    if (
      !isRecord(table) ||
      typeof table.name !== 'string' ||
      !allowedTables.has(table.name) ||
      names.has(table.name) ||
      typeof table.sql !== 'string' ||
      !/^CREATE\s+TABLE\b/iu.test(table.sql) ||
      typeof table.withoutRowid !== 'boolean' ||
      !Number.isInteger(table.rowCount) ||
      !Array.isArray(table.pageRowCounts) ||
      table.pageRowCounts.length < 1 ||
      !table.pageRowCounts.every(
        (count) => Number.isInteger(count) && Number(count) >= 0,
      ) ||
      !Array.isArray(table.columns) ||
      table.columns.length < 1
    ) {
      return false
    }

    for (const column of table.columns) {
      if (
        !isRecord(column) ||
        typeof column.name !== 'string' ||
        typeof column.type !== 'string' ||
        typeof column.integer !== 'boolean' ||
        !Number.isInteger(column.primaryKeyPosition)
      ) {
        return false
      }
    }

    if (
      table.pageRowCounts.reduce<number>(
        (total, count) => total + Number(count),
        0,
      ) !== table.rowCount
    ) {
      return false
    }

    names.add(table.name)
  }

  return (
    value.tables.reduce<number>(
      (total, table) => total + Number(table.rowCount),
      0,
    ) === value.totalRows &&
    value.tables.reduce<number>(
      (total, table) => total + table.pageRowCounts.length,
      0,
    ) === value.totalPages
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function throwUnsupportedSQLiteExport(): never {
  throw createError({
    statusCode: 409,
    statusMessage: 'This SQLite backup job is not supported.',
  })
}
