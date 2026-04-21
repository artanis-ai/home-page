import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { instrument, type ResolveConfigFn } from '@microlabs/otel-cf-workers'
import type { Env } from './types'
import { requireAuth, optionalAuth, type AuthVars } from './lib/auth'
import { rateLimitMiddleware, rateLimitMiddlewareByIP } from './lib/rate-limit'
import analyzeRoute from './routes/analyze'
import publicAnalyzeRoute from './routes/public-analyze'
import suggestRoute from './routes/suggest'
import detectPromptsRoute from './routes/detect-prompts'
import createPRRoute from './routes/create-pr'
import githubTokenRoute from './routes/github-token'
import oauthRoute from './routes/oauth'
import trackRoute from './routes/track'
import eventRoute from './routes/event'

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
    allowHeaders: ['Content-Type', 'Authorization', 'Upgrade', 'Connection', 'X-Mid'],
  })
)

// Global error handler. Hono's default onError returns a bare text/plain
// "Internal Server Error" — CORS headers do survive (cors() middleware
// runs on the response after onError produces it), but the body shape is
// inconsistent with the rest of the API. Normalize to JSON and log the
// underlying error so Axiom captures the stack.
app.onError((err, c) => {
  console.error('[worker] unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

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

// SPA telemetry sink. Unauthenticated; rate-limited per IP. The client
// sends UI events (onboarding clicks, share/copy, suggestion accept,
// PR open, etc.) — never prompt text or file content.
app.use('/event', rateLimitMiddlewareByIP(120))
app.route('/event', eventRoute)

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

// Prompt detection works for anon users on public repos (no GitHub token
// needed for the tree fetch) AND for signed-in users on private repos.
// IP-limited to bound OpenAI spend when unauthenticated.
app.use('/api/detect-prompts', rateLimitMiddlewareByIP(20))
app.use('/api/detect-prompts', optionalAuth())

// All other /api/* routes require auth. `/api/public/*`, `/api/analyze`,
// `/api/suggest`, and `/api/detect-prompts` are explicitly skipped — Hono
// runs all path-matching middleware regardless of registration order, so
// we can't rely on "declared earlier" to exempt them.
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (path.startsWith('/api/public/')) return next()
  if (path === '/api/analyze' || path === '/api/suggest' || path === '/api/detect-prompts') return next()
  return requireAuth()(c, next)
})

// Per-route rate limits for authed routes (bucket key is per userId).
app.use('/api/create-pr', rateLimitMiddleware(10))    // GitHub-side cost too
app.use('/api/github-token', rateLimitMiddleware(60))

app.route('/api/analyze', analyzeRoute)
app.route('/api/suggest', suggestRoute)
app.route('/api/detect-prompts', detectPromptsRoute)
app.route('/api/create-pr', createPRRoute)
app.route('/api/github-token', githubTokenRoute)

// Axiom OTel exporter config. `instrument()` wraps the fetch handler,
// auto-creates a root span per request, and flushes any child spans
// (logAction) over OTLP at the end of the waitUntil lifecycle.
const otelConfig: ResolveConfigFn = (env: Env) => ({
  exporter: {
    url: env.AXIOM_TRACES_URL || 'https://api.axiom.co/v1/traces',
    headers: {
      Authorization: `Bearer ${env.AXIOM_TOKEN}`,
      'X-Axiom-Dataset': env.AXIOM_DATASET,
    },
  },
  service: { name: 'mallet-api' },
})

export default instrument(app as unknown as ExportedHandler<Env>, otelConfig)
