/**
 * Stable key for an analysis issue, used for:
 *   - Dismissal persistence (Y.Map on the ydoc) so re-analysis doesn't re-flag
 *     issues the user already chose to ignore.
 *   - Client-side suggestion caching so clicking the same issue twice doesn't
 *     fire a fresh LLM call (and doesn't return a different suggestion).
 *
 * The key is derived from the offending text slice + issue type + message.
 * Editing the slice changes the key naturally, so dismissals don't outlive
 * the text they applied to. Messages are lightly normalized (lowercased,
 * whitespace-collapsed) to absorb harmless LLM rephrasing between runs.
 */
import type { AnalysisIssue } from '../types'

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function issueKey(slice: string, type: string, message: string): string {
  return `${normalize(slice)}|${type}|${normalize(message)}`
}

export function issueKeyFromContent(issue: AnalysisIssue, content: string): string {
  const slice = content.slice(issue.range[0], issue.range[1])
  return issueKey(slice, issue.type, issue.message)
}
