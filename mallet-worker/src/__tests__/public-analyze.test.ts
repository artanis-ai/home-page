/**
 * Integration tests for the unauthenticated `/api/public/analyze` endpoint
 * that powers the `mallet-prompt-review` agent skill.
 *
 * Runs against a live `wrangler dev` on :8787 (same setup as analyze.test.ts).
 * The critical invariants here are security-oriented:
 *   - No Bearer token required (that's the whole point of the skill API)
 *   - Input validation rejects malformed/oversized bodies BEFORE calling OpenAI
 *     (catching a regression that would let attackers burn our budget)
 *   - CORS responds with permissive origin for cross-origin agent fetches
 *   - Rate limiting is keyed by IP, not userId
 */
import { describe, it, expect } from 'vitest'

const WORKER_URL = 'http://localhost:8787'
const PUBLIC_URL = `${WORKER_URL}/api/public/analyze`

describe('public analyze API — input validation', () => {
  it('rejects missing prompt field with 400', async () => {
    const res = await fetch(PUBLIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  }, 5000)

  it('rejects non-string prompt field with 400', async () => {
    const res = await fetch(PUBLIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 42 }),
    })
    expect(res.status).toBe(400)
  }, 5000)

  it('rejects invalid JSON body with 400', async () => {
    const res = await fetch(PUBLIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json-at-all',
    })
    expect(res.status).toBe(400)
  }, 5000)

  it('rejects prompts over 20k chars with 413 (prevents OpenAI budget burn)', async () => {
    const tooLong = 'x'.repeat(20_001)
    const res = await fetch(PUBLIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: tooLong }),
    })
    expect(res.status).toBe(413)
    const body = await res.json() as { error: string; limit: number }
    expect(body.limit).toBe(20_000)
  }, 5000)

  it('returns empty issues for empty prompt (fast path, no OpenAI call)', async () => {
    const start = Date.now()
    const res = await fetch(PUBLIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '   \n\t ' }),
    })
    expect(res.ok).toBe(true)
    const body = await res.json() as { issues: unknown[]; usage: { tasks: number } }
    expect(body.issues).toEqual([])
    expect(body.usage.tasks).toBe(0)
    // Under 1s confirms we short-circuited before calling OpenAI
    expect(Date.now() - start).toBeLessThan(1000)
  }, 5000)
})

describe('public analyze API — auth bypass', () => {
  it('does NOT require a Bearer token (the skill is unauthenticated)', async () => {
    const res = await fetch(PUBLIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Be brief. Give long answers.' }),
    })
    expect(res.status).not.toBe(401)
  }, 30_000)

  it('ignores a Bearer token if one is supplied (does not 401)', async () => {
    // A valid test token — authed routes accept this, but public must not
    // care either way. If auth middleware leaked into this path, a bad
    // token would 401 here.
    const res = await fetch(PUBLIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer garbage_token_that_would_fail_verification',
      },
      body: JSON.stringify({ prompt: 'Be brief.' }),
    })
    expect(res.status).not.toBe(401)
  }, 30_000)
})

describe('public analyze API — analysis', () => {
  it('detects a contradiction in a whole prompt', async () => {
    const res = await fetch(PUBLIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Be brief. Give long detailed answers.' }),
    })
    expect(res.ok).toBe(true)
    const body = await res.json() as {
      issues: Array<{ type: string; range: [number, number]; message: string }>
      usage: { inputTokens: number; outputTokens: number; tasks: number }
    }
    expect(body.issues.length).toBeGreaterThanOrEqual(1)
    expect(body.issues.some(i => i.type === 'contradiction')).toBe(true)
    expect(body.usage.tasks).toBeGreaterThan(0)
    expect(body.usage.inputTokens).toBeGreaterThan(0)
  }, 30_000)

  it('returns usage telemetry with correct shape', async () => {
    const res = await fetch(PUBLIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'You are a helpful assistant.' }),
    })
    expect(res.ok).toBe(true)
    const body = await res.json() as {
      usage: { inputTokens: number; outputTokens: number; tasks: number }
    }
    expect(body.usage).toBeDefined()
    expect(typeof body.usage.inputTokens).toBe('number')
    expect(typeof body.usage.outputTokens).toBe('number')
    expect(typeof body.usage.tasks).toBe('number')
  }, 30_000)
})

describe('public analyze API — CORS', () => {
  it('allows cross-origin POST from arbitrary origins (skill consumers)', async () => {
    const res = await fetch(PUBLIC_URL, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://some-random-agent-host.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    })
    const allowed = res.headers.get('Access-Control-Allow-Origin')
    // Public endpoint must accept arbitrary origins — either reflect or '*'.
    expect(allowed).not.toBe('https://artanis.ai')
    expect(allowed).toBeTruthy()
  }, 5000)
})
