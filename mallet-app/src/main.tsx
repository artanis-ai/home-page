import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { ingestSessionFromHash } from './hooks/useSession'
import { captureAttribution } from './lib/attribution'
import './index.css'

// Pull the session JWT out of the OAuth callback URL fragment BEFORE
// React mounts so the first render already reflects the signed-in state.
ingestSessionFromHash()

// Fire-and-forget: if this pageload came from a campaign link (?v=<n>),
// persist the mid in localStorage and log the click server-side.
void captureAttribution()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
