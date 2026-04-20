import { WORKER_URL } from './api'
import { getMid } from './attribution'

/**
 * Fire-and-forget UI telemetry. Posts `{name, props}` to the worker's
 * `/event` sink. Uses `fetch(... keepalive: true)` so the request still
 * completes after navigation (e.g. sign-in redirects).
 *
 * STRICT RULE: never put prompt text, suggestion text, file content, or
 * any user-typed string in `props`. Filenames, repo names, button labels,
 * counts, durations, enums — yes. Prose — no. Breaking this contract
 * breaks the "prompts are never stored" promise on the landing page.
 *
 * sendBeacon would also survive unload but can't attach custom headers,
 * so we'd lose X-Mid attribution. keepalive fetch keeps the header.
 */
export function track(name: string, props: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const mid = getMid()
  if (mid) headers['X-Mid'] = mid

  fetch(`${WORKER_URL}/event`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, props }),
    keepalive: true,
  }).catch(() => {})
}
