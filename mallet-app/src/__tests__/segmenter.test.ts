import { describe, it, expect } from 'vitest'
import { segmentPrompt, getChangedSegments } from '../lib/segmenter'

describe('segmentPrompt', () => {
  it('returns empty array for empty string', () => {
    expect(segmentPrompt('')).toEqual([])
    expect(segmentPrompt('   ')).toEqual([])
  })

  it('splits by newlines', () => {
    const text = 'You are a helpful assistant.\nAlways respond in JSON.'
    const segments = segmentPrompt(text)
    expect(segments).toHaveLength(2)
    expect(segments[0].text).toBe('You are a helpful assistant.')
    expect(segments[1].text).toBe('Always respond in JSON.')
  })

  it('skips empty lines', () => {
    const text = 'Line one.\n\nLine three.'
    const segments = segmentPrompt(text)
    expect(segments).toHaveLength(2)
    expect(segments[0].text).toBe('Line one.')
    expect(segments[1].text).toBe('Line three.')
  })

  it('splits sentences within a line', () => {
    const text = 'Be concise. Always use JSON. Never reveal secrets.'
    const segments = segmentPrompt(text)
    expect(segments).toHaveLength(3)
    expect(segments[0].text).toBe('Be concise.')
    expect(segments[1].text).toBe('Always use JSON.')
    expect(segments[2].text).toBe('Never reveal secrets.')
  })

  it('does not split on periods in abbreviations or numbers', () => {
    const text = 'Use version 3.5 for this task.'
    const segments = segmentPrompt(text)
    // "3.5" should not cause a split because there's no uppercase after the space
    expect(segments).toHaveLength(1)
  })

  it('does not split numbered list bullets into standalone segments', () => {
    // Regression: "1. Read the docs." used to emit a "1." segment plus
    // "Read the docs." — the analyzer then pairwise-compared bare numbers
    // and hallucinated contradictions in long structured prompts.
    const text = '1. Read the ticket carefully.\n2. Identify the root issue.'
    const segments = segmentPrompt(text)
    expect(segments.map((s) => s.text)).toEqual([
      '1. Read the ticket carefully.',
      '2. Identify the root issue.',
    ])
  })

  it('does not split lettered list bullets into standalone segments', () => {
    const text = 'a. First option\nb. Second option'
    const segments = segmentPrompt(text)
    expect(segments.map((s) => s.text)).toEqual(['a. First option', 'b. Second option'])
  })

  it('assigns unique IDs to each segment', () => {
    const text = 'Line one.\nLine two.\nLine three.'
    const segments = segmentPrompt(text)
    const ids = segments.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('detects dynamic segments with mustache syntax', () => {
    const text = 'Include {{user_name}} in the greeting.'
    const segments = segmentPrompt(text)
    expect(segments[0].type).toBe('dynamic')
  })

  it('detects dynamic segments with JS template syntax', () => {
    const text = 'Hello ${name}, welcome.'
    const segments = segmentPrompt(text)
    expect(segments[0].type).toBe('dynamic')
  })

  it('detects dynamic segments with Python format strings', () => {
    const text = 'The user said: {user_input}'
    const segments = segmentPrompt(text)
    expect(segments[0].type).toBe('dynamic')
  })

  it('marks plain text as static', () => {
    const text = 'You are a helpful assistant.'
    const segments = segmentPrompt(text)
    expect(segments[0].type).toBe('static')
  })

  it('tracks correct offsets', () => {
    const text = 'First line.\nSecond line.'
    const segments = segmentPrompt(text)
    expect(text.slice(segments[0].startOffset, segments[0].endOffset)).toBe('First line.')
    expect(text.slice(segments[1].startOffset, segments[1].endOffset)).toBe('Second line.')
  })

  it('tracks distinct offsets for duplicate sentences (regression: indexOf+trim bug)', () => {
    const text = 'Do this. Do this.'
    const segments = segmentPrompt(text)
    expect(segments).toHaveLength(2)
    // Both texts identical...
    expect(segments[0].text).toBe('Do this.')
    expect(segments[1].text).toBe('Do this.')
    // ...but their offsets must be different — and slicing must round-trip.
    expect(segments[0].startOffset).toBe(0)
    expect(segments[1].startOffset).toBe(9)
    expect(text.slice(segments[0].startOffset, segments[0].endOffset)).toBe('Do this.')
    expect(text.slice(segments[1].startOffset, segments[1].endOffset)).toBe('Do this.')
  })

  it('handles leading whitespace on a line correctly', () => {
    const text = '  Be brief.'
    const segments = segmentPrompt(text)
    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('Be brief.')
    // Offset must point at the 'B', not at column 0
    expect(text.slice(segments[0].startOffset, segments[0].endOffset)).toBe('Be brief.')
  })

  it('handles repeated identical lines', () => {
    const text = 'Be brief.\nBe brief.'
    const segments = segmentPrompt(text)
    expect(segments).toHaveLength(2)
    expect(text.slice(segments[0].startOffset, segments[0].endOffset)).toBe('Be brief.')
    expect(text.slice(segments[1].startOffset, segments[1].endOffset)).toBe('Be brief.')
    expect(segments[0].startOffset).not.toBe(segments[1].startOffset)
  })

  it('handles multi-sentence multi-line prompts', () => {
    const text = `You are a helpful assistant. Be professional.
Never share internal information.
If unsure, ask for clarification. Don't guess.`
    const segments = segmentPrompt(text)
    expect(segments.length).toBeGreaterThanOrEqual(5)
    expect(segments[0].text).toBe('You are a helpful assistant.')
    expect(segments[1].text).toBe('Be professional.')
  })
})

describe('getChangedSegments', () => {
  it('identifies new segments as changed', () => {
    const old = segmentPrompt('Be helpful.')
    const { changed, unchanged } = getChangedSegments(old, 'Be helpful.\nBe concise.')
    expect(unchanged).toHaveLength(1)
    expect(changed).toHaveLength(1)
    expect(changed[0].text).toBe('Be concise.')
  })

  it('identifies edited segments as changed', () => {
    const old = segmentPrompt('Be helpful.')
    const { changed } = getChangedSegments(old, 'Be very helpful.')
    expect(changed).toHaveLength(1)
    expect(changed[0].text).toBe('Be very helpful.')
  })

  it('returns all unchanged for identical text', () => {
    const text = 'Be helpful.\nBe concise.'
    const old = segmentPrompt(text)
    const { changed, unchanged } = getChangedSegments(old, text)
    expect(changed).toHaveLength(0)
    expect(unchanged).toHaveLength(2)
  })
})
