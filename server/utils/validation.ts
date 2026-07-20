import type { H3Event } from 'h3'
import { z, type ZodType } from 'zod'

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
    body = await readBody<unknown>(event)
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Request body must be valid JSON.',
    })
  }

  return validateRequestData(schema, body)
}

export function validateQuery<Schema extends ZodType>(
  event: H3Event,
  schema: Schema,
): z.output<Schema> {
  return validateRequestData(schema, getQuery(event))
}

export function validateRouteParams<Schema extends ZodType>(
  event: H3Event,
  schema: Schema,
): z.output<Schema> {
  return validateRequestData(schema, getRouterParams(event))
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
