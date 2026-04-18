import { describe, it, expect } from 'vitest'
import {
  parseLineRangeHash,
  formatLineRangeHash,
  splitByLineRange,
  reassemble,
  type LineRange,
  type SplitContent,
} from '../lib/line-range'

describe('parseLineRangeHash', () => {
  it('parses GitHub-style range #L1-L8', () => {
    expect(parseLineRangeHash('#L1-L8')).toEqual({ start: 1, end: 8 })
  })

  it('parses single-line #L5', () => {
    expect(parseLineRangeHash('#L5')).toEqual({ start: 5, end: 5 })
  })

  it('parses without leading # (so callers can pass stripped fragments)', () => {
    expect(parseLineRangeHash('L1-L8')).toEqual({ start: 1, end: 8 })
    expect(parseLineRangeHash('L3')).toEqual({ start: 3, end: 3 })
  })

  it('rejects backwards ranges (start > end)', () => {
    expect(parseLineRangeHash('#L10-L5')).toBeNull()
  })

  it('rejects zero and negative starts', () => {
    expect(parseLineRangeHash('#L0')).toBeNull()
    expect(parseLineRangeHash('#L0-L5')).toBeNull()
  })

  it('rejects malformed inputs', () => {
    expect(parseLineRangeHash('')).toBeNull()
    expect(parseLineRangeHash('#')).toBeNull()
    expect(parseLineRangeHash('#foo')).toBeNull()
    expect(parseLineRangeHash('#L')).toBeNull()
    expect(parseLineRangeHash('#L1-')).toBeNull()
    expect(parseLineRangeHash('#LxLy')).toBeNull()
    expect(parseLineRangeHash('#1-8')).toBeNull()       // missing "L" prefix
    expect(parseLineRangeHash('#L1 L8')).toBeNull()     // space separator
    expect(parseLineRangeHash('#L1.5-L2')).toBeNull()   // decimals
  })

  it('rejects null/undefined safely (so callers can pass location.hash)', () => {
    expect(parseLineRangeHash(null)).toBeNull()
    expect(parseLineRangeHash(undefined)).toBeNull()
  })

  it('treats #L3-L3 the same as #L3', () => {
    expect(parseLineRangeHash('#L3-L3')).toEqual({ start: 3, end: 3 })
  })
})

describe('formatLineRangeHash', () => {
  it('emits #L1-L8 for multi-line ranges', () => {
    expect(formatLineRangeHash({ start: 1, end: 8 })).toBe('#L1-L8')
  })

  it('emits #L5 for single-line ranges', () => {
    expect(formatLineRangeHash({ start: 5, end: 5 })).toBe('#L5')
  })

  it('round-trips through parse', () => {
    const cases: LineRange[] = [
      { start: 1, end: 1 },
      { start: 1, end: 8 },
      { start: 42, end: 42 },
      { start: 100, end: 250 },
    ]
    for (const r of cases) {
      expect(parseLineRangeHash(formatLineRangeHash(r))).toEqual(r)
    }
  })
})

describe('splitByLineRange', () => {
  const content5 = 'a\nb\nc\nd\ne'

  it('splits a middle range', () => {
    const s = splitByLineRange(content5, { start: 2, end: 4 })
    expect(s).toEqual({ before: 'a', slice: 'b\nc\nd', after: 'e' })
  })

  it('splits a range at the very start (L1)', () => {
    const s = splitByLineRange(content5, { start: 1, end: 3 })
    expect(s).toEqual({ before: '', slice: 'a\nb\nc', after: 'd\ne' })
  })

  it('splits a range at the very end', () => {
    const s = splitByLineRange(content5, { start: 3, end: 5 })
    expect(s).toEqual({ before: 'a\nb', slice: 'c\nd\ne', after: '' })
  })

  it('handles a single-line range', () => {
    const s = splitByLineRange(content5, { start: 3, end: 3 })
    expect(s).toEqual({ before: 'a\nb', slice: 'c', after: 'd\ne' })
  })

  it('handles the whole file as the range', () => {
    const s = splitByLineRange(content5, { start: 1, end: 5 })
    expect(s).toEqual({ before: '', slice: content5, after: '' })
  })

  it('preserves a trailing newline in the after chunk', () => {
    const s = splitByLineRange('a\nb\nc\n', { start: 1, end: 2 })
    // split('\n') on "a\nb\nc\n" gives ['a','b','c','']
    expect(s).toEqual({ before: '', slice: 'a\nb', after: 'c\n' })
  })

  it('preserves a trailing newline when the range covers up to the last real line', () => {
    const s = splitByLineRange('a\nb\nc\n', { start: 1, end: 3 })
    expect(s).toEqual({ before: '', slice: 'a\nb\nc', after: '' })
  })

  it('clamps ranges that extend past the end of the file', () => {
    const s = splitByLineRange(content5, { start: 3, end: 9999 })
    expect(s.slice).toBe('c\nd\ne')
    expect(s.after).toBe('')
  })

  it('clamps a start past end of file to the last line', () => {
    const s = splitByLineRange(content5, { start: 99, end: 100 })
    expect(s.slice).toBe('e')
    expect(s.after).toBe('')
  })
})

