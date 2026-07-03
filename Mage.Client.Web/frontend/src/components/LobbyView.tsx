import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createDraft,
  createGameVsAi,
  createTable,
  disconnect,
  fetchMatches,
  fetchRoomUsers,
  fetchServerMessages,
  fetchTables,
  joinTable,
  joinTournament,
  respond,
  sendChat,
  watchStop,
  watchTable,
  watchTournament,
} from '../api'
import type { MatchDto, RespondKind, RoomUserDto, TableConfig } from '../api'
import { useServerEvents } from '../useServerEvents'
import { setReportSnapshot } from '../reportState'
import { pushToast } from '../toast'
import { notifyIfHidden } from '../notify'
import { playCue } from '../sound'
import { plain } from '../text'
import { usePrefs } from '../prefs'
import { ChatPanel } from './ChatPanel'
import { DeckPicker } from './DeckPicker'
import { TableSetup } from './TableSetup'
import { WaitingRoom } from './WaitingRoom'
import { TournamentModal } from './TournamentModal'
import { ConstructView } from './ConstructView'
import { DraftView } from './DraftView'
import { SideboardView } from './SideboardView'
import { GameTable } from './GameTable'
import type {
  ChatLine,
  DraftCard,
  DraftState,
  GameState,
  Prompt,
  Session,
  TableDto,
  UserRequestOption,
} from '../types'

// a table is joinable when it has an open seat and isn't already in a game
function isJoinable(t: TableDto): boolean {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(t.seats || '')
  if (!m) return false
  const state = (t.state || '').toLowerCase()
  return Number(m[1]) < Number(m[2]) && !/duel|finish|sideboard|draft|construct/.test(state)
}

// a table looks like a limited (draft/sealed) event — its players don't bring a deck
function looksLimited(t: TableDto): boolean {
  return /limited|draft|sealed/i.test(`${t.deckType ?? ''} ${t.gameType ?? ''}`)
}

// Default deck used when sitting down at a table (a .dck path on the server).

interface Props {
  session: Session
  onDisconnected: () => void
  onOnlineChange: (online: boolean) => void
}

const TABLE_FILTERS: { id: 'all' | 'open' | 'running' | 'tournament'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open seats' },
  { id: 'running', label: 'In progress' },
  { id: 'tournament', label: 'Tournaments' },
]

/** Small inline password prompt for joining a 🔒 password-protected table. */
function PasswordDialog({
  title,
  onSubmit,
  onCancel,
}: {
  title: string
  onSubmit: (password: string) => void
  onCancel: () => void
}) {
  const [pw, setPw] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="confirm-card panel" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title">🔒 {title}</div>
        <div className="confirm-msg">This table is password-protected — ask the host for the password.</div>
        <input
          className="picker-search pw-input"
          type="password"
          autoFocus
          placeholder="Table password"
          aria-label="Table password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit(pw)}
        />
        <div className="confirm-actions">
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onSubmit(pw)}>
            Join
          </button>
        </div>
      </div>
    </div>
  )
}

