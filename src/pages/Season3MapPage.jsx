import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { getStoryProgress } from '../firebase/db'
import { SEASON3_EPOCHS, isS3Unlocked, isEpochUnlocked, isS3LevelUnlocked, isS3Complete } from '../logic/storyData_s3'
import { playTap, playBack, playTypeClick, playGlitchBurst } from '../audio/uiSfx'
import homeIconUrl from '../icons/home-button.png'

// ── Pseudo-random helpers ────────────────────────────────────────────────────
const pseudo = (n) => {
  const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return v - Math.floor(v)
}

// Fracture crack geometry — jagged polylines radiating outward
const CRACKS = Array.from({ length: 18 }).map((_, i) => {
  const ox = 20 + pseudo(i * 3 + 1) * 60
  const oy = 10 + pseudo(i * 3 + 2) * 80
  const segs = 3 + Math.floor(pseudo(i * 3 + 3) * 4)
  let pts = `${ox},${oy}`
  let cx = ox, cy = oy
  for (let s = 0; s < segs; s++) {
    const ang = pseudo(i * 7 + s) * Math.PI * 2
    const len = 3 + pseudo(i * 5 + s + 1) * 12
    cx += Math.cos(ang) * len
    cy += Math.sin(ang) * len
    pts += ` ${cx.toFixed(1)},${cy.toFixed(1)}`
  }
  return {
    id: i, pts,
    color: ['#ff000033', '#00ffff22', '#ff007f22', '#ffffff18'][i % 4],
    dur: 3 + pseudo(i * 2) * 4,
    delay: pseudo(i + 9) * 2.5,
    w: 0.15 + pseudo(i * 4) * 0.35,
  }
})

// Digital noise particles
const GLITCH_DOTS = Array.from({ length: 80 }).map((_, i) => ({
  id: i,
  x: pseudo(i * 3) * 100,
  y: pseudo(i * 3 + 1) * 100,
  w: 0.4 + pseudo(i * 3 + 2) * 2.5,
  h: 0.08 + pseudo(i * 4) * 0.18,
  color: ['#ff0000', '#00ffff', '#ff007f', '#ffaa00', '#ffffff'][i % 5],
  o: 0.04 + pseudo(i * 5) * 0.18,
  dur: 0.5 + pseudo(i * 7) * 2,
  delay: pseudo(i * 11) * 3,
}))

// Animated epoch connector with energy-pulse effect
function FractureLines({ epochs }) {
  return (
    <>
      {epochs.slice(0, -1).map((ep, i) => {
        const next = epochs[i + 1]
        const midX = (ep.mapX + next.mapX) / 2 + (pseudo(i * 9) - 0.5) * 8
        const midY = (ep.mapY + next.mapY) / 2 + (pseudo(i * 9 + 1) - 0.5) * 8
        return (
          <g key={ep.id}>
            {/* Jagged fracture path instead of straight line */}
            <motion.polyline
              points={`${ep.mapX},${ep.mapY} ${midX},${midY} ${next.mapX},${next.mapY}`}
              fill="none"
              stroke={`${ep.color}55`}
              strokeWidth="0.45"
              strokeDasharray="1.8,1.4"
              animate={{ strokeDashoffset: [0, -10] }}
              transition={{ duration: 2 + i * 0.6, repeat: Infinity, ease: 'linear' }}
            />
            {/* Energy pulse dot travelling along path */}
            <motion.circle
              r="0.7" fill={ep.color} opacity={0.9}
              animate={{
                cx: [ep.mapX, midX, next.mapX],
                cy: [ep.mapY, midY, next.mapY],
                opacity: [0, 0.9, 0],
              }}
              transition={{ duration: 2.2 + i * 0.4, repeat: Infinity, delay: i * 0.5, ease: 'easeInOut' }}
            />
          </g>
        )
      })}
    </>
  )
}

