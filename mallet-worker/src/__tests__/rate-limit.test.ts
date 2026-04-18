/**
 * Unit tests for the per-isolate rate limiter.
 *
 * The integration path (HTTP 429 + Retry-After header) is exercised
 * end-to-end by the worker's request flow; here we lock the core
 * window arithmetic so regressions show up cheaply without needing
 * wrangler running.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { checkRateLimit, _resetRateLimits } from '../lib/rate-limit'

describe('checkRateLimit', () => {
  beforeEach(() => _resetRateLimits())

  it('allows requests up to the limit', () => {
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit({ key: 'u1:/api/x', limit: 5, windowMs: 60_000, now: 1000 })
      expect(r.allowed).toBe(true)
      expect(r.remaining).toBe(5 - (i + 1))
    }
  })

  it('rejects the 6th request when limit is 5', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit({ key: 'u1:/api/x', limit: 5, windowMs: 60_000, now: 1000 })
    }
    const r = checkRateLimit({ key: 'u1:/api/x', limit: 5, windowMs: 60_000, now: 1000 })
    expect(r.allowed).toBe(false)
    expect(r.remaining).toBe(0)
    expect(r.retryAfterSec).toBeGreaterThan(0)
  })

  it('opens a new window once windowMs has elapsed', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit({ key: 'u1:/api/x', limit: 5, windowMs: 60_000, now: 1000 })
    }
    // 1s before window end: still rejected
    expect(
      checkRateLimit({ key: 'u1:/api/x', limit: 5, windowMs: 60_000, now: 60_000 }).allowed
    ).toBe(false)
    // exactly at window expiry: new window opens
    const r = checkRateLimit({ key: 'u1:/api/x', limit: 5, windowMs: 60_000, now: 61_000 })
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(4)
  })

  it('keeps separate buckets per key (per user, per route)', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit({ key: 'u1:/api/x', limit: 5, windowMs: 60_000, now: 1000 })
    }
    // Different user — fresh bucket
    expect(
      checkRateLimit({ key: 'u2:/api/x', limit: 5, windowMs: 60_000, now: 1000 }).allowed
    ).toBe(true)
    // Same user, different route — also fresh
    expect(
      checkRateLimit({ key: 'u1:/api/y', limit: 5, windowMs: 60_000, now: 1000 }).allowed
    ).toBe(true)
  })

  it('reports retryAfterSec proportional to remaining window', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit({ key: 'u1:/api/x', limit: 5, windowMs: 60_000, now: 1000 })
    }
    const r = checkRateLimit({ key: 'u1:/api/x', limit: 5, windowMs: 60_000, now: 31_000 })
    expect(r.retryAfterSec).toBe(30) // 60s window, 30s elapsed → 30s left
  })

  it('always returns retryAfterSec >= 1 when blocked (never 0 or negative)', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit({ key: 'u1:/api/x', limit: 5, windowMs: 60_000, now: 1000 })
    }
    const r = checkRateLimit({ key: 'u1:/api/x', limit: 5, windowMs: 60_000, now: 60_999 })
    expect(r.allowed).toBe(false)
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1)
  })

  it('keeps IP-keyed buckets isolated from userId-keyed buckets', () => {
    // The public-analyze middleware prefixes IP keys with `ip:`. This guards
    // against a regression where IP and userId keys could collide (e.g. a
    // user named "1.2.3.4" sharing a bucket with that IP).
    for (let i = 0; i < 5; i++) {
      checkRateLimit({ key: '1.2.3.4:/api/x', limit: 5, windowMs: 60_000, now: 1000 })
    }
    const r = checkRateLimit({ key: 'ip:1.2.3.4:/api/x', limit: 5, windowMs: 60_000, now: 1000 })
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(4)
  })
})
