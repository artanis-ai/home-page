import { useSignIn } from '@clerk/clerk-react'
import { useCallback } from 'react'

/**
 * Kicks off the GitHub OAuth flow via Clerk, bypassing Clerk's hosted
 * sign-in page entirely. The browser goes:
 *   Mallet → GitHub OAuth consent → Clerk's `/sso-callback` handler → /app
 *
 * We use `authenticateWithRedirect({ strategy: 'oauth_github', ... })`
 * rather than `clerk.redirectToSignIn()` because the latter renders
 * accounts.dev/sign-in with email + multiple providers; users told us
 * they want "sign in with GitHub" to feel like pure GitHub OAuth.
 */
export function useGitHubSignIn() {
  const { signIn, isLoaded } = useSignIn()

  return useCallback(() => {
    if (!isLoaded || !signIn) return

    // Hash router — callback + complete URLs both live in the hash.
    const base = window.location.origin + '/mallet/'
    signIn.authenticateWithRedirect({
      strategy: 'oauth_github',
      redirectUrl: base + '#/sso-callback',
      redirectUrlComplete: base + '#/app',
    })
  }, [signIn, isLoaded])
}
