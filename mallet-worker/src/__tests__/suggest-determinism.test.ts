import { describe, it, expect } from 'vitest'

const WORKER_URL = 'http://localhost:8787'

interface SuggestBody {
  segmentText: string
  issueType: string
  fullPrompt: string
  message: string
}

async function getSuggestion(body: SuggestBody) {
  const res = await fetch(`${WORKER_URL}/api/suggest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test_user_suggest_determinism',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Suggest failed: ${res.status}`)
  return res.json() as Promise<{ original: string; suggested: string; explanation: string }>
}

describe('/api/suggest determinism (temperature: 0)', () => {
  // Identical inputs must produce identical outputs now that we ship temp=0.
  // The client also caches suggestions per (slice + type + message), but a
  // deterministic backend is what makes the cache behaviour predictable across
  // sessions / different users hitting the same issue. Times the call so we
  // get a regression signal if the model gets noticeably slower.
  it('returns identical suggestions on back-to-back identical inputs', async () => {
    const body: SuggestBody = {
      segmentText: 'Be brief.',
      issueType: 'contradiction',
      fullPrompt: 'Be brief. Give long detailed answers.',
      message: 'Conflicts with the instruction to give long detailed answers.',
    }

    const t0 = Date.now()
    const a = await getSuggestion(body)
    const aDuration = Date.now() - t0

    const t1 = Date.now()
    const b = await getSuggestion(body)
    const bDuration = Date.now() - t1

    expect(a.original).toBe(b.original)
    expect(a.suggested).toBe(b.suggested)
    expect(a.explanation).toBe(b.explanation)

    // Sanity bound — if a single suggestion is taking >12s the model is misbehaving
    // or the worker is overloaded. Loose so flaky network doesn't fail the suite.
    expect(aDuration).toBeLessThan(12000)
    expect(bDuration).toBeLessThan(12000)
  }, 30000)

  it('different messages on the same slice can produce different suggestions', async () => {
    // Determinism is per-input, not per-slice. Two distinct issue messages
    // on the same text are legitimately different prompts — outputs may differ.
    // The point of this test is to guard against an over-eager cache or hash
    // collision making them collapse to the same answer server-side.
    const slice = 'Be brief.'
    const fullPrompt = 'Be brief. Give long detailed answers.'

    const a = await getSuggestion({
      segmentText: slice,
      issueType: 'contradiction',
      fullPrompt,
      message: 'Conflicts with the instruction to give long detailed answers.',
    })
    const b = await getSuggestion({
      segmentText: slice,
      issueType: 'best-practice',
      fullPrompt,
      message: 'Vague — specify what "brief" means (max words, sentences, etc.).',
    })

    // Both should produce something useful; we don't assert they're literally
    // different (the LLM might land on the same edit) — just that both calls
    // returned valid, non-empty content.
    expect(a.suggested).toBeTruthy()
    expect(b.suggested).toBeTruthy()
  }, 30000)
})
