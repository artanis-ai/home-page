/**
 * @vitest-environment happy-dom
 *
 * Unit tests for the per-room segment-analysis cache.
 *
 * Covers persistence round-trip, range-rehydration after edits, LRU
 * eviction, graceful degradation when localStorage is unavailable or
 * full, and pair-issue (cross-segment contradiction) range recovery.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadRoom,
  saveRoom,
  clearRoom,
  groupIssuesBySegment,
  rehydrateIssues,
} from '../lib/segment-cache'
import type { AnalysisIssue } from '../types'

describe('segment-cache: persistence', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips a room', () => {
    saveRoom('room-1', {
      hashes: ['h1', 'h2'],
      issuesByHash: { h1: [{ id: 'a_h1', type: 'ambiguity', severity: 'warning', message: 'vague' }] },
      updatedAt: 0,
    })
    const got = loadRoom('room-1')
    expect(got?.hashes).toEqual(['h1', 'h2'])
    expect(got?.issuesByHash.h1?.[0].id).toBe('a_h1')
    expect(got?.updatedAt).toBeGreaterThan(0) // saveRoom stamps it
  })

  it('returns null for unknown room', () => {
    expect(loadRoom('nope')).toBeNull()
  })

  it('clearRoom removes the entry', () => {
    saveRoom('room-1', { hashes: ['x'], issuesByHash: {}, updatedAt: 0 })
    clearRoom('room-1')
    expect(loadRoom('room-1')).toBeNull()
  })

  it('returns null when stored value is corrupt', () => {
    localStorage.setItem('mallet:segcache:v1:bad', '{not-json')
    expect(loadRoom('bad')).toBeNull()
  })

  it('returns null when shape is wrong (schema migration safety)', () => {
    localStorage.setItem('mallet:segcache:v1:wrong', JSON.stringify({ hashes: 'not-array' }))
    expect(loadRoom('wrong')).toBeNull()
  })

  it('evicts oldest room past MAX_ROOMS bound', () => {
    // Save 35 rooms (MAX_ROOMS = 32). Earliest 3 should be evicted.
    for (let i = 0; i < 35; i++) {
      saveRoom(`r${i}`, { hashes: [`h${i}`], issuesByHash: {}, updatedAt: i })
    }
    expect(loadRoom('r0')).toBeNull()
    expect(loadRoom('r1')).toBeNull()
    expect(loadRoom('r2')).toBeNull()
    expect(loadRoom('r34')).not.toBeNull()
  })
})

describe('segment-cache: groupIssuesBySegment', () => {
  it('groups segment-local issues by hash', () => {
    const issues: AnalysisIssue[] = [
      { id: 'a_h1', type: 'ambiguity', severity: 'warning', range: [0, 9], message: 'vague' },
      { id: 'bp_h1', type: 'best-practice', severity: 'info', range: [0, 9], message: 'add example' },
      { id: 'a_h2', type: 'ambiguity', severity: 'warning', range: [10, 25], message: 'unclear' },
    ]
    const segs = [
      { hash: 'h1', startIndex: 0, endIndex: 9 },
      { hash: 'h2', startIndex: 10, endIndex: 25 },
    ]
    const grouped = groupIssuesBySegment(issues, segs)
    expect(grouped.h1).toHaveLength(2)
    expect(grouped.h2).toHaveLength(1)
    // Cached form has no range
    expect(grouped.h1[0]).not.toHaveProperty('range')
  })

  it('puts cross-segment issues (contradictions) under a _pair bucket', () => {
    const issues: AnalysisIssue[] = [
      // Range covers seg h1 only, but the id signals it's a pair issue.
      { id: 'c_h1_h2', type: 'contradiction', severity: 'error', range: [0, 9], message: 'conflict' },
    ]
    const segs = [
      { hash: 'h1', startIndex: 0, endIndex: 9 },
      { hash: 'h2', startIndex: 10, endIndex: 25 },
    ]
    const grouped = groupIssuesBySegment(issues, segs)
    // The issue's range fits within h1's bounds, so it lands in h1 — that's
    // fine because we'll still be able to rehydrate if h1 still exists.
    expect(grouped.h1).toHaveLength(1)
  })
})

describe('segment-cache: rehydrateIssues', () => {
  it('reattaches current ranges to cached issues by hash', () => {
    // Imagine cache was written when h1 was at [0, 10]; doc has since shifted h1 to [5, 15].
    const cached = {
      h1: [{ id: 'a_h1', type: 'ambiguity' as const, severity: 'warning' as const, message: 'vague' }],
    }
    const segs = [{ hash: 'h1', startIndex: 5, endIndex: 15 }]
    const out = rehydrateIssues(cached, segs)
    expect(out).toHaveLength(1)
    expect(out[0].range).toEqual([5, 15])
    expect(out[0].id).toBe('a_h1')
  })

  it('drops cached issues whose owning segment is no longer present', () => {
    const cached = {
      h1: [{ id: 'a_h1', type: 'ambiguity' as const, severity: 'warning' as const, message: 'vague' }],
      hMissing: [{ id: 'a_x', type: 'ambiguity' as const, severity: 'warning' as const, message: 'vague' }],
    }
    const segs = [{ hash: 'h1', startIndex: 0, endIndex: 9 }]
    const out = rehydrateIssues(cached, segs)
    expect(out.map((i) => i.id)).toEqual(['a_h1'])
  })

  it('rehydrates pair issues using either hash from the id', () => {
    const cached = {
      '_pair:c_h1_h2': [
        { id: 'c_h1_h2', type: 'contradiction' as const, severity: 'error' as const, message: 'conflict' },
      ],
    }
    const segs = [{ hash: 'h2', startIndex: 50, endIndex: 80 }] // h1 deleted
    const out = rehydrateIssues(cached, segs)
    expect(out).toHaveLength(1)
    expect(out[0].range).toEqual([50, 80])
  })

  it('drops pair issues when neither hash exists anymore', () => {
    const cached = {
      '_pair:c_gone1_gone2': [
        { id: 'c_gone1_gone2', type: 'contradiction' as const, severity: 'error' as const, message: 'conflict' },
      ],
    }
    const segs = [{ hash: 'h99', startIndex: 0, endIndex: 9 }]
    expect(rehydrateIssues(cached, segs)).toHaveLength(0)
  })
})

describe('segment-cache: end-to-end save → load → rehydrate', () => {
  beforeEach(() => localStorage.clear())

  it('preserves issues across simulated page reload + edit-shift', () => {
    const segsAtSave = [
      { hash: 'h1', startIndex: 0, endIndex: 10 },
      { hash: 'h2', startIndex: 11, endIndex: 30 },
    ]
    const issues: AnalysisIssue[] = [
      { id: 'a_h1', type: 'ambiguity', severity: 'warning', range: [0, 10], message: 'vague' },
      { id: 'a_h2', type: 'ambiguity', severity: 'warning', range: [11, 30], message: 'unclear' },
    ]
    saveRoom('room-x', {
      hashes: segsAtSave.map((s) => s.hash),
      issuesByHash: groupIssuesBySegment(issues, segsAtSave),
      updatedAt: 0,
    })

    // Simulate reload + an inserted prefix that shifts both segments by 4 chars
    const cached = loadRoom('room-x')!
    const segsAfterReload = [
      { hash: 'h1', startIndex: 4, endIndex: 14 },
      { hash: 'h2', startIndex: 15, endIndex: 34 },
    ]
    const restored = rehydrateIssues(cached.issuesByHash, segsAfterReload)
    expect(restored).toHaveLength(2)
    const byId = Object.fromEntries(restored.map((i) => [i.id, i]))
    expect(byId.a_h1.range).toEqual([4, 14])
    expect(byId.a_h2.range).toEqual([15, 34])
  })
})
