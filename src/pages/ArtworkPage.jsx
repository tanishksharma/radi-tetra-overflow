import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { getAllArtworkVotes, voteArtwork } from '../firebase/db'
import homeIconUrl from '../icons/home-button.png'

// Import all artwork MP4s via Vite glob import
const ARTWORK_MODULES = import.meta.glob('../artwork/*.mp4', { eager: true, query: '?url', import: 'default' })

const TRACKS = Object.entries(ARTWORK_MODULES).map(([path, url]) => {
  const raw = path.replace('../artwork/', '').replace('.mp4', '')
  const title = raw.replace(/_/g, ' ').replace(/ \(1\)$/, ' (Alt)')
  return { id: raw, title, url }
}).sort((a, b) => a.title.localeCompare(b.title))

const DISLIKE_THRESHOLD = 0.75
const DISLIKE_MIN_VOTES  = 5

// ─── VoteBar ───────────────────────────────────────────────────────────────────
function VoteBar({ up, down, large }) {
  const total = up + down
  if (total === 0) return (
    <div style={{ fontSize: large ? '0.6rem' : '0.5rem', color: '#444', letterSpacing: '0.1em' }}>No votes yet</div>
  )
  const upPct = Math.round((up / total) * 100)
  return (
    <div>
      <div style={{ display: 'flex', height: large ? 6 : 4, borderRadius: 3, overflow: 'hidden', background: '#1a1a2e' }}>
        <div style={{ width: `${upPct}%`, background: '#22c55e', transition: 'width 0.4s ease' }} />
        <div style={{ width: `${100 - upPct}%`, background: '#f87171', transition: 'width 0.4s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: large ? '0.6rem' : '0.48rem', color: '#666', marginTop: 4, letterSpacing: '0.06em' }}>
        <span style={{ color: '#22c55e' }}>👍 {up} · {upPct}%</span>
        <span style={{ color: '#f87171' }}>{100 - upPct}% · {down} 👎</span>
      </div>
    </div>
  )
}

// ─── Volume Slider ─────────────────────────────────────────────────────────────
function VolumeSlider({ value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: '0.85rem', flexShrink: 0, width: 22, textAlign: 'center' }}>
        {value === 0 ? '🔇' : value < 0.4 ? '🔈' : value < 0.8 ? '🔉' : '🔊'}
      </span>
      <input
        type="range" min="0" max="1" step="0.02"
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: '#a855f7', cursor: 'pointer', height: 4 }}
      />
      <span style={{ fontSize: '0.55rem', color: '#666', width: 30, textAlign: 'right', letterSpacing: '0.05em' }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  )
}

