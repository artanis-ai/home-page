import { Hono } from 'hono'
import { logAction } from '../lib/logging'
import { requireGitHubToken, type AuthVars } from '../lib/auth'
import type { Env, CreatePRRequest } from '../types'

const app = new Hono<{ Bindings: Env; Variables: AuthVars }>()

app.use('*', requireGitHubToken())

async function githubAPI(
  endpoint: string,
  accessToken: string,
  options: RequestInit = {}
) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Mallet-API',
      ...((options.headers as Record<string, string>) || {}),
    },
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error((data as { message?: string }).message || `GitHub API error: ${res.status}`)
  }
  return data
}

app.post('/', async (c) => {
  const body = await c.req.json<CreatePRRequest>()
  const { repoOwner, repoName, filePath, content, commitMessage } = body
  const accessToken = c.get('githubToken')

  if (!repoOwner || !repoName || !filePath || !content) {
    return c.json({ error: 'Missing required fields' }, 400)
  }

  if (!/^[\w.-]+$/.test(repoOwner) || !/^[\w.-]+$/.test(repoName)) {
    return c.json({ error: 'Invalid repo owner or name' }, 400)
  }

  try {
    // 1. Get the default branch and its latest commit SHA
    const repo = await githubAPI(`/repos/${repoOwner}/${repoName}`, accessToken) as {
      default_branch: string
    }
    const defaultBranch = repo.default_branch

    const ref = await githubAPI(
      `/repos/${repoOwner}/${repoName}/git/ref/heads/${defaultBranch}`,
      accessToken
    ) as { object: { sha: string } }
    const baseSha = ref.object.sha

    // 2. Create a new branch
    const branchName = `mallet/improve-prompt-${Date.now()}`
    await githubAPI(`/repos/${repoOwner}/${repoName}/git/refs`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    })

    // 3. Get the current file to obtain its SHA (needed for update)
    let fileSha: string | undefined
    try {
      const existing = await githubAPI(
        `/repos/${repoOwner}/${repoName}/contents/${filePath}?ref=${branchName}`,
        accessToken
      ) as { sha: string }
      fileSha = existing.sha
    } catch {
      // File doesn't exist yet — will create
    }

    // 4. Commit the updated file
    const encoded = btoa(unescape(encodeURIComponent(content)))
    await githubAPI(
      `/repos/${repoOwner}/${repoName}/contents/${filePath}`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          message: commitMessage || `Improve prompt: ${filePath}`,
          content: encoded,
          branch: branchName,
          ...(fileSha ? { sha: fileSha } : {}),
        }),
      }
    )

    // 5. Create the pull request
    const pr = await githubAPI(
      `/repos/${repoOwner}/${repoName}/pulls`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          title: commitMessage || `Improve prompt: ${filePath}`,
          head: branchName,
          base: defaultBranch,
          body: `## Prompt improvements\n\nThis PR was created by [Mallet](https://artanis.ai/mallet) — a free & secure collaborative prompt editor by Artanis AI.\n\nChanges made to \`${filePath}\` based on static analysis and AI-powered suggestions.\n\n---\n*Prompts were never stored. All analysis was ephemeral.*`,
        }),
      }
    ) as { html_url: string; number: number }

    await logAction(c, 'create-pr', {
      repoOwner,
      repoName,
      filePath,
      prNumber: pr.number,
    })

    return c.json({ prUrl: pr.html_url, prNumber: pr.number })
  } catch (err) {
    console.error('Create PR error:', err)
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to create PR' },
      500
    )
  }
})

export default app
