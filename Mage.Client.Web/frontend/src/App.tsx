import { lazy, Suspense, useEffect, useState } from 'react'
import { checkSession } from './api'
import { TopBar } from './components/TopBar'
import { LoginView } from './components/LoginView'
import { LobbyView } from './components/LobbyView'
import { DeckEditor } from './components/DeckEditor'
import { usePrefs } from './prefs'
import type { Session } from './types'
import './theme.css'

const SESSION_KEY = 'mage.session'

// The 3D backdrop (three.js) is purely decorative — load it lazily so it never
// blocks first paint, and quietly skip it if the chunk fails (e.g. no WebGL).
const SceneBackground = lazy(() =>
  import('./components/SceneBackground').then((m) => ({ default: m.SceneBackground })),
)

type View = 'play' | 'decks' | 'settings'

function SettingsView() {
  const { prefs, setPref } = usePrefs()
  return (
    <section className="view settings-view">
      <div className="panel settings-card">
        <h1 className="h1">Preferences</h1>
        <p className="subtitle">Stored in this browser.</p>
        <label className="setting-row">
          <span>
            <strong>Card images</strong>
            <span className="muted setting-hint">Show real card art (off = text-only, faster)</span>
          </span>
          <input
            type="checkbox"
            checked={prefs.cardImages}
            onChange={(e) => setPref('cardImages', e.target.checked)}
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>Avatar id</strong>
            <span className="muted setting-hint">Profile avatar sent to the server</span>
          </span>
          <input
            type="number"
            min={0}
            className="setting-input"
            value={prefs.avatarId}
            onChange={(e) => setPref('avatarId', Number(e.target.value) || 0)}
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>Flag</strong>
            <span className="muted setting-hint">Country flag (e.g. United States)</span>
          </span>
          <input
            type="text"
            className="setting-input"
            value={prefs.flagName}
            placeholder="(none)"
            onChange={(e) => setPref('flagName', e.target.value)}
          />
        </label>
        <p className="muted setting-hint">Profile changes apply on your next connect.</p>
      </div>
    </section>
  )
}

function saveSession(s: Session | null) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  else localStorage.removeItem(SESSION_KEY)
}

export default function App() {
  const [session, setSessionState] = useState<Session | null>(null)
  const [online, setOnline] = useState(false)
  const [view, setView] = useState<View>('play')

  // setSession also persists, so a refresh can resume the same gateway session
  const setSession = (s: Session | null) => {
    saveSession(s)
    setSessionState(s)
  }

  // on load, try to resume a stored session if the gateway still holds it
  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return
    let stored: Session
    try {
      stored = JSON.parse(raw)
    } catch {
      localStorage.removeItem(SESSION_KEY)
      return
    }
    checkSession(stored.token)
      .then((r) => setSessionState({ token: stored.token, server: r.server || stored.server }))
      .catch(() => localStorage.removeItem(SESSION_KEY))
  }, [])

  return (
    <>
      <Suspense fallback={null}>
        <SceneBackground />
      </Suspense>
      <TopBar online={session ? online : false} server={session?.server} />
      {session && (
        <nav className="app-nav">
          <button
            className={`nav-tab ${view === 'play' ? 'active' : ''}`}
            onClick={() => setView('play')}
          >
            Play
          </button>
          <button
            className={`nav-tab ${view === 'decks' ? 'active' : ''}`}
            onClick={() => setView('decks')}
          >
            Deck Editor
          </button>
          <button
            className={`nav-tab ${view === 'settings' ? 'active' : ''}`}
            onClick={() => setView('settings')}
          >
            Settings
          </button>
        </nav>
      )}
      <main id="app">
        {session ? (
          <>
            <div style={{ display: view === 'play' ? 'contents' : 'none' }}>
              <LobbyView
                session={session}
                onDisconnected={() => {
                  setSession(null)
                  setOnline(false)
                  setView('play')
                }}
                onOnlineChange={setOnline}
              />
            </div>
            {view === 'decks' && <DeckEditor />}
            {view === 'settings' && <SettingsView />}
          </>
        ) : (
          <LoginView onConnected={setSession} />
        )}
      </main>
    </>
  )
}