// Animated title: typewriter intro → periodic glitch bursts with SFX
function useAnimatedTitle(text) {
  const [display, setDisplay] = useState('')
  const [phase,   setPhase]   = useState('typing') // 'typing' | 'idle' | 'glitch'
  const GLITCH_CHARS = '!@#$%^&*<>?/\\|{}[]01'

  useEffect(() => {
    let frameIdx = 0
    let timeout
    let glitchInterval

    const clearAll = () => {
      clearTimeout(timeout)
      clearInterval(glitchInterval)
    }

    // Phase 1: character-by-character typewriter reveal
    const typeNext = () => {
      frameIdx++
      if (frameIdx <= text.length) {
        setDisplay(text.slice(0, frameIdx))
        playTypeClick()
        timeout = setTimeout(typeNext, 58 + Math.random() * 30)
      } else {
        setDisplay(text)
        setPhase('idle')
        timeout = setTimeout(startGlitch, 2600)
      }
    }

    // Phase 2: glitch burst then back to idle, loop
    const startGlitch = () => {
      setPhase('glitch')
      playGlitchBurst()
      let gFrame = 0
      const maxGFrames = 8
      glitchInterval = setInterval(() => {
        gFrame++
        if (gFrame >= maxGFrames) {
          clearInterval(glitchInterval)
          setDisplay(text)
          setPhase('idle')
          timeout = setTimeout(startGlitch, 3400 + Math.random() * 1200)
          return
        }
        // Corrupt ~25-40% of characters each frame
        const corrupt = 0.22 + Math.random() * 0.2
        setDisplay(
          text.split('').map(c =>
            c !== ' ' && Math.random() < corrupt
              ? GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]
              : c
          ).join('')
        )
      }, 55)
    }

    // Small boot delay before typing starts
    timeout = setTimeout(typeNext, 320)
    return () => clearAll()
  }, [text]) // eslint-disable-line

  return { display, phase }
}

