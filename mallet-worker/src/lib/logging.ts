import { trace, type Attributes } from '@opentelemetry/api'

// Structural type so this helper works from routes with or without
// Variables (e.g. auth-protected routes use AuthVars, /t/* does not).
interface LoggingContext {
  req: { header(name: string): string | undefined }
}

const tracer = trace.getTracer('mallet-api')

/**
 * Emits one OTel span per logged action. Span name is the action, attrs
 * carry the metadata. The @microlabs/otel-cf-workers `instrument()`
 * wrapper ships these to Axiom via OTLP. Attrs must be primitives or
 * arrays of primitives; nested objects are JSON-stringified.
 */
export async function logAction(
  c: LoggingContext,
  action: string,
  metadata: Record<string, unknown>
) {
  const span = tracer.startSpan(action)
  const mid = readMid(c)
  if (mid) span.setAttribute('mallet.mid', mid)

  for (const [k, v] of Object.entries(metadata)) {
    if (v === null || v === undefined) continue
    const attrKey = `mallet.${k}`
    if (typeof v === 'object') {
      span.setAttribute(attrKey, JSON.stringify(v))
    } else {
      span.setAttributes({ [attrKey]: v } as Attributes)
    }
  }

  span.end()
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
