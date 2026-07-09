import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { QRCodeSVG as QRCode } from 'qrcode.react'
import { useAuth } from '../contexts/AuthContext'
import { createLobby, joinLobby, rejoinLobby, updateLobby, updateLobbyPlayer, setLobbyStatus, setLobbyBestOf, subscribeLobby, archiveLobby, getFriends, getFriendRequests, getSentFriendRequests, acceptFriendRequest, declineFriendRequest, sendFriendRequest, findPublicProfileByFriendCode, sendLobbyInvite, getLobbyInvites, dismissLobbyInvite, getPublicProfiles } from '../firebase/db'
import { TetrisEngine, GAME_MODE, ZONE_MIN_METER } from '../logic/gameEngine'
import { setSfxVolume, playMoveSFX, playRotateSFX, playHoldSFX, playSoftDropSFX, playHardDropSFX, playLockSFX, playLineClearSFX, playTetrisSFX } from '../audio/gameSfx'
import { PIECES } from '../logic/tetrominoes'
import { MusicManager } from '../audio/musicManager'
import { mpPlayLobbyMusic, mpStopMusic, mpMuteMusic, mpSetMusicVolume } from '../audio/multiplayerMusic'
import GameCanvas from '../components/GameCanvas'
import SynesthesiaMotionLayer from '../components/SynesthesiaMotionLayer'
import { emitSynesthesia, SYNESTHESIA_EVENT } from '../logic/synesthesiaBus'
import homeIconUrl from '../icons/home-button.png'
import { BOARD_HEIGHT } from '../logic/tetrominoes'
import TouchControls from '../components/TouchControls'

const KEY_BINDINGS = {
  ArrowLeft:  { held: 'left' },
  ArrowRight: { held: 'right' },
  ArrowDown:  { held: 'softDrop' },
  ArrowUp:    { action: 'rotateCW' },
  KeyZ:       { action: 'rotateCCW' },
  Space:      { action: 'hardDrop' },
  KeyX:       { action: 'rotate180' },
  KeyC:       { action: 'hold' },
  // No pause in multiplayer (Mute still allowed)
  KeyM:       { action: 'mute' },
}

const MAX_FRAME_MS     = 34
const SNAP_INTERVAL_MS = 300  // faster board updates for smoother opponent preview
const OPPONENTS_PER_PAGE = 4
const LAST_LOBBY_KEY = 'vs-last-lobby-code'

// ─── Audio (module-level — persists across re-renders, isolated from App.jsx) ─
let _mpAudioCtx = null
let _mpMusicMgr = null
let _mpSfxVol   = 2.0

const getMpAudio = () => {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  if (!_mpAudioCtx) {
    _mpAudioCtx = new Ctx()
    _mpMusicMgr = new MusicManager(_mpAudioCtx)
  }
  if (_mpAudioCtx.state === 'suspended') _mpAudioCtx.resume()
  return _mpAudioCtx
}

const _mpNote = (freq, dur, gain, type = 'triangle', offset = 0) => {
  const ctx = getMpAudio(); if (!ctx) return
  const osc = ctx.createOscillator(), g = ctx.createGain()
  osc.connect(g); g.connect(ctx.destination)
  osc.type = type; osc.frequency.value = freq
  const t = ctx.currentTime + offset
  g.gain.setValueAtTime(gain * _mpSfxVol, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + dur)
  osc.start(t); osc.stop(t + dur + 0.01)
}
const _mpNoise = (lpFreq, gain, dur, offset = 0) => {
  const ctx = getMpAudio(); if (!ctx) return
  const len = Math.ceil(ctx.sampleRate * Math.min(dur, 0.5))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d   = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource(); src.buffer = buf
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = lpFreq
  const gn  = ctx.createGain()
  src.connect(flt); flt.connect(gn); gn.connect(ctx.destination)
  const t = ctx.currentTime + offset
  gn.gain.setValueAtTime(gain * _mpSfxVol, t)
  gn.gain.exponentialRampToValueAtTime(0.001, t + dur)
  src.start(t); src.stop(t + dur + 0.01)
}

let _lastMpMoveBeep = 0
const _mpPlayMove     = () => { const n = performance.now(); if (n - _lastMpMoveBeep < 75) return; _lastMpMoveBeep = n; _mpNote(380, 0.022, 0.026, 'triangle') }
const _mpPlayRotate   = () => { _mpNote(1100, 0.032, 0.22, 'triangle'); _mpNote(750, 0.020, 0.16, 'sine', 0.010) }
const _mpPlayHold     = () =>   _mpNote(660, 0.018, 0.15, 'triangle')
const _mpPlayHardDrop = () => { _mpNote(75, 0.18, 0.44, 'sine'); _mpNote(410, 0.06, 0.14, 'triangle', 0.010); _mpNoise(900, 0.18, 0.06, 0.012) }
const _mpPlayClear    = (lines = 1) => {
  _mpNoise(9000, 0.18, 0.11)
  const freqs = lines >= 4 ? [392, 523, 659, 784, 1047] : [392, 523, 659, 784]
  freqs.forEach((f, i) => _mpNote(f, 0.095, 0.18, 'sine', i * 0.062))
}
const _mpPlayLock = () => {
  const ctx = getMpAudio(); if (!ctx) return
  const osc = ctx.createOscillator(), g = ctx.createGain()
  osc.connect(g); g.connect(ctx.destination); osc.type = 'sine'
  const t = ctx.currentTime
  osc.frequency.setValueAtTime(110, t); osc.frequency.exponentialRampToValueAtTime(52, t + 0.07)
  g.gain.setValueAtTime(0.18 * _mpSfxVol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.10)
  osc.start(t); osc.stop(t + 0.11)
}
const mpPlayGarbageIn = () => { _mpNote(180, 0.22, 0.18, 'sawtooth'); _mpNoise(400, 0.15, 0.09, 0.02) }

// ─── Opponent mini-board ───────────────────────────────────────────────────────
function OpponentBoard({ snapshot, displayName, badge, score, wins = 0, isTarget = false, onClick, compact = false }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx  = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const cols = 10, visibleRows = 20
    const cw = W / cols, ch = H / visibleRows

    ctx.fillStyle = '#06060f'
    ctx.fillRect(0, 0, W, H)

    // Subtle grid
    ctx.strokeStyle = 'rgba(255,255,255,0.025)'
    ctx.lineWidth = 0.5
    for (let c = 1; c < cols; c++) { ctx.beginPath(); ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, H); ctx.stroke() }
    for (let r = 1; r < visibleRows; r++) { ctx.beginPath(); ctx.moveTo(0, r * ch); ctx.lineTo(W, r * ch); ctx.stroke() }

    // Locked cells with real piece colors (supports compact boardRows format)
    if (snapshot?.boardRows) {
      const rowsArr = snapshot.boardRows
      // Skip hidden spawn rows (0–1). Map visible 20 rows 0..19 ← 2..21
      for (let vr = 0; vr < visibleRows; vr++) {
        const srcIdx = vr + 2
        const rowStr = rowsArr[srcIdx] || ''
        for (let c = 0; c < cols; c++) {
          const sym = rowStr[c]
          if (!sym || sym === '.') continue
          const color = sym === 'G' ? '#444' : (PIECES[sym]?.color ?? '#00d4ff')
          ctx.fillStyle = color
          ctx.fillRect(c * cw + 0.5, vr * ch + 0.5, cw - 1, ch - 1)
        }
      }
    } else if (snapshot?.board) {
      // Back-compat for old nested-array snapshots
      for (let r = 2; r < visibleRows + 2; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = snapshot.board?.[r]?.[c]
          if (!cell) continue
          ctx.fillStyle = cell === 'GBG' ? '#444' : (PIECES[cell]?.color ?? '#00d4ff')
          ctx.fillRect(c * cw + 0.5, (r - 2) * ch + 0.5, cw - 1, ch - 1)
        }
      }
    }
    // Falling piece (semi-transparent)
    if (snapshot?.current) {
      const { type, x, y } = snapshot.current
      const shapeRows = snapshot.current.rows
      const matrix = shapeRows ? shapeRows.map(r => Array.from(r).map(ch => ch === '1')) : snapshot.current.matrix
      ctx.fillStyle  = PIECES[type]?.color ?? '#ccc'
      ctx.globalAlpha = 0.8
      matrix?.forEach((row, dy) => {
        row?.forEach((cell, dx) => {
          if (!cell) return
          const px = x + dx, py = y + dy
          if (py < 2 || py >= visibleRows + 2 || px < 0 || px >= cols) return
          ctx.fillRect(px * cw + 0.5, (py - 2) * ch + 0.5, cw - 1, ch - 1)
        })
      })
      ctx.globalAlpha = 1
    }

    // If no snapshot yet, show a tiny hint
    if (!snapshot?.boardRows && !snapshot?.board && !snapshot?.current) {
      ctx.fillStyle = 'rgba(200,200,220,0.35)'
      ctx.font = '8px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('waiting…', W / 2, H / 2)
    }
  }, [snapshot])

  const CW = compact ? 60 : 72
  const CH = compact ? 120 : 144
  return (
    <div onClick={onClick}
      style={{ background: 'rgba(5,5,20,0.9)', border: '1px solid rgba(255,255,255,0.1)', cursor: onClick ? 'pointer' : 'default', borderRadius: 5, padding: '3px 3px 2px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
          <div style={{ fontSize: '0.48rem', color: '#777', letterSpacing: '0.07em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 54 }}>{displayName}</div>
          {badge && <span style={{ fontSize: '0.42rem', color: '#c084fc', border: '1px solid #c084fc55', borderRadius: 3, padding: '0 3px', letterSpacing: '0.08em' }}>{String(badge).replace('badge_', '').toUpperCase()}</span>}
        </div>
        <div style={{ fontSize: '0.52rem', color: '#f97316', fontWeight: 700 }}>×{wins}</div>
      </div>
      <div style={{ position: 'relative', width: CW, height: CH, margin: '0 auto' }}>
        <canvas ref={canvasRef} width={CW} height={CH} style={{ display: 'block', borderRadius: 2, width: CW, height: CH }} />
        {isTarget && (
          <div style={{ position: 'absolute', top: 3, right: 3, width: 8, height: 8, borderRadius: '50%', background: '#00e5ff', boxShadow: '0 0 8px #00e5ffaa' }} />
        )}
      </div>
      <div style={{ fontSize: '0.46rem', color: '#00d4ff', marginTop: 2, textAlign: 'center' }}>{(score || 0).toLocaleString()}</div>
    </div>
  )
}

// ─── Mini piece preview ────────────────────────────────────────────────────────
function PieceMini({ type, size = 11 }) {
  const canvasRef = useRef(null)
  const color = type ? (PIECES[type]?.color ?? '#888') : '#333'
  const piece = type ? PIECES[type] : null

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!piece) return
    const { matrix } = piece
    const filled = matrix.filter(r => r.some(Boolean))
    if (!filled.length) return
    const colMin = Math.min(...filled.map(r => r.findIndex(Boolean)))
    const colMax = Math.max(...filled.map(r => r.length - 1 - [...r].reverse().findIndex(Boolean)))
    const tw = colMax - colMin + 1, th = filled.length
    const ox = Math.floor((4 - tw) / 2) * size
    const oy = Math.floor((2 - th) / 2) * size
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 4
    filled.forEach((row, ry) => {
      for (let cx = colMin; cx <= colMax; cx++) {
        if (!row[cx]) continue
        ctx.fillRect(ox + (cx - colMin) * size + 1, oy + ry * size + 1, size - 2, size - 2)
      }
    })
  }, [type, color, size, piece])

  return <canvas ref={canvasRef} width={4 * size} height={2 * size} style={{ display: 'block' }} />
}

