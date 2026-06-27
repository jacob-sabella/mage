import { useCallback, useEffect, useState } from 'react'
import { createGameVsAi, disconnect, fetchTables, joinTable, respond, sendChat, watchGame } from '../api'
import type { RespondKind } from '../api'
import { useServerEvents } from '../useServerEvents'
import { ChatPanel } from './ChatPanel'
import { GameTable } from './GameTable'
import type { ChatLine, GameState, Prompt, Session, TableDto } from '../types'

// Default deck used when sitting down at a table (a .dck path on the server).
const DEFAULT_DECK = 'Mage.Client/release/sample-decks/AI/FastRedHaste.dck'

interface Props {
  session: Session
  onDisconnected: () => void
  onOnlineChange: (online: boolean) => void
}

export function LobbyView({ session, onDisconnected, onOnlineChange }: Props) {
  const [tables, setTables] = useState<TableDto[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [chat, setChat] = useState<ChatLine[]>([])
  const [activeGameId, setActiveGameId] = useState<string | null>(null)
  const [interactive, setInteractive] = useState(false)
  const [game, setGame] = useState<GameState | null>(null)
  const [prompt, setPrompt] = useState<Prompt | null>(null)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setTables(await fetchTables(session.token))
    } catch {
      /* keep last known tables */
    } finally {
      setRefreshing(false)
    }
  }, [session.token])

  // react to live server push: chat, game state/decisions, match start, table changes
  const { online } = useServerEvents(session.token, (e) => {
    if (e.type === 'chat') {
      setChat((prev) => [
        ...prev.slice(-199),
        { user: e.user, text: e.text ?? '', color: e.color, time: e.time },
      ])
    } else if (e.type === 'gameStart' && e.gameId) {
      // a match we joined has started - switch to the interactive board
      setActiveGameId(e.gameId)
      setInteractive(true)
      setGame(null)
      setPrompt(null)
    } else if (e.type === 'game') {
      if (e.game) setGame(e.game)
      setPrompt(e.prompt ?? null)
    } else if (e.type === 'event') {
      refresh()
    }
  })

  const handleWatch = useCallback(
    (gameId: string) => {
      setActiveGameId(gameId)
      setInteractive(false)
      setGame(null)
      setPrompt(null)
      watchGame(session.token, gameId).catch(() => {
        /* the board simply won't arrive; user can go back */
      })
    },
    [session.token],
  )

  const handleJoin = useCallback(
    (tableId: string) => {
      const deckPath = window.prompt('Deck file (.dck) path on the server:', DEFAULT_DECK)
      if (!deckPath) return
      joinTable(session.token, tableId, deckPath).catch(() => {
        /* the match start (or failure) will be reported via chat/events */
      })
    },
    [session.token],
  )

  const handleNewGame = useCallback(() => {
    const deckPath = window.prompt('Your deck (.dck) path on the server — play vs AI:', DEFAULT_DECK)
    if (!deckPath) return
    // server starts the match; START_GAME arrives over the WS and shows the board
    createGameVsAi(session.token, deckPath).catch(() => {
      /* failure reported via chat/events */
    })
  }, [session.token])

  const handleRespond = useCallback(
    (kind: RespondKind, value?: string) => {
      if (!activeGameId) return
      setPrompt(null) // optimistic - the next state push will refresh it
      respond(session.token, activeGameId, kind, value).catch(() => {
        /* ignore; server will re-prompt if needed */
      })
    },
    [session.token, activeGameId],
  )

  const handleLeaveGame = useCallback(() => {
    setActiveGameId(null)
    setInteractive(false)
    setGame(null)
    setPrompt(null)
  }, [])

  const handleSendChat = useCallback(
    (message: string) => {
      sendChat(session.token, message).catch(() => {
        /* ignore send failures for now */
      })
    },
    [session.token],
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    onOnlineChange(online)
  }, [online, onOnlineChange])

  async function handleDisconnect() {
    await disconnect(session.token)
    onDisconnected()
  }

  return (
    <section className="view lobby-view">
      <div className="lobby-header">
        <h1 className="h1">{activeGameId ? (interactive ? 'Playing' : 'Spectating') : 'Open tables'}</h1>
        {!activeGameId && (
          <span className="chip">
            {tables.length} {tables.length === 1 ? 'table' : 'tables'}
          </span>
        )}
        <span className="spacer" />
        {!activeGameId && (
          <button className="btn primary" onClick={handleNewGame}>
            New game vs AI
          </button>
        )}
        {!activeGameId && (
          <button className="btn" disabled={refreshing} onClick={refresh}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
        <button className="btn ghost" onClick={handleDisconnect}>
          Disconnect
        </button>
      </div>

      <div className="lobby-body">
        <div className="lobby-main">
          {activeGameId ? (
            <GameTable
              game={game}
              prompt={prompt}
              interactive={interactive}
              onRespond={handleRespond}
              onLeave={handleLeaveGame}
            />
          ) : (
            <div className="panel table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Table</th>
                    <th>Game type</th>
                    <th>Host</th>
                    <th>Seats</th>
                    <th>State</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {tables.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td>{t.gameType}</td>
                      <td>{t.controller}</td>
                      <td>{t.seats}</td>
                      <td>{t.state}</td>
                      <td className="row-actions">
                        {t.games.length > 0 && (
                          <button className="btn watch-btn" onClick={() => handleWatch(t.games[0])}>
                            Watch
                          </button>
                        )}
                        <button className="btn watch-btn" onClick={() => handleJoin(t.id)}>
                          Join
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tables.length === 0 && (
                <p className="empty">No open tables right now. Create one or refresh.</p>
              )}
            </div>
          )}
        </div>

        <ChatPanel lines={chat} onSend={handleSendChat} />
      </div>
    </section>
  )
}
