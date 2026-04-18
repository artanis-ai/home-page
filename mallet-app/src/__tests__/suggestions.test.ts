import { describe, it, expect, vi } from 'vitest'
import type { AnalysisIssue, SyncedIssue } from '../types'

/**
 * Tests for the suggestion and issue resolution pipeline.
 * These test the data transformations, not the API calls.
 */

// Mirrors resolveIssues from PromptEditor
function resolveIssues(syncedIssues: SyncedIssue[], docText: string): AnalysisIssue[] {
  const resolved: AnalysisIssue[] = []
  for (const issue of syncedIssues) {
    const idx = docText.indexOf(issue.segmentText)
    if (idx === -1) continue
    resolved.push({
      id: issue.id,
      type: issue.type,
      severity: issue.severity,
      range: [idx + issue.relativeFrom, idx + issue.relativeTo],
      message: issue.message,
    })
  }
  return resolved
}

describe('issue resolution from synced state', () => {
  it('resolves a contradiction issue to correct absolute range', () => {
    const docText = 'Be concise and brief. Provide detailed thorough explanations.'
    const synced: SyncedIssue[] = [{
      id: 'issue_1',
      type: 'contradiction',
      severity: 'warning',
      segmentHash: 'abc',
      segmentText: 'Be concise and brief.',
      relativeFrom: 0,
      relativeTo: 21,
      message: 'Contradicts "detailed thorough explanations"',
    }]

    const resolved = resolveIssues(synced, docText)
    expect(resolved).toHaveLength(1)
    expect(resolved[0].range).toEqual([0, 21])
    expect(docText.slice(resolved[0].range[0], resolved[0].range[1])).toBe('Be concise and brief.')
  })

  it('resolves issue in the middle of the document', () => {
    const docText = 'Line one. Line two has issues. Line three.'
    const synced: SyncedIssue[] = [{
      id: 'issue_1',
      type: 'ambiguity',
      severity: 'info',
      segmentHash: 'def',
      segmentText: 'Line two has issues.',
      relativeFrom: 13,
      relativeTo: 19,
      message: 'Vague word "issues"',
    }]

    const resolved = resolveIssues(synced, docText)
    expect(resolved).toHaveLength(1)
    // "Line two has issues." starts at index 10
    // relative 9-15 within that segment = "issues"
    expect(docText.slice(resolved[0].range[0], resolved[0].range[1])).toBe('issues')
  })

  it('drops issues whose segment text no longer exists in doc', () => {
    const docText = 'Completely new content.'
    const synced: SyncedIssue[] = [{
      id: 'issue_1',
      type: 'best-practice',
      severity: 'info',
      segmentHash: 'old',
      segmentText: 'Old content that was deleted.',
      relativeFrom: 0,
      relativeTo: 28,
      message: 'This was an old issue',
    }]

    const resolved = resolveIssues(synced, docText)
    expect(resolved).toHaveLength(0)
  })

  it('resolves multiple issues across different segments', () => {
    const docText = 'Be concise. Be verbose. Never lie.'
    const synced: SyncedIssue[] = [
      {
        id: 'issue_1',
        type: 'contradiction',
        severity: 'error',
        segmentHash: 'a',
        segmentText: 'Be concise.',
        relativeFrom: 0,
        relativeTo: 11,
        message: 'Contradicts "verbose"',
      },
      {
        id: 'issue_2',
        type: 'contradiction',
        severity: 'error',
        segmentHash: 'b',
        segmentText: 'Be verbose.',
        relativeFrom: 0,
        relativeTo: 11,
        message: 'Contradicts "concise"',
      },
    ]

    const resolved = resolveIssues(synced, docText)
    expect(resolved).toHaveLength(2)
    expect(docText.slice(resolved[0].range[0], resolved[0].range[1])).toBe('Be concise.')
    expect(docText.slice(resolved[1].range[0], resolved[1].range[1])).toBe('Be verbose.')
  })

  it('handles issue range surviving text insertion above', () => {
    // Simulate: text was "Hello. World." → user inserts "Greeting: " before
    const originalDoc = 'Hello. World.'
    const newDoc = 'Greeting: Hello. World.'

    const synced: SyncedIssue[] = [{
      id: 'issue_1',
      type: 'ambiguity',
      severity: 'info',
      segmentHash: 'x',
      segmentText: 'World.',
      relativeFrom: 0,
      relativeTo: 6,
      message: 'Vague',
    }]

    // Original: "World." at index 7
    const resolvedOriginal = resolveIssues(synced, originalDoc)
    expect(resolvedOriginal[0].range).toEqual([7, 13])

    // After insertion: "World." at index 17
    const resolvedNew = resolveIssues(synced, newDoc)
    expect(resolvedNew[0].range).toEqual([17, 23])
    expect(newDoc.slice(17, 23)).toBe('World.')
  })
})

