/**
 * Line-range utilities for GitHub-style `#L1-L8` URL fragments.
 *
 * When a user opens a file at `…/prompts.py#L3-L7` we want the editor to
 * show ONLY those lines, while still letting them freely add or remove
 * lines inside that slice. The out-of-range content is held aside in
 * memory and re-joined verbatim when the user creates a PR.
 *
 * Invariants:
 *   - `splitByLineRange(c, r)` → `{ before, slice, after }` such that
 *     `reassemble(split, split.slice) === c` (round-trip on unchanged slice).
 *   - Line numbers are 1-indexed, inclusive on both ends (GitHub convention).
 *   - `before` / `after` are frozen the moment we open the file; edits only
 *     mutate the slice. That way added/deleted lines in the slice don't
 *     shift the anchors.
 */

export interface LineRange {
  /** 1-indexed, inclusive */
  start: number
  /** 1-indexed, inclusive */
  end: number
}

export interface SplitContent {
  before: string
  slice: string
  after: string
}

/**
 * Parse a URL hash fragment like `#L1-L8` or `#L5` into a LineRange.
 * Returns null for anything malformed, backwards, or zero/negative.
 * The leading `#` is optional so callers can pass `location.hash`
 * directly.
 */
export function parseLineRangeHash(hash: string | null | undefined): LineRange | null {
  if (!hash) return null
  const m = hash.match(/^#?L(\d+)(?:-L(\d+))?$/)
  if (!m) return null
  const start = parseInt(m[1], 10)
  const end = m[2] ? parseInt(m[2], 10) : start
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 1 || end < start) return null
  return { start, end }
}

/** Format a LineRange back into `#L1-L8` / `#L5` form. */
export function formatLineRangeHash(range: LineRange): string {
  return range.start === range.end ? `#L${range.start}` : `#L${range.start}-L${range.end}`
}

/**
 * Split a file's content into the slice inside `range` and the two
 * untouched chunks on either side.
 *
 * If the range extends past the file, the slice is clamped to what
 * exists — callers should treat that as "open whole remainder".
 */
export function splitByLineRange(content: string, range: LineRange): SplitContent {
  const lines = content.split('\n')
  // 1-indexed inclusive. Clamp to array bounds so out-of-range requests
  // (e.g. the LLM returning L1-L9999 on a 20-line file) degrade gracefully
  // instead of producing undefined splices.
  const start = Math.max(1, Math.min(range.start, lines.length))
  const end = Math.max(start, Math.min(range.end, lines.length))

  const before = lines.slice(0, start - 1)
  const slice = lines.slice(start - 1, end)
  const after = lines.slice(end)

  return {
    before: before.join('\n'),
    slice: slice.join('\n'),
    after: after.join('\n'),
  }
}

/**
 * Reassemble the full file from the frozen `before` / `after` chunks
 * and a (possibly edited) slice.
 *
 * The slice may have grown or shrunk — lines added or removed — we
 * never re-derive line numbers from it. Concatenation is the whole
 * trick: `before \n editedSlice \n after`, skipping the separator
 * whenever a side is empty so we don't prepend / append stray newlines
 * for ranges that start at L1 or end at the last line.
 *
 * Edge case: an entirely empty edited slice still gets joined with a
 * single newline on each side, preserving the positional hole. Callers
 * who want "delete the region" behaviour should post-process.
 */
export function reassemble(split: Pick<SplitContent, 'before' | 'after'>, editedSlice: string): string {
  const parts: string[] = []
  if (split.before.length > 0) parts.push(split.before)
  parts.push(editedSlice)
  if (split.after.length > 0) parts.push(split.after)
  return parts.join('\n')
}
