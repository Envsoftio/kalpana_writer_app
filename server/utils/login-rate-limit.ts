import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'

const WINDOW_MS = 15 * 60 * 1_000
const MAX_FAILURES_PER_IP = 20
const MAX_FAILURES_PER_EMAIL = 8
const MAX_TRACKED_KEYS = 10_000
const PRUNE_INTERVAL = 100

interface RateLimitEntry {
  failures: number
  resetAt: number
}

const failuresByIp = new Map<string, RateLimitEntry>()
const failuresByEmail = new Map<string, RateLimitEntry>()
let operationCount = 0

export interface LoginRateLimitIdentity {
  ip: string
  emailKey: string
}

/** Builds non-sensitive, instance-local keys for throttling password guesses. */
export function getLoginRateLimitIdentity(
  event: H3Event,
  normalizedEmail: string,
): LoginRateLimitIdentity {
  return {
    ip: getCompatibleRequestIp(event),
    emailKey: createHash('sha256').update(normalizedEmail).digest('hex'),
  }
}

export function assertLoginRateLimit(
  event: H3Event,
  identity: LoginRateLimitIdentity,
): void {
  const now = Date.now()
  maybePrune(now)
  const ipEntry = getCurrentEntry(failuresByIp, identity.ip, now)
  const emailEntry = getCurrentEntry(failuresByEmail, identity.emailKey, now)

  if (
    (ipEntry && ipEntry.failures >= MAX_FAILURES_PER_IP) ||
    (emailEntry && emailEntry.failures >= MAX_FAILURES_PER_EMAIL)
  ) {
    const resetAt = Math.max(ipEntry?.resetAt ?? 0, emailEntry?.resetAt ?? 0)
    rejectRateLimited(event, Math.max(1, Math.ceil((resetAt - now) / 1_000)))
  }
}

export function recordLoginFailure(identity: LoginRateLimitIdentity): void {
  const now = Date.now()
  incrementEntry(failuresByIp, identity.ip, now)
  incrementEntry(failuresByEmail, identity.emailKey, now)
}

export function clearLoginFailures(identity: LoginRateLimitIdentity): void {
  failuresByIp.delete(identity.ip)
  failuresByEmail.delete(identity.emailKey)
}

export function rejectDatabaseLockout(
  event: H3Event,
  lockedUntil: number,
): never {
  const retryAfter = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1_000))
  rejectRateLimited(event, retryAfter)
}

function incrementEntry(
  entries: Map<string, RateLimitEntry>,
  key: string,
  now: number,
): void {
  const current = getCurrentEntry(entries, key, now)

  if (current) {
    current.failures += 1
    return
  }

  if (entries.size >= MAX_TRACKED_KEYS) {
    evictOldestEntry(entries)
  }

  entries.set(key, { failures: 1, resetAt: now + WINDOW_MS })
}

function getCurrentEntry(
  entries: Map<string, RateLimitEntry>,
  key: string,
  now: number,
): RateLimitEntry | undefined {
  const entry = entries.get(key)

  if (entry && entry.resetAt <= now) {
    entries.delete(key)
    return undefined
  }

  return entry
}

function maybePrune(now: number): void {
  operationCount += 1

  if (operationCount % PRUNE_INTERVAL !== 0) {
    return
  }

  pruneExpired(failuresByIp, now)
  pruneExpired(failuresByEmail, now)
}

function pruneExpired(entries: Map<string, RateLimitEntry>, now: number): void {
  for (const [key, entry] of entries) {
    if (entry.resetAt <= now) {
      entries.delete(key)
    }
  }
}

function evictOldestEntry(entries: Map<string, RateLimitEntry>): void {
  const oldestKey = entries.keys().next().value

  if (typeof oldestKey === 'string') {
    entries.delete(oldestKey)
  }
}

function rejectRateLimited(event: H3Event, retryAfter: number): never {
  setCompatibleResponseHeader(event, 'Retry-After', String(retryAfter))

  throw createError({
    statusCode: 429,
    statusMessage: 'Too many attempts. Try again later.',
  })
}

function getCompatibleRequestIp(event: H3Event): string {
  const compatibleEvent = event as unknown as CompatibleRequestEvent
  const nodeRequest = compatibleEvent.node?.req

  if (nodeRequest) {
    const forwarded = firstHeaderValue(nodeRequest.headers['x-forwarded-for'])
    const netlifyIp = firstHeaderValue(
      nodeRequest.headers['x-nf-client-connection-ip'],
    )

    return (
      forwarded || netlifyIp || nodeRequest.socket?.remoteAddress || 'unknown'
    )
  }

  const request = compatibleEvent.req
  const forwarded = request?.headers
    .get('x-forwarded-for')
    ?.split(',')[0]
    ?.trim()
  const netlifyIp = request?.headers.get('x-nf-client-connection-ip')?.trim()

  return forwarded || netlifyIp || 'unknown'
}

function firstHeaderValue(value: string | string[] | undefined): string {
  const header = Array.isArray(value) ? value[0] : value
  return header?.split(',')[0]?.trim() || ''
}

interface CompatibleRequestEvent {
  node?: {
    req?: {
      headers: Record<string, string | string[] | undefined>
      socket?: { remoteAddress?: string }
    }
  }
  req?: Request
}
