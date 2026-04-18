export function StepAnalyze() {
  return (
    <div className="flex flex-col items-start gap-8 lg:flex-row lg:gap-16">
      <div className="flex-1">
        <h3 className="font-display text-2xl font-bold text-earth-dark">
          3. Live analysis, like Grammarly for AI
        </h3>
        <p className="mt-3 text-text-mid">
          Issues are highlighted as you type. Contradictions, ambiguities, and best practice violations.
          Click any issue to get an AI-powered fix suggestion you can accept or dismiss.
        </p>
      </div>

      {/* Mock analysis illustration */}
      <div className="w-full max-w-md flex-1">
        <div className="rounded-xl border border-warm bg-white shadow-lg">
          {/* Mock editor with highlights */}
          <div className="border-b border-warm p-5">
            <div className="space-y-2.5 font-mono text-xs leading-relaxed">
              <div className="flex">
                <span className="mr-3 w-3 text-right text-text-muted">1</span>
                <span className="text-earth-dark">You are a customer support agent.</span>
              </div>
              <div className="flex">
                <span className="mr-3 w-3 text-right text-text-muted">2</span>
                <span className="text-earth-dark">
                  Always{' '}
                  <span className="rounded bg-primary/10 px-0.5" style={{ textDecoration: 'wavy underline #9B4340', textDecorationSkipInk: 'none' }}>
                    refuse to answer
                  </span>
                  {' '}questions.
                </span>
              </div>
              <div className="flex">
                <span className="mr-3 w-3 text-right text-text-muted">3</span>
                <span className="text-earth-dark">
                  Include{' '}
                  <span className="rounded bg-forest/10 px-0.5">
                    {'{{user_name}}'}
                  </span>
                  {' '}in your greeting.
                </span>
              </div>
              <div className="flex">
                <span className="mr-3 w-3 text-right text-text-muted">4</span>
                <span className="text-earth-dark">
                  <span className="rounded bg-primary/10 px-0.5" style={{ textDecoration: 'wavy underline #9B4340', textDecorationSkipInk: 'none' }}>
                    Help users solve their problems.
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Mock suggestion diff */}
          <div className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary" />
              <span className="text-xs font-semibold uppercase tracking-wide text-primary">Contradiction</span>
            </div>
            <p className="mb-3 text-xs text-text-mid">
              "Refuse to answer questions" directly contradicts "Help users solve their problems"
            </p>
            <div className="rounded-lg border border-warm bg-cream p-3">
              <div className="font-mono text-xs">
                <div className="text-primary line-through">Always refuse to answer questions.</div>
                <div className="mt-1 text-forest">Always answer questions helpfully.</div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="rounded-lg bg-forest px-3 py-1 text-xs font-medium text-white">
                Accept
              </button>
              <button className="rounded-lg border border-warm px-3 py-1 text-xs text-text-mid">
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
