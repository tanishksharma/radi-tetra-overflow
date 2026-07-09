import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { getStoryProgress } from '../firebase/db'
import { ZODIAC_BOSSES, OPHIUCHUS, allZodiacBeaten, ophiuchusBeaten, getZodiacPositions } from '../logic/storyData_s2'
import { playTap, playZoomIn, playBack } from '../audio/uiSfx'
import homeIconUrl from '../icons/home-button.png'

// Stars for the background (uniformly distributed across the full map)
const pseudo = (n) => {
  const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return v - Math.floor(v)
}

const STARS = Array.from({ length: 220 }).map((_, i) => {
  const x = 2 + pseudo(i * 2 + 1) * 96
  const y = 2 + pseudo(i * 2 + 2) * 96
  const base = 0.22 + (i % 6) * 0.09
  const driftX = (pseudo(i * 2 + 3) - 0.5) * 0.8
  const driftY = (pseudo(i * 2 + 4) - 0.5) * 1.15
  return {
    id: i,
    x,
    y,
    r: 0.05 + pseudo(i * 2 + 5) * 0.34,
    o: 0.08 + pseudo(i * 2 + 6) * 0.5,
    driftX,
    driftY,
    dur: 4.5 + pseudo(i * 2 + 7) * 5.5,
    delay: pseudo(i * 2 + 8) * 1.8,
    amp: base,
  }
})

// Always-on background stars (overscanned) so edges never look empty while panning/zooming
const BG_STARS = Array.from({ length: 260 }).map((_, i) => {
  const x = -8 + pseudo(i * 3 + 201) * 116
  const y = -8 + pseudo(i * 3 + 202) * 116
  return {
    id: i,
    x,
    y,
    r: 0.04 + pseudo(i * 3 + 203) * 0.22,
    o: 0.06 + pseudo(i * 3 + 204) * 0.28,
    driftX: (pseudo(i * 3 + 205) - 0.5) * 0.45,
    driftY: (pseudo(i * 3 + 206) - 0.5) * 0.65,
    dur: 5 + pseudo(i * 3 + 207) * 6,
    delay: pseudo(i * 3 + 208) * 1.6,
  }
})

// Constellation line decorations between adjacent zodiac nodes (cosmetic)
function ConstellationLines({ positions }) {
  // Draw lines between neighboring signs for a star-map feel
  const lines = []
  for (let i = 0; i < positions.length; i++) {
    const next = positions[(i + 1) % positions.length]
    lines.push(
      <motion.line
        key={i}
        x1={positions[i].x} y1={positions[i].y}
        x2={next.x} y2={next.y}
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="0.35"
        strokeDasharray="1.4,1.4"
        animate={{ strokeDashoffset: [0, -5] }}
        transition={{ duration: 3 + (i % 4) * 0.45, repeat: Infinity, ease: 'linear' }}
      />
    )
  }
  return <>{lines}</>
}