describe('reassemble', () => {
  const content5 = 'a\nb\nc\nd\ne'

  it('round-trips when slice is unchanged', () => {
    const split = splitByLineRange(content5, { start: 2, end: 4 })
    expect(reassemble(split, split.slice)).toBe(content5)
  })

  it.each([
    { range: { start: 1, end: 1 }, label: 'first line only' },
    { range: { start: 1, end: 3 }, label: 'from L1' },
    { range: { start: 3, end: 5 }, label: 'through last line' },
    { range: { start: 2, end: 4 }, label: 'middle' },
    { range: { start: 1, end: 5 }, label: 'whole file' },
    { range: { start: 3, end: 3 }, label: 'single middle line' },
    { range: { start: 5, end: 5 }, label: 'single last line' },
  ])('round-trips for $label (L$range.start-L$range.end)', ({ range }) => {
    const split = splitByLineRange(content5, range)
    expect(reassemble(split, split.slice)).toBe(content5)
  })

  it('round-trips files with a trailing newline', () => {
    const c = 'a\nb\nc\n'
    const range = { start: 2, end: 2 }
    const split = splitByLineRange(c, range)
    expect(reassemble(split, split.slice)).toBe(c)
  })

  it('round-trips files with multiple trailing newlines', () => {
    const c = 'a\nb\n\n\n'
    const range = { start: 1, end: 2 }
    const split = splitByLineRange(c, range)
    expect(reassemble(split, split.slice)).toBe(c)
  })

  it('round-trips a single-line file', () => {
    const c = 'hello'
    const split = splitByLineRange(c, { start: 1, end: 1 })
    expect(split).toEqual({ before: '', slice: 'hello', after: '' })
    expect(reassemble(split, split.slice)).toBe(c)
  })

  it('round-trips an empty file', () => {
    const c = ''
    const split = splitByLineRange(c, { start: 1, end: 1 })
    expect(reassemble(split, split.slice)).toBe(c)
  })

  it('inserts added lines inside the slice without touching the anchors', () => {
    const split = splitByLineRange(content5, { start: 2, end: 4 })
    const edited = 'b\nNEW1\nNEW2\nc\nd'
    expect(reassemble(split, edited)).toBe('a\nb\nNEW1\nNEW2\nc\nd\ne')
  })

  it('handles deleted lines inside the slice', () => {
    const split = splitByLineRange(content5, { start: 2, end: 4 })
    const edited = 'b' // user deleted c and d
    expect(reassemble(split, edited)).toBe('a\nb\ne')
  })

  it('handles a completely rewritten slice', () => {
    const split = splitByLineRange(content5, { start: 2, end: 4 })
    expect(reassemble(split, 'rewritten\nmulti\nline\nprompt'))
      .toBe('a\nrewritten\nmulti\nline\nprompt\ne')
  })

  it('keeps an empty-slice edit as an empty line (no auto-delete of surroundings)', () => {
    // Documents the invariant: reassembling with "" leaves a blank line in place.
    // This is intentional — callers who want "delete the region entirely"
    // can post-process the joined content themselves.
    const split = splitByLineRange(content5, { start: 2, end: 4 })
    expect(reassemble(split, '')).toBe('a\n\ne')
  })

  it('handles edits on a range anchored at L1', () => {
    const split = splitByLineRange(content5, { start: 1, end: 2 })
    expect(reassemble(split, 'A\nB\nC')).toBe('A\nB\nC\nc\nd\ne')
  })

  it('handles edits on a range anchored at the last line', () => {
    const split = splitByLineRange(content5, { start: 4, end: 5 })
    expect(reassemble(split, 'D\nE\nF')).toBe('a\nb\nc\nD\nE\nF')
  })

  it('handles edits when the whole file is the range', () => {
    const split = splitByLineRange(content5, { start: 1, end: 5 })
    expect(reassemble(split, 'only-line')).toBe('only-line')
  })

  it('is stable under repeated edits (many-step editing simulation)', () => {
    // Simulates a user adding 3 lines, then deleting 2, then rewriting.
    const split = splitByLineRange(content5, { start: 2, end: 4 })

    // Step 1: add lines
    let edited = 'b\nadded1\nadded2\nc\nd'
    expect(reassemble(split, edited)).toBe('a\nb\nadded1\nadded2\nc\nd\ne')

    // Step 2: delete some
    edited = 'b\nadded1\nc'
    expect(reassemble(split, edited)).toBe('a\nb\nadded1\nc\ne')

    // Step 3: rewrite
    edited = 'totally-different'
    expect(reassemble(split, edited)).toBe('a\ntotally-different\ne')

    // before/after are immutable — verify by re-splitting original content
    // and checking anchors match the original anchors.
    const reSplit = splitByLineRange(content5, { start: 2, end: 4 })
    expect(reSplit.before).toBe(split.before)
    expect(reSplit.after).toBe(split.after)
  })
})

