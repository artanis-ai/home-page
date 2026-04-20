/**
 * Public, unauthenticated prompt-analysis endpoint.
 *
 * Powers the `mallet-prompt-review` agent skill — any agent can POST a
 * full prompt and get back contradiction / ambiguity / best-practice
 * findings using the same core analyzer the authenticated editor uses.
 *
 * Design choices (important — don't change without thinking):
 *   - Input is the WHOLE prompt (simple for agents, matches how they
 *     actually author prompts). The worker segments it server-side
 *     and analyzes every segment / every pair (no incremental cache).
 *   - No storage: we never persist prompt text. `logAction` below only
 *     writes counts/bytes/timings. Issue messages are NOT logged since
 *     they can contain user-supplied text verbatim.
 *   - Size cap (MAX_PROMPT_CHARS): protects the OpenAI budget. The
 *     authed path is implicitly capped by editor UX; here an agent can
 *     and will send very long prompts. Rejecting is kinder than silently
 *     truncating.
 *   - Errors return structured JSON so skill code can handle them without
 *     string-sniffing.
 *
 * The route is wired in `index.ts` OUTSIDE the `/api/*` auth middleware
 * and has its own IP-based rate limiter.
 */
import { Hono } from 'hono'
import { analyzePrompt } from '../lib/analyzer'
import { segmentPrompt } from '../lib/segmenter'
import { logAction } from '../lib/logging'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

// Cap sized to cover realistic system/user prompt pairs (~1000 words
// ≈ 5000 chars) with headroom, while still bounding worst-case OpenAI
// spend per request. Revisit if we see legitimate prompts exceeding this.
const MAX_PROMPT_CHARS = 20_000

interface PublicAnalyzeRequest {
  prompt?: unknown
}

app.post('/', async (c) => {
  const start = Date.now()

  let body: PublicAnalyzeRequest
  try {
    body = await c.req.json<PublicAnalyzeRequest>()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const prompt = body.prompt
  if (typeof prompt !== 'string') {
    return c.json({ error: 'Missing or invalid "prompt" field (must be a string)' }, 400)
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

  // changedHashes omitted → analyzer treats every segment as changed,
  // so every pair + every unary check runs. This is what a stateless
  // public call wants.
  const { issues, usage } = await analyzePrompt({
    segments,
    openaiKey: c.env.OPENAI_API_KEY,
  })

  const elapsed = Date.now() - start

  // Telemetry only — NO prompt text, NO issue messages. Keep this in
  // sync with the "we don't store prompts" promise on the landing page
  // and in SKILL.md. If you ever add text to this payload, update both.
  await logAction(c, 'public-analyze', {
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
