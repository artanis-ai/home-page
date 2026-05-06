# mallet-worker

Cloudflare Worker that powers Mallet — analyzer, suggester, GitHub OAuth/PR
helpers, telemetry sink, and the public agent-skill API.

## Scripts

```bash
pnpm dev         # wrangler dev on :8787 (loads .dev.vars)
pnpm test        # vitest run (unit + integration; needs `pnpm dev` running)
pnpm typecheck   # tsc --noEmit
pnpm deploy      # wrangler deploy --env production
pnpm eval        # OpenAI eval suite (slow, $$ — uses vitest.config.eval.ts)
```

Copy `.dev.vars.example` → `.dev.vars` and fill in the secrets before
running `pnpm dev`.

## Routes

- `GET  /` — health check
- `POST /api/analyze` — incremental segment-level analysis (anon, IP-limited)
- `POST /api/suggest` — single-issue rewrite (anon, IP-limited)
- `POST /api/detect-prompts` — repo prompt-file detection (optional auth)
- `POST /api/public/analyze` — whole-prompt analysis for the
  `mallet-prompt-review` agent skill (anon, IP-limited)
- `POST /api/gravel/analyze` — Gravel control-plane proxy (shared-bearer
  authed, per-org rate limit; see below)
- `POST /api/create-pr` — create a PR with rewritten content (authed)
- `POST /api/generate-pr-description` — LLM-written PR body (authed)
- `GET  /api/github-token` — hand back the OAuth token from the session JWT
- `GET  /auth/github/*` — OAuth start + callback
- `GET  /t/*` — campaign-link first-touch attribution
- `POST /event` — SPA telemetry sink (anon, IP-limited)
- `GET  /signaling/:room` — y-webrtc signaling Durable Object

## Gravel-authenticated analysis

`POST /api/gravel/analyze` exists so Gravel's control plane (running on
Vercel, hence sharing a small IP pool) can proxy customer prompts to
Mallet without immediately exhausting the public endpoint's per-IP rate
limit. It is **not** a public endpoint — only Gravel's control plane
should ever call it.

### Request

```http
POST /api/gravel/analyze
Authorization: Bearer <GRAVEL_FORWARD_TOKEN>
Content-Type: application/json
X-Gravel-Org: <clerk-org-id>          # canonical org channel

{ "prompt": "<full prompt text>", "org_id": "<optional fallback>" }
```

The `X-Gravel-Org` header is the canonical per-org key; `body.org_id` is
accepted as a fallback when the header isn't set. If neither is present
the bucket falls back to `"unknown"` (intentionally easy to abuse — set
the header on the control-plane side).

### Response

Identical shape to `/api/public/analyze`:

```json
{ "issues": [...], "usage": { "inputTokens": N, "outputTokens": N, "tasks": N } }
```

- `400` — missing/invalid `prompt`, malformed JSON
- `401` — missing/wrong bearer (also returned if `GRAVEL_FORWARD_TOKEN`
  isn't configured on the worker — fail-closed)
- `413` — prompt over 20,000 chars
- `429` — per-org rate limit exceeded (`Retry-After` header set)

### Environment

| Var                    | Type   | Required | Default | Notes                                                                |
| ---------------------- | ------ | -------- | ------- | -------------------------------------------------------------------- |
| `GRAVEL_FORWARD_TOKEN` | secret | yes      | —       | Shared bearer. Generate with `openssl rand -hex 32`.                 |
| `GRAVEL_ANALYZE_RPM`   | var    | no       | `5`     | Per-org requests/minute. Coerced to int; invalid → default.          |

### Setting the secret

```bash
# Production
openssl rand -hex 32 | wrangler secret put GRAVEL_FORWARD_TOKEN --env production

# Local dev: add to .dev.vars
echo "GRAVEL_FORWARD_TOKEN=$(openssl rand -hex 32)" >> .dev.vars
```

The same value must be set as `MALLET_FORWARD_TOKEN` on Vercel for the
control plane to call this endpoint.

### Privacy

Same posture as `/api/public/analyze`: prompt text and issue messages
are **never** logged. The `gravel-analyze` Axiom span carries only
`orgId`, byte/token counts, segment count, issue count, and elapsed ms.