// ─── Detail View (full-screen overlay) ────────────────────────────────────────
function DetailView({ track, trackIndex, votes, myVote, onVote, voteBusy, onClose, onPrev, onNext, hasPrev, hasNext }) {
  const videoRef  = useRef(null)
  const [playing, setPlaying]   = useState(false)
  const [volume, setVolume]     = useState(0.8)
  const [progress, setProgress] = useState(0)   // 0–1
  const [duration, setDuration] = useState(0)
  const touchStartXRef = useRef(null)

  const up    = votes?.up   || 0
  const down  = votes?.down || 0
  const total = up + down
  const isHighDislike = total >= DISLIKE_MIN_VOTES && (down / total) >= DISLIKE_THRESHOLD

  // Sync volume to video element
  useEffect(() => {
    const v = videoRef.current
    if (v) v.volume = volume
  }, [volume])

  // Reset player when track changes
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = 0
    v.volume = volume
    setPlaying(false)
    setProgress(0)
  }, [track.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (playing) { v.pause(); setPlaying(false) }
    else { v.play().catch(() => {}); setPlaying(true) }
  }

  const handleTimeUpdate = () => {
    const v = videoRef.current
    if (!v || !v.duration) return
    setProgress(v.currentTime / v.duration)
  }

  const handleSeek = (e) => {
    const v = videoRef.current
    if (!v || !v.duration) return
    const pct = parseFloat(e.target.value)
    v.currentTime = pct * v.duration
    setProgress(pct)
  }

  const fmt = (s) => {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape')       { onClose() }
      else if (e.key === ' ')       { e.preventDefault(); togglePlay() }
      else if (e.key === 'ArrowLeft')  { if (hasPrev) onPrev() }
      else if (e.key === 'ArrowRight') { if (hasNext) onNext() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })  // re-bind on every render so togglePlay closure is fresh

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onTouchStart={(e) => { touchStartXRef.current = e.touches[0].clientX }}
      onTouchEnd={(e) => {
        if (touchStartXRef.current === null) return
        const dx = e.changedTouches[0].clientX - touchStartXRef.current
        touchStartXRef.current = null
        if (Math.abs(dx) < 50) return
        if (dx > 0 && hasPrev) onPrev()
        else if (dx < 0 && hasNext) onNext()
      }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(5,5,15,0.97)', zIndex: 200,
        display: 'flex', flexDirection: 'column', fontFamily: '"Courier New", monospace',
      }}
    >
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 'calc(env(safe-area-inset-top, 0px) + 0.8rem) 1rem 0.8rem', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '0.72rem', letterSpacing: '0.14em', fontFamily: 'inherit', padding: 0, flexShrink: 0 }}
        >
          ← BACK
        </button>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.12em', color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {track.title}
          </div>
          <div style={{ fontSize: '0.5rem', color: '#555', letterSpacing: '0.18em', marginTop: 2 }}>
            TRACK {trackIndex + 1} / {TRACKS.length}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={onPrev}
            disabled={!hasPrev}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: hasPrev ? '#ccc' : '#333', cursor: hasPrev ? 'pointer' : 'default', padding: '5px 10px', fontSize: '0.75rem', fontFamily: 'inherit' }}
          >
            ‹
          </button>
          <button
            onClick={onNext}
            disabled={!hasNext}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: hasNext ? '#ccc' : '#333', cursor: hasNext ? 'pointer' : 'default', padding: '5px 10px', fontSize: '0.75rem', fontFamily: 'inherit' }}
          >
            ›
          </button>
        </div>
      </div>

      {/* Video */}
      <div
        onClick={togglePlay}
        style={{ flex: 1, background: '#000', cursor: 'pointer', position: 'relative', overflow: 'hidden', minHeight: 0 }}
      >
        <video
          ref={videoRef}
          src={track.url}
          playsInline
          preload="auto"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={() => { if (videoRef.current) setDuration(videoRef.current.duration) }}
          onEnded={() => setPlaying(false)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
        {/* Centered play/pause overlay */}
        <AnimatePresence>
          {!playing && (
            <motion.div
              key="pause-overlay"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
              style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.4)',
                pointerEvents: 'none',
              }}
            >
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem' }}>
                ▶
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Controls panel */}
      <div style={{ flexShrink: 0, background: '#0d0d1a', borderTop: '1px solid rgba(255,255,255,0.07)', padding: '0.9rem 1.2rem 1.2rem', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Seek bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.52rem', color: '#555', width: 32, letterSpacing: '0.04em', flexShrink: 0 }}>
            {fmt(progress * duration)}
          </span>
          <input
            type="range" min="0" max="1" step="0.001"
            value={progress}
            onChange={handleSeek}
            onClick={e => e.stopPropagation()}
            style={{ flex: 1, accentColor: '#a855f7', cursor: 'pointer', height: 4 }}
          />
          <span style={{ fontSize: '0.52rem', color: '#555', width: 32, textAlign: 'right', letterSpacing: '0.04em', flexShrink: 0 }}>
            {fmt(duration)}
          </span>
        </div>

        {/* Play + volume row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={togglePlay}
            style={{ flexShrink: 0, width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg,#a855f7,#ec4899)', border: 'none', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <div style={{ flex: 1 }}>
            <VolumeSlider value={volume} onChange={setVolume} />
          </div>
        </div>

        {/* Vote section */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <VoteBar up={up} down={down} large />
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <motion.button
              whileTap={{ scale: 0.9 }}
              disabled={voteBusy}
              onClick={() => onVote(track.id, 'up')}
              style={{
                width: 48, height: 48, borderRadius: 10, border: 'none', cursor: voteBusy ? 'not-allowed' : 'pointer',
                background: myVote === 'up' ? '#22c55e' : 'rgba(34,197,94,0.12)',
                fontSize: '1.2rem', transition: 'all 0.15s', opacity: voteBusy ? 0.5 : 1,
                boxShadow: myVote === 'up' ? '0 0 14px #22c55e55' : 'none',
              }}
            >👍</motion.button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              disabled={voteBusy}
              onClick={() => onVote(track.id, 'down')}
              style={{
                width: 48, height: 48, borderRadius: 10, border: 'none', cursor: voteBusy ? 'not-allowed' : 'pointer',
                background: myVote === 'down' ? '#f87171' : 'rgba(248,113,113,0.12)',
                fontSize: '1.2rem', transition: 'all 0.15s', opacity: voteBusy ? 0.5 : 1,
                boxShadow: myVote === 'down' ? '0 0 14px #f8717155' : 'none',
              }}
            >👎</motion.button>
          </div>
        </div>

        {isHighDislike && (
          <div style={{ padding: '5px 10px', background: 'rgba(248,113,113,0.1)', border: '1px solid #f8717130', borderRadius: 6, fontSize: '0.5rem', color: '#f87171', letterSpacing: '0.1em', textAlign: 'center' }}>
            ⚠ HIGH DISLIKE RATIO — REPORTED TO DEVS
          </div>
        )}

        <div style={{ fontSize: '0.45rem', color: '#333', textAlign: 'center', letterSpacing: '0.12em' }}>
          SPACE to play/pause · ← → to navigate tracks · ESC to close
        </div>
      </div>
    </motion.div>
  )
}

// ─── Grid card ─────────────────────────────────────────────────────────────────
function TrackCard({ track, votes, myVote, onOpen, onVote, voteBusy }) {
  const up    = votes?.up   || 0
  const down  = votes?.down || 0
  const total = up + down
  const isHighDislike = total >= DISLIKE_MIN_VOTES && (down / total) >= DISLIKE_THRESHOLD

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: isHighDislike ? 'rgba(248,113,113,0.05)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${isHighDislike ? '#f8717135' : myVote === 'up' ? '#22c55e35' : myVote === 'down' ? '#f8717135' : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        transition: 'border-color 0.2s',
      }}
    >
      {/* Thumbnail — click opens detail view */}
      <div
        onClick={onOpen}
        style={{ position: 'relative', aspectRatio: '16/9', background: '#0a0a14', cursor: 'pointer', overflow: 'hidden' }}
      >
        <video
          src={track.url}
          muted
          playsInline
          preload="metadata"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
        />
        {/* Play overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s' }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(168,85,247,0.25)', backdropFilter: 'blur(4px)', border: '1px solid rgba(168,85,247,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', color: '#e879f9' }}>
            ▶
          </div>
        </div>
        {myVote && (
          <div style={{ position: 'absolute', top: 6, left: 6, fontSize: '0.75rem', background: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: '1px 5px' }}>
            {myVote === 'up' ? '👍' : '👎'}
          </div>
        )}
      </div>

      {/* Info + quick votes */}
      <div style={{ padding: '8px 10px 10px' }}>
        <div
          onClick={onOpen}
          style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', color: '#e2e8f0', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}
        >
          {track.title}
        </div>
        <VoteBar up={up} down={down} />
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <motion.button
            whileTap={{ scale: 0.92 }}
            disabled={voteBusy}
            onClick={(e) => { e.stopPropagation(); onVote(track.id, 'up') }}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 7, border: 'none',
              cursor: voteBusy ? 'not-allowed' : 'pointer',
              background: myVote === 'up' ? '#22c55e' : 'rgba(34,197,94,0.1)',
              color: myVote === 'up' ? '#fff' : '#22c55e',
              fontSize: '0.85rem', transition: 'all 0.15s', opacity: voteBusy ? 0.5 : 1,
            }}
          >👍</motion.button>
          <motion.button
            whileTap={{ scale: 0.92 }}
            disabled={voteBusy}
            onClick={(e) => { e.stopPropagation(); onVote(track.id, 'down') }}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 7, border: 'none',
              cursor: voteBusy ? 'not-allowed' : 'pointer',
              background: myVote === 'down' ? '#f87171' : 'rgba(248,113,113,0.1)',
              color: myVote === 'down' ? '#fff' : '#f87171',
              fontSize: '0.85rem', transition: 'all 0.15s', opacity: voteBusy ? 0.5 : 1,
            }}
          >👎</motion.button>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function ArtworkPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [votes, setVotes]               = useState({})
  const [busy, setBusy]                 = useState({})
  const [toast, setToast]               = useState(null)
  const [loadingVotes, setLoadingVotes] = useState(true)
  const [detailIndex, setDetailIndex]   = useState(null)   // null = grid, number = detail

  useEffect(() => {
    getAllArtworkVotes()
      .then(setVotes)
      .catch(() => {})
      .finally(() => setLoadingVotes(false))
  }, [])

  const showToast = (msg, color = '#22c55e') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 2400)
  }

  const handleVote = useCallback(async (trackId, vote) => {
    if (!user) { showToast('Sign in to vote', '#facc15'); return }
    if (busy[trackId]) return
    setBusy(b => ({ ...b, [trackId]: true }))
    try {
      await voteArtwork(user.uid, trackId, vote)
      setVotes(prev => {
        const cur   = prev[trackId] || { up: 0, down: 0, userVotes: {} }
        const prevV = cur.userVotes?.[user.uid]
        let up   = cur.up   || 0
        let down = cur.down || 0
        if (prevV === 'up')   up   = Math.max(0, up   - 1)
        if (prevV === 'down') down = Math.max(0, down - 1)
        if (vote === 'up')   up   += 1
        if (vote === 'down') down += 1
        return { ...prev, [trackId]: { ...cur, up, down, userVotes: { ...(cur.userVotes || {}), [user.uid]: vote } } }
      })
    } catch (e) {
      showToast(e.message, '#f87171')
    } finally {
      setBusy(b => ({ ...b, [trackId]: false }))
    }
  }, [user, busy])   

  const detailTrack = detailIndex !== null ? TRACKS[detailIndex] : null

  return (
    <div style={{ minHeight: '100dvh', background: '#0a0a14', display: 'flex', flexDirection: 'column', fontFamily: '"Courier New", monospace', color: '#fff' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(env(safe-area-inset-top, 0px) + 1rem) 1.4rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '0.72rem', letterSpacing: '0.14em', fontFamily: 'inherit', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={homeIconUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
          <span>MENU</span>
        </button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, letterSpacing: '0.2em', background: 'linear-gradient(90deg, #a855f7, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          SOUNDTRACK
        </h1>
        <div style={{ fontSize: '0.55rem', color: '#555', letterSpacing: '0.12em' }}>{TRACKS.length} TRACKS</div>
      </header>

      {/* Sign-in notice */}
      {!user && (
        <div style={{ padding: '7px 1.4rem', background: 'rgba(234,179,8,0.07)', borderBottom: '1px solid rgba(234,179,8,0.15)', fontSize: '0.6rem', color: '#ca8a04', letterSpacing: '0.1em' }}>
          Sign in to vote and help shape the soundtrack
        </div>
      )}

      {/* Grid */}
      {loadingVotes ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', letterSpacing: '0.2em', fontSize: '0.8rem' }}>LOADING…</div>
      ) : (
        <div style={{ flex: 1, padding: '1rem 1.4rem 2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.85rem', alignContent: 'start', overflowY: 'auto' }}>
          {TRACKS.map((track, idx) => (
            <TrackCard
              key={track.id}
              track={track}
              votes={votes[track.id]}
              myVote={votes[track.id]?.userVotes?.[user?.uid]}
              onOpen={() => setDetailIndex(idx)}
              onVote={handleVote}
              voteBusy={!!busy[track.id]}
            />
          ))}
        </div>
      )}

      {/* Detail view overlay */}
      <AnimatePresence>
        {detailTrack && (
          <DetailView
            key={detailTrack.id}
            track={detailTrack}
            trackIndex={detailIndex}
            votes={votes[detailTrack.id]}
            myVote={votes[detailTrack.id]?.userVotes?.[user?.uid]}
            onVote={handleVote}
            voteBusy={!!busy[detailTrack.id]}
            onClose={() => setDetailIndex(null)}
            onPrev={() => setDetailIndex(i => Math.max(0, i - 1))}
            onNext={() => setDetailIndex(i => Math.min(TRACKS.length - 1, i + 1))}
            hasPrev={detailIndex > 0}
            hasNext={detailIndex < TRACKS.length - 1}
          />
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#12121e', border: `1px solid ${toast.color}`, borderRadius: 8, padding: '10px 20px', color: toast.color, fontSize: '0.8rem', letterSpacing: '0.08em', zIndex: 500, whiteSpace: 'nowrap' }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

