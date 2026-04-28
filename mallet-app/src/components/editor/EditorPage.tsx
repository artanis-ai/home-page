import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { useSession } from '../../hooks/useSession'
import { track } from '../../lib/track'
import { UserMenu } from '../shared/UserMenu'
import { useGitHubToken } from '../../hooks/useGitHubToken'
import { PromptEditor, type Peer } from './PromptEditor'
import { AnalysisPanel } from './AnalysisPanel'
import { PRCreator } from '../repo/PRCreator'
import { Share2, GitPullRequest, Check, PanelRightOpen, PanelRightClose, Heart } from 'lucide-react'
import type { AnalysisIssue } from '../../types'
import {
  parseLineRangeHash,
  splitByLineRange,
  reassemble,
  formatLineRangeHash,
  type SplitContent,
} from '../../lib/line-range'

export function EditorPage() {
  const { owner, repo, branch, '*': filePath, docId } = useParams()
  const location = useLocation()
  const { isSignedIn, user, getToken } = useSession()
  const getGitHubToken = useGitHubToken()

  // `content` is always what the editor sees.
  // When the URL fragment has #L1-L8, `content` holds ONLY that slice and
  // `split` holds the frozen before/after chunks. Line additions/deletions
  // inside the slice don't shift the anchors — we never re-derive them.
  // When there's no fragment, `split` is null and `content` is the full file.
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [split, setSplit] = useState<SplitContent | null>(null)
  const [issues, setIssues] = useState<AnalysisIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [showPR, setShowPR] = useState(false)
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [peers, setPeers] = useState<Peer[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState(false)
  const replaceTextRef = useRef<((from: number, to: number, text: string) => void) | null>(null)
  const dismissIssueRef = useRef<((issue: AnalysisIssue) => void) | null>(null)
  // Default to hidden on mobile (panel would otherwise overlay the editor and
  // there'd be nothing to type into); always visible on desktop ≥1024px where
  // the side-by-side layout has room for both.
  const [showPanel, setShowPanel] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  )

  const handleAcceptSuggestion = useCallback((range: [number, number], replacement: string) => {
    replaceTextRef.current?.(range[0], range[1], replacement)
  }, [])

  // Note: we intentionally do NOT auto-show the panel on mobile when issues
  // appear. On mobile the panel is full-width and replaces the editor, so
  // popping it up mid-typing would steal focus and prevent further edits.
  // The user toggles via the header button when ready to review issues.

  const isGitHub = Boolean(owner && repo && branch)
  const decodedPath = filePath ? decodeURIComponent(filePath) : ''

  const fileContext = useMemo(
    () => (isGitHub ? { repoOwner: owner, repoName: repo, branch, filePath: decodedPath } : undefined),
    [isGitHub, owner, repo, branch, decodedPath]
  )

  // GitHub-style line range from the URL fragment (e.g. #L3-L7).
  // Parsed once per location change — re-parsing on every render is cheap
  // but this keeps dependencies in useMemo readable.
  const range = useMemo(() => parseLineRangeHash(location.hash), [location.hash])

  // Room ID scopes the collaborative session. When two users open the
  // same file at the same range, they collaborate on the slice together.
  // Different ranges of the same file are deliberately separate rooms —
  // merging would let a user editing L3-L6 stomp on someone editing L8-L12.
  const roomId = useMemo(() => {
    if (docId) return docId
    if (!isGitHub) return null
    const base = `${owner}/${repo}/${branch}/${decodedPath}`
    return range ? `${base}${formatLineRangeHash(range)}` : base
  }, [docId, owner, repo, branch, decodedPath, isGitHub, range])

  useEffect(() => {
    if (!isGitHub) {
      const prompt = location.state?.manualPrompt || ''
      setContent(prompt)
      setOriginalContent(prompt)
      setSplit(null)
      setLoading(false)
      track('editor.opened', { kind: 'scratch', docId, hasManualPrompt: Boolean(prompt) })
      return
    }
    track('editor.opened', { kind: 'github', owner, repo, branch, filePath: decodedPath, hasRange: Boolean(range) })
    fetchFileContent()
    // range is in deps because changing #L1-L8 → #L10-L15 must re-split
    // the content (we freeze before/after at the moment the file loads).
  }, [owner, repo, branch, filePath, range?.start, range?.end])

  async function fetchFileContent() {
    try {
      const token = await getGitHubToken()
      const headers: Record<string, string> = { Accept: 'application/vnd.github.raw+json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${decodedPath}?ref=${branch}`,
        { headers }
      )
      if (!res.ok) throw new Error('Failed to fetch file')
      const text = await res.text()
      setOriginalContent(text)
      if (range) {
        const s = splitByLineRange(text, range)
        setSplit(s)
        setContent(s.slice)
      } else {
        setSplit(null)
        setContent(text)
      }
    } catch (err) {
      console.error('Failed to fetch file:', err)
    } finally {
      setLoading(false)
    }
  }

  // When sending to the PR, reconstitute the full file from the frozen
  // anchors + the (possibly edited) slice. Without a range, `content`
  // already IS the full file.
  const outgoingContent = useMemo(
    () => (split ? reassemble(split, content) : content),
    [split, content]
  )

  // Dirty check for the Create PR button — compare the OUTGOING (full) file
  // against the originally-fetched content. This way pure whitespace in
  // before/after (which we never touched) won't false-positive as dirty.
  const isDirty = outgoingContent !== originalContent

  function handleShareSession() {
    const textarea = document.createElement('textarea')
    textarea.value = window.location.href
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    setCopied(true)
    track('editor.share.copied', { kind: isGitHub ? 'github' : 'scratch', signedIn: isSignedIn, peerCount: peers.length })
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-warm border-t-primary" />
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center justify-between border-b border-warm bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          {isGitHub ? (
            <span className="font-mono text-sm text-text-mid">
              {owner}/{repo}/{decodedPath}
              {range && (
                <span className="ml-1 text-text-muted">
                  {formatLineRangeHash(range)}
                </span>
              )}
            </span>
          ) : (
            <span className="text-sm text-text-mid">Scratch prompt</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Connected peers */}
          {peers.length > 0 && (
            <div className="flex items-center -space-x-1.5 mr-1">
              {peers.map((peer, i) => (
                peer.imageUrl ? (
                  <img
                    key={i}
                    src={peer.imageUrl}
                    alt={peer.name}
                    className="h-7 w-7 rounded-full ring-2 ring-white"
                    title={peer.name}
                  />
                ) : (
                  <div
                    key={i}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white ring-2 ring-white"
                    style={{ backgroundColor: peer.color }}
                    title={peer.name}
                  >
                    {peer.name[0]?.toUpperCase() || '?'}
                  </div>
                )
              ))}
            </div>
          )}

          <button
            onClick={() => setShowPanel(!showPanel)}
            className="flex items-center gap-1.5 rounded-lg border border-warm px-2 py-1.5 text-sm text-text-mid transition hover:bg-warm lg:hidden"
            title={showPanel ? 'Hide analysis' : 'Show analysis'}
          >
            {showPanel ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>

          <button
            onClick={handleShareSession}
            className="flex items-center gap-1.5 rounded-lg border border-warm px-3 py-1.5 text-sm text-text-mid transition hover:bg-warm"
          >
            {copied ? <Check className="h-4 w-4 text-forest" /> : <Share2 className="h-4 w-4" />}
            {copied ? 'Copied!' : 'Share'}
          </button>

          {isGitHub && (
            <button
              onClick={() => {
                track('editor.pr.button.clicked', { owner, repo, branch, filePath: decodedPath, signedIn: isSignedIn })
                setShowPR(true)
              }}
              disabled={!isDirty}
              className="flex items-center gap-1.5 rounded-lg bg-forest px-3 py-1.5 text-sm font-medium text-white transition hover:bg-forest-light disabled:opacity-50"
            >
              <GitPullRequest className="h-4 w-4" />
              Create PR
            </button>
          )}

          {isSignedIn && <UserMenu />}
        </div>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        {/* Editor always mounted and full-width underneath. On desktop ≥lg
            the panel takes its own column (flex-initial w-80) so the editor
            shrinks. On mobile the panel is a drawer that overlays the
            editor — the editor stays visible behind the gap. */}
        <div className="relative flex-1 overflow-auto">
          <PromptEditor
            initialContent={content}
            onChange={setContent}
            onIssuesChange={setIssues}
            onPeersChange={setPeers}
            onAnalyzingChange={setAnalyzing}
            onAnalysisErrorChange={setAnalysisError}
            roomId={roomId}
            userName={user?.name || user?.login || undefined}
            userImageUrl={user?.avatar || undefined}
            activeIssueId={activeIssueId}
            onActiveIssueChange={setActiveIssueId}
            onReplaceText={replaceTextRef}
            onDismissIssue={dismissIssueRef}
            getToken={getToken}
            fileContext={fileContext}
          />
          <div className="pointer-events-none absolute bottom-3 right-3 z-10">
            <div className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-warm bg-white/90 px-3 py-1.5 text-xs text-text-muted shadow-sm backdrop-blur">
              <span>Made with</span>
              <Heart className="h-3 w-3 fill-primary text-primary" />
              <span>by</span>
              <a
                href="https://artanis.ai"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('editor.brand.clicked')}
                className="font-medium text-primary hover:underline"
              >
                Artanis
              </a>
              <span>: no-code AI evals.</span>
              <a
                href="https://calendar.notion.so/meet/yousef/sam"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('editor.brand.demo.clicked')}
                className="font-medium text-primary hover:underline"
              >
                Let's talk!
              </a>
            </div>
          </div>
        </div>

        {/* Mobile drawer backdrop — tapping closes the panel. Only rendered
            when the drawer is open AND we're below lg (hidden via lg:hidden). */}
        {showPanel && (
          <button
            onClick={() => setShowPanel(false)}
            aria-label="Close analysis panel"
            className="absolute inset-0 z-10 cursor-pointer bg-earth-dark/20 backdrop-blur-[1px] lg:hidden"
          />
        )}

        {/* Analysis panel. Mobile: slides in from right, leaves ~48px of the
            editor visible on the left. Desktop ≥lg: static flex column. */}
        <div
          className={`
            absolute right-0 top-0 z-20 h-full w-[calc(100%-3rem)] max-w-sm transform shadow-2xl transition-transform duration-300 ease-out
            lg:static lg:z-auto lg:w-80 lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:shadow-none lg:transition-none
            ${showPanel ? 'translate-x-0' : 'translate-x-full'}
          `}
        >
          <AnalysisPanel
            content={content}
            issues={issues}
            activeIssueId={activeIssueId}
            onIssueClick={setActiveIssueId}
            onAcceptSuggestion={handleAcceptSuggestion}
            analyzing={analyzing}
            analysisError={analysisError}
            getToken={getToken}
            fileContext={fileContext}
            onDismissIssue={(issue) => dismissIssueRef.current?.(issue)}
            onClose={() => setShowPanel(false)}
          />
        </div>
      </div>

      {showPR && owner && repo && decodedPath && (
        <PRCreator
          owner={owner}
          repo={repo}
          filePath={decodedPath}
          // PRCreator always gets the reconstituted full file — the worker
          // commits exactly these bytes, so the before/after chunks outside
          // the edited range must be byte-identical to what we fetched.
          content={outgoingContent}
          onClose={() => setShowPR(false)}
        />
      )}
    </div>
  )
}
