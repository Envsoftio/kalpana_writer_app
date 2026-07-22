import { parseArgs } from 'node:util'
import {
  closeDatabaseClient,
  createDatabaseClient,
  executeSqlFile,
  loadDotEnv,
} from './db-common.mjs'

const { values } = parseArgs({
  options: {
    'database-url': { type: 'string' },
    'auth-token': { type: 'string' },
    'env-file': { type: 'string', default: '.env' },
  },
})

loadDotEnv(values['env-file'])

const client = createDatabaseClient({
  url: values['database-url'],
  authToken: values['auth-token'],
})

try {
  const statements = await executeSqlFile(client, 'db/performance-indexes.sql')

  console.log(`Applied ${statements} idempotent performance indexes.`)
} finally {
  await closeDatabaseClient(client)
}
