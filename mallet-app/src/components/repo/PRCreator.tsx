import { useState } from 'react'
import { X, ExternalLink, Loader2, GitPullRequest, Check, Sparkles } from 'lucide-react'
import { useSession } from '../../hooks/useSession'
import { WORKER_URL, authedFetch } from '../../lib/api'
import { track } from '../../lib/track'

interface PRCreatorProps {
  owner: string
  repo: string
  filePath: string
  content: string
  onClose: () => void
}

export function PRCreator({ owner, repo, filePath, content, onClose }: PRCreatorProps) {
  const { getToken } = useSession()
  const [title, setTitle] = useState(`Improve prompt: ${filePath}`)
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      const res = await authedFetch(getToken, `${WORKER_URL}/api/generate-pr-description`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoOwner: owner, repoName: repo, filePath, content }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to generate description')
      }
      const data = await res.json()
      setDescription(data.description ?? '')
      track('pr.description.generated', { owner, repo, filePath, length: (data.description ?? '').length })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate description'
      track('pr.description.failed', { owner, repo, filePath, error: msg.slice(0, 200) })
      setError(msg)
    } finally {
      setGenerating(false)
    }
  }

  async function handleCreate() {
    setCreating(true)
    setError(null)

    try {
      const res = await authedFetch(getToken, `${WORKER_URL}/api/create-pr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoOwner: owner,
          repoName: repo,
          filePath,
          content,
          commitMessage: title,
          description,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create PR')
      }

      const data = await res.json()
      track('pr.created', { owner, repo, filePath, prNumber: data.prNumber, contentLength: content.length })
      setPrUrl(data.prUrl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create PR'
      track('pr.failed', { owner, repo, filePath, error: msg.slice(0, 200) })
      setError(msg)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-earth-dark">Create Pull Request</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-text-muted transition hover:bg-warm">
            <X className="h-5 w-5" />
          </button>
        </div>

        {prUrl ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-forest/10">
              <Check className="h-6 w-6 text-forest" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-earth-dark">PR Created!</h3>
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-primary underline hover:text-primary-dark"
            >
              Open on GitHub <ExternalLink className="h-4 w-4" />
            </a>
            <p className="mt-6 text-sm text-text-muted">
              See how it does in prod →{' '}
              <a
                href="https://calendar.notion.so/meet/yousef/sam"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('pr.upsell.clicked')}
                className="font-medium text-primary underline hover:text-primary-dark"
              >
                Artanis
              </a>
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-text-mid">PR Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-warm px-3 py-2 text-sm text-earth-dark focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-sm font-medium text-text-mid">Description</label>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={generating || creating}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-warm px-3 py-1 text-xs font-medium text-text-mid transition hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    title="Generate a PR description from the diff"
                  >
                    {generating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {generating ? 'Generating…' : 'Generate'}
                  </button>
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  placeholder="Describe what changed and why. Or click Generate."
                  className="w-full rounded-lg border border-warm px-3 py-2 text-sm text-earth-dark focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary">
                {error}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={onClose}
                className="rounded-full border border-warm px-5 py-2 text-sm font-medium text-text-mid transition hover:bg-warm"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !title.trim()}
                className="flex items-center gap-1.5 rounded-full bg-forest px-5 py-2 text-sm font-medium text-white transition hover:bg-forest-light disabled:opacity-50"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <GitPullRequest className="h-4 w-4" />
                )}
                Create PR
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
