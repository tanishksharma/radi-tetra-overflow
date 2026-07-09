function StoreSkeletonCard() {
  return (
    <div style={{
      borderRadius: 12,
      padding: '1.1rem',
      background: '#171726',
      border: '1px solid #19193c',
      display: 'flex', flexDirection: 'column', gap: 10,
      boxShadow: 'none', cursor: 'default', position: 'relative', minHeight: 166, opacity: 0.9,
      animation: 'storeSkeletonPulse 1.8s infinite cubic-bezier(.7,0,.3,1)'
    }}>
      <div style={{ width: '36px', height: '36px', background: 'rgba(255,255,255,0.08)', borderRadius: 8, marginBottom: 12, alignSelf:'center' }} />
      <div style={{ width: '66%', height: 16, background: 'rgba(255,255,255,0.09)', borderRadius: 6 }} />
      <div style={{ width: '80%', height: 11, background: 'rgba(255,255,255,0.07)', borderRadius: 4, marginTop: 5 }} />
      <div style={{ width: '52%', height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, marginTop: 7 }} />
      <div style={{ height: 35 }} />
      <div style={{ width: '46%', height: 26, borderRadius: 7, background: 'rgba(255,255,255,0.12)' }} />
    </div>
  )
}

// Add animation globally
if (typeof window !== 'undefined' && !document.getElementById('store-skel-pulse')) {
  const style = document.createElement('style');
  style.id = 'store-skel-pulse';
    style.innerHTML = '@keyframes storeSkeletonPulse { 0%{opacity:.93} 50%{opacity:.66} 100%{opacity:.93}; }';
  document.head.appendChild(style);
}
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { purchaseItem, setActiveBadge, toggleEffect } from '../firebase/db'
import { STORE_ITEMS, ITEM_TYPES } from '../logic/storeData'
import { useTheme } from '../contexts/ThemeContext'
import homeIconUrl from '../icons/home-button.png'

const TAB_LABELS = { theme: 'THEMES', badge: 'BADGES', effect: 'EFFECTS', bg: 'BACKGROUNDS' }

const TIER_COLORS = {
  common: '#94a3b8',
  rare: '#22c55e',
  epic: '#a855f7',
  legendary: '#f59e0b',
}

const isThemeType = (t) => t === 'theme' || t === 'piece_theme' || t === 'ui_theme'
const getStoreTabType = (item) => (isThemeType(item.type) ? 'theme' : item.type)

function CoinBadge({ coins, onClick }) {
  return (
    <div
      onClick={onClick}
      tabIndex={0}
      title="Tap to learn more about coins"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        background: 'rgba(234,179,8,0.12)',
        border: '1px solid rgba(234,179,8,0.3)',
        borderRadius: 20,
        padding: '4px 12px',
        fontSize: '0.82rem',
        color: '#eab308',
        fontWeight: 700,
        cursor: onClick ? 'pointer' : 'default',
        outline: 'none',
        userSelect: 'none',
        boxShadow: onClick ? '0 2px 12px 0 #19193c22' : 'none',
        transition: 'box-shadow 0.13s',
      }}
      onKeyDown={e => { if (e.key === 'Enter' && onClick) onClick(); }}
    >
      ◆ {coins.toLocaleString()}
    </div>
  )
}

