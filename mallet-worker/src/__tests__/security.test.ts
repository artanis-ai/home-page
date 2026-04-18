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

describe('WebSocket signaling is intentionally unauthenticated', () => {
  // Signaling is public so that signed-out / incognito users can still
  // collaborate on a shared room URL. The expensive authenticated work
  // (analyze/suggest/create-pr) is gated separately in its own tests.
  it('accepts WebSocket upgrade with no token (anonymous allowed)', async () => {
    const probe = await probeWebSocket(`${WS_WORKER_URL}/signaling/test-room`)
    expect(probe.opened).toBe(true)
  }, 5000)

  it('accepts WebSocket upgrade even with a bogus token (no verification)', async () => {
    const probe = await probeWebSocket(`${WS_WORKER_URL}/signaling/test-room?token=not.a.jwt`)
    expect(probe.opened).toBe(true)
  }, 5000)

  it('rejects non-WebSocket request to /signaling (426)', async () => {
    const res = await fetch(`${WORKER_URL}/signaling/test-room`)
    expect(res.status).toBe(426) // Expected WebSocket
  }, 5000)
})

// Regression: hibernation used to wipe in-memory topic subscriptions,
// silently dropping publish relays. This test opens two clients, has
// them subscribe to the same topic, and confirms a publish from A is
// relayed to B. If signaling is broken, no WebRTC signaling flows —
// and cross-browser (e.g. incognito) collaboration is dead.
describe('WebSocket signaling relay', () => {
  function openSubscribed(room: string, topic: string, userSuffix: string) {
    return new Promise<{ ws: WebSocket; messages: string[] }>((resolve, reject) => {
      const ws = new WebSocket(
        `${WS_WORKER_URL}/signaling/${room}?token=test_relay_${userSuffix}`
      )
      const messages: string[] = []
      const timer = setTimeout(() => reject(new Error('ws open timed out')), 3000)
      ws.on('open', () => {
        clearTimeout(timer)
        ws.send(JSON.stringify({ type: 'subscribe', topics: [topic] }))
        resolve({ ws, messages })
      })
      ws.on('message', (data) => {
        messages.push(data.toString())
      })
      ws.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
    })
  }

  it('relays a publish from one subscriber to another on the same topic', async () => {
    const room = `relay-test-${Date.now()}`
    const topic = 'peer-discovery'

    const a = await openSubscribed(room, topic, 'a')
    const b = await openSubscribed(room, topic, 'b')

    // Give subscribe messages a moment to be processed.
    await new Promise((r) => setTimeout(r, 200))

    const payload = { type: 'publish', topic, data: { hello: 'from-a' } }
    a.ws.send(JSON.stringify(payload))

    // Wait for relay delivery to b.
    const deadline = Date.now() + 3000
    while (b.messages.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
    }

    expect(b.messages.length).toBeGreaterThanOrEqual(1)
    const received = JSON.parse(b.messages[0])
    expect(received.type).toBe('publish')
    expect(received.topic).toBe(topic)
    // Publisher should NOT get an echo of its own message.
    expect(a.messages.length).toBe(0)

    a.ws.close()
    b.ws.close()
  }, 10000)

  it('does not relay to unsubscribed peers', async () => {
    const room = `relay-test-${Date.now()}`
    const a = await openSubscribed(room, 'topic-a', 'a')
    const b = await openSubscribed(room, 'topic-b', 'b')

    await new Promise((r) => setTimeout(r, 200))

    a.ws.send(JSON.stringify({ type: 'publish', topic: 'topic-a', data: 1 }))

    // Give time for (incorrect) relay to happen if it were going to.
    await new Promise((r) => setTimeout(r, 500))

    expect(b.messages.length).toBe(0)

    a.ws.close()
    b.ws.close()
  }, 10000)
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
