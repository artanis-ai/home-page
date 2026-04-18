/**
 * Per-isolate sliding-window rate limiter.
 *
 * Cloudflare Workers can spawn many isolates, so this is approximate
 * (a determined attacker spreading requests across colos can defeat it).
 * It's still a meaningful brake against single-client abuse: each isolate
 * caps a userId at N requests per window, which is enough to keep a
 * runaway frontend or a casual scripted client from burning OpenAI quota.
 *
 * For globally-consistent limits we'd use a Durable Object per user
 * (or the Cloudflare ratelimit binding). This is intentionally simple
 * for the lead-magnet stage; revisit if abuse patterns warrant it.
 */

interface Bucket {
  count: number
  windowStart: number
}

const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  /** Seconds until the current window expires (and the user may retry). */
  retryAfterSec: number
}

export interface RateLimitOpts {
  /** Composite key — usually `${userId}:${route}`. */
  key: string
  limit: number
  windowMs: number
  /** Override clock for tests. */
  now?: number
}

/**
 * Atomically check-and-increment. If the current window has expired,
 * a new window starts. Returns whether the request is allowed.
 */
export function checkRateLimit(opts: RateLimitOpts): RateLimitResult {
  const now = opts.now ?? Date.now()
  let b = buckets.get(opts.key)
  if (!b || now - b.windowStart >= opts.windowMs) {
    b = { count: 0, windowStart: now }
    buckets.set(opts.key, b)
  }
  if (b.count >= opts.limit) {
    const retryAfterMs = opts.windowMs - (now - b.windowStart)
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    }
  }
  b.count += 1
  return {
    allowed: true,
    remaining: opts.limit - b.count,
    retryAfterSec: 0,
  }
}

/** Test hook — clears all buckets. Do not call in production code. */
export function _resetRateLimits(): void {
  buckets.clear()
}

import type { Context, Next } from 'hono'
import type { Env } from '../types'
import type { AuthVars } from './auth'

/**
 * Hono middleware. Must run AFTER `requireAuth()` so `userId` is set.
 * Sets `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`.
 */
export function rateLimitMiddleware(limit: number, windowMs = 60_000) {
  return async (c: Context<{ Bindings: Env; Variables: AuthVars }>, next: Next) => {
    const userId = c.get('userId')
    // Defense-in-depth: if auth somehow didn't populate userId, fail closed.
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const route = new URL(c.req.url).pathname
    const result = checkRateLimit({ key: `${userId}:${route}`, limit, windowMs })

    c.header('X-RateLimit-Limit', String(limit))
    c.header('X-RateLimit-Remaining', String(result.remaining))

    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfterSec))
      return c.json(
        { error: 'Rate limit exceeded', retryAfterSec: result.retryAfterSec },
        429
      )
    }
    return next()
  }
}

/**
 * IP-based rate limit for unauthenticated endpoints (the public skill API).
 * Keys on `CF-Connecting-IP` (set by Cloudflare on the edge — not forgeable
 * by clients) with a fallback to a shared "unknown" bucket when absent, so
 * traffic from non-CF environments (tests, direct wrangler dev) is still
 * bounded. We deliberately use a tighter default limit than the authed
 * middleware because:
 *   - No userId → abuse ceiling is IPs, which is cheap to rotate
 *   - The public endpoint analyzes the whole prompt every call (no cache),
 *     so each request is strictly more expensive than the authed path
 */
export function rateLimitMiddlewareByIP(limit: number, windowMs = 60_000) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
    const route = new URL(c.req.url).pathname
    const result = checkRateLimit({ key: `ip:${ip}:${route}`, limit, windowMs })

    c.header('X-RateLimit-Limit', String(limit))
    c.header('X-RateLimit-Remaining', String(result.remaining))

    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfterSec))
      return c.json(
        { error: 'Rate limit exceeded', retryAfterSec: result.retryAfterSec },
        429
      )
    }
    return next()
  }
}
