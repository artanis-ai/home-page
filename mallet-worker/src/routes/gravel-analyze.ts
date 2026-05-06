/**
 * Gravel-authenticated prompt-analysis endpoint.
 *
 * Powers Gravel's control plane (`gravel-cloud/apps/control-plane/app/api/
 * analyze/route.ts`), which proxies customer prompts to Mallet on behalf of
 * authenticated Gravel orgs. The control plane runs on Vercel, so all
 * proxied traffic shares Vercel's IP pool — we exhaust the public
 * endpoint's IP-rate-limit almost immediately. This route fixes that:
 *
 *   - A shared bearer token (`GRAVEL_FORWARD_TOKEN`, set on both ends)
 *     gates the route. The control plane is the only client.
 *   - Rate limit is keyed by `X-Gravel-Org` (the Clerk org id) instead of
 *     IP, so each Gravel customer org gets its own bucket.
 *
 * Logic and response shape are otherwise identical to `/api/public/analyze`
 * (whole-prompt input, server-side segment, fan-out to OpenAI). Same
 * privacy posture: NO prompt text or issue messages in logs.
 *
 * The token is compared in constant time to defeat timing oracles. If the
 * env var is missing on the worker the route fails closed (500-ish 401)
 * rather than accepting any token — guards against a misdeployment
 * silently turning the endpoint into a public proxy.
 */
import { Hono } from 'hono'
import { analyzePrompt } from '../lib/analyzer'
import { segmentPrompt } from '../lib/segmenter'
import { logAction } from '../lib/logging'
import { checkRateLimit } from '../lib/rate-limit'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

const MAX_PROMPT_CHARS = 20_000
const DEFAULT_RPM = 5
const RATE_WINDOW_MS = 60_000

interface GravelAnalyzeRequest {
  prompt?: unknown
  org_id?: unknown
}

/**
 * Length-safe constant-time string compare. Returns false immediately on
 * length mismatch (the lengths themselves aren't secret here — both sides
 * are 64-hex tokens), then XOR-folds every byte so the runtime doesn't
 * depend on the position of the first differing byte.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

app.post('/', async (c) => {
  const start = Date.now()

  // Auth gate. Fail closed if the secret isn't configured — refusing
  // every request is safer than degrading to "any bearer accepted".
  const expected = c.env.GRAVEL_FORWARD_TOKEN
  if (!expected) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const authHeader = c.req.header('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const presented = authHeader.slice('Bearer '.length)
  if (!constantTimeEqual(presented, expected)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  let body: GravelAnalyzeRequest
  try {
    body = await c.req.json<GravelAnalyzeRequest>()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const prompt = body.prompt
  if (typeof prompt !== 'string') {
    return c.json({ error: 'Missing or invalid "prompt" field (must be a string)' }, 400)
  }

  // org_id may come in the body OR via the X-Gravel-Org header. The header
  // is the canonical channel (the control plane sets it on every request)
  // but accepting the body field too keeps callers honest if they prefer
  // not to add a custom header. Header wins on conflict.
  const headerOrg = c.req.header('X-Gravel-Org')?.trim() || ''
  const bodyOrg = typeof body.org_id === 'string' ? body.org_id.trim() : ''
  const orgId = headerOrg || bodyOrg || 'unknown'

  // Per-org rate limit. Runs BEFORE the empty/oversize prompt branches so
  // a caller can't spam either the fast-path or the size-rejection path
  // with no consequences. Configurable via GRAVEL_ANALYZE_RPM (string at
  // runtime — coerce + bounds-check). Defaults to 5/min so a misbehaving
  // org can't burn the OpenAI budget.
  const configuredRpm = Number(c.env.GRAVEL_ANALYZE_RPM)
  const rpm =
    Number.isFinite(configuredRpm) && configuredRpm > 0
      ? Math.floor(configuredRpm)
      : DEFAULT_RPM
  const route = new URL(c.req.url).pathname
  const rl = checkRateLimit({
    key: `gravel:${orgId}:${route}`,
    limit: rpm,
    windowMs: RATE_WINDOW_MS,
  })
  c.header('X-RateLimit-Limit', String(rpm))
  c.header('X-RateLimit-Remaining', String(rl.remaining))
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfterSec))
    return c.json(
      { error: 'Rate limit exceeded', retryAfterSec: rl.retryAfterSec },
      429
    )
  }

  if (prompt.trim().length === 0) {
    return c.json({ issues: [], usage: { inputTokens: 0, outputTokens: 0, tasks: 0 } })
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return c.json(
      { error: `Prompt exceeds maximum length of ${MAX_PROMPT_CHARS} characters`, limit: MAX_PROMPT_CHARS, received: prompt.length },
      413
    )
  }

  const segments = segmentPrompt(prompt)
  if (segments.length === 0) {
    return c.json({ issues: [], usage: { inputTokens: 0, outputTokens: 0, tasks: 0 } })
  }

  const { issues, usage } = await analyzePrompt({
    segments,
    openaiKey: c.env.OPENAI_API_KEY,
  })

  const elapsed = Date.now() - start

  // Telemetry only — NO prompt text, NO issue messages. org_id is logged
  // because it identifies the customer (already known to us via Gravel
  // billing) and unblocks per-org spend dashboards.
  await logAction(c, 'gravel-analyze', {
    orgId,
    promptChars: prompt.length,
    segmentCount: segments.length,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    tasks: usage.tasks,
    issueCount: issues.length,
    elapsedMs: elapsed,
  })

  return c.json({ issues, usage })
})

export default app
