import {
  createClient,
  type Client,
  type Transaction,
} from '@libsql/client'
import type { H3Event } from 'h3'

let client: Client | undefined
let clientUrl: string | undefined
let clientAuthToken: string | undefined

/**
 * Returns the shared, server-only libSQL client for this Nitro instance.
 *
 * Credentials are read from private runtime config or the server process. They
 * are deliberately never returned from this module or copied to public config.
 */
export function getDatabaseClient(event?: H3Event): Client {
  const { url, authToken } = getDatabaseCredentials(event)

  if (client && clientUrl === url && clientAuthToken === authToken) {
    return client
  }

  client?.close()
  client = createClient({
    url,
    ...(authToken ? { authToken } : {}),
  })
  clientUrl = url
  clientAuthToken = authToken

  return client
}

/**
 * Closes the cached connection. This is primarily useful for tests and local
 * tooling; deployed handlers normally reuse the client for the instance life.
 */
export function closeDatabaseClient(): void {
  client?.close()
  client = undefined
  clientUrl = undefined
  clientAuthToken = undefined
}

function getDatabaseCredentials(event?: H3Event) {
  const runtimeConfig = useRuntimeConfig(event)
  const url = normalizeConfigValue(
    runtimeConfig.tursoDatabaseUrl || process.env.TURSO_DATABASE_URL,
  )
  const authToken = normalizeConfigValue(
    runtimeConfig.tursoAuthToken || process.env.TURSO_AUTH_TOKEN,
  )

  if (!url) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Database configuration is unavailable.',
    })
  }

  if (requiresAuthToken(url) && !authToken) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Database configuration is incomplete.',
    })
  }

  return { url, authToken }
}

function normalizeConfigValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  return value.trim() || undefined
}

function requiresAuthToken(url: string): boolean {
  return !url.startsWith('file:') && url !== ':memory:'
}

export type DatabaseClient = Client
export type DatabaseExecutor = Pick<Client, 'execute'>

/** Runs related writes atomically and always closes/rolls back on failure. */
export async function withDatabaseWriteTransaction<Result>(
  event: H3Event,
  callback: (transaction: Transaction) => Promise<Result>,
): Promise<Result> {
  const transaction = await getDatabaseClient(event).transaction('write')

  try {
    const result = await callback(transaction)
    await transaction.commit()
    return result
  } finally {
    transaction.close()
  }
}
