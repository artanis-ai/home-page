/**
 * Client-side task planner for incremental analysis.
 *
 * Mirrors the server's `enumerateTasks` (mallet-worker/src/lib/analyzer.ts)
 * so the client can spread a large prompt's N² pair fan-out across multiple
 * `/api/analyze` calls. Each call is a fresh Cloudflare Worker invocation
 * with its own 1000-subrequest budget — that's how we stay under the limit
 * on big pastes.
 *
 * Must stay in sync with the server's enumerator. The server silently skips
 * tasks whose hashes aren't in the segments it receives (stale batches from
 * a client that moved on), so divergence here produces missing issues, not
 * errors. Covered by tests in __tests__/analyzer-tasks.test.ts.
 */

export type AnalyzerTask =
  | { kind: 'pair'; a: string; b: string }
  | { kind: 'ambiguity'; h: string }
  | { kind: 'bp'; h: string }

export interface TaskSegment {
  hash: string
  startIndex: number
  endIndex: number
}

/**
 * Build the complete task list for a given (segments, changedHashes) input.
 * Mirrors the server so client and server agree on what work exists.
 */
export function planTasks(segments: TaskSegment[], changedHashes: string[]): AnalyzerTask[] {
  const changedSet = new Set(changedHashes)
  const changed = segments.filter(s => changedSet.has(s.hash))
  const others = segments.filter(s => !changedSet.has(s.hash))
  if (changed.length === 0) return []

  const out: AnalyzerTask[] = []
  const seen = new Set<string>()
  for (const a of changed) {
    for (const b of [...others, ...changed.filter(x => x.hash !== a.hash)]) {
      const key = a.hash < b.hash ? `${a.hash}:${b.hash}` : `${b.hash}:${a.hash}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ kind: 'pair', a: a.hash, b: b.hash })
    }
  }
  for (const seg of changed) out.push({ kind: 'ambiguity', h: seg.hash })
  for (const seg of changed) out.push({ kind: 'bp', h: seg.hash })
  return out
}

/**
 * Priority score for one task — smaller is higher priority. Score is the
 * min distance from `cursor` to the nearer edge of any involved segment.
 * Segments straddling the cursor score 0. Stale tasks (hash not in the
 * map) get +Infinity so they sort to the end.
 */
export function scoreTask(task: AnalyzerTask, cursor: number, segByHash: Map<string, TaskSegment>): number {
  const distTo = (h: string): number => {
    const s = segByHash.get(h)
    if (!s) return Number.POSITIVE_INFINITY
    if (cursor < s.startIndex) return s.startIndex - cursor
    if (cursor > s.endIndex) return cursor - s.endIndex
    return 0
  }
  if (task.kind === 'pair') return Math.min(distTo(task.a), distTo(task.b))
  return distTo(task.h)
}

/**
 * Sort tasks by ascending priority (cursor-proximity first) and chunk into
 * batches of at most `batchSize`. We used to batch at 400 (well under CF's
 * 1000-subrequest cap) but production pastes of ~110 segments still tripped
 * CF's per-isolate CPU/memory limit, returning edge errors without our
 * cors() headers. Dropping to 100 keeps each invocation lean; the client
 * concurrency pool is what actually controls total throughput.
 */
export function prioritizeAndBatch(
  tasks: AnalyzerTask[],
  cursor: number,
  segments: TaskSegment[],
  batchSize = 100,
): AnalyzerTask[][] {
  const segByHash = new Map(segments.map(s => [s.hash, s]))
  const sorted = [...tasks].sort((a, b) =>
    scoreTask(a, cursor, segByHash) - scoreTask(b, cursor, segByHash)
  )
  const batches: AnalyzerTask[][] = []
  for (let i = 0; i < sorted.length; i += batchSize) {
    batches.push(sorted.slice(i, i + batchSize))
  }
  return batches
}
