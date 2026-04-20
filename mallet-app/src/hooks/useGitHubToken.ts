import { useCallback } from 'react'
import { useSession } from './useSession'

/**
 * Returns a function that hands back the GitHub OAuth token. The token
 * is already embedded in our session JWT payload — no network call
 * needed, unlike the old Clerk-backed flow.
 */
export function useGitHubToken() {
  const { githubToken } = useSession()
  return useCallback(async (): Promise<string | null> => githubToken, [githubToken])
}
