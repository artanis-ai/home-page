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
import oauthRoute from './routes/oauth'
import trackRoute from './routes/track'

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

// GitHub OAuth — unauthenticated start/callback pair. Must come before
// the wildcard auth middleware below.
app.route('/auth/github', oauthRoute)

// Campaign-link first-touch attribution. Unauthenticated — recipients
// haven't signed in yet when they click an email link.
app.route('/t', trackRoute)

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

// `/api/analyze` and `/api/suggest` are intentionally unauthenticated —
// they don't touch GitHub, so anonymous users (and campaign-link clickers
// who haven't signed in yet) can use the editor end-to-end. Sign-in is
// only forced on routes that need a GitHub token (PR creation, repo
// discovery). IP-based rate limits apply since there's no userId.
app.use('/api/analyze', rateLimitMiddlewareByIP(60))   // ~1/sec, debounce-friendly
app.use('/api/suggest', rateLimitMiddlewareByIP(30))   // user-initiated clicks

// All other /api/* routes require auth. `/api/public/*`, `/api/analyze`,
// and `/api/suggest` are explicitly skipped — Hono runs all path-matching
// middleware regardless of registration order, so we can't rely on
// "declared earlier" to exempt them; the skip has to be explicit.
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (path.startsWith('/api/public/')) return next()
  if (path === '/api/analyze' || path === '/api/suggest') return next()
  return requireAuth()(c, next)
})

// Per-route rate limits for authed routes (bucket key is per userId).
app.use('/api/detect-prompts', rateLimitMiddleware(20))
app.use('/api/create-pr', rateLimitMiddleware(10))    // GitHub-side cost too
app.use('/api/github-token', rateLimitMiddleware(60))

app.route('/api/analyze', analyzeRoute)
app.route('/api/suggest', suggestRoute)
app.route('/api/detect-prompts', detectPromptsRoute)
app.route('/api/create-pr', createPRRoute)
app.route('/api/github-token', githubTokenRoute)

export default app
