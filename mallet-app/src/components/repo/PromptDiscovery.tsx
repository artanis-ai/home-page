import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useSession } from '../../hooks/useSession'
import { FileText, Search, Loader2, Bot, Check } from 'lucide-react'
import { useGitHubToken } from '../../hooks/useGitHubToken'
import { WORKER_URL, publicFetch } from '../../lib/api'
import { formatLineRangeHash } from '../../lib/line-range'
import type { DetectedPrompt } from '../../types'

interface TreeFile {
  path: string
  type: string
  sha: string
}

// Browsing the full tree is the fallback after the agent. Binary and
// build-output extensions would just confuse the user if they clicked
// them; the editor's no-op on binary still renders garbage, so filter
// here instead of at the edit boundary.
const BROWSABLE_EXT_RE = /\.(md|txt|mdx|prompt|rst|ts|tsx|js|jsx|mjs|cjs|py|go|rb|rs|java|kt|scala|swift|c|h|cpp|cc|cs|php|sh|bash|zsh|fish|sql|yaml|yml|toml|json|jsonc|xml|html|css|scss|sass|less|vue|svelte|astro|lua|r|jl|ex|exs|erl|clj|cljs|dart|f|f90|fs|ml|nim|zig)$/i

type DiscoveryStep = 'scanning' | 'select' | 'agent' | 'browse' | 'empty'

