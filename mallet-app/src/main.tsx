import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { router } from './router'
import { ingestSessionFromHash } from './hooks/useSession'
import { captureAttribution, getMid } from './lib/attribution'
import './index.css'

// Pull the session JWT out of the OAuth callback URL fragment BEFORE
// React mounts so the first render already reflects the signed-in state.
ingestSessionFromHash()

// Fire-and-forget: if this pageload came from a campaign link (?v=<n>),
// persist the mid in localStorage and log the click server-side. Once
// it settles, register mid as a PostHog super-property so both events
// and session recordings carry it — including the first-touch pageload
// where localStorage wasn't yet populated when posthog.init ran.
void captureAttribution().then(() => {
  const mid = getMid()
  if (mid) posthog.register({ mid })
})

// PostHog — product analytics + session replay. Masking and recording
// enablement are configured project-side on the PostHog dashboard, so
// we only need the public project token here. Safe to ship in the
// bundle (it's a write-only ingest key, not an admin token). Default
// mirrored here rather than threaded through GH Actions secrets so
// the production build from CI doesn't need extra config.
posthog.init(
  import.meta.env.VITE_POSTHOG_KEY || 'phc_uqZ3vHXob4CGAM3PuA8bwzP6zYx8i6zhiv5VdT9DEiMR',
  {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com',
    defaults: '2026-01-30',
  }
)

// Register mid for repeat visitors (already in localStorage). First-touch
// campaign clicks are handled in the captureAttribution().then above.
const existingMid = getMid()
if (existingMid) posthog.register({ mid: existingMid })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PostHogProvider client={posthog}>
      <RouterProvider router={router} />
    </PostHogProvider>
  </StrictMode>,
)
