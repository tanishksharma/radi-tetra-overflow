function StatsSkeletonCard() {
  return (
    <div style={{
      background: '#161622',
      border: '1px solid #21214a',
      borderRadius: 12,
      padding: '1rem',
      minHeight: 58,
      display: 'flex', flexDirection: 'column', gap: 4, opacity: 0.82,
      animation: 'statsSkeletonPulse 1.6s infinite cubic-bezier(.7,0,.3,1)'
    }}>
      <div style={{ width: 56, height: 13, background: 'rgba(255,255,255,0.10)', borderRadius: 4 }} />
      <div style={{ width: '52%', height: 23, background: 'rgba(255,255,255,0.13)', borderRadius: 7 }} />
      <div style={{ width: '44%', height: 10, background: 'rgba(255,255,255,0.07)', borderRadius: 4 }} />
    </div>
  )
}

function StatsSkeletonRow() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '40px minmax(0,1fr) 110px 80px 86px', gap: 8, alignItems: 'center', padding: '8px 10px' }}>
      <div style={{ background:'#24244f', borderRadius:4, width:30, height:13 }} />
      <div style={{ background:'#22223b', borderRadius:4, width:'80%', height:11 }} />
      <div style={{ background:'#161637', borderRadius:4, width:70, height:16 }} />
      <div style={{ background:'#19193c', borderRadius:4, width:40, height:9 }} />
      <div style={{ background:'#1a1a3d', borderRadius:4, width:60, height:9 }} />
    </div>
  )
}

if (typeof window !== 'undefined' && !document.getElementById('stats-skel-pulse')) {
  const style = document.createElement('style');
  style.id = 'stats-skel-pulse';
  style.innerHTML = '@keyframes statsSkeletonPulse { 0%{opacity:.8} 50%{opacity:.58} 100%{opacity:.8} }';
  document.head.appendChild(style);
}
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { getUserStats, getLeaderboard, getCoinHistory, getPublicProfile, getPublicStats, getPublicProfiles, getFriends, getFriendRequests, getSentFriendRequests, acceptFriendRequest, declineFriendRequest, sendFriendRequest, findPublicProfileByFriendCode, getStoryProgress } from '../firebase/db'
import { GAME_MODE } from '../logic/gameEngine'
import { STORY_CHAPTERS } from '../logic/storyData'
import DailyChallengesMenu from '../components/DailyChallengesMenu'
import homeIconUrl from '../icons/home-button.png'

// Include all solo modes (excluding multiplayer/versus)
const MODES = [
  { key: GAME_MODE.NORMAL,   label: 'NORMAL',   color: '#00d4ff' },
  { key: GAME_MODE.SPRINT,   label: 'SPRINT',   color: '#22c55e' },
  { key: GAME_MODE.BLITZ,    label: 'BLITZ',    color: '#f97316' },
  { key: GAME_MODE.PURIFY,   label: 'PURIFY',   color: '#a855f7' },
  { key: GAME_MODE.ULTIMATE, label: 'ULTIMATE', color: '#ef4444' },
  { key: 'story',            label: 'STORY',    color: '#ffd700' },
]

function formatCompactNumber(n) {
  if (n == null) return '0'
  if (Math.abs(n) >= 1e9)
    return (n / 1e9).toFixed(2).replace(/\.00$/, '') + 'B'
  if (Math.abs(n) >= 1e6)
    return (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M'
  if (Math.abs(n) >= 1e3)
    return (n / 1e3).toFixed(2).replace(/\.00$/, '') + 'K'
  return n.toLocaleString()
}

function StatCard({ label, value, sub, color = '#00d4ff', compact = false }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ background: '#10101c', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '1rem', display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      <div style={{ fontSize: '0.6rem', color: '#555', letterSpacing: '0.18em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 900, color, letterSpacing: '0.04em' }}>{compact ? formatCompactNumber(value) : value}</div>
      {sub && <div style={{ fontSize: '0.65rem', color: '#555' }}>{sub}</div>}
    </motion.div>
  )
}

function BarChart({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        style={{ height: '100%', background: color, borderRadius: 3 }}
      />
    </div>
  )
}

function BestScoreRow({ mode, score, max }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: '0.7rem', color: mode.color, letterSpacing: '0.14em' }}>{mode.label}</span>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#eee' }}>{(score || 0).toLocaleString()}</span>
      </div>
      <BarChart value={score || 0} max={max} color={mode.color} />
    </div>
  )
}

