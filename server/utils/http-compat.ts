import type { H3Event } from 'h3'

/** Reads a request header across Nitro's H3 v1 and H3 v2 event shapes. */
export function getCompatibleRequestHeader(
  event: H3Event,
  name: string,
): string | undefined {
  const compatibleEvent = event as unknown as CompatibleHttpEvent
  const normalizedName = name.toLowerCase()
  const nodeValue = compatibleEvent.node?.req?.headers?.[normalizedName]

  if (Array.isArray(nodeValue)) {
    return nodeValue.join(', ')
  }

  if (typeof nodeValue === 'string') {
    return nodeValue
  }

  return (
    compatibleEvent.web?.request?.headers?.get(name) ??
    compatibleEvent.req?.headers?.get?.(name) ??
    undefined
  )
}

/** Reads and decodes one request cookie without depending on an H3 version. */
export function getCompatibleCookie(
  event: H3Event,
  name: string,
): string | undefined {
  const cookieHeader = getCompatibleRequestHeader(event, 'cookie')

  if (!cookieHeader) {
    return undefined
  }

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')

    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue
    }

    const value = part.slice(separator + 1).trim()

    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  return undefined
}

/** Appends a Set-Cookie header without overwriting the sealed session cookie. */
export function setCompatibleCookie(
  event: H3Event,
  name: string,
  value: string,
  options: CompatibleCookieOptions = {},
): void {
  const attributes = [`${name}=${encodeURIComponent(value)}`]

  if (options.maxAge !== undefined) {
    attributes.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`)
  }

  if (options.expires) {
    attributes.push(`Expires=${options.expires.toUTCString()}`)
  }

  if (options.path) attributes.push(`Path=${options.path}`)
  if (options.httpOnly) attributes.push('HttpOnly')
  if (options.secure) attributes.push('Secure')
  if (options.sameSite) attributes.push(`SameSite=${capitalize(options.sameSite)}`)

  appendCompatibleResponseHeader(event, 'Set-Cookie', attributes.join('; '))
}

export function deleteCompatibleCookie(
  event: H3Event,
  name: string,
  options: CompatibleCookieOptions = {},
): void {
  setCompatibleCookie(event, name, '', {
    ...options,
    maxAge: 0,
    expires: new Date(0),
  })
}

export function getCompatibleRequestPath(event: H3Event): string {
  const compatibleEvent = event as unknown as CompatibleHttpEvent
  const requestUrl =
    compatibleEvent.node?.req?.url ??
    compatibleEvent.web?.request?.url ??
    compatibleEvent.req?.url ??
    '/'

  try {
    return new URL(requestUrl, 'http://localhost').pathname
  } catch {
    return '/'
  }
}

export function isCompatibleHttpsRequest(event: H3Event): boolean {
  const forwardedProtocol = getCompatibleRequestHeader(
    event,
    'x-forwarded-proto',
  )
    ?.split(',')[0]
    ?.trim()
    .toLowerCase()

  if (forwardedProtocol) {
    return forwardedProtocol === 'https'
  }

  const compatibleEvent = event as unknown as CompatibleHttpEvent

  return (
    compatibleEvent.node?.req?.socket?.encrypted === true ||
    compatibleEvent.web?.request?.url?.startsWith('https://') === true ||
    compatibleEvent.req?.url?.startsWith('https://') === true
  )
}

/** Sets a response header across Nitro's H3 v1 and H3 v2 event shapes. */
export function setCompatibleResponseHeader(
  event: H3Event,
  name: string,
  value: string,
): void {
  const compatibleEvent = event as unknown as CompatibleHttpEvent

  if (compatibleEvent.node?.res?.setHeader) {
    compatibleEvent.node.res.setHeader(name, value)
    return
  }

  compatibleEvent.res?.headers?.set(name, value)
}

function appendCompatibleResponseHeader(
  event: H3Event,
  name: string,
  value: string,
): void {
  const compatibleEvent = event as unknown as CompatibleHttpEvent
  const nodeResponse = compatibleEvent.node?.res

  if (nodeResponse?.setHeader) {
    const current = nodeResponse.getHeader?.(name)
    const values = Array.isArray(current)
      ? [...current.map(String), value]
      : current === undefined
        ? [value]
        : [String(current), value]

    nodeResponse.setHeader(name, values)
    return
  }

  compatibleEvent.res?.headers?.append(name, value)
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

/** Sets a response status across Nitro's H3 v1 and H3 v2 event shapes. */
export function setCompatibleResponseStatus(
  event: H3Event,
  statusCode: number,
): void {
  const compatibleEvent = event as unknown as CompatibleHttpEvent

  if (compatibleEvent.node?.res) {
    compatibleEvent.node.res.statusCode = statusCode
    return
  }

  if (compatibleEvent.res) {
    compatibleEvent.res.status = statusCode
  }
}

interface CompatibleHttpEvent {
  node?: {
    req?: {
      headers?: Record<string, string | string[] | undefined>
      socket?: { encrypted?: boolean }
      url?: string
    }
    res?: {
      getHeader?(name: string): string | number | string[] | undefined
      statusCode: number
      setHeader(name: string, value: string | string[]): void
    }
  }
  req?: {
    headers?: { get?(name: string): string | null }
    url?: string
  }
  res?: {
    headers?: Headers
    status: number
  }
  web?: {
    request?: {
      headers?: Headers
      url?: string
    }
  }
}

interface CompatibleCookieOptions {
  expires?: Date
  httpOnly?: boolean
  maxAge?: number
  path?: string
  sameSite?: 'lax' | 'strict' | 'none'
  secure?: boolean
}
