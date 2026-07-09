import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import SettingsPage from '../components/SettingsPage'
import { hardResetAndReload } from '../logic/hardReset'
import leaderboardIconUrl from '../icons/leaderboard-button.png'
import playIconUrl from '../icons/play-button.png'
import settingsIconUrl from '../icons/settings-button.png'
import soundIconUrl from '../icons/sound-button.png'
import storyIconUrl from '../icons/story-button.png'
import storeIconUrl from '../icons/store-button.png'

// ─── Falling tetromino background ─────────────────────────────────────────────
const BG_SHAPES = [
  [[1,1,1,1]],
  [[1,1],[1,1]],
  [[0,1,0],[1,1,1]],
  [[1,0],[1,1],[0,1]],
  [[0,1],[1,1],[1,0]],
  [[1,0],[1,0],[1,1]],
  [[0,1],[0,1],[1,1]],
]
const BG_COLORS = ['#00d4ff', '#a855f7', '#f97316', '#22c55e', '#eab308', '#ec4899', '#38bdf8']

function useFallingPieces() {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId
    const pieces = []
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight }
    resize()
    window.addEventListener('resize', resize)

    let frame = 0
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      frame++
      if (frame % 70 === 0 && pieces.length < 22) {
        const idx = Math.floor(Math.random() * BG_SHAPES.length)
        const sz = 20 + Math.random() * 18
        pieces.push({
          x: Math.random() * canvas.width,
          y: -sz * 4,
          vx: (Math.random() - 0.5) * 0.4,
          vy: 0.35 + Math.random() * 0.55,
          shape: BG_SHAPES[idx],
          color: BG_COLORS[idx],
          opacity: 0.05 + Math.random() * 0.07,
          sz,
        })
      }
      for (let i = pieces.length - 1; i >= 0; i--) {
        const p = pieces[i]
        p.y += p.vy; p.x += p.vx
        ctx.globalAlpha = p.opacity
        ctx.fillStyle = p.color
        for (let r = 0; r < p.shape.length; r++)
          for (let c = 0; c < p.shape[r].length; c++)
            if (p.shape[r][c]) ctx.fillRect(Math.round(p.x + c * (p.sz + 1)), Math.round(p.y + r * (p.sz + 1)), Math.round(p.sz - 1), Math.round(p.sz - 1))
        ctx.globalAlpha = 1
        if (p.y > canvas.height + p.sz * 5) pieces.splice(i, 1)
      }
      animId = requestAnimationFrame(tick)
    }
    tick()
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize) }
  }, [])
  return canvasRef
}

// ─── Main menu items ───────────────────────────────────────────────────────────
const MENU_ITEMS = [
  { label: 'SOLO',     sub: 'CLASSIC PLAY',   iconSrc: playIconUrl,       path: '/play',        color: '#00d4ff', public: true },
  { label: 'STORY',    sub: 'CAMPAIGN',        iconSrc: storyIconUrl,  path: '/story',       color: '#a855f7' },
  { label: 'VERSUS',   sub: 'ONLINE MATCH',    icon: '⚡', path: '/multiplayer', color: '#f97316' },
  { label: 'THEMES',   sub: 'WORLD + PIECES',  icon: '◉',  path: '/themes',      color: '#e879f9' },
  { label: 'STORE',    sub: 'SHOP',            iconSrc: storeIconUrl,  path: '/store',       color: '#22c55e' },
  { label: 'STATS',    sub: 'LEADERBOARD',     iconSrc: leaderboardIconUrl, path: '/stats',      color: '#eab308' },
  { label: 'LORE',     sub: 'STORY TEXTS',     icon: '✦',  path: '/lore',        color: '#22c55e' },
  { label: 'SOUNDTRACK', sub: 'VOTE TRACKS',   iconSrc: soundIconUrl,    path: '/artwork',     color: '#ec4899', public: true },
  { label: 'SETTINGS', sub: 'CONTROLS · AUDIO', iconSrc: settingsIconUrl, action: 'settings', color: '#94a3b8', public: true },
]

const CONFIG_KEY = 'tetris-config'
const DEFAULT_CONFIG = { sfxEnabled: true, hapticEnabled: true, musicVolume: 1.0, sfxVolume: 2.0, das: 110, arr: 25, showOnScreenControls: false }
const loadConfig = () => {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}') } }
  catch { return { ...DEFAULT_CONFIG } }
}