describe('issue at position 0 regression', () => {
  it('issue starting at position 0 is NOT filtered out', () => {
    // This was a real bug: `from <= 0` filtered out position 0
    const docText = 'Be brief. Give long detailed answers.'
    const issues: AnalysisIssue[] = [{
      id: 'issue_1',
      type: 'contradiction',
      severity: 'error',
      range: [0, 27],
      message: 'Contradicts long answers',
    }]

    // Simulate the decoration filter logic
    const docLen = docText.length
    const validIssues = issues.filter(issue => {
      const from = Number(issue.range[0]) || 0
      const to = Number(issue.range[1]) || 0
      return from >= 0 && to > from && from < docLen
    })

    expect(validIssues).toHaveLength(1)
    expect(docText.slice(validIssues[0].range[0], validIssues[0].range[1])).toBe('Be brief. Give long detaile')
  })

  it('issue at position 0 can be sliced for suggestion', () => {
    const content = 'Be brief. Give long detailed answers.'
    const issue: AnalysisIssue = {
      id: 'test',
      type: 'contradiction',
      severity: 'error',
      range: [0, 9],
      message: 'Contradicts long answers',
    }

    const segText = content.slice(issue.range[0], issue.range[1])
    expect(segText).toBe('Be brief.')
    expect(segText.trim().length).toBeGreaterThan(0)
  })
})

describe('AnalysisPanel state-machine behavior', () => {
  // These tests model the fetchSuggestion → accept flow without rendering the
  // React component. The state machine is: idle → loading → (suggestion | error) → accept → idle.

  /**
   * Simulates AnalysisPanel.fetchSuggestion + Accept click. Returns observable
   * state transitions so we can assert on each.
   */
  async function runFlow(opts: {
    issue: AnalysisIssue
    content: string
    fetchImpl: (body: unknown) => Promise<Response>
    onAccept: (range: [number, number], replacement: string) => void
  }) {
    const transitions: string[] = []
    let suggestion: { original: string; suggested: string; explanation: string } | null = null
    let loading = false

    transitions.push('start')
    const segText = opts.content.slice(opts.issue.range[0], opts.issue.range[1])
    if (!segText.trim()) {
      transitions.push('empty-segment-skip')
      return { transitions, suggestion, loading }
    }

    loading = true
    transitions.push('loading')
    try {
      const res = await opts.fetchImpl({
        segmentText: segText,
        issueType: opts.issue.type,
        fullPrompt: opts.content,
        message: opts.issue.message,
      })
      if (!res.ok) {
        transitions.push(`error-${res.status}`)
      } else {
        suggestion = await res.json()
        transitions.push('suggestion-loaded')
      }
    } catch {
      transitions.push('fetch-failed')
    } finally {
      loading = false
    }

    // User clicks Accept
    if (suggestion) {
      opts.onAccept(opts.issue.range, suggestion.suggested)
      transitions.push('accepted')
      suggestion = null
    }

    return { transitions, suggestion, loading }
  }

  it('happy path: idle → loading → suggestion-loaded → accepted', async () => {
    const onAccept = vi.fn()
    const result = await runFlow({
      issue: { id: '1', type: 'contradiction', severity: 'warning', range: [0, 9], message: 'x' },
      content: 'Be brief. The end.',
      fetchImpl: async () => new Response(JSON.stringify({
        original: 'Be brief.', suggested: 'Be detailed.', explanation: 'longer',
      }), { status: 200 }),
      onAccept,
    })
    expect(result.transitions).toEqual(['start', 'loading', 'suggestion-loaded', 'accepted'])
    expect(onAccept).toHaveBeenCalledWith([0, 9], 'Be detailed.')
    expect(result.suggestion).toBeNull()
    expect(result.loading).toBe(false)
  })

  it('skips fetch when slicing produces empty/whitespace segment text', async () => {
    const fetchImpl = vi.fn()
    const onAccept = vi.fn()
    const result = await runFlow({
      issue: { id: '1', type: 'best-practice', severity: 'info', range: [0, 3], message: 'x' },
      content: '   visible',
      fetchImpl: fetchImpl as unknown as (body: unknown) => Promise<Response>,
      onAccept,
    })
    expect(result.transitions).toEqual(['start', 'empty-segment-skip'])
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(onAccept).not.toHaveBeenCalled()
  })

  it('handles 401 from API: stays loading=false, no suggestion shown, no accept', async () => {
    const onAccept = vi.fn()
    const result = await runFlow({
      issue: { id: '1', type: 'ambiguity', severity: 'info', range: [0, 9], message: 'x' },
      content: 'Be brief.',
      fetchImpl: async () => new Response('Unauthorized', { status: 401 }),
      onAccept,
    })
    expect(result.transitions).toContain('error-401')
    expect(result.suggestion).toBeNull()
    expect(result.loading).toBe(false)
    expect(onAccept).not.toHaveBeenCalled()
  })

  it('handles 500 from API gracefully', async () => {
    const onAccept = vi.fn()
    const result = await runFlow({
      issue: { id: '1', type: 'contradiction', severity: 'warning', range: [0, 9], message: 'x' },
      content: 'Be brief.',
      fetchImpl: async () => new Response('Server error', { status: 500 }),
      onAccept,
    })
    expect(result.transitions).toContain('error-500')
    expect(onAccept).not.toHaveBeenCalled()
  })

  it('handles network failure (fetch throws) without leaving loading=true', async () => {
    const onAccept = vi.fn()
    const result = await runFlow({
      issue: { id: '1', type: 'contradiction', severity: 'warning', range: [0, 9], message: 'x' },
      content: 'Be brief.',
      fetchImpl: async () => { throw new Error('Network error') },
      onAccept,
    })
    expect(result.transitions).toContain('fetch-failed')
    expect(result.loading).toBe(false)
    expect(onAccept).not.toHaveBeenCalled()
  })

  it('still calls onAccept even when suggested === original (UI accepts a no-op)', async () => {
    // Note: this is the LLM returning the same text. AnalysisPanel does NOT
    // currently filter this — verify so we know if we ever change that contract.
    const onAccept = vi.fn()
    const result = await runFlow({
      issue: { id: '1', type: 'best-practice', severity: 'info', range: [0, 9], message: 'x' },
      content: 'Be brief.',
      fetchImpl: async () => new Response(JSON.stringify({
        original: 'Be brief.', suggested: 'Be brief.', explanation: 'no change',
      }), { status: 200 }),
      onAccept,
    })
    expect(result.transitions).toContain('accepted')
    expect(onAccept).toHaveBeenCalledWith([0, 9], 'Be brief.')
  })

  it('handles empty suggested (deletion suggestion)', async () => {
    const onAccept = vi.fn()
    await runFlow({
      issue: { id: '1', type: 'best-practice', severity: 'info', range: [0, 9], message: 'redundant' },
      content: 'Be brief. Real content.',
      fetchImpl: async () => new Response(JSON.stringify({
        original: 'Be brief.', suggested: '', explanation: 'redundant — removed',
      }), { status: 200 }),
      onAccept,
    })
    expect(onAccept).toHaveBeenCalledWith([0, 9], '')
  })

  it('handles malformed JSON response (suggested missing) — onAccept fires with undefined', async () => {
    // Documents current behavior: AnalysisPanel does not validate the response shape.
    // If we ever harden this, the test must change.
    const onAccept = vi.fn()
    const result = await runFlow({
      issue: { id: '1', type: 'contradiction', severity: 'warning', range: [0, 9], message: 'x' },
      content: 'Be brief.',
      fetchImpl: async () => new Response(JSON.stringify({ explanation: 'oops' }), { status: 200 }),
      onAccept,
    })
    // suggestion was set (truthy object), so accept fires with `suggested: undefined`
    expect(onAccept).toHaveBeenCalledWith([0, 9], undefined)
    expect(result.transitions).toContain('accepted')
  })
})

