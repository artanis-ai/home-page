/**
 * Authenticated, incremental analyze endpoint used by the editor.
 *
 * Thin wrapper over `lib/analyzer.analyzePrompt` — the actual model
 * fan-out, prompts, and usage aggregation live there so the public
 * skill endpoint (`/api/public/analyze`) can reuse identical behavior.
 *
 * This route takes pre-segmented input + `changedHashes` so the editor
 * only re-checks what the user just typed; the public endpoint passes
 * no changedHashes and re-checks the entire prompt each call.
 */
import { Hono } from 'hono'
import { analyzePrompt, type AnalyzerTask } from '../lib/analyzer'
import type { Segment } from '../lib/segmenter'
import { logAction } from '../lib/logging'
import type { Env } from '../types'

const app = new Hono<{ Bindings: Env }>()

interface AnalyzeRequest {
  segments: Segment[]
  changedHashes?: string[]
  // Explicit task batch from the client. When set, the analyzer runs
  // EXACTLY these tasks and ignores `changedHashes`. The client uses this
  // to spread a large prompt's N² pair fan-out across multiple requests
  // so we stay under Cloudflare's 1000-subrequest-per-invocation limit.
  tasks?: AnalyzerTask[]
  // Optional file context — passed by the editor for telemetry only.
  // The analyzer doesn't use these; they're logged so we can attribute
  // analysis activity to a specific repo/file.
  repoOwner?: string
  repoName?: string
  branch?: string
  filePath?: string
  roomId?: string
}

app.post('/', async (c) => {
  const start = Date.now()
  const body = await c.req.json<AnalyzeRequest>()
  const { segments, changedHashes, tasks, repoOwner, repoName, branch, filePath, roomId } = body

  if (!segments || segments.length === 0) {
    return c.json({ issues: [] })
  }

  if (tasks) {
    console.log(`[analyze] ${tasks.length} explicit tasks over ${segments.length} segments`)
  } else {
    console.log(`[analyze] ${changedHashes?.length ?? 0} changed of ${segments.length} total segments`)
  }

  const { issues, usage } = await analyzePrompt({
    segments,
    changedHashes: changedHashes || [],
    tasks,
    openaiKey: c.env.OPENAI_API_KEY,
  })

  const elapsed = Date.now() - start
  console.log(
    `[analyze] Done: ${issues.length} issues in ${elapsed}ms (${usage.tasks} tasks, ${usage.inputTokens}in/${usage.outputTokens}out tok)`
  )

  // Issue-type breakdown — counts only, no messages (those can echo prompt text).
  const byType: Record<string, number> = {}
  for (const issue of issues) byType[issue.type] = (byType[issue.type] ?? 0) + 1

  await logAction(c, 'analyze', {
    segmentCount: segments.length,
    changedCount: changedHashes?.length ?? 0,
    explicitTaskCount: tasks?.length ?? null,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    tasks: usage.tasks,
    issueCount: issues.length,
    issueTypes: byType,
    elapsedMs: elapsed,
    repoOwner: repoOwner ?? null,
    repoName: repoName ?? null,
    branch: branch ?? null,
    filePath: filePath ?? null,
    roomId: roomId ?? null,
  })

  // Echo usage so eval can price runs without scraping wrangler logs.
  return c.json({ issues, usage })
})

export default app