function LevelItem({ epoch, level, levelIdx, progress, epochUnlocked, onPlay }) {
  const key         = `s3_${epoch.id}_${level.id}`
  const completed   = !!progress[`${key}_completed`]
  const bestLines   = progress[`${key}_lines`] || 0
  const unlocked    = epochUnlocked && isS3LevelUnlocked(epoch.id, level.id, progress)

  return (
    <button
      disabled={!unlocked}
      onClick={() => { if (unlocked) { playTap(); onPlay(epoch.id, level.id) } }}
      style={{
        background: completed ? `${epoch.color}14` : unlocked ? 'rgba(255,255,255,0.04)' : 'transparent',
        border: `1px solid ${completed ? epoch.color : unlocked ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'}`,
        borderRadius: 8, padding: '10px 12px',
        color: unlocked ? '#fff' : '#444',
        cursor: unlocked ? 'pointer' : 'not-allowed',
        display: 'flex', alignItems: 'center', gap: 10,
        fontFamily: 'inherit', textAlign: 'left', transition: 'all 0.15s',
        width: '100%',
      }}
    >
      <span style={{ fontSize: '1rem', flexShrink: 0 }}>
        {completed ? '✦' : unlocked ? (level.isBoss ? '⚡' : '▶') : '🔒'}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {level.title}
        </div>
        <div style={{ fontSize: '0.6rem', color: '#666', marginTop: 2 }}>{level.subtitle}</div>
        {completed && bestLines > 0 && (
          <div style={{ fontSize: '0.6rem', color: epoch.color, marginTop: 2 }}>Best: {bestLines} lines</div>
        )}
      </div>
      {level.isBoss && (
        <span style={{ fontSize: '0.52rem', color: '#f97316', letterSpacing: '0.14em', border: '1px solid #f97316', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
          BOSS
        </span>
      )}
    </button>
  )
}

function EpochPanel({ epoch, epIdx, progress, onSelectLevel, onClose }) {
  const epochUnlocked = isEpochUnlocked(epoch.id, progress)
  const epicScore = Number(progress?.[`s3_${epoch.id}_chapter_score`] || 0)
  const epicLines = Number(progress?.[`s3_${epoch.id}_chapter_lines`] || 0)
  const levelsDone = epoch.levels.filter(l => !!progress[`s3_${epoch.id}_${l.id}_completed`]).length

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.88, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 10 }}
      onClick={e => e.stopPropagation()}
      style={{
        background: 'linear-gradient(160deg, #0d0015 0%, #080010 100%)',
        border: `1px solid ${epoch.color}66`,
        boxShadow: `0 0 0 1px rgba(0,0,0,0.8), 0 0 40px ${epoch.color}44, inset 0 0 60px rgba(0,0,0,0.5)`,
        borderRadius: 12, padding: '1.6rem',
        width: 'min(92vw, 360px)',
        display: 'flex', flexDirection: 'column', gap: 14,
        fontFamily: '"Courier New", monospace',
        backdropFilter: 'blur(16px)',
      }}
    >
      {/* Epoch header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontSize: '0.5rem', color: epoch.color, letterSpacing: '0.3em', textTransform: 'uppercase', marginBottom: 3 }}>
            Season 3 · Epoch {epIdx + 1}
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 900, letterSpacing: '0.1em', color: epoch.color }}>
            {epoch.title}
          </div>
          <div style={{ fontSize: '0.64rem', color: '#666', marginTop: 3 }}>{epoch.subtitle}</div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: '1px solid rgba(255,255,255,0.14)', color: '#555', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'inherit', flexShrink: 0 }}
        >✕</button>
      </div>

      {!epochUnlocked && (
        <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: '0.66rem', color: '#555', letterSpacing: '0.1em' }}>
          🔒 Complete the previous Epoch to unlock
        </div>
      )}

      {/* Stats */}
      {(epicScore > 0 || epicLines > 0) && (
        <div style={{ display: 'flex', gap: 14, fontSize: '0.6rem', color: '#888', letterSpacing: '0.08em' }}>
          <span>Score <strong style={{ color: epoch.color }}>{epicScore.toLocaleString()}</strong></span>
          <span>Lines <strong style={{ color: '#ccc' }}>{epicLines.toLocaleString()}</strong></span>
          <span>Progress <strong style={{ color: '#ccc' }}>{levelsDone}/{epoch.levels.length}</strong></span>
        </div>
      )}

      {/* Level list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {epoch.levels.map((lv, lvIdx) => (
          <LevelItem
            key={lv.id}
            epoch={epoch}
            level={lv}
            levelIdx={lvIdx}
            progress={progress}
            epochUnlocked={epochUnlocked}
            onPlay={onSelectLevel}
          />
        ))}
      </div>
    </motion.div>
  )
}

export default function Season3MapPage() {
  const navigate = useNavigate()
  const { user }  = useAuth()
  const mapViewportRef = useRef(null)
  const gestureRef = useRef({ mode: 'none', lastX: 0, lastY: 0, startDist: 0, startZoom: 1 })
  const [progress, setProgress]   = useState({})
  const [loading,  setLoading]    = useState(true)
  const [selected, setSelected]   = useState(null)   // epoch id
  const autoSelectedRef = useRef(false)
  const [mapZoom,  setMapZoom]    = useState(1.02)
  // Pan in percentage units (like S2) so it’s resolution-independent
  const [userPan,  setUserPan]    = useState({ x: 0, y: 0 })
  const { display: titleDisplay, phase: titlePhase } = useAnimatedTitle('TEMPORAL FRACTURE')

  useEffect(() => {
    if (!user) return
    getStoryProgress(user.uid).then(p => { setProgress(p || {}); setLoading(false) })
  }, [user])

  const s3Unlocked = useMemo(() => isS3Unlocked(progress), [progress])
  const s3Complete = useMemo(() => isS3Complete(progress), [progress])

  const firstUnlockedLevel = useMemo(() => {
    for (const epoch of SEASON3_EPOCHS) {
      if (!isEpochUnlocked(epoch.id, progress)) continue
      for (const level of epoch.levels) {
        if (isS3LevelUnlocked(epoch.id, level.id, progress) && !progress[`s3_${epoch.id}_${level.id}_completed`]) {
          return { epochId: epoch.id, levelId: level.id }
        }
      }
    }
    // If everything is complete, fall back to the very first level.
    const fallbackEpoch = SEASON3_EPOCHS[0]
    return fallbackEpoch ? { epochId: fallbackEpoch.id, levelId: fallbackEpoch.levels[0]?.id } : null
  }, [progress])

  useEffect(() => {
    if (!s3Unlocked || autoSelectedRef.current) return
    const firstEpoch = SEASON3_EPOCHS.find(e => isEpochUnlocked(e.id, progress))
    if (firstEpoch) { autoSelectedRef.current = true; setSelected(firstEpoch.id) }
  }, [s3Unlocked, progress])

  const handleSelectLevel = (epochId, levelId) => {
    navigate(`/s3/${epochId}/${levelId}`)
  }

  // ── Zoom/pan helpers (match S2 behavior) ─────────────────────────────────
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
  const clampZoom = (z) => Math.max(0.9, Math.min(2.2, z))
  const clampPanByZoom = (pan, zoom) => {
    const maxX = Math.max(0, (zoom - 1) * 45)
    const maxY = Math.max(0, (zoom - 1) * 55)
    return { x: clamp(pan.x, -maxX, maxX), y: clamp(pan.y, -maxY, maxY) }
  }
  const zoomIn  = () => setMapZoom(z => clampZoom(z + 0.1))
  const zoomOut = () => setMapZoom(z => clampZoom(z - 0.1))
  const resetZoom = () => { setSelected(null); setMapZoom(1.02); setUserPan({ x: 0, y: 0 }) }

  // Re-clamp pan when zoom changes
  useEffect(() => { setUserPan(p => clampPanByZoom(p, mapZoom)) }, [mapZoom])

  // ── Gesture handlers (pan / pinch-zoom on the map) ─────────────────────────
  useEffect(() => {
    const el = mapViewportRef.current
    if (!el) return

    const onPointerDown = (e) => {
      const touches = e.currentTarget._activePointers = e.currentTarget._activePointers || new Map()
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.size === 1) {
        gestureRef.current = { mode: 'pan', lastX: e.clientX, lastY: e.clientY, startDist: 0, startZoom: mapZoom }
      } else if (touches.size === 2) {
        const pts = [...touches.values()]
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
        gestureRef.current = { mode: 'pinch', lastX: 0, lastY: 0, startDist: dist, startZoom: mapZoom }
      }
      el.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e) => {
      const touches = e.currentTarget._activePointers
      if (!touches) return
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const g = gestureRef.current
      if (g.mode === 'pan' && touches.size === 1) {
        const dx = e.clientX - g.lastX
        const dy = e.clientY - g.lastY
        g.lastX = e.clientX; g.lastY = e.clientY
        const rect = el.getBoundingClientRect()
        const panDx = (dx / Math.max(1, rect.width)) * 100
        const panDy = (dy / Math.max(1, rect.height)) * 100
        setUserPan(p => clampPanByZoom({ x: p.x + panDx, y: p.y + panDy }, mapZoom))
      } else if (g.mode === 'pinch' && touches.size === 2) {
        const pts = [...touches.values()]
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
        const newZoom = clampZoom(g.startZoom * (dist / Math.max(1, g.startDist)))
        setMapZoom(newZoom)
      }
    }

    const onPointerUp = (e) => {
      const touches = e.currentTarget._activePointers
      if (touches) touches.delete(e.pointerId)
      gestureRef.current.mode = 'none'
      el.releasePointerCapture(e.pointerId)
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
    }
  }, [mapZoom])

  const handleWheel = (e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.06 : 0.06
    setMapZoom(z => clampZoom(z + delta))
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: '#03000a', color: '#ff3355', fontFamily: 'monospace', fontSize: '0.9rem', letterSpacing: '0.18em' }}>
        LOADING…
      </div>
    )
  }

  if (!s3Unlocked) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: '#03000a', color: '#ff3355', fontFamily: '"Courier New", monospace', gap: 20, padding: '2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', filter: 'drop-shadow(0 0 16px #ff0050)' }}>⛔</div>
        <div style={{ fontSize: '1.1rem', fontWeight: 900, letterSpacing: '0.2em' }}>ACCESS DENIED</div>
        <div style={{ fontSize: '0.72rem', color: '#888', lineHeight: 1.6, maxWidth: 340 }}>
          Season 3: Temporal Fracture is locked.<br />
          Defeat the 13th Constellation — <strong style={{ color: '#ff0000' }}>Ophiuchus</strong> — to unlock the fracture.
        </div>
        <motion.button
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
          onClick={() => { playBack(); navigate('/zodiac') }}
          style={{ background: 'none', border: '1px solid rgba(255,0,0,0.4)', color: '#ff4444', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontSize: '0.78rem', letterSpacing: '0.18em', fontFamily: 'inherit', textTransform: 'uppercase' }}
        >
          ← Return to Zodiac
        </motion.button>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#03000a', fontFamily: '"Courier New", monospace' }}>

      {/* ── Layer 1: deep void gradient ─────────────────────────────────── */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 120% 80% at 50% 60%, #1a0020 0%, #050008 55%, #03000a 100%)',
      }} />

      {/* ── Layer 2: animated fracture cracks ─────────────────────────── */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        {CRACKS.map(c => (
          <motion.polyline
            key={c.id} points={c.pts} fill="none"
            stroke={c.color} strokeWidth={c.w}
            animate={{ opacity: [0.2, 0.9, 0.2], strokeDashoffset: [0, 40] }}
            strokeDasharray="3,2"
            transition={{ duration: c.dur, repeat: Infinity, delay: c.delay, ease: 'easeInOut' }}
          />
        ))}
      </svg>

      {/* ── Layer 3: glitch / digital-noise rectangles ─────────────────── */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        {GLITCH_DOTS.map(d => (
          <motion.rect
            key={d.id} x={d.x} y={d.y} width={d.w} height={d.h}
            fill={d.color} opacity={d.o}
            animate={{ opacity: [0, d.o, 0], x: [d.x, d.x + (pseudo(d.id) - 0.5) * 1.5, d.x] }}
            transition={{ duration: d.dur, repeat: Infinity, delay: d.delay, ease: 'linear' }}
          />
        ))}
      </svg>

      {/* ── Layer 4: horizontal scan-line overlay ─────────────────────── */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.22) 3px, rgba(0,0,0,0.22) 4px)',
        mixBlendMode: 'multiply',
      }} />

      {/* ── Layer 5: vignette ─────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 90% 90% at 50% 50%, transparent 40%, rgba(0,0,0,0.75) 100%)',
      }} />

      {/* ── Layer 6: epoch accent glow spots ──────────────────────────── */}
      {SEASON3_EPOCHS.map(ep => (
        <motion.div
          key={ep.id}
          style={{
            position: 'absolute',
            left: `${ep.mapX}%`, top: `${ep.mapY}%`,
            width: 120, height: 120,
            marginLeft: -60, marginTop: -60,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${ep.color}18 0%, transparent 70%)`,
            pointerEvents: 'none',
          }}
          animate={{ opacity: [0.5, 1, 0.5], scale: [0.9, 1.15, 0.9] }}
          transition={{ duration: 4 + Math.random() * 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'max(12px, env(safe-area-inset-top, 12px)) 16px 10px', background: 'rgba(3,0,10,0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,0,80,0.18)' }}>
        <div>
          <div style={{ fontSize: '0.46rem', color: '#ff3355', letterSpacing: '0.36em', textTransform: 'uppercase', marginBottom: 2, opacity: 0.8 }}>⚡ STORY MODE — SEASON 3</div>
          <motion.div
            style={{ fontSize: '1.05rem', fontWeight: 900, letterSpacing: '0.14em', color: '#fff', textShadow: '0 0 18px rgba(255,0,80,0.55), 0 0 4px rgba(0,255,255,0.3)', fontFamily: '"Courier New", monospace' }}
            animate={{ textShadow: titlePhase === 'glitch'
              ? ['0 0 32px rgba(255,0,80,0.9)', '0 0 20px rgba(0,255,255,0.8)', '0 0 40px rgba(255,0,80,1)']
              : ['0 0 18px rgba(255,0,80,0.55)', '0 0 28px rgba(0,255,255,0.45)', '0 0 18px rgba(255,0,80,0.55)'] }}
            transition={{ duration: titlePhase === 'glitch' ? 0.1 : 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            {titleDisplay}
            {/* blinking cursor shown during typing */}
            {titlePhase === 'typing' && (
              <motion.span
                style={{ display: 'inline-block', width: '0.55em', height: '1em', background: '#00ffff', marginLeft: 2, verticalAlign: 'text-bottom', borderRadius: 1 }}
                animate={{ opacity: [1, 0, 1] }}
                transition={{ duration: 0.55, repeat: Infinity, ease: 'linear' }}
              />
            )}
          </motion.div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {firstUnlockedLevel && (
            <motion.button
              whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.95 }}
              onClick={() => {
                playTap()
                navigate(`/s3/${firstUnlockedLevel.epochId}/${firstUnlockedLevel.levelId}`)
              }}
              style={{
                background: 'rgba(255,0,80,0.12)',
                border: '1px solid rgba(255,0,80,0.45)',
                color: '#ff6b9b',
                borderRadius: 8,
                padding: '6px 10px',
                cursor: 'pointer',
                fontSize: '0.56rem',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                fontFamily: 'inherit',
                fontWeight: 800,
              }}
            >
              {s3Complete ? 'Replay' : 'Continue'}
            </motion.button>
          )}
          {s3Complete && (
            <span style={{ fontSize: '0.5rem', color: '#ff0000', letterSpacing: '0.2em', border: '1px solid #ff000066', borderRadius: 4, padding: '2px 8px' }}>COMPLETE ✦</span>
          )}
          <motion.button
            whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
            onClick={() => { playBack(); navigate('/zodiac') }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
          >
            <img src={homeIconUrl} alt="Home" style={{ width: 28, height: 28, opacity: 0.8, filter: 'drop-shadow(0 0 6px #ff333399)' }} />
          </motion.button>
        </div>
      </div>

      {/* ── Epoch progress bar with fracture colour sweep ─────────────── */}
      <div style={{ position: 'absolute', top: 'calc(max(12px, env(safe-area-inset-top, 12px)) + 46px)', left: 0, right: 0, height: 4, zIndex: 10, background: 'rgba(255,255,255,0.05)' }}>
        {(() => {
          const total = SEASON3_EPOCHS.reduce((sum, e) => sum + e.levels.length, 0)
          const done  = SEASON3_EPOCHS.reduce((sum, e) => sum + e.levels.filter(l => !!progress[`s3_${e.id}_${l.id}_completed`]).length, 0)
          return (
            <motion.div
              style={{ height: '100%', background: 'linear-gradient(90deg, #00ffff, #ff007f, #ff0000)', borderRadius: 2, boxShadow: '0 0 8px rgba(255,0,80,0.6)' }}
              animate={{ width: `${(done / total) * 100}%` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            />
          )
        })()}
      </div>

      {/* Map viewport */}
      <div
        ref={mapViewportRef}
        style={{ position: 'absolute', inset: 0, top: 'calc(max(12px, env(safe-area-inset-top, 12px)) + 49px)', overflow: 'hidden', cursor: 'grab', touchAction: 'none' }}
        onClick={() => setSelected(null)}
        onWheel={handleWheel}
      >
        {/* Zoom controls (top-right) */}
        <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 10px)', right: 'calc(env(safe-area-inset-right, 0px) + 10px)', zIndex: 26, display: 'flex', gap: 6 }}>
          <button
            onClick={(e) => { e.stopPropagation(); zoomOut() }}
            onTouchStart={(e) => e.stopPropagation()}
            style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.2)', color: '#c7d2fe', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}
            aria-label="Zoom out"
            title="Zoom out"
          >−</button>
          <button
            onClick={(e) => { e.stopPropagation(); zoomIn() }}
            onTouchStart={(e) => e.stopPropagation()}
            style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.2)', color: '#c7d2fe', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}
            aria-label="Zoom in"
            title="Zoom in"
          >+</button>
          <button
            onClick={(e) => { e.stopPropagation(); resetZoom() }}
            onTouchStart={(e) => e.stopPropagation()}
            style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.2)', color: '#9ca3af', borderRadius: 6, padding: '0 8px', height: 28, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.62rem', letterSpacing: '0.08em' }}
            aria-label="Reset zoom"
            title="Reset zoom"
          >RESET</button>
        </div>

        <motion.div
          animate={{ scale: mapZoom, x: `${userPan.x}%`, y: `${userPan.y}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          style={{ position: 'absolute', inset: 0, transformOrigin: '50% 50%', touchAction: 'none', userSelect: 'none' }}
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height: '100%' }}
          >
          <FractureLines epochs={SEASON3_EPOCHS} />

          {SEASON3_EPOCHS.map((epoch, epIdx) => {
            const epochUnlocked = isEpochUnlocked(epoch.id, progress)
            const totalLevels   = epoch.levels.length
            const doneCount     = epoch.levels.filter(l => !!progress[`s3_${epoch.id}_${l.id}_completed`]).length
            const epochComplete = doneCount === totalLevels
            const isSelected    = selected === epoch.id

            return (
              <g key={epoch.id} style={{ cursor: epochUnlocked ? 'pointer' : 'default' }}
                onClick={e => {
                  e.stopPropagation()
                  if (epochUnlocked) {
                    playTap()
                    setSelected(selected === epoch.id ? null : epoch.id)
                  }
                }}
              >
                {/* Outer shatter-ring (double pulse) */}
                {epochUnlocked && !epochComplete && (
                  <>
                    <motion.circle cx={epoch.mapX} cy={epoch.mapY} r={4.5} fill="none" stroke={epoch.color} strokeWidth="0.25" opacity={0.5}
                      animate={{ r: [4.5, 7.5], opacity: [0.5, 0] }}
                      transition={{ duration: 2.0, repeat: Infinity, ease: 'easeOut', delay: epIdx * 0.4 }}
                    />
                    <motion.circle cx={epoch.mapX} cy={epoch.mapY} r={4.5} fill="none" stroke={epoch.color} strokeWidth="0.15" opacity={0.3}
                      animate={{ r: [4.5, 9], opacity: [0.3, 0] }}
                      transition={{ duration: 2.0, repeat: Infinity, ease: 'easeOut', delay: epIdx * 0.4 + 0.5 }}
                    />
                  </>
                )}
                {/* Hexagonal fracture border via polygon */}
                <motion.polygon
                  points={`${epoch.mapX},${epoch.mapY - 4.5} ${epoch.mapX + 3.9},${epoch.mapY - 2.25} ${epoch.mapX + 3.9},${epoch.mapY + 2.25} ${epoch.mapX},${epoch.mapY + 4.5} ${epoch.mapX - 3.9},${epoch.mapY + 2.25} ${epoch.mapX - 3.9},${epoch.mapY - 2.25}`}
                  fill={epochUnlocked ? `${epoch.color}22` : '#111'}
                  stroke={epochUnlocked ? epoch.color : '#333'}
                  strokeWidth={isSelected ? 0.55 : 0.28}
                  opacity={epochUnlocked ? 1 : 0.35}
                  animate={{ opacity: epochUnlocked ? (isSelected ? 1 : 0.85) : 0.35 }}
                  filter={isSelected ? `drop-shadow(0 0 3px ${epoch.color})` : undefined}
                  transition={{ duration: 0.2 }}
                />
                {/* Inner circle fill */}
                <circle cx={epoch.mapX} cy={epoch.mapY} r={2.8}
                  fill={epochUnlocked ? epoch.color : '#1a1a1a'}
                  opacity={epochUnlocked ? 0.9 : 0.3}
                />
                {/* Completion star */}
                {epochComplete && (
                  <text x={epoch.mapX} y={epoch.mapY + 0.9} textAnchor="middle" dominantBaseline="middle" fontSize="3.2" fill="#000">✦</text>
                )}
                {/* Lock icon */}
                {!epochUnlocked && (
                  <text x={epoch.mapX} y={epoch.mapY + 0.7} textAnchor="middle" dominantBaseline="middle" fontSize="2.8" fill="#444">🔒</text>
                )}
                {/* Epoch number badge */}
                {epochUnlocked && !epochComplete && (
                  <text x={epoch.mapX} y={epoch.mapY + 0.9} textAnchor="middle" dominantBaseline="middle" fontSize="2.8" fill="#000" fontWeight="900" fontFamily="Courier New">
                    {epIdx + 1}
                  </text>
                )}
                {/* Epoch label */}
                <text x={epoch.mapX} y={epoch.mapY + 7} textAnchor="middle" fontSize="2.1" fill={epochUnlocked ? epoch.color : '#333'} fontFamily="Courier New" fontWeight="900"
                  style={{ textShadow: epochUnlocked ? `0 0 6px ${epoch.color}` : 'none' }}>
                  {epoch.title}
                </text>
                <text x={epoch.mapX} y={epoch.mapY + 9.5} textAnchor="middle" fontSize="1.5" fill={epochUnlocked ? '#666' : '#2a2a2a'} fontFamily="Courier New">
                  {doneCount}/{totalLevels} LEVELS
                </text>
              </g>
            )
          })}
          </svg>
        </motion.div>
      </div>

      {/* Epoch panel overlay */}
      <AnimatePresence>
        {selected && (() => {
          const epIdx = SEASON3_EPOCHS.findIndex(e => e.id === selected)
          const epoch = SEASON3_EPOCHS[epIdx]
          if (!epoch) return null
          return (
            <motion.div
              key={selected}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 0 max(24px, env(safe-area-inset-bottom, 24px))' }}
              onClick={() => setSelected(null)}
            >
              <EpochPanel
                epoch={epoch}
                epIdx={epIdx}
                progress={progress}
                onSelectLevel={handleSelectLevel}
                onClose={() => setSelected(null)}
              />
            </motion.div>
          )
        })()}
      </AnimatePresence>
    </div>
  )
}
