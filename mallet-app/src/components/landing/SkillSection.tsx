import { useState } from 'react'
import { Terminal, Copy, Check, Shield } from 'lucide-react'

/**
 * "Use it as an agent skill" section on the Mallet landing page.
 *
 * Shows the install one-liner for the mallet-prompt-review agent skill
 * and a minimal description of the public API it wraps. The copy is
 * deliberately spare — agent developers want the command, not marketing.
 *
 * Kept in sync with:
 *   - /skills/mallet-prompt-review/SKILL.md (the actual skill)
 *   - mallet-worker/src/routes/public-analyze.ts (the API it calls)
 * If you change the endpoint URL or the no-storage promise here, update
 * both of those files too.
 */
export function SkillSection() {
  const INSTALL = 'npx skills add artanis-ai/home-page/tree/main/skills/mallet-prompt-review'
  const [copied, setCopied] = useState(false)

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

  return (
    <section className="border-t border-warm bg-white px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-warm bg-cream px-4 py-1.5 text-xs font-medium text-text-mid">
            <Terminal className="h-3.5 w-3.5 text-forest" />
            For agent developers
          </div>
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
          <label className="mb-2 block text-center text-xs font-medium uppercase tracking-wide text-text-muted">
            Install
          </label>
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
            Works with Claude Code, Cursor, and any{' '}
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

        {/* Three-up feature grid */}
        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          <div className="rounded-xl border border-warm bg-cream p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-forest">Free</div>
            <p className="mt-2 text-sm text-text-mid">
              No account, no API key. Just install the skill and go.
            </p>
          </div>
          <div className="rounded-xl border border-warm bg-cream p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-forest">Simple</div>
            <p className="mt-2 text-sm text-text-mid">
              <code className="font-mono text-xs">POST /api/public/analyze</code> with{' '}
              <code className="font-mono text-xs">{'{ prompt }'}</code>. Returns issues + ranges.
            </p>
          </div>
          <div className="rounded-xl border border-warm bg-cream p-5">
            <div className="mb-0.5 flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-forest" />
              <div className="text-xs font-semibold uppercase tracking-wide text-forest">Private</div>
            </div>
            <p className="mt-1.5 text-sm text-text-mid">
              Prompts are analyzed in-memory and never stored. Logs record counts only.
            </p>
          </div>
        </div>

        {/* Small API preview */}
        <details className="mt-10 group">
          <summary className="cursor-pointer text-center text-sm font-medium text-text-mid transition hover:text-earth-dark">
            Prefer to call the API directly? <span className="text-forest group-open:hidden">Show example</span><span className="text-forest hidden group-open:inline">Hide</span>
          </summary>
          <div className="mt-4 overflow-hidden rounded-xl border border-warm bg-earth-dark p-5">
            <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-warm">
{`curl -s -X POST https://mallet-api.artanis-ai.workers.dev/api/public/analyze \\
  -H 'Content-Type: application/json' \\
  -d '{"prompt": "Be brief. Give long detailed answers."}'

# → { "issues": [{"type": "contradiction", "range": [0, 9], "message": ... }],
#     "usage": { "inputTokens": 1234, "outputTokens": 42, "tasks": 6 } }`}
            </pre>
          </div>
        </details>
      </div>
    </section>
  )
}
