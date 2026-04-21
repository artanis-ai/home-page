/**
 * Session JWT verification + auth middleware.
 *
 * Sessions are HS256 JWTs signed by the worker itself (SESSION_SECRET).
 * The payload embeds the user's GitHub OAuth token directly:
 *
 *   { sub: <gh user id>, login, name, avatar, gh_token, iat, exp }
 *
 * This keeps `/api/github-token` trivial and removes any server-side
 * session store — the client holds the JWT in localStorage and every
 * request that needs GitHub auth either inlines the token from the
 * session or asks the worker to hand it over (same token, no round-trip
 * to an external provider).
 *
 * We previously delegated all of this to Clerk, but Clerk's session cookie
 * clashed with the main Artanis product's auth when both ran on the same
 * apex domain, so Mallet now owns its own OAuth flow end-to-end.
 *
 * In dev/test (ENVIRONMENT !== 'production'), tokens of the form
 * "test_<userId>" bypass signature verification. Gated by env so a
 * forged test token can never be accepted in production.
 */
import { jwtVerify } from 'jose'
import type { Context, Next } from 'hono'
import type { Env } from '../types'

const TEST_TOKEN_PREFIX = 'test_'
const TEST_GITHUB_TOKEN = 'ghs_test_token_for_local_dev_only'

export interface VerifiedSession {
  userId: string
  githubToken: string | null
  isTest: boolean
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export async function verifySessionJWT(env: Env, token: string): Promise<VerifiedSession> {
  if (!token) throw new Error('Missing token')

  if (env.ENVIRONMENT !== 'production' && token.startsWith(TEST_TOKEN_PREFIX)) {
    const userId = token.slice(TEST_TOKEN_PREFIX.length)
    if (!userId) throw new Error('Invalid test token')
    return { userId, githubToken: TEST_GITHUB_TOKEN, isTest: true }
  }

  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET not configured')

  const { payload } = await jwtVerify(token, secretKey(env.SESSION_SECRET), {
    algorithms: ['HS256'],
  })

  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('Token missing sub claim')
  }

  const gh = typeof payload.gh_token === 'string' ? payload.gh_token : null
  return { userId: payload.sub, githubToken: gh, isTest: false }
}

/**
 * Hono middleware: verify the Bearer token, attach session + userId.
 */
export function requireAuth() {
  return async (c: Context<{ Bindings: Env; Variables: AuthVars }>, next: Next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    try {
      const session = await verifySessionJWT(c.env, authHeader.slice(7))
      c.set('session', session)
      c.set('userId', session.userId)
      return next()
    } catch {
      return c.json({ error: 'Unauthorized' }, 401)
    }
  }
}

/**
 * Hono middleware: expose the GitHub OAuth token from the session JWT.
 * Must run AFTER requireAuth(). No external fetch — the token is already
 * embedded in the session we just verified.
 */
export function requireGitHubToken() {
  return async (c: Context<{ Bindings: Env; Variables: AuthVars }>, next: Next) => {
    const session = c.get('session')
    if (!session) return c.json({ error: 'Unauthorized' }, 401)
    if (!session.githubToken) return c.json({ error: 'No GitHub token available' }, 403)
    c.set('githubToken', session.githubToken)
    return next()
  }
}

/**
 * Hono middleware: attach session + githubToken if a valid Bearer is
 * present; otherwise pass through unauthenticated. Use on endpoints that
 * work for both anon (public repo) and signed-in (private repo) users.
 */
export function optionalAuth() {
  return async (c: Context<{ Bindings: Env; Variables: Partial<AuthVars> }>, next: Next) => {
    const authHeader = c.req.header('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const session = await verifySessionJWT(c.env, authHeader.slice(7))
        c.set('session', session)
        c.set('userId', session.userId)
        if (session.githubToken) c.set('githubToken', session.githubToken)
      } catch {
        // invalid token → treat as anon rather than 401
      }
    }
    return next()
  }
}

export interface AuthVars {
  session: VerifiedSession
  userId: string
  githubToken: string
}
