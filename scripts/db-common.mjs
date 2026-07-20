import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@libsql/client'

export const sourceDatabaseFile =
  'WriterBackup-40books-3983articles-0719201745-v28.9.2-Galaxy-S9+.db'

export const writerTables = [
  'Article',
  'Category',
  'Daily',
  'Folder',
  'History',
  'Setting',
  'UserMessage',
  'room_master_table',
]

export const appTables = ['app_user', 'app_audit_log', 'app_export_job']
export const ignoredSourceTables = ['android_metadata', 'License', 'Shortcut']

export const keyTableCounts = {
  Article: 4472,
  Folder: 46,
  Category: 2,
  Daily: 14541,
}

export const fullSourceTableCounts = {
  Article: 4472,
  Category: 2,
  Daily: 14541,
  Folder: 46,
  History: 0,
  Setting: 3,
  UserMessage: 1,
  room_master_table: 1,
}

export function loadDotEnv(envFile = '.env', options = {}) {
  const override = options.override ?? true
  const envPath = resolve(process.cwd(), envFile)

  if (!existsSync(envPath)) {
    return false
  }

  const content = readFileSync(envPath, 'utf8')

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const equalsIndex = trimmed.indexOf('=')

    if (equalsIndex === -1) {
      continue
    }

    const key = trimmed.slice(0, equalsIndex).trim()
    const value = parseEnvValue(trimmed.slice(equalsIndex + 1).trim())

    if (key && (override || process.env[key] === undefined)) {
      process.env[key] = value
    }
  }

  return true
}

export function createDatabaseClient(options = {}) {
  const url = options.url || process.env.TURSO_DATABASE_URL
  const authToken = options.authToken || process.env.TURSO_AUTH_TOKEN

  if (!url) {
    throw new Error('TURSO_DATABASE_URL is required.')
  }

  if (requiresAuthToken(url) && !authToken) {
    throw new Error('TURSO_AUTH_TOKEN is required for remote Turso databases.')
  }

  return createClient({
    url,
    authToken,
  })
}

export async function closeDatabaseClient(client) {
  if (typeof client.close === 'function') {
    await client.close()
  }
}

export async function executeSqlFile(client, sqlFile) {
  const sqlPath = resolve(process.cwd(), sqlFile)
  const content = readFileSync(sqlPath, 'utf8')
  const statements = splitSqlStatements(content)

  for (const statement of statements) {
    await client.execute(statement)
  }

  return statements.length
}

export async function listDatabaseTables(client) {
  const result = await client.execute(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `)

  return result.rows
    .map((row) => String(row.name))
    .filter((tableName) => !ignoredSourceTables.includes(tableName))
}

export async function countTableRows(client, tableName) {
  const result = await client.execute(
    `SELECT count(*) AS count FROM ${quoteIdentifier(tableName)}`,
  )

  return Number(result.rows[0]?.count ?? 0)
}

export function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`)
  }

  return `"${identifier}"`
}

export function formatStatus(ok) {
  return ok ? 'ok' : 'failed'
}

function parseEnvValue(rawValue) {
  const singleQuoted = rawValue.startsWith("'") && rawValue.endsWith("'")
  const doubleQuoted = rawValue.startsWith('"') && rawValue.endsWith('"')

  if (singleQuoted || doubleQuoted) {
    return rawValue.slice(1, -1)
  }

  return rawValue
}

function requiresAuthToken(url) {
  return !url.startsWith('file:') && url !== ':memory:'
}

function splitSqlStatements(sql) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}