export function PromptDiscovery() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>()
  const { getToken } = useSession()
  const getGitHubToken = useGitHubToken()
  const navigate = useNavigate()

  const [step, setStep] = useState<DiscoveryStep>('scanning')
  const [candidates, setCandidates] = useState<TreeFile[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [agentResults, setAgentResults] = useState<DetectedPrompt[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Default branch resolved from GitHub. Many public repos still use `master`,
  // so hardcoding `main` would 404 in the editor.
  const [defaultBranch, setDefaultBranch] = useState('main')
  // Full text/code file list from the repo tree — used by the browse step.
  // We stash this during scanRepo so we don't re-fetch when the user lands
  // on 'browse' from either the select or agent fallbacks.
  const [browseFiles, setBrowseFiles] = useState<TreeFile[]>([])
  const [browseQuery, setBrowseQuery] = useState('')

  const filteredBrowseFiles = useMemo(() => {
    const q = browseQuery.trim().toLowerCase()
    if (!q) return browseFiles.slice(0, 200)
    return browseFiles.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 200)
  }, [browseFiles, browseQuery])

  useEffect(() => {
    scanRepo()
  }, [owner, repo])

  async function scanRepo() {
    try {
      const token = await getGitHubToken()
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      // Resolve default branch up front — many repos still use `master` and
      // we'll need this when building /gh/:owner/:repo/blob/:branch/... URLs.
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
      if (!repoRes.ok) throw new Error('Repository not found or is private')
      const repoData = await repoRes.json()
      const branch = repoData.default_branch || 'main'
      setDefaultBranch(branch)

      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
        { headers }
      )
      if (!res.ok) throw new Error('Failed to fetch repo tree')
      const data = await res.json()

      const allBlobs = (data.tree as TreeFile[]).filter(
        (f) =>
          f.type === 'blob' &&
          !f.path.startsWith('.') &&
          !f.path.includes('node_modules') &&
          !f.path.includes('/dist/') &&
          !f.path.includes('/build/')
      )

      // Browsable = all text/code files, prioritised by likely prompt keywords
      // first so the user sees obvious candidates at the top of the list.
      const browsable = allBlobs
        .filter((f) => BROWSABLE_EXT_RE.test(f.path))
        .sort((a, b) => {
          const aScore = /prompt|system|instruct|template|agent/i.test(a.path) ? 0 : 1
          const bScore = /prompt|system|instruct|template|agent/i.test(b.path) ? 0 : 1
          return aScore - bScore || a.path.localeCompare(b.path)
        })
      setBrowseFiles(browsable)

      const promptFiles = allBlobs.filter(
        (f) =>
          (f.path.endsWith('.md') || f.path.endsWith('.txt') || f.path.endsWith('.prompt')) &&
          !f.path.toLowerCase().includes('readme') &&
          !f.path.toLowerCase().includes('license') &&
          !f.path.toLowerCase().includes('changelog')
      )

      if (promptFiles.length > 0) {
        promptFiles.sort((a, b) => {
          const aScore = /prompt|system|instruction/i.test(a.path) ? 0 : 1
          const bScore = /prompt|system|instruction/i.test(b.path) ? 0 : 1
          return aScore - bScore
        })
        setCandidates(promptFiles)
        setStep('select')
      } else {
        // Fall through to the agent — /api/detect-prompts works for anon
        // callers on public repos too, so we always try it before giving up.
        setStep('agent')
        runAgent()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan repository')
      setStep('empty')
    }
  }

  async function runAgent() {
    setLoading(true)
    try {
      const res = await publicFetch(getToken, `${WORKER_URL}/api/detect-prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoOwner: owner, repoName: repo }),
      })
      if (!res.ok) throw new Error('Agent search failed')
      const data = await res.json()

      if (data.prompts && data.prompts.length > 0) {
        setAgentResults(data.prompts)
      } else {
        setStep('browse')
      }
    } catch {
      setStep('browse')
    } finally {
      setLoading(false)
    }
  }

  function handleContinue() {
    if (!selected) return
    navigate(`/gh/${owner}/${repo}/blob/${defaultBranch}/${selected}`)
  }

  function handleNoneOfThese() {
    setStep('agent')
    runAgent()
  }

  function openScratchEditor() {
    const uuid = crypto.randomUUID().slice(0, 8)
    navigate(`/d/${uuid}`)
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
            We found these files that might contain prompts. Pick the one you'd like to edit:
          </p>
          <div className="space-y-2">
            {candidates.map((f) => {
              const isSelected = selected === f.path
              return (
                <button
                  key={f.path}
                  onClick={() => setSelected(f.path)}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border p-4 text-left transition ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-warm bg-white hover:border-primary/30'
                  }`}
                >
                  <div
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      isSelected ? 'border-primary bg-primary text-white' : 'border-text-muted'
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                  <FileText className="h-5 w-5 shrink-0 text-text-muted" />
                  <span className="font-mono text-sm text-earth-dark">{f.path}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={handleContinue}
              disabled={!selected}
              className="cursor-pointer rounded-full bg-primary px-6 py-2.5 font-medium text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open selected file
            </button>
            <button
              onClick={handleNoneOfThese}
              className="cursor-pointer rounded-full border border-warm px-6 py-2.5 font-medium text-text-mid transition hover:bg-warm"
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
              <p className="mb-4 text-text-mid">Our agent found these potential prompt locations. Pick one to open:</p>
              <div className="space-y-2">
                {agentResults.map((r, i) => {
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
                        navigate(`/gh/${owner}/${repo}/blob/${defaultBranch}/${r.path}${hash}`)
                      }}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-warm bg-white p-4 text-left transition hover:border-primary/30"
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
                onClick={() => setStep('browse')}
                className="mt-4 cursor-pointer text-sm text-text-muted underline hover:text-text-mid"
              >
                None of these are right — let me browse the repo
              </button>
            </div>
          ) : null}
        </div>
      )}

      {step === 'browse' && (
        <div>
          <h2 className="font-display text-xl font-semibold text-earth-dark">
            We couldn't find your prompt automatically
          </h2>
          <p className="mt-1 mb-4 text-text-mid">
            Browse the repo and pick any file to open in the editor.
          </p>
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={browseQuery}
              onChange={(e) => setBrowseQuery(e.target.value)}
              placeholder="Filter by path…"
              autoFocus
              className="w-full rounded-xl border border-warm bg-white py-2.5 pl-9 pr-4 text-earth-dark placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {browseFiles.length === 0 ? (
            <div className="rounded-xl border border-warm bg-white p-6 text-center text-text-mid">
              This repo has no browsable text files.
              <button
                onClick={openScratchEditor}
                className="ml-2 cursor-pointer text-primary underline hover:text-primary-dark"
              >
                Open scratch editor
              </button>
            </div>
          ) : (
            <>
              <div className="max-h-[60vh] space-y-1 overflow-auto rounded-xl border border-warm bg-white p-2">
                {filteredBrowseFiles.map((f) => (
                  <button
                    key={f.path}
                    onClick={() => navigate(`/gh/${owner}/${repo}/blob/${defaultBranch}/${f.path}`)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-warm"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-text-muted" />
                    <span className="truncate font-mono text-sm text-earth-dark">{f.path}</span>
                  </button>
                ))}
                {filteredBrowseFiles.length === 0 && (
                  <p className="px-3 py-4 text-center text-sm text-text-muted">
                    No files match "{browseQuery}".
                  </p>
                )}
              </div>
              {browseFiles.length > filteredBrowseFiles.length && !browseQuery && (
                <p className="mt-2 text-xs text-text-muted">
                  Showing first 200 of {browseFiles.length} files — use the filter to narrow down.
                </p>
              )}
              <div className="mt-4 text-sm text-text-muted">
                Can't find it?{' '}
                <button
                  onClick={openScratchEditor}
                  className="cursor-pointer text-primary underline hover:text-primary-dark"
                >
                  Open scratch editor instead
                </button>
                .
              </div>
            </>
          )}
        </div>
      )}

      {step === 'empty' && (
        <div className="rounded-xl border border-warm bg-white p-8 text-center">
          <FileText className="mx-auto h-10 w-10 text-text-muted" />
          <h2 className="mt-4 font-display text-xl font-semibold text-earth-dark">
            No prompts detected in this repo
          </h2>
          <p className="mt-2 text-text-mid">
            Open the scratch editor and paste your prompt straight in to get started.
          </p>
          <button
            onClick={openScratchEditor}
            className="mt-6 cursor-pointer rounded-full bg-primary px-6 py-2.5 font-medium text-white transition hover:bg-primary-dark"
          >
            Open Scratch Editor
          </button>
        </div>
      )}
    </div>
  )
}