// ─── Components ───────────────────────────────────────────────────────────────
function MenuCard({ item, index, onClick }) {
  const [hovered, setHovered] = useState(false)
  return (
    <motion.button
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index, duration: 0.35, ease: 'easeOut' }}
      whileHover={{ scale: 1.03, y: -2 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? `color-mix(in srgb, ${item.color} 10%, transparent)` : 'rgba(255,255,255,0.03)',
        border: `1px solid ${hovered ? item.color : 'rgba(255,255,255,0.09)'}`,
        borderRadius: 12,
        color: '#fff',
        cursor: 'pointer',
        padding: '1.2rem 1rem',
        textAlign: 'left',
        transition: 'all 0.18s ease',
        boxShadow: hovered ? `0 0 24px ${item.color}28, inset 0 0 12px ${item.color}08` : 'none',
        outline: 'none',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ fontSize: '1.5rem', marginBottom: 6, color: item.color, lineHeight: 1 }}>
        {item.iconSrc ? (
          <img src={item.iconSrc} alt="" style={{ width: 24, height: 24, objectFit: 'contain', display: 'block', filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.08))' }} />
        ) : item.icon}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: '1rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: hovered ? item.color : '#eee', transition: 'color 0.18s' }}>
          {item.label}
        </div>
        {item.label === 'SOLO' && (
          <span style={{ fontSize: '0.58rem', color: '#eab308', letterSpacing: '0.08em', border: '1px solid rgba(234,179,8,0.45)', borderRadius: 10, padding: '1px 6px', background: 'rgba(234,179,8,0.08)', textTransform: 'uppercase' }}>2× coins</span>
        )}
      </div>
      <div style={{ fontSize: '0.62rem', color: '#555', letterSpacing: '0.18em', marginTop: 3, textTransform: 'uppercase' }}>{item.sub}</div>
    </motion.button>
  )
}

function UserDropdown({ displayName, coins: _coins, onStats, onStore, onSignOut }) {
  return (
    <div style={{ position: 'absolute', right: 0, top: '110%', background: '#12121e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '6px', minWidth: 170, zIndex: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
      <div style={{ padding: '8px 10px 4px', fontSize: '0.7rem', color: '#555', letterSpacing: '0.12em', borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: 4 }}>
        {displayName.toUpperCase()}
      </div>
      {[
        { label: '📊  Stats', onClick: onStats },
        { label: '🛒  Store', onClick: onStore },
      ].map(item => (
        <button key={item.label} onClick={item.onClick} style={dropBtnStyle}>{item.label}</button>
      ))}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 4, paddingTop: 4 }}>
        <button onClick={onSignOut} style={{ ...dropBtnStyle, color: '#f87171' }}>Sign Out</button>
      </div>
    </div>
  )
}