// ─── Create lobby screen ──────────────────────────────────────────────────────
function CreateScreen({ onCreate }) {
  const { user, userProfile } = useAuth()
  const [busy, setBusy]       = useState(false)
  const displayName = userProfile?.displayName || user?.displayName || 'Player'

  const handle = async () => {
    setBusy(true)
    try { await onCreate() } catch { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', padding: '2rem' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '1rem', fontWeight: 900, letterSpacing: '0.14em', color: '#f97316' }}>CREATE LOBBY</div>
        <div style={{ fontSize: '0.65rem', color: '#555', marginTop: 6, letterSpacing: '0.1em' }}>Share the code or QR with your opponents</div>
      </div>
      <motion.button
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
        disabled={busy} onClick={handle}
        style={{ background: 'linear-gradient(135deg,#f97316,#ef4444)', border: 'none', color: '#fff', borderRadius: 10, padding: '12px 28px', fontSize: '0.88rem', fontWeight: 700, letterSpacing: '0.14em', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.7 : 1 }}
      >
        {busy ? 'CREATING…' : 'CREATE LOBBY'}
      </motion.button>
      <div style={{ fontSize: '0.65rem', color: '#555', letterSpacing: '0.08em' }}>Playing as: <span style={{ color: '#ccc' }}>{displayName}</span></div>
    </div>
  )
}

// ─── Join screen ───────────────────────────────────────────────────────────────
function JoinScreen({ onJoin, initialCode = '' }) {
  const [code, setCode] = useState(() => initialCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
  const [err, setErr]   = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setCode(initialCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
  }, [initialCode])

  const handle = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await onJoin(code.toUpperCase().trim()) }
    catch (ex) { setErr(ex.message); setBusy(false) }
  }

  return (
    <form onSubmit={handle} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '2rem' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '1rem', fontWeight: 900, letterSpacing: '0.14em', color: '#00d4ff' }}>JOIN LOBBY</div>
        <div style={{ fontSize: '0.65rem', color: '#555', marginTop: 6, letterSpacing: '0.1em' }}>Enter the 6-character code</div>
      </div>
      {err && <div style={{ fontSize: '0.75rem', color: '#f87171', letterSpacing: '0.06em' }}>{err}</div>}
      <input
        value={code}
        onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
        placeholder="XXXXXX" maxLength={6} required
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, color: '#fff', padding: '10px 14px', fontSize: '1.4rem', letterSpacing: '0.35em', textAlign: 'center', width: 180, fontFamily: 'inherit', outline: 'none' }}
      />
      <motion.button
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
        type="submit" disabled={busy || code.length < 6}
        style={{ background: 'linear-gradient(135deg,#00d4ff,#0066ff)', border: 'none', color: '#fff', borderRadius: 10, padding: '11px 26px', fontSize: '0.88rem', fontWeight: 700, letterSpacing: '0.14em', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: (busy || code.length < 6) ? 0.6 : 1 }}
      >
        {busy ? 'JOINING…' : 'JOIN'}
      </motion.button>
    </form>
  )
}

