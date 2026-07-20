import { z } from 'zod'
import {
  getTableColumns,
  listExplorableTables,
  quoteIdentifier,
} from '../../utils/table-explorer'

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine(isCalendarDate, 'Date must be a valid YYYY-MM-DD value.')

const querySchema = z
  .object({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    top: z.coerce.number().int().min(1).max(50).default(10),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'The start date cannot be after the end date.',
    path: ['from'],
  })

export default defineProtectedEventHandler(async (event) => {
  const query = validateQuery(event, querySchema)
  const client = getDatabaseClient(event)
  const tables = await listExplorableTables(client)
  const dailyTable = tables.find(
    (table) => table.name.toLowerCase() === 'daily',
  )

  if (!dailyTable) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Daily statistics are unavailable.',
    })
  }

  const columns = await getTableColumns(client, dailyTable.name)
  const columnNames = columns.map((column) => column.name)
  const wordColumn = findColumn(columnNames, ['wordCount', 'words', 'count'])
  const dateSql = buildDateExpression(columnNames)

  if (!wordColumn || !dateSql) {
    throw createError({
      statusCode: 500,
      statusMessage: 'The Daily table does not contain usable stats columns.',
    })
  }

  const wordSql = `COALESCE(CAST(d.${quoteIdentifier(wordColumn)} AS INTEGER), 0)`
  const inputtingColumn = findColumn(columnNames, [
    'inputtingDuration',
    'inputDuration',
  ])
  const foregroundColumn = findColumn(columnNames, [
    'foregroundDuration',
    'duration',
  ])
  const inputtingSql = durationExpression(inputtingColumn)
  const foregroundSql = durationExpression(foregroundColumn)
  const availableResult = await client.execute(`
    SELECT MIN(${dateSql}) AS availableFrom, MAX(${dateSql}) AS availableTo
    FROM ${quoteIdentifier(dailyTable.name)} d
  `)
  const availableFrom = nullableString(availableResult.rows[0]?.availableFrom)
  const availableTo = nullableString(availableResult.rows[0]?.availableTo)
  const rangeFrom = query.from ?? availableFrom
  const rangeTo = query.to ?? availableTo
  const { whereSql, args } = buildDateFilter(dateSql, rangeFrom, rangeTo)
  const totalsResult = await client.execute({
    sql: `
      SELECT
        COALESCE(SUM(${wordSql}), 0) AS words,
        COUNT(*) AS entries,
        COUNT(DISTINCT ${dateSql}) AS activeDays,
        COALESCE(SUM(${inputtingSql}), 0) AS inputtingDuration,
        COALESCE(SUM(${foregroundSql}), 0) AS foregroundDuration
      FROM ${quoteIdentifier(dailyTable.name)} d
      ${whereSql}
    `,
    args,
  })
  const byDateResult = await client.execute({
    sql: `
      SELECT
        ${dateSql} AS date,
        COALESCE(SUM(${wordSql}), 0) AS wordCount,
        COUNT(*) AS entries,
        COALESCE(SUM(${inputtingSql}), 0) AS inputtingDuration,
        COALESCE(SUM(${foregroundSql}), 0) AS foregroundDuration
      FROM ${quoteIdentifier(dailyTable.name)} d
      ${whereSql}
      GROUP BY ${dateSql}
      ORDER BY date ASC
    `,
    args,
  })
  const topFolders = await loadTopFolders({
    client,
    tables: tables.map((table) => table.name),
    dailyTable: dailyTable.name,
    columnNames,
    wordSql,
    whereSql,
    args,
    limit: query.top,
  })
  const totals = totalsResult.rows[0]

  return {
    range: {
      from: rangeFrom,
      to: rangeTo,
      availableFrom,
      availableTo,
    },
    totals: {
      words: toNumber(totals?.words),
      wordCount: toNumber(totals?.words),
      days: toNumber(totals?.activeDays),
      entries: toNumber(totals?.entries),
      activeDays: toNumber(totals?.activeDays),
      inputtingDuration: toNumber(totals?.inputtingDuration),
      foregroundDuration: toNumber(totals?.foregroundDuration),
    },
    byDate: byDateResult.rows.map((row) => ({
      date: String(row.date),
      wordCount: toNumber(row.wordCount),
      entries: toNumber(row.entries),
      inputtingDuration: toNumber(row.inputtingDuration),
      foregroundDuration: toNumber(row.foregroundDuration),
    })),
    topFolders,
  }
})

