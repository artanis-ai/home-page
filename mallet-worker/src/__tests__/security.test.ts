/**
 * HTTP-level security tests. Run against `wrangler dev` (ENVIRONMENT=development).
 * Cover the public-facing contract that prevents abuse:
 *   - all /api/* endpoints reject unauthenticated requests
 *   - bad/malformed Authorization headers are rejected
 *   - CORS does not reflect arbitrary origins
 *   - input validation prevents path injection
 *   - WebSocket signaling rejects token-less handshakes
 */
import { describe, it, expect } from 'vitest'
import WebSocket from 'ws'

const WORKER_URL = 'http://localhost:8787'
const WS_WORKER_URL = 'ws://localhost:8787'

/** Open a WebSocket and resolve to the close code (or 0 if it stays open). */
function probeWebSocket(url: string): Promise<{ opened: boolean; closeCode: number; statusCode?: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url)
    let opened = false
    const timer = setTimeout(() => {
      ws.terminate()
      resolve({ opened, closeCode: 0 })
    }, 3000)
    ws.on('open', () => { opened = true })
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer)
      resolve({ opened: false, closeCode: 0, statusCode: res.statusCode })
      ws.terminate()
    })
    ws.on('error', () => {
      clearTimeout(timer)
      resolve({ opened, closeCode: 0 })
    })
    ws.on('close', (code) => {
      clearTimeout(timer)
      resolve({ opened, closeCode: code })
    })
  })
}

const ENDPOINTS = [
  '/api/analyze',
  '/api/suggest',
  '/api/detect-prompts',
  '/api/create-pr',
  '/api/github-token',
] as const

describe('endpoint auth gating', () => {
  for (const path of ENDPOINTS) {
    it(`POST ${path} → 401 with no Authorization header`, async () => {
      const res = await fetch(`${WORKER_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(401)
    }, 5000)

    it(`POST ${path} → 401 with non-Bearer Authorization`, async () => {
      const res = await fetch(`${WORKER_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic dXNlcjpwYXNz',
        },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(401)
    }, 5000)

    it(`POST ${path} → 401 with garbage Bearer token`, async () => {
      const res = await fetch(`${WORKER_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer not.a.real.jwt',
        },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(401)
    }, 5000)
  }
})

describe('CORS', () => {
  it('does not reflect arbitrary attacker origin in Access-Control-Allow-Origin', async () => {
    const attacker = 'https://evil.example.com'
    const res = await fetch(`${WORKER_URL}/api/analyze`, {
      method: 'OPTIONS',
      headers: {
        Origin: attacker,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    })
    const allowed = res.headers.get('Access-Control-Allow-Origin')
    expect(allowed).not.toBe(attacker)
  }, 5000)

  it('allows artanis.ai origin', async () => {
    const res = await fetch(`${WORKER_URL}/api/analyze`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://artanis.ai',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    })
    const allowed = res.headers.get('Access-Control-Allow-Origin')
    expect(allowed).toBe('https://artanis.ai')
  }, 5000)

  it('allows localhost origins for dev', async () => {
    const res = await fetch(`${WORKER_URL}/api/analyze`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5180',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    })
    const allowed = res.headers.get('Access-Control-Allow-Origin')
    expect(allowed).toBe('http://localhost:5180')
  }, 5000)
})

describe('input validation', () => {
  it('detect-prompts rejects path-injection in repoOwner', async () => {
    const res = await fetch(`${WORKER_URL}/api/detect-prompts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_user_security',
      },
      body: JSON.stringify({ repoOwner: '../etc', repoName: 'passwd' }),
    })
    expect(res.status).toBe(400)
  }, 5000)

  it('create-pr rejects path-injection in repoName', async () => {
    const res = await fetch(`${WORKER_URL}/api/create-pr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_user_security',
      },
      body: JSON.stringify({
        repoOwner: 'good',
        repoName: '../bad',
        filePath: 'x',
        content: 'y',
      }),
    })
    expect(res.status).toBe(400)
  }, 5000)

  it('create-pr rejects missing required fields with 400', async () => {
    const res = await fetch(`${WORKER_URL}/api/create-pr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_user_security',
      },
      body: JSON.stringify({ repoOwner: 'a' }),
    })
    expect(res.status).toBe(400)
  }, 5000)
})

describe('WebSocket signaling auth', () => {
  it('rejects WebSocket upgrade without ?token=', async () => {
    const probe = await probeWebSocket(`${WS_WORKER_URL}/signaling/test-room`)
    expect(probe.opened).toBe(false)
    expect(probe.statusCode).toBe(401)
  }, 5000)

  it('rejects WebSocket upgrade with garbage token', async () => {
    const probe = await probeWebSocket(`${WS_WORKER_URL}/signaling/test-room?token=not.a.jwt`)
    expect(probe.opened).toBe(false)
    expect(probe.statusCode).toBe(401)
  }, 5000)

  it('accepts WebSocket upgrade with valid dev test_ token', async () => {
    const probe = await probeWebSocket(`${WS_WORKER_URL}/signaling/test-room?token=test_signaling_user`)
    expect(probe.opened).toBe(true)
  }, 5000)

  it('rejects non-WebSocket request to /signaling (426)', async () => {
    const res = await fetch(`${WORKER_URL}/signaling/test-room?token=test_anyone`)
    expect(res.status).toBe(426) // Expected WebSocket
  }, 5000)
})

describe('public endpoints stay public', () => {
  it('GET / health-check requires no auth', async () => {
    const res = await fetch(`${WORKER_URL}/`)
    expect(res.status).toBe(200)
    const data = await res.json() as { status: string }
    expect(data.status).toBe('ok')
  }, 5000)
})

describe('zero-leak guarantee', () => {
  // The "prompts are never stored" promise: we should see no prompt body
  // text echoed in error responses.
  it('does not echo full prompt text in error responses', async () => {
    const secretPrompt = 'SECRET-SHIBBOLETH-DO-NOT-LEAK-12345'
    const res = await fetch(`${WORKER_URL}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_user_leak',
      },
      // Malformed body that will fail JSON parse on segments[]
      body: JSON.stringify({ segments: 'not-an-array', changedHashes: [secretPrompt] }),
    })
    const text = await res.text()
    expect(text).not.toContain(secretPrompt)
  }, 5000)
})
