import { WORKER_URL } from './api'

const MID_KEY = 'mallet.mid'

/**
 * Read the campaign mid assigned by a cold-email link click, if any.
 * Returns null for organic traffic. Attached to all worker requests as
 * `X-Mid` so server-side logs can attribute activity back to the recipient.
 */
export function getMid(): string | null {
  try {
    return localStorage.getItem(MID_KEY)
  } catch {
    return null
  }
}

/**
 * First-touch attribution. Runs on every page load; a noop unless the URL
 * carries `?v=<n>` from a campaign link (the root 404.html redirects the
 * cold-email `/mallet/v<n>` shape into this query form). On a valid slug
 * the worker confirms the hit and we persist the mid in localStorage so
 * subsequent API calls carry it. Invalid/missing slugs fail silently so
 * nobody can probe which numbers are real.
 *
 * Cleans the `?v=` off the URL via replaceState whether or not the slug
 * validates — the recipient never needs to see the query param.
 */
export async function captureAttribution(): Promise<void> {
  if (typeof window === 'undefined') return

  const params = new URLSearchParams(window.location.search)
  const raw = params.get('v')
  if (!raw) return
  // Dots are cosmetic (e.g. `v1.2.3` disguises the digit count) — strip
  // them before validating. The slug space is just positive integers.
  const n = raw.replace(/\./g, '')
  if (!/^\d+$/.test(n)) return

  // Clean URL immediately so the `?v=` is only visible for the split
  // second between the 404 redirect and this line.
  params.delete('v')
  const qs = params.toString()
  const clean = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
  window.history.replaceState(null, '', clean)

  try {
    const res = await fetch(`${WORKER_URL}/t/${n}`, { method: 'POST' })
    if (!res.ok) return
    const { ok } = (await res.json()) as { ok: boolean }
    if (ok) localStorage.setItem(MID_KEY, n)
  } catch {
    // Offline / worker unreachable — nothing to do, mid stays unset.
  }
}