interface TopFolderOptions {
  client: ReturnType<typeof getDatabaseClient>
  tables: string[]
  dailyTable: string
  columnNames: string[]
  wordSql: string
  whereSql: string
  args: string[]
  limit: number
}

async function loadTopFolders(options: TopFolderOptions) {
  const folderIdColumn = findColumn(options.columnNames, [
    'folderId',
    'folder_id',
  ])
  const folderTitleColumn = findColumn(options.columnNames, [
    'folderTitle',
    'folderName',
  ])

  if (!folderIdColumn && !folderTitleColumn) {
    return []
  }

  const folderTable = options.tables.find(
    (table) => table.toLowerCase() === 'folder',
  )
  const canJoinFolder = Boolean(folderTable && folderIdColumn)
  const folderIdSql = folderIdColumn
    ? `CAST(d.${quoteIdentifier(folderIdColumn)} AS TEXT)`
    : 'NULL'
  const dailyTitleSql = folderTitleColumn
    ? `NULLIF(MAX(CAST(d.${quoteIdentifier(folderTitleColumn)} AS TEXT)), '')`
    : 'NULL'
  const folderNameSql = canJoinFolder ? 'MAX(f.name)' : 'NULL'
  const groupSql = folderIdColumn
    ? folderIdSql
    : `CAST(d.${quoteIdentifier(folderTitleColumn!)} AS TEXT)`
  const joinSql = canJoinFolder
    ? `LEFT JOIN ${quoteIdentifier(folderTable!)} f ON f.id = d.${quoteIdentifier(folderIdColumn!)}`
    : ''
  const result = await options.client.execute({
    sql: `
      SELECT
        ${folderIdSql} AS folderId,
        COALESCE(${dailyTitleSql}, ${folderNameSql}, 'Unknown folder') AS folderName,
        COALESCE(SUM(${options.wordSql}), 0) AS wordCount,
        COUNT(*) AS entries
      FROM ${quoteIdentifier(options.dailyTable)} d
      ${joinSql}
      ${options.whereSql}
      GROUP BY ${groupSql}
      ORDER BY wordCount DESC, folderName COLLATE NOCASE ASC
      LIMIT ?
    `,
    args: [...options.args, options.limit],
  })

  return result.rows.map((row) => ({
    folderId: nullableString(row.folderId),
    folderName: String(row.folderName),
    wordCount: toNumber(row.wordCount),
    entries: toNumber(row.entries),
  }))
}

function findColumn(columns: string[], candidates: string[]): string | null {
  const lookup = new Map(
    columns.map((column) => [column.toLowerCase(), column]),
  )

  for (const candidate of candidates) {
    const match = lookup.get(candidate.toLowerCase())

    if (match) return match
  }

  return null
}

function buildDateExpression(columns: string[]): string | null {
  const year = findColumn(columns, ['year'])
  const month = findColumn(columns, ['month'])
  const day = findColumn(columns, ['day'])

  if (year && month && day) {
    // Pure Writer stores calendar months zero-based, matching java.util.Calendar.
    return `printf('%04d-%02d-%02d', CAST(d.${quoteIdentifier(year)} AS INTEGER), CAST(d.${quoteIdentifier(month)} AS INTEGER) + 1, CAST(d.${quoteIdentifier(day)} AS INTEGER))`
  }

  const date = findColumn(columns, ['date', 'dayDate'])

  if (date) {
    return `date(d.${quoteIdentifier(date)})`
  }

  const timestamp = findColumn(columns, [
    'createdAt',
    'created_at',
    'timestamp',
  ])

  if (timestamp) {
    const value = `CAST(d.${quoteIdentifier(timestamp)} AS REAL)`

    return `date(CASE WHEN ABS(${value}) > 100000000000 THEN ${value} / 1000 ELSE ${value} END, 'unixepoch')`
  }

  return null
}

function durationExpression(column: string | null): string {
  return column
    ? `COALESCE(CAST(d.${quoteIdentifier(column)} AS INTEGER), 0)`
    : '0'
}

function buildDateFilter(
  dateSql: string,
  from: string | null,
  to: string | null,
): { whereSql: string; args: string[] } {
  const conditions: string[] = []
  const args: string[] = []

  if (from) {
    conditions.push(`${dateSql} >= ?`)
    args.push(from)
  }

  if (to) {
    conditions.push(`${dateSql} <= ?`)
    args.push(to)
  }

  return {
    whereSql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    args,
  }
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function toNumber(value: unknown): number {
  const number = Number(value ?? 0)

  return Number.isFinite(number) ? number : 0
}

function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`)

  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  )
}
