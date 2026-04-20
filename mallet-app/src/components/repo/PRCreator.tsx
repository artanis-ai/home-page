import { useState } from 'react'
import { X, ExternalLink, Loader2, GitPullRequest, Check } from 'lucide-react'
import { useSession } from '../../hooks/useSession'
import { WORKER_URL, authedFetch } from '../../lib/api'

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
  const [description, setDescription] = useState('Prompt improvements suggested by Mallet, the free and secure prompt editor by Artanis AI.')
  const [creating, setCreating] = useState(false)
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create PR')
      }

      const data = await res.json()
      setPrUrl(data.prUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create PR')
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
                <label className="mb-1 block text-sm font-medium text-text-mid">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
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
