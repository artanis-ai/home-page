import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MoreHorizontal, FileText, Brain, ExternalLink } from 'lucide-react'
import { useSession } from '../../hooks/useSession'
import {
  GitHubIcon,
  LangfuseIcon,
  LangSmithIcon,
  HumanloopIcon,
  PromptLayerIcon,
} from '../shared/BrandIcons'

type Step = 'source' | 'github-visibility' | 'github-public' | 'github-private' | 'elsewhere-pick' | 'elsewhere-instructions'
type ElsewhereTool = 'langfuse' | 'langsmith' | 'promptlayer' | 'humanloop' | 'other'

const ELSEWHERE_TOOLS: { id: ElsewhereTool; name: string; icon: React.ReactNode; instructions: string }[] = [
  { id: 'langfuse', name: 'Langfuse', icon: <LangfuseIcon className="h-5 w-5" />, instructions: 'In Langfuse, go to Prompts in the left sidebar. Select your prompt, then click the prompt version you want to edit. Select the template text and copy it (Ctrl/Cmd+C).' },
  { id: 'langsmith', name: 'LangSmith', icon: <LangSmithIcon className="h-5 w-5" />, instructions: 'In LangSmith, go to Prompts in the left sidebar. Click on your prompt, then select the template tab. Copy the prompt template text (Ctrl/Cmd+C).' },
  { id: 'promptlayer', name: 'PromptLayer', icon: <PromptLayerIcon className="h-5 w-5" />, instructions: 'In PromptLayer, go to the Registry. Click on your prompt template to open it. Select the template body text and copy it (Ctrl/Cmd+C).' },
  { id: 'humanloop', name: 'Humanloop', icon: <HumanloopIcon className="h-5 w-5" />, instructions: 'In Humanloop, open your project and go to the Editor. Select the prompt template text in the editor pane and copy it (Ctrl/Cmd+C).' },
  { id: 'other', name: 'Other', icon: <MoreHorizontal className="h-5 w-5" />, instructions: 'Open your prompt management tool, find the prompt you want to improve, and copy the full template text. Then paste it into the Mallet editor.' },
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

  function goToEditor(prompt?: string) {
    const uuid = crypto.randomUUID().slice(0, 8)
    navigate(`/d/${uuid}`, {
      state: { manualPrompt: prompt || '' },
    })
  }

  function goBack() {
    if (step === 'elsewhere-instructions') setStep('elsewhere-pick')
    else if (step.startsWith('elsewhere') || step.startsWith('github')) setStep('source')
    else setStep('source')
  }

  function handlePublicRepo() {
    setRepoError('')
    const match = repoUrl.trim().match(/(?:github\.com\/)?([^/\s]+)\/([^/\s]+?)(?:\.git)?$/)
    if (!match) {
      setRepoError('Enter a valid repo, e.g. owner/repo or github.com/owner/repo')
      return
    }
    navigate(`/app/prompts/${match[1]}/${match[2]}`)
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
                if (isSignedIn) navigate('/app')
                else setStep('github-visibility')
              }}
            />
            <SourceCard
              icon={<FileText className="h-6 w-6" />}
              title="Locally"
              description="On my machine, I can paste it"
              onClick={() => goToEditor()}
            />
            <SourceCard
              icon={<Brain className="h-6 w-6" />}
              title="In my head"
              description="I want to write one from scratch"
              onClick={() => goToEditor()}
            />
            <SourceCard
              icon={<ExternalLink className="h-6 w-6" />}
              title="Elsewhere"
              description="In a prompt management tool"
              onClick={() => setStep('elsewhere-pick')}
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
              onClick={() => setStep('github-public')}
            />
            <SourceCard
              icon={<GitHubIcon className="h-6 w-6" />}
              title="Private"
              description="Only collaborators can access"
              onClick={() => setStep('github-private')}
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
            disabled={!repoUrl.trim()}
            className="mt-4 rounded-full bg-primary px-6 py-2.5 font-medium text-white transition hover:bg-primary-dark disabled:opacity-50"
          >
            Find Prompts
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
              onClick={isSignedIn ? () => navigate('/app') : signInWithGitHub}
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
                  setElsewhereTool(tool.id)
                  setStep('elsewhere-instructions')
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Elsewhere: instructions + go to editor */}
      {step === 'elsewhere-instructions' && elsewhereTool && (() => {
        const tool = ELSEWHERE_TOOLS.find((t) => t.id === elsewhereTool)!
        return (
          <div>
            <h1 className="font-display text-3xl font-bold text-earth-dark">
              Copy from {tool.name}
            </h1>

            <div className="mt-4 rounded-xl border border-warm bg-white p-4">
              <p className="text-text-mid">{tool.instructions}</p>
            </div>

            <p className="mt-6 text-text-mid">
              Then paste it into the editor:
            </p>

            <button
              onClick={() => goToEditor()}
              className="mt-4 rounded-full bg-primary px-6 py-2.5 font-medium text-white transition hover:bg-primary-dark"
            >
              Open Editor
            </button>
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
