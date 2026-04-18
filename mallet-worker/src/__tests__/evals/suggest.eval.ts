/**
 * Quality eval for /api/suggest using an LLM-as-judge.
 *
 * For each positive fixture (a prompt where we expect issues), we run
 * analyze → suggest, then ask a judge model whether the suggestion
 * actually addresses the issue, preserves intent, and adds specificity.
 * Each suggestion gets a score 1–5 on each axis. The eval gates on the
 * mean total score across the corpus.
 *
 * Requires:
 *   - `wrangler dev` running on :8787
 *   - OPENAI_API_KEY in env (or .dev.vars — auto-loaded if not in env)
 *
 * Run via `npm run eval`.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { FIXTURES, type Fixture, type IssueType } from './fixtures'
import { segmentForEval } from './segmenter'

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787'
const AUTH = 'Bearer test_user_eval_suggest'
const JUDGE_MODEL = 'gpt-4.1-mini'

// ─── Bootstrap OPENAI_API_KEY from .dev.vars if missing ──────────────
function loadOpenAIKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  const dev = resolve(__dirname, '../../../.dev.vars')
  if (existsSync(dev)) {
    const txt = readFileSync(dev, 'utf-8')
    const m = txt.match(/^OPENAI_API_KEY\s*=\s*"?([^"\n]+)"?/m)
    if (m) return m[1]
  }
  throw new Error('OPENAI_API_KEY not found in env or mallet-worker/.dev.vars')
}

interface ApiIssue {
  id: string
  type: IssueType
  severity: string
  range: [number, number]
  message: string
}

async function analyze(prompt: string): Promise<ApiIssue[]> {
  const segments = segmentForEval(prompt)
  if (segments.length === 0) return []
  const res = await fetch(`${WORKER_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: AUTH },
    body: JSON.stringify({ segments, changedHashes: segments.map((s) => s.hash) }),
  })
  if (!res.ok) throw new Error(`analyze ${res.status}: ${await res.text()}`)
  return ((await res.json()) as { issues?: ApiIssue[] }).issues || []
}

interface Suggestion {
  original: string
  suggested: string
  explanation: string
}

async function suggest(
  segmentText: string,
  issueType: string,
  fullPrompt: string,
  message: string
): Promise<Suggestion> {
  const res = await fetch(`${WORKER_URL}/api/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: AUTH },
    body: JSON.stringify({ segmentText, issueType, fullPrompt, message }),
  })
  if (!res.ok) throw new Error(`suggest ${res.status}: ${await res.text()}`)
  return (await res.json()) as Suggestion
}

interface JudgeScore {
  addressesIssue: number      // 1-5
  preservesIntent: number     // 1-5
  improvesSpecificity: number // 1-5
  rationale: string
}

interface JudgeUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

// gpt-4.1-mini pricing as of 2026-04-18 ($/1M tokens). Update if OpenAI
// changes pricing — drift here would silently relax the cost ceiling.
const JUDGE_INPUT_USD_PER_1M = 0.4
const JUDGE_OUTPUT_USD_PER_1M = 1.6

function judgeUsageToCostUSD(u: JudgeUsage): number {
  return (
    (u.promptTokens / 1_000_000) * JUDGE_INPUT_USD_PER_1M +
    (u.completionTokens / 1_000_000) * JUDGE_OUTPUT_USD_PER_1M
  )
}

async function judge(
  apiKey: string,
  fullPrompt: string,
  segmentText: string,
  issueType: string,
  issueMessage: string,
  suggested: string
): Promise<{ score: JudgeScore; usage: JudgeUsage }> {
  const judgePrompt = `You are evaluating a system that suggests improvements to AI prompts.

Original prompt (full):
"""
${fullPrompt}
"""

The system flagged this segment with a "${issueType}" issue:
Segment: "${segmentText}"
Issue message: "${issueMessage}"

The system suggested replacing the segment with:
"""
${suggested}
"""

Score the suggestion on three axes from 1 (terrible) to 5 (excellent):
- addressesIssue: Does the new text actually resolve the flagged ${issueType}?
- preservesIntent: Does it keep the author's original intent for that segment?
- improvesSpecificity: Is it more concrete/actionable than the original?

Respond with strict JSON only, no preamble:
{"addressesIssue": <1-5>, "preservesIntent": <1-5>, "improvesSpecificity": <1-5>, "rationale": "<1 sentence>"}`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [{ role: 'user', content: judgePrompt }],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  })
  if (!res.ok) throw new Error(`judge ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  }
  const parsed = JSON.parse(data.choices[0].message.content) as JudgeScore
  // Validate shape; throw with raw response if malformed.
  for (const k of ['addressesIssue', 'preservesIntent', 'improvesSpecificity']) {
    const v = (parsed as unknown as Record<string, unknown>)[k]
    if (typeof v !== 'number' || v < 1 || v > 5) {
      throw new Error(`judge returned invalid ${k}=${v}; raw: ${data.choices[0].message.content}`)
    }
  }
  const usage: JudgeUsage = {
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
  }
  return { score: parsed, usage }
}

interface SuggestResult {
  fixture: Fixture
  issue?: ApiIssue
  suggestion?: Suggestion
  score?: JudgeScore
  judgeUsage?: JudgeUsage
  errored?: string
  durationMs: number
}

const results: SuggestResult[] = []

// Only run on positive fixtures (where we expect at least one issue).
const POSITIVE_FIXTURES = FIXTURES.filter((f) => f.expects.length > 0)

beforeAll(async () => {
  const apiKey = loadOpenAIKey()
  const t0 = Date.now()
  for (const fixture of POSITIVE_FIXTURES) {
    const start = Date.now()
    const r: SuggestResult = { fixture, durationMs: 0 }
    try {
      const issues = await analyze(fixture.prompt)
      // Pick the first issue whose type was expected (so we judge the
      // suggestion on the issue type the fixture actually targets).
      const issue = issues.find((i) => fixture.expects.includes(i.type)) || issues[0]
      if (!issue) {
        r.errored = 'no issues returned (analyze recall miss)'
      } else {
        r.issue = issue
        const segText = fixture.prompt.slice(issue.range[0], issue.range[1])
        r.suggestion = await suggest(segText, issue.type, fixture.prompt, issue.message)
        const judged = await judge(
          apiKey,
          fixture.prompt,
          segText,
          issue.type,
          issue.message,
          r.suggestion.suggested
        )
        r.score = judged.score
        r.judgeUsage = judged.usage
      }
    } catch (err) {
      r.errored = err instanceof Error ? err.message : String(err)
    }
    r.durationMs = Date.now() - start
    results.push(r)
  }
  // eslint-disable-next-line no-console
  console.log(`\n[eval] suggest: ran ${POSITIVE_FIXTURES.length} fixtures in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
}, 900_000) // 15 min ceiling

describe('suggest.eval', () => {
  it('reports per-fixture judge scores (informational)', () => {
    // eslint-disable-next-line no-console
    console.log(formatReport(results))
    expect(results.length).toBe(POSITIVE_FIXTURES.length)
  })

  it('mean addressesIssue ≥ 3.5', () => {
    const scored = results.filter((r) => r.score)
    if (scored.length === 0) throw new Error('no scored results — analyze likely failing')
    const mean = scored.reduce((s, r) => s + r.score!.addressesIssue, 0) / scored.length
    // eslint-disable-next-line no-console
    console.log(`[eval] addressesIssue mean=${mean.toFixed(2)} (n=${scored.length})`)
    expect(mean).toBeGreaterThanOrEqual(3.5)
  })

  it('mean preservesIntent ≥ 3.5', () => {
    const scored = results.filter((r) => r.score)
    if (scored.length === 0) return
    const mean = scored.reduce((s, r) => s + r.score!.preservesIntent, 0) / scored.length
    // eslint-disable-next-line no-console
    console.log(`[eval] preservesIntent mean=${mean.toFixed(2)}`)
    expect(mean).toBeGreaterThanOrEqual(3.5)
  })

  it('mean improvesSpecificity ≥ 3.0', () => {
    const scored = results.filter((r) => r.score)
    if (scored.length === 0) return
    const mean = scored.reduce((s, r) => s + r.score!.improvesSpecificity, 0) / scored.length
    // eslint-disable-next-line no-console
    console.log(`[eval] improvesSpecificity mean=${mean.toFixed(2)}`)
    expect(mean).toBeGreaterThanOrEqual(3.0)
  })

  it('no suggestion is byte-identical to the original (no-ops are bugs)', () => {
    const noops = results.filter(
      (r) => r.suggestion && r.suggestion.suggested.trim() === r.suggestion.original.trim()
    )
    expect(noops, noops.map((r) => r.fixture.name).join(', ')).toHaveLength(0)
  })

  // ─── Cost budget ──────────────────────────────────────────────────────
  // The judge call dominates eval cost (suggest goes through the worker;
  // judge calls OpenAI directly with the full prompt + suggestion in
  // context). A regression that doubles judge tokens would silently double
  // CI cost — assert tight bounds so we notice.
  it('per-fixture judge call stays under 4k tokens', () => {
    const scored = results.filter((r) => r.judgeUsage)
    if (scored.length === 0) return
    const overBudget = scored.filter((r) => r.judgeUsage!.totalTokens > 4_000)
    const detail = overBudget
      .map((r) => `${r.fixture.name}=${r.judgeUsage!.totalTokens}t`)
      .join(', ')
    expect(overBudget, `over-budget fixtures: ${detail}`).toHaveLength(0)
  })

  it('total judge cost stays under $0.05 per eval run', () => {
    const scored = results.filter((r) => r.judgeUsage)
    if (scored.length === 0) return
    const total = scored.reduce((sum, r) => sum + judgeUsageToCostUSD(r.judgeUsage!), 0)
    const totalTokens = scored.reduce((sum, r) => sum + r.judgeUsage!.totalTokens, 0)
    // eslint-disable-next-line no-console
    console.log(
      `[eval] judge cost: $${total.toFixed(4)} across ${scored.length} fixtures (${totalTokens} tokens total)`
    )
    expect(total).toBeLessThan(0.05)
  })
})

function formatReport(rs: SuggestResult[]): string {
  const lines: string[] = []
  lines.push('\n┌─ suggest eval report ────────────────────────────────────────')
  for (const r of rs) {
    if (r.errored) {
      lines.push(`│ ⚠  ${r.fixture.name.padEnd(36)} ! ${r.errored}`)
      continue
    }
    if (!r.score) {
      lines.push(`│ ⚠  ${r.fixture.name.padEnd(36)} (no score)`)
      continue
    }
    const s = r.score
    const total = s.addressesIssue + s.preservesIntent + s.improvesSpecificity
    const avg = (total / 3).toFixed(1)
    lines.push(
      `│ ${total >= 12 ? '★' : total >= 9 ? '✓' : '✗'}  ${r.fixture.name.padEnd(36)} avg=${avg} addr=${s.addressesIssue} intent=${s.preservesIntent} spec=${s.improvesSpecificity} (${r.durationMs}ms)`
    )
    if (r.suggestion) {
      lines.push(`│     "${r.suggestion.original.slice(0, 60)}" → "${r.suggestion.suggested.slice(0, 60)}"`)
    }
    lines.push(`│     judge: ${s.rationale}`)
  }
  lines.push('└──────────────────────────────────────────────────────────────')
  return lines.join('\n')
}
