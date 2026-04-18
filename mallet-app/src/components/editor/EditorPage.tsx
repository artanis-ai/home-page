import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { useUser, useAuth, UserButton, SignedIn, SignedOut } from '@clerk/clerk-react'
import { useGitHubSignIn } from '../../hooks/useGitHubSignIn'
import { useGitHubToken } from '../../hooks/useGitHubToken'
import { TEST_TOKEN } from '../../lib/api'
import { PromptEditor, type Peer } from './PromptEditor'
import { AnalysisPanel } from './AnalysisPanel'
import { PRCreator } from '../repo/PRCreator'
import { Share2, GitPullRequest, Check, PanelRightOpen, PanelRightClose } from 'lucide-react'
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
  const { user } = useUser()
  const { getToken, isSignedIn } = useAuth()
  const signInWithGitHub = useGitHubSignIn()
  const getGitHubToken = useGitHubToken()

  // Clerk session JWT for the WebSocket signaling handshake (must be a string,
  // not a promise — the signaling URL is built synchronously when the editor
  // effect mounts). In Playwright/E2E, VITE_TEST_TOKEN supplies a static token.
  const [sessionToken, setSessionToken] = useState<string | null>(TEST_TOKEN)
  useEffect(() => {
    if (TEST_TOKEN) return // E2E bypass — use the static token
    let cancelled = false
    if (!isSignedIn) { setSessionToken(null); return }
    getToken().then(t => { if (!cancelled) setSessionToken(t) })
    return () => { cancelled = true }
  }, [isSignedIn, getToken])

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
  const replaceTextRef = useRef<((from: number, to: number, text: string) => void) | null>(null)
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
      return
    }
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
              onClick={() => setShowPR(true)}
              disabled={!isDirty}
              className="flex items-center gap-1.5 rounded-lg bg-forest px-3 py-1.5 text-sm font-medium text-white transition hover:bg-forest-light disabled:opacity-50"
            >
              <GitPullRequest className="h-4 w-4" />
              Create PR
            </button>
          )}

          <SignedIn>
            <UserButton />
          </SignedIn>
          <SignedOut>
            <button
              onClick={signInWithGitHub}
              className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-white transition hover:bg-primary-dark"
            >
              Sign in
            </button>
          </SignedOut>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Mobile: editor and panel are mutually exclusive (toggle in header).
            Desktop ≥lg: both visible side-by-side. */}
        <div className={`${showPanel ? 'hidden lg:block' : ''} flex-1 overflow-auto`}>
          <PromptEditor
            initialContent={content}
            onChange={setContent}
            onIssuesChange={setIssues}
            onPeersChange={setPeers}
            onAnalyzingChange={setAnalyzing}
            roomId={roomId}
            userName={user?.fullName || user?.username || undefined}
            userImageUrl={user?.imageUrl || undefined}
            activeIssueId={activeIssueId}
            onActiveIssueChange={setActiveIssueId}
            onReplaceText={replaceTextRef}
            sessionToken={sessionToken}
            getToken={getToken}
          />
        </div>

        <div className={`${showPanel ? 'flex-1 lg:flex-initial' : 'hidden'} lg:block h-full`}>
          <AnalysisPanel
            content={content}
            issues={issues}
            activeIssueId={activeIssueId}
            onIssueClick={setActiveIssueId}
            onAcceptSuggestion={handleAcceptSuggestion}
            analyzing={analyzing}
            getToken={getToken}
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
