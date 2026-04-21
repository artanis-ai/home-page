/**
 * Unit tests for the client-side analyzer task planner. Covers:
 *  - parity with the server's `enumerateTasks` (same pair deduplication)
 *  - priority ordering by cursor proximity
 *  - batch chunking stays under Cloudflare's per-invocation subrequest cap
 *  - a realistic long-prompt scenario (60 changed segments) — every unique
 *    pair, ambiguity, and bp check is emitted exactly once across batches.
 */
import { describe, it, expect } from 'vitest'
import { planTasks, scoreTask, prioritizeAndBatch, type AnalyzerTask, type TaskSegment } from '../lib/analyzer-tasks'

function seg(hash: string, startIndex: number, endIndex: number): TaskSegment {
  return { hash, startIndex, endIndex }
}

describe('planTasks', () => {
  it('produces no tasks when nothing changed', () => {
    const segs = [seg('a', 0, 10), seg('b', 11, 20)]
    expect(planTasks(segs, [])).toEqual([])
  })

  it('deduplicates pairs when both segments are changed', () => {
    const segs = [seg('a', 0, 10), seg('b', 11, 20)]
    const tasks = planTasks(segs, ['a', 'b'])
    const pairs = tasks.filter(t => t.kind === 'pair')
    // One unique (a,b) pair, not two
    expect(pairs).toHaveLength(1)
    // Plus ambiguity + bp for each of the two changed segments
    expect(tasks.filter(t => t.kind === 'ambiguity')).toHaveLength(2)
    expect(tasks.filter(t => t.kind === 'bp')).toHaveLength(2)
  })

  it('pairs changed against every other segment', () => {
    const segs = [seg('a', 0, 10), seg('b', 11, 20), seg('c', 21, 30)]
    const tasks = planTasks(segs, ['a'])
    const pairs = tasks.filter(t => t.kind === 'pair')
    // `a` pairs against `b` and `c`, nothing else
    expect(pairs).toHaveLength(2)
    const involved = pairs.map(p => (p as { a: string; b: string }).a + '-' + (p as { a: string; b: string }).b)
    expect(involved.join(',')).toMatch(/a-b/)
    expect(involved.join(',')).toMatch(/a-c/)
  })

  it('pair count matches the N² graph shape for whole-prompt change', () => {
    // 10 segments, all changed → 10 choose 2 = 45 unique pairs
    const segs = Array.from({ length: 10 }, (_, i) => seg(`h${i}`, i * 10, i * 10 + 5))
    const tasks = planTasks(segs, segs.map(s => s.hash))
    expect(tasks.filter(t => t.kind === 'pair')).toHaveLength(45)
  })
})

describe('scoreTask / prioritizeAndBatch', () => {
  const segs = [
    seg('a', 0, 10),     // near top
    seg('b', 100, 110),  // near cursor
    seg('c', 500, 510),  // far
  ]
  const segByHash = new Map(segs.map(s => [s.hash, s]))

  it('scores a segment containing the cursor as 0', () => {
    expect(scoreTask({ kind: 'ambiguity', h: 'b' }, 105, segByHash)).toBe(0)
  })

  it('scores a pair by the NEARER of the two segments', () => {
    // cursor at 105 → inside b (0 distance). Pair (a, b): min(105, 0) = 0.
    expect(scoreTask({ kind: 'pair', a: 'a', b: 'b' }, 105, segByHash)).toBe(0)
    // Pair (a, c): min(105, 395) = 95.
    expect(scoreTask({ kind: 'pair', a: 'a', b: 'c' }, 105, segByHash)).toBe(95)
  })

  it('sorts tasks nearest the cursor first', () => {
    const tasks: AnalyzerTask[] = [
      { kind: 'ambiguity', h: 'c' },
      { kind: 'ambiguity', h: 'a' },
      { kind: 'ambiguity', h: 'b' },
    ]
    const [batch] = prioritizeAndBatch(tasks, 105, segs, 100)
    expect(batch.map(t => (t as { h: string }).h)).toEqual(['b', 'a', 'c'])
  })

  it('chunks tasks into batches of at most batchSize', () => {
    const many: AnalyzerTask[] = Array.from({ length: 250 }, (_, i) => ({ kind: 'ambiguity' as const, h: `h${i % 3 === 0 ? 'a' : i % 3 === 1 ? 'b' : 'c'}` }))
    const batches = prioritizeAndBatch(many, 105, segs, 100)
    expect(batches).toHaveLength(3) // 100 + 100 + 50
    expect(batches[0]).toHaveLength(100)
    expect(batches[1]).toHaveLength(100)
    expect(batches[2]).toHaveLength(50)
  })
})

