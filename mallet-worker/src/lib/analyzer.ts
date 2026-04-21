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

// Shared guard prepended to every analysis prompt. Mallet runs over raw file
// slices that routinely include scaffolding lines — variable declarations,
// triple-quote openers/closers, imports, JSON/YAML object literals, HTML
// tags — and the segmenter cannot tell these apart from instructions. The
// model must: NOT flag scaffolding-only segments as ambiguity / bad practice,
// and NOT pair scaffolding against prose when checking contradictions. The
// existing prose checks (refinements, exceptions, etc.) stay unchanged
// below — this guard fires first, independently of the original rubric.
const NON_PROSE_GUARD = `FIRST RULE — skip non-prose scaffolding:
If the WHOLE instruction is code, a JSON/YAML structural literal, a variable
declaration, or a lone delimiter — not natural-language prose directed at a
model — reply with the "no issue" variant (contradiction:false / ambiguous:false
/ issue:false) with an empty message. These lines are around the prompt, not
part of it.

Treat as non-prose (DO NOT flag):
- Variable declarations/assignments as the whole segment — e.g. \`FOO = ...\`,
  \`const x = ...\`, \`let y = ...\`, \`SYSTEM_PROMPT = """\`, \`prompt: str\`
- Lone string-literal delimiters — \`"""\`, \`'''\`, backticks on their own
- Function/class/import declarations — \`def foo(...):\`, \`class Bar:\`,
  \`function baz(...)\`, \`import X\`, \`from Y import Z\`, \`require(...)\`
- JSON/YAML structural syntax as the segment — \`{\`, \`}\`, \`[\`, \`]\`,
  \`{"x": "y"}\`, array literals
- HTML / XML tags — \`<tag>\`, \`</tag>\`, \`<tag attr="…"/>\`
- Control-flow keywords / statements — \`if (…)\`, \`for (…)\`, \`return x\`,
  \`break\`, \`continue\`
- Lone punctuation/operators — \`)\`, \`}\`, \`]\`, \`=>\`, \`->\`, \`:\`
- Code comments as the whole segment when they contain no full instruction

DO analyze natural-language prose that MENTIONS code or schema — the segment
is prose FOR A MODEL even if it refers to JSON, function names, variable
names, etc. ("Reply with JSON.", "Output format: {status, data}").`

// See routes/analyze.ts prior art for why each bullet exists. Kept here
// because both the authenticated and public paths need identical analysis
// behavior — diverging the prompts would make the eval + skill differ.
const CONTRADICTION_PROMPT = `You detect DIRECT, UNRESOLVABLE contradictions between two instructions in the same prompt.

${NON_PROSE_GUARD}

For contradictions specifically: if EITHER A or B is non-prose scaffolding per
the rule above, reply {"contradiction": false} — scaffolding cannot contradict
anything.

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

const AMBIGUITY_PROMPT = `You flag vague or ambiguous instructions in an AI prompt.

${NON_PROSE_GUARD}

If the segment IS prose, decide: is it vague or ambiguous?

JSON: {"ambiguous": true/false, "message": "brief why"}`

const BEST_PRACTICE_PROMPT = `You flag STRUCTURAL best-practice issues in an AI prompt instruction.

${NON_PROSE_GUARD}

A structural issue is a concrete defect the author can fix by adding
or changing a specific piece of the instruction:
- Missing output-format spec where one is clearly expected (e.g. a rule
  asking for "a list" or "a summary" without a format, schema, or length)
- Missing examples where the task is pattern-dependent (classification,
  extraction, transformation, style imitation)
- Missing role/persona framing for a task that needs it (expertise level,
  domain, audience)
- Tone/style hint directly conflicting with another in the same segment
  (e.g. "formal and casual")

DO NOT flag (these are handled elsewhere or are not defects):
- Vagueness or ambiguity in general — a separate ambiguity check owns this.
  If the ONLY issue is "too vague", "unclear", "could be clearer", skip it.
- Scope that could be narrower — not a structural defect
- Shortness / brevity — not a defect on its own
- Stylistic preference ("could be friendlier") — not structural

If the segment IS prose, decide: does it have a STRUCTURAL defect per the
bullets above (not general vagueness)?

