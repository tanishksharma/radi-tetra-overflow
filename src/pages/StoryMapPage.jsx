import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { getStoryProgress, resetStoryProgress } from '../firebase/db'
import { STORY_CHAPTERS } from '../logic/storyData'
import { playTap, playZoomIn, playZoomOut, playBack } from '../audio/uiSfx'
import homeIconUrl from '../icons/home-button.png'

// Season 2 unlock: ch8 l1 must be completed
function isS2Unlocked(progress) {
  return !!progress['ch8_l1_completed']
}

// Returns true if a level is unlocked given progress data
function isLevelUnlocked(chIdx, lvIdx, progress) {
  if (chIdx === 0 && lvIdx === 0) return true
  const ch = STORY_CHAPTERS[chIdx]
  const prevLv = lvIdx > 0
    ? ch.levels[lvIdx - 1]
    : STORY_CHAPTERS[chIdx - 1]?.levels.at(-1)
  const prevCh = lvIdx > 0 ? ch : STORY_CHAPTERS[chIdx - 1]
  if (!prevCh || !prevLv) return false
  return !!progress[`${prevCh.id}_${prevLv.id}_completed`]
}

function ChapterPanel({ chapter, chIdx, progress, onSelectLevel }) {
  const levels = chapter.levels
  const chapterScore = Number(progress?.[`${chapter.id}_chapter_score`] || 0)
  const chapterLines = Number(progress?.[`${chapter.id}_chapter_lines`] || 0)
  const isLandscape = window.innerWidth > window.innerHeight
  const panelMaxWidth = isLandscape ? '280px' : '340px'
  const panelMaxHeight = isLandscape ? '85vh' : 'auto'
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.94 }}
      onClick={e => e.stopPropagation()}
      style={{ background: '#10101c', border: `1px solid ${chapter.color}66`, boxShadow: `0 24px 80px ${chapter.color}44`, borderRadius: 14, padding: '1.4rem', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 240, maxWidth: panelMaxWidth, width: 'min(92vw, ' + panelMaxWidth + ')', maxHeight: panelMaxHeight, overflowY: isLandscape ? 'auto' : 'visible' }}
    >
      <div>
        <div style={{ fontSize: isLandscape ? '0.5rem' : '0.55rem', color: chapter.color, letterSpacing: '0.26em', textTransform: 'uppercase', marginBottom: 4 }}>Chapter {chIdx + 1}</div>
        <div style={{ fontSize: isLandscape ? '0.95rem' : '1.1rem', fontWeight: 900, letterSpacing: '0.1em', color: '#fff' }}>{chapter.title}</div>
        <div style={{ fontSize: isLandscape ? '0.6rem' : '0.68rem', color: '#666', marginTop: 4, lineHeight: 1.4 }}>{chapter.subtitle}</div>
        <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', fontSize: isLandscape ? '0.55rem' : '0.62rem', letterSpacing: '0.08em', flexWrap: 'wrap' }}>
          <span style={{ color: '#ddd' }}>Score: <strong style={{ color: chapter.color }}>{chapterScore.toLocaleString()}</strong></span>
          <span style={{ color: '#888' }}>Lines: {chapterLines.toLocaleString()}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: isLandscape ? 6 : 8 }}>
        {levels.map((lv, lvIdx) => {
          const unlocked = isLevelUnlocked(chIdx, lvIdx, progress)
          const completed = !!progress[`${chapter.id}_${lv.id}_completed`]
          const bestLines = progress[`${chapter.id}_${lv.id}_lines`] || 0
          return (
            <button
              key={lv.id}
              disabled={!unlocked}
              onClick={() => { if (unlocked) { playTap(); onSelectLevel(chapter.id, lv.id) } }}
              style={{
                background: completed ? `${chapter.color}14` : unlocked ? 'rgba(255,255,255,0.04)' : 'transparent',
                border: `1px solid ${completed ? chapter.color : unlocked ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'}`,
                borderRadius: 8, padding: isLandscape ? '8px 10px' : '10px 12px', color: unlocked ? '#fff' : '#444',
                cursor: unlocked ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', gap: isLandscape ? 8 : 10,
                fontFamily: 'inherit', textAlign: 'left', transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: isLandscape ? '0.85rem' : '1rem', flexShrink: 0 }}>
                {completed ? '✦' : unlocked ? (lv.isBoss ? '⚡' : '▶') : '🔒'}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: isLandscape ? '0.7rem' : '0.78rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{lv.title}</div>
                <div style={{ fontSize: isLandscape ? '0.55rem' : '0.6rem', color: '#666', marginTop: 2 }}>{lv.subtitle}</div>
                {completed && bestLines > 0 && (
                  <div style={{ fontSize: isLandscape ? '0.55rem' : '0.6rem', color: chapter.color, marginTop: 2 }}>Best: {bestLines} lines</div>
                )}
              </div>
              {lv.isBoss && <span style={{ fontSize: isLandscape ? '0.5rem' : '0.55rem', color: '#f97316', letterSpacing: '0.14em', border: '1px solid #f97316', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>BOSS</span>}
            </button>
          )
        })}
      </div>
    </motion.div>
  )
}

