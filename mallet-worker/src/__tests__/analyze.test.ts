import { describe, it, expect } from 'vitest'

const WORKER_URL = 'http://localhost:8787'

interface Segment {
  text: string
  startIndex: number
  endIndex: number
  hash: string
}

async function analyze(segments: Segment[], changedHashes: string[]) {
  const res = await fetch(`${WORKER_URL}/api/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test_user_analyze',
    },
    body: JSON.stringify({ segments, changedHashes }),
  })
  expect(res.ok).toBe(true)
  return res.json() as Promise<{
    issues: Array<{
      id: string; type: string; severity: string
      range: [number, number]; message: string
    }>
  }>
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

  it('rejects suggest with no auth (P0 regression)', async () => {
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
    expect(res.status).toBe(401)
  }, 5000)
})
