import { useState } from 'react'
import { TopBar } from './components/TopBar'
import { LoginView } from './components/LoginView'
import { LobbyView } from './components/LobbyView'
import { DeckEditor } from './components/DeckEditor'
import type { Session } from './types'
import './theme.css'

type View = 'play' | 'decks'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [online, setOnline] = useState(false)
  const [view, setView] = useState<View>('play')

  return (
    <>
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
