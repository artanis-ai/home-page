/**
 * Raw GitHub OAuth flow. Two steps:
 *
 *   GET /auth/github/start?return_to=<absolute-url>
 *     — validates return_to against allowed origins, signs a short-lived
 *       HS256 state JWT carrying { return_to, nonce }, 302s to GitHub.
 *
 *   GET /auth/github/callback?code=&state=
 *     — verifies state, exchanges code → GitHub access_token, fetches
 *       /user, signs a session JWT ({ sub, login, name, avatar, gh_token })
 *       and 302s back to return_to with `?s=<session-jwt>` appended inside
 *       the hash fragment (hash-router safe, not sent to any server).
 *
 * Why embed the GH token in the session: keeps `/api/github-token`
 * stateless (no server-side session store, no Clerk round-trip) and
 * means a valid session is sufficient for any gh-scoped request.
 */
import { Hono } from 'hono'
import { SignJWT, jwtVerify } from 'jose'
import type { Env } from '../types'

const STATE_TTL_SECONDS = 5 * 60
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days
const GITHUB_SCOPES = 'repo'

const app = new Hono<{ Bindings: Env }>()

function secret(key: string): Uint8Array {
  return new TextEncoder().encode(key)
}

function isAllowedReturn(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.origin === 'https://artanis.ai') return true
    if (u.hostname.endsWith('.artanis.ai')) return true
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true
    return false
  } catch {
    return false
  }
}

/**
 * Append `s=<jwt>` to whatever is inside the hash fragment so React's
 * hash router can read it (and it never hits server logs). We normalize
 * into either `#/path?s=...` or `#/path?existing=foo&s=...`.
 */
function appendSessionToHash(returnTo: string, sessionJWT: string): string {
  const u = new URL(returnTo)
  const hashBody = u.hash.startsWith('#') ? u.hash.slice(1) : ''
  const [hashPath, hashQuery = ''] = hashBody.split('?', 2)
  const params = new URLSearchParams(hashQuery)
  params.delete('s')
  params.set('s', sessionJWT)
  const newHash = hashPath
    ? `#${hashPath}?${params.toString()}`
    : `#?${params.toString()}`
  u.hash = newHash
  return u.toString()
}

app.get('/start', async (c) => {
  const returnTo = c.req.query('return_to')
  if (!returnTo || !isAllowedReturn(returnTo)) {
    return c.json({ error: 'Invalid return_to' }, 400)
  }
  if (!c.env.GITHUB_CLIENT_ID) return c.json({ error: 'GITHUB_CLIENT_ID not configured' }, 500)
  if (!c.env.SESSION_SECRET) return c.json({ error: 'SESSION_SECRET not configured' }, 500)

  const nonce = crypto.randomUUID()
  const state = await new SignJWT({ return_to: returnTo, nonce })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(secret(c.env.SESSION_SECRET))

  // Worker-hosted callback URL — GitHub redirects back here. Must match
  // the callback URL configured in the GitHub OAuth App settings.
  const redirectUri = new URL('/auth/github/callback', c.req.url).toString()

  const authorize = new URL('https://github.com/login/oauth/authorize')
  authorize.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID)
  authorize.searchParams.set('redirect_uri', redirectUri)
  authorize.searchParams.set('scope', GITHUB_SCOPES)
  authorize.searchParams.set('state', state)

  return c.redirect(authorize.toString(), 302)
})

app.get('/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) return c.json({ error: 'Missing code or state' }, 400)

  if (!c.env.GITHUB_CLIENT_ID) return c.json({ error: 'GITHUB_CLIENT_ID not configured' }, 500)
  if (!c.env.GITHUB_CLIENT_SECRET) return c.json({ error: 'GITHUB_CLIENT_SECRET not configured' }, 500)
  if (!c.env.SESSION_SECRET) return c.json({ error: 'SESSION_SECRET not configured' }, 500)

  let returnTo: string
  try {
    const { payload } = await jwtVerify(state, secret(c.env.SESSION_SECRET), {
      algorithms: ['HS256'],
    })
    if (typeof payload.return_to !== 'string' || !isAllowedReturn(payload.return_to)) {
      return c.json({ error: 'Invalid state' }, 400)
    }
    returnTo = payload.return_to
  } catch {
    return c.json({ error: 'Invalid state' }, 400)
  }

  // Exchange code for an access token.
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  })
  if (!tokenRes.ok) return c.json({ error: 'Token exchange failed' }, 502)
  const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string }
  if (!tokenBody.access_token) {
    return c.json({ error: tokenBody.error || 'No access_token' }, 502)
  }
  const accessToken = tokenBody.access_token

  // Fetch the user profile so the session carries display data + stable sub.
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'mallet-api',
    },
  })
  if (!userRes.ok) return c.json({ error: 'User fetch failed' }, 502)
  const user = (await userRes.json()) as {
    id: number
    login: string
    name?: string | null
    avatar_url?: string
  }

  const sessionJWT = await new SignJWT({
    login: user.login,
    name: user.name ?? user.login,
    avatar: user.avatar_url ?? null,
    gh_token: accessToken,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret(c.env.SESSION_SECRET))

  return c.redirect(appendSessionToHash(returnTo, sessionJWT), 302)
})

export default app
