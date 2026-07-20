import { parseArgs } from 'node:util'
import {
  appTables,
  closeDatabaseClient,
  countTableRows,
  createDatabaseClient,
  formatStatus,
  fullSourceTableCounts,
  keyTableCounts,
  listDatabaseTables,
  loadDotEnv,
  writerTables,
} from './db-common.mjs'

const { values } = parseArgs({
  options: {
    'database-url': { type: 'string' },
    'auth-token': { type: 'string' },
    'env-file': { type: 'string', default: '.env' },
    'skip-app-tables': { type: 'boolean', default: false },
    'full-counts': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
})

loadDotEnv(values['env-file'])

const client = createDatabaseClient({
  url: values['database-url'],
  authToken: values['auth-token'],
})

const checks = []
let actualTables = []

try {
  actualTables = await listDatabaseTables(client)
  const expectedTables = values['skip-app-tables']
    ? writerTables
    : [...writerTables, ...appTables]
  const expectedTableSet = new Set(expectedTables)
  const missingTables = expectedTables.filter(
    (tableName) => !actualTables.includes(tableName),
  )
  const unexpectedTables = actualTables.filter(
    (tableName) => !expectedTableSet.has(tableName),
  )

  checks.push({
    name: 'table list',
    ok: missingTables.length === 0 && unexpectedTables.length === 0,
    details: {
      expected: expectedTables,
      actual: actualTables,
      missing: missingTables,
      unexpected: unexpectedTables,
    },
  })

  const countExpectations = values['full-counts']
    ? fullSourceTableCounts
    : keyTableCounts

  for (const [tableName, expectedCount] of Object.entries(countExpectations)) {
    if (!actualTables.includes(tableName)) {
      checks.push({
        name: `${tableName} row count`,
        ok: false,
        details: {
          expected: expectedCount,
          actual: null,
          error: `Table ${tableName} is missing from the database.`,
        },
      })
      continue
    }

    let actualCount = null
    let countError = null

    try {
      actualCount = await countTableRows(client, tableName)
    } catch (error) {
      countError = serializeError(error)
    }

    checks.push({
      name: `${tableName} row count`,
      ok: countError === null && actualCount === expectedCount,
      details: {
        expected: expectedCount,
        actual: actualCount,
        error: countError,
      },
    })
  }
} catch (error) {
  checks.push({
    name: 'database connection',
    ok: false,
    details: serializeError(error),
  })
} finally {
  await closeDatabaseClient(client)
}

const failedChecks = checks.filter((check) => !check.ok)

if (values.json) {
  console.log(
    JSON.stringify({ ok: failedChecks.length === 0, checks }, null, 2),
  )
} else {
  for (const check of checks) {
    console.log(`${formatStatus(check.ok)} - ${check.name}`)

    if (!check.ok) {
      console.log(JSON.stringify(check.details, null, 2))
    }
  }
}

if (failedChecks.length > 0) {
  process.exitCode = 1
}

function serializeError(error) {
  return {
    message: error?.message || String(error),
    code: error?.code,
    status: error?.cause?.status,
  }
}
