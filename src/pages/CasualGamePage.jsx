import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import App from '../App'
import BackgroundCanvas from '../components/BackgroundCanvas'
import { useTheme, THEMES } from '../contexts/ThemeContext'
import { STORE_ITEMS } from '../logic/storeData'
import homeIconUrl from '../icons/home-button.png'

const BG_ITEMS_MAP = Object.fromEntries(STORE_ITEMS.filter(i => i.type === 'bg').map(i => [i.id, i]))
const THEME_MAP = Object.fromEntries(THEMES.map(t => [t.id, t]))

export default function CasualGamePage() {
  const navigate = useNavigate()
  const { theme, setTheme, bgTheme, setBgTheme, favThemes } = useTheme()
  const [favOpen, setFavOpen] = useState(false)

  return (
    <div style={{ position: 'relative', width: '100dvw', height: '100dvh', overflow: 'hidden' }}>
      {/* World background — always on; default to 'stars' when none selected */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
        <BackgroundCanvas bgType={bgTheme || 'abyss'} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      </div>

      <App />

      {/* ← MENU */}
      <button
        onClick={() => navigate('/')}
        title="Back to menu"
        style={{
          position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 10px)', left: 'calc(env(safe-area-inset-left, 0px) + 10px)', zIndex: 9999,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(6px)',
          border: '1px solid rgba(255,255,255,0.14)',
          color: 'rgba(255,255,255,0.6)',
          borderRadius: 7,
          padding: '4px 11px',
          cursor: 'pointer',
          fontSize: '0.68rem',
          letterSpacing: '0.14em',
          fontFamily: '"Courier New", monospace',
          textTransform: 'uppercase',
          transition: 'color 0.15s, border-color 0.15s',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)' }}
      >
        <img src={homeIconUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
        <span>MENU</span>
      </button>

      {/* Favorites toggle + strip */}
      {favThemes.filter(Boolean).length > 0 && (
        <div style={{
          position: 'fixed', bottom: 10, right: 10, zIndex: 9998,
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
        }}>
          {/* Expanded pill */}
          {favOpen && (
            <div style={{
              display: 'flex', gap: 6,
              background: 'rgba(0,0,0,0.80)', backdropFilter: 'blur(10px)',
              borderRadius: 12, padding: '6px 10px',
              border: '1px solid rgba(255,255,255,0.10)',
            }}>
              {favThemes.map((id, i) => {
                if (!id) return null
                const isBg = id.startsWith('bg_')
                const item = isBg ? BG_ITEMS_MAP[id] : THEME_MAP[id]
                if (!item) return null
                const isActive = isBg ? bgTheme === item.bgType : (theme === id && !bgTheme)
                return (
                  <button
                    key={i}
                    title={item.label || item.name}
                    onClick={() => {
                      if (isBg) setBgTheme(item.bgType)
                      else { setTheme(id) }
                    }}
                    style={{
                      width: 36, height: 36, borderRadius: 8,
                      border: isActive ? `2px solid ${item.accent || '#fff'}` : '1px solid rgba(255,255,255,0.15)',
                      background: isActive ? `${item.accent || '#fff'}22` : 'transparent',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1.1rem', lineHeight: 1,
                      boxShadow: isActive ? `0 0 8px ${item.accent || '#fff'}55` : 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {item.emoji}
                  </button>
                )
              })}
            </div>
          )}

          {/* Toggle button */}
          <button
            onClick={() => setFavOpen(o => !o)}
            title={favOpen ? 'Hide themes' : 'Quick themes'}
            style={{
              width: 36, height: 36, borderRadius: 10,
              background: favOpen ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.65)',
              backdropFilter: 'blur(8px)',
              border: `1px solid ${favOpen ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.12)'}`,
              cursor: 'pointer', fontSize: '1.1rem', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            🎨
          </button>
        </div>
      )}
    </div>
  )
}
