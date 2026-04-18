/**
 * Prompt segmenter — splits a prompt into per-sentence segments with
 * character offsets back into the source text.
 *
 * Mirrors the logic in `mallet-app/src/lib/segmenter.ts` (the frontend
 * runs the same segmentation so issue ranges line up with CodeMirror
 * decorations). If you change one, change the other — and update
 * `mallet-app/src/__tests__/segmenter.test.ts` to cover the new case.
 *
 * We keep the logic duplicated across the two packages (rather than
 * factoring out a shared npm workspace) because:
 *   - The frontend bundles are tiny — a third workspace costs more than
 *     it saves for a ~60-line file.
 *   - Workers and Vite have different TS/runtime targets; a shared lib
 *     would need its own build pipeline.
 * The eval suite imports THIS module (the worker one) as its source of
 * truth so drift surfaces immediately in `npm run eval`.
 */

export interface Segment {
  text: string
  startIndex: number
  endIndex: number
  hash: string
}

export function hashSegment(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

interface PositionedSentence {
  text: string
  start: number
}

function splitSentences(line: string): PositionedSentence[] {
  const sentences: PositionedSentence[] = []
  let i = 0
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++
    if (i >= line.length) break
    const start = i
    while (i < line.length) {
      const ch = line[i]
      const isEnd = ch === '.' || ch === '!' || ch === '?'
      const isLast = i === line.length - 1
      if (isEnd) {
        const nextIsSpace = i + 1 < line.length && line[i + 1] === ' '
        const nextNextIsUpper = i + 2 < line.length && /[A-Z]/.test(line[i + 2])
        // List-bullet guard: keep in sync with mallet-app/src/lib/segmenter.ts.
        // "1. Foo" / "a. Bar" are list items, not two sentences.
        const consumed = line.slice(start, i)
        const isListBullet = ch === '.' && /^[0-9]+$|^[a-zA-Z]$/.test(consumed)
        if (!isListBullet && (isLast || (nextIsSpace && nextNextIsUpper))) {
          i++
          break
        }
      }
      i++
    }
    let end = i
    while (end > start && /\s/.test(line[end - 1])) end--
    if (end > start) sentences.push({ text: line.slice(start, end), start })
  }
  return sentences
}

/**
 * Split a full prompt into segments, each with a hash and the character
 * range it occupies in the source. Empty lines are skipped but counted
 * in the offset math.
 */
export function segmentPrompt(text: string): Segment[] {
  if (!text.trim()) return []
  const out: Segment[] = []
  const lines = text.split('\n')
  let lineStart = 0
  for (const line of lines) {
    if (line.trim() === '') {
      lineStart += line.length + 1
      continue
    }
    for (const { text: sentence, start } of splitSentences(line)) {
      const startIndex = lineStart + start
      const endIndex = startIndex + sentence.length
      out.push({ text: sentence, startIndex, endIndex, hash: hashSegment(sentence) })
    }
    lineStart += line.length + 1
  }
  return out
}
