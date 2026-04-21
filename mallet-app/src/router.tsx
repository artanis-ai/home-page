import { createHashRouter } from 'react-router-dom'
import { LandingPage } from './components/landing/LandingPage'
import { ShareCard } from './components/landing/ShareCard'
import { OnboardingWizard } from './components/onboarding/OnboardingWizard'
import { AppLayout } from './components/shared/AppLayout'
import { RepoConnector } from './components/repo/RepoConnector'
import { PromptDiscovery } from './components/repo/PromptDiscovery'
import { EditorPage } from './components/editor/EditorPage'

export const router = createHashRouter([
  {
    path: '/',
    element: <LandingPage />,
  },
  {
    // 1200×630 card rendered for the screenshot tool that produces
    // img/mallet-og.png (the OG / Twitter / LinkedIn preview image).
    path: '/share',
    element: <ShareCard />,
  },
  {
    path: '/start',
    element: <OnboardingWizard />,
  },
  {
    // Scratch document — /d/:uuid
    path: '/d/:docId',
    element: <EditorPage />,
  },
  {
    // GitHub file — /gh/:owner/:repo/blob/:branch/*filepath
    path: '/gh/:owner/:repo/blob/:branch/*',
    element: <EditorPage />,
  },
  {
    path: '/app',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <RepoConnector />,
      },
      {
        path: 'prompts/:owner/:repo',
        element: <PromptDiscovery />,
      },
    ],
  },
])
