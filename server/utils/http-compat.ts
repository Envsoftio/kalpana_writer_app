import type { H3Event } from 'h3'

/** Sets a response header across Nitro's H3 v1 and H3 v2 event shapes. */
export function setCompatibleResponseHeader(
  event: H3Event,
  name: string,
  value: string,
): void {
  const compatibleEvent = event as unknown as CompatibleResponseEvent

  if (compatibleEvent.node?.res?.setHeader) {
    compatibleEvent.node.res.setHeader(name, value)
    return
  }

  compatibleEvent.res?.headers?.set(name, value)
}

/** Sets a response status across Nitro's H3 v1 and H3 v2 event shapes. */
export function setCompatibleResponseStatus(
  event: H3Event,
  statusCode: number,
): void {
  const compatibleEvent = event as unknown as CompatibleResponseEvent

  if (compatibleEvent.node?.res) {
    compatibleEvent.node.res.statusCode = statusCode
    return
  }

  if (compatibleEvent.res) {
    compatibleEvent.res.status = statusCode
  }
}

interface CompatibleResponseEvent {
  node?: {
    res?: {
      statusCode: number
      setHeader(name: string, value: string): void
    }
  }
  res?: {
    headers?: Headers
    status: number
  }
}
