export interface Env {
  OPENAI_API_KEY: string
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  SESSION_SECRET: string
  ENVIRONMENT: string
  // Axiom OTel ingest. Token is set via `wrangler secret put AXIOM_TOKEN`;
  // dataset + traces URL are vars. When AXIOM_TOKEN is unset (local dev,
  // tests) the OTel exporter still runs but its POSTs fail silently — we
  // don't want missing telemetry to take down the worker.
  AXIOM_TOKEN: string
  AXIOM_DATASET: string
  AXIOM_TRACES_URL: string
  // Shared bearer for Gravel control-plane → Mallet proxying. Set via
  // `wrangler secret put GRAVEL_FORWARD_TOKEN`. When unset the
  // /api/gravel/analyze route fails closed (every request → 401).
  GRAVEL_FORWARD_TOKEN: string
  // Optional override (string at runtime) for the per-org rate limit on
  // /api/gravel/analyze. Defaults to 5 requests/minute when unset/invalid.
  GRAVEL_ANALYZE_RPM?: string
  INVITES: KVNamespace
  SIGNALING_ROOM: DurableObjectNamespace
}

export interface AnalysisRequest {
  promptText: string
  model?: string
}

export interface SuggestRequest {
  segmentText: string
  issueType: string
  fullPrompt: string
  message: string
}

export interface DetectPromptsRequest {
  repoOwner: string
  repoName: string
}

export interface CreatePRRequest {
  repoOwner: string
  repoName: string
  filePath: string
  content: string
  commitMessage: string
  description?: string
}

export interface GeneratePRDescriptionRequest {
  repoOwner: string
  repoName: string
  filePath: string
  content: string
}

export interface AnalysisIssue {
  id: string
  type: 'contradiction' | 'ambiguity' | 'best-practice'
  severity: 'error' | 'warning' | 'info'
  range: [number, number]
  message: string
}

export interface Suggestion {
  original: string
  suggested: string
  explanation: string
}
