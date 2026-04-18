import { useClerk } from '@clerk/clerk-react'
import { useCallback } from 'react'

export function useGitHubSignIn() {
  const clerk = useClerk()

  return useCallback(() => {
    clerk.redirectToSignIn({
      signInForceRedirectUrl: window.location.origin + '/mallet/#/app',
      signUpForceRedirectUrl: window.location.origin + '/mallet/#/app',
    })
  }, [clerk])
}
