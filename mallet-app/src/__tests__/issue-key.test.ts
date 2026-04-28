import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { issueKey, issueKeyFromContent, filterDismissedIssues } from '../lib/issue-key'
import type { AnalysisIssue } from '../types'

const mkIssue = (range: [number, number], type: AnalysisIssue['type'], message: string, id = 'x'): AnalysisIssue => ({
  id,
  type,
  severity: 'warning',
  range,
  message,
})

describe('issueKey', () => {
  it('is stable for identical inputs', () => {
    expect(issueKey('Be brief.', 'contradiction', 'Conflicts with line 2'))
      .toBe(issueKey('Be brief.', 'contradiction', 'Conflicts with line 2'))
  })

  it('absorbs whitespace and case in the message (LLM rephrasing)', () => {
    expect(issueKey('Be brief.', 'contradiction', '  Conflicts with line 2 '))
      .toBe(issueKey('Be brief.', 'contradiction', 'CONFLICTS WITH LINE 2'))
    expect(issueKey('x', 'best-practice', 'a   b\tc'))
      .toBe(issueKey('x', 'best-practice', 'a b c'))
  })

  it('changes when the slice changes', () => {
    expect(issueKey('Be brief.', 'contradiction', 'm'))
      .not.toBe(issueKey('Be quick.', 'contradiction', 'm'))
  })

  it('changes when the issue type changes', () => {
    expect(issueKey('s', 'contradiction', 'm'))
      .not.toBe(issueKey('s', 'ambiguity', 'm'))
  })

  it('changes when the message changes meaningfully', () => {
    expect(issueKey('s', 'contradiction', 'first message'))
      .not.toBe(issueKey('s', 'contradiction', 'second message'))
  })
})

describe('issueKeyFromContent', () => {
  it('derives the slice from issue.range against the live doc', () => {
    const content = 'Be brief. Give long answers.'
    const issue = mkIssue([0, 9], 'contradiction', 'm')
    expect(issueKeyFromContent(issue, content)).toBe(issueKey('Be brief.', 'contradiction', 'm'))
  })

  it('reflects edits to the slice — same issue, different doc → different key', () => {
    const issue = mkIssue([0, 9], 'contradiction', 'm')
    const before = issueKeyFromContent(issue, 'Be brief. Etc.')
    const after = issueKeyFromContent(issue, 'Be quick. Etc.')
    expect(before).not.toBe(after)
  })
})

describe('filterDismissedIssues', () => {
  const issues = [
    mkIssue([0, 9], 'contradiction', 'm1', 'a'),
    mkIssue([10, 28], 'best-practice', 'm2', 'b'),
  ]
  const content = 'Be brief. Give long answers.'

  it('returns the input unchanged when nothing is dismissed', () => {
    const dismissed = new Set<string>()
    expect(filterDismissedIssues(issues, content, dismissed)).toEqual(issues)
  })

  it('drops issues whose key is in the dismissed set', () => {
    const dismissed = new Set<string>([issueKey('Be brief.', 'contradiction', 'm1')])
    const out = filterDismissedIssues(issues, content, dismissed)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('b')
  })

  it('drops the dismissal when the underlying slice changes', () => {
    // User dismissed an issue against "Be brief.", then edited the line.
    // The new content's slice produces a different key, so the issue resurfaces.
    const dismissed = new Set<string>([issueKey('Be brief.', 'contradiction', 'm1')])
    const edited = 'Be quick. Give long answers.'
    const out = filterDismissedIssues(issues, edited, dismissed)
    expect(out).toHaveLength(2)
  })

  it('works against a Y.Map (the production storage)', () => {
    // Real wiring uses ydoc.getMap('dismissed') so the dismissal syncs across
    // peers. filterDismissedIssues() only needs `has` + `size`, so Y.Map fits.
    const ydoc = new Y.Doc()
    const map = ydoc.getMap<true>('dismissed')
    map.set(issueKey('Be brief.', 'contradiction', 'm1'), true)

    const out = filterDismissedIssues(issues, content, map)
    expect(out.map(i => i.id)).toEqual(['b'])
    ydoc.destroy()
  })

  it('Y.Map dismissal propagates between connected docs (CRDT contract)', () => {
    // Two ydocs share the same dismissed set via a sync update — proves the
    // production shape (Y.Map on the per-room ydoc, replicated by y-webrtc)
    // doesn't require special wiring on the consumer side.
    const a = new Y.Doc()
    const b = new Y.Doc()
    const mapA = a.getMap<true>('dismissed')
    const mapB = b.getMap<true>('dismissed')

    mapA.set(issueKey('Be brief.', 'contradiction', 'm1'), true)
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))

    expect(mapB.size).toBe(1)
    expect(filterDismissedIssues(issues, content, mapB).map(i => i.id)).toEqual(['b'])

    a.destroy()
    b.destroy()
  })
})
