import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MoreHorizontal, FileText, Brain, ExternalLink } from 'lucide-react'
import { useSession } from '../../hooks/useSession'
import { track } from '../../lib/track'
import {
  GitHubIcon,
  LangfuseIcon,
  LangSmithIcon,
  HumanloopIcon,
  PromptLayerIcon,
} from '../shared/BrandIcons'

type Step = 'source' | 'github-visibility' | 'github-public' | 'github-private' | 'elsewhere-pick' | 'elsewhere-instructions'
type ElsewhereTool = 'langfuse' | 'langsmith' | 'promptlayer' | 'humanloop' | 'other'

const ELSEWHERE_TOOLS: { id: ElsewhereTool; name: string; icon: React.ReactNode }[] = [
  { id: 'langfuse', name: 'Langfuse', icon: <LangfuseIcon className="h-5 w-5" /> },
  { id: 'langsmith', name: 'LangSmith', icon: <LangSmithIcon className="h-5 w-5" /> },
  { id: 'promptlayer', name: 'PromptLayer', icon: <PromptLayerIcon className="h-5 w-5" /> },
  { id: 'humanloop', name: 'Humanloop', icon: <HumanloopIcon className="h-5 w-5" /> },
  { id: 'other', name: 'Other', icon: <MoreHorizontal className="h-5 w-5" /> },
]

