export interface Env {
  OPENAI_API_KEY: string
  CLERK_SECRET_KEY: string
  CLERK_ISSUER_URL: string
  ENVIRONMENT: string
  LOGS: KVNamespace
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
