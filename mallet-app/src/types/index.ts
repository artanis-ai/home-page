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

export interface PromptSegment {
  id: string
  text: string
  startOffset: number
  endOffset: number
  type: 'static' | 'dynamic'
}

export interface SyncedIssue {
  id: string
  type: 'contradiction' | 'ambiguity' | 'best-practice'
  severity: 'error' | 'warning' | 'info'
  segmentHash: string
  segmentText: string
  relativeFrom: number
  relativeTo: number
  message: string
}

export interface DetectedPrompt {
  path: string
  confidence: number
  snippet: string
}
