import { useState } from 'react'
import { Copy, Check, ChevronDown } from 'lucide-react'
import { Highlight, Prism, type PrismTheme } from 'prism-react-renderer'

// prism-react-renderer v2 ships tsx/python/jsx by default but not bash, so we
// register a minimal grammar for the curl snippet. Scope is intentionally
// narrow — this isn't a full shell parser, just enough for the landing page.
const prismLangs = (Prism as unknown as { languages: Record<string, unknown> }).languages
if (!prismLangs.bash) {
  prismLangs.bash = {
    comment: { pattern: /(^|[^"])#.*/, lookbehind: true },
    string: { pattern: /(["'])(?:\\.|(?!\1)[^\\])*\1/, greedy: true },
    url: /\bhttps?:\/\/\S+/,
    function: /\b(?:curl|wget|httpie|http|fetch|bash|sh|npm|npx|node|python|pip)\b/,
    keyword: /\b(?:if|then|else|fi|for|in|do|done|while|case|esac|return|export)\b/,
    boolean: /\b(?:true|false)\b/,
    operator: /&&|\|\||[|&;<>]/,
    parameter: /(?:^|\s)-{1,2}[\w-]+/,
    punctuation: /[{}()[\];\\]/,
  }
}

/**
 * Custom Prism theme that picks tokens from the Mallet palette defined in
 * `src/index.css` so the code blocks feel of-a-piece with the rest of the
 * landing page. Keep this in sync with the theme tokens there.
 */
const MALLET_PRISM_THEME: PrismTheme = {
  plain: { color: '#F5EDE3', backgroundColor: 'transparent' }, // --color-warm
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: '#9A8B7A', fontStyle: 'italic' } }, // --color-text-muted
    { types: ['punctuation'], style: { color: '#F5EDE3', opacity: 0.6 } },
    { types: ['property', 'tag', 'boolean', 'number', 'constant', 'symbol', 'deleted'], style: { color: '#F0D9A8' } }, // --color-accent-light
    { types: ['selector', 'attr-name', 'string', 'char', 'builtin', 'inserted'], style: { color: '#D4A76A' } }, // --color-accent
    { types: ['operator', 'entity', 'url', 'variable'], style: { color: '#F5EDE3' } },
    { types: ['keyword', 'atrule'], style: { color: '#6BA37A' } }, // --color-forest-light
    { types: ['function', 'class-name'], style: { color: '#6BA37A' } },
    { types: ['regex', 'important'], style: { color: '#C4716A' } }, // --color-primary-light
    { types: ['parameter'], style: { color: '#F5EDE3' } },
  ],
}

/**
 * "Use it as an agent skill" section on the Mallet landing page.
 *
 * Shows the install one-liner for the mallet-prompt-review agent skill
 * and a minimal description of the public API it wraps. The copy is
 * deliberately spare — agent developers want the command, not marketing.
 *
 * Kept in sync with:
 *   - skills/mallet-prompt-review/SKILL.md (submodule → artanis-ai/mallet-skills)
 *   - mallet-worker/src/routes/public-analyze.ts (the API it calls)
 * If you change the endpoint URL or the no-storage promise here, update
 * both of those files too.
 */
const ENDPOINT = 'https://mallet-api.artanis-ai.workers.dev/api/public/analyze'

const EXAMPLES: { id: 'curl' | 'python' | 'typescript'; label: string; language: 'bash' | 'python' | 'tsx'; code: string }[] = [
  {
    id: 'curl',
    label: 'curl',
    language: 'bash',
    code: `curl -s -X POST ${ENDPOINT} \\
  -H 'Content-Type: application/json' \\
  -d '{"prompt": "Be brief. Give long detailed answers."}'`,
  },
  {
    id: 'python',
    label: 'Python',
    language: 'python',
    code: `import requests

res = requests.post(
    "${ENDPOINT}",
    json={"prompt": "Be brief. Give long detailed answers."},
    timeout=30,
)
res.raise_for_status()
for issue in res.json()["issues"]:
    print(issue["type"], issue["message"])`,
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    language: 'tsx',
    code: `const res = await fetch("${ENDPOINT}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "Be brief. Give long detailed answers." }),
})
if (!res.ok) throw new Error(\`analyze \${res.status}\`)
const { issues } = await res.json()
for (const issue of issues) console.log(issue.type, issue.message)`,
  },
]

export function SkillSection() {
  const INSTALL = 'npx skills add artanis-ai/mallet-skills'
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<typeof EXAMPLES[number]['id']>('curl')
  const [snippetCopied, setSnippetCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(INSTALL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers — quietly drop; the user can still
      // triple-click to select the command visually.
    }
  }

  async function copySnippet() {
    const active = EXAMPLES.find((e) => e.id === activeTab)
    if (!active) return
    try {
      await navigator.clipboard.writeText(active.code)
      setSnippetCopied(true)
      setTimeout(() => setSnippetCopied(false), 2000)
    } catch {
      // See note in `copy()`.
    }
  }

  return (
    <section className="border-t border-warm bg-white px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <h2 className="font-display text-3xl font-bold text-earth-dark">
            Also available as an agent skill
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-text-mid">
            Let your coding agent review prompts before it ships them. Install the{' '}
            <code className="rounded bg-cream px-1.5 py-0.5 font-mono text-sm text-earth-dark">
              mallet-prompt-review
            </code>{' '}
            skill and it will call Mallet's public analysis API whenever it's about to write or audit a prompt.
          </p>
        </div>

        {/* Install command */}
        <div className="mt-10">
          <div className="group relative mx-auto max-w-2xl overflow-hidden rounded-xl border border-warm bg-earth-dark shadow-lg">
            <div className="flex items-center gap-3 px-5 py-4">
              <span className="select-none font-mono text-sm text-forest">$</span>
              <code className="flex-1 truncate font-mono text-sm text-warm">{INSTALL}</code>
              <button
                onClick={copy}
                aria-label="Copy install command"
                className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-warm/20 bg-earth px-2.5 py-1.5 text-xs font-medium text-warm transition hover:bg-earth-dark hover:border-warm/40"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-forest" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-text-muted">
            Works with Claude Code, Codex, and any{' '}
            <a
              href="https://agentskills.io"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 transition hover:text-text-mid"
            >
              agentskills.io
            </a>
            -compatible client.
          </p>
        </div>

        {/* API details — expandable */}
        <details className="group mt-14 overflow-hidden rounded-xl border border-warm bg-warm/30">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 transition hover:bg-warm/50">
            <div>
              <div className="text-sm font-semibold text-earth-dark">
                Prefer to call the API directly?
              </div>
              <div className="text-xs text-text-muted">
                One free endpoint. No account or API key required.
              </div>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-text-muted transition-transform group-open:rotate-180" />
          </summary>

          <div className="border-t border-warm bg-cream px-6 py-5">
            <div className="grid gap-4 text-sm sm:grid-cols-[auto_1fr]">
              <div className="font-medium text-text-muted">Endpoint</div>
              <code className="font-mono text-xs text-earth-dark">POST {ENDPOINT}</code>

              <div className="font-medium text-text-muted">Request</div>
              <code className="font-mono text-xs text-earth-dark">{'{ "prompt": "..." }'}</code>

              <div className="font-medium text-text-muted">Response</div>
              <code className="font-mono text-xs text-earth-dark">
                {'{ issues: [{ type, range, message }], usage: {...} }'}
              </code>

              <div className="font-medium text-text-muted">Privacy</div>
              <span className="text-xs text-text-mid">
                Prompts are analyzed in-memory and never stored. Logs record counts only.
              </span>
            </div>

            {/* Example snippet — tabbed by language */}
            <div className="mt-5 overflow-hidden rounded-lg border border-warm bg-earth-dark">
              <div
                role="tablist"
                aria-label="Example languages"
                className="flex items-center justify-between gap-2 border-b border-warm/20 px-2"
              >
                <div className="flex">
                  {EXAMPLES.map((ex) => {
                    const active = ex.id === activeTab
                    return (
                      <button
                        key={ex.id}
                        role="tab"
                        aria-selected={active}
                        onClick={() => setActiveTab(ex.id)}
                        className={`relative cursor-pointer px-3 py-2 font-mono text-xs transition ${
                          active
                            ? 'text-warm'
                            : 'text-warm/50 hover:text-warm/80'
                        }`}
                      >
                        {ex.label}
                        {active && (
                          <span className="absolute inset-x-2 bottom-0 h-px bg-forest" />
                        )}
                      </button>
                    )
                  })}
                </div>
                <button
                  onClick={copySnippet}
                  aria-label="Copy example"
                  className="mr-2 flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-warm/20 px-2 py-1 text-[11px] font-medium text-warm/70 transition hover:border-warm/40 hover:text-warm"
                >
                  {snippetCopied ? (
                    <>
                      <Check className="h-3 w-3 text-forest" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              {(() => {
                const active = EXAMPLES.find((e) => e.id === activeTab)
                if (!active) return null
                return (
                  <Highlight theme={MALLET_PRISM_THEME} code={active.code} language={active.language}>
                    {({ className, style, tokens, getLineProps, getTokenProps }) => (
                      <pre
                        className={`${className} overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed`}
                        style={style}
                      >
                        {tokens.map((line, i) => (
                          <div key={i} {...getLineProps({ line })}>
                            {line.map((token, j) => (
                              <span key={j} {...getTokenProps({ token })} />
                            ))}
                          </div>
                        ))}
                      </pre>
                    )}
                  </Highlight>
                )
              })()}
            </div>
          </div>
        </details>
      </div>
    </section>
  )
}