describe('long-prompt end-to-end task graph', () => {
  it('a 60-segment all-changed prompt stays under the Cloudflare subrequest cap per batch', () => {
    // 60 segments pairwise = 60*59/2 = 1770 pair tasks + 60 ambig + 60 bp = 1890 total.
    // A single-invocation run would blow past CF's 1000-subrequest limit; client
    // batching splits it. With batchSize = 400 we expect 5 batches each ≤ 400 tasks.
    const N = 60
    const segs: TaskSegment[] = Array.from({ length: N }, (_, i) => seg(`h${i}`, i * 50, i * 50 + 30))
    const tasks = planTasks(segs, segs.map(s => s.hash))
    expect(tasks).toHaveLength((N * (N - 1)) / 2 + 2 * N) // 1890

    const batches = prioritizeAndBatch(tasks, 0, segs, 400)
    expect(batches.length).toBeGreaterThan(1)
    for (const batch of batches) {
      // Every batch must fit well inside CF's 1000-subrequest budget (each
      // task = 1 OpenAI call = 1 subrequest, plus a handful for logging).
      expect(batch.length).toBeLessThanOrEqual(400)
    }

    // Sum of all batches equals the task count — nothing dropped, nothing duplicated.
    const flat = batches.flat()
    expect(flat).toHaveLength(tasks.length)

    // Every unique pair appears exactly once across all batches.
    const pairKeys = new Set<string>()
    let pairCount = 0
    for (const t of flat) {
      if (t.kind !== 'pair') continue
      pairCount++
      const key = t.a < t.b ? `${t.a}:${t.b}` : `${t.b}:${t.a}`
      pairKeys.add(key)
    }
    expect(pairKeys.size).toBe(pairCount)
    expect(pairCount).toBe((N * (N - 1)) / 2)

    // Every segment appears exactly once for ambiguity and once for bp.
    const ambig = flat.filter(t => t.kind === 'ambiguity').map(t => (t as { h: string }).h)
    const bp = flat.filter(t => t.kind === 'bp').map(t => (t as { h: string }).h)
    expect(new Set(ambig).size).toBe(N)
    expect(new Set(bp).size).toBe(N)
    expect(ambig).toHaveLength(N)
    expect(bp).toHaveLength(N)
  })

  it('prioritized first batch is dominated by tasks near the cursor', () => {
    // Cursor at the START of the doc. The first batch should be filled with
    // tasks whose involved segments cluster near position 0.
    const N = 20
    const segs: TaskSegment[] = Array.from({ length: N }, (_, i) => seg(`h${i}`, i * 100, i * 100 + 50))
    const tasks = planTasks(segs, segs.map(s => s.hash))
    const [firstBatch] = prioritizeAndBatch(tasks, 0, segs, 30)

    const segByHash = new Map(segs.map(s => [s.hash, s]))
    // Every task in the first batch should involve at least one segment in
    // the first ~half of the doc (indices 0..N/2).
    for (const t of firstBatch) {
      const involved = t.kind === 'pair' ? [t.a, t.b] : [t.h]
      const earliest = Math.min(...involved.map(h => segByHash.get(h)!.startIndex))
      expect(earliest).toBeLessThan(N * 100 / 2)
    }
  })
})
