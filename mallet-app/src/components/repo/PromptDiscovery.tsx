import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useSession } from '../../hooks/useSession'
import { FileText, Search, Loader2, Bot, PenLine, Check } from 'lucide-react'
import { useGitHubToken } from '../../hooks/useGitHubToken'
import { WORKER_URL, authedFetch } from '../../lib/api'
import { formatLineRangeHash } from '../../lib/line-range'
import type { DetectedPrompt } from '../../types'

interface TreeFile {
  path: string
  type: string
  sha: string
}

type DiscoveryStep = 'scanning' | 'select' | 'agent' | 'manual'

export function PromptDiscovery() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>()
  const { getToken } = useSession()
  const getGitHubToken = useGitHubToken()
  const navigate = useNavigate()

  const [step, setStep] = useState<DiscoveryStep>('scanning')
  const [candidates, setCandidates] = useState<TreeFile[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [agentResults, setAgentResults] = useState<DetectedPrompt[]>([])
  const [manualPrompt, setManualPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    scanRepo()
  }, [owner, repo])

  async function scanRepo() {
    try {
      const token = await getGitHubToken()
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
        { headers }
      )
      if (!res.ok) throw new Error('Failed to fetch repo tree')
      const data = await res.json()

      const promptFiles = (data.tree as TreeFile[]).filter(
        (f) =>
          f.type === 'blob' &&
          (f.path.endsWith('.md') || f.path.endsWith('.txt') || f.path.endsWith('.prompt')) &&
          !f.path.startsWith('.') &&
          !f.path.includes('node_modules') &&
          !f.path.toLowerCase().includes('readme') &&
          !f.path.toLowerCase().includes('license') &&
          !f.path.toLowerCase().includes('changelog')
      )

      if (promptFiles.length > 0) {
        // Prioritize files with "prompt" or "system" in path
        promptFiles.sort((a, b) => {
          const aScore = /prompt|system|instruction/i.test(a.path) ? 0 : 1
          const bScore = /prompt|system|instruction/i.test(b.path) ? 0 : 1
          return aScore - bScore
        })
        setCandidates(promptFiles)
        setStep('select')
      } else {
        setStep('agent')
        if (token) runAgent()
        else setStep('manual')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan repository')
    }
  }

  async function runAgent() {
    setLoading(true)
    try {
      const res = await authedFetch(getToken, `${WORKER_URL}/api/detect-prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoOwner: owner, repoName: repo }),
      })
      if (!res.ok) throw new Error('Agent search failed')
      const data = await res.json()

      if (data.prompts && data.prompts.length > 0) {
        setAgentResults(data.prompts)
      } else {
        setStep('manual')
      }
    } catch {
      setStep('manual')
    } finally {
      setLoading(false)
    }
  }

  function toggleFile(path: string) {
    const next = new Set(selected)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setSelected(next)
  }

  function handleContinue() {
    if (selected.size === 0) return
    const paths = Array.from(selected)
    // Navigate to GitHub-style URL: /:owner/:repo/blob/main/:filepath
    navigate(`/gh/${owner}/${repo}/blob/main/${paths[0]}`)
  }

  function handleNoneOfThese() {
    getGitHubToken().then((token) => {
      if (token) {
        setStep('agent')
        runAgent()
      } else {
        setStep('manual')
      }
    })
  }

  function handleManualSubmit() {
    if (!manualPrompt.trim()) return
    const uuid = crypto.randomUUID().slice(0, 8)
    navigate(`/d/${uuid}`, {
      state: { manualPrompt: manualPrompt.trim() },
    })
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-earth-dark">Find Your Prompts</h1>
        <p className="mt-2 text-text-mid">
          <span className="font-medium text-earth">{owner}/{repo}</span>
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4 text-primary">
          {error}
        </div>
      )}

      {step === 'scanning' && (
        <div className="flex flex-col items-center gap-4 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-text-mid">Scanning repository for prompts...</p>
        </div>
      )}

      {step === 'select' && (
        <div>
          <p className="mb-4 text-text-mid">
            We found these files that might contain prompts. Select the ones you'd like to edit:
          </p>
          <div className="space-y-2">
            {candidates.map((f) => (
              <button
                key={f.path}
                onClick={() => toggleFile(f.path)}
                className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition ${
                  selected.has(f.path)
                    ? 'border-primary bg-primary/5'
                    : 'border-warm bg-white hover:border-primary/30'
                }`}
              >
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                    selected.has(f.path) ? 'border-primary bg-primary text-white' : 'border-text-muted'
                  }`}
                >
                  {selected.has(f.path) && <Check className="h-3 w-3" />}
                </div>
                <FileText className="h-5 w-5 shrink-0 text-text-muted" />
                <span className="font-mono text-sm text-earth-dark">{f.path}</span>
              </button>
            ))}
          </div>
          <div className="mt-6 flex gap-3">
            <button
              onClick={handleContinue}
              disabled={selected.size === 0}
              className="rounded-full bg-primary px-6 py-2.5 font-medium text-white transition hover:bg-primary-dark disabled:opacity-50"
            >
              Continue with {selected.size} file{selected.size !== 1 ? 's' : ''}
            </button>
            <button
              onClick={handleNoneOfThese}
              className="rounded-full border border-warm px-6 py-2.5 font-medium text-text-mid transition hover:bg-warm"
            >
              None of these are prompts
            </button>
          </div>
        </div>
      )}

      {step === 'agent' && (
        <div className="flex flex-col items-center gap-4 py-16">
          {loading ? (
            <>
              <Bot className="h-10 w-10 text-primary" />
              <p className="text-text-mid">AI agent is searching your codebase for prompts...</p>
              <p className="text-sm text-text-muted">This may take a moment.</p>
            </>
          ) : agentResults.length > 0 ? (
            <div className="w-full">
              <p className="mb-4 text-text-mid">Our agent found these potential prompt locations:</p>
              <div className="space-y-2">
                {agentResults.map((r, i) => {
                  // Two prompts in one file share r.path, so key must include
                  // the line range (or index as fallback). Building the URL
                  // fragment matches GitHub's own scheme: …/foo.py#L1-L8.
                  const hasRange = typeof r.lineStart === 'number' && typeof r.lineEnd === 'number'
                  const hash = hasRange
                    ? formatLineRangeHash({ start: r.lineStart!, end: r.lineEnd! })
                    : ''
                  const key = `${r.path}${hash}#${i}`
                  const label = hasRange ? `${r.path}${hash}` : r.path
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        navigate(`/gh/${owner}/${repo}/blob/main/${r.path}${hash}`)
                      }}
                      className="flex w-full items-center gap-3 rounded-xl border border-warm bg-white p-4 text-left transition hover:border-primary/30"
                    >
                      <Search className="h-5 w-5 shrink-0 text-forest" />
                      <div>
                        <div className="font-mono text-sm text-earth-dark">{label}</div>
                        <div className="mt-1 text-sm text-text-muted">{r.snippet}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
              <button
                onClick={() => setStep('manual')}
                className="mt-4 text-sm text-text-muted underline hover:text-text-mid"
              >
                None of these, let me paste my prompt
              </button>
            </div>
          ) : null}
        </div>
      )}

      {step === 'manual' && (
        <div>
          <div className="mb-4 flex items-center gap-2 text-text-mid">
            <PenLine className="h-5 w-5" />
            <p>Paste your prompt below to get started:</p>
          </div>
          <textarea
            value={manualPrompt}
            onChange={(e) => setManualPrompt(e.target.value)}
            placeholder="You are a helpful assistant that..."
            rows={12}
            className="w-full rounded-xl border border-warm bg-white p-4 font-mono text-sm text-earth-dark placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button
            onClick={handleManualSubmit}
            disabled={!manualPrompt.trim()}
            className="mt-4 rounded-full bg-primary px-6 py-2.5 font-medium text-white transition hover:bg-primary-dark disabled:opacity-50"
          >
            Open in Editor
          </button>
        </div>
      )}
    </div>
  )
}
