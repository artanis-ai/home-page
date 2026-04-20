import { useSyncExternalStore, useCallback } from 'react'
import { WORKER_URL } from '../lib/api'

/**
 * Tiny session store backed by localStorage. The session JWT is signed
 * by the worker (HS256) and its payload carries the user's GitHub token
 * inline — decoding client-side gives us user info + gh_token without
 * any extra round-trip. Verification still happens server-side on every
 * authed request, so forging the payload locally buys nothing.
 */

const KEY = 'mallet:session'
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('storage', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

function getSnapshot(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function setSession(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token)
    else localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
  notify()
}

interface Payload {
  sub: string
  login: string
  name: string
  avatar: string | null
  gh_token: string
  exp: number
}

function decode(token: string | null): Payload | null {
  if (!token) return null
  try {
    const body = token.split('.')[1]
    const padLen = (4 - (body.length % 4)) % 4
    const json = atob(body.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen))
    const payload = JSON.parse(json) as Payload
    if (payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export function useSession() {
  const token = useSyncExternalStore(subscribe, getSnapshot, () => null)
  const payload = decode(token)

  const signIn = useCallback((returnTo?: string) => {
    const url = new URL('/auth/github/start', WORKER_URL)
    url.searchParams.set('return_to', returnTo || window.location.href)
    window.location.assign(url.toString())
  }, [])

  const signOut = useCallback(() => setSession(null), [])

  const getToken = useCallback(async () => token, [token])

  return {
    isSignedIn: Boolean(payload),
    user: payload
      ? { id: payload.sub, login: payload.login, name: payload.name, avatar: payload.avatar }
      : null,
    token,
    githubToken: payload?.gh_token ?? null,
    getToken,
    signIn,
    signOut,
  }
}

/**
 * Run ONCE before React mounts. The OAuth callback redirects back with
 * `?s=<jwt>` inside the hash fragment (hash is client-only, not logged).
 * We stash the JWT in localStorage, then rewrite the URL to strip `s=`
 * so it doesn't linger in history or get shared accidentally.
 */
export function ingestSessionFromHash() {
  try {
    const hash = window.location.hash
    const q = hash.indexOf('?')
    if (q === -1) return
    const params = new URLSearchParams(hash.slice(q + 1))
    const s = params.get('s')
    if (!s) return
    localStorage.setItem(KEY, s)
    params.delete('s')
    const rest = params.toString()
    const newHash = hash.slice(0, q) + (rest ? `?${rest}` : '')
    window.history.replaceState(null, '', window.location.pathname + window.location.search + newHash)
  } catch {
    // ignore
  }
}
