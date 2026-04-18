import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import { requireAuth, type AuthVars } from './lib/auth'
import { rateLimitMiddleware, rateLimitMiddlewareByIP } from './lib/rate-limit'
import analyzeRoute from './routes/analyze'
import publicAnalyzeRoute from './routes/public-analyze'
import suggestRoute from './routes/suggest'
import detectPromptsRoute from './routes/detect-prompts'
import createPRRoute from './routes/create-pr'
import githubTokenRoute from './routes/github-token'

export { SignalingRoom } from './signaling'

const app = new Hono<{ Bindings: Env; Variables: AuthVars }>()

// CORS — `/api/public/*` is open (it's the skill endpoint — agents and
// arbitrary CLI scripts call it). Everything else is locked to our own
// origins, falling back to artanis.ai (a benign known origin) rather
// than reflecting an attacker-chosen origin.
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const path = new URL(c.req.url).pathname
      if (path.startsWith('/api/public/')) return origin || '*'
      if (!origin) return 'https://artanis.ai'
      if (origin === 'https://artanis.ai') return origin
      if (origin.startsWith('http://localhost:')) return origin
      if (origin.endsWith('.artanis.ai')) return origin
      return 'https://artanis.ai'
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Upgrade', 'Connection'],
  })
)

// Health check (unauthenticated)
app.get('/', (c) => {
  return c.json({ status: 'ok', service: 'mallet-api' })
})

// WebSocket signaling endpoint for y-webrtc.
// Auth is enforced inside the Durable Object (it needs the session token in
// a query param so the WebSocket handshake can carry it).
app.get('/signaling/:room', async (c) => {
  const roomName = c.req.param('room')
  const id = c.env.SIGNALING_ROOM.idFromName(roomName)
  const stub = c.env.SIGNALING_ROOM.get(id)
  return stub.fetch(c.req.raw)
})

// Public (unauthenticated) skill endpoint. Must be wired BEFORE the
// `/api/*` auth middleware, otherwise the wildcard would demand a Bearer
// token. IP-based rate limit sized well below the authed /api/analyze
// cap because every call is a whole-prompt fan-out (no segment cache).
app.use('/api/public/analyze', rateLimitMiddlewareByIP(10))
app.route('/api/public/analyze', publicAnalyzeRoute)

// All other /api/* routes require auth. `/api/public/*` is explicitly
// skipped — Hono runs all path-matching middleware regardless of
// registration order, so we can't rely on "declared earlier" to exempt
// the public route; the skip has to be explicit.
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (path.startsWith('/api/public/')) return next()
  return requireAuth()(c, next)
})

// Per-route rate limits, applied after auth so the bucket key is per userId.
// Limits sized for normal interactive use; tightened on the hot, expensive paths.
app.use('/api/analyze', rateLimitMiddleware(60))      // ~1/sec, debounce-friendly
app.use('/api/suggest', rateLimitMiddleware(30))      // user-initiated clicks
app.use('/api/detect-prompts', rateLimitMiddleware(20))
app.use('/api/create-pr', rateLimitMiddleware(10))    // GitHub-side cost too
app.use('/api/github-token', rateLimitMiddleware(60))

app.route('/api/analyze', analyzeRoute)
app.route('/api/suggest', suggestRoute)
app.route('/api/detect-prompts', detectPromptsRoute)
app.route('/api/create-pr', createPRRoute)
app.route('/api/github-token', githubTokenRoute)

export default app
