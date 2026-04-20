/**
 * Generic client-side event sink. The SPA POSTs `{name, props?}` here for
 * UI telemetry — onboarding clicks, share/copy, PR button, suggestion
 * accept/reject, sign-in events, etc.
 *
 * Privacy guardrails:
 *   - Event name is required and capped (32 chars). Keep it an allowlist
 *     of well-known names in the client; the worker doesn't enforce one
 *     so adding new events is a one-side change, but PII shouldn't end
 *     up in the name.
 *   - Props is an arbitrary JSON object capped at 2 KB serialized — the
 *     SPA must NEVER put prompt text, suggestion text, or file content
 *     in here (that would break the "prompts are never stored" promise).
 *     Filenames, repo names, button labels, counts, durations are fine.
 *   - X-Mid is auto-stamped by `logAction`, so attribution flows even
 *     without a session.
 *
 * Rate-limited per IP because anonymous campaign clicks fire events
 * before any sign-in.
 */
import { Hono } from 'hono'
import { logAction } from '../lib/logging'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

const MAX_NAME_LEN = 32
const MAX_PROPS_BYTES = 2_000

interface EventBody {
  name?: unknown
  props?: unknown
}

app.post('/', async (c) => {
  let body: EventBody
  try {
    body = await c.req.json<EventBody>()
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400)
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > MAX_NAME_LEN || !/^[a-z0-9._-]+$/i.test(name)) {
    return c.json({ ok: false, error: 'Invalid event name' }, 400)
  }

  let props: Record<string, unknown> = {}
  if (body.props && typeof body.props === 'object' && !Array.isArray(body.props)) {
    const serialized = JSON.stringify(body.props)
    if (serialized.length > MAX_PROPS_BYTES) {
      return c.json({ ok: false, error: 'Props too large' }, 413)
    }
    props = body.props as Record<string, unknown>
  }

  await logAction(c, `event.${name}`, props)

  return c.json({ ok: true })
})

export default app
