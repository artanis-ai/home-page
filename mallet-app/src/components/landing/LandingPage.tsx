import { useNavigate } from 'react-router-dom'
import { Shield, Users, Zap, Heart } from 'lucide-react'
import { StepConnect } from './StepConnect'
import { StepCollaborate } from './StepCollaborate'
import { StepAnalyze } from './StepAnalyze'
import { StepShip } from './StepShip'
import { SkillSection } from './SkillSection'

function MalletIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor">
      <path d="M7.604 4.604C9.34 2.868 10.208 2 11.286 2c1.079 0 1.947.868 3.682 2.604l4.42 4.419c1.735 1.735 2.603 2.603 2.603 3.682s-.868 1.946-2.604 3.682s-2.604 2.604-3.682 2.604c-1.079 0-1.947-.868-3.682-2.604l-4.42-4.419C5.869 10.233 5 9.365 5 8.286s.868-1.946 2.604-3.682m-.32 9.166l-4.458 4.458c-.343.343-.514.514-.617.692a1.56 1.56 0 0 0 0 1.562c.103.178.274.35.617.692s.513.514.692.617a1.56 1.56 0 0 0 1.562 0c.178-.103.35-.275.692-.617l4.458-4.458z" />
      <path d="m8.345 12.71l.004-.005l2.946 2.946l-.005.004zm11.324-5.527a1.56 1.56 0 0 0-.024-1.52c-.103-.178-.275-.349-.617-.691c-.342-.343-.514-.514-.692-.617a1.56 1.56 0 0 0-1.519-.024z" />
    </svg>
  )
}

export function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-cream">
      {/* Hero with desaturated sky gradient */}
      <section
        className="relative flex min-h-[80vh] flex-col items-center justify-center px-4 py-16 sm:px-6"
        style={{ background: 'linear-gradient(180deg, #dce8ef 0%, #e2eaf0 55%, #e4e8de 90%, #dde4d5 100%)' }}
      >
        <div className="text-center">
          <div className="flex items-center justify-center gap-4 mb-3">
            <MalletIcon className="h-16 w-16 text-earth-dark sm:h-24 sm:w-24" style={{ transform: 'scaleX(-1)' }} />
            <h1 className="font-display text-6xl font-semibold tracking-tight text-earth-dark sm:text-7xl lg:text-8xl">
              Mallet
            </h1>
          </div>

          <a href="https://artanis.ai" className="inline-flex items-center gap-2 mb-6 transition hover:opacity-80">
            <span className="text-sm text-text-mid">Powered by</span>
            <img src="/img/artanis.png" alt="Artanis" className="h-8" />
          </a>

          <p className="mx-auto max-w-2xl text-lg text-text-mid sm:text-xl mb-10">
            Collaboratively edit, analyze, and ship better prompts.
          </p>

          <button
            onClick={() => navigate('/start')}
            className="rounded-full bg-primary px-8 py-3.5 text-lg font-semibold text-white shadow-lg shadow-primary/25 transition hover:bg-primary-dark hover:shadow-xl"
          >
            Get Started
          </button>
        </div>

        {/* Trust badges at bottom of hero */}
        <div className="absolute bottom-8 left-0 right-0 flex flex-wrap items-center justify-center gap-6 text-sm text-text-muted">
          <div className="flex items-center gap-1.5">
            <Shield className="h-4 w-4 text-forest" />
            Prompts never stored
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4 text-forest" />
            Real-time collaboration
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-forest" />
            Instant analysis
          </div>
          <div className="flex items-center gap-1.5">
            <Heart className="h-4 w-4 text-forest" />
            Completely free
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-center font-display text-3xl font-bold text-earth-dark">
            How it works
          </h2>
          <p className="mx-auto mb-12 max-w-2xl text-center text-text-mid">
            Four steps to better prompts. No setup, no config, no hassle.
          </p>

          <div className="space-y-16">
            <StepConnect />
            <StepCollaborate />
            <StepAnalyze />
            <StepShip />
          </div>
        </div>
      </section>

      {/* Agent skill — public analysis API */}
      <SkillSection />

      {/* CTA */}
      <section className="border-t border-warm bg-white px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold text-earth-dark">
            Ready to improve your prompts?
          </h2>
          <p className="mt-4 text-lg text-text-mid">
            100% free. No credit card required.
          </p>
          <div className="mt-8">
            <button
              onClick={() => navigate('/start')}
              className="rounded-full bg-primary px-8 py-3.5 text-lg font-semibold text-white shadow-lg shadow-primary/25 transition hover:bg-primary-dark"
            >
              Get Started
            </button>
          </div>
        </div>
      </section>

      {/* Upsell */}
      <section className="border-t border-warm bg-cream px-4 py-12 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-text-muted">
            Want to measure if your prompt changes actually work in production?
          </p>
          <a
            href="https://artanis.ai"
            className="mt-2 inline-flex items-center gap-1 font-medium text-primary transition hover:text-primary-dark"
          >
            Try Artanis AI
          </a>
        </div>
      </section>

      {/* Footer - matches main site */}
      <footer style={{ background: '#0f0a05' }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center py-10 sm:flex-row sm:justify-between">
            <p className="text-sm text-warm/50">
              &copy; {new Date().getFullYear()} Artanis Ltd. All rights reserved.
            </p>
            <div className="mt-6 flex gap-x-6 text-sm sm:mt-0">
              <a href="https://artanis.ai/terms" className="text-warm/50 hover:text-warm transition-colors">Terms</a>
              <a href="https://artanis.ai/privacy" className="text-warm/50 hover:text-warm transition-colors">Privacy</a>
              <a href="https://artanis.ai/dpa" className="text-warm/50 hover:text-warm transition-colors">DPA</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
