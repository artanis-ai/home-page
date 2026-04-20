import type { Env } from '../types'

// Structural type so this helper works from routes with or without
// Variables (e.g. auth-protected routes use AuthVars, /t/* does not).
interface LoggingContext {
  env: Env
  req: { header(name: string): string | undefined }
}

export async function logAction(
  c: LoggingContext,
  action: string,
  metadata: Record<string, unknown>
) {
  const timestamp = Date.now()
  const key = `log:${timestamp}:${action}`
  const value = JSON.stringify({
    action,
    timestamp,
    mid: readMid(c),
    ...metadata,
  })

  try {
    await c.env.LOGS.put(key, value, {
      expirationTtl: 60 * 60 * 24 * 90, // 90 days
    })
  } catch (err) {
    console.error('Failed to log action:', err)
  }
}

/**
 * Read the campaign-attribution id set by the SPA's first-touch tracker.
 * Returns null for requests that don't carry it (unauthenticated, public
 * endpoint hits from non-campaign traffic, etc).
 */
export function readMid(c: LoggingContext): string | null {
  const header = c.req.header('X-Mid')
  if (!header) return null
  return /^\d+$/.test(header) ? header : null
}
