import { Hono } from 'hono'
import { createOpenAIClient } from '../lib/openai'
import { logAction } from '../lib/logging'
import { requireGitHubToken, type AuthVars } from '../lib/auth'
import type { Env, DetectPromptsRequest } from '../types'

const app = new Hono<{ Bindings: Env; Variables: AuthVars }>()

app.use('*', requireGitHubToken())

const DETECT_SYSTEM_PROMPT = `You are an expert at finding AI prompts in codebases. Given a list of files from a GitHub repository, identify which files or code locations likely contain AI/LLM prompts.

Look for:
- Files with "prompt", "system", "instruction", "template" in the name
- String literals that look like system/user prompts (long strings with instructions)
- Template strings with placeholders ({{variable}}, {variable}, etc.)
- Constants or variables named "SYSTEM_PROMPT", "prompt", "instructions", etc.
- Files that import OpenAI, Anthropic, or other LLM SDKs and contain prompt strings

Return JSON: { "prompts": [{ "path": "file/path", "confidence": 0.0-1.0, "snippet": "brief excerpt" }] }
Only return results with confidence >= 0.5. Sort by confidence descending.`

app.post('/', async (c) => {
  const body = await c.req.json<DetectPromptsRequest>()
  const { repoOwner, repoName } = body
  const accessToken = c.get('githubToken')

  if (!repoOwner || !repoName) {
    return c.json({ error: 'Missing required fields' }, 400)
  }

  // Defensive validation: prevent path injection in URL
  if (!/^[\w.-]+$/.test(repoOwner) || !/^[\w.-]+$/.test(repoName)) {
    return c.json({ error: 'Invalid repo owner or name' }, 400)
  }

  try {
    // Fetch repo tree
    const treeRes = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/git/trees/HEAD?recursive=1`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Mallet-API',
        },
      }
    )

    if (!treeRes.ok) {
      return c.json({ error: 'Failed to fetch repo tree' }, 400)
    }

    const tree = await treeRes.json() as { tree: { path: string; type: string }[] }

    // Filter to code files (limit to prevent huge payloads)
    const codeFiles = tree.tree
      .filter(
        (f: { path: string; type: string }) =>
          f.type === 'blob' &&
          !f.path.includes('node_modules') &&
          !f.path.includes('.git/') &&
          !f.path.startsWith('.') &&
          /\.(ts|tsx|js|jsx|py|go|rb|rs|java|md|txt|yaml|yml|json|prompt)$/.test(f.path)
      )
      .slice(0, 200)

    // For promising files, fetch their contents
    const promisingFiles = codeFiles.filter((f: { path: string }) =>
      /prompt|system|instruct|template|agent/i.test(f.path)
    ).slice(0, 10)

    const fileContents: { path: string; content: string }[] = []
    for (const file of promisingFiles) {
      try {
        const contentRes = await fetch(
          `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${file.path}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/vnd.github.v3.raw',
              'User-Agent': 'Mallet-API',
            },
          }
        )
        if (contentRes.ok) {
          const text = await contentRes.text()
          fileContents.push({ path: file.path, content: text.slice(0, 2000) })
        }
      } catch {
        // skip files we can't read
      }
    }

    const client = createOpenAIClient(c.env.OPENAI_API_KEY)

    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: DETECT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Repository: ${repoOwner}/${repoName}\n\nAll files in repo:\n${codeFiles.map((f: { path: string }) => f.path).join('\n')}\n\nContents of promising files:\n${fileContents.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n')}\n\nFind the prompts. Return JSON: { "prompts": [...] }`,
        },
      ],
      temperature: 0.1,
    })

    const content = completion.choices[0]?.message?.content
    if (!content) {
      return c.json({ prompts: [] })
    }

    const result = JSON.parse(content)

    await logAction(c.env, 'detect-prompts', {
      repoOwner,
      repoName,
      totalFiles: codeFiles.length,
      promptsFound: result.prompts?.length || 0,
    })

    return c.json(result)
  } catch (err) {
    console.error('Detect prompts error:', err)
    return c.json({ prompts: [], error: 'Detection failed' }, 500)
  }
})

export default app