function BossCard({ boss, completed, onClose, onPlay }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.88, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 10 }}
      onClick={e => e.stopPropagation()}
      style={{
        background: '#0d0d1a',
        border: `1px solid ${boss.color}55`,
        boxShadow: `0 0 40px ${boss.color}33, 0 24px 80px rgba(0,0,0,0.6)`,
        borderRadius: 16,
        padding: '1.6rem',
        width: 'min(92vw, 340px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        fontFamily: '"Courier New", monospace',
      }}
    >
      {/* Boss header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          fontSize: '2.8rem',
          lineHeight: 1,
          filter: `drop-shadow(0 0 12px ${boss.color})`,
          flexShrink: 0,
        }}>
          {boss.glyph}
        </div>
        <div>
          <div style={{ fontSize: '0.5rem', color: boss.color, letterSpacing: '0.3em', textTransform: 'uppercase', marginBottom: 3 }}>
            Season 2 · Boss
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 900, letterSpacing: '0.1em', color: '#fff' }}>
            {boss.name}
          </div>
          <div style={{ fontSize: '0.64rem', color: '#666', marginTop: 2 }}>
            {boss.subtitle}
          </div>
        </div>
        {completed && (
          <div style={{ marginLeft: 'auto', fontSize: '1.4rem', filter: `drop-shadow(0 0 8px ${boss.color})` }}>
            ✦
          </div>
        )}
      </div>

      {/* Story intro (first line) */}
      <p style={{ color: '#bbb', fontSize: '0.72rem', lineHeight: 1.65, letterSpacing: '0.03em', margin: 0, fontStyle: 'italic', borderLeft: `2px solid ${boss.color}55`, paddingLeft: 10 }}>
        "{boss.storyBefore.split('.')[0]}."
      </p>

      {/* Boss ability */}
      <div style={{
        background: `${boss.color}0d`,
        border: `1px solid ${boss.color}33`,
        borderRadius: 8,
        padding: '8px 12px',
      }}>
        <div style={{ fontSize: '0.5rem', color: boss.color, letterSpacing: '0.26em', textTransform: 'uppercase', marginBottom: 4, fontWeight: 700 }}>
          ⚡ {boss.abilityLabel}
        </div>
        <div style={{ fontSize: '0.66rem', color: '#999', lineHeight: 1.5 }}>
          {boss.abilityDesc}
        </div>
      </div>

      {/* Target */}
      <div style={{ fontSize: '0.6rem', color: '#555', letterSpacing: '0.14em' }}>
        CLEAR 40 LINES &nbsp;·&nbsp; EASY: 32 LINES
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <motion.button
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
          onClick={() => { playTap(); onPlay() }}
          style={{
            flex: 1,
            background: boss.color,
            border: 'none',
            color: '#000',
            borderRadius: 8,
            padding: '10px 0',
            fontSize: '0.8rem',
            fontWeight: 900,
            letterSpacing: '0.18em',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textTransform: 'uppercase',
          }}
        >
          {completed ? 'REMATCH' : 'CHALLENGE'}
        </motion.button>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,0.14)',
            color: '#666',
            borderRadius: 8,
            padding: '10px 14px',
            cursor: 'pointer',
            fontSize: '0.72rem',
            fontFamily: 'inherit',
          }}
        >
          ✕
        </button>
      </div>
    </motion.div>
  )
}

