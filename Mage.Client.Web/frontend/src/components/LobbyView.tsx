import { useCallback, useEffect, useState } from 'react'
import {
  createGameVsAi,
  disconnect,
  fetchMatches,
  fetchTables,
  joinTable,
  respond,
  sendChat,
  watchGame,
} from '../api'
import type { MatchDto, RespondKind } from '../api'
import { useServerEvents } from '../useServerEvents'
import { ChatPanel } from './ChatPanel'
import { DeckPicker } from './DeckPicker'
import { GameTable } from './GameTable'
import type { ChatLine, GameState, Prompt, Session, TableDto } from '../types'

// Default deck used when sitting down at a table (a .dck path on the server).

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
  const [gameLog, setGameLog] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [matches, setMatches] = useState<MatchDto[]>([])

  const toggleHistory = useCallback(() => {
    setShowHistory((prev) => {
      const next = !prev
      if (next) fetchMatches(session.token).then(setMatches).catch(() => setMatches([]))
      return next
    })
  }, [session.token])

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
    } else if (e.type === 'log' && e.text) {
      setGameLog((prev) => [...prev.slice(-299), e.text as string])
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

  // deck picker drives both Join and New-game-vs-AI; remember which
  const [deckIntent, setDeckIntent] = useState<{ mode: 'join' | 'create'; tableId?: string } | null>(null)

  const handleJoin = useCallback((tableId: string) => setDeckIntent({ mode: 'join', tableId }), [])

  const onDeckPicked = useCallback(
    (path: string) => {
      const intent = deckIntent
      setDeckIntent(null)
      if (!intent) return
      if (intent.mode === 'create') {
        createGameVsAi(session.token, path).catch(() => {})
      } else if (intent.tableId) {
        joinTable(session.token, intent.tableId, path).catch(() => {})
      }
    },
    [deckIntent, session.token],
  )

  const handleNewGame = useCallback(() => setDeckIntent({ mode: 'create' }), [])

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
    setGameLog([])
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
        <h1 className="h1">
          {activeGameId ? (interactive ? 'Playing' : 'Spectating') : showHistory ? 'Match history' : 'Open tables'}
        </h1>
        {!activeGameId && !showHistory && (
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
          <button className={`btn${showHistory ? ' primary' : ''}`} onClick={toggleHistory}>
            {showHistory ? 'Tables' : 'History'}
          </button>
        )}
        {!activeGameId && !showHistory && (
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
              log={gameLog}
              onRespond={handleRespond}
              onLeave={handleLeaveGame}
            />
          ) : showHistory ? (
            <div className="panel table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Match</th>
                    <th>Game type</th>
                    <th>Players</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m, i) => (
                    <tr key={i}>
                      <td>{m.name}</td>
                      <td>{m.gameType}</td>
                      <td>{m.players}</td>
                      <td>{m.result}</td>
                    </tr>
                  ))}
                  {matches.length === 0 && (
                    <tr>
                      <td className="empty" colSpan={4}>
                        No finished matches yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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

      {deckIntent && (
        <DeckPicker
          title={deckIntent.mode === 'create' ? 'Pick your deck (vs AI)' : 'Pick a deck to join with'}
          onPick={(d) => onDeckPicked(d.path)}
          onClose={() => setDeckIntent(null)}
        />
      )}
    </section>
  )
}
