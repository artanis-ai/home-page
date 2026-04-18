import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Lock, Globe, ChevronRight } from 'lucide-react'
import { useGitHubToken } from '../../hooks/useGitHubToken'

interface Repo {
  id: number
  full_name: string
  name: string
  owner: { login: string }
  private: boolean
  description: string | null
  updated_at: string
}

export function RepoConnector() {
  const getGitHubToken = useGitHubToken()
  const navigate = useNavigate()
  const [repos, setRepos] = useState<Repo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchRepos() {
      try {
        const token = await getGitHubToken()
        if (!token) {
          setError('Could not get GitHub access token. Please sign in again.')
          setLoading(false)
          return
        }
        const res = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch repositories')
        const data = await res.json()
        setRepos(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load repositories')
      } finally {
        setLoading(false)
      }
    }
    fetchRepos()
  }, [getGitHubToken])

  const filtered = repos.filter(
    (r) =>
      r.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (r.description && r.description.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-earth-dark">Connect a Repository</h1>
        <p className="mt-2 text-text-mid">
          Select a repo to find and improve your prompts.
        </p>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          placeholder="Search repositories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-warm bg-white py-3 pl-10 pr-4 text-text-dark placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-warm border-t-primary" />
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-primary">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-2">
          {filtered.map((repo) => (
            <button
              key={repo.id}
              onClick={() => navigate(`prompts/${repo.owner.login}/${repo.name}`)}
              className="flex w-full items-center gap-4 rounded-xl border border-warm bg-white p-4 text-left transition hover:border-primary/30 hover:shadow-md"
            >
              {repo.private ? (
                <Lock className="h-5 w-5 shrink-0 text-text-muted" />
              ) : (
                <Globe className="h-5 w-5 shrink-0 text-forest" />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-medium text-earth-dark">{repo.full_name}</div>
                {repo.description && (
                  <div className="mt-0.5 truncate text-sm text-text-muted">{repo.description}</div>
                )}
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-text-muted" />
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-text-muted">No repositories found.</p>
          )}
        </div>
      )}
    </div>
  )
}
