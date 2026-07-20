import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import bcrypt from 'bcryptjs'
import {
  closeDatabaseClient,
  createDatabaseClient,
  executeSqlFile,
  loadDotEnv,
} from './db-common.mjs'

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    password: { type: 'string' },
    'database-url': { type: 'string' },
    'auth-token': { type: 'string' },
    'env-file': { type: 'string', default: '.env' },
  },
})

loadDotEnv(values['env-file'])

const email = normalizeEmail(values.email || process.env.ADMIN_EMAIL)
const name = normalizeOptionalText(values.name || process.env.ADMIN_NAME)
const password = await resolveAdminPassword(values.password)

validateAdminEmail(email)
validateAdminPassword(password)

const client = createDatabaseClient({
  url: values['database-url'],
  authToken: values['auth-token'],
})

try {
  const schemaStatements = await executeSqlFile(client, 'db/app-schema.sql')
  const now = Date.now()
  const passwordHash = await bcrypt.hash(password, 12)

  await client.execute({
    sql: `
      INSERT INTO app_user (
        id,
        email,
        password_hash,
        name,
        password_updated_at,
        created_at,
        updated_at,
        deleted
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        password_hash = excluded.password_hash,
        name = excluded.name,
        password_updated_at = excluded.password_updated_at,
        failed_login_count = 0,
        locked_until = NULL,
        updated_at = excluded.updated_at,
        deleted = 0
    `,
    args: ['admin', email, passwordHash, name, now, now, now],
  })

  await client.execute({
    sql: `
      INSERT INTO app_audit_log (
        id,
        user_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
      )
      VALUES (?, 'admin', 'admin_setup', 'app_user', 'admin', ?, ?)
    `,
    args: [randomUUID(), JSON.stringify({ email }), now],
  })

  console.log(`Applied ${schemaStatements} app schema statements.`)
  console.log(`Admin account is ready for ${email}.`)
} finally {
  await closeDatabaseClient(client)
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function normalizeOptionalText(value) {
  const text = String(value || '').trim()
  return text || null
}

async function resolveAdminPassword(cliPassword) {
  if (cliPassword) {
    return cliPassword
  }

  if (process.env.ADMIN_PASSWORD) {
    return process.env.ADMIN_PASSWORD
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      'ADMIN_PASSWORD is required when setup is running without an interactive terminal.',
    )
  }

  const password = await promptHidden('Admin password: ')
  const confirmation = await promptHidden('Confirm admin password: ')

  if (password !== confirmation) {
    throw new Error('Admin passwords did not match.')
  }

  return password
}

function validateAdminEmail(value) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error('ADMIN_EMAIL must be a valid email address.')
  }
}

function validateAdminPassword(value) {
  if (value.length < 12) {
    throw new Error('Admin password must be at least 12 characters long.')
  }
}

function promptHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    const stdout = process.stdout
    let value = ''

    const cleanup = () => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
    }

    const onData = (chunk) => {
      const text = chunk.toString('utf8')

      for (const char of text) {
        if (char === '\u0003') {
          cleanup()
          stdout.write('\n')
          reject(new Error('Password prompt cancelled.'))
          return
        }

        if (char === '\r' || char === '\n' || char === '\u0004') {
          cleanup()
          stdout.write('\n')
          resolve(value)
          return
        }

        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1)
          continue
        }

        value += char
      }
    }

    stdout.write(prompt)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    stdin.on('data', onData)
  })
}
