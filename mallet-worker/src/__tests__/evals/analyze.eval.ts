/**
 * Quality eval for /api/analyze.
 *
 * Runs the full FIXTURES dataset through the analyzer and computes
 * per-type recall (did we find issues we expected?) and false-positive
 * rate (did we flag clean prompts?). Gates merges via threshold checks.
 *
 * NOT run by `npm test` — invoke explicitly via `npm run eval`.
 * Requires `wrangler dev` on :8787 (use the existing `.dev.vars` for
 * OPENAI_API_KEY).
 *
 * Outputs a markdown summary at the end so the result is greppable
 * in CI logs.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { FIXTURES, type Fixture, type IssueType } from './fixtures'
import { segmentForEval } from './segmenter'

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787'
const AUTH = 'Bearer test_user_eval_analyze'

interface ApiIssue {
  id: string
  type: IssueType
  severity: string
  range: [number, number]
  message: string
}

interface ApiUsage {
  inputTokens: number
  outputTokens: number
  tasks: number
}

// gpt-5.4-nano standard-tier pricing (per 1M tokens), as of 2026-04-18.
// Source: https://developers.openai.com/api/docs/pricing
// Cached-input ($0.02/1M) not currently broken out by the worker; we conservatively
// price all input at the uncached rate so the cost gate doesn't quietly drop when
// caching kicks in for repeated segments.
const ANALYZE_INPUT_USD_PER_1M = 0.2
const ANALYZE_OUTPUT_USD_PER_1M = 1.25

function analyzeUsageToCostUSD(u: ApiUsage): number {
  return (
    (u.inputTokens / 1_000_000) * ANALYZE_INPUT_USD_PER_1M +
    (u.outputTokens / 1_000_000) * ANALYZE_OUTPUT_USD_PER_1M
  )
}

async function analyze(prompt: string): Promise<{ issues: ApiIssue[]; usage: ApiUsage }> {
  const segments = segmentForEval(prompt)
  if (segments.length === 0) return { issues: [], usage: { inputTokens: 0, outputTokens: 0, tasks: 0 } }
  const res = await fetch(`${WORKER_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: AUTH },
    body: JSON.stringify({ segments, changedHashes: segments.map((s) => s.hash) }),
  })
  if (!res.ok) {
    throw new Error(`analyze ${res.status} for "${prompt.slice(0, 40)}…": ${await res.text()}`)
  }
  const data = (await res.json()) as { issues?: ApiIssue[]; usage?: ApiUsage }
  return {
    issues: data.issues || [],
    usage: data.usage || { inputTokens: 0, outputTokens: 0, tasks: 0 },
  }
}

interface FixtureResult {
  fixture: Fixture
  issues: ApiIssue[]
  usage: ApiUsage
  /** Recall hits: which expected types we found. */
  hits: Set<IssueType>
  /** Misses: expected types we did NOT find. */
  misses: Set<IssueType>
  /** False positives: types in mustNotHave that we flagged. */
  falsePositives: Set<IssueType>
  durationMs: number
  errored?: string
}

const TYPES: IssueType[] = ['contradiction', 'ambiguity', 'best-practice']

// Quality thresholds. Baseline as of 2026-04-18 (post prompt+segmenter fix):
// 100% recall across all types, 0% FP. Set gates a notch below baseline so
// they catch regressions but tolerate fixture growth into harder cases.
const THRESHOLDS = {
  contradictionRecall: 0.85, // baseline 100% — gate at 85% leaves room for harder adversarial fixtures
  ambiguityRecall: 0.75,
  bestPracticeRecall: 0.75,
  contradictionFalsePositiveMax: 0.1, // baseline 0% — gate at 10% so a single regression triggers it
}

const results: FixtureResult[] = []

