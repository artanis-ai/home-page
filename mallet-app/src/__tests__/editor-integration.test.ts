/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import * as Y from 'yjs'
import { yCollab } from 'y-codemirror.next'

function createEditor(opts: { initialYtext?: string; onChange?: (text: string) => void } = {}) {
  const ydoc = new Y.Doc()
  const ytext = ydoc.getText('test')
  if (opts.initialYtext) ytext.insert(0, opts.initialYtext)
  const undoManager = new Y.UndoManager(ytext)
  const onChange = opts.onChange || vi.fn()

  const extensions = [
    markdown(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange(update.state.doc.toString())
      }
    }),
    yCollab(ytext, undefined, { undoManager }),
  ]

  const container = document.createElement('div')
  document.body.appendChild(container)
  const view = new EditorView({
    state: EditorState.create({ extensions }),
    parent: container,
  })

  // Apply the same workaround as PromptEditor: sync pre-existing ytext → CM
  const ytextStr = ytext.toString()
  const cmStr = view.state.doc.toString()
  if (ytextStr && ytextStr !== cmStr) {
    view.dispatch({ changes: { from: 0, to: cmStr.length, insert: ytextStr } })
  }

  return { ydoc, ytext, view, onChange: onChange as ReturnType<typeof vi.fn>, container }
}

function cleanup(ctx: ReturnType<typeof createEditor>) {
  ctx.view.destroy()
  ctx.ydoc.destroy()
  document.body.removeChild(ctx.container)
}

describe('CodeMirror + Yjs integration', () => {
  it('onChange fires when text is dispatched to CM', () => {
    const ctx = createEditor()
    ctx.view.dispatch({ changes: { from: 0, to: 0, insert: 'hello' } })
    expect(ctx.onChange).toHaveBeenCalledWith('hello')
    expect(ctx.view.state.doc.toString()).toBe('hello')
    expect(ctx.ytext.toString()).toBe('hello')
    cleanup(ctx)
  })

  it('onChange fires when ytext is modified externally', () => {
    const ctx = createEditor()
    ctx.ytext.insert(0, 'from peer')
    expect(ctx.onChange).toHaveBeenCalledWith('from peer')
    expect(ctx.view.state.doc.toString()).toBe('from peer')
    cleanup(ctx)
  })

  it('pre-existing ytext content syncs to CM after manual dispatch', () => {
    const ctx = createEditor({ initialYtext: 'pre-existing' })
    expect(ctx.view.state.doc.toString()).toBe('pre-existing')
    cleanup(ctx)
  })

  it('empty initial ytext + typing produces correct content', () => {
    const onChange = vi.fn()
    const ctx = createEditor({ onChange })

    // Simulate typing
    ctx.view.dispatch({ changes: { from: 0, to: 0, insert: 'Be brief. Give long answers.' } })

    expect(onChange).toHaveBeenCalled()
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(lastCall).toBe('Be brief. Give long answers.')

    // Can slice the text for suggestions
    const range = [0, 9] as [number, number]
    const sliced = lastCall.slice(range[0], range[1])
    expect(sliced).toBe('Be brief.')

    cleanup(ctx)
  })

  it('full pipeline: type → get content → slice issue range → verify', () => {
    const onChange = vi.fn()
    const ctx = createEditor({ onChange })

    const prompt = 'Be brief. Give long detailed answers.'
    ctx.view.dispatch({ changes: { from: 0, to: 0, insert: prompt } })

    // Get the latest content from onChange
    const content = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(content).toBe(prompt)

    // Simulate API returning issue with range [0, 9]
    const issueRange = [0, 9] as [number, number]
    const segText = content.slice(issueRange[0], issueRange[1])
    expect(segText).toBe('Be brief.')
    expect(segText.length).toBeGreaterThan(0)

    // Simulate API returning issue with range [10, 37]
    const issueRange2 = [10, 37] as [number, number]
    const segText2 = content.slice(issueRange2[0], issueRange2[1])
    expect(segText2).toBe('Give long detailed answers.')
    expect(segText2.length).toBeGreaterThan(0)

    cleanup(ctx)
  })

  it('yCollab bug: pre-existing content NOT synced without workaround', () => {
    // This test documents the bug in y-codemirror.next
    const ydoc = new Y.Doc()
    const ytext = ydoc.getText('test')
    ytext.insert(0, 'content')
    const undoManager = new Y.UndoManager(ytext)

    const container = document.createElement('div')
    document.body.appendChild(container)
    const view = new EditorView({
      state: EditorState.create({
        extensions: [yCollab(ytext, undefined, { undoManager })],
      }),
      parent: container,
    })

    // BUG: CM doc is empty even though ytext has content
    expect(view.state.doc.toString()).toBe('')
    expect(ytext.toString()).toBe('content')

    view.destroy()
    ydoc.destroy()
    document.body.removeChild(container)
  })
})
