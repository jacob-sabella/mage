import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createDraft,
  createGameVsAi,
  createGameVsHuman,
  removeTable,
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
import { setReportSnapshot } from '../reportState'
import { pushToast } from '../toast'
import { notifyIfHidden } from '../notify'
import { playCue } from '../sound'
import { ChatPanel } from './ChatPanel'
import { DeckPicker } from './DeckPicker'
import { ConstructView } from './ConstructView'
import { DraftView } from './DraftView'
import { GameTable } from './GameTable'
import type { ChatLine, DraftCard, DraftState, GameState, Prompt, Session, TableDto } from '../types'

// a table is joinable when it has an open seat and isn't already in a game
function isJoinable(t: TableDto): boolean {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(t.seats || '')
  if (!m) return false
  const state = (t.state || '').toLowerCase()
  return Number(m[1]) < Number(m[2]) && !/duel|finish|sideboard|draft|construct/.test(state)
}

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
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  const [draftState, setDraftState] = useState<DraftState | null>(null)
  const [construct, setConstruct] = useState<{ tableId: string; pool: DraftCard[] } | null>(null)
  const [interactive, setInteractive] = useState(false)
  const [game, setGame] = useState<GameState | null>(null)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [gameLog, setGameLog] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [matches, setMatches] = useState<MatchDto[]>([])
  // we initiated a play (create/join); adopt the next game frame as ours
  const [pendingPlay, setPendingPlay] = useState(false)
  const [playStatus, setPlayStatus] = useState<string | null>(null)
  // an open PvP table we created and are waiting on, so we can cancel it
  const [openTableId, setOpenTableId] = useState<string | null>(null)
  const [gameOver, setGameOver] = useState<string | null>(null)
  // start with chat collapsed on small/short screens to free space for the board
  const [chatOpen, setChatOpen] = useState(
    () => !(typeof window !== 'undefined' && window.matchMedia('(max-width: 760px), (max-height: 540px)').matches),
  )
  // synchronous mirror of activeGameId so back-to-back gameStart+game frames in
  // one event-loop tick don't read a stale value (which clobbered interactive)
  const activeRef = useRef<string | null>(null)
  // last active player we toasted for, so "Your turn" fires once per turn
  const lastActiveRef = useRef<string | null>(null)

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
      activeRef.current = e.gameId
      lastActiveRef.current = null
      setActiveGameId(e.gameId)
      setInteractive(true)
      setPendingPlay(false)
      setPlayStatus(null)
      setOpenTableId(null) // the table started — no longer cancellable
      setConstruct(null)
      setGameOver(null)
      setGame(null)
      setPrompt(null)
      pushToast('Game started')
      playCue('start')
    } else if (e.type === 'game') {
      // adopt the game if we're expecting one but missed the gameStart frame
      if (!activeRef.current && e.gameId && pendingPlay) {
        activeRef.current = e.gameId
        setActiveGameId(e.gameId)
        setInteractive(true)
        setPendingPlay(false)
        setPlayStatus(null)
      }
      // discard stale events for any game other than the one we're currently in
      if (!activeRef.current || (e.gameId && e.gameId !== activeRef.current)) return
      if (e.game) {
        const g = e.game
        // toast once when the turn passes to the viewer (not every priority pass)
        if (g.activePlayer && g.me && g.activePlayer === g.me && lastActiveRef.current !== g.activePlayer) {
          pushToast('Your turn', 'success')
          notifyIfHidden('Your turn')
          playCue('turn')
        }
        lastActiveRef.current = g.activePlayer ?? null
        setGame(g)
      }
      setPrompt(e.prompt ?? null)
    } else if (e.type === 'gameOver') {
      if (!activeRef.current || (e.gameId && e.gameId !== activeRef.current)) return
      if (e.game) setGame(e.game)
      setPrompt(null)
      const over = e.text && e.text.trim() ? e.text : 'Game over'
      setGameOver(over)
      pushToast(over, /win|won/i.test(over) ? 'success' : 'info')
      notifyIfHidden(over)
      playCue(/win|won/i.test(over) ? 'win' : 'lose')
    } else if (e.type === 'log' && e.text) {
      if (!activeRef.current || (e.gameId && e.gameId !== activeRef.current)) return
      setGameLog((prev) => [...prev.slice(-299), e.text as string])
    } else if (e.type === 'draftStart' && e.draftId) {
      setActiveDraftId(e.draftId)
      setDraftState(null)
      setPlayStatus(null)
    } else if (e.type === 'draftPick') {
      if (e.draftId) setActiveDraftId(e.draftId)
      setDraftState(e.draft ?? null)
    } else if (e.type === 'draftOver') {
      setActiveDraftId(null)
      setDraftState(null)
    } else if (e.type === 'construct' && e.tableId) {
      // draft finished → build a deck from the pool
      setActiveDraftId(null)
      setDraftState(null)
      setConstruct({ tableId: e.tableId, pool: e.pool ?? [] })
    } else if (e.type === 'event') {
      refresh()
    }
  })

  const handleNewDraft = useCallback(() => {
    setPendingPlay(false)
    setPlayStatus('Starting booster draft (M19)…')
    createDraft(session.token, 'M19', 3, 3)
      .then((r) => {
        if (!r.ok) setPlayStatus('Could not start the draft')
      })
      .catch((err) => setPlayStatus(`Could not start draft: ${err instanceof Error ? err.message : 'error'}`))
  }, [session.token])

  const leaveDraft = useCallback(() => {
    setActiveDraftId(null)
    setDraftState(null)
  }, [])

  const handleWatch = useCallback(
    (gameId: string) => {
      activeRef.current = gameId
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

  // deck picker drives Join, New-game-vs-AI and New-game-vs-Player; remember which
  const [deckIntent, setDeckIntent] = useState<{ mode: 'join' | 'create'; tableId?: string; vsHuman?: boolean } | null>(null)
  // the last vs-AI setup, so "Play again" can rematch without re-picking a deck
  const [lastCreate, setLastCreate] = useState<{ path: string; opponents: number } | null>(null)

  const handleJoin = useCallback((tableId: string) => setDeckIntent({ mode: 'join', tableId }), [])

  // cancel the open PvP table we're waiting on
  const handleCancelTable = useCallback(() => {
    if (openTableId) removeTable(session.token, openTableId).catch(() => {})
    setOpenTableId(null)
    setPendingPlay(false)
    setPlayStatus(null)
  }, [openTableId, session.token])

  const onDeckPicked = useCallback(
    (path: string, opponents: number) => {
      const intent = deckIntent
      setDeckIntent(null)
      if (!intent) return
      setPendingPlay(true)
      if (intent.mode === 'create' && intent.vsHuman) {
        // open a joinable table and wait in the lobby until another human sits down
        setPlayStatus('Waiting for an opponent to join your table…')
        createGameVsHuman(session.token, path)
          .then((r) => {
            if (r.ok) setOpenTableId(r.tableId)
            else setPlayStatus('Could not open the table (is the deck valid for the format?)')
          })
          .catch((err) => setPlayStatus(`Could not open table: ${err instanceof Error ? err.message : 'error'}`))
      } else if (intent.mode === 'create') {
        setLastCreate({ path, opponents })
        setPlayStatus(opponents > 1 ? `Starting free-for-all (${opponents + 1} players)…` : 'Starting game…')
        createGameVsAi(session.token, path, opponents)
          .then((r) => {
            if (!r.ok) setPlayStatus('Could not start the game (is the deck valid for the format?)')
          })
          .catch((err) => setPlayStatus(`Could not start: ${err instanceof Error ? err.message : 'error'}`))
      } else if (intent.tableId) {
        setPlayStatus('Joining…')
        joinTable(session.token, intent.tableId, path).catch((err) =>
          setPlayStatus(`Could not join: ${err instanceof Error ? err.message : 'error'}`),
        )
      }
    },
    [deckIntent, session.token],
  )

  const handleNewGame = useCallback(() => setDeckIntent({ mode: 'create' }), [])
  const handleNewGameVsHuman = useCallback(() => setDeckIntent({ mode: 'create', vsHuman: true }), [])

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
    activeRef.current = null
    setActiveGameId(null)
    setInteractive(false)
    setGame(null)
    setPrompt(null)
    setGameLog([])
    setPendingPlay(false)
    setPlayStatus(null)
    setGameOver(null)
  }, [])

  // rematch: tear down the finished game and start a fresh one with the same deck + AI count
  const handlePlayAgain = useCallback(() => {
    if (!lastCreate) return
    activeRef.current = null
    setActiveGameId(null)
    setInteractive(false)
    setGame(null)
    setPrompt(null)
    setGameLog([])
    setGameOver(null)
    setPendingPlay(true)
    setPlayStatus('Starting rematch…')
    createGameVsAi(session.token, lastCreate.path, lastCreate.opponents)
      .then((r) => {
        if (!r.ok) setPlayStatus('Could not start the rematch (deck still valid?)')
      })
      .catch((err) => setPlayStatus(`Could not start: ${err instanceof Error ? err.message : 'error'}`))
  }, [lastCreate, session.token])

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

  // keep a fresh snapshot for the Report-a-problem modal (game state as context)
  useEffect(() => {
    setReportSnapshot(activeGameId ? { game, prompt, log: gameLog, interactive } : null)
  }, [activeGameId, game, prompt, gameLog, interactive])

  async function handleDisconnect() {
    await disconnect(session.token)
    onDisconnected()
  }

  if (activeDraftId) {
    return <DraftView token={session.token} draftId={activeDraftId} draft={draftState} onLeave={leaveDraft} />
  }

  if (construct && !activeGameId) {
    return (
      <ConstructView
        token={session.token}
        tableId={construct.tableId}
        pool={construct.pool}
        onLeave={() => setConstruct(null)}
      />
    )
  }

  return (
    <section className="view lobby-view">
      {!online && activeGameId && (
        <div className="reconnect-banner" role="status">
          <span className="reconnect-spinner" aria-hidden /> Connection lost — reconnecting…
        </div>
      )}
      <div className="lobby-header">
        <h1 className="h1">
          {activeGameId ? (interactive ? 'Playing' : 'Spectating') : showHistory ? 'Match history' : 'Open tables'}
        </h1>
        {!activeGameId && !showHistory && (
          <span className="chip">
            {tables.length} {tables.length === 1 ? 'table' : 'tables'}
          </span>
        )}
        {!activeGameId && playStatus && <span className="muted play-status">{playStatus}</span>}
        {!activeGameId && openTableId && (
          <button className="btn ghost" onClick={handleCancelTable} title="Close your open table">
            Cancel
          </button>
        )}
        <span className="spacer" />
        {!activeGameId && (
          <button className="btn primary" onClick={handleNewGame}>
            New game vs AI
          </button>
        )}
        {!activeGameId && !showHistory && (
          <button className="btn" onClick={handleNewGameVsHuman} title="Open a table for another human to join">
            New game vs Player
          </button>
        )}
        {!activeGameId && !showHistory && (
          <button className="btn" onClick={handleNewDraft}>
            Draft vs AI
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
              result={gameOver}
              onRespond={handleRespond}
              onLeave={handleLeaveGame}
              onPlayAgain={lastCreate ? handlePlayAgain : undefined}
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
                        {isJoinable(t) && (
                          <button className="btn watch-btn" onClick={() => handleJoin(t.id)}>
                            Join
                          </button>
                        )}
                        {!isJoinable(t) && t.games.length === 0 && <span className="muted">—</span>}
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

        {chatOpen ? (
          <div className="chat-col">
            <button className="btn ghost chat-toggle" onClick={() => setChatOpen(false)} title="Hide chat">
              Chat ✕
            </button>
            <ChatPanel lines={chat} onSend={handleSendChat} />
          </div>
        ) : (
          <button className="btn chat-reopen" onClick={() => setChatOpen(true)} title="Show chat">
            💬
          </button>
        )}
      </div>

      {deckIntent && (
        <DeckPicker
          title={
            deckIntent.mode !== 'create'
              ? 'Pick a deck to join with'
              : deckIntent.vsHuman
                ? 'Pick your deck (vs Player)'
                : 'Pick your deck (vs AI)'
          }
          showOpponents={deckIntent.mode === 'create' && !deckIntent.vsHuman}
          onPick={(d, opp) => onDeckPicked(d.path, opp)}
          onClose={() => setDeckIntent(null)}
        />
      )}
    </section>
  )
}
