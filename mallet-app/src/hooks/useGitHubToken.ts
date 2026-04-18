import { useAuth } from '@clerk/clerk-react'
import { useCallback, useRef } from 'react'
import { WORKER_URL } from '../lib/api'

export function useGitHubToken() {
  const { getToken } = useAuth()
  const cachedToken = useRef<{ token: string; expiresAt: number } | null>(null)

  const getGitHubToken = useCallback(async (): Promise<string | null> => {
    // Return cached token if still valid (cache for 5 minutes)
    if (cachedToken.current && Date.now() < cachedToken.current.expiresAt) {
      return cachedToken.current.token
    }

    try {
      const sessionToken = await getToken()
      if (!sessionToken) {
        console.error('[Mallet] No session token')
        return null
      }

      const res = await fetch(`${WORKER_URL}/api/github-token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('[Mallet] Failed to get GitHub token:', err)
        return null
      }

      const data = await res.json() as { token: string }
      cachedToken.current = {
        token: data.token,
        expiresAt: Date.now() + 5 * 60 * 1000,
      }
      return data.token
    } catch (err) {
      console.error('[Mallet] GitHub token error:', err)
      return null
    }
  }, [getToken])

  return getGitHubToken
}
