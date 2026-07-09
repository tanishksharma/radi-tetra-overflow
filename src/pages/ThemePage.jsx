import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { purchaseItem } from '../firebase/db'
import { useTheme, THEMES } from '../contexts/ThemeContext'
import { STORE_ITEMS } from '../logic/storeData'
import BackgroundCanvas from '../components/BackgroundCanvas'
import homeIconUrl from '../icons/home-button.png'

const BG_ITEMS = STORE_ITEMS.filter(i => i.type === 'bg')
const THEME_STORE_ITEMS = STORE_ITEMS.filter(i => i.type === 'theme')
const THEME_STORE_MAP = Object.fromEntries(THEME_STORE_ITEMS.map(i => [i.themeKey, i]))
const MAX_FAVS = 7
const CUSTOM_PRICE = 600

// Compress an image File to a JPEG data-URL, capped at maxSide px
function compressImage(file, maxSide = 1440, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      // GIFs lose animation after compress; keep as-is for gif
      const isGif = file.type === 'image/gif'
      if (isGif) {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
      } else {
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
    }
    img.onerror = reject
    img.src = url
  })
}

// ─── Custom Image Modal ────────────────────────────────────────────────────────
function CustomImageModal({ coins, onConfirm, onClose, busy }) {
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState(null) // { url, file }
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) {
      setError('Please select an image or GIF file.')
      return
    }
    setError('')
    const url = URL.createObjectURL(file)
    setPreview(prev => { if (prev) URL.revokeObjectURL(prev.url); return { url, file } })
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const canAfford = coins >= CUSTOM_PRICE

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <motion.div
        initial={{ scale: 0.99, opacity: 1 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }}
        style={{
          background: '#0d0d1a', border: '1px solid #eab30840',
          borderRadius: 16, padding: '1.5rem', width: '100%', maxWidth: 380,
          fontFamily: '"Courier New", monospace', color: '#ccc',
          display: 'flex', flexDirection: 'column', gap: '1rem',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 900, fontSize: '0.88rem', letterSpacing: '0.2em', color: '#eab308' }}>🖼️ CUSTOM IMAGE</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
        </div>

        {/* Cost */}
        <div style={{
          background: canAfford ? 'rgba(234,179,8,0.08)' : 'rgba(248,113,113,0.08)',
          border: `1px solid ${canAfford ? 'rgba(234,179,8,0.3)' : 'rgba(248,113,113,0.3)'}`,
          borderRadius: 8, padding: '0.5rem 0.85rem', fontSize: '0.7rem',
          color: canAfford ? '#eab308' : '#f87171', letterSpacing: '0.08em',
        }}>
          {canAfford
            ? `Cost: ◆ ${CUSTOM_PRICE} coins · You have ◆ ${coins}`
            : `Not enough coins — need ◆ ${CUSTOM_PRICE}, have ◆ ${coins}`}
        </div>

        {/* Drop zone / preview */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          style={{
            height: preview ? 'auto' : 140, minHeight: 80,
            border: `2px dashed ${dragOver ? '#eab308' : preview ? '#eab30855' : '#333'}`,
            borderRadius: 10, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8,
            cursor: 'pointer', overflow: 'hidden', transition: 'border-color 0.2s',
            background: dragOver ? 'rgba(234,179,8,0.05)' : 'transparent',
          }}
        >
          {preview ? (
            <img
              src={preview.url}
              alt="preview"
              style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8, display: 'block' }}
            />
          ) : (
            <>
              <div style={{ fontSize: '2rem', opacity: 0.5 }}>📂</div>
              <div style={{ fontSize: '0.65rem', color: '#666', textAlign: 'center', letterSpacing: '0.1em' }}>
                Drop image / GIF here<br />or click to browse
              </div>
            </>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
        />

        {preview && (
          <div style={{ fontSize: '0.6rem', color: '#666', letterSpacing: '0.08em' }}>
            {preview.file.name} · {(preview.file.size / 1024).toFixed(0)} KB
            {preview.file.type !== 'image/gif' && ' → compressed to JPEG'}
          </div>
        )}

        {error && <div style={{ fontSize: '0.62rem', color: '#f87171' }}>{error}</div>}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '0.6rem', borderRadius: 8,
              border: '1px solid #333', background: 'transparent',
              color: '#666', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: '0.7rem', letterSpacing: '0.1em',
            }}
          >CANCEL</button>
          <motion.button
            whileTap={!busy && preview && canAfford ? { scale: 0.96 } : {}}
            disabled={!preview || !canAfford || busy}
            onClick={() => preview && onConfirm(preview.file)}
            style={{
              flex: 2, padding: '0.6rem', borderRadius: 8,
              border: `1px solid ${preview && canAfford ? '#eab308' : '#333'}`,
              background: preview && canAfford ? 'rgba(234,179,8,0.14)' : 'transparent',
              color: preview && canAfford ? '#eab308' : '#444',
              cursor: preview && canAfford && !busy ? 'pointer' : 'default',
              fontFamily: 'inherit', fontSize: '0.72rem',
              letterSpacing: '0.12em', fontWeight: 700,
            }}
          >
            {busy ? 'APPLYING…' : `APPLY  ◆ ${CUSTOM_PRICE}`}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  )
}

