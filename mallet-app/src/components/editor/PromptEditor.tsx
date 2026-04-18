import { useEffect, useRef } from 'react'
import { EditorView, keymap, Decoration, type DecorationSet, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { EditorState, StateField, StateEffect, type Extension, RangeSetBuilder } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { defaultKeymap } from '@codemirror/commands'
import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'
import { yCollab } from 'y-codemirror.next'
import { segmentPrompt, hashSegment } from '../../lib/segmenter'
import { WORKER_URL, authedFetch } from '../../lib/api'
import { loadRoom, saveRoom, groupIssuesBySegment, rehydrateIssues } from '../../lib/segment-cache'
import type { AnalysisIssue } from '../../types'

// --- CodeMirror decoration setup ---

const issueDecorationEffect = StateEffect.define<DecorationSet>()

const issueDecorationField = StateField.define<DecorationSet>({
  create() { return Decoration.none },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(issueDecorationEffect)) return e.value
    }
    return tr.docChanged ? decos.map(tr.changes) : decos
  },
  provide: (f) => EditorView.decorations.from(f),
})

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', fontFamily: "'DM Sans', sans-serif" },
  '.cm-content': { padding: '24px', maxWidth: '800px', lineHeight: '1.8', caretColor: '#9B4340' },
  '.cm-focused': { outline: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(245, 237, 227, 0.5)' },
  '.cm-selectionBackground': { backgroundColor: 'rgba(155, 67, 64, 0.15) !important' },
  '.cm-issue-contradiction': { textDecoration: 'wavy underline #9B4340', textDecorationSkipInk: 'none', backgroundColor: 'rgba(155, 67, 64, 0.06)' },
  '.cm-issue-ambiguity': { textDecoration: 'dashed underline #D4A76A', textDecorationSkipInk: 'none', backgroundColor: 'rgba(212, 167, 106, 0.06)' },
  '.cm-issue-best-practice': { textDecoration: 'dotted underline #6B4226', textDecorationSkipInk: 'none', backgroundColor: 'rgba(107, 66, 38, 0.06)' },
  '.cm-ySelectionInfo': { fontFamily: "'DM Sans', sans-serif", fontSize: '11px', padding: '1px 4px', borderRadius: '3px 3px 3px 0', fontWeight: '600' },
  '.cm-template-var': { opacity: '0.55' },
})

// Dynamic template variable highlighting — runs client-side, no LLM
const templateVarPattern = /\{\{.+?\}\}|\$\{.+?\}|\{[a-zA-Z_]\w*\}|<%.+?%>|\[\[.+?\]\]/g

const templateVarHighlighter = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view)
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view)
    }
  }
  buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>()
    const doc = view.state.doc.toString()
    let match: RegExpExecArray | null
    templateVarPattern.lastIndex = 0
    while ((match = templateVarPattern.exec(doc)) !== null) {
      builder.add(match.index, match.index + match[0].length, Decoration.mark({ class: 'cm-template-var' }))
    }
    return builder.finish()
  }
}, { decorations: v => v.decorations })

const issueClassMap: Record<string, string> = {
  contradiction: 'cm-issue-contradiction',
  ambiguity: 'cm-issue-ambiguity',
  'best-practice': 'cm-issue-best-practice',
}

const COLORS = [
  { color: '#9B4340', light: '#9B434033' },
  { color: '#4A7C59', light: '#4A7C5933' },
  { color: '#D4A76A', light: '#D4A76A33' },
  { color: '#6B4226', light: '#6B422633' },
]

// --- Helper: check if this client is the analysis leader ---

function isLeader(awareness: WebrtcProvider['awareness'], clientID: number): boolean {
  const states = awareness.getStates()
  const clientIds = Array.from(states.keys())
  return clientIds.length === 0 || Math.min(...clientIds) === clientID
}

// --- Component ---

export interface PromptEditorHandle {
  getText: () => string
}

export interface Peer {
  name: string
  color: string
  imageUrl?: string
}

interface PromptEditorProps {
  initialContent: string
  onChange: (content: string) => void
  onIssuesChange: (issues: AnalysisIssue[]) => void
  onPeersChange: (peers: Peer[]) => void
  onAnalyzingChange: (analyzing: boolean) => void
  roomId: string | null
  userName?: string
  userImageUrl?: string
  activeIssueId: string | null
  onActiveIssueChange: (id: string | null) => void
  onReplaceText: React.MutableRefObject<((from: number, to: number, text: string) => void) | null>
  /** Returns a fresh Clerk session JWT for HTTP API calls (analyze/suggest only). */
  getToken: () => Promise<string | null>
}

