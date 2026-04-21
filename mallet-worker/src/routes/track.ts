import { Hono } from 'hono'
import type { Env } from '../types'
import { logAction } from '../lib/logging'

const app = new Hono<{ Bindings: Env }>()

// Campaign link attribution. Invoked by the SPA on first load when a
// `?v=<n>` param is present. Any format-valid digit string (of any
// length, dots cosmetic) is accepted — the email/campaign mapping is
// maintained externally and may or may not exist in KV. When it does,
// the hit is enriched with those fields; when it doesn't, we still log
// the hit and persist the mid so downstream events can be attributed
// later (once the mapping is filled in).
app.post('/:n', async (c) => {
  // Dots are cosmetic — the SPA already strips them, but accept and
  // normalize here too so direct worker hits (or future variants) work.
  const n = c.req.param('n').replace(/\./g, '')
  // Reject only malformed slugs (non-digit / empty). Any number of
  // digits is valid — the mid space isn't bounded here.
  if (!/^\d+$/.test(n)) return c.json({ ok: false }, 200)

  const entry = await c.env.INVITES.get<InviteEntry>(`v:${n}`, 'json')

  await logAction(c, 'track.hit', {
    mid: n,
    email: entry?.email ?? null,
    campaign: entry?.campaign ?? null,
    mapped: !!entry,
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
