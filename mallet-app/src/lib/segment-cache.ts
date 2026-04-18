/**
 * Cross-render persistence for segment-level analysis state.
 *
 * Why: without it, every editor remount (page reload, route change, navigating
 * away and back) sends ALL segments through /api/analyze again. That re-runs
 * three LLM calls per segment plus pairwise contradiction checks across the
 * whole document — wasteful in latency, OpenAI cost, and rate-limit budget.
 *
 * What we cache: per-room, the set of segment hashes the leader has already
 * analyzed AND the issues those analyses produced (keyed by segment hash, not
 * by absolute range — ranges shift as the doc edits, hashes don't).
 *
 * Where it lives: localStorage. The Mallet promise is "prompts never leave
 * your browser" (the SERVER doesn't store prompts) — local-only persistence
 * on the user's own machine respects that. We only cache the room's own
 * analysis output, never anyone else's.
 *
 * What we DO NOT cache: the segment text itself. The hash is one-way; if a
 * user clears localStorage we lose the cache, and that's fine. Issue messages
 * may quote short fragments of the segment text — acceptable, since the data
 * never leaves the user's browser.
 */
import type { AnalysisIssue } from '../types'

const STORAGE_PREFIX = 'mallet:segcache:v1:'
const MAX_ROOMS = 32 // simple LRU bound — keep last N rooms only
const ROOM_INDEX_KEY = 'mallet:segcache:v1:_index'

/** Issue without its (stale) range — we recompute the range on hydrate. */
export type CachedIssue = Omit<AnalysisIssue, 'range'>

export interface CachedRoom {
  /** Segment hashes whose analysis has already been performed. */
  hashes: string[]
  /** Map of segment hash → issues produced when that segment was analyzed. */
  issuesByHash: Record<string, CachedIssue[]>
  /** Wall-clock ms of last write — used for LRU eviction. */
  updatedAt: number
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    // Private mode / disabled storage / SSR.
    return null
  }
}

function readIndex(s: Storage): string[] {
  try {
    const raw = s.getItem(ROOM_INDEX_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function writeIndex(s: Storage, rooms: string[]): void {
  try {
    s.setItem(ROOM_INDEX_KEY, JSON.stringify(rooms))
  } catch {
    /* quota — ignore */
  }
}

function bumpIndex(s: Storage, roomKey: string): void {
  const idx = readIndex(s).filter((k) => k !== roomKey)
  idx.unshift(roomKey)
  // Evict oldest entries to keep storage bounded.
  while (idx.length > MAX_ROOMS) {
    const evict = idx.pop()!
    try { s.removeItem(evict) } catch { /* noop */ }
  }
  writeIndex(s, idx)
}

function keyFor(roomId: string): string {
  return STORAGE_PREFIX + roomId
}

export function loadRoom(roomId: string): CachedRoom | null {
  const s = safeStorage()
  if (!s) return null
  try {
    const raw = s.getItem(keyFor(roomId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedRoom
    // Validate shape defensively — tolerate stale schemas by returning null.
    if (!Array.isArray(parsed.hashes) || typeof parsed.issuesByHash !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

export function saveRoom(roomId: string, room: CachedRoom): void {
  const s = safeStorage()
  if (!s) return
  try {
    s.setItem(keyFor(roomId), JSON.stringify({ ...room, updatedAt: Date.now() }))
    bumpIndex(s, keyFor(roomId))
  } catch {
    // Quota exceeded — drop oldest and retry once.
    try {
      const idx = readIndex(s)
      const evict = idx.pop()
      if (evict) {
        s.removeItem(evict)
        writeIndex(s, idx)
        s.setItem(keyFor(roomId), JSON.stringify({ ...room, updatedAt: Date.now() }))
      }
    } catch { /* give up silently */ }
  }
}

export function clearRoom(roomId: string): void {
  const s = safeStorage()
  if (!s) return
  try {
    s.removeItem(keyFor(roomId))
    writeIndex(s, readIndex(s).filter((k) => k !== keyFor(roomId)))
  } catch { /* noop */ }
}

/**
 * Strip the range from an AnalysisIssue for caching. Range is inherently
 * positional and goes stale across edits — we recompute it on hydrate.
 */
export function stripRange(issue: AnalysisIssue): CachedIssue {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { range, ...rest } = issue
  return rest
}

/**
 * Group an issue list by the segment hash whose range fully contains the
 * issue. Issues that don't fit any segment (e.g. cross-segment contradictions)
 * fall under a synthetic "_pair" bucket keyed on the hashes mentioned in the
 * id (which our analyze route formats as `c_<hashA>_<hashB>`).
 */
export function groupIssuesBySegment(
  issues: AnalysisIssue[],
  segments: { hash: string; startIndex: number; endIndex: number }[]
): Record<string, CachedIssue[]> {
  const out: Record<string, CachedIssue[]> = {}
  for (const issue of issues) {
    const seg = segments.find(
      (s) => issue.range[0] >= s.startIndex && issue.range[1] <= s.endIndex
    )
    const key = seg ? seg.hash : `_pair:${issue.id}`
    if (!out[key]) out[key] = []
    out[key].push(stripRange(issue))
  }
  return out
}

/**
 * Recompute ranges for cached issues against current segment positions.
 * Issues whose owning segment is no longer present are dropped; pair-bucket
 * issues (cross-segment contradictions) keep their cached id but get the
 * range of the first matching hash in their id.
 */
export function rehydrateIssues(
  issuesByHash: Record<string, CachedIssue[]>,
  segments: { hash: string; startIndex: number; endIndex: number }[]
): AnalysisIssue[] {
  const segByHash = new Map(segments.map((s) => [s.hash, s]))
  const out: AnalysisIssue[] = []
  for (const [key, cached] of Object.entries(issuesByHash)) {
    if (key.startsWith('_pair:')) {
      // Pair issues have IDs like c_<hashA>_<hashB>. Range belongs to hashA.
      for (const ci of cached) {
        const m = ci.id.match(/^[a-z]+_([0-9a-zA-Z]+)_([0-9a-zA-Z]+)$/)
        if (!m) continue
        const seg = segByHash.get(m[1]) || segByHash.get(m[2])
        if (!seg) continue
        out.push({ ...ci, range: [seg.startIndex, seg.endIndex] })
      }
    } else {
      const seg = segByHash.get(key)
      if (!seg) continue
      for (const ci of cached) {
        out.push({ ...ci, range: [seg.startIndex, seg.endIndex] })
      }
    }
  }
  return out
}
