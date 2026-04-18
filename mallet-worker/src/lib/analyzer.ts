/**
 * Analyzer core — extracted so both the authenticated `/api/analyze` route
 * (incremental, segment + changedHashes input) and the public API skill
 * endpoint (whole-prompt input) can share the exact same OpenAI fan-out
 * logic and prompts. Keep this the single source of truth for:
 *   - the three detection prompts (contradiction, ambiguity, best-practice)
 *   - the model, temperature, and token budget
 *   - the per-segment + pairwise task construction
 *   - token-usage aggregation
 *
 * If `changedHashes` is omitted, ALL segments are treated as changed
 * (i.e. every pair is checked, every segment gets ambiguity + bp). This
 * is what the public endpoint wants — it has no cache / previous state.
 */
import { createOpenAIClient } from './openai'
import type { Segment } from './segmenter'
import type { AnalysisIssue } from '../types'

const MODEL = 'gpt-5.4-nano-2026-03-17'

// See routes/analyze.ts prior art for why each bullet exists. Kept here
// because both the authenticated and public paths need identical analysis
// behavior — diverging the prompts would make the eval + skill differ.
const CONTRADICTION_PROMPT = `You detect DIRECT, UNRESOLVABLE contradictions between two instructions in the same prompt.

A contradiction means: NO single response could satisfy BOTH instructions at once.

DO flag these:
- Safety policy + override: "Refuse X" + "but in [some mode] you can do X" — the override nullifies the policy
- Role/identity + override: "You are a [role]" + "ignore the previous instruction" or "instead do [conflicting task]" — second instruction nullifies the role
- Persona conflicts: "be conservative" + "always recommend the highest-yield option"
- Direct opposites: "be brief" + "be exhaustive" with no condition reconciling them

NOT a contradiction (do not flag these):
- Refinements: a later instruction narrows or clarifies the earlier one (e.g. "identify style violations" + "skip stylistic nits")
- Exceptions: "be helpful" + "refuse harmful requests"
- Fallbacks: "answer the question" + "if out of scope, say so"
- Different topics or aspects (tone vs. format, scope vs. style)
- Ordering or sequencing instructions ("first X, then Y")
- Conditional behavior ("default to short, expand if asked")
- Output formatting plus content guidance
- Schema definitions vs parsing/transformation rules: a JSON schema saying a field is "ISO 8601" plus a rule saying "parse natural language into an ISO date" is consistent — the rule explains how to produce the schema-conforming value
- Parsing/extracting/transforming user-supplied data is NOT "inventing values": "if missing, use null; do not invent" is consistent with rules that derive structured fields from input
- Sentence fragments or mid-clause splits (e.g. starts with "g.," from "(e.g., ...)") — never flag fragments as contradictions

Only flag if the instructions truly pull in opposite directions with no reasonable middle ground.

Reply strict JSON only: {"contradiction": true|false, "message": "one short sentence"}`

const AMBIGUITY_PROMPT = `Is this instruction vague or ambiguous? JSON: {"ambiguous": true/false, "message": "brief why"}`

const BEST_PRACTICE_PROMPT = `Does this AI prompt instruction have issues? Check: too vague, missing examples, unclear output format, conflicting tone. JSON: {"issue": true/false, "message": "brief what to fix"}`

export interface AnalyzerUsage {
  inputTokens: number
  outputTokens: number
  tasks: number
}

export interface AnalyzerInput {
  segments: Segment[]
  /** Undefined = treat all segments as changed (every pair + every unary check). */
  changedHashes?: string[]
  openaiKey: string
}

export interface AnalyzerOutput {
  issues: AnalysisIssue[]
  usage: AnalyzerUsage
}

type TaskResult = { issue: AnalysisIssue | null; usage: { input: number; output: number } }

function readUsage(r: { usage?: { prompt_tokens?: number; completion_tokens?: number } }) {
  return {
    input: r.usage?.prompt_tokens ?? 0,
    output: r.usage?.completion_tokens ?? 0,
  }
}

