import { Hono } from 'hono'
import { createOpenAIClient } from '../lib/openai'
import { logAction } from '../lib/logging'
import type { Env, SuggestRequest } from '../types'

const app = new Hono<{ Bindings: Env }>()

const SUGGEST_SYSTEM_PROMPT = `You are a prompt engineering expert. Given a segment of an AI prompt that has an identified issue, suggest an improved version.

Return JSON with:
- original: the original text (exactly as provided)
- suggested: the improved text
- explanation: a brief explanation of why this is better (1-2 sentences)

Keep the suggested text as close to the original as possible — only change what is necessary to fix the issue. Preserve the author's intent, style, and voice.`

interface SuggestRequestWithContext extends SuggestRequest {
  repoOwner?: string
  repoName?: string
  branch?: string
  filePath?: string
  roomId?: string
}

app.post('/', async (c) => {
  const body = await c.req.json<SuggestRequestWithContext>()
  const { segmentText, issueType, fullPrompt, message, repoOwner, repoName, branch, filePath, roomId } = body

  if (!segmentText?.trim()) {
    return c.json({ error: 'No segment text provided' }, 400)
  }

  const client = createOpenAIClient(c.env.OPENAI_API_KEY)

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SUGGEST_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Issue type: ${issueType}\nIssue: ${message}\n\nSegment with issue:\n"${segmentText}"\n\nFull prompt for context:\n${fullPrompt}\n\nReturn JSON: { "original": "...", "suggested": "...", "explanation": "..." }`,
        },
      ],
      temperature: 0.3,
    })

    const content = completion.choices[0]?.message?.content
    if (!content) {
      return c.json({ error: 'No suggestion generated' }, 500)
    }

    const suggestion = JSON.parse(content)

    await logAction(c, 'suggest', {
      issueType,
      segmentLength: segmentText.length,
      promptLength: fullPrompt?.length ?? 0,
      repoOwner: repoOwner ?? null,
      repoName: repoName ?? null,
      branch: branch ?? null,
      filePath: filePath ?? null,
      roomId: roomId ?? null,
    })

    return c.json(suggestion)
  } catch (err) {
    console.error('Suggestion error:', err)
    return c.json({ error: 'Suggestion generation failed' }, 500)
  }
})

export default app