beforeAll(async () => {
  const t0 = Date.now()
  // Run sequentially — keeps the worker logs readable and avoids OpenAI
  // burst-rate trouble. ~30 fixtures × ~2-4s each = ~1-2min.
  for (const fixture of FIXTURES) {
    const start = Date.now()
    const result: FixtureResult = {
      fixture,
      issues: [],
      usage: { inputTokens: 0, outputTokens: 0, tasks: 0 },
      hits: new Set(),
      misses: new Set(),
      falsePositives: new Set(),
      durationMs: 0,
    }
    try {
      const { issues, usage } = await analyze(fixture.prompt)
      result.issues = issues
      result.usage = usage
      const flagged = new Set(result.issues.map((i) => i.type))
      for (const t of fixture.expects) {
        if (flagged.has(t)) result.hits.add(t)
        else result.misses.add(t)
      }
      for (const t of fixture.mustNotHave) {
        if (flagged.has(t)) result.falsePositives.add(t)
      }
    } catch (err) {
      result.errored = err instanceof Error ? err.message : String(err)
    }
    result.durationMs = Date.now() - start
    results.push(result)
  }
  // eslint-disable-next-line no-console
  console.log(`\n[eval] analyze: ran ${FIXTURES.length} fixtures in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
}, 600_000) // 10 min ceiling

describe('analyze.eval', () => {
  it('reports per-fixture pass/fail (informational)', () => {
    // eslint-disable-next-line no-console
    console.log(formatReport(results))
    // Always passes — this `it` exists to surface the report in the
    // vitest output. The hard gates are below.
    expect(results.length).toBe(FIXTURES.length)
  })

  it.each(TYPES)('per-type recall meets threshold for %s', (type) => {
    const pos = results.filter((r) => r.fixture.expects.includes(type) && !r.errored)
    if (pos.length === 0) return
    const hit = pos.filter((r) => r.hits.has(type)).length
    const recall = hit / pos.length
    const threshold =
      type === 'contradiction'
        ? THRESHOLDS.contradictionRecall
        : type === 'ambiguity'
          ? THRESHOLDS.ambiguityRecall
          : THRESHOLDS.bestPracticeRecall
    // eslint-disable-next-line no-console
    console.log(`[eval] ${type} recall: ${(recall * 100).toFixed(0)}% (${hit}/${pos.length}), threshold ${(threshold * 100).toFixed(0)}%`)
    expect(recall, `${type} recall ${recall.toFixed(2)} below threshold ${threshold}`).toBeGreaterThanOrEqual(threshold)
  })

  it('contradiction false-positive rate stays low on clean prompts', () => {
    const negs = results.filter((r) => r.fixture.mustNotHave.includes('contradiction') && !r.errored)
    if (negs.length === 0) return
    const fp = negs.filter((r) => r.falsePositives.has('contradiction')).length
    const rate = fp / negs.length
    // eslint-disable-next-line no-console
    console.log(`[eval] contradiction FP rate: ${(rate * 100).toFixed(0)}% (${fp}/${negs.length}), max ${(THRESHOLDS.contradictionFalsePositiveMax * 100).toFixed(0)}%`)
    expect(rate, `false-positive rate ${rate.toFixed(2)} exceeds max ${THRESHOLDS.contradictionFalsePositiveMax}`).toBeLessThanOrEqual(
      THRESHOLDS.contradictionFalsePositiveMax
    )
  })

  it('no fixture errored', () => {
    const errs = results.filter((r) => r.errored)
    expect(errs, errs.map((e) => `${e.fixture.name}: ${e.errored}`).join('\n')).toHaveLength(0)
  })

  it('p95 latency under 8s per fixture', () => {
    const ok = results.filter((r) => !r.errored).map((r) => r.durationMs).sort((a, b) => a - b)
    if (ok.length === 0) return
    const p95 = ok[Math.floor(ok.length * 0.95)]
    // eslint-disable-next-line no-console
    console.log(`[eval] analyze p50=${ok[Math.floor(ok.length / 2)]}ms p95=${p95}ms`)
    expect(p95).toBeLessThan(8000)
  })

  it('total analyze cost stays under $0.20 per eval run', () => {
    const totals = results.reduce(
      (acc, r) => ({
        inputTokens: acc.inputTokens + r.usage.inputTokens,
        outputTokens: acc.outputTokens + r.usage.outputTokens,
        tasks: acc.tasks + r.usage.tasks,
      }),
      { inputTokens: 0, outputTokens: 0, tasks: 0 } as ApiUsage
    )
    const totalCost = analyzeUsageToCostUSD(totals)
    // eslint-disable-next-line no-console
    console.log(
      `[eval] analyze cost: $${totalCost.toFixed(4)} (${totals.inputTokens}in/${totals.outputTokens}out tok, ${totals.tasks} tasks across ${results.length} fixtures)`
    )
    // Budget: gpt-5.4-nano is cheap, but the analyze fan-out (pairwise contradictions
    // × ambiguity × best-practice per segment) dominates spend. $0.20 leaves headroom
    // for fixture growth without letting the per-call prompt bloat slip in unnoticed.
    expect(totalCost).toBeLessThan(0.2)
  })

  it('per-fixture analyze cost stays under $0.03', () => {
    // Long prompts (~200 words, many segments) naturally cost more than short
    // ones because contradiction-pair count is O(n²) in segment count. Cap is
    // sized to catch a regression in per-call prompt size, not to constrain
    // realistic prompt length.
    for (const r of results) {
      if (r.errored) continue
      const cost = analyzeUsageToCostUSD(r.usage)
      expect(cost, `${r.fixture.name} cost $${cost.toFixed(4)} exceeds $0.03`).toBeLessThan(0.03)
    }
  })
})

function formatReport(rs: FixtureResult[]): string {
  const lines: string[] = []
  lines.push('\n┌─ analyze eval report ────────────────────────────────────────')
  for (const r of rs) {
    const flagged = Array.from(new Set(r.issues.map((i) => i.type))).sort().join(',') || '∅'
    const expected = r.fixture.expects.join(',') || '∅'
    const status = r.errored
      ? '⚠ '
      : r.misses.size === 0 && r.falsePositives.size === 0
        ? '✓ '
        : '✗ '
    lines.push(
      `│ ${status}${r.fixture.name.padEnd(36)} expect=[${expected}] got=[${flagged}] (${r.durationMs}ms)`
    )
    if (r.errored) lines.push(`│     ! ${r.errored}`)
    if (r.misses.size > 0) lines.push(`│     - missed: ${Array.from(r.misses).join(', ')}`)
    if (r.falsePositives.size > 0) lines.push(`│     + false-positive: ${Array.from(r.falsePositives).join(', ')}`)
  }
  lines.push('└──────────────────────────────────────────────────────────────')
  return lines.join('\n')
}
