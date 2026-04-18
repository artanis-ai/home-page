/**
 * Clerk JWT verification + auth middleware.
 *
 * Verifies a Clerk session JWT signature against Clerk's JWKS, then
 * (optionally) fetches the user's GitHub OAuth token from the Clerk
 * Backend API. Both userId and githubToken are stashed on the Hono
 * context so route handlers can read them via c.get('userId') etc.
 *
 * In dev/test (ENVIRONMENT === 'development'), tokens of the form
 * "test_<userId>" bypass JWKS verification. This shortcut is gated
 * by env so it can never accept a forged token in production.
 */
import { jwtVerify, createRemoteJWKSet } from 'jose'
import type { Context, Next } from 'hono'
import type { Env } from '../types'

const TEST_TOKEN_PREFIX = 'test_'
const TEST_GITHUB_TOKEN = 'ghs_test_token_for_local_dev_only'

// Cache JWKS per Clerk issuer URL to avoid refetching on every request.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJWKS(issuerUrl: string) {
  let jwks = jwksCache.get(issuerUrl)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuerUrl}/.well-known/jwks.json`))
    jwksCache.set(issuerUrl, jwks)
  }
  return jwks
}

export interface VerifiedSession {
  userId: string
  isTest: boolean
}

export async function verifyClerkJWT(env: Env, token: string): Promise<VerifiedSession> {
  if (!token) throw new Error('Missing token')

  // Test bypass — only in dev/test environments.
  if (env.ENVIRONMENT !== 'production' && token.startsWith(TEST_TOKEN_PREFIX)) {
    const userId = token.slice(TEST_TOKEN_PREFIX.length)
    if (!userId) throw new Error('Invalid test token')
    return { userId, isTest: true }
  }

  if (!env.CLERK_ISSUER_URL) {
    throw new Error('CLERK_ISSUER_URL not configured')
  }

  const jwks = getJWKS(env.CLERK_ISSUER_URL)
  const { payload } = await jwtVerify(token, jwks, {
    issuer: env.CLERK_ISSUER_URL,
  })

  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('Token missing sub claim')
  }

  return { userId: payload.sub, isTest: false }
}

export async function fetchGitHubToken(env: Env, session: VerifiedSession): Promise<string | null> {
  if (session.isTest) return TEST_GITHUB_TOKEN

  if (!env.CLERK_SECRET_KEY) throw new Error('CLERK_SECRET_KEY not configured')

  const res = await fetch(
    `https://api.clerk.com/v1/users/${session.userId}/oauth_access_tokens/github`,
    { headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` } }
  )

  if (!res.ok) return null

  const data = (await res.json()) as { token?: string }[]
  return data[0]?.token ?? null
}

/**
 * Hono middleware: verify the Bearer token, attach userId.
 * Use requireGitHubToken middleware additionally if route needs the GH token.
 */
export function requireAuth() {
  return async (c: Context<{ Bindings: Env; Variables: AuthVars }>, next: Next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    try {
      const session = await verifyClerkJWT(c.env, authHeader.slice(7))
      c.set('session', session)
      c.set('userId', session.userId)
      return next()
    } catch {
      return c.json({ error: 'Unauthorized' }, 401)
    }
  }
}

/**
 * Hono middleware: also fetch GitHub OAuth token from Clerk.
 * Must run AFTER requireAuth().
 */
export function requireGitHubToken() {
  return async (c: Context<{ Bindings: Env; Variables: AuthVars }>, next: Next) => {
    const session = c.get('session')
    if (!session) return c.json({ error: 'Unauthorized' }, 401)
    try {
      const token = await fetchGitHubToken(c.env, session)
      if (!token) return c.json({ error: 'No GitHub token available' }, 403)
      c.set('githubToken', token)
      return next()
    } catch {
      return c.json({ error: 'Failed to retrieve GitHub token' }, 500)
    }
  }
}

export interface AuthVars {
  session: VerifiedSession
  userId: string
  githubToken: string
}
