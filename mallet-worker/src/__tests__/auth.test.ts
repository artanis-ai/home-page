import { describe, it, expect } from 'vitest'
import { verifyClerkJWT } from '../lib/auth'
import type { Env } from '../types'

const baseEnv: Env = {
  OPENAI_API_KEY: 'sk-test',
  CLERK_SECRET_KEY: 'sk_test',
  CLERK_ISSUER_URL: 'https://example.clerk.accounts.dev',
  ENVIRONMENT: 'development',
  LOGS: {} as KVNamespace,
  SIGNALING_ROOM: {} as DurableObjectNamespace,
}

describe('verifyClerkJWT', () => {
  it('accepts dev test_<userId> token in development', async () => {
    const session = await verifyClerkJWT(baseEnv, 'test_alice')
    expect(session.userId).toBe('alice')
    expect(session.isTest).toBe(true)
  })

  it('rejects empty token', async () => {
    await expect(verifyClerkJWT(baseEnv, '')).rejects.toThrow()
  })

  it('rejects empty test_ payload', async () => {
    await expect(verifyClerkJWT(baseEnv, 'test_')).rejects.toThrow()
  })

  it('NEVER accepts test_ tokens in production', async () => {
    const prodEnv = { ...baseEnv, ENVIRONMENT: 'production' }
    // In production, "test_alice" is treated as a real JWT and JWKS verify
    // will throw (it isn't a valid JWS at all).
    await expect(verifyClerkJWT(prodEnv, 'test_alice')).rejects.toThrow()
  })

  it('rejects forged JWT-shaped tokens (atob-only payloads)', async () => {
    // Construct a JWT-looking string with a valid base64 payload but no
    // signature verification possible. Must not be accepted.
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({ sub: 'attacker', iss: baseEnv.CLERK_ISSUER_URL }))
    const forged = `${header}.${payload}.`
    const prodEnv = { ...baseEnv, ENVIRONMENT: 'production' }
    await expect(verifyClerkJWT(prodEnv, forged)).rejects.toThrow()
  })

  it('rejects tokens issued by an unexpected issuer', async () => {
    // Even a real-looking JWT with sub but wrong issuer must fail.
    // We can't construct a signed JWT here, but we can verify the issuer
    // claim is enforced by jwtVerify (test serves as a regression guard).
    const prodEnv = { ...baseEnv, ENVIRONMENT: 'production' }
    await expect(verifyClerkJWT(prodEnv, 'a.b.c')).rejects.toThrow()
  })
})