JSON: {"issue": true/false, "message": "brief what to fix"}`

export interface AnalyzerUsage {
  inputTokens: number
  outputTokens: number
  tasks: number
}

/**
 * Explicit task to run. Lets the client batch the analysis across multiple
 * HTTP requests — we used to blow past Cloudflare's 1000-subrequest-per-
 * invocation limit when a user pasted a big prompt (N×N pairwise fan-out).
 * The client now generates the full task graph, prioritizes by proximity to
 * the cursor, chunks into batches, and sends each as its own /api/analyze
 * call with an explicit `tasks` list.
 */
export type AnalyzerTask =
  | { kind: 'pair'; a: string; b: string }
  | { kind: 'ambiguity'; h: string }
  | { kind: 'bp'; h: string }

export interface AnalyzerInput {
  segments: Segment[]
  /** Undefined = treat all segments as changed (every pair + every unary check). */
  changedHashes?: string[]
  /**
   * Explicit task list. When set, runs EXACTLY these tasks and ignores
   * `changedHashes`. Tasks whose hashes aren't in `segments` are silently
   * skipped (stale batch from a client that moved on).
   */
  tasks?: AnalyzerTask[]
  openaiKey: string
}

export interface AnalyzerOutput {
  issues: AnalysisIssue[]
  usage: AnalyzerUsage
}

type TaskResult = { issue: AnalysisIssue | null; usage: { input: number; output: number } }
type OpenAIClient = ReturnType<typeof createOpenAIClient>

const EMPTY_USAGE = { input: 0, output: 0 }

function readUsage(r: { usage?: { prompt_tokens?: number; completion_tokens?: number } }) {
  return {
    input: r.usage?.prompt_tokens ?? 0,
    output: r.usage?.completion_tokens ?? 0,
  }
}

function runContradictionTask(client: OpenAIClient, a: Segment, b: Segment): Promise<TaskResult> {
  return client.chat.completions.create({
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
  }).catch(() => ({ issue: null, usage: EMPTY_USAGE }))
}

function runAmbiguityTask(client: OpenAIClient, seg: Segment): Promise<TaskResult> {
  return client.chat.completions.create({
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
  }).catch(() => ({ issue: null, usage: EMPTY_USAGE }))
}

function runBPTask(client: OpenAIClient, seg: Segment): Promise<TaskResult> {
  return client.chat.completions.create({
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
  }).catch(() => ({ issue: null, usage: EMPTY_USAGE }))
}

/**
 * Enumerate the full task graph for a `changedHashes`-style input. Shared
 * between the legacy in-server path and the client-side task planner (via
 * `planTasks`) so the two can never diverge on which pairs exist.
 */
function enumerateTasks(segments: Segment[], changedHashes: string[] | undefined): AnalyzerTask[] {
  const analyzeAll = changedHashes === undefined
  const changedSet = new Set(changedHashes || [])
  const changed = analyzeAll ? segments : segments.filter(s => changedSet.has(s.hash))
  const others = analyzeAll ? [] : segments.filter(s => !changedSet.has(s.hash))
  if (changed.length === 0) return []

  const out: AnalyzerTask[] = []
  const seenPairs = new Set<string>()
  for (const a of changed) {
    for (const b of [...others, ...changed.filter(x => x.hash !== a.hash)]) {
      const key = [a.hash, b.hash].sort().join(':')
      if (seenPairs.has(key)) continue
      seenPairs.add(key)
      out.push({ kind: 'pair', a: a.hash, b: b.hash })
    }
  }
  for (const seg of changed) out.push({ kind: 'ambiguity', h: seg.hash })
  for (const seg of changed) out.push({ kind: 'bp', h: seg.hash })
  return out
}

/**
 * Exported so the client can plan batches with identical task semantics.
 * The response contract is that the returned tasks, run on the same
 * `segments`, produce the same issue set as `analyzePrompt` would have
 * returned in a single call.
 */
export function planTasks(segments: Segment[], changedHashes: string[] | undefined): AnalyzerTask[] {
  return enumerateTasks(segments, changedHashes)
}

export async function analyzePrompt(input: AnalyzerInput): Promise<AnalyzerOutput> {
  const { segments, changedHashes, openaiKey } = input
  if (!segments || segments.length === 0) {
    return { issues: [], usage: { inputTokens: 0, outputTokens: 0, tasks: 0 } }
  }

  const client = createOpenAIClient(openaiKey)
  const segByHash = new Map(segments.map(s => [s.hash, s]))
  const plannedTasks = input.tasks ?? enumerateTasks(segments, changedHashes)

  const taskPromises: Promise<TaskResult>[] = []
  for (const t of plannedTasks) {
    if (t.kind === 'pair') {
      const a = segByHash.get(t.a)
      const b = segByHash.get(t.b)
      if (a && b) taskPromises.push(runContradictionTask(client, a, b))
    } else if (t.kind === 'ambiguity') {
      const s = segByHash.get(t.h)
      if (s) taskPromises.push(runAmbiguityTask(client, s))
    } else if (t.kind === 'bp') {
      const s = segByHash.get(t.h)
      if (s) taskPromises.push(runBPTask(client, s))
    }
  }

  const results = await Promise.allSettled(taskPromises)

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

  return { issues, usage: { inputTokens, outputTokens, tasks: taskPromises.length } }
}
