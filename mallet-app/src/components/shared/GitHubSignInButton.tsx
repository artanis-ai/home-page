import type { ReactNode } from 'react'
import { useGitHubSignIn } from '../../hooks/useGitHubSignIn'

interface GitHubSignInButtonProps {
  children: ReactNode
}

export function GitHubSignInButton({ children }: GitHubSignInButtonProps) {
  const signInWithGitHub = useGitHubSignIn()

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    signInWithGitHub()
  }

  return <span onClick={handleClick} onClickCapture={handleClick} style={{ cursor: 'pointer' }}>{children}</span>
}