// ─── Waiting room ─────────────────────────────────────────────────────────────
function WaitingRoom({ lobby, isHost, onStart, onLeave, onBestOfChange, selfUid, lobbyCode, selfDisplayName, playerProfiles = {} }) {
  const joinUrl = new URL(`${import.meta.env.BASE_URL}multiplayer?join=${lobby.code}`, window.location.origin).href
  const bestOf  = lobby.bestOf ?? 3
  const me = lobby.players.find(p => p.uid === selfUid)
  const myBuff = me?.buff ?? 0
  const myNerf = me?.nerf ?? 0
  const setBuff = (v) => updateLobbyPlayer(lobbyCode, selfUid, { buff: v, nerf: v > 0 ? 0 : (me?.nerf ?? 0) })
  const setNerf = (v) => updateLobbyPlayer(lobbyCode, selfUid, { nerf: v, buff: v > 0 ? 0 : (me?.buff ?? 0) })

  const [friends, setFriends] = useState([])
  const [inviteState, setInviteState] = useState({}) // uid → 'sending'|'sent'|'error'
  const [showFriends, setShowFriends] = useState(false)

  useEffect(() => {
    if (!selfUid) return
    getFriends(selfUid).then(setFriends).catch(() => {})
  }, [selfUid])

  const handleInvite = async (friend) => {
    if (inviteState[friend.uid]) return
    setInviteState(prev => ({ ...prev, [friend.uid]: 'sending' }))
    try {
      await sendLobbyInvite(selfUid, friend.uid, lobby.code, selfDisplayName)
      setInviteState(prev => ({ ...prev, [friend.uid]: 'sent' }))
    } catch {
      setInviteState(prev => ({ ...prev, [friend.uid]: 'error' }))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.4rem', padding: '2rem', maxWidth: 360, margin: '0 auto' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '0.55rem', letterSpacing: '0.3em', color: '#f97316', marginBottom: 6 }}>LOBBY CODE</div>
        <div style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '0.3em', color: '#fff', textShadow: '0 0 20px rgba(249,115,22,0.5)' }}>{lobby.code}</div>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, padding: 12 }}>
        <QRCode value={joinUrl} size={130} fgColor="#0a0a14" bgColor="#fff" />
      </div>

      {/* Buff / Nerf selectors (self). You can select either BUFF or NERF (not both). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 42, fontSize: '0.6rem', color: '#88d', letterSpacing: '0.12em' }}>BUFF</span>
          <input type="range" min={0} max={3} step={1} value={myBuff}
            onChange={e => setBuff(parseInt(e.target.value))}
            disabled={myNerf > 0}
            style={{ flex: 1, accentColor: '#00d4ff' }} />
          <span style={{ width: 20, textAlign: 'right', fontSize: '0.62rem', color: myBuff>0?'#00d4ff':'#777' }}>{myBuff}</span>
        </div>
        <div style={{ fontSize: '0.5rem', color: '#98c8ff', letterSpacing: '0.08em', margin: '-2px 0 6px 52px' }}>
          BUFF increases your outgoing sends. Set to 0 to turn off.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 42, fontSize: '0.6rem', color: '#f88', letterSpacing: '0.12em' }}>NERF</span>
          <input type="range" min={0} max={3} step={1} value={myNerf}
            onChange={e => setNerf(parseInt(e.target.value))}
            disabled={myBuff > 0}
            style={{ flex: 1, accentColor: '#f97316' }} />
          <span style={{ width: 20, textAlign: 'right', fontSize: '0.62rem', color: myNerf>0?'#f97316':'#777' }}>{myNerf}</span>
        </div>
        <div style={{ fontSize: '0.5rem', color: '#f7b285', letterSpacing: '0.08em', margin: '-2px 0 0 52px' }}>
          NERF reduces your outgoing sends. Set to 0 to turn off.
        </div>
      </div>

      {/* Best-of selector */}
      <div style={{ width: '100%' }}>
        <div style={{ fontSize: '0.52rem', color: '#888', letterSpacing: '0.14em', marginBottom: 6, textAlign: 'center' }}>MATCH FORMAT</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 3, 5, 7].map(n => (
            <button
              key={n}
              onClick={() => isHost && onBestOfChange(n)}
              style={{
                flex: 1,
                background: bestOf === n ? 'rgba(249,115,22,0.2)' : 'rgba(255,255,255,0.04)',
                border:     `1px solid ${bestOf === n ? '#f97316' : 'rgba(255,255,255,0.1)'}`,
                color:      bestOf === n ? '#f97316' : '#555',
                borderRadius: 7, padding: '8px 4px', fontSize: '0.68rem',
                fontWeight: 700, cursor: isHost ? 'pointer' : 'default',
                fontFamily: 'inherit', letterSpacing: '0.06em',
                opacity: isHost ? 1 : 0.7,
              }}
            >
              {n === 1 ? 'BO1' : `BO${n}`}
            </button>
          ))}
        </div>
        <div style={{ fontSize: '0.52rem', color: '#555', marginTop: 4, textAlign: 'center' }}>
          {bestOf === 1 ? 'Single match' : `Best of ${bestOf} — first to ${Math.ceil(bestOf / 2)} wins`}
          {!isHost && ' (host sets)'}
        </div>
      </div>

      {/* Player list (shows BUFF/NERF selections to everyone) */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lobby.players.map((p, i) => {
          const selBuff = p.buff ?? 0
          const selNerf = p.nerf ?? 0
          const tag = selBuff > 0 ? { label: `BUFF +${selBuff}`, color: '#00d4ff', bg: 'rgba(0,212,255,0.15)', border: '#00d4ff' }
                    : selNerf > 0 ? { label: `NERF +${selNerf}`, color: '#f97316', bg: 'rgba(249,115,22,0.15)', border: '#f97316' }
                    : null
          return (
          <div key={p.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: i === 0 ? 'linear-gradient(135deg,#f97316,#ef4444)' : 'linear-gradient(135deg,#00d4ff,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 900, flexShrink: 0 }}>
              {p.displayName[0].toUpperCase()}
            </div>
            <span style={{ flex: 1, fontSize: '0.82rem', color: '#ddd', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.displayName}</span>
              {playerProfiles[p.uid]?.selectedBadge && (
                <span style={{ fontSize: '0.55rem', color: '#c084fc', border: '1px solid #c084fc55', borderRadius: 3, padding: '1px 4px', letterSpacing: '0.10em' }}>{String(playerProfiles[p.uid]?.selectedBadge).replace('badge_', '').toUpperCase()}</span>
              )}
            </span>
            {tag ? (
              <span style={{ fontSize: '0.6rem', color: tag.color, background: tag.bg, border: `1px solid ${tag.border}`, padding: '2px 6px', borderRadius: 6, marginRight: 6, letterSpacing: '0.08em' }}>{tag.label}</span>
            ) : (
              <span style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.08em', marginRight: 6 }}>—</span>
            )}
            <span style={{ fontSize: '0.6rem', color: i === 0 ? '#f97316' : '#555', letterSpacing: '0.14em' }}>{i === 0 ? 'HOST' : 'GUEST'}</span>
          </div>
        )})}
        {lobby.players.length < 2 && (
          <div style={{ textAlign: 'center', fontSize: '0.65rem', color: '#555', letterSpacing: '0.12em', padding: '8px', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 8 }}>
            Waiting for players… ({lobby.players.length}/8)
          </div>
        )}
      </div>

      {/* Invite Friends */}
      {friends.length > 0 && (
        <div style={{ width: '100%' }}>
          <button
            onClick={() => setShowFriends(v => !v)}
            style={{ width: '100%', background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.25)', color: '#c084fc', borderRadius: 8, padding: '8px 14px', fontSize: '0.65rem', letterSpacing: '0.12em', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span>👥 INVITE FRIENDS</span>
            <span style={{ color: '#a855f7' }}>{showFriends ? '▲' : '▼'}</span>
          </button>
          <AnimatePresence>
            {showFriends && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8 }}>
                  {friends.map(f => {
                    const st = inviteState[f.uid]
                    const alreadyIn = lobby.players.some(p => p.uid === f.uid)
                    return (
                      <div key={f.uid} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 7, padding: '7px 10px' }}>
                        <div style={{ flex: 1, fontSize: '0.75rem', color: '#ddd', letterSpacing: '0.06em' }}>{f.displayName || f.uid?.slice(0, 8)}</div>
                        {alreadyIn ? (
                          <span style={{ fontSize: '0.6rem', color: '#22c55e', letterSpacing: '0.08em' }}>In lobby</span>
                        ) : (
                          <button
                            onClick={() => handleInvite(f)}
                            disabled={!!st}
                            style={{ background: st === 'sent' ? 'rgba(34,197,94,0.1)' : 'rgba(168,85,247,0.15)', border: `1px solid ${st === 'sent' ? '#22c55e55' : 'rgba(168,85,247,0.4)'}`, color: st === 'sent' ? '#22c55e' : st === 'error' ? '#f87171' : '#c084fc', borderRadius: 6, padding: '3px 10px', fontSize: '0.62rem', cursor: st ? 'default' : 'pointer', fontFamily: 'inherit', letterSpacing: '0.08em' }}
                          >
                            {st === 'sending' ? '…' : st === 'sent' ? '✓ Sent' : st === 'error' ? '✗' : 'Invite'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, width: '100%', justifyContent: 'center' }}>
        {isHost && lobby.players.length >= 2 && (
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onStart}
            style={{ background: '#22c55e', border: 'none', color: '#000', borderRadius: 8, padding: '11px 24px', fontSize: '0.82rem', fontWeight: 700, letterSpacing: '0.14em', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            START GAME
          </motion.button>
        )}
        <button onClick={onLeave} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: '#888', borderRadius: 8, padding: '10px 18px', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.1em' }}>
          LEAVE
        </button>
      </div>
    </div>
  )
}

// ─── Screen states ─────────────────────────────────────────────────────────────
const SCREEN = { PICK: 'pick', CREATE: 'create', JOIN: 'join', LOBBY: 'lobby', GAME: 'game', ROUND_END: 'round_end', RESULT: 'result' }

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function MultiplayerPage() {
  const navigate    = useNavigate()
  const { user, userProfile } = useAuth()
  const displayName = userProfile?.displayName || user?.displayName || 'Player'

  const [screen,      setScreen]      = useState(SCREEN.PICK)
  const [lobbyCode,   setLobbyCode]   = useState(null)
  const [lobby,       setLobby]       = useState(null)
  const [isHost,      setIsHost]      = useState(false)
  const [myState,     setMyState]     = useState(null)
  // No pause in multiplayer; keep state for overlay suppression
  const [_paused, setPaused] = useState(false)
  const [muted,       setMuted]       = useState(false)
  const [showVolumePanel, setShowVolumePanel] = useState(false)
  const [musicVol, setMusicVol] = useState(1)
  const [sfxVol, setSfxVolState] = useState(2)
  const [roundResult, setRoundResult] = useState(null)
  const [showFriendsPanel, setShowFriendsPanel] = useState(false)
  const [friends, setFriends] = useState([])
  const [friendRequests, setFriendRequests] = useState([])
  const [sentFriendRequests, setSentFriendRequests] = useState([])
  const [frLoading, setFrLoading] = useState(false)
  const [frAction, setFrAction] = useState({}) // id -> 'accepting'|'declining'
  const [friendCodeInput, setFriendCodeInput] = useState('')
  const [friendCodeState, setFriendCodeState] = useState({ kind: 'idle', message: '' })
  const [playerProfiles, setPlayerProfiles] = useState({}) // uid -> { selectedBadge }
  const [lobbyInvites, setLobbyInvites] = useState([])
  const [dismissedInvites, setDismissedInvites] = useState(new Set())
  const [joinCodePrefill, setJoinCodePrefill] = useState('')
  const [lastLobbyCode, setLastLobbyCode] = useState(() => {
    try { return localStorage.getItem(LAST_LOBBY_KEY) || '' } catch { return '' }
  })
  const [rejoinBusy, setRejoinBusy] = useState(false)
  const [rejoinError, setRejoinError] = useState('')
  const [focus, setFocus] = useState(() => { try { return localStorage.getItem('vs-focus-mode') === '1' } catch { return false } })
  const [isLandscape, setIsLandscape] = useState(() => {
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    return window.innerWidth > window.innerHeight && hasTouch
  })

  const engine = useMemo(() => new TetrisEngine(), [])

  const heldRef            = useRef({ left: false, right: false, softDrop: false })
  const actionRef          = useRef({})
  const pausedRef          = useRef(false)
  const mutedRef           = useRef(false)
  const screenRef          = useRef(SCREEN.PICK)
  const lobbyRef           = useRef(null)
  const lastSeenRoundRef   = useRef(0)    // which round the engine was last reset for
  const roundEndDoneRef    = useRef(false) // host-only: prevents double round-end processing
  const roundTimerRef      = useRef(null) // cleanup handle for 3-second round-end delay
  const garbageSentToRef   = useRef({})   // { [targetUid]: totalSentToThem }
  const opponentGarbageRef = useRef({})   // { [senderUid]: totalApplied }
  const [targetUid, setTargetUid] = useState(null)
  const [previewPage, setPreviewPage] = useState(0)
  const [previewDirection, setPreviewDirection] = useState(0)
  const swipeStartRef = useRef(null)
    // Auto-join via URL (?join= or ?code=) or legacy hash (#join:CODE)
    useEffect(() => {
      try {
        const url = new URL(window.location.href)
        let code = (url.searchParams.get('join') || url.searchParams.get('code') || '').toUpperCase()
        if (!code && window.location.hash.startsWith('#join:')) code = window.location.hash.slice(6).toUpperCase()
        if (code && /^[A-Z0-9]{6}$/.test(code)) {
          handleJoin(code).catch(() => setScreen(SCREEN.JOIN))
        }
      } catch {}
    }, [])
  const currentTargetRef   = useRef(null) // current random garbage target UID
  const lastSnapRef        = useRef(0)
  const unsubRef           = useRef(null)
  const prevStateRef       = useRef(null) // previous engine state for SFX edge detection

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
  const persistAudioConfig = useCallback((nextMusicVol, nextSfxVol) => {
    try {
      const cfg = JSON.parse(localStorage.getItem('tetris-config') ?? '{}')
      cfg.musicVolume = nextMusicVol
      cfg.sfxVolume = nextSfxVol
      cfg.sfxEnabled = nextSfxVol > 0
      localStorage.setItem('tetris-config', JSON.stringify(cfg))
    } catch {}
  }, [])

  const applyAudioLevels = useCallback((nextMusicVol, nextSfxVol, { persist = true } = {}) => {
    const music = clamp(nextMusicVol, 0, 1)
    const sfx = clamp(nextSfxVol, 0, 2)

    setMusicVol(music)
    setSfxVolState(sfx)
    if (persist) persistAudioConfig(music, sfx)

    mpSetMusicVolume(music)
    if (mutedRef.current) {
      _mpMusicMgr?.setVolume(0)
      mpMuteMusic(true)
      _mpSfxVol = 0
      setSfxVolume(0)
      return
    }

    _mpMusicMgr?.setVolume(music)
    mpMuteMusic(false)
    _mpSfxVol = sfx
    setSfxVolume(_mpSfxVol)
  }, [persistAudioConfig])

  // Keep refs in sync with state
  useEffect(() => { screenRef.current = screen }, [screen])
  useEffect(() => { lobbyRef.current  = lobby  }, [lobby])

  // Load lobby invites once when user is available
  useEffect(() => {
    if (!user) return
    getLobbyInvites(user.uid).then(setLobbyInvites).catch(() => {})
  }, [user])
  // Persist focus mode + F hotkey
  useEffect(() => { try { localStorage.setItem('vs-focus-mode', focus ? '1' : '0') } catch {} }, [focus])
  useEffect(() => {
    const onKey = (e) => { if (e.code === 'KeyF') setFocus(f => !f) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Landscape detection
  useEffect(() => {
    const onResize = () => {
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      setIsLandscape(window.innerWidth > window.innerHeight && hasTouch)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // WS streaming disabled — Firestore-only path remains

  const showOnScreenControls = (() => {
    try { return JSON.parse(localStorage.getItem('tetris-config') ?? '{}').showOnScreenControls ?? false }
    catch { return false }
  })()

  // ── Init SFX volume from config; stop music on unmount ────────────────────────
  useEffect(() => {
    try {
      const cfg = JSON.parse(localStorage.getItem('tetris-config') ?? '{}')
      const initialMusic = clamp(cfg.musicVolume ?? 1.0, 0, 1)
      const initialSfx = cfg.sfxEnabled !== false ? clamp(cfg.sfxVolume ?? 2.0, 0, 2) : 0
      applyAudioLevels(initialMusic, initialSfx, { persist: false })
    } catch {}
    return () => {
      clearTimeout(roundTimerRef.current)
      _mpMusicMgr?.stop()
      mpStopMusic()
    }
  }, [applyAudioLevels])

  // ── Lobby / match music ───────────────────────────────────────────────────────
  useEffect(() => {
    if (screen === SCREEN.LOBBY) {
      mpPlayLobbyMusic()
    } else if (screen === SCREEN.GAME) {
      mpStopMusic()          // match music handled by _mpMusicMgr below
    } else {
      mpStopMusic()          // PICK / CREATE / JOIN / ROUND_END / RESULT
    }
  }, [screen])

  useEffect(() => {
    if (screen !== SCREEN.GAME && screen !== SCREEN.LOBBY) setShowVolumePanel(false)
  }, [screen])

  // Load friends + pending requests once for panel
  useEffect(() => {
    if (!user) return
    setFrLoading(true)
    Promise.all([getFriends(user.uid), getFriendRequests(user.uid), getSentFriendRequests(user.uid)])
      .then(([fs, reqs, sent]) => { setFriends(fs); setFriendRequests(reqs); setSentFriendRequests(sent) })
      .catch(() => {})
      .finally(() => setFrLoading(false))
  }, [user])

  const handleAcceptReq = useCallback(async (req) => {
    if (!user) return
    setFrAction(p => ({ ...p, [req.id]: 'accepting' }))
    try {
      await acceptFriendRequest(user.uid, req.id, req, displayName)
      setFriendRequests(list => list.filter(r => r.id !== req.id))
      setFriends(list => [...list, { uid: req.fromUid, displayName: req.fromName }])
    } finally { setFrAction(p => ({ ...p, [req.id]: undefined })) }
  }, [user, displayName])

  const handleDeclineReq = useCallback(async (req) => {
    if (!user) return
    setFrAction(p => ({ ...p, [req.id]: 'declining' }))
    try { await declineFriendRequest(user.uid, req.id); setFriendRequests(list => list.filter(r => r.id !== req.id)) }
    finally { setFrAction(p => ({ ...p, [req.id]: undefined })) }
  }, [user])

  const handleAddByFriendCode = useCallback(async () => {
    if (!user?.uid) return
    const code = friendCodeInput.trim()
    if (!code) {
      setFriendCodeState({ kind: 'error', message: 'Enter a friend ID first.' })
      return
    }
    setFriendCodeState({ kind: 'loading', message: 'Looking up player…' })
    try {
      const profile = await findPublicProfileByFriendCode(code)
      if (!profile) {
        setFriendCodeState({ kind: 'error', message: 'No player found for that ID.' })
        return
      }
      if (profile.uid === user.uid) {
        setFriendCodeState({ kind: 'error', message: 'That is your own friend ID.' })
        return
      }
      await sendFriendRequest(user.uid, profile.uid, displayName)
      setSentFriendRequests((prev) => [{ id: `local-${profile.uid}`, fromUid: user.uid, toUid: profile.uid, toName: profile.displayName, status: 'pending' }, ...prev.filter((entry) => entry.toUid !== profile.uid)])
      setFriendCodeState({ kind: 'success', message: `Request sent to ${profile.displayName}.` })
      setFriendCodeInput('')
    } catch (err) {
      setFriendCodeState({ kind: 'error', message: err?.message || 'Could not send request.' })
    }
  }, [displayName, friendCodeInput, user])

  // ── Apply DAS / ARR from user config ──────────────────────────────────────────
    // Load public profiles for current lobby players to show badges
    useEffect(() => {
      const uids = (lobby?.players || []).map(p => p.uid).filter(Boolean)
      if (!uids.length) { setPlayerProfiles({}); return }
      getPublicProfiles(uids).then(setPlayerProfiles).catch(() => {})
    }, [lobby])
  useEffect(() => {
    try {
      const cfg = JSON.parse(localStorage.getItem('tetris-config') ?? '{}')
      engine.setSettings({ das: cfg.das ?? 110, arr: cfg.arr ?? 25 })
    } catch {}
  }, [engine])

  // ── Pause / resume ────────────────────────────────────────────────────────────
  const togglePause = useCallback(() => {
    // no-op: pause disabled in Versus
    pausedRef.current = false
    setPaused(false)
  }, [])

  // ── Mute ─────────────────────────────────────────────────────────────────────
  const applyMute = useCallback((mute) => {
    mutedRef.current = mute
    setMuted(mute)
    if (mute) {
      _mpMusicMgr?.setVolume(0)
      mpMuteMusic(true)
      _mpSfxVol = 0
      setSfxVolume(0)
    } else {
      _mpMusicMgr?.setVolume(musicVol)
      mpSetMusicVolume(musicVol)
      mpMuteMusic(false)
      _mpSfxVol = sfxVol
      setSfxVolume(_mpSfxVol)
    }
  }, [musicVol, sfxVol])
  const toggleMute = useCallback(() => applyMute(!mutedRef.current), [applyMute])
  const showAudioControls = screen === SCREEN.GAME || screen === SCREEN.LOBBY

  // ── Random garbage target selection ──────────────────────────────────────────
  const pickTarget = useCallback((lobbyData) => {
    const alive = (lobbyData?.players ?? []).filter(p => p.uid !== user?.uid && !p.gameOver)
    if (alive.length) {
      const uid = alive[Math.floor(Math.random() * alive.length)].uid
      currentTargetRef.current = uid
      setTargetUid(uid)
    }
  }, [user])
  const selectTarget = useCallback((uid) => { currentTargetRef.current = uid; setTargetUid(uid) }, [])

  // ── Host: process end of round ────────────────────────────────────────────────
  const endRound = useCallback(async (lobbyData, winnerUid) => {
    if (!lobbyCode) return
    const prevWins   = lobbyData.roundWins ?? {}
    const newWins    = { ...prevWins, [winnerUid]: (prevWins[winnerUid] ?? 0) + 1 }
    const bestOf     = lobbyData.bestOf ?? 3
    const winsNeeded = Math.ceil(bestOf / 2)

    if (newWins[winnerUid] >= winsNeeded) {
      await updateLobby(lobbyCode, { roundWins: newWins, status: 'finished', matchWinner: winnerUid })
    } else {
      const nextRound    = (lobbyData.currentRound ?? 1) + 1
      const resetPlayers = lobbyData.players.map(p => ({
        ...p, gameOver: false, score: 0, boardSnapshot: null, garbageSentTo: {},
      }))
      // Keeping status = 'playing' with new currentRound triggers all clients to restart
      await updateLobby(lobbyCode, { roundWins: newWins, currentRound: nextRound, players: resetPlayers })
    }
  }, [lobbyCode])

  // Stable ref so the subscribeLobby closure always calls the latest endRound
  const endRoundRef = useRef(endRound)
  useEffect(() => { endRoundRef.current = endRound }, [endRound])

  // ── Lobby subscription ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!lobbyCode) return

    const unsub = subscribeLobby(lobbyCode, (data) => {
      setLobby(data)

      // New round start (first game or subsequent rounds)
      if (data.status === 'playing' && (data.currentRound ?? 1) !== lastSeenRoundRef.current) {
        lastSeenRoundRef.current  = data.currentRound ?? 1
        roundEndDoneRef.current   = false
        garbageSentToRef.current   = {}
        opponentGarbageRef.current = {}
        prevStateRef.current       = null

        engine.reset(GAME_MODE.VERSUS)
        setMyState(engine.getState())
        setScreen(SCREEN.GAME)
        setPaused(false)
        pausedRef.current = false

        getMpAudio()
        try {
          const cfg = JSON.parse(localStorage.getItem('tetris-config') ?? '{}')
          _mpMusicMgr?.setVolume(mutedRef.current ? 0 : (cfg.musicVolume ?? 1.0))
        } catch { _mpMusicMgr?.setVolume(mutedRef.current ? 0 : 1.0) }
        _mpMusicMgr?.start()
        pickTarget(data)
        // Push an immediate snapshot so opponents see our board right away
        try {
          const s0 = engine.getState()
          const boardRows = (s0.board || []).map(row => (row || []).map(c => c === null ? '.' : (c === 'GBG' ? 'G' : c)).join(''))
          const curRows = s0.current?.matrix
            ? (s0.current.matrix || []).map(r => (r || []).map(v => (v ? '1' : '.')).join(''))
            : null
          updateLobbyPlayer(lobbyCode, user.uid, {
            score: s0.score,
            boardSnapshot: {
              boardRows,
              current: s0.current
                ? { type: s0.current.type, x: s0.current.x, y: s0.current.y, rows: curRows }
                : null,
              ts: Date.now(),
            },
          }).catch((err) => { try { console.error('[versus] initial snapshot failed', err) } catch {} })
        } catch {}
        return
      }

      // Match over
      if (data.status === 'finished') {
        _mpMusicMgr?.stop()
        const myW  = (data.roundWins ?? {})[user?.uid] ?? 0
        const topW = Math.max(0, ...Object.values(data.roundWins ?? {}).map(Number))
        setRoundResult({
          won: myW >= topW && myW > 0,
          roundWins:   data.roundWins ?? {},
          roundWinner: data.matchWinner,
          matchWinner: data.matchWinner,
        })
        setScreen(SCREEN.RESULT)
        return
      }

      // During a live round
      if (lastSeenRoundRef.current > 0 && data.status === 'playing') {
        const alive = data.players.filter(p => !p.gameOver)
        if (alive.length <= 1 && data.players.length > 1) {
          const winnerUid = alive[0]?.uid
            ?? data.players.reduce((b, p) => (p.score > (b?.score ?? -1) ? p : b), data.players[0])?.uid
          setRoundResult(prev => ({
            ...(prev ?? {}),
            roundWinner: winnerUid,
            roundWins: data.roundWins ?? prev?.roundWins ?? {},
          }))
        }

        // Incoming garbage: compute delta per opponent
        let gotGarbage = false
        for (const p of (data.players ?? [])) {
          if (p.uid === user?.uid) continue
          const incoming = p.garbageSentTo?.[user?.uid] ?? 0
          const applied  = opponentGarbageRef.current[p.uid] ?? 0
          if (incoming > applied) {
            const self = data.players.find(pp => pp.uid === user?.uid)
            const buff = self?.buff ?? 0
            const nerf = self?.nerf ?? 0
            const delta = Math.max(0, (incoming - applied) + nerf - buff)
            engine.receiveGarbage(delta)
            opponentGarbageRef.current[p.uid] = incoming
            gotGarbage = true
          }
        }
        if (gotGarbage && screenRef.current === SCREEN.GAME) mpPlayGarbageIn()

        // Host-only: detect round end (≤1 player alive)
        if (isHost && !roundEndDoneRef.current) {
          if (alive.length <= 1 && data.players.length > 1) {
            roundEndDoneRef.current = true
            _mpMusicMgr?.stop()
            const winnerUid = alive[0]?.uid
              ?? data.players.reduce((b, p) => (p.score > (b?.score ?? -1) ? p : b), data.players[0])?.uid
            const wonRound = winnerUid === user?.uid
            setRoundResult({ won: wonRound, roundWins: data.roundWins ?? {}, roundWinner: winnerUid })
            if (screenRef.current === SCREEN.GAME) setScreen(SCREEN.ROUND_END)
            // Delay 3s so players can see the round result before the next round starts
            clearTimeout(roundTimerRef.current)
            roundTimerRef.current = setTimeout(() => endRoundRef.current(data, winnerUid), 3000)
          }
        }
      }
    })

    unsubRef.current = unsub
    return () => unsub()
  }, [lobbyCode, isHost, user, engine, pickTarget])  

  // ── Game rAF loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== SCREEN.GAME) return
    let frameId, lastTime = performance.now()

    const frame = (now) => {
      const dt      = Math.min(now - lastTime, MAX_FRAME_MS); lastTime = now
      const actions = actionRef.current
      actionRef.current = {}

      engine.update(dt, heldRef.current, actions)
      const ns   = engine.getState()
      const prev = prevStateRef.current
      setMyState(ns)

      // No WS stream sending in this build

      // SFX + synesthesia triggers (edge detection against prev frame)
      if (prev) {
        const theme = 'classic'
        if (ns.hardDropped)               { playHardDropSFX(theme); emitSynesthesia(SYNESTHESIA_EVENT.HARD_DROP, { intensity: 1.24 }) }
        else if (ns.pieceLocked)          playLockSFX(theme)
        if (ns.lastClear?.lines > 0) {
          const _spinType = ns.lastClear.spinType
          const _lines    = ns.lastClear.lines
          const _isSpin   = _spinType === 'tSpin' || _spinType === 'allSpin' || _spinType === 'tSpinMini'
          if (_isSpin) emitSynesthesia(SYNESTHESIA_EVENT.T_SPIN, { intensity: _lines >= 2 ? 1.45 : 1.18, lines: _lines })
          else emitSynesthesia(SYNESTHESIA_EVENT.LINE_CLEAR, { intensity: Math.min(1.5, 0.9 + _lines * 0.2), lines: _lines })
          if (_lines >= 4) playTetrisSFX(theme)
          else playLineClearSFX(theme, ns.combo ?? 0)
        }
        if (ns.pieceHeld)                 playHoldSFX(theme)
        // Move / rotate: only fire when the SAME piece is moving (not on spawn)
        if (prev.current?.type === ns.current?.type) {
          if (ns.current?.x !== prev.current?.x)          { playMoveSFX(theme); emitSynesthesia(SYNESTHESIA_EVENT.MOVE, { intensity: 0.9 }) }
          else if (ns.current?.rotation !== prev.current?.rotation) { playRotateSFX(theme); emitSynesthesia(SYNESTHESIA_EVENT.ROTATE, { intensity: 1.0 }) }
        }
      }      prevStateRef.current = ns

      // Zone LPF music effect
      if (prev?.zoneActive !== ns.zoneActive) _mpMusicMgr?.setZoneFx?.(ns.zoneActive)

      // Outgoing garbage — uses random target, re-rolls after each attack
      if (ns.lastGarbage > 0 && lobbyCode && currentTargetRef.current) {
        const tgt = currentTargetRef.current
        const self = lobbyRef.current?.players?.find(p => p.uid === user?.uid)
        const buff = self?.buff ?? 0
        const nerf = self?.nerf ?? 0
        const adjusted = Math.max(0, ns.lastGarbage + buff - nerf)
        garbageSentToRef.current[tgt] = (garbageSentToRef.current[tgt] ?? 0) + adjusted
        updateLobbyPlayer(lobbyCode, user.uid, {
          garbageSentTo: { ...garbageSentToRef.current },
          score: ns.score,
        }).catch((err) => { try { console.error('[versus] send garbage failed', err) } catch {} })
        if (lobbyRef.current) pickTarget(lobbyRef.current)  // pick a new random target
      }

      // Game over: write to Firestore, host's subscribeLobby will call endRound
      if (ns.gameOver) {
        if (lobbyCode) updateLobbyPlayer(lobbyCode, user.uid, { score: ns.score, gameOver: true }).catch(() => {})
        _mpMusicMgr?.stop()
        setRoundResult({ won: false, roundWins: lobbyRef.current?.roundWins ?? {}, roundWinner: null })
        setScreen(SCREEN.ROUND_END)
        return
      }

      // Periodic board snapshot for opponent preview
      if (lobbyCode && now - lastSnapRef.current > SNAP_INTERVAL_MS) {
        lastSnapRef.current = now
        updateLobbyPlayer(lobbyCode, user.uid, {
          score: ns.score,
          boardSnapshot: {
            boardRows: (ns.board || []).map(row => (row || []).map(c => c === null ? '.' : (c === 'GBG' ? 'G' : c)).join('')),
            current: ns.current
              ? { type: ns.current.type, x: ns.current.x, y: ns.current.y, rows: (ns.current.matrix || []).map(r => (r || []).map(v => (v ? '1' : '.')).join('')) }
              : null,
            ts: Date.now(),
          },
        }).catch((err) => { try { console.error('[versus] periodic snapshot failed', err) } catch {} })
      }

      frameId = requestAnimationFrame(frame)
    }
    frameId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(frameId)
  }, [screen]) // eslint-disable-line

  // ── Keyboard ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== SCREEN.GAME) return
    const down = (ev) => {
      const b = KEY_BINDINGS[ev.code]; if (!b) return
      ev.preventDefault(); if (ev.repeat) return
      if (b.held) heldRef.current[b.held] = true
      if (b.action) {
        if (b.action === 'mute') toggleMute()
        else actionRef.current[b.action] = true
      }
    }
    const up = (ev) => {
      const b = KEY_BINDINGS[ev.code]
      if (b?.held) { ev.preventDefault(); heldRef.current[b.held] = false }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup',   up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [screen, togglePause, toggleMute])

  // ── Gamepad ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== SCREEN.GAME) return
    const AXIS_DEAD = 0.35
    const GP_HELD_MAP = { 13: 'softDrop', 14: 'left', 15: 'right' }
    const GP_ACTION_MAP = {
      12: 'hardDrop',     // D-pad up
      0:  'rotateCCW',    // A / Cross
      1:  'rotateCW',     // B / Circle
      2:  'rotateCCW',    // X / Square
      3:  'rotate180',    // Y / Triangle
      4:  'hold',         // LB / L1
      5:  'hold',         // RB / R1
      6:  'activateZone', // LT / L2
      7:  'activateZone', // RT / R2
      9:  'pause',        // Start
    }
    const prevButtons = {}
    let gpHeldRef = { left: false, right: false, softDrop: false }
    let rafId

    const poll = () => {
      const gamepads = navigator.getGamepads?.()
      if (gamepads) {
        let gpLeft = false, gpRight = false, gpSoftDrop = false
        for (const gp of gamepads) {
          if (!gp) continue
          if (!prevButtons[gp.index]) prevButtons[gp.index] = {}
          const prev = prevButtons[gp.index]
          // Held: D-pad
          for (const [bi, key] of Object.entries(GP_HELD_MAP)) {
            if (gp.buttons[bi]?.pressed) {
              if (key === 'left')     gpLeft     = true
              if (key === 'right')    gpRight    = true
              if (key === 'softDrop') gpSoftDrop = true
            }
          }
          // Held: left analog stick
          const ax = gp.axes[0] ?? 0
          const ay = gp.axes[1] ?? 0
          if (ax < -AXIS_DEAD) gpLeft     = true
          if (ax >  AXIS_DEAD) gpRight    = true
          if (ay >  AXIS_DEAD) gpSoftDrop = true
          // Actions: rising edge only
          for (const [bi, action] of Object.entries(GP_ACTION_MAP)) {
            const pressed = !!gp.buttons[bi]?.pressed
            if (pressed && !prev[bi]) {
              if (action === 'pause') {
                toggleMute()
              } else {
                actionRef.current[action] = true
              }
            }
            prev[bi] = pressed
          }
        }
        gpHeldRef.left     = gpLeft
        gpHeldRef.right    = gpRight
        gpHeldRef.softDrop = gpSoftDrop
        heldRef.current = { ...heldRef.current, ...gpHeldRef }
      }
      rafId = requestAnimationFrame(poll)
    }
    rafId = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(rafId)
  }, [screen, toggleMute])

  // ── Input callbacks ───────────────────────────────────────────────────────────
  const triggerAction  = useCallback((a) => { actionRef.current[a] = true }, [])
  const handlePress    = useCallback((k, held) => { if (held) heldRef.current[k] = true; else triggerAction(k) }, [triggerAction])
  const handleRelease  = useCallback((k) => { heldRef.current[k] = false }, [])

  const handleDragBegin = useCallback((dir) => {
    if (dir === 'left' || dir === 'right') handlePress(dir, true)
    else if (dir === 'down') { playSoftDropSFX('classic'); handlePress('softDrop', true) }
    else if (dir === 'up')   triggerAction('hold')
  }, [handlePress, triggerAction])
  const handleDragEnd = useCallback((dir) => {
    if (dir === 'left' || dir === 'right') handleRelease(dir)
    else if (dir === 'down') handleRelease('softDrop')
  }, [handleRelease])
  const handleHardDrop = useCallback(() => {
    handleRelease('softDrop'); triggerAction('hardDrop')
  }, [handleRelease, triggerAction])

  // ── Lobby actions ─────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    getMpAudio()  // prime AudioContext during user gesture
    const code = await createLobby(user.uid, displayName)
    try { localStorage.setItem(LAST_LOBBY_KEY, code) } catch {}
    setLastLobbyCode(code)
    setRejoinError('')
    setLobbyCode(code); setIsHost(true); setScreen(SCREEN.LOBBY)
  }
  const handleJoin = async (code) => {
    getMpAudio()  // prime AudioContext during user gesture
    await joinLobby(code, user.uid, displayName)
    try { localStorage.setItem(LAST_LOBBY_KEY, code) } catch {}
    setLastLobbyCode(code)
    setRejoinError('')
    setLobbyCode(code); setIsHost(false); setScreen(SCREEN.LOBBY)
  }
  const handleRejoin = useCallback(async () => {
    const code = String(lastLobbyCode || '').toUpperCase().trim()
    if (!code || !user?.uid) return
    setRejoinBusy(true)
    setRejoinError('')
    try {
      getMpAudio()
      const lobbyData = await rejoinLobby(code, user.uid)
      setLobby(lobbyData)
      setLobbyCode(code)
      setIsHost(lobbyData.hostUid === user.uid)
      setScreen(lobbyData.status === 'waiting' ? SCREEN.LOBBY : SCREEN.LOBBY)
    } catch (err) {
      const message = err?.message || 'Could not rejoin the last lobby.'
      setRejoinError(message)
      if (message === 'Lobby not found' || message === 'You are not part of this lobby') {
        try { localStorage.removeItem(LAST_LOBBY_KEY) } catch {}
        setLastLobbyCode('')
      }
    } finally {
      setRejoinBusy(false)
    }
  }, [lastLobbyCode, user])
  const handleStart = async () => {
    getMpAudio()  // warm up context before Firestore fires
    if (lobbyCode) await setLobbyStatus(lobbyCode, 'playing')
  }
  const handleBestOfChange = async (n) => {
    if (lobbyCode) await setLobbyBestOf(lobbyCode, n)
  }
  const handleLeave = () => {
    clearTimeout(roundTimerRef.current)
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
    lastSeenRoundRef.current = 0
    roundEndDoneRef.current  = false
    pausedRef.current        = false
    setPaused(false)
    // Host: archive lobby before leaving
    if (isHost && lobbyCode) archiveLobby(lobbyCode, { endedBy: user?.uid }).catch(() => {})
    if (isHost && lobbyCode) {
      try { localStorage.removeItem(LAST_LOBBY_KEY) } catch {}
      setLastLobbyCode('')
    }
    setLobbyCode(null); setLobby(null)
    setScreen(SCREEN.PICK)
    _mpMusicMgr?.stop()
  }

  // ── Derived ───────────────────────────────────────────────────────────────────
  const opponents    = (lobby?.players ?? []).filter(p => p.uid !== user?.uid)
  const roundWins    = lobby?.roundWins ?? {}
  const myWins       = roundWins[user?.uid] ?? 0
  const bestOf       = lobby?.bestOf ?? 3
  const currentRound = lobby?.currentRound ?? 1
  const winsNeeded   = Math.ceil(bestOf / 2)
  const leftWidth    = isLandscape ? 72 : 88
  const opponentPages = useMemo(() => {
    const pages = []
    for (let i = 0; i < opponents.length; i += OPPONENTS_PER_PAGE) {
      pages.push(opponents.slice(i, i + OPPONENTS_PER_PAGE))
    }
    return pages
  }, [opponents])
  const maxPreviewPage = Math.max(0, opponentPages.length - 1)
  const visibleOpponents = opponentPages[previewPage] ?? []

  useEffect(() => {
    setPreviewPage((p) => Math.min(p, maxPreviewPage))
  }, [maxPreviewPage])

  const goPrevPreviewPage = useCallback(() => {
    setPreviewDirection(-1)
    setPreviewPage((p) => Math.max(0, p - 1))
  }, [])
  const goNextPreviewPage = useCallback(() => {
    setPreviewDirection(1)
    setPreviewPage((p) => Math.min(maxPreviewPage, p + 1))
  }, [maxPreviewPage])
  const onPreviewTouchStart = useCallback((ev) => {
    const t = ev.touches?.[0]
    if (!t) return
    swipeStartRef.current = { x: t.clientX, y: t.clientY }
  }, [])
  const onPreviewTouchEnd = useCallback((ev) => {
    const start = swipeStartRef.current
    const t = ev.changedTouches?.[0]
    swipeStartRef.current = null
    if (!start || !t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < 28 || Math.abs(dx) < Math.abs(dy)) return
    if (dx < 0) goNextPreviewPage()
    else goPrevPreviewPage()
  }, [goNextPreviewPage, goPrevPreviewPage])
  const playersForStandings = (lobby?.players ?? []).map((p) => ({
    ...p,
    wins: roundResult?.roundWins?.[p.uid] ?? roundWins[p.uid] ?? 0,
    isSelf: p.uid === user?.uid,
  })).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0)
    return String(a.displayName ?? '').localeCompare(String(b.displayName ?? ''))
  })
  const roundWinnerUid = roundResult?.roundWinner ?? null
  const roundWinnerName = roundWinnerUid
    ? ((lobby?.players ?? []).find((p) => p.uid === roundWinnerUid)?.displayName || (roundWinnerUid === user?.uid ? 'You' : 'Winner'))
    : null
  const matchWinnerUid = roundResult?.matchWinner ?? null
  const matchWinnerName = matchWinnerUid
    ? ((lobby?.players ?? []).find((p) => p.uid === matchWinnerUid)?.displayName || (matchWinnerUid === user?.uid ? 'You' : 'Winner'))
    : null

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100dvh', background: '#0a0a14', display: 'flex', flexDirection: 'column', fontFamily: '"Courier New", monospace', color: '#fff', overflow: 'hidden' }}>

      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(env(safe-area-inset-top, 0px) + 1rem) 1.4rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, zIndex: 10, position: 'relative' }}>
        <button
          onClick={screen === SCREEN.GAME ? undefined : () => (screen === SCREEN.PICK ? navigate('/') : setScreen(SCREEN.PICK))}
          style={{ background: 'none', border: 'none', color: '#666', cursor: screen === SCREEN.GAME ? 'default' : 'pointer', fontSize: '0.72rem', letterSpacing: '0.14em', fontFamily: 'inherit', padding: 0, opacity: screen === SCREEN.GAME ? 0.3 : 1, display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <img src={homeIconUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
          <span>{screen === SCREEN.PICK ? 'MENU' : 'BACK'}</span>
        </button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, letterSpacing: '0.2em', color: '#f97316' }}>VERSUS</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 60, justifyContent: 'flex-end' }}>
          {screen === SCREEN.GAME && !focus && (
            <button
              onClick={() => triggerAction('activateZone')}
              disabled={myState?.zoneMeter < ZONE_MIN_METER || myState?.zoneActive}
              title={myState?.zoneActive ? 'Zone Active' : (myState?.zoneMeter >= ZONE_MIN_METER ? 'Activate Zone' : 'Zone charging')}
              style={{
                background: myState?.zoneActive ? 'rgba(0,229,255,0.18)' : (myState?.zoneMeter ?? 0) >= ZONE_MIN_METER ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${myState?.zoneActive ? '#00e5ff' : (myState?.zoneMeter ?? 0) >= ZONE_MIN_METER ? '#22d3ee' : 'rgba(255,255,255,0.1)'}`,
                color: myState?.zoneActive ? '#00e5ff' : (myState?.zoneMeter ?? 0) >= ZONE_MIN_METER ? '#80eaff' : '#555',
                cursor: (myState?.zoneMeter ?? 0) >= ZONE_MIN_METER && !myState?.zoneActive ? 'pointer' : 'default',
                fontSize: '0.62rem', padding: '2px 8px', borderRadius: 6, fontFamily: 'inherit'
              }}
            >
              ⚡ {myState?.zoneActive ? `${Math.ceil((myState?.zoneTimer || 0)/1000)}s` : 'ZONE'}
            </button>
          )}
          {showAudioControls && (
            <button
              onClick={() => setShowVolumePanel(v => !v)}
              title={showVolumePanel ? 'Hide volume settings' : 'Volume settings'}
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: showVolumePanel ? '#f97316' : '#999', cursor: 'pointer', fontSize: '0.62rem', padding: '4px 8px', borderRadius: 4, fontFamily: 'inherit', letterSpacing: '0.08em' }}>
              VOL
            </button>
          )}
          {showAudioControls && (
            <button onClick={toggleMute} title={muted ? 'Unmute (M)' : 'Mute (M)'}
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: muted ? '#444' : '#999', cursor: 'pointer', fontSize: '0.7rem', padding: '4px 8px', borderRadius: 4, fontFamily: 'inherit' }}>
              {muted ? '🔇' : '🔊'}
            </button>
          )}
        </div>
        {showAudioControls && showVolumePanel && (
          <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 12, background: 'rgba(10,10,20,0.96)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: '10px 12px', width: 220, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
            <div style={{ fontSize: '0.5rem', color: '#777', letterSpacing: '0.2em', marginBottom: 8 }}>AUDIO</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: '0.58rem', color: '#aaa', letterSpacing: '0.08em' }}>MUSIC</span>
              <span style={{ fontSize: '0.58rem', color: '#f8fafc' }}>{Math.round(musicVol * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(musicVol * 100)}
              onChange={(e) => applyAudioLevels(Number(e.target.value) / 100, sfxVol)}
              style={{ width: '100%', marginBottom: 10 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: '0.58rem', color: '#aaa', letterSpacing: '0.08em' }}>SFX</span>
              <span style={{ fontSize: '0.58rem', color: '#f8fafc' }}>{Math.round(sfxVol * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              step={1}
              value={Math.round(sfxVol * 100)}
              onChange={(e) => applyAudioLevels(musicVol, Number(e.target.value) / 100)}
              style={{ width: '100%' }}
            />
            <div style={{ marginTop: 8, fontSize: '0.52rem', color: muted ? '#f59e0b' : '#555', letterSpacing: '0.06em' }}>
              {muted ? 'Muted: levels are saved and will apply when unmuted.' : 'Live changes applied in lobby and match.'}
            </div>
          </div>
        )}
      </header>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
        {/* Friends quick access on PICK */}
        {screen === SCREEN.PICK && (
          <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 10px)', right: 'calc(env(safe-area-inset-right, 0px) + 12px)', zIndex: 5 }}>
            <button
              onClick={() => setShowFriendsPanel(true)}
              style={{ position: 'relative', background: 'none', border: '1px solid rgba(255,255,255,0.12)', color: '#888', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: '0.62rem', fontFamily: 'inherit', letterSpacing: '0.1em' }}
              title="Friends"
            >
              👥 Friends
              {friendRequests.length > 0 && (
                <span style={{ position: 'absolute', top: -6, right: -6, background: '#ef4444', color: '#000', borderRadius: 10, padding: '0 5px', fontSize: '0.55rem', border: '1px solid #000' }}>{Math.min(99, friendRequests.length)}</span>
              )}
            </button>
          </div>
        )}
        <AnimatePresence mode="wait">

          {/* ── Pick ─────────────────────────────────────────────────────── */}
          {screen === SCREEN.PICK && (
            <motion.div key="pick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '2rem' }}>
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 900, letterSpacing: '0.12em' }}>ONLINE VERSUS</div>
                <div style={{ fontSize: '0.65rem', color: '#555', marginTop: 6, letterSpacing: '0.1em' }}>Up to 8 players — send garbage, survive</div>
              </div>
              {[
                { label: 'CREATE LOBBY', sub: 'Generate a room code',    color: '#f97316', onClick: () => setScreen(SCREEN.CREATE) },
                { label: 'JOIN LOBBY',   sub: 'Enter a code or scan QR', color: '#00d4ff', onClick: () => setScreen(SCREEN.JOIN)   },
              ].map(btn => (
                <motion.button key={btn.label} whileHover={{ scale: 1.03, y: -2 }} whileTap={{ scale: 0.97 }} onClick={btn.onClick}
                  style={{ width: '100%', maxWidth: 300, background: `${btn.color}14`, border: `1px solid ${btn.color}55`, borderRadius: 12, padding: '1.1rem', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', transition: 'all 0.15s' }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, letterSpacing: '0.14em', color: btn.color }}>{btn.label}</div>
                  <div style={{ fontSize: '0.62rem', color: '#555', marginTop: 4, letterSpacing: '0.1em' }}>{btn.sub}</div>
                </motion.button>
              ))}
              {lastLobbyCode && (
                <motion.button whileHover={{ scale: 1.03, y: -2 }} whileTap={{ scale: 0.97 }} onClick={handleRejoin}
                  disabled={rejoinBusy}
                  style={{ width: '100%', maxWidth: 300, background: 'rgba(168,85,247,0.10)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 12, padding: '1.1rem', cursor: rejoinBusy ? 'wait' : 'pointer', fontFamily: 'inherit', textAlign: 'left', transition: 'all 0.15s', opacity: rejoinBusy ? 0.7 : 1 }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, letterSpacing: '0.14em', color: '#c084fc' }}>{rejoinBusy ? 'REJOINING…' : 'REJOIN LAST LOBBY'}</div>
                  <div style={{ fontSize: '0.62rem', color: '#777', marginTop: 4, letterSpacing: '0.1em' }}>Code: {lastLobbyCode}</div>
                </motion.button>
              )}
              {rejoinError && (
                <div style={{ width: '100%', maxWidth: 300, fontSize: '0.62rem', color: '#f87171', letterSpacing: '0.08em', textAlign: 'center' }}>{rejoinError}</div>
              )}
              {/* Lobby invites from friends */}
              {lobbyInvites.filter(inv => !dismissedInvites.has(inv.id)).length > 0 && (
                <div style={{ width: '100%', maxWidth: 300 }}>
                  <div style={{ fontSize: '0.52rem', letterSpacing: '0.2em', color: '#a855f7', marginBottom: 6, textTransform: 'uppercase' }}>Lobby Invites</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {lobbyInvites.filter(inv => !dismissedInvites.has(inv.id)).map(inv => (
                      <div key={inv.id} style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 10, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.7rem', color: '#ddd', letterSpacing: '0.06em' }}>{inv.fromName || 'A friend'}</div>
                          <div style={{ fontSize: '0.55rem', color: '#a855f7', letterSpacing: '0.1em', marginTop: 1 }}>Code: {inv.lobbyCode}</div>
                        </div>
                        <button
                          onClick={async () => {
                            await dismissLobbyInvite(user.uid, inv.id).catch(() => {})
                            setDismissedInvites(prev => new Set([...prev, inv.id]))
                            setJoinCodePrefill(String(inv.lobbyCode || '').toUpperCase())
                            setScreen(SCREEN.JOIN)
                          }}
                          style={{ background: 'rgba(168,85,247,0.2)', border: '1px solid rgba(168,85,247,0.5)', color: '#c084fc', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: '0.62rem', fontFamily: 'inherit', letterSpacing: '0.08em' }}
                        >Join</button>
                        <button
                          onClick={async () => {
                            await dismissLobbyInvite(user.uid, inv.id).catch(() => {})
                            setDismissedInvites(prev => new Set([...prev, inv.id]))
                          }}
                          style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: '#555', borderRadius: 6, padding: '4px 7px', cursor: 'pointer', fontSize: '0.62rem', fontFamily: 'inherit' }}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {screen === SCREEN.CREATE && (
            <motion.div key="create" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CreateScreen onCreate={handleCreate} />
            </motion.div>
          )}

          {/* ── Join ─────────────────────────────────────────────────────── */}
          {screen === SCREEN.JOIN && (
            <motion.div key="join" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <JoinScreen onJoin={handleJoin} initialCode={joinCodePrefill} />
            </motion.div>
          )}

          {/* ── Lobby ────────────────────────────────────────────────────── */}
          {screen === SCREEN.LOBBY && lobby && (
            <motion.div key="lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ flex: 1, overflowY: 'auto' }}>
              <WaitingRoom lobby={lobby} lobbyCode={lobbyCode} selfUid={user?.uid} selfDisplayName={displayName} isHost={isHost} onStart={handleStart} onLeave={handleLeave} onBestOfChange={handleBestOfChange} playerProfiles={playerProfiles} />
            </motion.div>
          )}

          {/* ── Game ─────────────────────────────────────────────────────── */}
          {screen === SCREEN.GAME && myState && (
            <motion.div key="game" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>

              {/* HUD bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: isLandscape ? '3px 8px' : '4px 10px', background: 'rgba(0,0,0,0.7)', flexShrink: 0, backdropFilter: 'blur(6px)', gap: isLandscape ? 4 : 6 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: isLandscape ? 0.5 : 1, minWidth: 68, fontSize: isLandscape ? '0.4rem' : '0.46rem' }}>
                  <span style={{ color: '#666', letterSpacing: '0.1em', lineHeight: 1 }}>RND {currentRound}/{bestOf}</span>
                  <span style={{ color: '#444', letterSpacing: '0.08em', lineHeight: 1 }}>
                    P {Math.max(0, (lobby?.players || []).filter(p => !p.gameOver).length)}/{(lobby?.players || []).length}
                  </span>
                  <span style={{ color: '#f97316', fontWeight: 700, letterSpacing: '0.06em', lineHeight: 1 }}>
                    {myWins}–{opponents.map(o => roundWins[o.uid] ?? 0).join('–')}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: isLandscape ? 0.5 : 1, fontSize: isLandscape ? '0.4rem' : undefined }}>
                  <span style={{ color: '#00d4ff', fontWeight: 700, fontSize: isLandscape ? '0.56rem' : '0.72rem', display: 'flex', alignItems: 'center', gap: isLandscape ? 3 : 6, lineHeight: 1 }}>
                    {myState.score.toLocaleString()}
                    {userProfile?.selectedBadge && (
                      <span style={{ fontSize: isLandscape ? '0.42rem' : '0.55rem', color: '#c084fc', border: '1px solid #c084fc55', borderRadius: 3, padding: '0 3px', letterSpacing: '0.10em' }}>{String(userProfile.selectedBadge).replace('badge_', '').toUpperCase()}</span>
                    )}
                  </span>
                  <span style={{ color: '#555', letterSpacing: '0.08em', lineHeight: 1 }}>LVL {myState.level}</span>
                  {(myState.combo > 1 || myState.backToBack) && !isLandscape && (
                    <span style={{ fontSize: '0.44rem', color: '#fbbf24', letterSpacing: '0.08em', fontWeight: 700, lineHeight: 1 }}>
                      {myState.combo > 1 ? `CMB x${myState.combo}` : ''}
                      {myState.combo > 1 && myState.backToBack ? '  ·  ' : ''}
                      {myState.backToBack ? `B2B x${(myState.b2bCount ?? 0) + 1}` : ''}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: isLandscape ? 2 : 4, alignItems: 'center' }}>
                  {/* Removed top focus toggle per request */}
                  <button onClick={toggleMute} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.18)', color: muted ? '#444' : '#888', cursor: 'pointer', fontSize: isLandscape ? '0.48rem' : '0.56rem', padding: isLandscape ? '1px 4px' : '2px 6px', borderRadius: 4, fontFamily: 'inherit' }}>
                    {muted ? '🔇' : '🔊'}
                  </button>
                </div>
              </div>

              {/* Main area */}
              <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch' }}>

                {/* Left column: opponent boards (grid) */}
                {!focus && (
                <div style={{ width: leftWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch', padding: isLandscape ? '4px 3px' : '8px 6px', gap: isLandscape ? 3 : 6, background: 'rgba(0,0,0,0.5)', overflow: 'hidden' }}>

                  {opponents.length === 0 && (
                    <div style={{ fontSize: '0.44rem', color: '#333', textAlign: 'center', letterSpacing: '0.08em', paddingTop: 6 }}>no opponent</div>
                  )}
                  {opponents.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: isLandscape ? '0.4rem' : '0.46rem', color: '#666', letterSpacing: '0.08em' }}>
                      <button
                        onClick={goPrevPreviewPage}
                        disabled={previewPage <= 0}
                        style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: previewPage <= 0 ? '#333' : '#888', borderRadius: 4, width: 16, height: 16, padding: 0, cursor: previewPage <= 0 ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: '0.4rem' }}
                      >
                        ‹
                      </button>
                      <span>{previewPage + 1}/{Math.max(1, opponentPages.length)}</span>
                      <button
                        onClick={goNextPreviewPage}
                        disabled={previewPage >= maxPreviewPage}
                        style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: previewPage >= maxPreviewPage ? '#333' : '#888', borderRadius: 4, width: 16, height: 16, padding: 0, cursor: previewPage >= maxPreviewPage ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: '0.4rem' }}
                      >
                        ›
                      </button>
                    </div>
                  )}
                  <div
                    onTouchStart={onPreviewTouchStart}
                    onTouchEnd={onPreviewTouchEnd}
                    style={{ position: 'relative', minHeight: 0, overflow: 'hidden', flex: 1 }}>
                    <AnimatePresence mode="wait" custom={previewDirection}>
                      <motion.div
                        key={previewPage}
                        custom={previewDirection}
                        initial={{ x: previewDirection >= 0 ? 18 : -18, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: previewDirection >= 0 ? -18 : 18, opacity: 0 }}
                        transition={{ duration: 0.16, ease: 'easeOut' }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'absolute', inset: 0 }}>
                        {visibleOpponents.map(opp => (
                          <OpponentBoard
                            key={opp.uid}
                            snapshot={opp.boardSnapshot}
                            displayName={opp.displayName}
                            badge={playerProfiles[opp.uid]?.selectedBadge || null}
                            score={opp.score}
                            wins={roundWins[opp.uid] ?? 0}
                            isTarget={opp.uid === (targetUid || currentTargetRef.current)}
                            onClick={() => selectTarget(opp.uid)}
                            compact
                          />
                        ))}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  <div style={{ flex: 1 }} />

                  {myState.pendingGarbage > 0 && (
                    <div style={{ fontSize: isLandscape ? '0.46rem' : '0.58rem', color: '#f87171', fontWeight: 700, letterSpacing: '0.06em', textAlign: 'center' }}>
                      ↑{myState.pendingGarbage}
                    </div>
                  )}
                </div>
                )}

                {/* Canvas */}
                <SynesthesiaMotionLayer className="mobile-canvas-wrap" style={{ background: 'transparent', flex: 1, minWidth: 0, paddingBottom: showOnScreenControls ? isLandscape ? '3.5rem' : '4.5rem' : 0 }}>
                    <GameCanvas
                      state={myState}
                      onTap={() => triggerAction('rotateCW')}
                      onTwoFingerTap={() => triggerAction('activateZone')}
                      onDragBegin={handleDragBegin}
                      onDragEnd={handleDragEnd}
                      onHardDrop={handleHardDrop}
                      renderQuality={(() => { try { return JSON.parse(localStorage.getItem('tetris-config') || '{}').renderQuality || 'balanced' } catch { return 'balanced' } })()}
                    />
                    {/* Small right-side focus toggle for mobile */}
                    <button
                      onClick={() => setFocus(f => !f)}
                      className="ui-toggle-tab"
                      title={focus ? 'Exit Focus' : 'Enter Focus'}
                      aria-label={focus ? 'Exit Focus' : 'Enter Focus'}
                      style={{ right: 0 }}
                    >
                      {focus ? '▲' : '▼'}
                    </button>
                    {focus && (
                      <>
                        {(() => {
                          const zoneReady = (myState?.zoneMeter ?? 0) >= ZONE_MIN_METER && !myState?.zoneActive
                          const zoneFillPct = Math.max(0, Math.min(100, myState?.zoneActive ? 100 : (myState?.zoneMeter || 0)))
                          return (
                            <div className="fullscreen-mini-hud" style={{ position: 'absolute', top: 0, right: 0, zIndex: 20 }}>
                              <div className="fmh-hold">
                                <div className="fmh-label">Hold</div>
                                <PieceMini type={myState?.hold} size={8} />
                              </div>
                              <div className="fmh-zone-wrap">
                                <div className={`fmh-zone-bar${myState?.zoneActive ? ' zone-active' : ''}${zoneReady && !myState?.zoneActive ? ' zone-ready' : ''}`} style={{ height: `${zoneFillPct}%` }} />
                              </div>
                              <div className="fmh-next">
                                <div className="fmh-label">Next</div>
                                {(myState?.queue ?? []).slice(0, 3).map((t, i) => (
                                  <PieceMini key={i} type={t} size={7} />
                                ))}
                              </div>
                            </div>
                          )
                        })()}
                        {(() => {
                          const garFrac = Math.min(1, Math.max(0, (myState?.pendingGarbage || 0) / BOARD_HEIGHT))
                          const hPct = Math.round(garFrac * 100)
                          return (
                            <>
                              <div style={{ position: 'absolute', left: 0, bottom: 0, width: 6, height: `${hPct}%`, background: '#f87171', opacity: 0.85, boxShadow: '0 0 10px #f87171aa' }} />
                              <div style={{ position: 'absolute', right: 0, bottom: 0, width: 6, height: `${hPct}%`, background: '#f87171', opacity: 0.85, boxShadow: '0 0 10px #f87171aa' }} />
                            </>
                          )
                        })()}
                      </>
                    )}
                    {/* Zone end overlay */}
                    <AnimatePresence>
                      {myState?.zoneEndResult && (
                        <motion.div className="zone-end-overlay"
                          initial={{ opacity: 0, scale: 0.92 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.35 }}>
                          <div className="zone-end-number">{myState.zoneEndResult.lines}</div>
                          <div className="zone-end-label">ZONE LINES!</div>
                          <div className="zone-end-bonus">+{myState.zoneEndResult.bonus.toLocaleString()}</div>
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 4, padding: '10% 18%', pointerEvents: 'none' }}>
                            {Array.from({ length: Math.min(12, myState.zoneEndResult.lines || 0) }).map((_, i) => (
                              <motion.div key={i}
                                initial={{ scaleX: 1, opacity: 0.9 }}
                                animate={{ scaleX: 0, opacity: 0 }}
                                transition={{ delay: 0.3 + i * 0.1, duration: 0.7, ease: 'easeIn' }}
                                style={{ height: 6, background: 'linear-gradient(90deg,#fff,#00cfff)', borderRadius: 4, filter: 'drop-shadow(0 0 6px #00cfff)' }}
                              />
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {/* Pause overlay removed in Versus */}
                </SynesthesiaMotionLayer>

                {/* Right column removed per request to maximize board area */}
              </div>

              {showOnScreenControls && <TouchControls onPress={handlePress} onRelease={handleRelease} />}
            </motion.div>
          )}

          {/* ── Round end ─────────────────────────────────────────────────── */}
          {screen === SCREEN.ROUND_END && (
            <motion.div key="round-end" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
              <div style={{ textAlign: 'center', background: '#10101c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '2rem 2.5rem', maxWidth: 320 }}>
                <div style={{ fontSize: '2rem', marginBottom: 6 }}>{roundResult?.won ? '🏆' : '💀'}</div>
                <div style={{ fontSize: '0.5rem', color: '#777', letterSpacing: '0.3em', marginBottom: 4 }}>ROUND {currentRound}</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 900, letterSpacing: '0.14em', color: roundResult?.won ? '#22c55e' : '#f87171', marginBottom: '1.4rem' }}>
                  {roundResult?.won ? 'ROUND WIN' : 'ROUND LOST'}
                </div>
                {bestOf === 1 ? (
                  <div style={{ marginBottom: '1.2rem' }}>
                    <div style={{ fontSize: '0.52rem', color: '#666', letterSpacing: '0.16em', marginBottom: 4 }}>WINNER</div>
                    <div style={{ fontSize: '1rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '0.08em' }}>{roundWinnerName ?? 'Resolving…'}</div>
                  </div>
                ) : (
                  <div style={{ marginBottom: '1.2rem' }}>
                    <div style={{ fontSize: '0.52rem', color: '#666', letterSpacing: '0.16em', marginBottom: 8 }}>ROUND WINS</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
                      {playersForStandings.map((p) => (
                        <div key={p.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 10px', background: p.isSelf ? 'rgba(0,212,255,0.08)' : 'rgba(255,255,255,0.02)' }}>
                          <div style={{ fontSize: '0.62rem', color: p.isSelf ? '#7dd3fc' : '#d1d5db', letterSpacing: '0.06em', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.isSelf ? 'YOU' : p.displayName}</div>
                          <div style={{ fontSize: '0.92rem', fontWeight: 900, color: '#f97316' }}>{p.wins}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ fontSize: '0.6rem', color: '#555', letterSpacing: '0.08em', marginBottom: '1.2rem' }}>
                  {isHost ? 'Next round starting in 3 s…' : 'Waiting for host…'}
                </div>
                <button onClick={handleLeave} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', color: '#666', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: '0.65rem', letterSpacing: '0.1em', fontFamily: 'inherit' }}>
                  LEAVE MATCH
                </button>
              </div>
            </motion.div>
          )}

          {/* ── Match result ──────────────────────────────────────────────── */}
          {screen === SCREEN.RESULT && (
            <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
              <div style={{ textAlign: 'center', background: '#10101c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '2rem 2.5rem', maxWidth: 340 }}>
                <div style={{ fontSize: '2.4rem', marginBottom: 6 }}>{roundResult?.matchWinner === user?.uid ? '🏆' : '💀'}</div>
                <div style={{ fontSize: '0.5rem', color: '#777', letterSpacing: '0.3em', marginBottom: 6 }}>MATCH COMPLETE</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 900, letterSpacing: '0.16em', color: roundResult?.matchWinner === user?.uid ? '#22c55e' : '#f87171', marginBottom: '1.6rem' }}>
                  {roundResult?.matchWinner === user?.uid ? 'VICTORY' : 'DEFEATED'}
                </div>
                {bestOf === 1 ? (
                  <div style={{ marginBottom: '1.6rem' }}>
                    <div style={{ fontSize: '0.52rem', color: '#666', letterSpacing: '0.16em', marginBottom: 5 }}>WINNER</div>
                    <div style={{ fontSize: '1.02rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '0.08em' }}>{matchWinnerName ?? 'Winner'}</div>
                  </div>
                ) : (
                  <div style={{ marginBottom: '1.6rem' }}>
                    <div style={{ fontSize: '0.52rem', color: '#666', letterSpacing: '0.16em', marginBottom: 8 }}>FINAL WINS</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 230 }}>
                      {playersForStandings.map((p) => (
                        <div key={p.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 10px', background: p.isSelf ? 'rgba(0,212,255,0.08)' : 'rgba(255,255,255,0.02)' }}>
                          <div style={{ fontSize: '0.64rem', color: p.isSelf ? '#7dd3fc' : '#d1d5db', letterSpacing: '0.06em', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.isSelf ? 'YOU' : p.displayName}</div>
                          <div style={{ fontSize: '0.98rem', fontWeight: 900, color: '#f97316' }}>{p.wins}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ fontSize: '0.68rem', color: '#888', marginBottom: '1.5rem' }}>
                  {bestOf === 1 ? 'Single match' : `Best of ${bestOf} — first to ${winsNeeded}`}
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <button onClick={handleLeave} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: '#ccc', borderRadius: 8, padding: '9px 20px', cursor: 'pointer', fontSize: '0.75rem', letterSpacing: '0.1em', fontFamily: 'inherit' }}>
                    LOBBY
                  </button>
                  <button onClick={() => navigate('/')} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: '#888', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontSize: '0.75rem', letterSpacing: '0.1em', fontFamily: 'inherit' }}>
                    MENU
                  </button>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
      {/* Friends Panel Modal */}
      <AnimatePresence>
        {showFriendsPanel && (
          <motion.div key="friends-panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}
            onClick={() => setShowFriendsPanel(false)}
          >
            <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }} onClick={(e) => e.stopPropagation()}
              style={{ width: 'min(420px, 92vw)', background: '#0f1120', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '1rem', fontFamily: '"Courier New", monospace' }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: '0.7rem', letterSpacing: '0.2em', color: '#a855f7', textTransform: 'uppercase' }}>Friends</div>
                <button onClick={() => setShowFriendsPanel(false)} style={{ marginLeft: 'auto', background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: '#888', borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontSize: '0.65rem', fontFamily: 'inherit' }}>✕</button>
              </div>
              {frLoading ? (
                <div style={{ padding: '1rem', color: '#666', fontSize: '0.7rem' }}>Loading…</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ fontSize: '0.58rem', color: '#00d4ff', letterSpacing: '0.14em', marginBottom: 6 }}>YOUR FRIEND ID</div>
                    <div style={{ fontSize: '0.72rem', color: '#f8fafc', marginBottom: 8 }}>{userProfile?.friendCode || 'Generating…'}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={friendCodeInput}
                        onChange={(e) => setFriendCodeInput(e.target.value)}
                        placeholder="displayname#tag"
                        style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', padding: '7px 9px', fontSize: '0.68rem', fontFamily: 'inherit' }}
                      />
                      <button
                        onClick={handleAddByFriendCode}
                        disabled={friendCodeState.kind === 'loading'}
                        style={{ background: 'rgba(0,212,255,0.14)', border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff', borderRadius: 8, padding: '7px 10px', cursor: 'pointer', fontSize: '0.62rem', fontFamily: 'inherit' }}
                      >
                        {friendCodeState.kind === 'loading' ? '…' : 'ADD'}
                      </button>
                    </div>
                    {friendCodeState.kind !== 'idle' && (
                      <div style={{ marginTop: 7, fontSize: '0.6rem', color: friendCodeState.kind === 'success' ? '#22c55e' : friendCodeState.kind === 'error' ? '#f87171' : '#888' }}>
                        {friendCodeState.message}
                      </div>
                    )}
                  </div>
                  {friendRequests.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.6rem', color: '#eab308', letterSpacing: '0.18em', marginBottom: 6 }}>Pending Requests</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {friendRequests.map(req => (
                          <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px' }}>
                            <div style={{ flex: 1, color: '#ddd', fontSize: '0.78rem' }}>{req.fromName || req.fromUid?.slice(0,8)}</div>
                            <button onClick={() => handleAcceptReq(req)} disabled={frAction[req.id] === 'accepting'} style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid #22c55e55', color: '#22c55e', borderRadius: 6, padding: '3px 9px', fontSize: '0.62rem', cursor: 'pointer' }}>{frAction[req.id] === 'accepting' ? '…' : 'Accept'}</button>
                            <button onClick={() => handleDeclineReq(req)} disabled={frAction[req.id] === 'declining'} style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid #f8717155', color: '#f87171', borderRadius: 6, padding: '3px 9px', fontSize: '0.62rem', cursor: 'pointer' }}>{frAction[req.id] === 'declining' ? '…' : 'Decline'}</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {sentFriendRequests.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.6rem', color: '#00d4ff', letterSpacing: '0.18em', marginBottom: 6 }}>Outgoing Requests</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {sentFriendRequests.map(req => (
                          <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(0,212,255,0.12)', borderRadius: 8, padding: '8px 10px' }}>
                            <div style={{ flex: 1, color: '#ddd', fontSize: '0.78rem' }}>{req.toName || playerProfiles[req.toUid]?.displayName || req.toUid?.slice(0,8)}</div>
                            <div style={{ fontSize: '0.6rem', color: '#00d4ff', letterSpacing: '0.08em' }}>Pending</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: '0.6rem', color: '#555', letterSpacing: '0.18em', marginBottom: 6 }}>Friends List</div>
                    <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
                      {friends.length === 0 ? (
                        <div style={{ padding: '0.9rem', textAlign: 'center', color: '#666', fontSize: '0.7rem' }}>No friends yet</div>
                      ) : friends.map((f, i) => (
                        <div key={f.uid || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderBottom: i < friends.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#00d4ff44,#a855f744)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700 }}>
                            {(f.displayName || '?')[0].toUpperCase()}
                          </div>
                          <div style={{ flex: 1, color: '#ddd', fontSize: '0.78rem' }}>{f.displayName || f.uid?.slice(0,8)}</div>
                          {screen === SCREEN.LOBBY ? (
                            <button
                              onClick={() => sendLobbyInvite(user?.uid, f.uid, lobbyCode, displayName)}
                              style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#c084fc', borderRadius: 6, padding: '3px 9px', fontSize: '0.62rem', cursor: 'pointer' }}
                            >Invite</button>
                          ) : <span style={{ fontSize: '0.6rem', color: '#555' }}>—</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
