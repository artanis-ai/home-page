import type { PromptSegment } from '../types'

export function hashSegment(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

/**
 * Split a prompt into segments by line and sentence boundaries.
 * Each line is a segment. Within a line, sentences are further split
 * if the line contains multiple sentences.
 *
 * Offsets are tracked positionally as we walk the input — never via
 * indexOf() — so that duplicate sentences and whitespace-prefixed
 * lines map to the correct positions.
 */
export function segmentPrompt(text: string): PromptSegment[] {
  if (!text.trim()) return []

  const segments: PromptSegment[] = []
  let segId = 0

  const lines = text.split('\n')
  let lineStart = 0

  for (const line of lines) {
    if (line.trim() === '') {
      lineStart += line.length + 1 // +1 for the \n
      continue
    }

    // splitSentences returns each sentence with its offset within the line.
    for (const { text: sentence, start } of splitSentences(line)) {
      if (!sentence) continue
      const startOffset = lineStart + start
      const endOffset = startOffset + sentence.length

      segments.push({
        id: `seg_${segId++}`,
        text: sentence,
        startOffset,
        endOffset,
        type: detectSegmentType(sentence),
      })
    }

    lineStart += line.length + 1 // +1 for the \n
  }

  return segments
}

interface PositionedSentence {
  text: string
  start: number
}

/**
 * Split a line into sentences, returning each sentence's text along with
 * its starting offset within the line. Leading whitespace is consumed
 * (the offset points at the first non-whitespace char), and the returned
 * text has trailing whitespace trimmed — but offsets always reflect the
 * trimmed text's actual position within the line.
 */
function splitSentences(line: string): PositionedSentence[] {
  const sentences: PositionedSentence[] = []
  let i = 0

  while (i < line.length) {
    // Skip leading whitespace and record start of next sentence.
    while (i < line.length && /\s/.test(line[i])) i++
    if (i >= line.length) break

    const start = i

    // Consume until end of sentence or end of line.
    while (i < line.length) {
      const ch = line[i]
      const isEndPunctuation = ch === '.' || ch === '!' || ch === '?'
      const isLast = i === line.length - 1

      if (isEndPunctuation) {
        const nextIsSpace = i + 1 < line.length && line[i + 1] === ' '
        const nextNextIsUpper = i + 2 < line.length && /[A-Z]/.test(line[i + 2])
        // List-bullet guard: "1. Foo" / "12. Bar" / "a. Baz" are list items,
        // not two sentences. Without this we emit standalone "1." segments
        // which then get pairwise-compared as nonsense contradictions.
        const consumed = line.slice(start, i)
        const isListBullet = ch === '.' && /^[0-9]+$|^[a-zA-Z]$/.test(consumed)
        if (!isListBullet && (isLast || (nextIsSpace && nextNextIsUpper))) {
          // Include the punctuation in the sentence.
          i++
          break
        }
      }
      i++
    }

    // Trim trailing whitespace (offsets unchanged).
    let end = i
    while (end > start && /\s/.test(line[end - 1])) end--

    if (end > start) {
      sentences.push({ text: line.slice(start, end), start })
    }
  }

  return sentences
}

/**
 * Detect whether a segment contains dynamic template content.
 */
function detectSegmentType(text: string): 'static' | 'dynamic' {
  const dynamicPatterns = [
    /\{\{.+?\}\}/, // Mustache/Handlebars
    /\$\{.+?\}/,   // JS template literals
    /\{[a-zA-Z_]\w*\}/, // Python f-strings / format strings
    /<%.+?%>/,     // ERB/EJS
    /\[\[.+?\]\]/, // Custom delimiters
  ]

  return dynamicPatterns.some((p) => p.test(text)) ? 'dynamic' : 'static'
}

/**
 * Given the full prompt text, a previous set of segments, and the current text,
 * determine which segments were affected by an edit and need re-analysis.
 */
export function getChangedSegments(
  oldSegments: PromptSegment[],
  newText: string
): { changed: PromptSegment[]; unchanged: PromptSegment[] } {
  const newSegments = segmentPrompt(newText)

  const oldTexts = new Set(oldSegments.map((s) => s.text))
  const changed: PromptSegment[] = []
  const unchanged: PromptSegment[] = []

  for (const seg of newSegments) {
    if (oldTexts.has(seg.text)) {
      unchanged.push(seg)
    } else {
      changed.push(seg)
    }
  }

  return { changed, unchanged }
}