export async function analyzePrompt(input: AnalyzerInput): Promise<AnalyzerOutput> {
  const { segments, changedHashes, openaiKey } = input
  if (!segments || segments.length === 0) {
    return { issues: [], usage: { inputTokens: 0, outputTokens: 0, tasks: 0 } }
  }

  const client = createOpenAIClient(openaiKey)
  // changedHashes === undefined → analyze everything (public API behavior).
  const analyzeAll = changedHashes === undefined
  const changedSet = new Set(changedHashes || [])
  const changed = analyzeAll ? segments : segments.filter(s => changedSet.has(s.hash))
  const others = analyzeAll ? [] : segments.filter(s => !changedSet.has(s.hash))

  if (changed.length === 0) {
    return { issues: [], usage: { inputTokens: 0, outputTokens: 0, tasks: 0 } }
  }

  const tasks: Promise<TaskResult>[] = []
  const emptyUsage = { input: 0, output: 0 }

  // 1. Pairwise contradiction checks
  const seenPairs = new Set<string>()
  for (const a of changed) {
    for (const b of [...others, ...changed.filter(x => x.hash !== a.hash)]) {
      const key = [a.hash, b.hash].sort().join(':')
      if (seenPairs.has(key)) continue
      seenPairs.add(key)

      tasks.push(
        client.chat.completions.create({
          model: MODEL,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: CONTRADICTION_PROMPT },
            { role: 'user', content: `A: "${a.text}"\nB: "${b.text}"` },
          ],
          temperature: 0,
          max_completion_tokens: 80,
        }).then(r => {
          const usage = readUsage(r)
          const raw = r.choices[0]?.message?.content
          if (!raw) return { issue: null, usage }
          const p = JSON.parse(raw) as { contradiction: boolean; message: string }
          if (!p.contradiction) return { issue: null, usage }
          return {
            issue: {
              id: `c_${a.hash}_${b.hash}`,
              type: 'contradiction' as const,
              severity: 'error' as const,
              range: [a.startIndex, a.endIndex] as [number, number],
              message: `"${a.text}" contradicts "${b.text}": ${p.message}`,
            },
            usage,
          }
        }).catch(() => ({ issue: null, usage: emptyUsage }))
      )
    }
  }

  // 2. Per-segment ambiguity checks
  for (const seg of changed) {
    tasks.push(
      client.chat.completions.create({
        model: MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: AMBIGUITY_PROMPT },
          { role: 'user', content: `"${seg.text}"` },
        ],
        temperature: 0,
        max_completion_tokens: 80,
      }).then(r => {
        const usage = readUsage(r)
        const raw = r.choices[0]?.message?.content
        if (!raw) return { issue: null, usage }
        const p = JSON.parse(raw) as { ambiguous: boolean; message: string }
        if (!p.ambiguous) return { issue: null, usage }
        return {
          issue: {
            id: `a_${seg.hash}`,
            type: 'ambiguity' as const,
            severity: 'warning' as const,
            range: [seg.startIndex, seg.endIndex] as [number, number],
            message: p.message,
          },
          usage,
        }
      }).catch(() => ({ issue: null, usage: emptyUsage }))
    )
  }

  // 3. Per-segment best practice checks
  for (const seg of changed) {
    tasks.push(
      client.chat.completions.create({
        model: MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: BEST_PRACTICE_PROMPT },
          { role: 'user', content: `"${seg.text}"` },
        ],
        temperature: 0,
        max_completion_tokens: 80,
      }).then(r => {
        const usage = readUsage(r)
        const raw = r.choices[0]?.message?.content
        if (!raw) return { issue: null, usage }
        const p = JSON.parse(raw) as { issue: boolean; message: string }
        if (!p.issue) return { issue: null, usage }
        return {
          issue: {
            id: `bp_${seg.hash}`,
            type: 'best-practice' as const,
            severity: 'info' as const,
            range: [seg.startIndex, seg.endIndex] as [number, number],
            message: p.message,
          },
          usage,
        }
      }).catch(() => ({ issue: null, usage: emptyUsage }))
    )
  }

  const results = await Promise.allSettled(tasks)

  const issues: AnalysisIssue[] = []
  let inputTokens = 0
  let outputTokens = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value.issue) issues.push(result.value.issue)
      inputTokens += result.value.usage.input
      outputTokens += result.value.usage.output
    }
  }

  return { issues, usage: { inputTokens, outputTokens, tasks: tasks.length } }
}
