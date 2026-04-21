import { describe, it, expect } from 'vitest'
import type { AnalyzerTask } from '../lib/analyzer'

const WORKER_URL = 'http://localhost:8787'

interface Segment {
  text: string
  startIndex: number
  endIndex: number
  hash: string
}

interface AnalyzeBody {
  segments: Segment[]
  changedHashes?: string[]
  tasks?: AnalyzerTask[]
}

async function analyzeRaw(body: AnalyzeBody) {
  const res = await fetch(`${WORKER_URL}/api/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test_user_analyze',
    },
    body: JSON.stringify(body),
  })
  expect(res.ok).toBe(true)
  return res.json() as Promise<{
    issues: Array<{
      id: string; type: string; severity: string
      range: [number, number]; message: string
    }>
    usage: { inputTokens: number; outputTokens: number; tasks: number }
  }>
}

async function analyze(segments: Segment[], changedHashes: string[]) {
  return analyzeRaw({ segments, changedHashes })
}

describe('segment-level analysis API', () => {
  it('detects contradiction between two segments', async () => {
    const { issues } = await analyze(
      [
        { text: 'Be brief.', startIndex: 0, endIndex: 9, hash: 'a' },
        { text: 'Give long answers.', startIndex: 10, endIndex: 28, hash: 'b' },
      ],
      ['a', 'b']
    )
    expect(issues.length).toBeGreaterThanOrEqual(1)
    expect(issues[0].type).toBe('contradiction')
    expect(issues[0].range[0]).toBeGreaterThanOrEqual(0)
    expect(issues[0].range[1]).toBeLessThanOrEqual(28)
  }, 15000)

  it('returns no issues for non-contradictory segments', async () => {
    const { issues } = await analyze(
      [
        { text: 'Be polite.', startIndex: 0, endIndex: 10, hash: 'a' },
        { text: 'Be helpful.', startIndex: 11, endIndex: 22, hash: 'b' },
      ],
      ['a', 'b']
    )
    const contradictions = issues.filter(i => i.type === 'contradiction')
    expect(contradictions).toHaveLength(0)
  }, 15000)

  it('only compares changed segments against others', async () => {
    const { issues } = await analyze(
      [
        { text: 'Be brief.', startIndex: 0, endIndex: 9, hash: 'a' },
        { text: 'Give long answers.', startIndex: 10, endIndex: 28, hash: 'b' },
        { text: 'Be polite.', startIndex: 29, endIndex: 39, hash: 'c' },
      ],
      ['a'] // only 'a' changed — compare against b and c
    )
    // Should find contradiction between a and b
    expect(issues.length).toBeGreaterThanOrEqual(1)
    expect(issues[0].message).toMatch(/brief|long/)
  }, 15000)

  it('returns empty for no segments', async () => {
    const { issues } = await analyze([], [])
    expect(issues).toHaveLength(0)
  }, 5000)

  it('returns empty when no segments changed', async () => {
    const { issues } = await analyze(
      [
        { text: 'Be brief.', startIndex: 0, endIndex: 9, hash: 'a' },
        { text: 'Give long answers.', startIndex: 10, endIndex: 28, hash: 'b' },
      ],
      [] // nothing changed
    )
    expect(issues).toHaveLength(0)
  }, 5000)

  it('deduplicates issues for the same pair', async () => {
    const { issues } = await analyze(
      [
        { text: 'Be brief.', startIndex: 0, endIndex: 9, hash: 'a' },
        { text: 'Give long answers.', startIndex: 10, endIndex: 28, hash: 'b' },
      ],
      ['a', 'b'] // both changed — each compared against the other
    )
    // Should have at most 1 issue for this pair, not 2
    const contradictions = issues.filter(i => i.type === 'contradiction')
    expect(contradictions.length).toBeLessThanOrEqual(1)
  }, 15000)

  it('handles 3+ contradictory segments', async () => {
    const { issues } = await analyze(
      [
        { text: 'Be brief.', startIndex: 0, endIndex: 9, hash: 'a' },
        { text: 'Write at length.', startIndex: 10, endIndex: 26, hash: 'b' },
        { text: 'Keep it short.', startIndex: 27, endIndex: 41, hash: 'c' },
      ],
      ['a', 'b', 'c']
    )
    // Should find at least one contradiction
    expect(issues.length).toBeGreaterThanOrEqual(1)
  }, 20000)
})

describe('explicit task batching', () => {
  // The client spreads a large prompt's N² pair fan-out across multiple
  // /api/analyze calls by sending an explicit `tasks` list per batch.
  // These tests guard the contract: exactly the listed tasks run, no more,
  // and stale hashes (from a batch the client held while segments moved on)
  // are silently skipped instead of erroring.

  it('runs ONLY the listed tasks when `tasks` is set', async () => {
    const t0 = Date.now()
    const { issues, usage } = await analyzeRaw({
      segments: [
        { text: 'Be brief.', startIndex: 0, endIndex: 9, hash: 'a' },
        { text: 'Give long answers.', startIndex: 10, endIndex: 28, hash: 'b' },
        { text: 'Be polite.', startIndex: 29, endIndex: 39, hash: 'c' },
      ],
      tasks: [{ kind: 'pair', a: 'a', b: 'b' }],
    })
    const elapsed = Date.now() - t0
    console.log(`[batching] single pair only: ${elapsed}ms, ${usage.tasks} tasks`)
    // Contract: one explicit task → exactly one LLM call, not the 9-task
    // fanout the old changedHashes-all-three path would produce.
    expect(usage.tasks).toBe(1)
    // The pair really is a contradiction, so the result should reflect it.
    expect(issues.filter(i => i.type === 'contradiction').length).toBeGreaterThanOrEqual(1)
  }, 15000)

  it('ignores `changedHashes` when `tasks` is set', async () => {
    // Send a tasks list AND a bogus changedHashes — the tasks wins, and the
    // ambiguity/bp fan-out that changedHashes would have triggered must not run.
    const { usage } = await analyzeRaw({
      segments: [
        { text: 'Be brief.', startIndex: 0, endIndex: 9, hash: 'a' },
        { text: 'Give long answers.', startIndex: 10, endIndex: 28, hash: 'b' },
      ],
      changedHashes: ['a', 'b'],
      tasks: [{ kind: 'ambiguity', h: 'a' }],
    })
    expect(usage.tasks).toBe(1)
  }, 10000)

  it('silently skips stale hashes', async () => {
    // Client batched a pair against a segment that has since been deleted.
    // Server must not 500 — just run the solvable tasks and drop the rest.
    const { usage } = await analyzeRaw({
      segments: [
        { text: 'Be brief.', startIndex: 0, endIndex: 9, hash: 'a' },
      ],
      tasks: [
        { kind: 'ambiguity', h: 'a' },
        { kind: 'pair', a: 'a', b: 'gone' }, // `gone` no longer exists
        { kind: 'bp', h: 'also-gone' },       // also dropped
      ],
    })
    expect(usage.tasks).toBe(1) // only the `ambiguity` task for `a` runs
  }, 10000)

  it('empty `tasks` array → no LLM calls, empty issues', async () => {
    const t0 = Date.now()
    const { issues, usage } = await analyzeRaw({
      segments: [
        { text: 'Be brief.', startIndex: 0, endIndex: 9, hash: 'a' },
        { text: 'Give long answers.', startIndex: 10, endIndex: 28, hash: 'b' },
      ],
      tasks: [],
    })
    const elapsed = Date.now() - t0
    expect(usage.tasks).toBe(0)
    expect(issues).toHaveLength(0)
    // No LLM round trip — must return fast.
    expect(elapsed).toBeLessThan(2000)
  }, 5000)

  it('handles a long-prompt batch (40 pair tasks) without exceeding subrequest limits', async () => {
    // Worst-case per-batch load: 40 pair tasks = 40 OpenAI calls + logging
    // overhead. Stays well under Cloudflare's 1000-subrequest cap per
    // Worker invocation, which is the whole reason for client batching.
    // 40 unique segments, pairwise = 40*39/2 = 780 pairs; we send a slice
    // of 40 as one batch to simulate one prioritized chunk.
    const segments: Segment[] = []
    for (let i = 0; i < 40; i++) {
      segments.push({
        text: `Instruction number ${i}: be clear.`,
        startIndex: i * 40,
        endIndex: i * 40 + 30,
        hash: `h${i}`,
      })
    }
    const tasks: AnalyzerTask[] = []
    for (let i = 0; i < 40; i++) {
      // pair each segment with its neighbor — 40 tasks, fits in one batch
      tasks.push({ kind: 'pair', a: `h${i}`, b: `h${(i + 1) % 40}` })
    }
    const t0 = Date.now()
    const { usage } = await analyzeRaw({ segments, tasks })
    const elapsed = Date.now() - t0
    console.log(`[batching] 40-task batch: ${elapsed}ms, ${usage.tasks} tasks, ${usage.inputTokens}in/${usage.outputTokens}out tok`)
    expect(usage.tasks).toBe(40)
  }, 60000)
})

describe('code / JSON / variable declarations are skipped', () => {
  // Mallet slices raw file ranges — the segmenter can't tell a prose
  // instruction from a Python `FOO = """` opener or a function signature.
  // These tests guard the analyzer's NON_PROSE_GUARD rule: scaffolding
  // segments must never be flagged as ambiguous / bad-practice, and must
  // never pair against prose to produce a contradiction. Real prose
  // contradictions elsewhere in the slice must still surface.

  // Paid LLM calls: log elapsed time per-case so regressions in latency
  // or fan-out are visible. See the user-memory note about API timing.
  async function analyzeLogged(label: string, segments: Segment[], changedHashes: string[]) {
    const start = Date.now()
    const result = await analyze(segments, changedHashes)
    const elapsed = Date.now() - start
    console.log(`[analyze-skip] ${label}: ${elapsed}ms, ${result.issues.length} issues`)
    return { ...result, elapsed }
  }

  it('does not flag a Python triple-quote declaration as ambiguous or bad practice', async () => {
    const { issues, elapsed } = await analyzeLogged(
      'python triple-quote declaration',
      [{ text: 'SYSTEM_PROMPT = """', startIndex: 0, endIndex: 19, hash: 'decl1' }],
      ['decl1']
    )
    expect(issues.filter(i => i.type === 'ambiguity')).toHaveLength(0)
    expect(issues.filter(i => i.type === 'best-practice')).toHaveLength(0)
    // Whole check is a single segment → two per-segment tasks; stay under 15s.
    expect(elapsed).toBeLessThan(15000)
  }, 20000)

  it('does not flag a lone triple-quote delimiter', async () => {
    const { issues } = await analyzeLogged(
      'lone triple-quote',
      [{ text: '"""', startIndex: 0, endIndex: 3, hash: 'delim1' }],
      ['delim1']
    )
    expect(issues).toHaveLength(0)
  }, 20000)

  it('does not flag a JSON object literal', async () => {
    const { issues } = await analyzeLogged(
      'json object literal',
      [{ text: '{"role": "system", "content": "..."}', startIndex: 0, endIndex: 36, hash: 'json1' }],
      ['json1']
    )
    expect(issues.filter(i => i.type === 'ambiguity')).toHaveLength(0)
    expect(issues.filter(i => i.type === 'best-practice')).toHaveLength(0)
  }, 20000)

  it('does not flag a Python function declaration', async () => {
    const { issues } = await analyzeLogged(
      'python function declaration',
      [{ text: 'def generate_response(prompt: str) -> str:', startIndex: 0, endIndex: 42, hash: 'fn1' }],
      ['fn1']
    )
    expect(issues).toHaveLength(0)
  }, 20000)

  it('does not flag an import statement', async () => {
    const { issues } = await analyzeLogged(
      'import statement',
      [{ text: 'from openai import OpenAI', startIndex: 0, endIndex: 25, hash: 'imp1' }],
      ['imp1']
    )
    expect(issues).toHaveLength(0)
  }, 20000)

  it('does not flag a JavaScript const declaration', async () => {
    const { issues } = await analyzeLogged(
      'js const declaration',
      [{ text: 'const systemPrompt = `', startIndex: 0, endIndex: 22, hash: 'js1' }],
      ['js1']
    )
    expect(issues).toHaveLength(0)
  }, 20000)

  it('does not pair scaffolding against prose as a contradiction', async () => {
    // A code declaration and a prose instruction live in the same slice;
    // the declaration is not an instruction, so pairwise comparison must
    // short-circuit without flagging a contradiction.
    const { issues } = await analyzeLogged(
      'code paired with prose',
      [
        { text: 'SYSTEM_PROMPT = """', startIndex: 0, endIndex: 19, hash: 'code_a' },
        { text: 'Be brief.', startIndex: 20, endIndex: 29, hash: 'prose_a' },
      ],
      ['code_a', 'prose_a']
    )
    expect(issues.filter(i => i.type === 'contradiction')).toHaveLength(0)
  }, 20000)

  it('still flags a real prose contradiction alongside code scaffolding', async () => {
    // Mirrors the `.py` slice shape Mallet actually sees: opener, two prose
    // lines that contradict, closer. The scaffolding is ignored; the prose
    // contradiction MUST still surface.
    const { issues } = await analyzeLogged(
      'prose contradiction among code',
      [
        { text: 'SYSTEM_PROMPT = """', startIndex: 0, endIndex: 19, hash: 'code_open' },
        { text: 'Be brief.', startIndex: 20, endIndex: 29, hash: 'p_brief' },
        { text: 'Give long detailed answers.', startIndex: 30, endIndex: 57, hash: 'p_long' },
        { text: '"""', startIndex: 58, endIndex: 61, hash: 'code_close' },
      ],
      ['code_open', 'p_brief', 'p_long', 'code_close']
    )
    const contradictions = issues.filter(i => i.type === 'contradiction')
    expect(contradictions.length).toBeGreaterThanOrEqual(1)
    // None of the surfaced contradictions should reference the scaffolding text
    for (const c of contradictions) {
      expect(c.message).not.toContain('SYSTEM_PROMPT')
      expect(c.message).not.toMatch(/^"""/)
    }
  }, 30000)

  it('still analyzes prose that MENTIONS code/JSON', async () => {
    // "Reply with JSON" is prose ABOUT code — the guard must not trip on
    // mere mention of code. We don't require a specific verdict (the LLM
    // may or may not find an issue); we just require the call to succeed
    // and not treat this as scaffolding (i.e. the analyzer runs normally).
    const { issues } = await analyzeLogged(
      'prose mentioning JSON',
      [{ text: 'Reply with JSON: {"status": "ok"}.', startIndex: 0, endIndex: 34, hash: 'mention' }],
      ['mention']
    )
    // Structural assertion only — behavior depends on the LLM's judgement.
    expect(Array.isArray(issues)).toBe(true)
  }, 20000)

  it('does not flag an HTML/XML tag alone', async () => {
    const { issues } = await analyzeLogged(
      'html tag',
      [{ text: '<system_prompt>', startIndex: 0, endIndex: 15, hash: 'html1' }],
      ['html1']
    )
    expect(issues).toHaveLength(0)
  }, 20000)
})

describe('ambiguity and best-practice do not double up on vague segments', () => {
  // The user shouldn't see TWO near-identical cards — one "Ambiguity" and one
  // "Best Practice" — for the same vague sentence. Ambiguity owns vagueness;
  // best-practice must stay on structural defects only (missing format, no
  // examples, tone conflict, etc.).
  it('a plainly vague sentence produces at most one ambiguity, no BP', async () => {
    const t0 = Date.now()
    const { issues } = await analyze(
      [{ text: 'Be helpful.', startIndex: 0, endIndex: 11, hash: 'vague1' }],
      ['vague1']
    )
    const elapsed = Date.now() - t0
    const ambig = issues.filter(i => i.type === 'ambiguity')
    const bp = issues.filter(i => i.type === 'best-practice')
    console.log(`[analyze-dedup] vague sentence: ${elapsed}ms, ${ambig.length} ambig, ${bp.length} bp`)
    // Best-practice must NOT fire just on vagueness (that's the ambiguity check's job).
    expect(bp.length).toBe(0)
  }, 20000)

  it('a vague sentence with no output format: BP may flag the format, but not vagueness', async () => {
    // "Give me a list" is vague AND has no format spec. BP may legitimately
    // fire on the format gap, but its message should speak to FORMAT, not vagueness.
    const { issues } = await analyze(
      [{ text: 'Give me a list.', startIndex: 0, endIndex: 15, hash: 'vague2' }],
      ['vague2']
    )
    const bp = issues.filter(i => i.type === 'best-practice')
    for (const i of bp) {
      expect(i.message.toLowerCase()).not.toMatch(/\b(vague|unclear|ambiguous)\b/)
    }
  }, 20000)

  it('a structurally well-formed but empty-ish instruction: neither fires', async () => {
    const { issues } = await analyze(
      [{ text: 'Respond in English.', startIndex: 0, endIndex: 19, hash: 'clear1' }],
      ['clear1']
    )
    const ambig = issues.filter(i => i.type === 'ambiguity')
    const bp = issues.filter(i => i.type === 'best-practice')
    console.log(`[analyze-dedup] clear sentence: ${ambig.length} ambig, ${bp.length} bp`)
    expect(ambig.length).toBe(0)
    expect(bp.length).toBe(0)
  }, 20000)
})

describe('suggest API', () => {
  it('returns a suggestion for a contradiction', async () => {
    const res = await fetch(`${WORKER_URL}/api/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_user_suggest',
      },
      body: JSON.stringify({
        segmentText: 'Be brief.',
        issueType: 'contradiction',
        fullPrompt: 'Be brief. Give long detailed answers.',
        message: 'Contradicts "Give long detailed answers"',
      }),
    })
    expect(res.ok).toBe(true)
    const data = await res.json() as { original: string; suggested: string; explanation: string }
    expect(data.original).toBeTruthy()
    expect(data.suggested).toBeTruthy()
    expect(data.suggested).not.toBe(data.original)
  }, 20000)

  it('returns suggestion within 5 seconds', async () => {
    const start = Date.now()
    const res = await fetch(`${WORKER_URL}/api/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_user_suggest',
      },
      body: JSON.stringify({
        segmentText: 'Be brief.',
        issueType: 'contradiction',
        fullPrompt: 'Be brief. Give long answers.',
        message: 'Contradicts long answers',
      }),
    })
    const elapsed = Date.now() - start
    expect(res.ok).toBe(true)
    expect(elapsed).toBeLessThan(5000)
  }, 10000)

  it('rejects empty segment text', async () => {
    const res = await fetch(`${WORKER_URL}/api/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_user_suggest',
      },
      body: JSON.stringify({
        segmentText: '',
        issueType: 'contradiction',
        fullPrompt: 'Be brief.',
        message: 'Test',
      }),
    })
    expect(res.status).toBe(400)
  }, 5000)

  it('rejects whitespace-only segment text', async () => {
    const res = await fetch(`${WORKER_URL}/api/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_user_suggest',
      },
      body: JSON.stringify({
        segmentText: '   \n\t   ',
        issueType: 'contradiction',
        fullPrompt: 'Be brief.',
        message: 'Test',
      }),
    })
    expect(res.status).toBe(400)
  }, 5000)

  it('handles segment with embedded quotes and newlines safely', async () => {
    // The system prompt wraps segmentText in "..." — must not break JSON or escape
    const res = await fetch(`${WORKER_URL}/api/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_user_suggest',
      },
      body: JSON.stringify({
        segmentText: 'He said "hello" and\nshe replied "goodbye".',
        issueType: 'best-practice',
        fullPrompt: 'He said "hello" and\nshe replied "goodbye".',
        message: 'Mixed quotes',
      }),
    })
    expect(res.ok).toBe(true)
    const data = await res.json() as { original: string; suggested: string }
    expect(typeof data.suggested).toBe('string')
  }, 20000)

  it('handles segment with unicode (emoji)', async () => {
    const res = await fetch(`${WORKER_URL}/api/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_user_suggest',
      },
      body: JSON.stringify({
        segmentText: 'Be helpful 🎉 and brief 🤖.',
        issueType: 'best-practice',
        fullPrompt: 'Be helpful 🎉 and brief 🤖.',
        message: 'Excessive emoji',
      }),
    })
    expect(res.ok).toBe(true)
    const data = await res.json() as { suggested: string }
    expect(typeof data.suggested).toBe('string')
  }, 20000)

  it('handles a long segment (~2000 chars)', async () => {
    const long = ('Always be respectful. '.repeat(100)).slice(0, 2000)
    const res = await fetch(`${WORKER_URL}/api/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_user_suggest',
      },
      body: JSON.stringify({
        segmentText: long,
        issueType: 'best-practice',
        fullPrompt: long,
        message: 'Repetitive',
      }),
    })
    expect(res.ok).toBe(true)
  }, 30000)

  it('returns 400-class on missing required fields (no segmentText key)', async () => {
    const res = await fetch(`${WORKER_URL}/api/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_user_suggest',
      },
      body: JSON.stringify({
        issueType: 'contradiction',
        fullPrompt: 'Be brief.',
        message: 'Test',
      }),
    })
    expect(res.status).toBe(400)
  }, 5000)

  it('does not echo full prompt content in error responses (zero-leak)', async () => {
    // Malformed JSON body — server must reject without echoing any content back
    const secret = 'SHIBBOLETH-DO-NOT-LEAK-suggest-99999'
    const res = await fetch(`${WORKER_URL}/api/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_user_suggest',
      },
      body: `{"segmentText": "hi", "fullPrompt": "${secret}", "issueType": "x", "message": "y", "MALFORMED`, // truncated JSON
    })
    const text = await res.text()
    expect(text).not.toContain(secret)
  }, 5000)

  it('suggested response NEVER contains the OPENAI_API_KEY by accident', async () => {
    // Defense-in-depth: any LLM response should never leak a server secret.
    // We can't directly read the env var here, but we can grep the response
    // text for the prefix `sk-` which would indicate accidental echo.
    const res = await fetch(`${WORKER_URL}/api/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_user_suggest',
      },
      body: JSON.stringify({
        segmentText: 'Be brief.',
        issueType: 'contradiction',
        fullPrompt: 'Be brief.',
        message: 'Test',
      }),
    })
    expect(res.ok).toBe(true)
    const text = await res.text()
    expect(text).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/)
  }, 20000)

  it('suggest is anonymous-allowed (no Authorization required)', async () => {
    // suggest is intentionally public — campaign-link recipients and any
    // anonymous editor user can request inline fixes without signing in.
    // Sign-in is only forced on the GitHub-touching routes.
    const res = await fetch(`${WORKER_URL}/api/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segmentText: 'Be brief.',
        issueType: 'contradiction',
        fullPrompt: 'Be brief.',
        message: 'x',
      }),
    })
    expect(res.status).not.toBe(401)
  }, 5000)
})
