import type { Env } from '../types'

export async function logAction(
  env: Env,
  action: string,
  metadata: Record<string, unknown>
) {
  const timestamp = Date.now()
  const key = `log:${timestamp}:${action}`
  const value = JSON.stringify({
    action,
    timestamp,
    ...metadata,
  })

  try {
    await env.LOGS.put(key, value, {
      expirationTtl: 60 * 60 * 24 * 90, // 90 days
    })
  } catch (err) {
    console.error('Failed to log action:', err)
  }
}