export default function ThemePage() {
  const navigate = useNavigate()
  const { user, userProfile, refreshProfile } = useAuth()
  const { theme, setTheme, bgTheme, setBgTheme, favThemes, setFavThemes } = useTheme()

  // Do we have a saved custom background image?
  const hasCustomImg = (() => {
    try { return !!localStorage.getItem('custom-bg-url') } catch { return false }
  })()

  const [selectedSlot, setSelectedSlot] = useState(-1)
  const [customModalOpen, setCustomModalOpen] = useState(false)
  const [customBusy, setCustomBusy] = useState(false)

  const inventory = userProfile?.inventory || []
  const coins = userProfile?.coins ?? 0

  const handleCustomConfirm = async (file) => {
    setCustomBusy(true)
    try {
      if (!user) throw new Error('Sign in required')
      await purchaseItem(user.uid, `bg_custom_use_${Date.now()}`, CUSTOM_PRICE)
      await refreshProfile?.()
      const dataUrl = await compressImage(file)
      try { localStorage.setItem('custom-bg-url', dataUrl) } catch {
        throw new Error('Image too large for local storage — try a smaller file')
      }
      setBgTheme('custom')
      setCustomModalOpen(false)
    } catch (e) {
      window.alert(e?.message || 'Failed to apply custom image')
    } finally {
      setCustomBusy(false)
    }
  }

  const handleSlotClick = (idx) => {
    if (selectedSlot === idx) {
      // Deselect
      setSelectedSlot(-1)
    } else if (favThemes[idx]) {
      // Remove filled slot
      const next = [...favThemes]
      next.splice(idx, 1)
      setFavThemes(next)
      setSelectedSlot(-1)
    } else {
      setSelectedSlot(idx)
    }
  }

  const assignToSlot = (id) => {
    if (selectedSlot < 0) return
    const next = [...favThemes]
    next[selectedSlot] = id
    setFavThemes(next)
    setSelectedSlot(-1)
  }

  const applyTheme = (id) => {
    if (id.startsWith('bg_')) setBgTheme(id.replace('bg_', ''))
    else setTheme(id)
  }

  const slotItems = Array.from({ length: MAX_FAVS }, (_, i) => favThemes[i] || null)

  return (
    <div style={{
      minHeight: '100dvh',
      background: '#05050f',
      color: '#ccc',
      fontFamily: '"Courier New", monospace',
      overflowY: 'auto',
    }}>
      {/* Custom image modal */}
      <AnimatePresence>
        {customModalOpen && (
          <CustomImageModal
            coins={coins}
            busy={customBusy}
            onConfirm={handleCustomConfirm}
            onClose={() => !customBusy && setCustomModalOpen(false)}
          />
        )}
      </AnimatePresence>
      {/* Live bg preview */}
      {bgTheme && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          <BackgroundCanvas bgType={bgTheme} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
        </div>
      )}

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 480, margin: '0 auto', padding: 'calc(env(safe-area-inset-top, 0px) + 1.5rem) 1rem 4rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.8rem' }}>
          <button
            onClick={() => navigate('/')}
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.7rem', letterSpacing: '0.12em', display: 'flex', alignItems: 'center', gap: 8 }}
          ><img src={homeIconUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} /><span>MENU</span></button>
          <div style={{ flex: 1, textAlign: 'center', fontSize: '0.9rem', fontWeight: 900, letterSpacing: '0.3em', color: '#fff' }}>
            THEMES
          </div>
          <div style={{ width: 60 }} />
        </div>

        {/* ── Favorites ──────────────────────────────────────────────────── */}
        <section style={{ marginBottom: '2rem' }}>
          <div style={{ fontSize: '0.55rem', letterSpacing: '0.35em', color: '#888', marginBottom: 10, textTransform: 'uppercase' }}>
            Favorites — click a filled slot to remove · click empty slot to assign
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {slotItems.map((id, idx) => {
              const isSelected = selectedSlot === idx
              const isFilled = !!id
              const isBg = id?.startsWith('bg_')
              const item = isBg ? BG_ITEMS.find(i => i.id === id) : THEMES.find(t => t.id === id)
              return (
                <motion.button
                  key={idx}
                  whileTap={{ scale: 0.93 }}
                  onClick={() => handleSlotClick(idx)}
                  style={{
                    width: 52, height: 52, borderRadius: 10,
                    border: isSelected ? '2px solid #fff' : `1px solid ${isFilled ? (item?.accent || '#555') : '#333'}`,
                    background: isFilled ? 'rgba(255,255,255,0.06)' : 'transparent',
                    cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                    position: 'relative', boxShadow: isSelected ? '0 0 12px rgba(255,255,255,0.4)' : 'none',
                  }}
                >
                  {isFilled ? (
                    <>
                      <span style={{ fontSize: '1.3rem', lineHeight: 1 }}>{item?.emoji || '?'}</span>
                      <span style={{ fontSize: '0.42rem', letterSpacing: '0.1em', color: item?.accent || '#aaa', textTransform: 'uppercase', maxWidth: 46, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item?.name || id}</span>
                    </>
                  ) : (
                    <span style={{ fontSize: '0.7rem', color: '#444', fontWeight: 700 }}>{idx + 1}</span>
                  )}
                </motion.button>
              )
            })}
          </div>
          {selectedSlot >= 0 && (
            <div style={{ fontSize: '0.55rem', color: '#f59e0b', letterSpacing: '0.15em', marginTop: 8 }}>
              Slot {selectedSlot + 1} selected — pick a theme below to assign
            </div>
          )}
        </section>

        {/* ── Piece Themes ───────────────────────────────────────────────── */}
        <section style={{ marginBottom: '2rem' }}>
          <div style={{ fontSize: '0.55rem', letterSpacing: '0.35em', color: '#888', marginBottom: 10, textTransform: 'uppercase' }}>
            Piece Themes
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {THEMES.map(t => {
              const storeItem = THEME_STORE_MAP[t.id]
              // classic is always free; store items need inventory check
              const isOwned = t.id === 'classic' || !storeItem || inventory.includes(storeItem.id)
              const isActive = theme === t.id
              const isAssigning = selectedSlot >= 0
              const accent = storeItem?.accent
              return (
                <motion.button
                  key={t.id}
                  whileTap={isOwned ? { scale: 0.94 } : {}}
                  onClick={() => {
                    if (!isOwned) return
                    isAssigning ? assignToSlot(t.id) : applyTheme(t.id)
                  }}
                  title={!isOwned && storeItem?.unlockCondition
                    ? `🔒 ${storeItem.unlockCondition}${storeItem.price > 0 ? ` or ◆ ${storeItem.price}` : ''}`
                    : undefined}
                  style={{
                    flex: '1 1 calc(25% - 8px)', minWidth: 70, height: 72, borderRadius: 10,
                    border: isActive ? `2px solid ${accent || '#fff'}` : `1px solid ${isOwned ? (accent ? accent + '55' : '#333') : '#222'}`,
                    background: isActive ? `${accent || '#fff'}15` : isOwned ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.35)',
                    cursor: isOwned ? 'pointer' : 'not-allowed',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                    opacity: isOwned ? 1 : 0.45,
                    boxShadow: isActive ? `0 0 14px ${accent || '#fff'}55` : 'none',
                    transition: 'all 0.18s ease', position: 'relative',
                  }}
                >
                  {!isOwned && (
                    <div style={{ position: 'absolute', top: 4, right: 6, fontSize: '0.5rem', color: '#555' }}>🔒</div>
                  )}
                  {isOwned && isActive && (
                    <div style={{ position: 'absolute', top: 3, right: 5, fontSize: '0.42rem', letterSpacing: '0.15em', color: accent || '#fff', opacity: 0.8 }}>ON</div>
                  )}
                  <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>{t.emoji}</span>
                  <span style={{ fontSize: '0.45rem', letterSpacing: '0.12em', color: isActive ? (accent || '#fff') : isOwned ? '#888' : '#444', textTransform: 'uppercase' }}>{t.label}</span>
                  {!isOwned && storeItem?.price > 0 && (
                    <span style={{ fontSize: '0.4rem', color: '#eab308', letterSpacing: '0.1em' }}>◆ {storeItem.price}</span>
                  )}
                  {!isOwned && storeItem?.storyUnlock && (
                    <span style={{ fontSize: '0.38rem', color: '#a855f7', letterSpacing: '0.08em' }}>STORY</span>
                  )}
                </motion.button>
              )
            })}
          </div>
        </section>

        {/* ── World (BG) Themes ──────────────────────────────────────────── */}
        <section>
          <div style={{ fontSize: '0.55rem', letterSpacing: '0.35em', color: '#888', marginBottom: 10, textTransform: 'uppercase' }}>
            World Themes — unlock by clearing story levels
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {BG_ITEMS.map(item => {
              const unlocked = inventory.includes(item.id)
              const isActive = bgTheme === item.bgType
              const isAssigning = selectedSlot >= 0
              return (
                <motion.button
                  key={item.id}
                  whileTap={unlocked ? { scale: 0.94 } : {}}
                  onClick={() => {
                    if (!unlocked) return
                    if (item.bgType === 'custom') {
                      if (hasCustomImg) setBgTheme('custom'); else setCustomModalOpen(true)
                      return
                    }
                    isAssigning ? assignToSlot(item.id) : applyTheme(item.id)
                  }}
                  style={{
                    flex: '1 1 calc(25% - 8px)', minWidth: 70, height: 72, borderRadius: 10,
                    border: isActive ? `2px solid ${item.accent}` : `1px solid ${unlocked ? item.accent + '55' : '#222'}`,
                    background: isActive ? `${item.accent}15` : unlocked ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.4)',
                    cursor: unlocked ? 'pointer' : 'not-allowed',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                    opacity: unlocked ? 1 : 0.45,
                    boxShadow: isActive ? `0 0 14px ${item.accent}55` : 'none',
                    transition: 'all 0.18s ease', position: 'relative',
                  }}
                >
                  {!unlocked && (
                    <div style={{ position: 'absolute', top: 4, right: 6, fontSize: '0.5rem', color: '#555' }}>🔒</div>
                  )}
                  <span style={{ fontSize: '1.3rem', lineHeight: 1 }}>{item.emoji}</span>
                  <span style={{ fontSize: '0.42rem', letterSpacing: '0.1em', color: isActive ? item.accent : '#888', textTransform: 'uppercase', maxWidth: 62, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                  {item.bgType === 'custom' && hasCustomImg && unlocked && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setCustomModalOpen(true) }}
                      title={`Edit image (◆ ${CUSTOM_PRICE})`}
                      style={{ position: 'absolute', bottom: 4, right: 4, fontSize: '0.5rem', letterSpacing: '0.12em',
                               background: 'rgba(234,179,8,0.10)', border: '1px solid #eab30866', color: '#eab308',
                               borderRadius: 6, padding: '2px 6px', cursor: 'pointer' }}
                    >
                      ✎
                    </button>
                  )}
                </motion.button>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
