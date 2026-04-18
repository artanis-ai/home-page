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
      Authorization: 'Bearer test_user_pipeline',
    },
    body: JSON.stringify({ segments, changedHashes }),
  })
  if (!res.ok) throw new Error(`Analyze failed: ${res.status}`)
  return res.json() as Promise<{
    issues: Array<{ id: string; type: string; severity: string; range: [number, number]; message: string }>
  }>
}

async function getSuggestion(segmentText: string, issueType: string, fullPrompt: string, message: string) {
  const res = await fetch(`${WORKER_URL}/api/suggest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test_user_pipeline',
    },
    body: JSON.stringify({ segmentText, issueType, fullPrompt, message }),
  })
  if (!res.ok) throw new Error(`Suggest failed: ${res.status}`)
  return res.json() as Promise<{ original: string; suggested: string; explanation: string }>
}

describe('full segment-level pipeline', () => {
  it('analyzes → finds contradiction → gets suggestion', async () => {
    const segments: Segment[] = [
      { text: 'Be brief.', startIndex: 0, endIndex: 9, hash: 'a' },
      { text: 'Give long detailed answers.', startIndex: 10, endIndex: 37, hash: 'b' },
    ]

    // Step 1: Analyze
    const { issues } = await analyze(segments, ['a', 'b'])
    expect(issues.length).toBeGreaterThanOrEqual(1)
    expect(issues[0].type).toBe('contradiction')

    // Step 2: Validate range
    const issue = issues[0]
    expect(issue.range[0]).toBeGreaterThanOrEqual(0)
    expect(issue.range[1]).toBeLessThanOrEqual(37)

    // Step 3: Slice text for suggestion
    const fullText = 'Be brief. Give long detailed answers.'
    const segText = fullText.slice(issue.range[0], issue.range[1])
    expect(segText.length).toBeGreaterThan(0)

    // Step 4: Get suggestion
    const suggestion = await getSuggestion(segText, issue.type, fullText, issue.message)
    expect(suggestion.original).toBeTruthy()
    expect(suggestion.suggested).toBeTruthy()
    expect(suggestion.suggested).not.toBe(suggestion.original)
  }, 30000)

  it('incremental: only new segment triggers comparison', async () => {
    const segments: Segment[] = [
      { text: 'Be polite.', startIndex: 0, endIndex: 10, hash: 'existing' },
      { text: 'Never be rude.', startIndex: 11, endIndex: 25, hash: 'also-existing' },
      { text: 'Be brief.', startIndex: 26, endIndex: 35, hash: 'new-one' },
    ]

    // Only the new segment is compared against the existing ones
    const { issues } = await analyze(segments, ['new-one'])
    // No contradiction between "Be polite" / "Never be rude" and "Be brief"
    // This just verifies the API doesn't crash
    expect(Array.isArray(issues)).toBe(true)
  }, 15000)
})
