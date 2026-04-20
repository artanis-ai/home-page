import { getMid } from './attribution'

export const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'https://mallet-api.artanis-ai.workers.dev'

/**
 * Optional Playwright/E2E bypass: when VITE_TEST_TOKEN is set, every authedFetch
 * uses this static token instead of the real session JWT. Combined with the
 * worker's `test_<userId>` token bypass (only enabled when ENVIRONMENT !== 'production'),
 * this lets the frontend talk to a local wrangler worker without a real session.
 *
 * WARNING: Never set VITE_TEST_TOKEN in a production build. The worker will refuse
 * test_ tokens in production anyway, but defense-in-depth.
 */
export const TEST_TOKEN: string | null =
  (import.meta.env.VITE_TEST_TOKEN as string | undefined) ?? null

/**
 * fetch() with the session JWT attached as Authorization: Bearer <token>.
 * Pass `getToken` from `useSession()`.
 */
export async function authedFetch(
  getToken: () => Promise<string | null>,
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = TEST_TOKEN ?? (await getToken())
  if (!token) throw new Error('Not authenticated')
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const mid = getMid()
  if (mid) headers.set('X-Mid', mid)
  return fetch(input, { ...init, headers })
}