describe('end-to-end scenarios', () => {
  // Realistic prompts.py-shaped content with two prompts.
  const promptsPy = [
    '"""Prompts for landlord-ai."""',          // L1
    '',                                         // L2
    'SYSTEM_PROMPT_GREETING = """',             // L3
    'You are a helpful landlord assistant.',    // L4
    'Always greet warmly.',                     // L5
    '"""',                                      // L6
    '',                                         // L7
    'SYSTEM_PROMPT_REPAIR = """',               // L8
    'You handle repair requests.',              // L9
    'Ask for the property address.',            // L10
    'Estimate urgency on a 1-5 scale.',         // L11
    '"""',                                      // L12
  ].join('\n')

  it('opens the first prompt (L3-L6) cleanly', () => {
    const split = splitByLineRange(promptsPy, { start: 3, end: 6 })
    expect(split.slice).toBe(
      'SYSTEM_PROMPT_GREETING = """\nYou are a helpful landlord assistant.\nAlways greet warmly.\n"""'
    )
    expect(reassemble(split, split.slice)).toBe(promptsPy)
  })

  it('opens the second prompt (L8-L12), user edits, PR content is correct', () => {
    const split = splitByLineRange(promptsPy, { start: 8, end: 12 })
    const userEdit = [
      'SYSTEM_PROMPT_REPAIR = """',
      'You are the repair triage agent.',
      'Always ask for the property address first.',
      'Rate urgency 1-5 and explain the score.',
      '"""',
    ].join('\n')

    const result = reassemble(split, userEdit)

    expect(result).toContain('SYSTEM_PROMPT_GREETING')  // other prompt untouched
    expect(result).toContain('You are the repair triage agent.')
    expect(result).not.toContain('You handle repair requests.')
    // The untouched first-prompt region must be byte-identical.
    expect(result.startsWith(split.before + '\n')).toBe(true)
  })

  it('two prompts in the same file — editing one must not disturb the other', () => {
    const greetingRange = { start: 3, end: 6 }
    const repairRange = { start: 8, end: 12 }

    const splitGreeting = splitByLineRange(promptsPy, greetingRange)
    const splitRepair = splitByLineRange(promptsPy, repairRange)

    // Verify the two slices are distinct
    expect(splitGreeting.slice).not.toBe(splitRepair.slice)
    expect(splitGreeting.slice).toContain('GREETING')
    expect(splitRepair.slice).toContain('REPAIR')

    // Repair's `before` contains the full greeting block verbatim.
    expect(splitRepair.before).toContain('GREETING')
    expect(splitRepair.before).toContain('Always greet warmly.')
  })

  it('handles a slice that the LLM over-reported (end past EOF)', () => {
    // LLM might say "L8-L99" for the last prompt — we clamp gracefully.
    const split = splitByLineRange(promptsPy, { start: 8, end: 99 })
    expect(split.slice).toBe(
      'SYSTEM_PROMPT_REPAIR = """\nYou handle repair requests.\nAsk for the property address.\nEstimate urgency on a 1-5 scale.\n"""'
    )
    expect(split.after).toBe('')
    expect(reassemble(split, split.slice)).toBe(promptsPy)
  })
})

describe('type exports (smoke)', () => {
  it('compiles with the right shape', () => {
    const s: SplitContent = { before: 'a', slice: 'b', after: 'c' }
    expect(reassemble(s, s.slice)).toBe('a\nb\nc')
  })
})
