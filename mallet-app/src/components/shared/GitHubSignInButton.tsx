import { useClerk } from '@clerk/clerk-react'
import type { ReactNode } from 'react'

interface GitHubSignInButtonProps {
  children: ReactNode
}

export function GitHubSignInButton({ children }: GitHubSignInButtonProps) {
  const clerk = useClerk()

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    clerk.redirectToSignIn({
      signInForceRedirectUrl: window.location.origin + '/mallet/#/app',
      signUpForceRedirectUrl: window.location.origin + '/mallet/#/app',
    })
  }

  return <span onClick={handleClick} onClickCapture={handleClick} style={{ cursor: 'pointer' }}>{children}</span>
}
