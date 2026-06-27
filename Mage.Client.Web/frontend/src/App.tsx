import { useState } from 'react'
import { TopBar } from './components/TopBar'
import { LoginView } from './components/LoginView'
import { LobbyView } from './components/LobbyView'
import type { Session } from './types'
import './theme.css'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [online, setOnline] = useState(false)

  return (
    <>
      <TopBar online={session ? online : false} server={session?.server} />
      <main id="app">
        {session ? (
          <LobbyView
            session={session}
            onDisconnected={() => {
              setSession(null)
              setOnline(false)
            }}
            onOnlineChange={setOnline}
          />
        ) : (
          <LoginView onConnected={setSession} />
        )}
      </main>
    </>
  )
}
