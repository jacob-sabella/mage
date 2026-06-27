import { useCallback, useEffect, useState } from 'react'
import { disconnect, fetchTables, sendChat, watchGame } from '../api'
import { useServerEvents } from '../useServerEvents'
import { ChatPanel } from './ChatPanel'
import { GameTable } from './GameTable'
import type { ChatLine, GameState, Session, TableDto } from '../types'

interface Props {
  session: Session
  onDisconnected: () => void
  onOnlineChange: (online: boolean) => void
}

export function LobbyView({ session, onDisconnected, onOnlineChange }: Props) {
  const [tables, setTables] = useState<TableDto[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [chat, setChat] = useState<ChatLine[]>([])
  const [watchingGameId, setWatchingGameId] = useState<string | null>(null)
  const [game, setGame] = useState<GameState | null>(null)

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

  // react to live server push: chat messages, game state, and table changes
  const { online } = useServerEvents(session.token, (e) => {
    if (e.type === 'chat') {
      setChat((prev) => [
        ...prev.slice(-199),
        { user: e.user, text: e.text ?? '', color: e.color, time: e.time },
      ])
    } else if (e.type === 'game' && e.game) {
      setGame(e.game)
    } else if (e.type === 'event') {
      refresh()
    }
  })

  const handleWatch = useCallback(
    (gameId: string) => {
      setWatchingGameId(gameId)
      setGame(null)
      watchGame(session.token, gameId).catch(() => {
        /* the board simply won't arrive; user can go back */
      })
    },
    [session.token],
  )

  const handleLeaveGame = useCallback(() => {
    setWatchingGameId(null)
    setGame(null)
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
        <h1 className="h1">{watchingGameId ? 'Spectating' : 'Open tables'}</h1>
        {!watchingGameId && (
          <span className="chip">
            {tables.length} {tables.length === 1 ? 'table' : 'tables'}
          </span>
        )}
        <span className="spacer" />
        {!watchingGameId && (
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
          {watchingGameId ? (
            <GameTable game={game} onLeave={handleLeaveGame} />
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
                      <td>
                        {t.games.length > 0 && (
                          <button className="btn watch-btn" onClick={() => handleWatch(t.games[0])}>
                            Watch
                          </button>
                        )}
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
