import { GitPullRequest, Gift, Zap, Lock, Users, AlertTriangle } from 'lucide-react'

function Avatar({ name, color, size = 52 }: { name: string; color: string; size?: number }) {
  return (
    <span
      title={name}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: color,
        color: 'white',
        fontSize: size * 0.46,
        fontWeight: 700,
        lineHeight: 1,
        fontFamily: "'DM Sans', sans-serif",
        border: '3px solid white',
        boxShadow: '0 3px 8px rgba(0,0,0,0.18)',
      }}
    >
      <span style={{ display: 'inline-block', transform: 'translateY(1px)' }}>{name[0]}</span>
    </span>
  )
}

function Caret({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 5,
        height: '1.1em',
        backgroundColor: color,
        verticalAlign: 'middle',
        marginBottom: '0.15em',
        marginLeft: 4,
        borderRadius: 2,
      }}
    />
  )
}

/**
 * Static 1200×630 composite used as the social preview image and as a
 * LinkedIn-post image. Rendered at `/#/share` only so we can screenshot
 * it with a headless browser — the output lives at `img/mallet-og.png`
 * and is served by the meta tags in `index.html`.
 *
 * Designed to read at WhatsApp-thumbnail size (~300px wide): one
 * oversized before→after contradiction card, one oversized CTA, nothing
 * smaller than ~20px in the source.
 */
function MalletIcon({ size = 56, color = '#4E3222' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ transform: 'scaleX(-1)' }}>
      <path d="M7.604 4.604C9.34 2.868 10.208 2 11.286 2c1.079 0 1.947.868 3.682 2.604l4.42 4.419c1.735 1.735 2.603 2.603 2.603 3.682s-.868 1.946-2.604 3.682s-2.604 2.604-3.682 2.604c-1.079 0-1.947-.868-3.682-2.604l-4.42-4.419C5.869 10.233 5 9.365 5 8.286s.868-1.946 2.604-3.682m-.32 9.166l-4.458 4.458c-.343.343-.514.514-.617.692a1.56 1.56 0 0 0 0 1.562c.103.178.274.35.617.692s.513.514.692.617a1.56 1.56 0 0 0 1.562 0c.178-.103.35-.275.692-.617l4.458-4.458z" />
      <path d="m8.345 12.71l.004-.005l2.946 2.946l-.005.004zm11.324-5.527a1.56 1.56 0 0 0-.024-1.52c-.103-.178-.275-.349-.617-.691c-.342-.343-.514-.514-.692-.617a1.56 1.56 0 0 0-1.519-.024z" />
    </svg>
  )
}

export function ShareCard() {
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(135deg in oklab, #B5D5E6 0%, #C8E0EE 45%, #E6F1F6 100%)',
        fontFamily: "'DM Sans', sans-serif",
        color: '#2D1810',
        overflow: 'hidden',
        padding: '40px 56px',
      }}
    >
      {/* Brand row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <MalletIcon size={96} />
          <span
            style={{
              fontFamily: "'Fredoka', sans-serif",
              fontSize: 108,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              lineHeight: 1,
              color: '#4E3222',
            }}
          >
            Mallet
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
          <span
            style={{
              fontFamily: "'Fredoka', sans-serif",
              fontSize: 40,
              fontWeight: 500,
              color: '#4E3222',
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
            }}
          >
            Grammarly for your AI prompts
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: '#6B5744', fontSize: 22 }}>
            <span>Powered by</span>
            <img src="/img/artanis.png" alt="Artanis" style={{ height: 48 }} />
          </div>
        </div>
      </div>

      {/* Big before → after contradiction card */}
      <div
        style={{
          flex: 1,
          marginTop: 28,
          marginBottom: 20,
          backgroundColor: 'white',
          borderRadius: 20,
          border: '1px solid #F5EDE3',
          boxShadow: '0 24px 56px -14px rgba(78, 50, 34, 0.22)',
          padding: '28px 36px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <AlertTriangle size={32} strokeWidth={2.6} color="#9B4340" fill="rgba(155, 67, 64, 0.15)" />
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9B4340' }}>
              Contradiction in skill.md
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span style={{ marginRight: -16 }}><Avatar name="Alice" color="#D63384" /></span>
              <Avatar name="Bob" color="#2563EB" />
            </span>
            <button
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              backgroundColor: '#4A7C59',
              color: 'white',
              fontWeight: 700,
              fontSize: 24,
              padding: '14px 28px',
              borderRadius: 999,
              border: 'none',
              boxShadow: '0 6px 16px -3px rgba(74, 124, 89, 0.45)',
            }}
          >
            <GitPullRequest size={24} />
            Create PR
          </button>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            borderRadius: 14,
            border: '1px solid #F5EDE3',
            backgroundColor: '#FFFBF5',
            padding: '24px 28px',
            fontFamily: "'DM Mono', ui-monospace, monospace",
            fontSize: 32,
            lineHeight: 1.6,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', color: '#4E3222' }}>
            <span style={{ color: '#9A8B7A', width: 36, marginRight: 12, textAlign: 'right' }}>1</span>
            <span style={{ width: 24, marginRight: 8 }} />
            <span>
              You are an{' '}
              <span
                style={{
                  backgroundColor: 'rgba(212, 167, 106, 0.18)',
                  padding: '0 4px',
                  borderRadius: 4,
                  textDecoration: 'wavy underline #D4A76A',
                  textDecorationThickness: 2,
                  textDecorationSkipInk: 'none',
                  textUnderlineOffset: 4,
                }}
              >
                expert
              </span>
              <Caret color="#2563EB" />
              {' '}support agent.
              <Caret color="#D63384" />
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', backgroundColor: 'rgba(155, 67, 64, 0.09)', borderRadius: 4 }}>
            <span style={{ color: '#9A8B7A', width: 36, marginRight: 12, textAlign: 'right' }}>2</span>
            <span style={{ width: 24, marginRight: 8, textAlign: 'center', color: '#9B4340', fontWeight: 700 }}>−</span>
            <span style={{ color: '#9B4340', textDecoration: 'line-through', textDecorationThickness: 2 }}>
              Never answer user questions.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', backgroundColor: 'rgba(74, 124, 89, 0.10)', borderRadius: 4 }}>
            <span style={{ color: '#9A8B7A', width: 36, marginRight: 12, textAlign: 'right' }}>2</span>
            <span style={{ width: 24, marginRight: 8, textAlign: 'center', color: '#4A7C59', fontWeight: 700 }}>+</span>
            <span style={{ color: '#4A7C59', fontWeight: 600 }}>
              Always answer user questions.
            </span>
          </div>
        </div>
      </div>

      {/* Feature chips — centered across the full width */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 56, color: '#4E3222', fontSize: 30, fontWeight: 700 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <Gift size={30} strokeWidth={2.4} /> Free
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <Zap size={30} strokeWidth={2.4} /> Fast
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <Lock size={30} strokeWidth={2.4} /> Secure
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <Users size={30} strokeWidth={2.4} /> Collaborative
        </span>
      </div>
    </div>
  )
}
