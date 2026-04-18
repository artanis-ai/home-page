import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { ClerkProvider, ClerkLoaded } from '@clerk/clerk-react'
import { router } from './router'
import './index.css'

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY environment variable')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      signInFallbackRedirectUrl="/mallet/#/app"
      signUpFallbackRedirectUrl="/mallet/#/app"
    >
      <ClerkLoaded>
        <RouterProvider router={router} />
      </ClerkLoaded>
    </ClerkProvider>
  </StrictMode>,
)
