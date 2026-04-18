import { useState, useRef, useEffect } from 'react'
import { AlertTriangle, HelpCircle, Lightbulb, ChevronRight, Check, X, Loader2 } from 'lucide-react'
import { WORKER_URL, authedFetch } from '../../lib/api'
import type { AnalysisIssue, Suggestion } from '../../types'

const issueIcons: Record<string, typeof AlertTriangle> = {
  contradiction: AlertTriangle,
  ambiguity: HelpCircle,
  'best-practice': Lightbulb,
}

const issueColors: Record<string, string> = {
  contradiction: 'text-primary',
  ambiguity: 'text-accent',
  'best-practice': 'text-earth',
}

const issueLabels: Record<string, string> = {
  contradiction: 'Contradiction',
  ambiguity: 'Ambiguity',
  'best-practice': 'Best Practice',
}

interface AnalysisPanelProps {
  content: string
  issues: AnalysisIssue[]
  activeIssueId: string | null
  onIssueClick: (id: string | null) => void
  onAcceptSuggestion: (range: [number, number], replacement: string) => void
  analyzing?: boolean
  /** Returns a Clerk session JWT for the /api/suggest call. */
  getToken: () => Promise<string | null>
}

export function AnalysisPanel({
  content,
  issues,
  activeIssueId,
  onIssueClick,
  onAcceptSuggestion,
  analyzing,
  getToken,
}: AnalysisPanelProps) {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [loadingSuggestion, setLoadingSuggestion] = useState(false)
  const contentRef = useRef(content)
  contentRef.current = content

  async function fetchSuggestion(issue: AnalysisIssue) {
    // Read content from CM editor directly — React state is often stale with Yjs
    const cmLines = document.querySelectorAll('.cm-line')
    const editorText = cmLines.length > 0
      ? Array.from(cmLines).map(l => l.textContent || '').join('\n')
      : ''
    const currentContent = editorText || contentRef.current || content
    const segText = currentContent.slice(issue.range[0], issue.range[1])
    if (!segText.trim()) return
    setLoadingSuggestion(true)
    setSuggestion(null)
    try {
      const res = await authedFetch(getToken, `${WORKER_URL}/api/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segmentText: segText,
          issueType: issue.type,
          fullPrompt: currentContent,
          message: issue.message,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        console.error('[Mallet] Suggestion API error:', res.status, errText)
        return
      }
      const data = await res.json()
      setSuggestion(data)
    } catch (err) {
      console.error('[Mallet] Suggestion fetch error:', err)
    } finally {
      setLoadingSuggestion(false)
    }
  }

  const prevActiveRef = useRef<string | null>(null)

  // Auto-fetch suggestion when active issue changes (from cursor movement)
  useEffect(() => {
    if (activeIssueId && activeIssueId !== prevActiveRef.current) {
      const issue = issues.find(i => i.id === activeIssueId)
      if (issue) fetchSuggestion(issue)
      // Scroll active issue into view
      const el = document.querySelector(`[data-issue-id="${activeIssueId}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    prevActiveRef.current = activeIssueId
  }, [activeIssueId])

  return (
    <div className="flex h-full w-full flex-col border-l border-warm bg-white lg:w-80 lg:shrink-0">
      <div className="flex items-center justify-between border-b border-warm px-4 py-3">
        <h2 className="font-display text-lg font-semibold text-earth-dark">Analysis</h2>
        {analyzing && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
      </div>

      <div className="flex-1 overflow-auto">
        {issues.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            {content.trim() ? 'No issues found. Looking good!' : 'Start typing to see analysis.'}
          </div>
        )}

        {issues.map((issue) => {
          const Icon = issueIcons[issue.type] || Lightbulb
          const color = issueColors[issue.type] || 'text-earth'
          const label = issueLabels[issue.type] || issue.type
          const isActive = issue.id === activeIssueId

          return (
            <div key={issue.id} className="border-b border-warm">
              <button
                data-issue-id={issue.id}
                onClick={() => {
                  onIssueClick(isActive ? null : issue.id)
                  if (!isActive) fetchSuggestion(issue)
                }}
                className={`flex w-full cursor-pointer items-start gap-3 p-4 text-left transition ${
                  isActive ? 'bg-warm' : 'hover:bg-cream'
                }`}
              >
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
                <div className="min-w-0 flex-1">
                  <div className={`text-xs font-medium uppercase tracking-wide ${color}`}>
                    {label}
                  </div>
                  <p className="mt-1 text-sm text-text-dark">{issue.message}</p>
                  <p className="mt-1 font-mono text-xs text-text-muted">
                    {content.slice(issue.range[0], Math.min(issue.range[1], issue.range[0] + 50))}
                    {issue.range[1] - issue.range[0] > 50 ? '...' : ''}
                  </p>
                </div>
                <ChevronRight className={`mt-0.5 h-4 w-4 shrink-0 text-text-muted transition ${isActive ? 'rotate-90' : ''}`} />
              </button>

              {isActive && (
                <div className="bg-cream px-4 pb-4 pt-3">
                  <h3 className="mb-3 text-center text-xs font-semibold uppercase tracking-wide text-earth-dark">
                    Suggestion
                  </h3>

                  {loadingSuggestion && (
                    <div className="rounded-lg border border-warm bg-white p-3">
                      <div className="mb-2 h-3 w-3/4 animate-pulse rounded bg-warm" />
                      <div className="space-y-1.5">
                        <div className="h-3 w-full animate-pulse rounded bg-warm" />
                        <div className="h-3 w-11/12 animate-pulse rounded bg-warm" />
                        <div className="h-3 w-4/5 animate-pulse rounded bg-warm" />
                      </div>
                    </div>
                  )}

                  {suggestion && !loadingSuggestion && (
                    <div>
                      <div className="mb-3 rounded-lg border border-warm bg-white p-3">
                        <div className="mb-1 font-mono text-xs">
                          <span className="bg-primary/10 text-primary line-through">{suggestion.original}</span>
                        </div>
                        <div className="font-mono text-xs">
                          <span className="bg-forest/10 text-forest">{suggestion.suggested}</span>
                        </div>
                      </div>
                      {suggestion.explanation && (
                        <p className="mb-3 text-xs text-text-muted">{suggestion.explanation}</p>
                      )}
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => {
                            if (suggestion) {
                              onAcceptSuggestion(issue.range, suggestion.suggested)
                            }
                            onIssueClick(null)
                            setSuggestion(null)
                          }}
                          className="flex cursor-pointer items-center gap-1 rounded-lg bg-forest px-3 py-1.5 text-xs font-medium text-white transition hover:bg-forest-light"
                        >
                          <Check className="h-3 w-3" />
                          Accept
                        </button>
                        <button
                          onClick={() => { onIssueClick(null); setSuggestion(null) }}
                          className="flex cursor-pointer items-center gap-1 rounded-lg border border-warm px-3 py-1.5 text-xs text-text-mid transition hover:bg-warm"
                        >
                          <X className="h-3 w-3" />
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
