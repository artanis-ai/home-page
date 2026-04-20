import { Hono } from 'hono'
import type { Env } from '../types'
import { logAction } from '../lib/logging'

const app = new Hono<{ Bindings: Env }>()

// Campaign link attribution. Invoked by the SPA on first load when a
// `?v=<n>` param is present. Records the first-touch hit; silently
// reports miss for unknown slugs so probes can't enumerate the list.
app.post('/:n', async (c) => {
  const n = c.req.param('n')
  if (!/^\d+$/.test(n)) return c.json({ ok: false }, 200)

  const entry = await c.env.INVITES.get<InviteEntry>(`v:${n}`, 'json')
  if (!entry) return c.json({ ok: false }, 200)

  await logAction(c, 'track.hit', {
    mid: n,
    email: entry.email,
    campaign: entry.campaign ?? null,
    ua: c.req.header('user-agent') ?? null,
    ip: c.req.header('cf-connecting-ip') ?? null,
    ref: c.req.header('referer') ?? null,
  })

  return c.json({ ok: true })
})

export interface InviteEntry {
  email: string
  campaign?: string
  sentAt?: number
}

export default app
