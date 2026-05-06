/**
 * Integration tests for the Gravel-authenticated `/api/gravel/analyze`
 * endpoint that backs `gravel-cloud/apps/control-plane/app/api/analyze`.
 *
 * Runs against a live `wrangler dev` on :8787 (mirrors public-analyze.test.ts).
 * The `.dev.vars` file declares GRAVEL_FORWARD_TOKEN matching FORWARD_TOKEN
 * below — keep them in sync if you ever rotate the dev token. The critical
 * invariants here are security-oriented:
 *
 *   - Bearer token check is REQUIRED (this is not a public endpoint;
 *     missing/wrong token must 401, never reach OpenAI)
 *   - Input validation rejects malformed/oversized bodies BEFORE OpenAI
 *   - Rate limit is per-org (X-Gravel-Org), not per-IP — that's the whole
 *     reason this route exists separately from /api/public/analyze
 *   - The successful response shape matches the public endpoint exactly so
 *     the control plane proxy stays a transparent passthrough
 */
import { describe, it, expect, beforeEach } from 'vitest'

const WORKER_URL = 'http://localhost:8787'
const GRAVEL_URL = `${WORKER_URL}/api/gravel/analyze`

// Must match GRAVEL_FORWARD_TOKEN in .dev.vars. Hardcoded because tests run
// against the live worker — no DI here.
const FORWARD_TOKEN = '844a3b4307ce6c0393270669b90b6a6d194c2caa77b8e9105ae9a78629b32467'

interface AnalyzeResponse {
  issues: Array<{ type: string; range: [number, number]; message: string }>
  usage: { inputTokens: number; outputTokens: number; tasks: number }
}

/**
 * Each test gets a fresh org id so the per-isolate rate-limit bucket from
 * an unrelated test doesn't bleed in (e.g. the dedicated rate-limit test
 * exhausts a bucket, then the validation tests fail with 429 instead of
 * 400/413). For the rate-limit assertion specifically we want a STABLE id
 * within that one test.
 */
function freshOrg(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
}