function ItemCard({ item, owned, active, onBuy, onEquip, coins }) {
  const [hovered, setHovered] = useState(false)
  const canAfford = coins >= item.price

  let actionLabel, actionFn, actionDisabled = false, actionColor = item.accent
  let showUnequip = false
  if (item.price === 0 || owned) {
    if (isThemeType(item.type) || item.type === 'badge' || item.type === 'bg') {
      actionLabel = active ? 'EQUIPPED' : 'EQUIP'
      actionFn = onEquip
      actionDisabled = active
    } else if (item.type === 'effect') {
      actionLabel = active ? 'EQUIPPED' : 'EQUIP'
      actionFn = onEquip
      actionDisabled = active
      showUnequip = active
    } else {
      actionLabel = owned ? 'OWNED' : 'FREE'
      actionFn = owned ? null : onBuy
      actionDisabled = owned
    }
  } else {
    actionLabel = canAfford ? `◆ ${item.price}` : `◆ ${item.price}`
    actionFn = canAfford ? onBuy : null
    actionDisabled = !canAfford
    actionColor = canAfford ? item.accent : '#555'
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -2 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: active ? `color-mix(in srgb, ${item.accent} 12%, #10101c)` : hovered ? 'rgba(255,255,255,0.04)' : '#10101c',
        border: `1px solid ${active ? item.accent : hovered ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.07)'}`,
        borderRadius: 12,
        padding: '1.1rem',
        display: 'flex', flexDirection: 'column', gap: 10,
        transition: 'all 0.18s ease',
        boxShadow: active ? `0 0 20px ${item.accent}22` : 'none',
        cursor: 'default',
        position: 'relative',
      }}
    >
      {/* Tier label in top right */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 2,
          fontSize: '0.52rem',
          letterSpacing: '0.12em',
          borderRadius: 4,
          padding: '2px 5px',
          border: `1px solid ${(TIER_COLORS[item.tier] || TIER_COLORS.common)}66`,
          color: TIER_COLORS[item.tier] || TIER_COLORS.common,
          background: `${(TIER_COLORS[item.tier] || TIER_COLORS.common)}11`,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          fontWeight: 700,
        }}
      >
        {(item.tier || 'common')}
      </div>

      {/* If active, stack ACTIVE below tier */}
      {active && (
        <div style={{ position: 'absolute', top: 28, right: 8, fontSize: '0.55rem', letterSpacing: '0.2em', color: item.accent, background: `${item.accent}20`, borderRadius: 4, padding: '2px 6px', zIndex: 2 }}>
          ACTIVE
        </div>
      )}

      <div style={{ fontSize: '1.8rem', lineHeight: 1 }}>{item.emoji}</div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: '0.88rem', letterSpacing: '0.12em', color: hovered || active ? item.accent : '#ddd', transition: 'color 0.18s' }}>
            {item.name}
          </div>
        </div>
        <div style={{ fontSize: '0.7rem', color: '#666', marginTop: 3, lineHeight: 1.4 }}>{item.description}</div>
      </div>

      {/* Only render at most ONE button: if showUnequip, render the UNEQUIP action as a div styled like a button, else the main action as button */}
      {showUnequip ? (
        <div
          onClick={onEquip}
          tabIndex={0}
          role="button"
          style={{
            padding: '6px 8px', borderRadius: 7, border: `1px solid ${item.accent}`,
            background: 'transparent',
            color: item.accent,
            cursor: 'pointer',
            fontSize: '0.68rem', letterSpacing: '0.12em', fontFamily: 'inherit',
            textTransform: 'uppercase', marginTop: 4,
            fontWeight: 500,
            outline: 'none',
            textAlign: 'center',
            userSelect: 'none',
          }}
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') ? onEquip && onEquip() : undefined}
        >
          UNEQUIP
        </div>
      ) : (
        <button
          onClick={actionFn || undefined}
          disabled={actionDisabled || !actionFn}
          style={{
            padding: '7px 10px', borderRadius: 7, border: `1px solid ${actionColor}`,
            background: actionDisabled ? 'transparent' : `${actionColor}18`,
            color: actionDisabled ? '#555' : actionColor,
            cursor: actionDisabled || !actionFn ? 'default' : 'pointer',
            fontSize: '0.72rem', letterSpacing: '0.12em', fontFamily: 'inherit',
            textTransform: 'uppercase', transition: 'all 0.15s', marginTop: 'auto',
            fontWeight: 600,
          }}
        >
          {actionLabel}
        </button>
      )}
    </motion.div>
  )
}