export function LobbyView({ session, onDisconnected, onOnlineChange }: Props) {
  const [tables, setTables] = useState<TableDto[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [tablesLoaded, setTablesLoaded] = useState(false)
  const [chat, setChat] = useState<ChatLine[]>([])
  const [activeGameId, setActiveGameId] = useState<string | null>(null)
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  const [draftState, setDraftState] = useState<DraftState | null>(null)
  const [construct, setConstruct] = useState<{ tableId: string; pool: DraftCard[]; time: number | null } | null>(null)
  // between-games sideboarding (seq remounts the editor on a re-pushed frame)
  const [sideboard, setSideboard] = useState<{
    seq: number
    tableId: string
    main: DraftCard[]
    side: DraftCard[]
    time: number | null
    limited: boolean
  } | null>(null)
  // a server question (userRequest frame) answered with one of its option buttons
  const [userReq, setUserReq] = useState<{
    gameId: string | null
    title: string | null
    message: string | null
    options: UserRequestOption[]
  } | null>(null)
  // who's online (polled while the lobby list is visible)
  const [roomUsers, setRoomUsers] = useState<RoomUserDto[]>([])
  const [usersOpen, setUsersOpen] = useState(true)
  // server broadcast messages (dismissible banner above the table list)
  const [serverMsgs, setServerMsgs] = useState<string[]>([])
  const [msgsDismissed, setMsgsDismissed] = useState(false)
  // table-list filtering: the chip is a persisted pref, the text filter is local
  const { prefs, setPref } = usePrefs()
  const tableFilter = prefs.lobbyFilter ?? 'all'
  const [tableQuery, setTableQuery] = useState('')
  const [interactive, setInteractive] = useState(false)
  const [game, setGame] = useState<GameState | null>(null)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [gameLog, setGameLog] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [matches, setMatches] = useState<MatchDto[]>([])
  // we initiated a play (create/join); adopt the next game frame as ours
  const [pendingPlay, setPendingPlay] = useState(false)
  const [playStatus, setPlayStatus] = useState<string | null>(null)
  // an open table we created and are waiting on (the pre-game waiting room)
  const [openTableId, setOpenTableId] = useState<string | null>(null)
  const [openTableDeck, setOpenTableDeck] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(false) // the New-game configuration modal
  const [gameOver, setGameOver] = useState<string | null>(null)
  // the table we're spectating (set by Watch) so "Watch next game" can re-watch
  // the same table when a Bo3/multi-game match moves on to its next game
  const [spectateTableId, setSpectateTableId] = useState<string | null>(null)
  // start with chat collapsed on small/short screens to free space for the board
  const [chatOpen, setChatOpen] = useState(
    () => !(typeof window !== 'undefined' && window.matchMedia('(max-width: 760px), (max-height: 540px)').matches),
  )
  // desktop "maximize within the tab": the board fills the whole window and the
  // site chrome / outer backdrop hide, so the board's own in-canvas scene reads as
  // one continuous thing. Not browser-fullscreen — just an in-tab layout mode.
  const [maximized, setMaximized] = useState(false)
  const toggleMaximized = useCallback(() => {
    setMaximized((m) => {
      const next = !m
      if (next) setChatOpen(false) // collapse chat to its floating toggle
      return next
    })
  }, [])
  useEffect(() => {
    document.documentElement.classList.toggle('board-max', maximized)
    return () => document.documentElement.classList.remove('board-max')
  }, [maximized])
  // in-game the nav tabs and view heading are dead weight — reclaim their rows
  // for the board (Back lives in the game toolbar)
  useEffect(() => {
    document.documentElement.classList.toggle('game-on', !!activeGameId)
    return () => document.documentElement.classList.remove('game-on')
  }, [activeGameId])
  // Esc exits maximized
  useEffect(() => {
    if (!maximized) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMaximized(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maximized])
  // never stay maximized once we're no longer at a game board
  useEffect(() => {
    if (!activeGameId && maximized) setMaximized(false)
  }, [activeGameId, maximized])
  // synchronous mirror of activeGameId so back-to-back gameStart+game frames in
  // one event-loop tick don't read a stale value (which clobbered interactive)
  const activeRef = useRef<string | null>(null)
  // last active player we toasted for, so "Your turn" fires once per turn
  const lastActiveRef = useRef<string | null>(null)
  const lastTurnRef = useRef<number | null>(null)

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
      setTablesLoaded(true) // only show the empty state after a real fetch, not on first paint
    }
  }, [session.token])

  // react to live server push: chat, game state/decisions, match start, table changes
  const { online } = useServerEvents(session.token, (e) => {
    if (e.type === 'chat') {
      setChat((prev) => [
        ...prev.slice(-199),
        { user: e.user, text: e.text ?? '', color: e.color, time: e.time, messageType: e.messageType },
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
      setSideboard(null) // sideboarding is over once the next game starts
      setGameOver(null)
      setGame(null)
      setPrompt(null)
      setSpectateTableId(null) // we're a player now, not a spectator
      pushToast('Game started')
      playCue('start')
    } else if (e.type === 'showTournament' && e.tournamentId) {
      setTournamentView(e.tournamentId)
    } else if (e.type === 'watchGame' && e.gameId) {
      // answer to a watch-table request: the gateway resolved the table's CURRENT
      // game — adopt it as the board we're spectating (mirrors gameStart, but
      // non-interactive). Also fires when "Watch next game" re-watches a table.
      activeRef.current = e.gameId
      lastActiveRef.current = null
      setActiveGameId(e.gameId)
      setInteractive(false)
      setGame(null)
      setPrompt(null)
      setGameOver(null)
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
        // drop a turn separator into the game log when the turn advances, so the
        // log reads as grouped rounds (sentinel prefix rendered as a divider)
        if (typeof g.turn === 'number' && g.turn !== lastTurnRef.current) {
          lastTurnRef.current = g.turn
          setGameLog((prev) => [...prev.slice(-299), '❖TURN❖' + g.turn])
        }
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
    } else if (e.type === 'draftUpdate') {
      // pack/pick position update — merge into the current draft state
      if (e.draftId) setActiveDraftId(e.draftId)
      setDraftState((prev) =>
        prev
          ? {
              ...prev,
              boosterNum: e.boosterNum ?? prev.boosterNum,
              cardNum: e.cardNum ?? prev.cardNum,
              setNames: e.setNames ?? prev.setNames,
            }
          : prev,
      )
    } else if (e.type === 'draftOver') {
      setActiveDraftId(null)
      setDraftState(null)
    } else if (e.type === 'construct' && e.tableId) {
      // draft finished → build a deck from the pool. Clears any lingering game /
      // game-over state so the construct screen actually surfaces (the timer is
      // running server-side — the player must not burn it on the result overlay).
      setActiveDraftId(null)
      setDraftState(null)
      setSideboard(null)
      activeRef.current = null
      setActiveGameId(null)
      setInteractive(false)
      setGame(null)
      setPrompt(null)
      setGameOver(null)
      setConstruct({ tableId: e.tableId, pool: e.pool ?? [], time: e.time ?? null })
    } else if (e.type === 'sideboard') {
      // between-games sideboarding — surfaces IMMEDIATELY, even over the
      // game-over overlay: the sideboard window is ticking server-side.
      activeRef.current = null
      setActiveGameId(null)
      setInteractive(false)
      setGame(null)
      setPrompt(null)
      setGameOver(null)
      setGameLog([])
      lastTurnRef.current = null
      setConstruct(null)
      setSideboard((prev) => ({
        seq: (prev?.seq ?? 0) + 1,
        tableId: e.tableId ?? '',
        main: e.main ?? [],
        side: e.side ?? [],
        time: e.time ?? null,
        limited: !!e.limited,
      }))
    } else if (e.type === 'userRequest') {
      // a server question with option buttons (rollback votes, permission asks…)
      setUserReq({
        gameId: e.gameId ?? null,
        title: e.title ?? null,
        message: e.message ?? null,
        options: e.options ?? [],
      })
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

  // tear down all in-game state and return to the lobby list (shared by leaving
  // a game, a failed watch, and post-rematch cleanup)
  const resetGameView = useCallback(() => {
    activeRef.current = null
    setActiveGameId(null)
    setInteractive(false)
    setGame(null)
    setPrompt(null)
    setGameLog([])
    lastTurnRef.current = null
    setPendingPlay(false)
    setPlayStatus(null)
    setGameOver(null)
    setSpectateTableId(null)
  }, [])

  // Spectate a table: ask the gateway to watch its CURRENT game. The resolved
  // game id arrives asynchronously as a `watchGame` frame (handled above); until
  // then we optimistically open the board on the last game id we know of.
  // tournament spectating: the id arrives via a showTournament frame after a
  // tournament-watch request; non-null renders the standings/pairings modal
  const [tournamentView, setTournamentView] = useState<string | null>(null)

  const handleWatch = useCallback(
    (t: TableDto) => {
      const fallback = t.games.length > 0 ? t.games[t.games.length - 1] : null
      setSpectateTableId(t.id)
      activeRef.current = fallback
      setActiveGameId(fallback)
      setInteractive(false)
      setGame(null)
      setPrompt(null)
      setGameOver(null)
      watchTable(session.token, t.id)
        .then((r) => {
          if (!r.ok) throw new Error('the server refused')
        })
        .catch((err) => {
          pushToast(`Could not watch: ${err instanceof Error ? err.message : 'error'}`, 'error')
          resetGameView()
        })
    },
    [session.token, resetGameView],
  )

  // Spectator's "Watch next game": re-watch the same table so the gateway picks
  // up the match's next game (the finished game's id is stale by then).
  const handleWatchNext = useCallback(() => {
    if (!spectateTableId) return
    if (activeRef.current) {
      watchStop(session.token, activeRef.current).catch(() => {})
      activeRef.current = null // discard frames for the finished game
    }
    setGame(null)
    setPrompt(null)
    setGameOver(null)
    setGameLog([])
    lastTurnRef.current = null
    watchTable(session.token, spectateTableId)
      .then((r) => {
        if (!r.ok) throw new Error('the server refused')
      })
      .catch((err) => {
        pushToast(`Could not watch the next game: ${err instanceof Error ? err.message : 'error'}`, 'error')
        resetGameView()
      })
  }, [spectateTableId, session.token, resetGameView])

  // deck picker drives Join (regular tables + tournaments); remember which table
  const [deckIntent, setDeckIntent] = useState<{ table: TableDto } | null>(null)
  // a passworded table waiting on its password (after the deck was picked)
  const [pwPrompt, setPwPrompt] = useState<{ table: TableDto; deckPath?: string } | null>(null)
  // the last vs-AI setup, so "Play again" can rematch without re-picking a deck
  const [lastCreate, setLastCreate] = useState<{ path: string; opponents: number } | null>(null)

  // actually sit down: tournaments go through /api/tournament/join, everything
  // else through /api/join. Password (if any) was collected beforehand.
  const doJoin = useCallback(
    (table: TableDto, deckPath: string | undefined, password: string | undefined) => {
      setPendingPlay(true)
      setPlayStatus('Joining…')
      const req = table.isTournament
        ? joinTournament(session.token, table.id, deckPath, password)
        : joinTable(session.token, table.id, deckPath ?? '', password)
      req
        .then((r) => {
          if (!r.ok) throw new Error('the server refused')
          if (table.isTournament) setPlayStatus('Joined — waiting for the tournament to start…')
        })
        .catch((err) => {
          setPendingPlay(false)
          setPlayStatus(`Could not join: ${err instanceof Error ? err.message : 'error'}`)
        })
    },
    [session.token],
  )

  // Join clicked on a lobby row: limited tournaments skip the deck picker
  // entirely (the deck is built after the draft/sealed pool), everything else
  // picks a deck first; passworded tables then prompt for the password.
  const handleJoin = useCallback(
    (table: TableDto) => {
      if (table.isTournament && looksLimited(table)) {
        if (table.passwordProtected) setPwPrompt({ table, deckPath: undefined })
        else doJoin(table, undefined, undefined)
        return
      }
      setDeckIntent({ table })
    },
    [doJoin],
  )

  // leave the waiting room (WaitingRoom removes the table itself); just reset state
  const handleCancelTable = useCallback(() => {
    setOpenTableId(null)
    setOpenTableDeck(null)
    setPendingPlay(false)
    setPlayStatus(null)
  }, [])

  // the deck picker resolved (a deck, or explicitly "no deck" for limited events)
  const onDeckPicked = useCallback(
    (path: string | undefined) => {
      const intent = deckIntent
      setDeckIntent(null)
      if (!intent) return
      if (intent.table.passwordProtected) {
        setPwPrompt({ table: intent.table, deckPath: path })
        return
      }
      doJoin(intent.table, path, undefined)
    },
    [deckIntent, doJoin],
  )

  const handleNewGame = useCallback(() => setSetupOpen(true), [])

  // create a fully-configured table; either start vs AI now or open a waiting room
  const handleTableCreate = useCallback(
    (config: TableConfig) => {
      setSetupOpen(false)
      setPendingPlay(true)
      setLastCreate({ path: config.deckPath, opponents: Math.max(1, config.aiOpponents) })
      setPlayStatus(config.openSeats > 0 ? 'Opening your table…' : 'Starting game…')
      createTable(session.token, config)
        .then((r) => {
          if (!r.ok) {
            setPlayStatus('Could not create the table (is the deck valid for the format?)')
            setPendingPlay(false)
            return
          }
          if (r.openSeats > 0) {
            setOpenTableId(r.tableId)
            setOpenTableDeck(config.deckPath)
            setPlayStatus(null)
          }
          // openSeats === 0 → started now; the gameStart event adopts the board
        })
        .catch((err) => {
          setPlayStatus(`Could not create: ${err instanceof Error ? err.message : 'error'}`)
          setPendingPlay(false)
        })
    },
    [session.token],
  )

  const handleRespond = useCallback(
    (kind: RespondKind, value?: string, data?: number) => {
      if (!activeGameId) return
      setPrompt(null) // optimistic - the next state push will refresh it
      respond(session.token, activeGameId, kind, value, data).catch(() => {
        /* ignore; server will re-prompt if needed */
      })
    },
    [session.token, activeGameId],
  )

  // "Tap N lands from a stack": xmage taps one permanent per priority round, so we
  // queue the chosen land ids and feed them in one at a time as priority returns.
  const tapQueueRef = useRef<string[]>([])
  const handleTapMany = useCallback(
    (ids: string[]) => {
      if (!ids.length) return
      tapQueueRef.current = ids.slice(1)
      handleRespond('uuid', ids[0])
    },
    [handleRespond],
  )
  // drain the queue: send the next land each time we get priority back; abandon the
  // rest if any other decision interrupts (a target prompt, a triggered ability, …)
  useEffect(() => {
    if (!tapQueueRef.current.length) return
    if (prompt?.kind === 'select') {
      const next = tapQueueRef.current.shift()!
      handleRespond('uuid', next)
    } else if (prompt) {
      tapQueueRef.current = []
    }
  }, [prompt, handleRespond])

  const handleLeaveGame = useCallback(() => {
    // spectators tell the gateway to drop the watch subscription server-side
    if (!interactive && activeRef.current) {
      watchStop(session.token, activeRef.current).catch(() => {})
    }
    resetGameView()
  }, [interactive, session.token, resetGameView])

  // rematch: tear down the finished game and start a fresh one with the same deck + AI count
  const handlePlayAgain = useCallback(() => {
    if (!lastCreate) return
    resetGameView()
    setPendingPlay(true)
    setPlayStatus('Starting rematch…')
    createGameVsAi(session.token, lastCreate.path, lastCreate.opponents)
      .then((r) => {
        if (!r.ok) setPlayStatus('Could not start the rematch (deck still valid?)')
      })
      .catch((err) => setPlayStatus(`Could not start: ${err instanceof Error ? err.message : 'error'}`))
  }, [lastCreate, session.token, resetGameView])

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

  // who's online: poll every 30s while the lobby (not a game board) is visible
  useEffect(() => {
    if (activeGameId) return
    let alive = true
    const load = () =>
      fetchRoomUsers(session.token)
        .then((u) => {
          if (alive) setRoomUsers(u)
        })
        .catch(() => {
          /* keep the last known list */
        })
    load()
    const t = setInterval(load, 30000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [session.token, activeGameId])

  // server broadcast messages (message of the day) — fetched once per session
  useEffect(() => {
    fetchServerMessages(session.token)
      .then((r) => setServerMsgs(r.messages ?? []))
      .catch(() => setServerMsgs([]))
  }, [session.token])

  // client-side table filtering (chip + free-text on name/format)
  const visibleTables = useMemo(() => {
    const q = tableQuery.trim().toLowerCase()
    return tables.filter((t) => {
      if (tableFilter === 'open' && !isJoinable(t)) return false
      if (tableFilter === 'running' && !/duel|playing|sideboard|draft|construct/i.test(t.state || '')) return false
      if (tableFilter === 'tournament' && !t.isTournament) return false
      if (q && !`${t.name} ${t.gameType} ${t.deckType ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [tables, tableFilter, tableQuery])

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

  // between-games sideboarding takes over the whole view (its window is timed)
  if (sideboard) {
    return (
      <SideboardView
        key={`${sideboard.tableId}:${sideboard.seq}`}
        token={session.token}
        tableId={sideboard.tableId}
        initialMain={sideboard.main}
        initialSide={sideboard.side}
        time={sideboard.time}
        limited={sideboard.limited}
      />
    )
  }

  if (construct) {
    return (
      <ConstructView
        token={session.token}
        tableId={construct.tableId}
        pool={construct.pool}
        time={construct.time}
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
        {!activeGameId && !openTableId && playStatus && <span className="muted play-status">{playStatus}</span>}
        <span className="spacer" />
        {!activeGameId && !openTableId && (
          <button className="btn primary" onClick={handleNewGame} title="Configure a game vs AI or open a table for other players">
            New game
          </button>
        )}
        {!activeGameId && !openTableId && !showHistory && (
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
              result={gameOver}
              onRespond={handleRespond}
              onTapMany={handleTapMany}
              maximized={maximized}
              onToggleMaximize={toggleMaximized}
              onLeave={handleLeaveGame}
              onPlayAgain={interactive && lastCreate ? handlePlayAgain : undefined}
              onWatchNext={!interactive && spectateTableId ? handleWatchNext : undefined}
            />
          ) : openTableId ? (
            <WaitingRoom
              token={session.token}
              tableId={openTableId}
              deckPath={openTableDeck ?? ''}
              onCancel={handleCancelTable}
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
            <>
              {serverMsgs.length > 0 && !msgsDismissed && (
                <div className="server-messages panel" role="status">
                  <div className="server-messages-body">
                    {serverMsgs.map((m, i) => (
                      <p className="server-message" key={i}>
                        {plain(m)}
                      </p>
                    ))}
                  </div>
                  <button
                    className="btn ghost server-messages-close"
                    aria-label="Dismiss server messages"
                    title="Dismiss"
                    onClick={() => setMsgsDismissed(true)}
                  >
                    ✕
                  </button>
                </div>
              )}
              <div className="table-filters" role="group" aria-label="Filter tables">
                {TABLE_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    className={`btn filter-chip${tableFilter === f.id ? ' primary' : ''}`}
                    aria-pressed={tableFilter === f.id}
                    onClick={() => setPref('lobbyFilter', f.id)}
                  >
                    {f.label}
                  </button>
                ))}
                <input
                  className="picker-search table-filter-text"
                  placeholder="Filter by name or format…"
                  aria-label="Filter tables by name or format"
                  value={tableQuery}
                  onChange={(e) => setTableQuery(e.target.value)}
                />
              </div>
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
                    {visibleTables.map((t) => (
                      <tr key={t.id}>
                        <td>
                          {t.passwordProtected && (
                            <span className="table-lock" title="Password protected" aria-label="Password protected">
                              🔒{' '}
                            </span>
                          )}
                          <span>{t.name}</span>
                        </td>
                        <td>{t.gameType}</td>
                        <td>{t.controller}</td>
                        <td>{t.seats}</td>
                        <td>{t.state}</td>
                        <td className="row-actions">
                          {t.isTournament ? (
                            <button
                              className="btn watch-btn"
                              onClick={() => {
                                watchTournament(session.token, t.id).then((r) => {
                                  if (!r.ok) pushToast('Could not open the tournament', 'error')
                                }).catch(() => pushToast('Could not open the tournament', 'error'))
                              }}
                            >
                              🏆 Watch
                            </button>
                          ) : t.games.length > 0 ? (
                            <button className="btn watch-btn" onClick={() => handleWatch(t)}>
                              Watch
                            </button>
                          ) : null}
                          {isJoinable(t) && (
                            <button className="btn watch-btn" onClick={() => handleJoin(t)}>
                              Join
                            </button>
                          )}
                          {!isJoinable(t) && t.games.length === 0 && !t.isTournament && <span className="muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {tables.length > 0 && visibleTables.length === 0 && (
                  <div className="empty-state">
                    <p className="empty-state-title">No tables match the filter</p>
                    <button
                      className="btn"
                      onClick={() => {
                        setPref('lobbyFilter', 'all')
                        setTableQuery('')
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                )}
                {tables.length === 0 && tablesLoaded && (
                  <div className="empty-state">
                    <div className="empty-state-icon" aria-hidden>🃏</div>
                    <p className="empty-state-title">No open tables right now</p>
                    <p className="empty-state-sub muted">Start a game against the AI, or open a table for other players to join.</p>
                    <button className="btn primary" onClick={handleNewGame}>
                      New game
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {chatOpen ? (
          <div className="chat-col">
            <button className="btn ghost chat-toggle" onClick={() => setChatOpen(false)} title="Hide chat">
              Chat ✕
            </button>
            {!activeGameId && (
              <div className="panel room-users">
                <button
                  className="room-users-head"
                  aria-expanded={usersOpen}
                  onClick={() => setUsersOpen((o) => !o)}
                  title={usersOpen ? 'Collapse the player list' : 'Expand the player list'}
                >
                  <span className="stack-title">Players online ({roomUsers.length})</span>
                  <span className="overlay-toggle" aria-hidden>
                    {usersOpen ? '▾' : '▸'}
                  </span>
                </button>
                {usersOpen && (
                  <div className="room-users-list">
                    {roomUsers.length === 0 && <p className="muted room-users-empty">Nobody else is online.</p>}
                    {roomUsers.map((u) => (
                      <div className="room-user" key={u.name}>
                        <span className="room-user-name">{u.name}</span>
                        {u.flagName && <span className="room-user-flag muted">{u.flagName}</span>}
                        {u.matchHistory && (
                          <span className="room-user-record muted" title="Match record">
                            {u.matchHistory}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <ChatPanel lines={chat} log={activeGameId ? gameLog : undefined} onSend={handleSendChat} />
          </div>
        ) : (
          <button className="btn chat-reopen" onClick={() => setChatOpen(true)} title="Show chat" aria-label="Show chat">
            💬
          </button>
        )}
      </div>

      {tournamentView && (
        <TournamentModal
          token={session.token}
          tournamentId={tournamentView}
          onClose={() => setTournamentView(null)}
          onWatchTable={(tableId, gameId) => {
            setTournamentView(null)
            handleWatch({ id: tableId, games: gameId ? [gameId] : [] } as TableDto)
          }}
        />
      )}

      {deckIntent && (
        <DeckPicker
          title="Pick a deck to join with"
          onPick={(d) => onDeckPicked(d.path)}
          onClose={() => setDeckIntent(null)}
          // tournaments may be limited events where no deck is needed up front
          onNoDeck={deckIntent.table.isTournament ? () => onDeckPicked(undefined) : undefined}
        />
      )}
      {pwPrompt && (
        <PasswordDialog
          title={`Join ${pwPrompt.table.name}`}
          onSubmit={(pw) => {
            const p = pwPrompt
            setPwPrompt(null)
            doJoin(p.table, p.deckPath, pw)
          }}
          onCancel={() => setPwPrompt(null)}
        />
      )}
      {userReq && (
        <div
          className="confirm-overlay user-request"
          role="dialog"
          aria-modal="true"
          aria-label={plain(userReq.title || userReq.message || 'Server request')}
        >
          <div className="confirm-card panel" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">{plain(userReq.title || 'Question')}</div>
            {userReq.message && <div className="confirm-msg">{plain(userReq.message)}</div>}
            <div className="confirm-actions">
              {(userReq.options.length > 0 ? userReq.options : [{ label: 'OK', action: null }]).map((o, i) => (
                <button
                  key={i}
                  className={`btn ${o.action ? 'primary' : 'ghost'}`}
                  onClick={() => {
                    const rq = userReq
                    setUserReq(null)
                    if (o.action && rq.gameId) {
                      respond(session.token, rq.gameId, 'action', o.action).catch(() => {})
                    }
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {setupOpen && (
        <TableSetup token={session.token} onCreate={handleTableCreate} onClose={() => setSetupOpen(false)} />
      )}
    </section>
  )
}
