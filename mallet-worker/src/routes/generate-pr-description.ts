import { Hono } from 'hono'
import { createOpenAIClient } from '../lib/openai'
import { logAction } from '../lib/logging'
import { requireGitHubToken, type AuthVars } from '../lib/auth'
import type { Env, GeneratePRDescriptionRequest } from '../types'

const app = new Hono<{ Bindings: Env; Variables: AuthVars }>()

app.use('*', requireGitHubToken())

const SYSTEM_PROMPT = `You write concise, well-structured GitHub pull request descriptions for changes to AI prompt files.

Output GitHub-flavoured Markdown only — no preamble, no surrounding fences. Aim for around 80-180 words. Structure:

## Summary
One short paragraph: what changed and why it matters.

## Changes
- Bullet list of the substantive edits (skip cosmetic noise).

Stay grounded in the diff. Don't invent rationale. If the change is trivial, keep the whole thing to a couple of lines and skip the bullets.`

async function fetchOriginal(
  repoOwner: string,
  repoName: string,
  filePath: string,
  accessToken: string,
): Promise<string> {
  const repoRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Mallet-API',
    },
  })
  if (!repoRes.ok) throw new Error(`GitHub repo fetch failed: ${repoRes.status}`)
  const repo = (await repoRes.json()) as { default_branch: string }

  const fileRes = await fetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}?ref=${repo.default_branch}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3.raw',
        'User-Agent': 'Mallet-API',
      },
    },
  )
  if (fileRes.status === 404) return ''
  if (!fileRes.ok) throw new Error(`GitHub file fetch failed: ${fileRes.status}`)
  return await fileRes.text()
}

app.post('/', async (c) => {
  const body = await c.req.json<GeneratePRDescriptionRequest>()
  const { repoOwner, repoName, filePath, content } = body
  const accessToken = c.get('githubToken')

  if (!repoOwner || !repoName || !filePath || typeof content !== 'string') {
    return c.json({ error: 'Missing required fields' }, 400)
  }
  if (!/^[\w.-]+$/.test(repoOwner) || !/^[\w.-]+$/.test(repoName)) {
    return c.json({ error: 'Invalid repo owner or name' }, 400)
  }

  const started = Date.now()
  try {
    const original = await fetchOriginal(repoOwner, repoName, filePath, accessToken)

    const client = createOpenAIClient(c.env.OPENAI_API_KEY)
    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      max_completion_tokens: 600,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `File: \`${filePath}\`\n\nOriginal:\n\`\`\`\n${original}\n\`\`\`\n\nUpdated:\n\`\`\`\n${content}\n\`\`\``,
        },
      ],
    })

    const description = completion.choices[0]?.message?.content?.trim()
    if (!description) {
      return c.json({ error: 'No description generated' }, 500)
    }

    await logAction(c, 'generate-pr-description', {
      repoOwner,
      repoName,
      filePath,
      originalLength: original.length,
      contentLength: content.length,
      durationMs: Date.now() - started,
    })

    return c.json({ description })
  } catch (err) {
    console.error('Generate PR description error:', err)
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to generate description' },
      500,
    )
  }
})

export default app