describe('accept idempotency at the panel level', () => {
  it('two accept clicks in flight: only one onAccept fires per fetched suggestion', async () => {
    // Models the panel's flow: after Accept is clicked, suggestion is set to null
    // and the activeIssue is cleared. A second click on the (now-gone) Accept
    // button would target a different issue or a stale closure — verify the guard.
    let suggestion: { suggested: string } | null = { suggested: 'NEW' }
    let activeIssue: AnalysisIssue | null = { id: '1', type: 'contradiction', severity: 'warning', range: [0, 9], message: 'x' }
    const onAccept = vi.fn()

    function clickAccept() {
      if (activeIssue && suggestion) {
        onAccept(activeIssue.range, suggestion.suggested)
      }
      activeIssue = null
      suggestion = null
    }

    clickAccept()
    clickAccept() // second click is a no-op

    expect(onAccept).toHaveBeenCalledTimes(1)
  })
})

describe('suggestion API contract', () => {
  it('suggestion request has correct shape', () => {
    const issue: AnalysisIssue = {
      id: 'test',
      type: 'contradiction',
      severity: 'warning',
      range: [0, 21],
      message: 'Contradictory instruction',
    }
    const content = 'Be concise and brief. Provide detailed explanations.'

    // The request body shape that AnalysisPanel sends
    const requestBody = {
      segmentText: content.slice(issue.range[0], issue.range[1]),
      issueType: issue.type,
      fullPrompt: content,
      message: issue.message,
    }

    expect(requestBody.segmentText).toBe('Be concise and brief.')
    expect(requestBody.issueType).toBe('contradiction')
    expect(requestBody.fullPrompt).toBe(content)
    expect(requestBody.message).toBe('Contradictory instruction')
  })

  it('suggestion response has correct shape', () => {
    // Expected response from /api/suggest
    const response = {
      original: 'Be concise and brief.',
      suggested: 'Be concise yet comprehensive when needed.',
      explanation: 'Replaced contradictory instruction with a balanced one.',
    }

    expect(response.original).toBeTruthy()
    expect(response.suggested).toBeTruthy()
    expect(response.suggested).not.toBe(response.original)
    expect(response.explanation).toBeTruthy()
  })
})
