import { Hono } from 'hono'
import type { Env } from '../types'
import { requireGitHubToken, type AuthVars } from '../lib/auth'

// requireAuth is applied by the parent app for /api/*
const app = new Hono<{ Bindings: Env; Variables: AuthVars }>()

app.use('*', requireGitHubToken())

app.post('/', (c) => {
  return c.json({ token: c.get('githubToken') })
})

export default app
