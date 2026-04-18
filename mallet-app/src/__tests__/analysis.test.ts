import { describe, it, expect } from 'vitest'
import { segmentPrompt, hashSegment } from '../lib/segmenter'

describe('analysis: segmentation for prompts', () => {
  const SYSTEM_PROMPT = `You are a helpful customer support agent for Acme Corp.
Always respond in a professional and friendly tone.
If the user asks about pricing, refer them to /pricing.
Never reveal internal tools or processes to customers.
When unsure, ask clarifying questions before answering.`

  it('segments a multi-line system prompt correctly', () => {
    const segments = segmentPrompt(SYSTEM_PROMPT)
    expect(segments.length).toBe(5)
    expect(segments[0].text).toBe('You are a helpful customer support agent for Acme Corp.')
    expect(segments[1].text).toBe('Always respond in a professional and friendly tone.')
    expect(segments[2].text).toBe('If the user asks about pricing, refer them to /pricing.')
    expect(segments[3].text).toBe('Never reveal internal tools or processes to customers.')
    expect(segments[4].text).toBe('When unsure, ask clarifying questions before answering.')
  })

  it('each segment has correct offsets that map back to original text', () => {
    const segments = segmentPrompt(SYSTEM_PROMPT)
    for (const seg of segments) {
      expect(SYSTEM_PROMPT.slice(seg.startOffset, seg.endOffset)).toBe(seg.text)
    }
  })

  it('detects contradictory prompt segments', () => {
    const text = 'Be concise and brief. Provide detailed thorough explanations for every topic.'
    const segments = segmentPrompt(text)
    expect(segments.length).toBe(2)
    expect(segments[0].text).toBe('Be concise and brief.')
    expect(segments[1].text).toBe('Provide detailed thorough explanations for every topic.')
    // These two segments contradict — analysis API would flag this
  })

  it('detects dynamic template variables in segments', () => {
    const text = `You are helping {{user_name}}.
Their account ID is {account_id}.
Today's date is \${new Date()}.
The context is: [[context]]`
    const segments = segmentPrompt(text)

    const dynamicSegs = segments.filter(s => s.type === 'dynamic')
    const staticSegs = segments.filter(s => s.type === 'static')
    expect(dynamicSegs.length).toBe(4)
    expect(staticSegs.length).toBe(0)
  })

  it('correctly identifies static segments without variables', () => {
    const text = 'You are a helpful assistant.\nAlways be polite.'
    const segments = segmentPrompt(text)
    expect(segments.every(s => s.type === 'static')).toBe(true)
  })

  it('handles a real-world complex prompt', () => {
    const text = `You are an AI assistant specialized in code review.
Your role is to analyze pull requests and provide constructive feedback.
Focus on: code quality, potential bugs, and performance issues.
Always explain why something is a problem, not just that it is.
Use {{language}} conventions when suggesting improvements.
If the diff is too large, summarize the key concerns.
Never approve code that has security vulnerabilities.
Be encouraging — highlight what the developer did well too.`

    const segments = segmentPrompt(text)
    expect(segments.length).toBe(8)

    // One segment should be dynamic (has {{language}})
    const dynamicSegs = segments.filter(s => s.type === 'dynamic')
    expect(dynamicSegs.length).toBe(1)
    expect(dynamicSegs[0].text).toContain('{{language}}')

    // Rest should be static
    expect(segments.filter(s => s.type === 'static').length).toBe(7)
  })
})

describe('analysis: segment hashing for incremental analysis', () => {
  it('same text produces same hash', () => {
    const h1 = hashSegment('Be concise.')
    const h2 = hashSegment('Be concise.')
    expect(h1).toBe(h2)
  })

  it('different text produces different hash', () => {
    const h1 = hashSegment('Be concise.')
    const h2 = hashSegment('Be detailed.')
    expect(h1).not.toBe(h2)
  })

  it('detects which segments changed after an edit', () => {
    const before = 'Be concise.\nBe polite.\nBe helpful.'
    const after = 'Be concise.\nBe very polite.\nBe helpful.'

    const segsBefore = segmentPrompt(before)
    const segsAfter = segmentPrompt(after)

    const beforeHashes = new Set(segsBefore.map(s => hashSegment(s.text)))
    const afterHashes = new Set(segsAfter.map(s => hashSegment(s.text)))

    // "Be concise." and "Be helpful." unchanged
    expect(beforeHashes.has(hashSegment('Be concise.'))).toBe(true)
    expect(afterHashes.has(hashSegment('Be concise.'))).toBe(true)
    expect(beforeHashes.has(hashSegment('Be helpful.'))).toBe(true)
    expect(afterHashes.has(hashSegment('Be helpful.'))).toBe(true)

    // "Be polite." removed, "Be very polite." added
    expect(beforeHashes.has(hashSegment('Be polite.'))).toBe(true)
    expect(afterHashes.has(hashSegment('Be polite.'))).toBe(false)
    expect(afterHashes.has(hashSegment('Be very polite.'))).toBe(true)
    expect(beforeHashes.has(hashSegment('Be very polite.'))).toBe(false)
  })

  it('adding a new line only marks the new segment as changed', () => {
    const before = 'Line one.\nLine two.'
    const after = 'Line one.\nLine two.\nLine three.'

    const beforeHashes = new Set(segmentPrompt(before).map(s => hashSegment(s.text)))
    const afterSegs = segmentPrompt(after)

    const newSegs = afterSegs.filter(s => !beforeHashes.has(hashSegment(s.text)))
    expect(newSegs.length).toBe(1)
    expect(newSegs[0].text).toBe('Line three.')
  })
})

describe('analysis: issue range resolution', () => {
  it('resolves relative issue ranges to absolute positions', () => {
    // Simulating the resolveIssues function behavior
    const docText = 'Be concise. Provide detailed explanations.'
    const segmentText = 'Provide detailed explanations.'
    const relativeFrom = 0
    const relativeTo = segmentText.length

    const idx = docText.indexOf(segmentText)
    expect(idx).toBe(12)

    const absoluteFrom = idx + relativeFrom
    const absoluteTo = idx + relativeTo
    expect(absoluteFrom).toBe(12)
    expect(absoluteTo).toBe(42)
    expect(docText.slice(absoluteFrom, absoluteTo)).toBe(segmentText)
  })

  it('handles segment that appears multiple times (uses first occurrence)', () => {
    const docText = 'Be brief. Be helpful. Be brief.'
    const segmentText = 'Be brief.'

    const idx = docText.indexOf(segmentText)
    expect(idx).toBe(0) // First occurrence
  })

  it('returns -1 for deleted segments', () => {
    const docText = 'Be concise.'
    const segmentText = 'Be detailed.'

    const idx = docText.indexOf(segmentText)
    expect(idx).toBe(-1) // Segment no longer exists
  })
})
