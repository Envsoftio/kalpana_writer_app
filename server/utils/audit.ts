import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'

const MAX_AUDIT_METADATA_BYTES = 8_000
const MAX_AUDIT_STRING_LENGTH = 500
const MAX_AUDIT_COLLECTION_ITEMS = 50
const MAX_AUDIT_DEPTH = 4
const SENSITIVE_METADATA_KEY =
  /(authorization|body|content|cookie|password|secret|text|token)/i

export interface AuditLogInput {
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown> | null
  userId?: typeof ADMIN_USER_ID
}

export interface AuditLogRecord {
  id: string
  userId: typeof ADMIN_USER_ID
  action: string
  entityType: string
  entityId: string | null
  metadata: string | null
  createdAt: number
}

/** Writes a compact audit event without copying article text or credentials. */
export async function writeAuditLog(
  event: H3Event | undefined,
  input: AuditLogInput,
  database: DatabaseExecutor = getDatabaseClient(event),
): Promise<AuditLogRecord> {
  const record: AuditLogRecord = {
    id: randomUUID(),
    userId: input.userId ?? ADMIN_USER_ID,
    action: validateAuditLabel(input.action, 'action'),
    entityType: validateAuditLabel(input.entityType, 'entity type'),
    entityId: normalizeEntityId(input.entityId),
    metadata: serializeMetadata(input.metadata),
    createdAt: Date.now(),
  }

  await database.execute({
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
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      record.id,
      record.userId,
      record.action,
      record.entityType,
      record.entityId,
      record.metadata,
      record.createdAt,
    ],
  })

  return record
}

function serializeMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) {
    return null
  }

  const serialized = JSON.stringify(sanitizeMetadata(metadata, 0))

  if (Buffer.byteLength(serialized, 'utf8') > MAX_AUDIT_METADATA_BYTES) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Audit metadata exceeds the allowed size.',
    })
  }

  return serialized
}

function sanitizeMetadata(value: unknown, depth: number): unknown {
  if (depth > MAX_AUDIT_DEPTH) {
    return '[truncated]'
  }

  if (value === null || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value)
  }

  if (typeof value === 'string') {
    return value.length <= MAX_AUDIT_STRING_LENGTH
      ? value
      : `${value.slice(0, MAX_AUDIT_STRING_LENGTH)}…`
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_AUDIT_COLLECTION_ITEMS)
      .map((item) => sanitizeMetadata(item, depth + 1))
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .slice(0, MAX_AUDIT_COLLECTION_ITEMS)
      .map(([key, child]) => [
        key,
        SENSITIVE_METADATA_KEY.test(key)
          ? '[redacted]'
          : sanitizeMetadata(child, depth + 1),
      ])

    return Object.fromEntries(entries)
  }

  return String(value)
}

function validateAuditLabel(value: string, label: string): string {
  const normalized = value.trim()

  if (!normalized || normalized.length > 100) {
    throw createError({
      statusCode: 500,
      statusMessage: `Audit ${label} is invalid.`,
    })
  }

  return normalized
}

function normalizeEntityId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const normalized = value.trim()

  if (!normalized || normalized.length > 128) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Audit entity ID is invalid.',
    })
  }

  return normalized
}
