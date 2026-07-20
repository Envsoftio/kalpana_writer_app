import type { H3Event } from 'h3'
import { z, type ZodType } from 'zod'

// One million Unicode code points can occupy at most four million UTF-8 bytes.
// This stays below common serverless request limits while covering the largest
// source article more than twice over.
const MAX_JSON_BODY_BYTES = 4_500_000

export const entityIdSchema = z.string().trim().min(1).max(128)

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

/** Reads and validates a JSON body without returning submitted values in errors. */
export async function validateBody<Schema extends ZodType>(
  event: H3Event,
  schema: Schema,
): Promise<z.output<Schema>> {
  let body: unknown

  try {
    body = JSON.parse(await readRequestText(event))
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      throw createError({
        statusCode: 413,
        statusMessage: 'Request body is too large.',
      })
    }

    throw createError({
      statusCode: 400,
      statusMessage: 'Request body must be valid JSON.',
    })
  }

  return validateRequestData(schema, body)
}

/**
 * Nitro currently supplies an H3 v1 event while the app dependency can expose
 * H3 v2 helpers. Reading the underlying request keeps JSON handling compatible
 * with both event shapes and enforces a hard limit before parsing.
 */
async function readRequestText(event: H3Event): Promise<string> {
  const compatibleEvent = event as unknown as CompatibleH3Event
  const nodeRequest = compatibleEvent.node?.req

  if (nodeRequest) {
    const contentLength = Number(nodeRequest.headers['content-length'] ?? 0)

    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
      throw new RequestBodyTooLargeError()
    }

    const chunks: Buffer[] = []
    let byteLength = 0

    for await (const chunk of nodeRequest) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      byteLength += buffer.byteLength

      if (byteLength > MAX_JSON_BODY_BYTES) {
        throw new RequestBodyTooLargeError()
      }

      chunks.push(buffer)
    }

    return Buffer.concat(chunks).toString('utf8')
  }

  const webRequest = compatibleEvent.web?.request ?? compatibleEvent.req

  if (!webRequest || typeof webRequest.text !== 'function') {
    throw new TypeError('Unsupported server request.')
  }

  const contentLength = Number(webRequest.headers.get('content-length') ?? 0)

  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw new RequestBodyTooLargeError()
  }

  const text = await webRequest.text()

  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BODY_BYTES) {
    throw new RequestBodyTooLargeError()
  }

  return text
}

export function validateQuery<Schema extends ZodType>(
  event: H3Event,
  schema: Schema,
): z.output<Schema> {
  return validateRequestData(schema, getCompatibleQuery(event))
}

export function validateRouteParams<Schema extends ZodType>(
  event: H3Event,
  schema: Schema,
): z.output<Schema> {
  const params = (event as unknown as { context?: { params?: unknown } })
    .context?.params

  return validateRequestData(schema, params ?? {})
}

export function validateRequestData<Schema extends ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const result = schema.safeParse(value)

  if (result.success) {
    return result.data
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'Request validation failed.',
    data: {
      issues: result.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    },
  })
}

interface CompatibleH3Event {
  node?: {
    req?: NodeJS.ReadableStream & {
      headers: Record<string, string | string[] | undefined>
      url?: string
    }
  }
  web?: { request?: Request }
  req?: Request
}

class RequestBodyTooLargeError extends Error {}

function getCompatibleQuery(event: H3Event): Record<string, string | string[]> {
  const compatibleEvent = event as unknown as CompatibleH3Event
  const rawUrl =
    compatibleEvent.node?.req?.url ?? compatibleEvent.req?.url ?? '/'
  const searchParams = new URL(rawUrl, 'http://localhost').searchParams
  const query: Record<string, string | string[]> = {}

  for (const [key, value] of searchParams) {
    const current = query[key]

    if (current === undefined) {
      query[key] = value
    } else if (Array.isArray(current)) {
      current.push(value)
    } else {
      query[key] = [current, value]
    }
  }

  return query
}
