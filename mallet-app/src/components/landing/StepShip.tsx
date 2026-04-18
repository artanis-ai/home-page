import { GitPullRequest, Check, ArrowRight } from 'lucide-react'

export function StepShip() {
  return (
    <div className="flex flex-col items-start gap-8 lg:flex-row lg:gap-16">
      <div className="flex-1">
        <h3 className="font-display text-2xl font-bold text-earth-dark">
          4. Ship it with a pull request
        </h3>
        <p className="mt-3 text-text-mid">
          When your team is happy with the prompt, create a PR with one click.
          The changes go straight to your repo. No copy-pasting, no context switching.
        </p>
      </div>

      {/* Mock PR illustration */}
      <div className="w-full max-w-md flex-1 self-center lg:self-auto">
        <div className="rounded-xl border border-warm bg-white p-6 shadow-lg">
          {/* PR header */}
          <div className="flex items-start gap-3">
            <div className="mt-1 rounded-full bg-forest/10 p-2">
              <GitPullRequest className="h-5 w-5 text-forest" />
            </div>
            <div>
              <h4 className="font-semibold text-earth-dark">Improve prompt: system-prompt.md</h4>
              <p className="mt-0.5 text-xs text-text-muted">
                opened just now by <span className="font-medium text-text-mid">you</span>
              </p>
            </div>
          </div>

          {/* PR diff preview */}
          <div className="mt-4 overflow-hidden rounded-lg border border-warm font-mono text-xs">
            <div className="bg-warm/50 px-3 py-1.5 text-text-muted">
              system-prompt.md
            </div>
            <div className="bg-primary/5 px-3 py-1 text-primary">
              <span className="mr-2 text-text-muted">-</span>
              Keep responses concise and brief.
            </div>
            <div className="bg-forest/5 px-3 py-1 text-forest">
              <span className="mr-2 text-text-muted">+</span>
              Keep responses concise yet comprehensive when needed.
            </div>
            <div className="bg-primary/5 px-3 py-1 text-primary">
              <span className="mr-2 text-text-muted">-</span>
              Provide detailed, thorough explanations.
            </div>
            <div className="bg-forest/5 px-3 py-1 text-forest">
              <span className="mr-2 text-text-muted">+</span>
              Provide thorough explanations for complex topics.
            </div>
          </div>

          {/* Success state */}
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-forest/5 px-3 py-2">
            <Check className="h-4 w-4 text-forest" />
            <span className="text-sm font-medium text-forest">PR created successfully</span>
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="ml-auto flex items-center gap-1 text-xs text-primary"
            >
              View on GitHub <ArrowRight className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
