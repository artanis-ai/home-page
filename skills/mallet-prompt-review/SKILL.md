---
name: mallet-prompt-review
description: Review an LLM prompt for contradictions, ambiguities, and best-practice violations via Mallet's public analysis API. Use this skill whenever the user asks you to sanity-check, audit, lint, or improve a prompt they intend to feed to another model, or when you are about to write a new system prompt and want a second opinion before shipping it.
---

# Mallet Prompt Review

A thin wrapper over Mallet's public prompt-analysis API. Given a full prompt string, the API returns:

- **Contradictions** — pairs of instructions that cannot both be satisfied.
- **Ambiguities** — vague or under-specified instructions.
- **Best-practice issues** — missing examples, unclear output format, weak tone guidance, etc.

Use it to flag issues before you or the user ship a prompt to another LLM.

## When to use this skill

Trigger this skill when:

- The user pastes a prompt and asks "is this any good?" / "audit this" / "review this" / "lint this".
- You are drafting a system prompt or agent instruction and want to verify it has no internal conflicts before committing.
- You notice the user's prompt has obvious issues (e.g. conflicting tone instructions) and want to quantify them.

Do **not** use this skill for:
- General writing review (use normal review — this API only looks at LLM-prompt-shaped text).
- Prompts that contain secrets you don't want sent over the wire (see Privacy below).

## API

**Endpoint:** `POST https://mallet-api.artanis-ai.workers.dev/api/public/analyze`

**No authentication required.** Rate-limited per IP.

### Request

```json
{ "prompt": "You are a helpful assistant. Always be brief. Give long detailed answers." }
```

- `prompt` — string, required. The full prompt to analyze. Maximum 20,000 characters.

### Response (200 OK)

```json
{
  "issues": [
    {
      "id": "c_xyz_abc",
      "type": "contradiction",
      "severity": "error",
      "range": [32, 49],
      "message": "\"Always be brief\" contradicts \"Give long detailed answers\": ..."
    }
  ],
  "usage": { "inputTokens": 1234, "outputTokens": 42, "tasks": 6 }
}
```

- `issues[].type` — one of `contradiction`, `ambiguity`, `best-practice`.
- `issues[].severity` — `error`, `warning`, or `info`.
- `issues[].range` — `[startIndex, endIndex]` character offsets into the original prompt string.
- `issues[].message` — one-sentence human explanation.
- `usage` — telemetry echo (safe to ignore for reporting).

### Errors

- `400` — missing/invalid `prompt` field, or malformed JSON body.
- `413` — prompt longer than 20,000 characters. Response body includes `limit` and `received`.
- `429` — rate limit exceeded. Response body includes `retryAfterSec`; honor the `Retry-After` header.

## How to invoke

From a shell:

```bash
curl -s -X POST https://mallet-api.artanis-ai.workers.dev/api/public/analyze \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "You are a helpful assistant. Be brief. Give long answers."}'
```

From Node / TypeScript:

```ts
const res = await fetch('https://mallet-api.artanis-ai.workers.dev/api/public/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt }),
})
if (!res.ok) throw new Error(`mallet analyze ${res.status}: ${await res.text()}`)
const { issues } = await res.json()
```

## Presenting results to the user

1. If `issues` is empty, tell the user the prompt looks clean.
2. Otherwise, group issues by `type` (contradictions first — they are the highest-signal), and for each, quote the offending slice of the prompt using `prompt.slice(range[0], range[1])` alongside the `message`.
3. When asked to "fix" the prompt, propose concrete edits that resolve the flagged issues; do not silently rewrite.

## Privacy

Prompts are **not stored**. The Mallet API analyzes the prompt in-memory and discards it after responding. Server logs record request size, token counts, and timings only — never the prompt text or the issue messages. Even so, treat the API as a third-party service: do not send prompts containing secrets, PII you aren't authorized to share, or anything covered by an NDA.