export default function StoryMapPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [progress, setProgress] = useState({})
  const [selected, setSelected] = useState(null) // chIdx
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    getStoryProgress(user.uid).then(p => { setProgress(p); setLoading(false) })
  }, [user])

  const handleSelectLevel = (chapterId, levelId) => {
    navigate(`/story/${chapterId}/${levelId}`)
  }

  // Hide secret chapter ch8 (THE MATRIX) until Ch.7 L.5 is completed
  const visibleChapters = useMemo(() => {
    const idxMatrix = STORY_CHAPTERS.findIndex(ch => ch.id === 'ch8')
    if (idxMatrix === -1) return STORY_CHAPTERS
    const unlocked = !!progress['ch7_l5_completed']
    return unlocked ? STORY_CHAPTERS : STORY_CHAPTERS.slice(0, idxMatrix)
  }, [progress])

  const mapPoints = useMemo(() => {
    const N = visibleChapters.length || 1
    const leftX = 34
    const rightX = 66
    const yTop = 7
    const yBot = 93
    const step = N > 1 ? (yBot - yTop) / (N - 1) : 0
    return visibleChapters.map((_, i) => ({
      x: i % 2 === 0 ? leftX : rightX,
      y: yBot - i * step,
    }))
  }, [visibleChapters])

  const stars = useMemo(() => (
    Array.from({ length: 110 }).map((_, i) => {
      const x = (Math.sin(i * 21.73) * 47 + 50)
      const y = (Math.cos(i * 17.29) * 47 + 50)
      const base = 0.6 + (i % 5) * 0.18
      // Slightly different drift per axis for a gentle wander
      const driftX = base * (i % 2 === 0 ? 1 : 0.7)
      const driftY = base * (i % 3 === 0 ? 1.2 : 0.8)
      return {
        id: i,
        x,
        y,
        r: 0.08 + (i % 4) * 0.08,
        o: 0.14 + (i % 6) * 0.09,
        driftX,
        driftY,
        dur: 5 + (i % 7) * 1.35,
        delay: (i % 11) * 0.18,
      }
    })
  ), [])

  const selectedPoint = selected !== null ? mapPoints[selected] : null
  // Slightly zoomed-out default view to reveal more of the map
  const baseScale = 0.92
  const zoomScale = selectedPoint ? baseScale * 1.18 : baseScale
  const zoomX = selectedPoint ? (50 - selectedPoint.x) * 2.1 : 0
  const zoomY = selectedPoint ? (50 - selectedPoint.y) * 2.4 : 0

  // How many chapters unlocked
  const _unlockedChapters = STORY_CHAPTERS.filter((_, i) => isLevelUnlocked(i, 0, progress))
  const completedChapters = STORY_CHAPTERS.filter(ch =>
    ch.levels.every(lv => !!progress[`${ch.id}_${lv.id}_completed`])
  )

  // Reset warning state
  const [resetPending, setResetPending] = useState(false);
  const [resetMsg, setResetMsg] = useState('');
  async function handleReset() {
    setResetMsg('');
    try {
      await resetStoryProgress(user.uid);
      setProgress({});
      setResetMsg('Story progress reset! Replay & unlock rewards again.');
      setResetPending(false);
    } catch (e) {
      setResetMsg('Reset failed: '+(e && e.message));
    }
  }
  return (
    <div style={{ minHeight: '100dvh', background: '#0a0a14', display: 'flex', flexDirection: 'column', fontFamily: '"Courier New", monospace', color: '#fff', overflow: 'hidden' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(env(safe-area-inset-top, 0px) + 1rem) 1.4rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <button onClick={() => { playBack(); navigate('/') }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '0.72rem', letterSpacing: '0.14em', fontFamily: 'inherit', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={homeIconUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
          <span>MENU</span>
        </button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, letterSpacing: '0.2em', color: '#a855f7' }}>STORY MODE</h1>
        <div style={{ fontSize: '0.65rem', color: '#555', letterSpacing: '0.1em' }}>
          {(() => {
            const count = completedChapters.length;
            if (count > 7) {
              return `${count}!/7? CHAPTERS`;
            }
            else{return `${count}/7 CHAPTERS`;}
            
          })()}
        </div>
      </header>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: '0.8rem', letterSpacing: '0.2em' }}>LOADING…</div>
      ) : (
        <>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <motion.div
              animate={{ scale: zoomScale, x: `${zoomX}%`, y: `${zoomY}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              style={{ position: 'absolute', inset: 0, transformOrigin: '50% 50%' }}
            >
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="xMidYMid slice"
                style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
              >
                {stars.map(star => (
                  <motion.circle
                    key={star.id}
                    cx={star.x}
                    cy={star.y}
                    r={star.r}
                    fill="white"
                    animate={{
                      opacity: [star.o, Math.min(1, star.o + 0.3), star.o],
                      cx: [star.x, star.x + star.driftX, star.x],
                      cy: [star.y, star.y - star.driftY, star.y],
                    }}
                    transition={{ duration: star.dur, delay: star.delay, repeat: Infinity, ease: 'easeInOut' }}
                  />
                ))}

                <motion.path
                  d={mapPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth="1"
                  fill="none"
                  strokeDasharray="2,2"
                  animate={{ strokeDashoffset: [0, -12] }}
                  transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
                />

                {visibleChapters.map((ch, i) => {
                  const unlocked = isLevelUnlocked(i, 0, progress)
                  const completed = ch.levels.every(lv => !!progress[`${ch.id}_${lv.id}_completed`])
                  const isSelected = selected === i
                  const p = mapPoints[i]
                  // Place titles above nodes; clamp to a safe top margin to avoid clipping
                  const MIN_TOP_Y = 3
                  const titleY = Math.max(MIN_TOP_Y, p.y - 6)
                  // Keep labels away from screen edges: nudge inward and switch textAnchor per side
                  const isLeftSide = p.x < 50
                  const titleX = isLeftSide ? p.x + 8 : p.x - 8
                  const titleAnchor = isLeftSide ? 'start' : 'end'
                  return (
                    <motion.g
                      key={ch.id}
                      onClick={() => { if (unlocked) { playZoomIn(); setSelected(i) } }}
                      style={{ cursor: unlocked ? 'pointer' : 'not-allowed' }}
                      animate={{ y: [0, -0.9, 0, 0.9, 0] }}
                      transition={{ duration: 2.8 + (i % 4) * 0.5, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      {/* Always show a soft halo using chapter color; dimmer when locked */}
                      <motion.circle
                        cx={p.x}
                        cy={p.y}
                        r={isSelected ? 7.5 : 5.7}
                        fill="none"
                        stroke={ch.color}
                        strokeWidth="0.5"
                        animate={{ opacity: unlocked || completed ? (isSelected ? [0.5, 0.9, 0.5] : [0.2, 0.45, 0.2]) : [0.06, 0.14, 0.06] }}
                        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                      />

                      <circle cx={p.x} cy={p.y} r={3.6} fill={unlocked ? (completed ? ch.color : `${ch.color}88`) : '#1a1a2e'} stroke={unlocked ? ch.color : `${ch.color}55`} strokeWidth="0.6" />
                      <text x={p.x} y={p.y + 1.2} textAnchor="middle" fontSize="3" fill={unlocked ? '#fff' : '#444'}>
                        {completed ? '✦' : unlocked ? String(i + 1) : '🔒'}
                      </text>
                      <text x={titleX} y={titleY} textAnchor={titleAnchor} fontSize="2.2" fill={ch.color} opacity={unlocked ? 0.95 : 0.42} letterSpacing="0.3">
                        {ch.title}
                      </text>
                    </motion.g>
                  )
                })}
              </svg>
            </motion.div>

            <AnimatePresence>
              {selected !== null && (
                <motion.div
                  key="chapter-overlay"
                  initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
                  animate={{ opacity: 1, backdropFilter: 'blur(3px)' }}
                  exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
                  transition={{ duration: 0.24 }}
                  onClick={() => { playZoomOut(); setSelected(null) }}
                  style={{ position: 'absolute', inset: 0, background: 'rgba(4,6,18,0.46)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
                >
                  <motion.div
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.92, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 210, damping: 16 }}
                  >
                    <ChapterPanel
                      chapter={STORY_CHAPTERS[selected]}
                      chIdx={selected}
                      progress={progress}
                      onSelectLevel={handleSelectLevel}
                    />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {selected === null && (
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.22 }}
                  style={{ position: 'absolute', left: '50%', bottom: '1rem', transform: 'translateX(-50%)', fontSize: '0.7rem', color: '#59607d', letterSpacing: '0.12em', textAlign: 'center', margin: 0, padding: '0.5rem 0.8rem', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}
                >
                  TAP AN UNLOCKED CHAPTER
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          {/* ── Season 2 Portal ── */}
          {isS2Unlocked(progress) && (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ display: 'flex', justifyContent: 'center', padding: '0.5rem 1.4rem 0', flexShrink: 0 }}
            >
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => { playZoomIn(); navigate('/zodiac') }}
                style={{
                  background: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(0,212,255,0.1))',
                  border: '1px solid rgba(168,85,247,0.5)',
                  color: '#fff',
                  borderRadius: 10,
                  padding: '10px 28px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  boxShadow: '0 0 24px rgba(168,85,247,0.2)',
                }}
              >
                <span style={{ fontSize: '1.4rem', filter: 'drop-shadow(0 0 8px #a855f7)' }}>⛎</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '0.55rem', color: '#a855f7', letterSpacing: '0.28em', textTransform: 'uppercase', marginBottom: 2 }}>Season 2</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 900, letterSpacing: '0.14em' }}>THE ZODIAC ARC</div>
                </div>
                <span style={{ fontSize: '0.7rem', color: '#a855f7', marginLeft: 4 }}>→</span>
              </motion.button>
            </motion.div>
          )}

          {/* Reset Progress Option */}
          <div style={{width:'100%', display:'flex', justifyContent:'center', marginTop:'1.25rem'}}>
            {!resetPending ? (
              <button
                onClick={()=>setResetPending(true)}
                style={{background:'#262646', color:'#fff', border:'1px solid #a855f7', fontSize:'0.82rem', letterSpacing:'0.1em', borderRadius:9, padding:'9px 26px', cursor:'pointer', fontWeight:700, transition:'all 0.15s'}}
              >RESET STORY PROGRESS</button>
            ): (
              <div style={{display:'flex', flexDirection:'column',alignItems:'center',gap:10}}>
                <div style={{color:'#f59e42',background:'#252522',padding:'0.7em 2em',borderRadius:7, fontSize:'0.85em', lineHeight:1.55, textAlign:'center',marginBottom:8}}><b>Reset all progress?</b> <br/>This will let you replay and re-unlock all story milestones and rewards, and does NOT remove your already-earned coins/inventory.<br/>You cannot undo this.<br/></div>
                <div style={{display:'flex',gap:20}}>
                  <button onClick={handleReset} style={{background:'#d23636',color:'#fff',border:'none',borderRadius:8,padding:'8px 21px',fontWeight:700,fontSize:'0.95em',cursor:'pointer'}}>Confirm Reset</button>
                  <button onClick={()=>setResetPending(false)} style={{background:'#1a1a22',color:'#aaa',border:'none',borderRadius:8,padding:'8px 17px',fontWeight:700,fontSize:'0.95em',cursor:'pointer'}}>Cancel</button>
                </div>
                {!!resetMsg && <div style={{ fontSize:'0.79em',color:'#a855f7',marginTop:8 }}>{resetMsg}</div>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
