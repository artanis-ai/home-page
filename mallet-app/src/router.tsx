import { createHashRouter } from 'react-router-dom'
import { LandingPage } from './components/landing/LandingPage'
import { OnboardingWizard } from './components/onboarding/OnboardingWizard'
import { AppLayout } from './components/shared/AppLayout'
import { RepoConnector } from './components/repo/RepoConnector'
import { PromptDiscovery } from './components/repo/PromptDiscovery'
import { EditorPage } from './components/editor/EditorPage'
import { SSOCallback } from './components/shared/SSOCallback'

export const router = createHashRouter([
  {
    path: '/',
    element: <LandingPage />,
  },
  {
    path: '/start',
    element: <OnboardingWizard />,
  },
  {
    path: '/sso-callback',
    element: <SSOCallback />,
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