export function OnboardingWizard() {
  const navigate = useNavigate()
  const { isSignedIn, signIn } = useSession()
  // After sign-in, land the user on /app (the signed-in landing).
  const signInWithGitHub = () =>
    signIn(`${window.location.origin}/mallet/#/app`)

  const [step, setStep] = useState<Step>('source')
  const [elsewhereTool, setElsewhereTool] = useState<ElsewhereTool | null>(null)
  const [repoUrl, setRepoUrl] = useState('')
  const [repoError, setRepoError] = useState('')
  const [repoChecking, setRepoChecking] = useState(false)

  useEffect(() => {
    track('onboarding.opened', { signedIn: isSignedIn })
  }, [])

  useEffect(() => {
    track('onboarding.step', { step })
  }, [step])

  function goToEditor(prompt?: string) {
    const uuid = crypto.randomUUID().slice(0, 8)
    track('onboarding.editor.opened', { source: prompt ? 'manual' : 'blank' })
    navigate(`/d/${uuid}`, {
      state: { manualPrompt: prompt || '' },
    })
  }

  function goBack() {
    if (step === 'elsewhere-instructions') setStep('elsewhere-pick')
    else if (step.startsWith('elsewhere') || step.startsWith('github')) setStep('source')
    else setStep('source')
  }

  async function handlePublicRepo() {
    setRepoError('')
    const cleaned = repoUrl.trim().replace(/\/+$/, '')
    const match = cleaned.match(/(?:github\.com\/)?([^/\s]+)\/([^/\s]+?)(?:\.git)?$/)
    if (!match) {
      track('onboarding.public-repo.invalid')
      setRepoError('Enter a valid repo, e.g. owner/repo or github.com/owner/repo')
      return
    }
    const [, owner, repo] = match
    // Verify the repo is reachable anonymously *before* navigating, so the
    // "not found / private" failure surfaces as an inline input error
    // rather than a dead-end spinner on the discovery page.
    setRepoChecking(true)
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`)
      if (res.status === 404) {
        track('onboarding.public-repo.not-found', { owner, repo })
        setRepoError("Couldn't find that repo. If it's private, use the private flow instead.")
        return
      }
      if (!res.ok) {
        track('onboarding.public-repo.error', { owner, repo, status: res.status })
        setRepoError(`GitHub returned ${res.status}. Try again in a moment.`)
        return
      }
      track('onboarding.public-repo.submitted', { owner, repo })
      navigate(`/app/prompts/${owner}/${repo}`)
    } catch {
      setRepoError("Couldn't reach GitHub. Check your connection and try again.")
    } finally {
      setRepoChecking(false)
    }
  }

  const showBack = step !== 'source'

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      {showBack && (
        <button
          onClick={goBack}
          className="mb-8 flex items-center gap-1.5 text-sm text-text-muted transition hover:text-text-mid"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      )}

      {/* Step 1: Where do your prompts live? */}
      {step === 'source' && (
        <div>
          <h1 className="font-display text-3xl font-bold text-earth-dark">
            Where do your prompts live?
          </h1>
          <p className="mt-2 text-text-mid">
            We'll help you get them into the editor.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <SourceCard
              icon={<GitHubIcon className="h-6 w-6" />}
              title="GitHub"
              description="In a repo, as files or in code"
              onClick={() => {
                track('onboarding.source.selected', { source: 'github' })
                if (isSignedIn) navigate('/app')
                else setStep('github-visibility')
              }}
            />
            <SourceCard
              icon={<FileText className="h-6 w-6" />}
              title="Locally"
              description="On my machine, I can paste it"
              onClick={() => {
                track('onboarding.source.selected', { source: 'local' })
                goToEditor()
              }}
            />
            <SourceCard
              icon={<Brain className="h-6 w-6" />}
              title="In my head"
              description="I want to write one from scratch"
              onClick={() => {
                track('onboarding.source.selected', { source: 'in-head' })
                goToEditor()
              }}
            />
            <SourceCard
              icon={<ExternalLink className="h-6 w-6" />}
              title="Elsewhere"
              description="In a prompt management tool"
              onClick={() => {
                track('onboarding.source.selected', { source: 'elsewhere' })
                setStep('elsewhere-pick')
              }}
            />
          </div>
        </div>
      )}

      {/* GitHub: public or private? */}
      {step === 'github-visibility' && (
        <div>
          <h1 className="font-display text-3xl font-bold text-earth-dark">
            Is the repo public or private?
          </h1>
          <p className="mt-2 text-text-mid">
            We only need your GitHub account for private repos.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <SourceCard
              icon={<GitHubIcon className="h-6 w-6" />}
              title="Public"
              description="Anyone can see it"
              onClick={() => {
                track('onboarding.github.visibility', { visibility: 'public' })
                setStep('github-public')
              }}
            />
            <SourceCard
              icon={<GitHubIcon className="h-6 w-6" />}
              title="Private"
              description="Only collaborators can access"
              onClick={() => {
                track('onboarding.github.visibility', { visibility: 'private' })
                setStep('github-private')
              }}
            />
          </div>
        </div>
      )}

      {/* GitHub public: enter repo URL */}
      {step === 'github-public' && (
        <div>
          <h1 className="font-display text-3xl font-bold text-earth-dark">
            Which repo?
          </h1>
          <p className="mt-2 text-text-mid">
            Enter the repo URL or owner/name. No sign-in needed.
          </p>

          <div className="mt-6">
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePublicRepo()}
              placeholder="e.g. openai/openai-cookbook"
              autoFocus
              className="w-full rounded-xl border border-warm bg-white py-3 px-4 text-earth-dark placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {repoError && <p className="mt-2 text-sm text-primary">{repoError}</p>}
          </div>

          <button
            onClick={handlePublicRepo}
            disabled={!repoUrl.trim() || repoChecking}
            className="mt-4 cursor-pointer rounded-full bg-primary px-6 py-2.5 font-medium text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {repoChecking ? 'Checking…' : 'Find Prompts'}
          </button>
        </div>
      )}

      {/* GitHub private: connect account */}
      {step === 'github-private' && (
        <div>
          <h1 className="font-display text-3xl font-bold text-earth-dark">
            Connect your GitHub
          </h1>
          <p className="mt-2 text-text-mid">
            We need access to read your private repos. Your prompts are never stored.
          </p>

          <div className="mt-8">
            <button
              onClick={() => {
                track('onboarding.signin.clicked', { from: 'github-private', signedIn: isSignedIn })
                if (isSignedIn) navigate('/app')
                else signInWithGitHub()
              }}
              className="flex items-center gap-2 rounded-full bg-earth-dark px-6 py-3 font-medium text-white transition hover:bg-earth"
            >
              <GitHubIcon className="h-5 w-5" />
              {isSignedIn ? 'Browse Your Repos' : 'Connect with GitHub'}
            </button>
          </div>
        </div>
      )}

      {/* Elsewhere: pick a tool */}
      {step === 'elsewhere-pick' && (
        <div>
          <h1 className="font-display text-3xl font-bold text-earth-dark">
            Where are your prompts managed?
          </h1>
          <p className="mt-2 text-text-mid">
            We'll show you how to copy your prompt into the editor.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {ELSEWHERE_TOOLS.map((tool) => (
              <SourceCard
                key={tool.id}
                icon={tool.icon}
                title={tool.name}
                description=""
                onClick={() => {
                  track('onboarding.elsewhere.tool', { tool: tool.id })
                  setElsewhereTool(tool.id)
                  setStep('elsewhere-instructions')
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Elsewhere: "coming soon" + scratch editor */}
      {step === 'elsewhere-instructions' && elsewhereTool && (() => {
        const tool = ELSEWHERE_TOOLS.find((t) => t.id === elsewhereTool)!
        const isOther = tool.id === 'other'
        return (
          <div>
            <h1 className="font-display text-3xl font-bold text-earth-dark">
              {isOther ? 'Which integration would you like to see?' : `${tool.name} integration, coming soon`}
            </h1>
            <p className="mt-2 text-text-mid">
              {isOther
                ? "We're planning direct integrations with more prompt management tools — tell us which one you'd like next and we'll bump it up the list."
                : `We're working on a direct ${tool.name} integration and have bumped it in priority based on interest.`}
            </p>

            {!isOther && (
              <p className="mt-6 text-text-mid">
                For now, paste your prompt straight into the scratch editor:
              </p>
            )}

            {isOther ? (
              <a
                href="mailto:team@artanis.ai?subject=Mallet%20integration%20request&body=Hi%20Artanis%20team%2C%0A%0AI%27d%20love%20to%20see%20Mallet%20integrate%20with%3A%20"
                onClick={() => track('onboarding.elsewhere.contact-clicked')}
                className="mt-6 inline-block cursor-pointer rounded-full bg-primary px-6 py-2.5 font-medium text-white transition hover:bg-primary-dark"
              >
                Contact us
              </a>
            ) : (
              <button
                onClick={() => goToEditor()}
                className="mt-4 cursor-pointer rounded-full bg-primary px-6 py-2.5 font-medium text-white transition hover:bg-primary-dark"
              >
                Open Scratch Editor
              </button>
            )}
          </div>
        )
      })()}
    </div>
  )
}

function SourceCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-4 rounded-xl border border-warm bg-white p-5 text-left transition hover:border-primary/30 hover:shadow-md"
    >
      <div className="mt-0.5 text-earth">{icon}</div>
      <div>
        <div className="font-semibold text-earth-dark">{title}</div>
        {description && <div className="mt-0.5 text-sm text-text-muted">{description}</div>}
      </div>
    </button>
  )
}
