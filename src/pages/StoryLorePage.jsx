import { createRef, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import BackgroundCanvas from '../components/BackgroundCanvas'
import { STORY_CHAPTERS } from '../logic/storyData'
import { ZODIAC_BOSSES, OPHIUCHUS, allZodiacBeaten, ophiuchusBeaten } from '../logic/storyData_s2'
import { SEASON3_EPOCHS } from '../logic/storyData_s3'
import { useAuth } from '../contexts/AuthContext'
import { getStoryProgress } from '../firebase/db'
import homeIconUrl from '../icons/home-button.png'

const CH_BG = (ch) => ch?.levels?.[0]?.bgType || 'abyss'

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

export default function StoryLorePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [progress, setProgress] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.uid) {
      setProgress({})
      setLoading(false)
      return
    }
    getStoryProgress(user.uid)
      .then((p) => setProgress(p || {}))
      .finally(() => setLoading(false))
  }, [user])

  const chapters = useMemo(() => {
    const visible = []
    STORY_CHAPTERS.forEach((ch, chIdx) => {
      const unlockedLevels = ch.levels.filter((_, lvIdx) => isLevelUnlocked(chIdx, lvIdx, progress))
      if (unlockedLevels.length > 0) visible.push({ ...ch, levels: unlockedLevels })
    })

    // Append Season 2 — The Zodiac Arc lore progressively:
    // show a card for each defeated boss; add Ophiuchus only if beaten.
    const anyZodiacBeaten = ZODIAC_BOSSES.some(b => !!progress[`zodiac_${b.id}_completed`]) || ophiuchusBeaten(progress)
    if (anyZodiacBeaten) {
      const zodiacLevels = ZODIAC_BOSSES
        .filter(b => !!progress[`zodiac_${b.id}_completed`])
        .map(b => ({
          id: b.id,
          title: b.name,
          subtitle: b.subtitle,
          glyph: b.glyph,
          bgType: b.bgType,
          bpm: b.bpm,
          gravityMult: b.gravityMult,
          targetLines: b.targetLines,
          easyTargetLines: b.easyTargetLines,
          storyBefore: b.storyBefore,
          storyAfter: b.storyAfter,
        }))
      if (ophiuchusBeaten(progress)) {
        zodiacLevels.push({
          id: OPHIUCHUS.id,
          title: OPHIUCHUS.name,
          subtitle: OPHIUCHUS.subtitle,
          glyph: OPHIUCHUS.glyph,
          bgType: OPHIUCHUS.bgType,
          bpm: OPHIUCHUS.bpm,
          gravityMult: OPHIUCHUS.gravityMult,
          targetLines: OPHIUCHUS.targetLines,
          easyTargetLines: OPHIUCHUS.easyTargetLines,
          storyBefore: OPHIUCHUS.storyBefore,
          storyAfter: OPHIUCHUS.storyAfter,
        })
      }
      if (zodiacLevels.length > 0) {
        visible.push({
          id: 'zodiac',
          title: 'SEASON 2',
          subtitle: allZodiacBeaten(progress) ? 'The Zodiac Arc — Complete' : 'The Zodiac Arc — Defeated Boss Lore',
          color: '#a855f7',
          glowColor: '#c084fc',
          levels: zodiacLevels,
        })
      }
    }

    // Append Season 3 — Temporal Fracture: one page per epoch, only beaten levels
    const anyS3Beaten = SEASON3_EPOCHS.some(epoch =>
      epoch.levels.some(l => !!progress[`s3_${epoch.id}_${l.id}_completed`])
    )
    if (anyS3Beaten) {
      SEASON3_EPOCHS.forEach((epoch, epIdx) => {
        const completedLevels = epoch.levels
          .filter(l => !!progress[`s3_${epoch.id}_${l.id}_completed`])
          .map(l => ({
            id: l.id,
            title: l.title,
            subtitle: l.subtitle,
            bgType: l.bgType,
            bpm: l.bpm,
            gravityMult: l.gravityMult,
            targetLines: l.targetLines,
            easyTargetLines: l.easyTargetLines,
            isBoss: l.isBoss,
            abilityLabel: l.abilityLabel,
            abilityDesc: l.abilityDesc,
            storyBefore: l.storyBefore,
            storyAfter: l.storyAfter,
          }))
        if (completedLevels.length === 0) return
        const epochDone = epoch.levels.every(l => !!progress[`s3_${epoch.id}_${l.id}_completed`])
        visible.push({
          id: `s3_${epoch.id}`,
          title: epoch.title,
          subtitle: epochDone ? `${epoch.subtitle} — Complete` : epoch.subtitle,
          color: epoch.color,
          glowColor: epoch.glowColor,
          sectionLabel: `S3 · EPOCH ${epIdx + 1}`,
          levels: completedLevels,
        })
      })
    }

    return visible
  }, [progress])

  const [idx, setIdx] = useState(0)
  const railRef = useRef(null)
  const secRefs = useRef([])
  const touchStartXRef = useRef(0)
  const touchDeltaXRef = useRef(0)
  secRefs.current = chapters.map((_, i) => secRefs.current[i] || createRef())

  useEffect(() => {
    if (idx > chapters.length - 1) setIdx(Math.max(0, chapters.length - 1))
  }, [idx, chapters.length])

  useEffect(() => {
    const opts = { root: railRef.current, threshold: 0.52 }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const i = Number(e.target.getAttribute('data-i') || '0')
          setIdx(i)
        }
      })
    }, opts)
    secRefs.current.forEach(ref => { if (ref.current) io.observe(ref.current) })
    return () => io.disconnect()
  }, [chapters])

  const jumpTo = (nextIdx) => {
    const target = Math.max(0, Math.min(chapters.length - 1, nextIdx))
    secRefs.current[target]?.current?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'start' })
  }

  const onTouchStart = (e) => {
    touchStartXRef.current = e.touches?.[0]?.clientX || 0
    touchDeltaXRef.current = 0
  }

  const onTouchMove = (e) => {
    const nowX = e.touches?.[0]?.clientX || 0
    touchDeltaXRef.current = nowX - touchStartXRef.current
  }

  const onTouchEnd = () => {
    const dx = touchDeltaXRef.current
    const SWIPE_PX = 52
    if (Math.abs(dx) < SWIPE_PX) return
    if (dx < 0) jumpTo(idx + 1)
    else jumpTo(idx - 1)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#05050f', color: '#fff', fontFamily: '"Courier New", monospace', overflow: 'hidden' }}>
      {/* Live background follows the chapter in view */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
        <BackgroundCanvas bgType={CH_BG(chapters[idx])} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(env(safe-area-inset-top, 0px) + 0.9rem) 1.3rem 0.9rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '0.72rem', letterSpacing: '0.14em', display: 'flex', alignItems: 'center', gap: 8 }}><img src={homeIconUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} /><span>MENU</span></button>
          <div style={{ fontSize: '0.95rem', fontWeight: 900, letterSpacing: '0.3em' }}>LORE</div>
          <div style={{ width: 60 }} />
        </header>
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', letterSpacing: '0.12em', fontSize: '0.75rem' }}>
            LOADING LORE…
          </div>
        ) : chapters.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#777', letterSpacing: '0.08em', fontSize: '0.78rem', textAlign: 'center', padding: '1rem' }}>
            No lore unlocked yet. Play story mode to reveal chapters.
          </div>
        ) : (
          <div
            ref={railRef}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', contain: 'content', display: 'flex', scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', overscrollBehaviorX: 'contain' }}
          >
            {chapters.map((ch, ci) => (
            <section key={ch.id} ref={secRefs.current[ci]} data-i={ci} style={{ position: 'relative', minWidth: '100%', scrollSnapAlign: 'start', scrollSnapStop: 'always', padding: '1.1rem', height: '100%', overflowY: 'auto', overscrollBehaviorY: 'contain', touchAction: 'pan-x pan-y' }}>
              <motion.div initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.35 }}
                style={{ marginBottom: 10, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontSize: '0.58rem', letterSpacing: '0.32em', color: '#888' }}>{ch.sectionLabel || `CHAPTER ${ci+1}`}</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 900, letterSpacing: '0.14em', color: ch.color }}>{ch.title}</div>
                <div style={{ fontSize: '0.62rem', color: '#555', letterSpacing: '0.08em' }}>— {ch.subtitle}</div>
              </motion.div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.8rem' }}>
                {ch.levels.map((lv, li) => (
                  <motion.div key={`${ch.id}_${lv.id}`} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.3, delay: 0.03*li }}
                    style={{ position: 'relative', background: 'rgba(255,255,255,0.04)', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 12, padding: '0.9rem', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
                    {lv.glyph && (
                      <div style={{ position: 'absolute', right: 10, top: 6, fontSize: '2.2rem', lineHeight: 1, color: ch.color || '#a855f7', opacity: 0.18, textShadow: '0 0 10px rgba(0,0,0,0.35)' }} aria-hidden>
                        {lv.glyph}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: '0.7rem', letterSpacing: '0.14em', color: ch.color }}>{lv.title}</div>
                        <div style={{ fontSize: '0.6rem', color: '#666', letterSpacing: '0.12em' }}>{lv.subtitle}{lv.glyph ? ` · ${lv.glyph}` : ''}</div>
                      </div>
                      <div style={{ fontSize: '0.58rem', color: '#999', letterSpacing: '0.08em' }}>{(lv.targetLines||0)} lines</div>
                    </div>
                    <div style={{ fontSize: '0.65rem', color: '#ddd', lineHeight: 1.6, letterSpacing: '0.02em' }}>{lv.storyBefore}</div>
                    <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '0.4rem 0' }} />
                    <div style={{ fontSize: '0.65rem', color: '#9ab', lineHeight: 1.6, letterSpacing: '0.02em' }}>{lv.storyAfter}</div>
                    {lv.abilityLabel && (
                      <div style={{ marginTop: 4, padding: '5px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 6, borderLeft: `2px solid ${ch.color}` }}>
                        <div style={{ fontSize: '0.58rem', color: ch.color, letterSpacing: '0.14em', fontWeight: 700 }}>{lv.abilityLabel}</div>
                        <div style={{ fontSize: '0.62rem', color: '#aaa', marginTop: 2, lineHeight: 1.5 }}>{lv.abilityDesc}</div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
