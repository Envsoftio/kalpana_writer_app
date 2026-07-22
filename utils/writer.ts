export function formatWriterDate(value: unknown, withTime = false): string {
  const date = toWriterDate(value)

  if (!date) return 'Unknown'

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(date)
}

export function toWriterDate(value: unknown): Date | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? null : date
}

export function isDeleted(value: unknown): boolean {
  return value === true || value === 1 || value === '1'
}

export function countWords(value: string): number {
  const normalized = value.trim()
  return normalized ? normalized.split(/\s+/u).length : 0
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback

  const response = error as {
    data?: { statusMessage?: string; message?: string }
    statusMessage?: string
    message?: string
  }

  return (
    response.data?.statusMessage ||
    response.data?.message ||
    response.statusMessage ||
    response.message ||
    fallback
  )
}

export function apiErrorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null

  const response = error as {
    status?: unknown
    statusCode?: unknown
    response?: { status?: unknown }
    data?: { status?: unknown; statusCode?: unknown }
  }
  const candidates = [
    response.statusCode,
    response.status,
    response.response?.status,
    response.data?.statusCode,
    response.data?.status,
  ]

  for (const candidate of candidates) {
    const statusCode = Number(candidate)
    if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599)
      return statusCode
  }

  return null
}

/** Reads a JSON preference without letting unavailable/corrupt storage break UI. */
export function readWriterPreference(key: string): unknown {
  if (!import.meta.client) return undefined

  try {
    const stored = window.localStorage.getItem(key)
    return stored === null ? undefined : JSON.parse(stored)
  } catch {
    return undefined
  }
}

/** Persists non-sensitive UI preferences in this browser. */
export function writeWriterPreference(key: string, value: unknown): void {
  if (!import.meta.client) return

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage may be unavailable in private or locked-down browser contexts.
  }
}

export function clearWriterPreference(key: string): void {
  if (!import.meta.client) return

  try {
    window.localStorage.removeItem(key)
  } catch {
    // Keep navigation working even when browser storage is unavailable.
  }
}