const dropBtnStyle = {
  display: 'block', width: '100%', textAlign: 'left',
  background: 'none', border: 'none', color: '#ccc',
  padding: '7px 10px', fontSize: '0.82rem', cursor: 'pointer',
  borderRadius: 6, fontFamily: 'monospace',
  transition: 'background 0.12s',
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MainMenuPage() {
  const navigate = useNavigate()
  const { user, userProfile, loading, signOut } = useAuth()
  const canvasRef = useFallingPieces()
  const [showDrop, setShowDrop] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [config, setConfig] = useState(loadConfig)

  // Persist config changes to localStorage
  useEffect(() => { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)) }, [config])

  const displayName = userProfile?.displayName || user?.displayName || (user?.isAnonymous ? 'GUEST' : 'PLAYER')
  const coins = userProfile?.coins ?? 0

  const handleNav = (item) => {
    if (item.action === 'settings') { setShowSettings(true); return }
    if (!item.public && !user) { navigate('/auth'); return }
    navigate(item.path)
  }

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDrop) return
    const close = (e) => { if (!e.target.closest('[data-user-menu]')) setShowDrop(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showDrop])

  const handleHardRefresh = useCallback(async () => {
    await hardResetAndReload()
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a14', display: 'flex', flexDirection: 'column', fontFamily: '"Courier New", monospace', overflow: 'hidden' }}>
      {/* Animated background */}
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />

      {/* Gradient vignette */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, transparent 40%, #0a0a14 100%)', pointerEvents: 'none' }} />

      {/* Header */}
      <header style={{ position: 'relative', zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'calc(env(safe-area-inset-top, 0px) + 0.85rem) 1.4rem 0.85rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ fontSize: '0.65rem', letterSpacing: '0.22em', color: '#444' }}>
          {typeof __APP_VERSION__ !== 'undefined' ? `v${__APP_VERSION__}` : ''}
        </div>
        {loading ? null : user ? (
          <div style={{ position: 'relative' }} data-user-menu>
            <button
              onClick={() => setShowDrop(v => !v)}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', fontSize: '0.82rem', fontFamily: 'inherit' }}
            >
              <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#00d4ff,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 900, flexShrink: 0 }}>
                {displayName[0].toUpperCase()}
              </span>
              <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
              <span style={{ color: '#eab308', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>◆ {coins.toLocaleString()}</span>
            </button>
            <AnimatePresence>
              {showDrop && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
                  <UserDropdown
                    displayName={displayName}
                    coins={coins}
                    onStats={() => { setShowDrop(false); navigate('/stats') }}
                    onStore={() => { setShowDrop(false); navigate('/store') }}
                    onSignOut={() => { setShowDrop(false); signOut() }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <button onClick={() => navigate('/auth')} style={{ background: 'transparent', border: '1px solid #00d4ff', color: '#00d4ff', borderRadius: 6, padding: '5px 14px', fontSize: '0.75rem', cursor: 'pointer', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'inherit' }}>
            SIGN IN
          </button>
        )}
      </header>

      {/* Center content */}
      <main style={{ position: 'relative', zIndex: 10, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', gap: '2rem', overflowY: 'auto' }}>
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          style={{ textAlign: 'center', userSelect: 'none' }}
        >
          <h1 style={{ margin: 0, fontSize: 'clamp(2rem, 7vw, 4rem)', fontWeight: 900, letterSpacing: '0.06em', lineHeight: 1, textTransform: 'uppercase', background: 'linear-gradient(135deg, #00d4ff 0%, #a855f7 60%, #f97316 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            TETRA<br />OVERFLOW
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: '0.62rem', letterSpacing: '0.35em', color: '#555', textTransform: 'uppercase' }}>ULTRA</p>
        </motion.div>

        {/* Welcome */}
        {user && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            style={{ fontSize: '0.72rem', letterSpacing: '0.14em', color: '#555', textTransform: 'uppercase' }}
          >
            WELCOME BACK, <span style={{ color: '#ccc' }}>{displayName}</span>
          </motion.div>
        )}

        {/* Nav grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.65rem', width: '100%', maxWidth: 680 }}>
          {MENU_ITEMS.map((item, i) => (
            <MenuCard key={item.label} item={item} index={i} onClick={() => handleNav(item)} />
          ))}
        </div>

        {/* Guest notice */}
        {!user && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            style={{ fontSize: '0.68rem', color: '#444', letterSpacing: '0.1em', textAlign: 'center', margin: 0 }}
          >
            Sign in to save progress, earn coins & access Story Mode.{' '}
            <button onClick={() => navigate('/auth')} style={{ background: 'none', border: 'none', color: '#00d4ff', cursor: 'pointer', padding: 0, fontSize: 'inherit', fontFamily: 'inherit', textDecoration: 'underline' }}>
              Sign in
            </button>
          </motion.p>
        )}
      </main>

      {/* Footer */}
      <footer style={{ position: 'relative', zIndex: 10, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1.5rem', padding: '0.65rem 0.65rem calc(env(safe-area-inset-bottom, 0px) + 0.65rem)', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '0.62rem', color: '#444', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        <span>Tetra Overflow Ultra</span>
        <button
          onClick={() => navigate('/info')}
          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'inherit', padding: 0 }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', border: '1px solid currentColor', fontSize: 10, fontWeight: 700, lineHeight: 1 }}>i</span><span>Info</span></span>
        </button>
      </footer>

      {showSettings && (
        <SettingsPage
          config={config}
          onConfig={setConfig}
          onClearCache={handleHardRefresh}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
