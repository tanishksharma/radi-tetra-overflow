import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import homeIconUrl from '../icons/home-button.png'

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true

// ─── Crypto address row ────────────────────────────────────────────────────────
function CryptoRow({ icon, symbol, address }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <span style={{ fontSize: '1.1rem', width: 24, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.55rem', color: '#888', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 2 }}>{symbol}</div>
        <div style={{ fontSize: '0.6rem', color: '#94a3b8', letterSpacing: '0.04em', wordBreak: 'break-all', fontFamily: 'monospace' }}>{address}</div>
      </div>
      <button
        onClick={copy}
        style={{ flexShrink: 0, background: copied ? '#22c55e22' : 'rgba(255,255,255,0.05)', border: `1px solid ${copied ? '#22c55e' : 'rgba(255,255,255,0.12)'}`, color: copied ? '#22c55e' : '#888', borderRadius: 6, padding: '4px 10px', fontSize: '0.58rem', cursor: 'pointer', fontFamily: 'monospace', letterSpacing: '0.08em', transition: 'all 0.2s', whiteSpace: 'nowrap' }}
      >
        {copied ? '✓ COPIED' : 'COPY'}
      </button>
    </div>
  )
}

// ─── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, children, accent = '#00d4ff' }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '1rem 1.2rem', marginBottom: '1rem' }}>
      <div style={{ fontSize: '0.55rem', letterSpacing: '0.3em', color: accent, textTransform: 'uppercase', marginBottom: 10, fontWeight: 700 }}>{title}</div>
      {children}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function InfoPage() {
  const navigate     = useNavigate()
  const [installed, setInstalled]         = useState(isStandalone())
  const [installPrompt, setInstallPrompt] = useState(null)
  const [toast, setToast]                 = useState(null)

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') { setInstallPrompt(null); setInstalled(true) }
  }

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2000) }
  const GPay_UPI  = import.meta.env.VITE_GPAY_UPI || ''
  const GPay_NAME = 'Tetra Overflow'
  const gpayUrl   = GPay_UPI ? `upi://pay?pa=${encodeURIComponent(GPay_UPI)}&pn=${encodeURIComponent(GPay_NAME)}&cu=INR` : ''

  const CRYPTO_ADDRESSES = [
    { icon: '₿',  symbol: 'Bitcoin (BTC)',      address: 'bc1qwxqgk58am7s6te39pe9wde2kcczwhtpr2jf2z0' },
    { icon: 'Ξ',  symbol: 'Ethereum (ETH)',      address: '0x053a9bc9DF60C3F1feD2AaA71590d1EDFBeCf84B' },
    { icon: '●',  symbol: 'Litecoin (LTC)',       address: 'ltc1qwxqgk58am7s6te39pe9wde2kcczwhtprwwnw6l' },
  ]

  return (
    <div style={{ minHeight: '100dvh', background: '#0a0a14', display: 'flex', flexDirection: 'column', fontFamily: '"Courier New", monospace', color: '#fff' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(env(safe-area-inset-top, 0px) + 1rem) 1.4rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '0.72rem', letterSpacing: '0.14em', fontFamily: 'inherit', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={homeIconUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
          <span>MENU</span>
        </button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, letterSpacing: '0.2em', color: '#00d4ff' }}>INFO</h1>
        <div style={{ width: 60 }} />
      </header>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.2rem 1.4rem 2rem', maxWidth: 600, width: '100%', margin: '0 auto' }}>

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ textAlign: 'center', marginBottom: '1.5rem' }}
        >
          <h2 style={{ margin: '0 0 4px', fontSize: '1.8rem', fontWeight: 900, letterSpacing: '0.06em', background: 'linear-gradient(135deg, #00d4ff, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            TETRA OVERFLOW
          </h2>
          <div style={{ fontSize: '0.6rem', letterSpacing: '0.35em', color: '#555', textTransform: 'uppercase' }}>ULTRA · PWA</div>
        </motion.div>

        {/* About */}
        <Section title="About" accent="#00d4ff">
          <p style={{ margin: 0, fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.7, letterSpacing: '0.04em' }}>
            Guideline-accurate Tetris with multiple game modes including <strong style={{ color: '#22c55e' }}>Easy mode</strong> for beginners,
            Zone mechanic, SRS+ rotation, procedural BGM, 20 custom themes, story campaign,
            online multiplayer, <strong style={{ color: '#a855f7' }}>friends &amp; social system</strong>, XP rewards, and full touch support.
            Built as a mobile-first PWA — install it on your home screen for the best experience.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {['React 19', 'Vite', 'Web Audio API', 'Canvas 2D', 'Firebase', 'PWA'].map(t => (
              <span key={t} style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: 6, padding: '3px 8px', fontSize: '0.55rem', color: '#00d4ff', letterSpacing: '0.12em' }}>{t}</span>
            ))}
          </div>
        </Section>

        {/* Developer */}
        <Section title="Developer" accent="#a855f7">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'linear-gradient(135deg,#00d4ff,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', flexShrink: 0 }}>👾</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', letterSpacing: '0.1em', color: '#e2e8f0' }}>Anuraag G Rao</div>
              <div style={{ fontSize: '0.6rem', color: '#666', letterSpacing: '0.15em', marginTop: 2 }}>DEVELOPER &amp; DESIGNER</div>
            </div>
          </div>
        </Section>

        {/* Game Modes */}
        <Section title="Game Modes" accent="#22c55e">
          {[
            { icon: '▦',  mode: 'SOLO',     desc: 'Play Normal, Sprint, Blitz, Purify, Zen, and Ultimate.' },
            { icon: '◈',  mode: 'STORY',    desc: '7 chapters of escalating Tetris challenges with narrative, unique mechanics, and theme unlocks.' },
            { icon: '⚡',  mode: 'VERSUS',   desc: 'Online real-time multiplayer — up to 4 players, garbage sends, round-based scoring.' },
          ].map(({ icon, mode, desc }) => (
            <div key={mode} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontSize: '1rem', width: 22, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
              <div>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.12em', color: '#e2e8f0', marginBottom: 2 }}>{mode}</div>
                <div style={{ fontSize: '0.6rem', color: '#666', letterSpacing: '0.04em', lineHeight: 1.5 }}>{desc}</div>
              </div>
            </div>
          ))}
        </Section>

        {/* Social */}
        <Section title="Friends &amp; Social" accent="#a855f7">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { icon: '👥', title: 'Friends', desc: 'Add friends from the leaderboard. Send and accept friend requests from the Stats page.' },
              { icon: '📨', title: 'Lobby Invites', desc: 'Invite friends directly to your multiplayer lobby from inside a game room.' },
              { icon: '🏅', title: 'NOOB Badge', desc: 'Play in Easy mode and earn the legendary NOOB badge visible on your profile and leaderboard.' },
              { icon: '🔍', title: 'Player Profiles', desc: 'Click any leaderboard entry to view their profile, best scores, and badges.' },
            ].map(({ icon, title, desc }) => (
              <div key={title} style={{ display: 'flex', gap: 10 }}>
                <span style={{ fontSize: '1rem', width: 22, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
                <div>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.1em', marginBottom: 2 }}>{title}</div>
                  <div style={{ fontSize: '0.6rem', color: '#666', lineHeight: 1.5 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Install PWA */}
        <Section title="Install App" accent="#f97316">
          {installed ? (
            <div style={{ fontSize: '0.72rem', color: '#22c55e', letterSpacing: '0.1em' }}>✓ App is installed — enjoy!</div>
          ) : isIOS() ? (
            <ol style={{ margin: 0, padding: '0 0 0 1.2rem', fontSize: '0.68rem', color: '#94a3b8', lineHeight: 1.9 }}>
              <li>Tap the <strong style={{ color: '#e2e8f0' }}>Share</strong> button ⬆ in Safari</li>
              <li>Tap <strong style={{ color: '#e2e8f0' }}>"Add to Home Screen"</strong></li>
              <li>Tap <strong style={{ color: '#e2e8f0' }}>"Add"</strong> to confirm</li>
            </ol>
          ) : installPrompt ? (
            <button
              onClick={handleInstall}
              style={{ background: 'linear-gradient(135deg,#f97316,#fb923c)', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', padding: '10px 24px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.12em', fontFamily: 'inherit' }}
            >
              ⬇ Install on this device
            </button>
          ) : (
            <div style={{ fontSize: '0.68rem', color: '#666', lineHeight: 1.6 }}>
              Open in <strong style={{ color: '#e2e8f0' }}>Chrome</strong> (Android) or <strong style={{ color: '#e2e8f0' }}>Safari</strong> (iOS) and use "Add to Home Screen".
            </div>
          )}
        </Section>

        {/* Download Android APK */}
        <Section title="Download Android APK" accent="#06b6d4">
          <p style={{ margin: '0 0 12px', fontSize: '0.68rem', color: '#94a3b8', lineHeight: 1.6, letterSpacing: '0.04em' }}>
            Get the native Android app (APK) for the best fullscreen experience. Install directly 
            without using Google Play Store.
          </p>
          <button
            onClick={() => navigate('/download')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '12px 20px',
              background: 'linear-gradient(135deg,#06b6d4,#0891b2)',
              border: 'none', borderRadius: 8, color: '#fff',
              fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.12em',
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => e.target.style.opacity = '0.9'}
            onMouseLeave={(e) => e.target.style.opacity = '1'}
          >
            ⬇️ Download APKs
          </button>
        </Section>

        {/* ── Support the Dev ────────────────────────────────────────────────── */}
        <Section title="Support the Dev ❤️" accent="#ec4899">
          <p style={{ margin: '0 0 12px', fontSize: '0.68rem', color: '#94a3b8', lineHeight: 1.6, letterSpacing: '0.04em' }}>
            Tetra Overflow Ultra is free and open-source. If you enjoy it and want to support future
            development, any contribution is deeply appreciated!
          </p>
          
          {/* PayPal */}
          <a
            href="https://paypal.me/RadiCalzMad"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              background: 'rgba(0,112,243,0.1)', border: '1px solid rgba(0,112,243,0.3)',
              borderRadius: 10, textDecoration: 'none', marginBottom: 14,
              transition: 'background 0.2s',
            }}
          >
            <span style={{ fontSize: '1.4rem' }}>🅿</span>
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#60a5fa', letterSpacing: '0.1em' }}>PayPal</div>
              <div style={{ fontSize: '0.58rem', color: '#555', letterSpacing: '0.06em' }}>paypal.me/RadiCalzMad</div>
            </div>
            <span style={{ marginLeft: 'auto', fontSize: '0.6rem', color: '#555' }}>↗</span>
          </a>

          {/* Google Pay (UPI) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
            background: 'rgba(52,168,83,0.10)', border: '1px solid rgba(52,168,83,0.35)',
            borderRadius: 10, marginBottom: 14,
          }}>
            <span style={{ fontSize: '1.4rem' }}>🅖</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#34d399', letterSpacing: '0.1em' }}>Google Pay (UPI)</div>
              <div style={{ fontSize: '0.58rem', color: '#555', letterSpacing: '0.06em', overflow: 'hidden', textOverflow: 'ellipsis' }}>{GPay_UPI}</div>
            </div>
            <button
              onClick={async () => { if (!GPay_UPI) return; try { await navigator.clipboard?.writeText(GPay_UPI); showToast('✓ UPI copied'); } catch {} }}
              disabled={!GPay_UPI}
              style={{ background: 'rgba(52,168,83,0.15)', border: '1px solid rgba(52,168,83,0.45)', color: '#34d399', borderRadius: 8, padding: '6px 10px', fontSize: '0.62rem', cursor: GPay_UPI ? 'pointer' : 'not-allowed', fontFamily: 'inherit', letterSpacing: '0.08em' }}
            >Copy UPI</button>
            <a
              href={gpayUrl || undefined}
              onClick={(e) => { if (!gpayUrl) e.preventDefault() }}
              style={{ marginLeft: 6, background: 'linear-gradient(135deg,#34d399,#22c55e)', border: 'none', color: '#000', borderRadius: 8, padding: '7px 10px', fontSize: '0.62rem', textDecoration: 'none', cursor: gpayUrl ? 'pointer' : 'not-allowed', opacity: gpayUrl ? 1 : 0.6, fontWeight: 700, letterSpacing: '0.08em' }}
            >Pay with GPay</a>
          </div>

          {/* Crypto */}
          <div style={{ fontSize: '0.55rem', letterSpacing: '0.2em', color: '#666', textTransform: 'uppercase', marginBottom: 8 }}>
            Crypto Wallets
          </div>
          {CRYPTO_ADDRESSES.map(c => (
            <CryptoRow key={c.symbol} {...c} />
          ))}
          <div style={{ fontSize: '0.5rem', color: '#333', marginTop: 10, letterSpacing: '0.1em', textAlign: 'center' }}>
            Click COPY to copy the address to your clipboard
          </div>
        </Section>

        {/* Version */}
        <div style={{ textAlign: 'center', fontSize: '0.55rem', color: '#333', letterSpacing: '0.2em', marginTop: '0.5rem' }}>
          {typeof __APP_VERSION__ !== 'undefined' ? `v${__APP_VERSION__}` : ''} · Tetra Overflow Ultra
        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#12121e', border: '1px solid #22c55e', borderRadius: 8, padding: '10px 20px', color: '#22c55e', fontSize: '0.8rem', letterSpacing: '0.08em', zIndex: 500, whiteSpace: 'nowrap' }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
