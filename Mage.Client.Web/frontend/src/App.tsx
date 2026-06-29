import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { checkSession } from './api'
import { TopBar } from './components/TopBar'
import { LoginView } from './components/LoginView'
import { LobbyView } from './components/LobbyView'
import { DeckEditor } from './components/DeckEditor'
import { ShortcutsOverlay } from './components/ShortcutsOverlay'
import { TestClipsModal } from './components/TestClipsModal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Toaster } from './toast'
import { resetTitle } from './notify'
import { playCue, setSoundEnabled } from './sound'
import { usePrefs, FAMILIES } from './prefs'
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
        <div className="setting-row setting-row-col">
          <span>
            <strong>Theme</strong>
            <span className="muted setting-hint">A family is a world (backdrop + fonts); chromas recolour it</span>
          </span>
          <div className="theme-picker">
            {FAMILIES.map((fam) => (
              <div className="theme-family" key={fam.id}>
                <div className="theme-family-head">
                  <span className="theme-family-label">{fam.label}</span>
                  <span className="muted theme-family-blurb">{fam.blurb}</span>
                </div>
                <div className="theme-swatches">
                  {fam.chromas.map((c) => (
                    <button
                      key={c.id}
                      className={`theme-swatch t-${c.id}${prefs.theme === c.id ? ' active' : ''}`}
                      style={{ background: `linear-gradient(120deg, ${c.a}, ${c.b})` }}
                      onClick={() => setPref('theme', c.id)}
                      title={`${fam.label} · ${c.label}`}
                    >
                      <span className="theme-swatch-label">{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
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
            <strong>Mana symbols</strong>
            <span className="muted setting-hint">Show mana costs as icons instead of {'{3}{B}{B}'} text</span>
          </span>
          <input
            type="checkbox"
            checked={prefs.manaIcons}
            onChange={(e) => setPref('manaIcons', e.target.checked)}
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>Reduce motion</strong>
            <span className="muted setting-hint">Lite mode — drop the animated 3D background (saves battery)</span>
          </span>
          <input
            type="checkbox"
            checked={prefs.reduceMotion}
            onChange={(e) => setPref('reduceMotion', e.target.checked)}
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>Sound effects</strong>
            <span className="muted setting-hint">Short cues for your turn, game start, and game over</span>
          </span>
          <input
            type="checkbox"
            checked={prefs.sound}
            onChange={(e) => {
              setPref('sound', e.target.checked)
              if (e.target.checked) {
                setSoundEnabled(true) // enable immediately so the preview cue plays
                playCue('turn')
              }
            }}
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>Menu opacity</strong>
            <span className="muted setting-hint">How solid menus are — lower lets the backdrop show through</span>
          </span>
          <input
            type="range"
            min={0.35}
            max={1}
            step={0.01}
            value={prefs.panelOpacity}
            onChange={(e) => setPref('panelOpacity', Number(e.target.value))}
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
      <ImageCacheCard />
    </section>
  )
}

interface ImageStats {
  available: boolean
  dir: string | null
  files: number
  sets: number
  bytes: number
  sources: string[]
}

/** Exposes XMage's card/token image system: what it downloads, from where, and
 *  the live state of this server's image cache. */
interface DownloadProgress {
  running: boolean
  cancelled: boolean
  scanned: number
  candidates: number
  done: number
  failed: number
  skipped: number
  /** Images still missing after this run. -1 = not yet computed (run in progress). */
  totalMissing: number
  current: string
  message: string
}

function ImageCacheCard() {
  const [stats, setStats] = useState<ImageStats | null>(null)
  const [error, setError] = useState(false)
  const [prog, setProg] = useState<DownloadProgress | null>(null)

  const refreshStats = useCallback(() => {
    fetch('/api/images/stats')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: ImageStats) => setStats(d))
      .catch(() => setError(true))
  }, [])
  useEffect(refreshStats, [refreshStats])

  // poll download progress while a job is running; refresh stats when it ends
  useEffect(() => {
    if (!prog?.running) return
    const t = setInterval(() => {
      fetch('/api/images/download/progress')
        .then((r) => r.json())
        .then((p: DownloadProgress) => {
          setProg(p)
          if (!p.running) {
            clearInterval(t)
            refreshStats()
          }
        })
        .catch(() => clearInterval(t))
    }, 1200)
    return () => clearInterval(t)
  }, [prog?.running, refreshStats])

  const [batch, setBatch] = useState(250)
  const startDownload = useCallback(() => {
    fetch('/api/images/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: batch }),
    })
      .then(() => fetch('/api/images/download/progress'))
      .then((r) => r.json())
      .then((p: DownloadProgress) => setProg(p))
      .catch(() => undefined)
  }, [batch])
  const cancelDownload = useCallback(() => {
    fetch('/api/images/download/cancel', { method: 'POST' }).catch(() => undefined)
  }, [])

  const mb = stats ? (stats.bytes / (1024 * 1024)).toFixed(0) : '0'
  return (
    <div className="panel settings-card">
      <h1 className="h1">Card &amp; token images</h1>
      <p className="subtitle">Real card and token art served by this site.</p>
      <p className="muted setting-hint">
        XMage downloads high-resolution card and token art from public sources (Scryfall, Gatherer / WizardCards, and
        Grabbag for tokens) into a server-side image cache laid out as{' '}
        <code>&lt;SET&gt;/&lt;Name&gt;.&lt;num&gt;.full.jpg</code>. The web client serves matching art from that cache;
        anything missing falls back to a readable text card — so downloading more art never changes the rules, only the
        visuals.
      </p>
      {error ? (
        <p className="deck-error">Couldn’t read the image cache status.</p>
      ) : !stats ? (
        <p className="muted">Loading image cache status…</p>
      ) : (
        <>
          <div className="img-stats">
            <div className="img-stat">
              <span className="img-stat-n">{stats.files.toLocaleString()}</span>
              <span className="muted">card / token images</span>
            </div>
            <div className="img-stat">
              <span className="img-stat-n">{stats.sets.toLocaleString()}</span>
              <span className="muted">sets</span>
            </div>
            <div className="img-stat">
              <span className="img-stat-n">{mb} MB</span>
              <span className="muted">on disk</span>
            </div>
          </div>
          <p className="muted setting-hint">
            Sources: {stats.sources.join(' · ')}. Cache: <code>{stats.dir ?? '(not configured)'}</code>
            {stats.available ? '' : ' — not mounted on this server'}.
          </p>
          <div className="img-download">
            <button
              className="btn primary"
              onClick={startDownload}
              disabled={!stats.available || prog?.running}
            >
              {prog?.running ? 'Downloading…' : 'Download missing art'}
            </button>
            <label className="muted img-batch">
              Batch
              <select
                className="filter-select"
                value={batch}
                disabled={prog?.running}
                onChange={(e) => setBatch(Number(e.target.value))}
              >
                <option value={250}>250</option>
                <option value={1000}>1,000</option>
                <option value={5000}>5,000</option>
                <option value={1000000}>All missing</option>
              </select>
            </label>
            {prog?.running && (
              <button className="btn ghost" onClick={cancelDownload}>
                Cancel
              </button>
            )}
            <span className="muted setting-hint">
              Fetches missing card art from Scryfall, ~8/sec (rate-limited). Skips art you already have, so it’s
              resumable — and cancellable any time.
            </span>
          </div>
          {prog && (
            <div className="img-progress">
              {prog.running && (
                <div className="img-progress-bar">
                  <div
                    className={`img-progress-fill${prog.message.includes('counting') ? ' img-progress-fill--pulse' : ''}`}
                    style={{ width: prog.message.includes('counting') ? '100%' : `${prog.candidates ? Math.min(100, (prog.done / prog.candidates) * 100) : 4}%` }}
                  />
                </div>
              )}
              <p className="muted setting-hint">
                {prog.running ? (
                  prog.message.includes('counting') ? (
                    <>
                      {prog.done.toLocaleString()} downloaded · counting remaining missing images…
                    </>
                  ) : (
                    <>
                      {prog.done} downloaded · {prog.failed} failed · {prog.skipped.toLocaleString()} already had ·{' '}
                      {prog.current && <span>fetching {prog.current}</span>}
                    </>
                  )
                ) : prog.totalMissing === 0 ? (
                  <span className="img-all-done">All card images are downloaded!</span>
                ) : prog.totalMissing > 0 ? (
                  <>
                    {prog.message} &mdash;{' '}
                    <strong>{prog.totalMissing.toLocaleString()} images still missing</strong>, click &ldquo;Download missing art&rdquo; again for the next batch.
                  </>
                ) : (
                  prog.message
                )}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function saveSession(s: Session | null) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  else localStorage.removeItem(SESSION_KEY)
}

export default function App() {
  const { prefs } = usePrefs()
  const [session, setSessionState] = useState<Session | null>(null)
  const [online, setOnline] = useState(false)
  // remember the active tab across reloads
  const [view, setView] = useState<View>(() => {
    const v = localStorage.getItem('mage.view')
    return v === 'decks' || v === 'settings' ? v : 'play'
  })
  useEffect(() => {
    localStorage.setItem('mage.view', view)
  }, [view])

  // global "?" toggles the keyboard-shortcuts overlay (ignored while typing);
  // typing the secret word "clips" opens the test-recording gallery.
  const [showHelp, setShowHelp] = useState(false)
  const [showClips, setShowClips] = useState(false)
  useEffect(() => {
    let buf = ''
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key.length === 1) {
        buf = (buf + e.key.toLowerCase()).slice(-6)
        if (buf.endsWith('clips')) setShowClips(true)
      }
      if (e.key === '?') {
        e.preventDefault()
        setShowHelp((v) => !v)
      } else if (e.key === 'Escape') {
        setShowHelp(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // clear any flashed tab-title attention once the player looks back at the tab
  useEffect(() => {
    const reset = () => {
      if (document.visibilityState === 'visible') resetTitle()
    }
    window.addEventListener('focus', reset)
    document.addEventListener('visibilitychange', reset)
    return () => {
      window.removeEventListener('focus', reset)
      document.removeEventListener('visibilitychange', reset)
    }
  }, [])

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
      {!prefs.reduceMotion && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <SceneBackground />
          </Suspense>
        </ErrorBoundary>
      )}
      <TopBar online={session ? online : false} server={session?.server} view={view} />
      <nav className="app-nav">
        <button
          className={`nav-tab ${view === 'play' ? 'active' : ''}`}
          onClick={() => setView('play')}
        >
          Play
        </button>
        {session && (
          <button
            className={`nav-tab ${view === 'decks' ? 'active' : ''}`}
            onClick={() => setView('decks')}
          >
            Deck Editor
          </button>
        )}
        <button
          className={`nav-tab ${view === 'settings' ? 'active' : ''}`}
          onClick={() => setView('settings')}
        >
          Settings
        </button>
      </nav>
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
        ) : view === 'settings' ? (
          <SettingsView />
        ) : (
          <LoginView onConnected={setSession} />
        )}
      </main>
      <button className="help-fab" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => setShowHelp(true)}>
        ?
      </button>
      {showHelp && <ShortcutsOverlay onClose={() => setShowHelp(false)} />}
      {showClips && <TestClipsModal onClose={() => setShowClips(false)} />}
      <Toaster />
    </>
  )
}