export default function ZodiacMapPage() {
  const navigate   = useNavigate()
  const { user }   = useAuth()
  const mapViewportRef = useRef(null)
  const didAutoPickRef = useRef(false)
  const gestureRef = useRef({
    mode: 'none',
    lastX: 0,
    lastY: 0,
    startDist: 0,
    startZoom: 1,
  })
  const [progress, setProgress] = useState({})
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState(null)   // boss id string
  const [mapZoom, setMapZoom] = useState(1.02)
  const [cameraBossId, setCameraBossId] = useState(null)
  const [userPan, setUserPan] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!user) return
    getStoryProgress(user.uid).then(p => { setProgress(p); setLoading(false) })
  }, [user])

  const positions   = useMemo(() => getZodiacPositions(50, 50, 40), [])
  const allBeaten   = useMemo(() => allZodiacBeaten(progress), [progress])
  const ophiuchus13 = useMemo(() => ophiuchusBeaten(progress), [progress])

  const unclearedBosses = useMemo(
    () => ZODIAC_BOSSES.filter(b => !progress[`zodiac_${b.id}_completed`]),
    [progress]
  )

  const pickRandomUncleared = () => {
    if (!unclearedBosses.length) {
      setCameraBossId('ophiuchus')
      return
    }
    const idx = Math.floor(Math.random() * unclearedBosses.length)
    setCameraBossId(unclearedBosses[idx].id)
  }

  useEffect(() => {
    if (loading || didAutoPickRef.current) return
    if (unclearedBosses.length > 0) {
      const idx = Math.floor(Math.random() * unclearedBosses.length)
      setCameraBossId(unclearedBosses[idx].id)
    } else {
      setCameraBossId('ophiuchus')
    }
    didAutoPickRef.current = true
  }, [loading, unclearedBosses])

  const cameraTargetId = selected || cameraBossId
  const cameraPos = useMemo(() => {
    if (cameraTargetId === 'ophiuchus') return { x: 50, y: 50 }
    const idx = ZODIAC_BOSSES.findIndex(b => b.id === cameraTargetId)
    if (idx >= 0) return positions[idx]
    return { x: 50, y: 50 }
  }, [cameraTargetId, positions])

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
  const cameraShiftX = clamp((50 - cameraPos.x) * 0.55, -18, 18)
  const cameraShiftY = clamp((50 - cameraPos.y) * 0.65, -22, 22)

  const clampZoom = (z) => Math.max(0.9, Math.min(1.9, z))
  const zoomIn = () => setMapZoom(z => clampZoom(z + 0.1))
  const zoomOut = () => setMapZoom(z => clampZoom(z - 0.1))
  const resetZoom = () => {
    setSelected(null)
    setCameraBossId(null)
    setMapZoom(1.02)
    setUserPan({ x: 0, y: 0 })
  }

  const clampPanByZoom = (pan, zoom) => {
    const maxX = Math.max(0, (zoom - 1) * 45)
    const maxY = Math.max(0, (zoom - 1) * 55)
    return {
      x: clamp(pan.x, -maxX, maxX),
      y: clamp(pan.y, -maxY, maxY),
    }
  }

  useEffect(() => {
    setUserPan((p) => clampPanByZoom(p, mapZoom))
  }, [mapZoom])

  const selectedBoss = selected
    ? (selected === 'ophiuchus' ? OPHIUCHUS : ZODIAC_BOSSES.find(b => b.id === selected))
    : null

  const defeatedCount = ZODIAC_BOSSES.filter(b => !!progress[`zodiac_${b.id}_completed`]).length

  return (
    <div
      style={{ minHeight: '100dvh', background: '#070710', display: 'flex', flexDirection: 'column', fontFamily: '"Courier New", monospace', color: '#fff', overflow: 'hidden' }}
      onClick={() => setSelected(null)}
    >
      {/* ── Header ── */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(env(safe-area-inset-top, 0px) + 1rem) 1.4rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0, zIndex: 10, position: 'relative' }}>
        <button
          onClick={e => { e.stopPropagation(); playBack(); navigate('/story') }}
          style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '0.72rem', letterSpacing: '0.14em', fontFamily: 'inherit', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <img src={homeIconUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
          <span>SEASON 1</span>
        </button>

        <div style={{ textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 900, letterSpacing: '0.22em', background: 'linear-gradient(135deg, #a855f7, #00d4ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            THE ZODIAC ARC
          </h1>
          <div style={{ fontSize: '0.52rem', color: '#555', letterSpacing: '0.18em', marginTop: 2 }}>
            SEASON 2
          </div>
        </div>

        <div style={{ fontSize: '0.65rem', color: '#555', letterSpacing: '0.1em' }}>
          {defeatedCount}/12
          {ophiuchus13 && <span style={{ color: '#00ff99', marginLeft: 4 }}>+⛎</span>}
          {!allBeaten && defeatedCount > 0 && <span style={{ color: '#555', marginLeft: 4, fontSize: '0.55rem' }}>— beat all 12 to reveal the truth</span>}
        </div>
      </header>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: '0.8rem', letterSpacing: '0.2em' }}>
          LOADING…
        </div>
      ) : (
        <div
          ref={mapViewportRef}
          style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
          onTouchStart={(e) => {
            if (e.touches.length === 1) {
              const t = e.touches[0]
              gestureRef.current = { ...gestureRef.current, mode: 'pan', lastX: t.clientX, lastY: t.clientY }
            } else if (e.touches.length >= 2) {
              const a = e.touches[0]
              const b = e.touches[1]
              const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
              gestureRef.current = { ...gestureRef.current, mode: 'pinch', startDist: dist, startZoom: mapZoom }
            }
          }}
          onTouchMove={(e) => {
            if (!mapViewportRef.current) return
            if (gestureRef.current.mode === 'pinch' && e.touches.length >= 2) {
              e.preventDefault()
              const a = e.touches[0]
              const b = e.touches[1]
              const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
              const nextZoom = clampZoom(gestureRef.current.startZoom * (dist / Math.max(1, gestureRef.current.startDist)))
              setMapZoom(nextZoom)
              return
            }
            if (gestureRef.current.mode === 'pan' && e.touches.length === 1) {
              e.preventDefault()
              const t = e.touches[0]
              const dx = t.clientX - gestureRef.current.lastX
              const dy = t.clientY - gestureRef.current.lastY
              gestureRef.current.lastX = t.clientX
              gestureRef.current.lastY = t.clientY
              const rect = mapViewportRef.current.getBoundingClientRect()
              const panDx = (dx / Math.max(1, rect.width)) * 100
              const panDy = (dy / Math.max(1, rect.height)) * 100
              setUserPan((p) => clampPanByZoom({ x: p.x + panDx, y: p.y + panDy }, mapZoom))
            }
          }}
          onTouchEnd={() => {
            gestureRef.current.mode = 'none'
          }}
          onWheel={(e) => {
            e.preventDefault()
            const delta = e.deltaY > 0 ? -0.06 : 0.06
            setMapZoom(z => clampZoom(z + delta))
          }}
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid slice"
            style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}
          >
            {BG_STARS.map((star) => (
              <motion.circle
                key={`bg-${star.id}`}
                cx={star.x}
                cy={star.y}
                r={star.r}
                fill="white"
                animate={{
                  opacity: [star.o, Math.min(1, star.o + 0.2), star.o],
                  cx: [star.x, star.x + star.driftX, star.x],
                  cy: [star.y, star.y + star.driftY, star.y],
                }}
                transition={{ duration: star.dur, delay: star.delay, repeat: Infinity, ease: 'easeInOut' }}
              />
            ))}
          </svg>

          <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 10px)', right: 'calc(env(safe-area-inset-right, 0px) + 10px)', zIndex: 26, display: 'flex', gap: 6 }}>
            <button
              onClick={(e) => { e.stopPropagation(); zoomOut() }}
              style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.2)', color: '#c7d2fe', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}
              aria-label="Zoom out"
              title="Zoom out"
            >
              −
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); zoomIn() }}
              style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.2)', color: '#c7d2fe', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}
              aria-label="Zoom in"
              title="Zoom in"
            >
              +
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); resetZoom() }}
              style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.2)', color: '#9ca3af', borderRadius: 6, padding: '0 8px', height: 28, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.62rem', letterSpacing: '0.08em' }}
              aria-label="Reset zoom"
              title="Reset zoom"
            >
              RESET
            </button>
            {!!unclearedBosses.length && (
              <button
                onClick={(e) => { e.stopPropagation(); pickRandomUncleared() }}
                style={{ background: 'rgba(20,12,36,0.8)', border: '1px solid rgba(168,85,247,0.45)', color: '#c4b5fd', borderRadius: 6, padding: '0 8px', height: 28, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.62rem', letterSpacing: '0.08em' }}
                aria-label="Random uncleared zodiac"
                title="Random uncleared zodiac"
              >
                RANDOM
              </button>
            )}
          </div>

          <motion.div
            animate={{
              scale: mapZoom,
              x: `${clamp(cameraShiftX + userPan.x, -40, 40)}%`,
              y: `${clamp(cameraShiftY + userPan.y, -45, 45)}%`,
            }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            style={{ position: 'absolute', inset: 0, transformOrigin: '50% 50%', touchAction: 'none', zIndex: 1 }}
          >
          {/* ── SVG star-wheel ── */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
          >
            {/* Starfield */}
            {STARS.map(star => (
              <motion.circle
                key={star.id}
                cx={star.x} cy={star.y} r={star.r}
                fill="white"
                animate={{
                  opacity: [star.o, Math.min(1, star.o + 0.25), star.o],
                  cx: [star.x, star.x + star.driftX * star.amp, star.x],
                  cy: [star.y, star.y + star.driftY * star.amp, star.y],
                }}
                transition={{ duration: star.dur, delay: star.delay, repeat: Infinity, ease: 'easeInOut' }}
              />
            ))}

            {/* Outer ring */}
            <circle
              cx="50" cy="50" r="39"
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="0.4"
              strokeDasharray="2.5,2.5"
            />

            {/* Constellation lines */}
            <ConstellationLines positions={positions} />

            {/* Zodiac nodes */}
            {ZODIAC_BOSSES.map((boss, i) => {
              const p   = positions[i]
              const done = !!progress[`zodiac_${boss.id}_completed`]
              const isSel = selected === boss.id
              const isCameraTarget = !selected && cameraTargetId === boss.id
              return (
                <motion.g
                  key={boss.id}
                  onClick={e => { e.stopPropagation(); playZoomIn(); setSelected(boss.id) }}
                  style={{ cursor: 'pointer' }}
                  animate={{ scale: isSel ? 1.18 : 1, y: [0, -0.55, 0, 0.55, 0] }}
                  transition={{ scale: { type: 'spring', stiffness: 200, damping: 18 }, y: { duration: 2.8 + (i % 4) * 0.5, repeat: Infinity, ease: 'easeInOut' } }}
                  transformOrigin={`${p.x}px ${p.y}px`}
                >
                  {/* Glow halo */}
                  <motion.circle
                    cx={p.x} cy={p.y} r={done ? 4.8 : 3.8}
                    fill={boss.color}
                    opacity={isCameraTarget ? 0.24 : (done ? 0.18 : 0.08)}
                    animate={{ r: [done ? 4.8 : 3.8, isCameraTarget ? 6.6 : (done ? 6 : 5), done ? 4.8 : 3.8] }}
                    transition={{ duration: 2.4 + (i % 5) * 0.4, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  {/* Node circle */}
                  <circle
                    cx={p.x} cy={p.y} r="3.2"
                    fill={done ? boss.color : '#0d0d1a'}
                    stroke={boss.color}
                    strokeWidth={isSel ? '0.6' : '0.35'}
                    opacity={isSel ? 1 : 0.85}
                  />
                  {/* Glyph */}
                  <text
                    x={p.x} y={p.y + 0.9}
                    textAnchor="middle"
                    fontSize="3.2"
                    fill={done ? '#000' : boss.color}
                    style={{ pointerEvents: 'none', fontFamily: 'serif' }}
                  >
                    {boss.glyph}
                  </text>
                  {/* Name label */}
                  <text
                    x={p.x}
                    y={p.y + (p.y > 50 ? 7.2 : -4.5)}
                    textAnchor="middle"
                    fontSize="2.1"
                    fill={done ? boss.color : 'rgba(255,255,255,0.5)'}
                    letterSpacing="0.3"
                    style={{ pointerEvents: 'none', fontFamily: '"Courier New", monospace' }}
                  >
                    {boss.name.toUpperCase()}
                  </text>
                </motion.g>
              )
            })}

            {/* ── Center: Ophiuchus — only shown after all 12 beaten ── */}
            {allBeaten && (
            <motion.g
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, ease: 'backOut' }}
              onClick={e => {
                e.stopPropagation()
                playZoomIn(); setSelected('ophiuchus')
              }}
              style={{ cursor: 'pointer' }}
            >
              {/* Pulsing ring */}
              <motion.circle
                cx="50" cy="50" r="10"
                fill="none"
                stroke='#00ff99'
                strokeWidth="0.35"
                strokeDasharray="2,2"
                animate={{ rotate: [0, 360] }}
                transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
                style={{ transformOrigin: '50px 50px' }}
              />
              {/* Center glow */}
              <motion.circle
                cx="50" cy="50" r="7.5"
                fill="#00ff99"
                opacity={0.07}
                animate={{ r: [7.5, 10, 7.5] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              />
              {/* Center circle */}
              <circle
                cx="50" cy="50" r="6"
                fill={ophiuchus13 ? '#00ff99' : '#0a1a10'}
                stroke='#00ff99'
                strokeWidth="0.5"
              />
              {/* Glyph */}
              <text
                x="50" y="51.5"
                textAnchor="middle"
                fontSize="5.5"
                fill={ophiuchus13 ? '#000' : '#00ff99'}
                style={{ pointerEvents: 'none', fontFamily: 'serif' }}
              >
                ⛎
              </text>
              {/* Label */}
              <text
                x="50" y="60"
                textAnchor="middle"
                fontSize="2.2"
                fill='#00ff99'
                letterSpacing="0.3"
                style={{ pointerEvents: 'none', fontFamily: '"Courier New", monospace' }}
              >
                OPHIUCHUS
              </text>
            </motion.g>
            )}
          </svg>
          </motion.div>

          {/* ── Boss card overlay ── */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20, pointerEvents: selected ? 'auto' : 'none' }}>
            <AnimatePresence>
              {selectedBoss && (
                <BossCard
                  key={selectedBoss.id}
                  boss={selectedBoss}
                  completed={!!progress[`zodiac_${selectedBoss.id}_completed`]}
                  onClose={() => setSelected(null)}
                  onPlay={() => navigate(`/zodiac/${selectedBoss.id}`)}
                />
              )}
            </AnimatePresence>
          </div>

          {/* ── Progress bar ── */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0.8rem 1.4rem', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 10, zIndex: 5 }}>
            <div style={{ fontSize: '0.55rem', color: '#555', letterSpacing: '0.14em', flexShrink: 0 }}>
              ZODIAC SEALS
            </div>
            <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
              <motion.div
                style={{ height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #a855f7, #00d4ff)' }}
                animate={{ width: `${(defeatedCount / 12) * 100}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
            <div style={{ fontSize: '0.6rem', color: '#a855f7', letterSpacing: '0.1em', fontWeight: 700, flexShrink: 0 }}>
              {defeatedCount}/12
            </div>
            {allBeaten && (
              <div style={{ fontSize: '0.55rem', color: '#00ff99', letterSpacing: '0.14em', flexShrink: 0 }}>
                ⛎ {ophiuchus13 ? 'CYCLE BROKEN' : 'UNLOCKED'}
              </div>
            )}
          </div>

          {/* ── Season 3 entry — only after Ophiuchus beaten ── */}
          {ophiuchus13 && (
            <div style={{ padding: '18px 16px 8px', borderTop: '1px solid rgba(0,255,255,0.12)', marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, position: 'relative', zIndex: 6 }}>
              <div style={{ fontSize: '0.46rem', color: '#00ffff88', letterSpacing: '0.28em', textAlign: 'center' }}>
                THE ZODIAC CYCLE IS COMPLETE
              </div>
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                onClick={(e) => { e.stopPropagation(); navigate('/s3') }}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                style={{
                  background: 'rgba(0,255,255,0.08)',
                  border: '1px solid rgba(0,255,255,0.6)',
                  color: '#00ffff',
                  borderRadius: 10,
                  padding: '10px 22px',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: 900,
                  letterSpacing: '0.22em',
                  fontFamily: 'inherit',
                  textTransform: 'uppercase',
                  boxShadow: '0 0 20px rgba(0,255,255,0.25)',
                  width: '100%',
                  maxWidth: 320,
                }}
              >
                ⚡ TEMPORAL FRACTURE — SEASON 3
              </motion.button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
