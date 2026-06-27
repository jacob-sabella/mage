import { lazy, Suspense, useState } from 'react'
import { TopBar } from './components/TopBar'
import { LoginView } from './components/LoginView'
import { LobbyView } from './components/LobbyView'
import { DeckEditor } from './components/DeckEditor'
import type { Session } from './types'
import './theme.css'

// The 3D backdrop (three.js) is purely decorative — load it lazily so it never
// blocks first paint, and quietly skip it if the chunk fails (e.g. no WebGL).
const SceneBackground = lazy(() =>
  import('./components/SceneBackground').then((m) => ({ default: m.SceneBackground })),
)

type View = 'play' | 'decks'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [online, setOnline] = useState(false)
  const [view, setView] = useState<View>('play')

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
          </>
        ) : (
          <LoginView onConnected={setSession} />
        )}
      </main>
    </>
  )
}
