import { useSession } from './useSession'

/**
 * Kicks off the raw GitHub OAuth flow via our own worker:
 *   Mallet → /auth/github/start → GitHub OAuth → /auth/github/callback → return_to
 *
 * We previously delegated this to Clerk, but Clerk's cookie collided with
 * Artanis AI's main-product auth on the shared apex domain.
 */
export function useGitHubSignIn() {
  const { signIn } = useSession()
  return signIn
}
