import { describe, it, expect } from 'vitest'
import { SignJWT } from 'jose'
import { verifySessionJWT } from '../lib/auth'
import type { Env } from '../types'

const SECRET = 'test-secret-please-ignore-32-bytes-min'

const baseEnv: Env = {
  OPENAI_API_KEY: 'sk-test',
  GITHUB_CLIENT_ID: 'test_client_id',
  GITHUB_CLIENT_SECRET: 'test_client_secret',
  SESSION_SECRET: SECRET,
  ENVIRONMENT: 'development',
  AXIOM_TOKEN: '',
  AXIOM_DATASET: 'test',
  AXIOM_TRACES_URL: 'https://api.axiom.co/v1/traces',
  GRAVEL_FORWARD_TOKEN: 'test_gravel_forward_token',
  INVITES: {} as KVNamespace,
  SIGNALING_ROOM: {} as DurableObjectNamespace,
}

function key(): Uint8Array {
  return new TextEncoder().encode(SECRET)
}

describe('verifySessionJWT', () => {
  it('accepts dev test_<userId> token in development', async () => {
    const session = await verifySessionJWT(baseEnv, 'test_alice')
    expect(session.userId).toBe('alice')
    expect(session.isTest).toBe(true)
    expect(session.githubToken).toBeTruthy()
  })

  it('rejects empty token', async () => {
    await expect(verifySessionJWT(baseEnv, '')).rejects.toThrow()
  })

  it('rejects empty test_ payload', async () => {
    await expect(verifySessionJWT(baseEnv, 'test_')).rejects.toThrow()
  })

  it('NEVER accepts test_ tokens in production', async () => {
    const prodEnv = { ...baseEnv, ENVIRONMENT: 'production' }
    await expect(verifySessionJWT(prodEnv, 'test_alice')).rejects.toThrow()
  })

  it('accepts a session JWT signed with SESSION_SECRET', async () => {
    const jwt = await new SignJWT({ gh_token: 'gho_xyz' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('42')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key())
    const session = await verifySessionJWT(baseEnv, jwt)
    expect(session.userId).toBe('42')
    expect(session.isTest).toBe(false)
    expect(session.githubToken).toBe('gho_xyz')
  })

  it('rejects a JWT signed with the wrong secret', async () => {
    const wrongKey = new TextEncoder().encode('not-the-server-secret')
    const jwt = await new SignJWT({ gh_token: 'gho_xyz' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('42')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(wrongKey)
    await expect(verifySessionJWT(baseEnv, jwt)).rejects.toThrow()
  })

  it('rejects a JWT with alg=none', async () => {
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({ sub: 'attacker' }))
    const forged = `${header}.${payload}.`
    await expect(verifySessionJWT(baseEnv, forged)).rejects.toThrow()
  })

  it('rejects expired tokens', async () => {
    const jwt = await new SignJWT({ gh_token: 'gho_xyz' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('42')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(key())
    await expect(verifySessionJWT(baseEnv, jwt)).rejects.toThrow()
  })
})