function authedHeaders(extra: Record<string, string> = {}) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${FORWARD_TOKEN}`,
    ...extra,
  }
}

describe('gravel analyze API — auth gate', () => {
  it('rejects requests with no Authorization header (401)', async () => {
    const res = await fetch(GRAVEL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    })
    expect(res.status).toBe(401)
  }, 5000)

  it('rejects requests with a non-Bearer Authorization scheme (401)', async () => {
    const res = await fetch(GRAVEL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${FORWARD_TOKEN}`,
      },
      body: JSON.stringify({ prompt: 'hello' }),
    })
    expect(res.status).toBe(401)
  }, 5000)

  it('rejects a wrong bearer token (401)', async () => {
    const res = await fetch(GRAVEL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer not_the_real_token',
      },
      body: JSON.stringify({ prompt: 'hello' }),
    })
    expect(res.status).toBe(401)
  }, 5000)

  it('rejects a token of correct length but wrong contents (401)', async () => {
    // Same length as the real token (64 hex chars) — guards against any
    // accidental short-circuit on length match alone.
    const fake = 'f'.repeat(FORWARD_TOKEN.length)
    const res = await fetch(GRAVEL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fake}`,
      },
      body: JSON.stringify({ prompt: 'hello' }),
    })
    expect(res.status).toBe(401)
  }, 5000)
})

describe('gravel analyze API — input validation', () => {
  it('rejects missing prompt field with 400', async () => {
    const res = await fetch(GRAVEL_URL, {
      method: 'POST',
      headers: authedHeaders({ 'X-Gravel-Org': freshOrg('val') }),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  }, 5000)

  it('rejects non-string prompt field with 400', async () => {
    const res = await fetch(GRAVEL_URL, {
      method: 'POST',
      headers: authedHeaders({ 'X-Gravel-Org': freshOrg('val') }),
      body: JSON.stringify({ prompt: { not: 'a string' } }),
    })
    expect(res.status).toBe(400)
  }, 5000)

  it('rejects invalid JSON body with 400', async () => {
    const res = await fetch(GRAVEL_URL, {
      method: 'POST',
      headers: authedHeaders({ 'X-Gravel-Org': freshOrg('val') }),
      body: '{not-json',
    })
    expect(res.status).toBe(400)
  }, 5000)

  it('rejects prompts over 20k chars with 413 (prevents OpenAI budget burn)', async () => {
    const tooLong = 'x'.repeat(20_001)
    const res = await fetch(GRAVEL_URL, {
      method: 'POST',
      headers: authedHeaders({ 'X-Gravel-Org': freshOrg('val') }),
      body: JSON.stringify({ prompt: tooLong }),
    })
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: string; limit: number }
    expect(body.limit).toBe(20_000)
  }, 5000)

  it('returns empty issues for empty prompt (fast path, no OpenAI call)', async () => {
    const start = Date.now()
    const res = await fetch(GRAVEL_URL, {
      method: 'POST',
      headers: authedHeaders({ 'X-Gravel-Org': freshOrg('val') }),
      body: JSON.stringify({ prompt: '   \n\t ' }),
    })
    expect(res.ok).toBe(true)
    const body = (await res.json()) as AnalyzeResponse
    expect(body.issues).toEqual([])
    expect(body.usage.tasks).toBe(0)
    expect(Date.now() - start).toBeLessThan(1000)
  }, 5000)
})

describe('gravel analyze API — analysis', () => {
  it('returns issues + usage with the same shape as /api/public/analyze', async () => {
    const res = await fetch(GRAVEL_URL, {
      method: 'POST',
      headers: authedHeaders({ 'X-Gravel-Org': freshOrg('ok') }),
      body: JSON.stringify({ prompt: 'Be brief. Give long detailed answers.' }),
    })
    expect(res.ok).toBe(true)
    const body = (await res.json()) as AnalyzeResponse
    expect(body.issues.length).toBeGreaterThanOrEqual(1)
    expect(body.issues.some((i) => i.type === 'contradiction')).toBe(true)
    expect(body.usage).toBeDefined()
    expect(typeof body.usage.inputTokens).toBe('number')
    expect(typeof body.usage.outputTokens).toBe('number')
    expect(typeof body.usage.tasks).toBe('number')
    expect(body.usage.inputTokens).toBeGreaterThan(0)
    expect(body.usage.tasks).toBeGreaterThan(0)
  }, 30_000)

  it('accepts org_id in the body when no X-Gravel-Org header is sent', async () => {
    const res = await fetch(GRAVEL_URL, {
      method: 'POST',
      headers: authedHeaders(),
      body: JSON.stringify({ prompt: 'You are a helpful assistant.', org_id: freshOrg('body') }),
    })
    expect(res.status).not.toBe(400)
    expect(res.status).not.toBe(401)
    expect(res.ok).toBe(true)
  }, 30_000)
})

describe('gravel analyze API — per-org rate limit', () => {
  // Lock to one org id so the bucket accumulates across calls.
  let org: string
  beforeEach(() => {
    org = freshOrg('rl')
  })

  it('limits a single org to GRAVEL_ANALYZE_RPM/min (default 5) and 429s the rest', async () => {
    // Use the empty-prompt fast path so we don't pay OpenAI once per call —
    // rate limiting runs BEFORE the empty-prompt short-circuit (the limit
    // check intentionally sits before segmentation), so this is sufficient.
    const send = () =>
      fetch(GRAVEL_URL, {
        method: 'POST',
        headers: authedHeaders({ 'X-Gravel-Org': org }),
        body: JSON.stringify({ prompt: '   ' }),
      })

    const allowed = []
    for (let i = 0; i < 5; i++) {
      allowed.push(await send())
    }
    for (const r of allowed) {
      expect(r.status).toBe(200)
    }

    const blocked = await send()
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBeTruthy()
    const body = (await blocked.json()) as { error: string; retryAfterSec: number }
    expect(body.error).toMatch(/rate limit/i)
    expect(body.retryAfterSec).toBeGreaterThan(0)
  }, 15_000)

  it('keeps separate buckets per org (one org being throttled does not affect another)', async () => {
    const orgA = freshOrg('rlA')
    const orgB = freshOrg('rlB')
    const send = (o: string) =>
      fetch(GRAVEL_URL, {
        method: 'POST',
        headers: authedHeaders({ 'X-Gravel-Org': o }),
        body: JSON.stringify({ prompt: '   ' }),
      })
    // Burn org A's bucket
    for (let i = 0; i < 5; i++) await send(orgA)
    const blockedA = await send(orgA)
    expect(blockedA.status).toBe(429)

    // Org B should still be fine
    const okB = await send(orgB)
    expect(okB.status).toBe(200)
  }, 15_000)
})
