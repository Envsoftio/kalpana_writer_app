import type { H3Event } from 'h3'
import type { AdminSession } from './auth'

type ProtectedRouteHandler<Response> = (
  event: H3Event,
  session: AdminSession,
) => Response | Promise<Response>

/**
 * Defines an API handler that cannot run until a valid admin session exists.
 */
export function defineProtectedEventHandler<Response>(
  handler: ProtectedRouteHandler<Response>,
) {
  return defineEventHandler(async (event) => {
    const session = await requireAdminSession(event)

    return handler(event, session)
  })
}