export function PromptEditor({ initialContent, onChange, onIssuesChange, onPeersChange, onAnalyzingChange, roomId, userName, userImageUrl, onActiveIssueChange, onReplaceText, getToken }: PromptEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onIssuesChangeRef = useRef(onIssuesChange)
  const onPeersChangeRef = useRef(onPeersChange)
  const onAnalyzingChangeRef = useRef(onAnalyzingChange)
  const onActiveIssueChangeRef = useRef(onActiveIssueChange)
  const currentIssuesRef = useRef<AnalysisIssue[]>([])
  onChangeRef.current = onChange
  onIssuesChangeRef.current = onIssuesChange
  onPeersChangeRef.current = onPeersChange
  onAnalyzingChangeRef.current = onAnalyzingChange
  onActiveIssueChangeRef.current = onActiveIssueChange


  useEffect(() => {
    if (!containerRef.current) return

    // --- Create Y.Doc with text ---
    const ydoc = new Y.Doc()
    const ytext = ydoc.getText('prompt')
    const undoManager = new Y.UndoManager(ytext)

    // --- Set up WebRTC provider ---
    let provider: WebrtcProvider | null = null

    if (roomId) {
      // Signaling is unauthenticated (see mallet-worker/src/signaling.ts for
      // rationale). Anonymous / incognito users collaborate on the same
      // /d/<uuid> or /gh/... URL as signed-in users — no token needed.
      const workerUrl = import.meta.env.VITE_WORKER_URL || 'https://mallet-api.artanis-ai.workers.dev'
      const signalingUrl =
        workerUrl.replace(/^http/, 'ws') +
        '/signaling/' +
        encodeURIComponent(`mallet-${roomId}`)

      provider = new WebrtcProvider(`mallet-${roomId}`, ydoc, {
        signaling: [signalingUrl],
        filterBcConns: false,
      })

      const userColor = COLORS[Math.floor(Math.random() * COLORS.length)]
      provider.awareness.setLocalStateField('user', {
        name: userName || 'Anonymous ' + Math.floor(Math.random() * 100),
        color: userColor.color,
        colorLight: userColor.light,
        imageUrl: userImageUrl || null,
      })

      const updatePeers = () => {
        const states = provider!.awareness.getStates()
        const peerList: Peer[] = []
        states.forEach((state, clientId) => {
          if (clientId !== ydoc.clientID && state.user) {
            peerList.push({ name: state.user.name, color: state.user.color, imageUrl: state.user.imageUrl || undefined })
          }
        })
        onPeersChangeRef.current?.(peerList)
      }
      provider.awareness.on('change', updatePeers)
    }

    // --- Create CodeMirror ---
    // Initialize with ytext.toString() (empty at this point — seed is deferred
    // below). When the seed (or any peer sync) inserts into ytext, yCollab's
    // observer forwards the change to CM. We do NOT seed synchronously because:
    //
    //   - React 18 StrictMode double-invokes effects, creating provider1 →
    //     destroying it → creating provider2. The y-webrtc BroadcastChannel
    //     publishes sync step 1 / state messages synchronously to local subs,
    //     and `_bcSubscriber` decrypts asynchronously (via Promise chains),
    //     so in-flight messages from mount1 can land back after mount2 has
    //     subscribed — with two distinct ydocs both seeded with `initialContent`,
    //     CRDT merge preserves BOTH inserts → visible content doubles.
    //   - The same hazard exists across browser tabs: if another tab on the
    //     same URL already seeded the room, our sync would pull their state;
    //     seeding concurrently before sync completes doubles the content.
    //
    // Deferring the seed to a macrotask (setTimeout 0) lets pending BC/WebRTC
    // sync messages deliver first. We re-check `ytext.length === 0` inside the
    // callback: if a peer (or ourselves from a previous mount) already supplied
    // state, we skip the seed.
    const extensions: Extension[] = [
      keymap.of(defaultKeymap),
      markdown(),
      editorTheme,
      issueDecorationField,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString())
        }
        // Track cursor position → highlight matching issue
        if (update.selectionSet || update.docChanged) {
          const pos = update.state.selection.main.head
          const issues = currentIssuesRef.current
          const match = issues.find(i => pos >= i.range[0] && pos <= i.range[1])
          onActiveIssueChangeRef.current(match?.id || null)
        }
      }),
      EditorView.lineWrapping,
      templateVarHighlighter,
      yCollab(ytext, provider?.awareness || undefined, { undoManager }),
    ]

    const view = new EditorView({
      // ytext is empty here — seed is deferred. When the seed (or a peer sync)
      // inserts into ytext, yCollab will forward the change to CM.
      state: EditorState.create({ doc: ytext.toString(), extensions }),
      parent: containerRef.current,
    })
    viewRef.current = view

    // Expose text replacement for accepting suggestions
    if (onReplaceText) onReplaceText.current = (from: number, to: number, text: string) => {
      view.dispatch({ changes: { from, to, insert: text } })
    }

    // Deferred seed — see the big comment above the `extensions` declaration.
    // setTimeout(…, 0) schedules a macrotask, which runs after all pending
    // microtasks (including y-webrtc's async room-init / destroy-room chains
    // triggered by `this.key.then(…)`) have settled. Re-checking
    // `ytext.length === 0` at seed time is what actually prevents doubling:
    // if any peer (or our own previous StrictMode mount leaking through BC)
    // already supplied state, ytext is non-empty and we skip our insert.
    const seedTimer = setTimeout(() => {
      if (initialContent && ytext.length === 0) {
        ytext.insert(0, initialContent)
      }
    }, 0)

    // --- Issue decorations: apply directly from AnalysisIssue[] ---
    function applyIssueDecorations(issues: AnalysisIssue[]) {
      if (!viewRef.current) return
      const docText = viewRef.current.state.doc.toString()
      currentIssuesRef.current = issues
      // Defer React state updates to next microtask to avoid re-entrancy
      setTimeout(() => {
        onChangeRef.current(docText)
        onIssuesChangeRef.current(issues)
      }, 0)

      // Apply decorations in next animation frame
      requestAnimationFrame(() => {
        if (!viewRef.current) return
        try {
          const currentLen = viewRef.current.state.doc.length
          const decorations: { from: number; to: number; decoration: Decoration }[] = []
          for (const issue of issues) {
            const from = issue.range[0]
            const to = Math.min(issue.range[1], currentLen)
            if (from < 0 || to <= from || from >= currentLen) continue
            const className = issueClassMap[issue.type] || 'cm-issue-best-practice'
            decorations.push({ from, to, decoration: Decoration.mark({ class: className }) })
          }
          decorations.sort((a, b) => a.from - b.from || a.to - b.to)
          viewRef.current.dispatch({
            effects: issueDecorationEffect.of(
              decorations.length > 0
                ? Decoration.set(decorations.map(d => d.decoration.range(d.from, d.to)))
                : Decoration.none
            ),
          })
        } catch (err) {
          console.error('[Mallet] Decoration error:', err)
        }
      })
    }

    // --- Incremental analysis (leader only) ---
    // Hydrate the per-room cache so reloads / remounts don't re-analyze
    // every segment from scratch. See lib/segment-cache.ts for shape.
    const cached = roomId ? loadRoom(roomId) : null
    let prevSegmentHashes = new Set<string>(cached?.hashes ?? [])
    let cachedIssuesByHash = cached?.issuesByHash ?? {}
    let currentIssues: AnalysisIssue[] = [] // persistent across runs
    let analyzeTimer: ReturnType<typeof setTimeout> | null = null
    let analyzing = false

    // Restore decorations from cache as soon as ytext has content. Avoids
    // a brief "no issues" flash before analysis re-runs. Because the seed is
    // deferred (see above), ytext is empty at this point — wrap the rehydration
    // in a function and run it either immediately (if peer sync somehow
    // beat us here) or once the first content arrives via observer.
    const runCacheRehydration = () => {
      if (!cached) return
      const text = ytext.toString()
      if (!text.trim()) return
      const segs = segmentPrompt(text).map((s) => ({
        hash: hashSegment(s.text),
        startIndex: s.startOffset,
        endIndex: s.endOffset,
      }))
      currentIssues = rehydrateIssues(cachedIssuesByHash, segs)
      if (currentIssues.length > 0) applyIssueDecorations(currentIssues)
    }
    if (ytext.toString().trim()) {
      runCacheRehydration()
    } else {
      // One-shot: the first time ytext has content, rehydrate and detach.
      const onFirstContent = () => {
        if (ytext.toString().trim()) {
          ytext.unobserve(onFirstContent)
          runCacheRehydration()
        }
      }
      ytext.observe(onFirstContent)
    }

    async function runIncrementalAnalysis() {
      if (analyzing) return
      const docText = ytext.toString()

      // Empty doc → wipe any stale issues/decorations/cache. Otherwise the
      // side panel and underlines linger after the user deletes everything.
      if (!docText.trim()) {
        if (currentIssues.length > 0 || prevSegmentHashes.size > 0) {
          currentIssues = []
          applyIssueDecorations(currentIssues)
          prevSegmentHashes = new Set()
          cachedIssuesByHash = {}
          if (roomId) saveRoom(roomId, {
            hashes: [],
            issuesByHash: {},
            updatedAt: Date.now(),
          })
        }
        return
      }

      // Only leader runs analysis
      if (provider?.awareness && !isLeader(provider.awareness, ydoc.clientID)) return

      // Segment and hash
      const segments = segmentPrompt(docText)
      const newHashes = new Set<string>()
      const changedHashes: string[] = []

      const apiSegments = segments.map(seg => {
        const hash = hashSegment(seg.text)
        newHashes.add(hash)
        if (!prevSegmentHashes.has(hash)) {
          changedHashes.push(hash)
        }
        return { text: seg.text, startIndex: seg.startOffset, endIndex: seg.endOffset, hash }
      })

      if (changedHashes.length === 0) {
        // Drop issues whose ranges are now out of bounds
        const before = currentIssues.length
        currentIssues = currentIssues.filter(i => i.range[1] <= docText.length)
        if (currentIssues.length !== before) applyIssueDecorations(currentIssues)
        prevSegmentHashes = newHashes
        // Persist the (now-current) hash set even when nothing changed —
        // protects against losing cache state on a fresh load that produces
        // no new analysis work.
        if (roomId) saveRoom(roomId, {
          hashes: Array.from(newHashes),
          issuesByHash: cachedIssuesByHash,
          updatedAt: Date.now(),
        })
        return
      }

      analyzing = true
      onAnalyzingChangeRef.current(true)
      try {
        const res = await authedFetch(getToken, `${WORKER_URL}/api/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ segments: apiSegments, changedHashes }),
        })

        if (!res.ok) { analyzing = false; return }
        const data = await res.json()

        // New issues from the API (for changed segments only)
        const newIssues: AnalysisIssue[] = (data.issues || []).filter(
          (issue: AnalysisIssue) =>
            Array.isArray(issue.range) &&
            typeof issue.range[0] === 'number' &&
            typeof issue.range[1] === 'number' &&
            issue.range[0] < issue.range[1] &&
            issue.range[0] >= 0 &&
            issue.range[1] <= docText.length
        )

        // Remove old issues that overlap with any changed segment's range
        const changedRanges = apiSegments
          .filter(s => changedHashes.includes(s.hash))
          .map(s => [s.startIndex, s.endIndex] as [number, number])

        currentIssues = currentIssues.filter(issue => {
          // Drop if the issue overlaps any changed segment
          for (const [start, end] of changedRanges) {
            if (issue.range[0] < end && issue.range[1] > start) return false
          }
          // Drop if the issue's range is now out of bounds
          if (issue.range[1] > docText.length) return false
          return true
        })

        // Add new issues
        currentIssues = [...currentIssues, ...newIssues]

        applyIssueDecorations(currentIssues)

        prevSegmentHashes = newHashes

        // Persist the updated cache so a reload skips re-analysis.
        // We rebuild issuesByHash from the full currentIssues so it always
        // matches what's on screen (no stale entries from removed segments).
        cachedIssuesByHash = groupIssuesBySegment(currentIssues, apiSegments)
        if (roomId) saveRoom(roomId, {
          hashes: Array.from(newHashes),
          issuesByHash: cachedIssuesByHash,
          updatedAt: Date.now(),
        })
      } catch (err) {
        console.error('[Mallet] Analysis error:', err)
      } finally {
        analyzing = false
        onAnalyzingChangeRef.current(false)
      }
    }

    // Debounced trigger on ytext changes. Fires for BOTH our deferred seed
    // and any peer-sync updates, so an explicit initial-analysis kickoff is
    // unnecessary — whichever delivers content first will schedule analysis.
    ytext.observe(() => {
      if (analyzeTimer) clearTimeout(analyzeTimer)
      analyzeTimer = setTimeout(runIncrementalAnalysis, 800)
    })

    // --- Cleanup ---
    return () => {
      clearTimeout(seedTimer)
      if (analyzeTimer) clearTimeout(analyzeTimer)
      view.destroy()
      viewRef.current = null
      provider?.destroy()
      ydoc.destroy()
    }
  }, [roomId])


  return (
    <div
      ref={containerRef}
      className="h-full cursor-text"
      onClick={() => viewRef.current?.focus()}
    />
  )
}