function NoobBadge() {
  return (
    <span style={{ fontSize: '0.5rem', letterSpacing: '0.18em', color: '#f87171', border: '1px solid #f8717155', borderRadius: 4, padding: '1px 5px', background: 'rgba(248,113,113,0.08)', marginLeft: 6, verticalAlign: 'middle', fontWeight: 700 }}>
      NOOB
    </span>
  )
}

function PlayerProfileModal({ uid, onClose, myUid, myDisplayName, friends }) {
  const [profile, setProfile] = useState(null)
  const [pStats, setPStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [addState, setAddState] = useState('idle') // idle | sending | sent | error
  const isAlreadyFriend = friends?.some(f => f.uid === uid)

  useEffect(() => {
    if (!uid) return
    Promise.all([getPublicProfile(uid), getPublicStats(uid)])
      .then(([p, s]) => {
        setProfile(p)
        setPStats(s)
      })
      .catch(() => {
        setProfile(null)
        setPStats({})
      })
      .finally(() => setLoading(false))
  }, [uid])

  const handleAdd = async () => {
    if (addState !== 'idle') return
    setAddState('sending')
    try {
      await sendFriendRequest(myUid, uid, myDisplayName)
      setAddState('sent')
    } catch (e) {
      setAddState(e?.message === 'Request already sent' ? 'sent' : 'error')
    }
  }

  const name = profile?.displayName || `player_${uid.slice(0, 5)}`
  const badge = profile?.selectedBadge || null
  const bestScores = MODES.filter(m => pStats?.[`best_${m.key}`] > 0).map(m => ({ ...m, score: pStats[`best_${m.key}`] || 0 }))
  const maxBS = Math.max(...bestScores.map(m => m.score), 1)

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.9, y: 10, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        style={{ background: '#0d0d1e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '1.6rem', width: 'min(360px, 90vw)', maxHeight: '80vh', overflowY: 'auto', fontFamily: '"Courier New", monospace' }}
      >
        {loading ? (
          <div style={{ color: '#555', textAlign: 'center', padding: '2rem', letterSpacing: '0.14em', fontSize: '0.72rem' }}>LOADING…</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.2rem' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg,#00d4ff,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', fontWeight: 900, flexShrink: 0 }}>
                {name[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                  <span>{name}</span>
                  {badge && <span style={{ fontSize: '0.55rem', color: '#c084fc', border: '1px solid #c084fc55', borderRadius: 3, padding: '1px 5px', letterSpacing: '0.12em' }}>{badge.replace('badge_', '').toUpperCase()}</span>}
                  {profile?.hasPlayedEasy && <NoobBadge />}
                </div>
                <div style={{ fontSize: '0.6rem', color: '#555', marginTop: 2 }}>
                  {pStats?.totalGames || 0} games · {(pStats?.totalLines || 0).toLocaleString()} lines
                </div>
                {profile?.friendCode && (
                  <div style={{ fontSize: '0.56rem', color: '#00d4ff', marginTop: 3, letterSpacing: '0.08em' }}>
                    {profile.friendCode}
                  </div>
                )}
              </div>
              <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: '#888', borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontSize: '0.65rem', fontFamily: 'inherit' }}>✕</button>
            </div>

            {bestScores.length > 0 && (
              <div style={{ marginBottom: '1.2rem' }}>
                <div style={{ fontSize: '0.55rem', letterSpacing: '0.22em', color: '#555', marginBottom: 8 }}>BEST SCORES</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {bestScores.map(m => <BestScoreRow key={m.key} mode={m} score={m.score} max={maxBS} />)}
                </div>
              </div>
            )}

            {uid !== myUid && (
              <button
                onClick={handleAdd}
                disabled={isAlreadyFriend || addState !== 'idle'}
                style={{
                  width: '100%', background: isAlreadyFriend ? 'rgba(34,197,94,0.1)' : addState === 'sent' ? 'rgba(34,197,94,0.1)' : 'rgba(0,212,255,0.12)',
                  border: `1px solid ${isAlreadyFriend ? '#22c55e55' : addState === 'sent' ? '#22c55e66' : 'rgba(0,212,255,0.35)'}`,
                  color: isAlreadyFriend ? '#22c55e' : addState === 'sent' ? '#22c55e' : addState === 'error' ? '#f87171' : '#00d4ff',
                  borderRadius: 8, padding: '9px', cursor: (isAlreadyFriend || addState !== 'idle') ? 'default' : 'pointer',
                  fontSize: '0.72rem', letterSpacing: '0.1em', fontFamily: 'inherit', fontWeight: 700,
                }}
              >
                {isAlreadyFriend ? '✓ Friends' : addState === 'sending' ? 'Sending…' : addState === 'sent' ? '✓ Request Sent' : addState === 'error' ? '✗ Error' : '+ Add Friend'}
              </button>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  )
}

export default function StatsPage() {
  const navigate = useNavigate()
  const { user, userProfile } = useAuth()
  const [stats, setStats] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [lbMode, setLbMode] = useState(GAME_MODE.NORMAL)
  const [lbLimit, setLbLimit] = useState(10)
  const [loading, setLoading] = useState(true)
  const [narrow, setNarrow] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 420 : false))
  const [coinHistory, setCoinHistory] = useState([])
  const [storyProgress, setStoryProgress] = useState({})
  const [lbProfiles, setLbProfiles] = useState({}) // uid → { displayName, hasPlayedEasy }
  const [profileModal, setProfileModal] = useState(null) // uid | null
  const [friends, setFriends] = useState([])
  const [friendRequests, setFriendRequests] = useState([])
  const [sentFriendRequests, setSentFriendRequests] = useState([])
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [requestAction, setRequestAction] = useState({}) // requestId → 'accepting'|'declining'|'done'
  const [friendCodeInput, setFriendCodeInput] = useState('')
  const [friendCodeState, setFriendCodeState] = useState({ kind: 'idle', message: '' })

  // Responsive flag for very small screens to avoid horizontal overflow
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 420)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!user) return
    Promise.all([
      getUserStats(user.uid),
      getLeaderboard(lbMode, lbLimit),
      getCoinHistory(user.uid, 25),
      getStoryProgress(user.uid),
    ]).then(([s, lb, hist, story]) => {
      setStats(s)
      const dedupedLb = Object.values(
        lb.reduce((acc, entry) => {
          if (!acc[entry.uid] || entry.score > acc[entry.uid].score) acc[entry.uid] = entry;
          return acc;
        }, {})
      );
      setLeaderboard(dedupedLb);
      setCoinHistory(hist)
      setStoryProgress(story || {})
      setLoading(false)
      // Fetch public profiles for leaderboard entries
      const uids = [...new Set(lb.map(e => e.uid).filter(Boolean))]
      if (uids.length > 0) {
        getPublicProfiles(uids).then(setLbProfiles).catch(() => {})
      }
    })
  }, [user, lbMode, lbLimit])

  // Load friends + requests once
  useEffect(() => {
    if (!user) return
    setFriendsLoading(true)
    Promise.all([getFriends(user.uid), getFriendRequests(user.uid), getSentFriendRequests(user.uid)]).then(([f, r, sent]) => {
      setFriends(f)
      setFriendRequests(r)
      setSentFriendRequests(sent)
      setFriendsLoading(false)
    }).catch(() => setFriendsLoading(false))
  }, [user])

  const handleAccept = useCallback(async (req) => {
    setRequestAction(prev => ({ ...prev, [req.id]: 'accepting' }))
    try {
      await acceptFriendRequest(user.uid, req.id, req, userProfile?.displayName || user?.displayName || 'Player')
      setFriendRequests(prev => prev.filter(r => r.id !== req.id))
      setFriends(prev => [...prev, { uid: req.fromUid, displayName: req.fromName }])
    } catch {}
    setRequestAction(prev => ({ ...prev, [req.id]: 'done' }))
  }, [user, userProfile])

  const handleDecline = useCallback(async (req) => {
    setRequestAction(prev => ({ ...prev, [req.id]: 'declining' }))
    try {
      await declineFriendRequest(user.uid, req.id)
      setFriendRequests(prev => prev.filter(r => r.id !== req.id))
    } catch {}
    setRequestAction(prev => ({ ...prev, [req.id]: 'done' }))
  }, [user])

  const displayName = userProfile?.displayName || user?.displayName || 'Player'

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
  }, [friendCodeInput, user, displayName])
  const bestScores = useMemo(() => MODES.map(m => ({ ...m, score: stats?.[`best_${m.key}`] || 0 })), [stats])
  const maxBest = useMemo(() => Math.max(...bestScores.map(m => m.score), 1), [bestScores])

  // Personal bests for solo leaderboard row (for user even if not ranked globally)
  const personalRow = useMemo(() => {
    if (!user || !stats) return null
    return {
      uid: user.uid,
      displayName: userProfile?.displayName || 'You',
      score: stats[`best_${lbMode}`] || 0,
      lines: stats[`best_${lbMode}_lines`] || 0,
      timestamp: stats[`best_${lbMode}_at`] || null,
      personal: true,
      badge: userProfile?.selectedBadge || null,
      hasNoob: !!userProfile?.hasPlayedEasy,
    }
  }, [user, stats, userProfile, lbMode])
  const isNoob = !!userProfile?.hasPlayedEasy
  const myBadge = userProfile?.selectedBadge || null

  const relTime = (d) => {
    if (!d) return ''
    const diff = Math.floor((Date.now() - d.getTime()) / 1000)
    if (diff < 60) return `${diff}s ago`
    const m = Math.floor(diff / 60); if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
    const days = Math.floor(h / 24); if (days < 7) return `${days}d ago`
    return d.toLocaleDateString()
  }

  return (
    <div style={{ height: '100dvh', background: '#0a0a14', display: 'flex', flexDirection: 'column', fontFamily: '"Courier New", monospace', color: '#fff', position: 'fixed', inset: 0, overflow: 'hidden', touchAction: 'pan-y' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(env(safe-area-inset-top, 0px) + 1rem) 1.4rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '0.72rem', letterSpacing: '0.14em', fontFamily: 'inherit', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={homeIconUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
          <span>MENU</span>
        </button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, letterSpacing: '0.2em', color: '#eab308' }}>STATS</h1>
        <div style={{ width: 60 }} />
      </header>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '1.4rem', maxWidth: '100%', contain: 'content' }}>
        {loading ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: 640, margin: '0 auto' }}>
              {/* Player card skeleton */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#10101c', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '1.2rem', minHeight: 80, marginBottom: 24 }}>
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'linear-gradient(135deg,#161628,#181930)', flexShrink: 0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ width: 130, height: 17, background: 'rgba(255,255,255,0.07)', borderRadius: 6, marginBottom: 12 }} />
                  <div style={{ width: 70, height: 12, background: 'rgba(255,255,255,0.04)', borderRadius: 4, marginTop: 5 }} />
                </div>
              </div>
              {/* Stat cards grid skeleton */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.65rem' }}>
                {Array.from({ length: 4 }).map((_, i) => <StatsSkeletonCard key={i} />)}
              </div>
              {/* Best scores skeleton */}
              <div style={{ margin: '1.4rem 0', background: '#10101c', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {Array.from({ length: 5 }).map((_, i) => <StatsSkeletonCard key={100+i} />)}
              </div>
              {/* Leaderboard header + rows skeleton */}
              <div style={{ background: '#0f1120', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden', maxWidth: '100%' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '40px minmax(0,1fr) 110px 80px 86px', gap: 8, alignItems: 'center', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.60rem', color: '#666', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  <div>#</div>
                  <div style={{ minWidth: 0 }}>Player</div>
                  <div style={{ textAlign: 'right' }}>Score</div>
                  <div style={{ textAlign: 'right' }}>Lines</div>
                  <div style={{ textAlign: 'right' }}>When</div>
                </div>
                {[...Array(8)].map((_,i) => <StatsSkeletonRow key={i} />)}
              </div>
              {/* Coin history skeleton */}
              <div style={{ marginTop:'1.3rem', background: '#0f1120', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden', maxWidth: '100%' }}>
                {[...Array(8)].map((_,i) => <div key={i} style={{height:16, borderBottom: i<7?'1px solid #18182c':'none', background:'#18182c26'}} />)}
              </div>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: 640, margin: '0 auto' }}>
            {/* Player card */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#10101c', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '1.2rem' }}
            >
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'linear-gradient(135deg,#00d4ff,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', fontWeight: 900, flexShrink: 0 }}>
                {displayName[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                  {displayName}
                  {myBadge && (
                    <span style={{ fontSize: '0.55rem', color: '#c084fc', border: '1px solid #c084fc55', borderRadius: 3, padding: '1px 5px', letterSpacing: '0.12em', marginLeft: 6 }}>{myBadge.replace('badge_', '').toUpperCase()}</span>
                  )}
                  {isNoob && <NoobBadge />}
                </div>
                <div style={{ fontSize: '0.65rem', color: '#555', marginTop: 3, letterSpacing: '0.12em' }}>
                  {stats?.totalGames || 0} GAMES PLAYED
                </div>
              </div>
            </motion.div>

            <DailyChallengesMenu />

            {/* Overview grid */}
            <div>
              <div style={{ fontSize: '0.6rem', letterSpacing: '0.22em', color: '#555', marginBottom: '0.75rem', textTransform: 'uppercase' }}>Overview</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.65rem' }}>
                    <StatCard label="Total Score" value={stats?.totalScore || 0} color="#00d4ff" compact />
                    <StatCard label="Total Lines" value={(stats?.totalLines || 0).toLocaleString()} color="#a855f7" />
                    <StatCard label="Floors Climbed" value={stats?.totalFloors || 0} color="#22c55e" compact />
                <StatCard label="Games" value={stats?.totalGames || 0} color="#f97316" />
                <StatCard label="Coins Earned" value={(userProfile?.coins || 0).toLocaleString()} color="#eab308" sub="current balance" />
              </div>
            </div>

            {/* Best scores */}
            <div>
              <div style={{ fontSize: '0.6rem', letterSpacing: '0.22em', color: '#555', marginBottom: '0.75rem' }}>Best Scores by Mode</div>
              <div style={{ background: '#10101c', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {bestScores.map(m => <BestScoreRow key={m.key} mode={m} score={m.score} max={maxBest} />)}
                {stats?.best_ultimate_floors > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
                    <span style={{ fontSize: '0.7rem', color: '#ef4444', letterSpacing: '0.14em' }}>ULTIMATE FLOORS</span>
                    <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#eee' }}>{(stats.best_ultimate_floors || 0).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Leaderboard */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div style={{ fontSize: '0.6rem', letterSpacing: '0.22em', color: '#555', flexShrink: 0 }}>Global Leaderboard</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 4, overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', padding: '2px 0', scrollbarWidth: 'none' }}>
                      {MODES.map(m => (
                        <button
                          key={m.key}
                          onClick={() => { setLbMode(m.key); setLbLimit(10) }}
                          style={{ flex: '0 0 auto', background: lbMode === m.key ? `${m.color}22` : 'none', border: `1px solid ${lbMode === m.key ? m.color : 'rgba(255,255,255,0.1)'}`, color: lbMode === m.key ? m.color : '#555', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: '0.6rem', letterSpacing: '0.1em', fontFamily: 'inherit', textTransform: 'uppercase' }}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    {[10, 25, 50].map((lim) => (
                      <button
                        key={lim}
                        onClick={() => setLbLimit(lim)}
                        style={{ background: lbLimit === lim ? 'rgba(0,212,255,0.12)' : 'none', border: `1px solid ${lbLimit === lim ? 'rgba(0,212,255,0.45)' : 'rgba(255,255,255,0.12)'}`, color: lbLimit === lim ? '#00d4ff' : '#888', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: '0.6rem', letterSpacing: '0.12em', fontFamily: 'inherit' }}
                      >
                        Top {lim}
                      </button>
                    ))}
                </div>
              </div>
              <div style={{ background: '#0f1120', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden', maxWidth: '100%' }}>
                <div style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
                <div style={{ minWidth: 560 }}>
                {/* Header row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '40px minmax(170px,1fr) 94px 64px 56px 86px', gap: 8, alignItems: 'center', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.60rem', color: '#666', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                    <div>#</div>
                    <div style={{ minWidth: 0 }}>Player</div>
                    <div style={{ textAlign: 'right' }}>Score</div>
                    <div style={{ textAlign: 'right' }}>Lines</div>
                    <div style={{ textAlign: 'right' }}>Flr</div>
                    <div style={{ textAlign: 'right' }}>When</div>
                  </div>
                  <div style={{ maxHeight: 340, overflowY: 'auto', overflowX: 'hidden' }}>
                {/* Rows (add personal best row if not present) */}
                {leaderboard.length === 0 && personalRow ? (
                  <div
                    style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.72rem', color: '#555', letterSpacing: '0.1em' }}>
                    NOT RANKED – Your Best: {(personalRow.score||0).toLocaleString()} points
                  </div>
                ) : leaderboard.length === 0 ? (
                  <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.72rem', color: '#555', letterSpacing: '0.1em' }}>NO SCORES YET</div>
                ) : (
                  leaderboard.map((entry, i) => {
                    const isMe = entry.uid === user?.uid
                    const ts = entry.timestamp
                    const dt = ts?.toDate ? ts.toDate() : (typeof ts?.seconds === 'number' ? new Date(ts.seconds * 1000) : null)
                    const bg = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'
                    const rankColor = i === 0 ? '#eab308' : i === 1 ? '#9ca3af' : i === 2 ? '#b45309' : '#555'
                    const p = lbProfiles[entry.uid]
                    const name = isMe ? (userProfile?.displayName || 'You') : (p?.displayName || `player_${(entry.uid||'').slice(0,5)}`)
                    const hasNoob = isMe ? isNoob : !!p?.hasPlayedEasy
                    const badge = isMe ? (userProfile?.selectedBadge || null) : (p?.selectedBadge || null)
                    return (
                      <div
                        key={entry.id}
                        onClick={() => !isMe && entry.uid && setProfileModal(entry.uid)}
                        title={!isMe ? 'View profile' : undefined}
                        style={{ display: 'grid', gridTemplateColumns: '40px minmax(170px,1fr) 94px 64px 56px 86px', gap: 8, alignItems: 'center', padding: '8px 10px', borderBottom: i < leaderboard.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', background: bg, cursor: !isMe ? 'pointer' : 'default', transition: 'background 0.12s' }}
                        onMouseEnter={e => { if (!isMe) e.currentTarget.style.background = 'rgba(0,212,255,0.05)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = bg }}
                      >
                        <div style={{ color: rankColor, fontWeight: 700, fontSize: '0.75rem' }}>#{i + 1}</div>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, color: isMe ? '#00d4ff' : '#ddd', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                          {badge && <span style={{ fontSize: '0.45rem', color: '#c084fc', border: '1px solid #c084fc55', borderRadius: 3, padding: '0 4px', background: 'rgba(192,132,252,0.08)', flexShrink: 0, letterSpacing: '0.1em' }}>{badge.replace('badge_', '').toUpperCase()}</span>}
                          {hasNoob && <span style={{ fontSize: '0.45rem', color: '#f87171', border: '1px solid #f8717155', borderRadius: 3, padding: '0 4px', background: 'rgba(248,113,113,0.08)', flexShrink: 0, letterSpacing: '0.1em' }}>NOOB</span>}
                        </div>
                        <div style={{ textAlign: 'right', color: '#eee', fontWeight: 700 }}>{(entry.score||0).toLocaleString()}</div>
                        <div style={{ textAlign: 'right', color: '#aaa' }}>{entry.lines ?? '—'}</div>
                        <div style={{ textAlign: 'right', color: '#aaa' }}>{entry.floors ?? '—'}</div>
                        <div style={{ textAlign: 'right', color: '#777', fontSize: '0.7rem' }}>{relTime(dt)}</div>
                      </div>
                    )
                  })
                )}
                {/* Personal best row if not on leaderboard AND have score */}
                {personalRow && leaderboard.length > 0 && !leaderboard.some(e => e.uid === user?.uid) && personalRow.score > 0 && (
                  <div
                    key={personalRow.uid + '_pers'}
                    title="Your Best (not ranked)"
                    style={{ display: 'grid', gridTemplateColumns: '40px minmax(170px,1fr) 94px 64px 56px 86px', gap: 8, alignItems: 'center', padding: '8px 10px', background: 'rgba(34,197,94,0.09)', borderTop: '1px solid #22c55e22', borderRadius: 7, marginTop: 4, fontStyle: 'italic', color: '#b4f0ce' }}
                  >
                    <div style={{ color: '#22c55e', fontWeight: 700, fontSize: '0.75rem' }}>—</div>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Your Best</span>
                      {personalRow.badge && <span style={{ fontSize: '0.45rem', color: '#c084fc', border: '1px solid #c084fc55', borderRadius: 3, padding: '0 4px', background: 'rgba(192,132,252,0.08)', flexShrink: 0, letterSpacing: '0.1em' }}>{personalRow.badge.replace('badge_', '').toUpperCase()}</span>}
                      {personalRow.hasNoob && <span style={{ fontSize: '0.45rem', color: '#f87171', border: '1px solid #f8717155', borderRadius: 3, padding: '0 4px', background: 'rgba(248,113,113,0.08)', flexShrink: 0, letterSpacing: '0.1em' }}>NOOB</span>}
                    </div>
                    <div style={{ textAlign: 'right', color: '#eee', fontWeight: 700 }}>{(personalRow.score||0).toLocaleString()}</div>
                    <div style={{ textAlign: 'right', color: '#aaa' }}>{personalRow.lines ?? '—'}</div>
                    <div style={{ textAlign: 'right', color: '#aaa' }}>—</div>
                    <div style={{ textAlign: 'right', color: '#777', fontSize: '0.7rem' }}>{relTime(personalRow.timestamp?.toDate?.() ?? null)}</div>
                  </div>
                )}
                </div>
                </div>
                </div>
              </div>
            </div>

            {/* Story chapter progress */}
            <div>
              <div style={{ fontSize: '0.6rem', letterSpacing: '0.22em', color: '#555', margin: '0.75rem 0' }}>Story Chapter Scores</div>
              <div style={{ background: '#0f1120', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden', maxWidth: '100%' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(0,1fr) 92px 76px', gap: 8, alignItems: 'center', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.60rem', color: '#666', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  <div>Chapter</div>
                  <div>Name</div>
                  <div style={{ textAlign: 'right' }}>Score</div>
                  <div style={{ textAlign: 'right' }}>Lines</div>
                </div>
                {STORY_CHAPTERS.map((ch, i) => {
                  const score = Number(storyProgress?.[`${ch.id}_chapter_score`] || 0)
                  const lines = Number(storyProgress?.[`${ch.id}_chapter_lines`] || 0)
                  const bg = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'
                  return (
                    <div key={ch.id} style={{ display: 'grid', gridTemplateColumns: '72px minmax(0,1fr) 92px 76px', gap: 8, alignItems: 'center', padding: '8px 10px', borderBottom: i < STORY_CHAPTERS.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', background: bg }}>
                      <div style={{ color: ch.color, fontSize: '0.65rem', letterSpacing: '0.12em', fontWeight: 700 }}>CH {i + 1}</div>
                      <div style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#ddd', fontSize: '0.72rem' }}>{ch.title}</div>
                      <div style={{ textAlign: 'right', color: '#eee', fontWeight: 700, fontSize: '0.72rem' }}>{score.toLocaleString()}</div>
                      <div style={{ textAlign: 'right', color: '#aaa', fontSize: '0.72rem' }}>{lines.toLocaleString()}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Coin history */}
            <div>
              <div style={{ fontSize: '0.6rem', letterSpacing: '0.22em', color: '#555', margin: '0.75rem 0' }}>Coin History</div>
              <div style={{ background: '#0f1120', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden', maxWidth: '100%' }}>
                <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr auto' : '140px 1fr auto', gap: 8, alignItems: 'center', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.60rem', color: '#666', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  {!narrow && <div>When</div>}
                  <div>Source</div>
                  <div style={{ textAlign: 'right' }}>Amount</div>
                </div>
                {coinHistory.length === 0 ? (
                  <div style={{ padding: '1.2rem', textAlign: 'center', fontSize: '0.72rem', color: '#555', letterSpacing: '0.1em' }}>NO ENTRIES</div>
                ) : coinHistory.map((e, i) => {
                  const isEarn = e.type === 'earn'
                  const when = e.createdAt?.toDate ? e.createdAt.toDate() : (typeof e.createdAt?.seconds === 'number' ? new Date(e.createdAt.seconds * 1000) : null)
                  const label = isEarn ? (e.mode ? `Game — ${String(e.mode).toUpperCase()}${e.score ? ` (${(e.score||0).toLocaleString()} pts)` : ''}` : 'Game') : (e.itemId ? `Store — ${e.itemId}` : 'Store')
                  const bg = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'
                  return (
                    <div key={e.id} style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr auto' : '140px 1fr auto', gap: 8, alignItems: 'center', padding: '8px 10px', borderBottom: i < coinHistory.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', background: bg }}>
                      {!narrow && <div style={{ color: '#777', fontSize: '0.7rem' }}>{relTime(when)}</div>}
                      <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isEarn ? '#22c55e' : '#eab308' }}>{label}</div>
                      <div style={{ textAlign: 'right', fontWeight: 700, color: isEarn ? '#22c55e' : '#eab308' }}>{isEarn ? '+' : '-'}{(e.amount||0).toLocaleString()}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Friends section */}
            <div>
              <div style={{ fontSize: '0.6rem', letterSpacing: '0.22em', color: '#555', margin: '0.75rem 0' }}>Friends</div>

              <div style={{ marginBottom: '0.8rem', background: '#0f1120', border: '1px solid rgba(0,212,255,0.14)', borderRadius: 12, padding: '0.9rem' }}>
                <div style={{ fontSize: '0.55rem', letterSpacing: '0.16em', color: '#00d4ff88', marginBottom: 8 }}>YOUR FRIEND ID</div>
                <div style={{ fontSize: '0.8rem', color: '#e5f3ff', letterSpacing: '0.08em', marginBottom: 10 }}>{userProfile?.friendCode || 'Generating…'}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    value={friendCodeInput}
                    onChange={(e) => setFriendCodeInput(e.target.value)}
                    placeholder="displayname#tag"
                    style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', padding: '8px 10px', fontSize: '0.72rem', fontFamily: 'inherit' }}
                  />
                  <button
                    onClick={handleAddByFriendCode}
                    disabled={friendCodeState.kind === 'loading'}
                    style={{ background: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.35)', color: '#00d4ff', borderRadius: 8, padding: '8px 11px', fontSize: '0.66rem', fontFamily: 'inherit', letterSpacing: '0.08em', cursor: 'pointer' }}
                  >
                    {friendCodeState.kind === 'loading' ? '…' : 'ADD'}
                  </button>
                </div>
                {friendCodeState.kind !== 'idle' && (
                  <div style={{ marginTop: 8, fontSize: '0.62rem', color: friendCodeState.kind === 'success' ? '#22c55e' : friendCodeState.kind === 'error' ? '#f87171' : '#888' }}>
                    {friendCodeState.message}
                  </div>
                )}
              </div>

              {/* Pending requests */}
              {friendRequests.length > 0 && (
                <div style={{ marginBottom: '0.8rem' }}>
                  <div style={{ fontSize: '0.55rem', letterSpacing: '0.16em', color: '#eab30888', marginBottom: 6 }}>PENDING REQUESTS</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {friendRequests.map(req => (
                      <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0f1120', border: '1px solid rgba(234,179,8,0.15)', borderRadius: 10, padding: '8px 12px' }}>
                        <div style={{ flex: 1, fontSize: '0.78rem', color: '#eee', letterSpacing: '0.06em' }}>{req.fromName || `player_${req.fromUid?.slice(0, 5)}`}</div>
                        <button
                          disabled={requestAction[req.id] === 'accepting'}
                          onClick={() => handleAccept(req)}
                          style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid #22c55e55', color: '#22c55e', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: '0.65rem', fontFamily: 'inherit', letterSpacing: '0.08em' }}
                        >{requestAction[req.id] === 'accepting' ? '…' : 'Accept'}</button>
                        <button
                          disabled={requestAction[req.id] === 'declining'}
                          onClick={() => handleDecline(req)}
                          style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid #f8717155', color: '#f87171', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: '0.65rem', fontFamily: 'inherit', letterSpacing: '0.08em' }}
                        >{requestAction[req.id] === 'declining' ? '…' : 'Decline'}</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sentFriendRequests.length > 0 && (
                <div style={{ marginBottom: '0.8rem' }}>
                  <div style={{ fontSize: '0.55rem', letterSpacing: '0.16em', color: '#00d4ff88', marginBottom: 6 }}>OUTGOING REQUESTS</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {sentFriendRequests.map(req => (
                      <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0f1120', border: '1px solid rgba(0,212,255,0.15)', borderRadius: 10, padding: '8px 12px' }}>
                        <div style={{ flex: 1, fontSize: '0.78rem', color: '#eee', letterSpacing: '0.06em' }}>{req.toName || lbProfiles[req.toUid]?.displayName || `player_${req.toUid?.slice(0, 5)}`}</div>
                        <div style={{ fontSize: '0.62rem', color: '#00d4ff', letterSpacing: '0.08em' }}>Pending</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Friends list */}
              <div style={{ background: '#0f1120', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' }}>
                {friendsLoading ? (
                  <div style={{ padding: '1.2rem', textAlign: 'center', fontSize: '0.7rem', color: '#555', letterSpacing: '0.12em' }}>LOADING…</div>
                ) : friends.length === 0 ? (
                  <div style={{ padding: '1.2rem', textAlign: 'center', fontSize: '0.72rem', color: '#555', letterSpacing: '0.1em' }}>NO FRIENDS YET — click a leaderboard player to add them!</div>
                ) : (
                  friends.map((f, i) => (
                    <div
                      key={f.uid || i}
                      onClick={() => f.uid && setProfileModal(f.uid)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: i < friends.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', cursor: 'pointer', transition: 'background 0.12s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,212,255,0.05)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#00d4ff44,#a855f744)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0 }}>
                        {(f.displayName || '?')[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1, fontSize: '0.78rem', color: '#ddd', letterSpacing: '0.06em' }}>{f.displayName || `player_${f.uid?.slice(0, 5)}`}</div>
                      <div style={{ fontSize: '0.6rem', color: '#555' }}>›</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Player profile modal */}
      <AnimatePresence>
        {profileModal && (
          <PlayerProfileModal
            uid={profileModal}
            onClose={() => setProfileModal(null)}
            myUid={user?.uid}
            myDisplayName={userProfile?.displayName || user?.displayName || 'Player'}
            friends={friends}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