export default function StorePage() {
  const navigate = useNavigate()
  const { user, userProfile, refreshProfile } = useAuth()
  const { theme, setTheme, bgTheme, setBgTheme } = useTheme()
  const [activeTab, setActiveTab] = useState('theme')
  const [toast, setToast] = useState(null)
  const [busy, setBusy] = useState(false)


  const coins = userProfile?.coins ?? 0
  const inventory = userProfile?.inventory ?? ['theme_classic']
  const selectedBadge = userProfile?.selectedBadge || null
  const selectedEffects = Array.isArray(userProfile?.selectedEffects) ? userProfile.selectedEffects : []

  const [showCoinInfo, setShowCoinInfo] = useState(false)
  const showToast = (msg, color = '#22c55e') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 2600)
  }

  const handleCoinInfo = () => {
    setShowCoinInfo((prev) => !prev)
  }

  const handleBuy = async (item) => {
    if (busy || !user) return
    setBusy(true)
    try {
      await purchaseItem(user.uid, item.id, item.price)
      await refreshProfile()
      showToast(`Purchased: ${item.name}!`)
      if (isThemeType(item.type)) setTheme(item.themeKey)
    } catch (ex) {
      showToast(ex.message, '#f87171')
    } finally {
      setBusy(false)
    }
  }

  const handleEquip = async (item) => {
    if (isThemeType(item.type)) {
      setTheme(item.themeKey)
      showToast(`Theme applied: ${item.name}`)
    } else if (item.type === 'bg') {
      setBgTheme(item.bgType)
      showToast(`Background applied: ${item.name}`)
    } else if (item.type === 'badge') {
      if (!user) return
      try {
        await setActiveBadge(user.uid, item.id)
        await refreshProfile()
        showToast(`Badge equipped: ${item.name}`)
      } catch (e) {
        showToast(e?.message || 'Failed to equip badge', '#f87171')
      }
    } else if (item.type === 'effect') {
      if (!user) return
      const isActive = selectedEffects.includes(item.id)
      try {
        await toggleEffect(user.uid, item.id, !isActive)
        // Persist multi-effect list to localStorage
        const next = isActive ? selectedEffects.filter(e => e !== item.id) : [...selectedEffects, item.id]
        try { localStorage.setItem('selectedEffects', JSON.stringify(next)) } catch {}
        // Keep legacy single key for backward-compat
        try { if (next.length) localStorage.setItem('selectedEffect', next[next.length - 1]); else localStorage.removeItem('selectedEffect') } catch {}
        await refreshProfile()
        showToast(`${isActive ? 'Effect removed' : 'Effect equipped'}: ${item.name}`)
      } catch (e) {
        showToast(e?.message || 'Failed to toggle effect', '#f87171')
      }
    }
  }

  // Story-unlocked items are not available in the store
  const filtered = STORE_ITEMS.filter((i) => !i.storyUnlock && getStoreTabType(i) === activeTab)

  const loading = !userProfile

  return (
    <div style={{ minHeight: '100dvh', background: '#0a0a14', display: 'flex', flexDirection: 'column', fontFamily: '"Courier New", monospace', color: '#fff' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(env(safe-area-inset-top, 0px) + 1rem) 1.4rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, gap: 12, position: 'relative' }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '0.72rem', letterSpacing: '0.14em', fontFamily: 'inherit', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={homeIconUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
          <span>MENU</span>
        </button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, letterSpacing: '0.2em', color: '#22c55e' }}>STORE</h1>
        <CoinBadge coins={coins} onClick={handleCoinInfo} />
        {/* Coin Info Popup (click-away & reclick to close) */}
        {showCoinInfo && (
          <div
            style={{
              position: 'absolute',
              top: '2.9rem',
              right: 0,
              background: '#111118',
              boxShadow: '0 8px 32px 0 #0007',
              border: '1px solid #222235',
              color: '#fff',
              borderRadius: 12,
              padding: '16px 18px',
              fontSize: '0.83rem',
              minWidth: 230,
              maxWidth: 320,
              zIndex: 200,
              lineHeight: 1.5,
              animation: 'coinPopFade 0.32s',
            }}
            tabIndex={-1}
            onBlur={e => {
              // If the new focus is outside this div, close popup
              if (!e.currentTarget.contains(e.relatedTarget)) setShowCoinInfo(false);
            }}
            ref={el => {
              if (el) setTimeout(() => el.focus(), 0)
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '0.97em', marginBottom: 7, color: '#eab308' }}>All About Coins</div>
            <ul style={{ margin: 0, padding: '0 0 0 1em', fontSize: '0.99em' }}>
              <li>You earn coins for playing games and high scores:</li>
              <ul style={{ margin: '5px 0 7px 0', padding: '0 0 0 1em', color: '#eaca50', fontSize: '0.97em', fontWeight: 500 }}>
                <li>Finish a game: <b>amount depends on your score</b></li>
                <li>First game of the day: <b>+200</b> coins</li>
                <li>Complete a daily challenge: <b>+150</b> coins (per challenge)</li>
                <li>Story milestone: <b>+500</b> coins</li>
              </ul>
              <li>Spend coins in this store to unlock special items, badges, backgrounds, and more!</li>
              <li>Special event/achievement bonuses may be added in future updates.</li>
            </ul>
          </div>
        )}
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', padding: '0 1.4rem', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: 0, flexShrink: 0 }}>
        {ITEM_TYPES.map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              background: 'none', border: 'none', borderBottom: `2px solid ${activeTab === t ? '#22c55e' : 'transparent'}`,
              color: activeTab === t ? '#22c55e' : '#555',
              padding: '10px 16px', cursor: 'pointer', fontSize: '0.72rem',
              letterSpacing: '0.16em', fontFamily: 'inherit', textTransform: 'uppercase', transition: 'all 0.18s',
            }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Coins info */}
      <div style={{ padding: '10px 1.4rem', fontSize: '0.65rem', color: '#555', letterSpacing: '0.1em', flexShrink: 0 }}>
        You can earn coins by completing daily challenges and playing the game. Tap on your coin balance to learn more!
      </div>

      {/* Grid */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        style={{ flex: 1, padding: '0.75rem 1.4rem 2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem', alignContent: 'start', overflowY: 'auto' }}
      >
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <StoreSkeletonCard key={i} />)
          : filtered.map(item => (
              <ItemCard
                key={item.id}
                item={item}
                owned={item.price === 0 || inventory.includes(item.id)}
                active={(isThemeType(item.type) && item.themeKey === theme) || (item.type === 'badge' && item.id === selectedBadge) || (item.type === 'effect' && selectedEffects.includes(item.id)) || (item.type === 'bg' && item.bgType === bgTheme)}
                coins={coins}
                onBuy={() => handleBuy(item)}
                onEquip={() => handleEquip(item)}
              />
            ))}
      </motion.div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            style={{ position: 'fixed', bottom: 24, left: 0, right: 0, margin: '0 auto', width: 'max-content', maxWidth: '90vw', textAlign: 'center', background: '#12121e', border: `1px solid ${toast.color}`, borderRadius: 8, padding: '10px 20px', color: toast.color, fontSize: '0.8rem', letterSpacing: '0.08em', zIndex: 500, whiteSpace: 'nowrap' }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
