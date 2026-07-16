// STACKLINE — the deck workbench. One idea organizes everything: there is
// always exactly one focused row (search feed or deck board) and every fast
// verb is a single keystroke or click on that row. Counts are playset pips.
// The preview well is fixed (bottom-left); the tally bar echoes every edit.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { importDeck, listDecks, loadDeck, saveDeck, searchCards, type DeckListItem } from '../api'
import { useEscapeClose } from '../useEscapeClose'
import type { CardInfoDto, DeckCardEntry } from '../types'
import {
  applyAction, BASIC_LANDS, checkFormat, computeStats, copyCap, decklistText, describeAction,
  EMPTY_STATE, entryFromCard, FORMAT_BY_ID, FORMATS, isLand, MANA_HEX, pipsOf,
  primaryType, suggestBasics, TYPE_ORDER, TYPE_PLURAL, WUBRG,
  type BoardId, type BuilderAction, type BuilderState, type FormatId,
} from './deckbuilderCore'
import './deckbuilder.css'

const DRAFT_KEY = 'mage.deckbuilder.draft'
const LEGACY_DRAFT_KEY = 'mage.deck.draft'
const GHOST_KEY = 'mage.deckbuilder.ghost'

const BOARD_LABEL: Record<BoardId, string> = { main: 'Main', side: 'Side', maybe: 'Maybe' }

function loadDraft(): BuilderState {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (raw) {
      const d = JSON.parse(raw) as BuilderState
      if (d && d.boards) return { ...EMPTY_STATE, ...d, boards: { ...EMPTY_STATE.boards, ...d.boards } }
    }
    // migrate the old editor's draft so nobody loses a work-in-progress deck
    const legacy = localStorage.getItem(LEGACY_DRAFT_KEY)
    if (legacy) {
      const d = JSON.parse(legacy) as { deck?: DeckCardEntry[]; sideboard?: DeckCardEntry[]; name?: string; format?: FormatId }
      return {
        ...EMPTY_STATE,
        name: d.name ?? EMPTY_STATE.name,
        format: d.format && d.format in FORMAT_BY_ID ? d.format : 'constructed',
        boards: { main: d.deck ?? [], side: d.sideboard ?? [], maybe: [] },
      }
    }
  } catch {
    /* corrupted draft — start clean */
  }
  return EMPTY_STATE
}

// ---------- undo/redo history ----------

interface History {
  present: BuilderState
  past: { state: BuilderState; label: string }[]
  future: { state: BuilderState; label: string }[]
  lastLabel: string | null
}

function useDeckHistory() {
  const [h, setH] = useState<History>(() => ({ present: loadDraft(), past: [], future: [], lastLabel: null }))
  const dispatch = useCallback((a: BuilderAction) => {
    setH((cur) => {
      const next = applyAction(cur.present, a)
      if (next === cur.present) return cur
      const label = describeAction(a)
      // Coalesce runs of the same transient action (deck-name typing fires one
      // per keystroke) into a single history step, so a rename can't evict 100
      // real edits from the undo stack.
      const coalesce = (a.kind === 'rename' || a.kind === 'setFormat') && cur.lastLabel === label
      const past = coalesce ? cur.past : [...cur.past, { state: cur.present, label }].slice(-100)
      return { present: next, past, future: [], lastLabel: label }
    })
  }, [])
  const undo = useCallback(() => {
    setH((cur) => {
      const p = cur.past[cur.past.length - 1]
      if (!p) return cur
      return {
        present: p.state,
        past: cur.past.slice(0, -1),
        future: [...cur.future, { state: cur.present, label: p.label }],
        lastLabel: `undid ${p.label}`,
      }
    })
  }, [])
  const redo = useCallback(() => {
    setH((cur) => {
      const f = cur.future[cur.future.length - 1]
      if (!f) return cur
      return {
        present: f.state,
        past: [...cur.past, { state: cur.present, label: f.label }],
        future: cur.future.slice(0, -1),
        lastLabel: f.label,
      }
    })
  }, [])
  return { state: h.present, dispatch, undo, redo, canUndo: h.past.length > 0, undoLabel: h.past[h.past.length - 1]?.label ?? null, lastLabel: h.lastLabel }
}

// ---------- small pieces ----------

function ManaGlyphs({ cost }: { cost?: string | null }) {
  const pips = pipsOf(cost)
  if (!pips.length) return null
  return (
    <span className="sl-mana" aria-label={`Mana cost ${pips.join('')}`}>
      {pips.map((p, i) => {
        const color = p.length === 1 && p in MANA_HEX ? MANA_HEX[p] : '#c9c2d8'
        return (
          <span key={i} className="pip" style={{ background: color }}>
            {p.replace('/', '')}
          </span>
        )
      })}
    </span>
  )
}

/** The signature control: click slot N sets the count to N; clicking the
 *  highest filled slot decrements (toggle-off). Cards allowed >4 use a
 *  numeric stepper instead. Singleton formats render a single slot. */
function CountControl({ entry, cap, onSet }: { entry: DeckCardEntry; cap: number; onSet: (n: number) => void }) {
  if (cap > 4) {
    return (
      <span className="sl-numstep">
        <button aria-label={`Remove one ${entry.name}`} onClick={() => onSet(entry.count - 1)}>−</button>
        <span className="sl-count-num">{entry.count}</span>
        <button aria-label={`Add one ${entry.name}`} onClick={() => onSet(entry.count + 1)}>+</button>
      </span>
    )
  }
  const slots = Math.max(1, cap)
  return (
    <span className="sl-pips" role="group" aria-label={`${entry.count} of ${slots} copies`}>
      {Array.from({ length: slots }, (_, i) => {
        const n = i + 1
        const isTop = entry.count === n
        return (
          <button
            key={n}
            className={`sl-pip${entry.count >= n ? ' filled' : ''}`}
            title={isTop ? `↓ ×${n - 1}` : `×${n}`}
            aria-label={isTop ? `Remove a copy of ${entry.name}` : `Set ${entry.name} to ${n}`}
            onClick={() => onSet(isTop ? n - 1 : n)}
          />
        )
      })}
    </span>
  )
}

const cardImg = (name: string, set?: string | null) =>
  `/api/cardimg?set=${encodeURIComponent(set ?? '')}&num=&name=${encodeURIComponent(name)}`

// starter queries for the empty search state
const STARTERS = ['t:creature mv<=2', 'o:"draw a card"', 'o:"destroy target"', 't:legendary t:creature', 't:land o:add']

// ---------- main component ----------

type Zone = 'search' | 'board'
interface RowRef { entry: DeckCardEntry; board: BoardId }

export function DeckBuilder() {
  const { state, dispatch, undo, redo, canUndo, undoLabel, lastLabel } = useDeckHistory()
  const fmt = FORMAT_BY_ID[state.format]

  // latest deck state + a monotonic version, for async callbacks that must not
  // close over a stale snapshot (import network round-trip, save-state race)
  const stateRef = useRef(state)
  const stateVersion = useRef(0)

  // autosave the draft on every mutation
  useEffect(() => {
    stateRef.current = state
    stateVersion.current++
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state))
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [state])

  // ----- search feed -----
  const [query, setQuery] = useState('')
  const [fColors, setFColors] = useState('')
  const [fType, setFType] = useState('')
  const [fRarity, setFRarity] = useState('')
  const [results, setResults] = useState<CardInfoDto[]>([])
  const [searched, setSearched] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const q = [query.trim(), fRarity ? `r:${fRarity}` : ''].filter(Boolean).join(' ')
        const res = await searchCards(q, { colors: fColors, type: fType })
        setResults(res)
        setSearched(true)
        setSearchErr(null)
      } catch (e) {
        setSearchErr(e instanceof Error ? e.message : 'search failed')
        setResults([])
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query, fColors, fType, fRarity])

  // ----- board -----
  const [tab, setTab] = useState<BoardId>('main')
  const [curveFilter, setCurveFilter] = useState<number | null>(null)
  const [ghostOn, setGhostOn] = useState(() => localStorage.getItem(GHOST_KEY) !== 'off')
  useEffect(() => {
    localStorage.setItem(GHOST_KEY, ghostOn ? 'on' : 'off')
  }, [ghostOn])

  const groups = useMemo(() => {
    const list = state.boards[tab].filter((e) => {
      if (curveFilter === null) return true
      if (isLand(e)) return false
      return Math.min(Math.max(0, Math.round(e.manaValue ?? 0)), 7) === curveFilter
    })
    const buckets: Record<string, DeckCardEntry[]> = {}
    for (const e of list) (buckets[primaryType(e)] ??= []).push(e)
    return [...TYPE_ORDER, 'Other']
      .filter((t) => buckets[t]?.length)
      .map((t) => ({
        type: t,
        count: buckets[t].reduce((n, e) => n + e.count, 0),
        entries: buckets[t].sort((a, b) => (a.manaValue ?? 0) - (b.manaValue ?? 0) || a.name.localeCompare(b.name)),
      }))
  }, [state.boards, tab, curveFilter])

  const boardRows: RowRef[] = useMemo(
    () => groups.flatMap((g) => g.entries.map((entry) => ({ entry, board: tab }))),
    [groups, tab],
  )
  // name → row index, so each row looks up its focus index in O(1) instead of a
  // per-row findIndex scan (which made a full board render O(n²))
  const rowIndexByName = useMemo(() => {
    const m = new Map<string, number>()
    boardRows.forEach((r, i) => m.set(r.entry.name, i))
    return m
  }, [boardRows])

  // ----- focus model: exactly one focused row app-wide -----
  const [focus, setFocus] = useState<{ zone: Zone; index: number }>({ zone: 'search', index: 0 })
  const focusedSearch = focus.zone === 'search' ? results[focus.index] ?? null : null
  const focusedBoard = focus.zone === 'board' ? boardRows[focus.index] ?? null : null
  useEffect(() => {
    // clamp when lists shrink. The updater MUST return the same object when
    // nothing changes, or React can't bail out and the effect re-runs on the
    // new `focus` identity forever (empty list → index 0 > max -1 spins at
    // ~100% CPU on mount). Depend on primitives, never the object.
    const len = focus.zone === 'search' ? results.length : boardRows.length
    setFocus((f) => {
      const idx = Math.max(0, Math.min(f.index, len - 1))
      return idx === f.index ? f : { ...f, index: idx }
    })
  }, [results.length, boardRows.length, focus.zone, focus.index])

  // ----- preview well -----
  const [preview, setPreview] = useState<{ name: string; set?: string | null } | null>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showPreview = useCallback((name: string, set?: string | null) => {
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => setPreview({ name, set }), 120)
  }, [])
  useEffect(() => () => { if (previewTimer.current) clearTimeout(previewTimer.current) }, [])
  useEffect(() => {
    const card = focusedSearch ?? focusedBoard?.entry
    if (!card) return
    // a keyboard focus change wins immediately — cancel any pending hover timer
    // so it can't overwrite the well with a stale hovered card a beat later
    if (previewTimer.current) clearTimeout(previewTimer.current)
    setPreview({ name: card.name, set: 'set' in card ? (card as CardInfoDto).set : undefined })
  }, [focusedSearch, focusedBoard])

  // ----- toasts -----
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])
  const toastId = useRef(0)
  const toast = useCallback((text: string) => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  // ----- save / open / import / export -----
  const [saveState, setSaveState] = useState<{ kind: 'draft' | 'saving' | 'saved'; at?: string }>({ kind: 'draft' })
  useEffect(() => {
    if (saveState.kind === 'saved') setSaveState({ kind: 'draft', at: saveState.at })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const doSave = useCallback(async () => {
    const cards: string[] = []
    for (const e of state.boards.main) for (let i = 0; i < e.count; i++) cards.push(e.name)
    if (state.commander) cards.push(state.commander.name)
    if (!cards.length) return
    const side: string[] = []
    for (const e of state.boards.side) for (let i = 0; i < e.count; i++) side.push(e.name)
    const version = stateVersion.current
    setSaveState({ kind: 'saving' })
    try {
      const res = await saveDeck(state.name || 'Untitled', cards, undefined, side)
      // only claim "saved" if nothing was edited while the request was in flight
      if (stateVersion.current === version) {
        setSaveState({ kind: 'saved', at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
      } else {
        setSaveState({ kind: 'draft' })
      }
      toast(`Saved to ${res.path}`)
    } catch (e) {
      setSaveState({ kind: 'draft' })
      toast(e instanceof Error ? `Save failed: ${e.message}` : 'Save failed')
    }
  }, [state, toast])

  const [importOpen, setImportOpen] = useState(false)
  const [openOpen, setOpenOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [goldfishOpen, setGoldfishOpen] = useState(false)
  const [omniOpen, setOmniOpen] = useState(false)
  const [basicsOpen, setBasicsOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(false)

  const applyImport = useCallback(
    (name: string, main: DeckCardEntry[], side: DeckCardEntry[], label: string) => {
      // read the latest state (not a closure snapshot) so an import resolving
      // after a network round-trip preserves edits made in the meantime
      const cur = stateRef.current
      dispatch({
        kind: 'replace',
        label,
        state: { ...cur, name, boards: { main, side, maybe: cur.boards.maybe }, commander: null },
      })
    },
    [dispatch],
  )

  // paste a decklist anywhere → it just imports
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const text = e.clipboardData?.getData('text') ?? ''
      const lines = text.split('\n').filter((l) => /^\s*\d+x?\s+\S/.test(l))
      if (lines.length < 2) return
      e.preventDefault()
      importDeck({ text })
        .then((res) => {
          applyImport(res.name, res.cards, res.sideboard ?? [], `pasted “${res.name}”`)
          toast(`Imported ${res.cards.length} cards from clipboard — ⌘Z to undo`)
        })
        .catch((err) => toast(err instanceof Error ? `Import failed: ${err.message}` : 'Import failed'))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [applyImport, toast])

  // ----- verbs -----
  const addCard = useCallback(
    (card: CardInfoDto | DeckCardEntry, opts?: { playset?: boolean; board?: BoardId }) => {
      const board = opts?.board ?? tab
      const entry = entryFromCard(card)
      if (opts?.playset) dispatch({ kind: 'playset', card: entry, board })
      else dispatch({ kind: 'add', card: entry, board, delta: 1 })
    },
    [dispatch, tab],
  )

  const setCommanderVerb = useCallback(
    (card: CardInfoDto | DeckCardEntry) => {
      if (!fmt.hasCommander) return
      dispatch({ kind: 'setCommander', card: entryFromCard(card) })
    },
    [dispatch, fmt.hasCommander],
  )

  // ----- keyboard middleware: single window listener, focus-scope aware -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOmniOpen(true)
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void doSave()
        return
      }
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (typing) {
        if (e.key === 'Escape') {
          ;(t as HTMLElement).blur()
          if (t === searchRef.current) setFocus({ zone: 'search', index: 0 })
        }
        return
      }
      if (omniOpen || importOpen || openOpen || goldfishOpen) return

      // Escape always clears transient UI (works even with a button focused)
      if (e.key === 'Escape') {
        setCurveFilter(null)
        setExportOpen(false)
        setBasicsOpen(false)
        return
      }
      // The virtual-focus nav + single-key row verbs only run when no real
      // element holds focus. Otherwise native Tab/Enter/typing on buttons and
      // controls keeps working — the middleware never steals them.
      if (t && t !== document.body) return

      switch (e.key) {
        case '/':
          e.preventDefault()
          searchRef.current?.focus()
          return
        case 'Tab': {
          e.preventDefault()
          setFocus((f) => ({ zone: f.zone === 'search' ? 'board' : 'search', index: 0 }))
          return
        }
        case 'ArrowDown':
        case 'ArrowUp': {
          e.preventDefault()
          const len = focus.zone === 'search' ? results.length : boardRows.length
          if (!len) return
          setFocus((f) => ({ ...f, index: Math.max(0, Math.min(len - 1, f.index + (e.key === 'ArrowDown' ? 1 : -1))) }))
          return
        }
        case 'Enter': {
          if (focus.zone === 'search' && focusedSearch) {
            e.preventDefault()
            if (e.altKey) addCard(focusedSearch, { board: 'side' })
            else addCard(focusedSearch, { playset: e.shiftKey })
          }
          return
        }
        case 'g':
          if (state.boards.main.length) setGoldfishOpen(true)
          return
      }
      // row verbs on the focused board row
      const row = focus.zone === 'board' ? boardRows[focus.index] : null
      if (row) {
        if (e.key >= '1' && e.key <= '4') {
          dispatch({ kind: 'setCount', name: row.entry.name, board: row.board, count: Number(e.key) })
          return
        }
        if (e.key === '+' || e.key === '=') return void dispatch({ kind: 'setCount', name: row.entry.name, board: row.board, count: row.entry.count + 1 })
        if (e.key === '-') return void dispatch({ kind: 'setCount', name: row.entry.name, board: row.board, count: row.entry.count - 1 })
        if (e.key === '0' || e.key === 'Backspace') return void dispatch({ kind: 'removeAll', name: row.entry.name, board: row.board })
        if (e.key === 's') return void dispatch({ kind: 'move', name: row.entry.name, from: row.board, to: row.board === 'side' ? 'main' : 'side', all: false })
        if (e.key === 'S') return void dispatch({ kind: 'move', name: row.entry.name, from: row.board, to: row.board === 'side' ? 'main' : 'side', all: true })
        if (e.key === 'c' && fmt.hasCommander) return void setCommanderVerb(row.entry)
      }
      if (focus.zone === 'search' && focusedSearch && e.key === 'c' && fmt.hasCommander) {
        setCommanderVerb(focusedSearch)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus, results, boardRows, focusedSearch, addCard, dispatch, undo, redo, doSave, omniOpen, importOpen, openOpen, goldfishOpen, fmt.hasCommander, setCommanderVerb, state.boards.main.length])

  // keep the focused row in view
  const rowsRef = useRef<HTMLDivElement>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = focus.zone === 'board' ? rowsRef.current : feedRef.current
    host?.querySelector('.sl-focused')?.scrollIntoView({ block: 'nearest' })
  }, [focus])

  // ----- stats -----
  const stats = useMemo(() => computeStats(state.boards.main, state.commander), [state.boards.main, state.commander])
  const issues = useMemo(() => checkFormat(state, stats), [state, stats])
  const sideTotal = state.boards.side.reduce((n, e) => n + e.count, 0)
  const mainTotal = stats.total
  const curveMax = Math.max(1, ...stats.curve, ...(ghostOn ? fmt.curveTarget : []))

  // "jump to offender": switch to the main board unfiltered, then resolve the
  // row index once boardRows has actually recomputed (an effect, not a
  // setTimeout that would close over the pre-switch rows and land on the wrong row)
  const pendingOffender = useRef<string[] | null>(null)
  const focusOffender = useCallback((names: string[]) => {
    setTab('main')
    setCurveFilter(null)
    pendingOffender.current = names
  }, [])
  useEffect(() => {
    if (!pendingOffender.current) return
    const names = pendingOffender.current
    const idx = boardRows.findIndex((r) => names.includes(r.entry.name))
    if (idx >= 0) {
      setFocus({ zone: 'board', index: idx })
      pendingOffender.current = null
    }
  }, [boardRows])

  const startNew = useCallback(() => {
    dispatch({ kind: 'replace', label: 'new deck', state: { ...EMPTY_STATE, format: state.format } })
    toast('New deck — ⌘Z brings the old one back')
  }, [dispatch, state.format, toast])

  // ---------- render ----------
  return (
    <div className="sl-root" data-testid="deck-builder">
      {/* topbar */}
      <div className="sl-top">
        <span className="sl-wordmark">STACKLINE</span>
        <input
          className="sl-deckname"
          value={state.name}
          onChange={(e) => dispatch({ kind: 'rename', name: e.target.value })}
          aria-label="Deck name"
          spellCheck={false}
        />
        <select
          className="sl-select"
          value={state.format}
          onChange={(e) => dispatch({ kind: 'setFormat', format: e.target.value as FormatId })}
          aria-label="Format"
        >
          {FORMATS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
        <span className={`sl-savestate${saveState.kind === 'saved' ? ' saved' : ''}`}>
          {saveState.kind === 'saving' ? 'saving…' : saveState.at ? `saved ${saveState.at}` : 'draft'}
        </span>
        <span className="sl-top-spacer" />
        <button className="sl-btn sl-rail-toggle" onClick={() => setRailOpen((o) => !o)} aria-expanded={railOpen}>
          Stats
        </button>
        <button className="sl-btn" onClick={() => setOmniOpen(true)} title="Quick add (Ctrl+K)">
          Quick add<span className="sl-kbd">⌘K</span>
        </button>
        <button className="sl-btn" onClick={() => setGoldfishOpen(true)} disabled={!state.boards.main.length}>
          Goldfish
        </button>
        <button className="sl-btn" onClick={() => setImportOpen(true)}>Import</button>
        <button className="sl-btn" onClick={() => setOpenOpen(true)}>Open</button>
        <div className="sl-menu-wrap">
          <button className="sl-btn" onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen}>
            Export ▾
          </button>
          {exportOpen && (
            <div className="sl-menu" onMouseLeave={() => setExportOpen(false)}>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(decklistText(state)).then(
                    () => toast('Decklist copied'),
                    () => toast('Copy failed — clipboard unavailable'),
                  )
                  setExportOpen(false)
                }}
              >
                Copy decklist
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([decklistText(state)], { type: 'text/plain;charset=utf-8' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `${(state.name || 'deck').replace(/[^a-z0-9-_ ]/gi, '_').trim() || 'deck'}.txt`
                  document.body.appendChild(a)
                  a.click()
                  a.remove()
                  URL.revokeObjectURL(url)
                  setExportOpen(false)
                }}
              >
                Download .txt
              </button>
              <button
                onClick={() => {
                  setExportOpen(false)
                  startNew()
                }}
              >
                New deck
              </button>
            </div>
          )}
        </div>
        <button className="sl-btn primary" onClick={() => void doSave()} disabled={!state.boards.main.length || saveState.kind === 'saving'}>
          Save<span className="sl-kbd" style={{ color: 'inherit', borderColor: 'currentColor', opacity: 0.7 }}>⌘S</span>
        </button>
      </div>

      {/* search feed */}
      <div className="sl-feed">
        <div className="sl-search-head">
          <input
            ref={searchRef}
            className="sl-search-input"
            placeholder='Search — lightning, t:goblin, o:"draw a card", mv<=2 …  ( / )'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Card search"
          />
          <div className="sl-chips">
            {['W', 'U', 'B', 'R', 'G', 'C'].map((c) => (
              <button
                key={c}
                className={`sl-mana-chip${fColors.includes(c) ? ' on' : ''}`}
                style={fColors.includes(c) ? { background: MANA_HEX[c] } : undefined}
                onClick={() => setFColors((p) => (p.includes(c) ? p.replace(c, '') : p + c))}
                aria-pressed={fColors.includes(c)}
                aria-label={`Color ${c}`}
              >
                {c}
              </button>
            ))}
            <select className="sl-select" value={fType} onChange={(e) => setFType(e.target.value)} aria-label="Type filter">
              <option value="">Type</option>
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select className="sl-select" value={fRarity} onChange={(e) => setFRarity(e.target.value)} aria-label="Rarity filter">
              <option value="">Rarity</option>
              <option value="common">Common</option>
              <option value="uncommon">Uncommon</option>
              <option value="rare">Rare</option>
              <option value="mythic">Mythic</option>
            </select>
          </div>
        </div>
        <div className="sl-results" ref={feedRef}>
          {searchErr && <p className="sl-feed-empty">{searchErr}</p>}
          {!searchErr && results.length === 0 && (
            <div className="sl-feed-empty">
              {searched && (query || fColors || fType || fRarity) ? (
                'No cards found.'
              ) : (
                <>
                  Search the card database. Try:{' '}
                  {STARTERS.map((s) => (
                    <span key={s}>
                      <code onClick={() => setQuery(s)}>{s}</code>{' '}
                    </span>
                  ))}
                  <br />
                  <b>Enter</b> adds · <b>Shift+Enter</b> playset · <b>Alt+Enter</b> to side
                </>
              )}
            </div>
          )}
          {results.map((card, i) => {
            const inDeck = state.boards.main.find((e) => e.name === card.name)?.count ?? 0
            return (
              <div
                key={`${card.name}-${card.set}-${i}`}
                className={`sl-result${inDeck ? ' in-deck' : ''}${focus.zone === 'search' && focus.index === i ? ' sl-focused' : ''}`}
                onMouseEnter={() => showPreview(card.name, card.set)}
                onClick={() => setFocus({ zone: 'search', index: i })}
              >
                <span className="sl-name">{inDeck ? `${inDeck}× ` : ''}{card.name}</span>
                <ManaGlyphs cost={card.manaCost} />
                <span className="sl-typeline">
                  {card.types.join(' ')} · {card.set ?? ''} {card.rarity ? `· ${card.rarity}` : ''}
                </span>
                <button
                  className="sl-addbtn"
                  aria-label={`Add ${card.name}`}
                  title="Add 1 (Shift-click: playset)"
                  onClick={(e) => {
                    e.stopPropagation()
                    setFocus({ zone: 'search', index: i })
                    addCard(card, { playset: e.shiftKey })
                  }}
                >
                  ＋
                </button>
              </div>
            )
          })}
        </div>
        <div className="sl-well">
          {preview ? (
            <>
              <img
                key={`${preview.name}-${preview.set ?? ''}`}
                className="sl-well-img"
                src={cardImg(preview.name, preview.set)}
                alt={preview.name}
                // a missing scan gets a labeled placeholder, not a blank slab
                onError={(e) => e.currentTarget.classList.add('noimg')}
                onLoad={(e) => e.currentTarget.classList.remove('noimg')}
              />
              <span className="sl-well-caption">{preview.name}</span>
            </>
          ) : (
            <div className="sl-well-empty">The preview well — hover or arrow through any card and its scan appears here.</div>
          )}
        </div>
      </div>

      {/* deck board */}
      <div className="sl-board">
        <div className="sl-board-head">
          <div className="sl-tabs" role="tablist" aria-label="Deck boards">
            {(['main', 'side', 'maybe'] as BoardId[]).map((b) => {
              const n = state.boards[b].reduce((s, e) => s + e.count, 0)
              return (
                <button
                  key={b}
                  role="tab"
                  aria-selected={tab === b}
                  className={`sl-tab${tab === b ? ' active' : ''}`}
                  onClick={() => {
                    setTab(b)
                    setFocus({ zone: 'board', index: 0 })
                  }}
                >
                  {b === 'side' ? fmt.sideLabel : BOARD_LABEL[b]}
                  <span className="n">{n}</span>
                </button>
              )
            })}
          </div>
          {curveFilter !== null && (
            <button className="sl-filter-tag" onClick={() => setCurveFilter(null)} title="Clear filter (Esc)">
              mv {curveFilter === 7 ? '7+' : curveFilter} ✕
            </button>
          )}
          <span style={{ flex: 1 }} />
          {tab === 'main' && (
            <span style={{ position: 'relative' }}>
              <button className="sl-basics-btn" onClick={() => setBasicsOpen((o) => !o)} aria-expanded={basicsOpen}>
                Basics ▾
              </button>
              {basicsOpen && (
                <BasicsPopover
                  state={state}
                  onSet={(counts) => dispatch({ kind: 'setBasics', counts })}
                  suggested={suggestBasics(state, stats)}
                  onClose={() => setBasicsOpen(false)}
                />
              )}
            </span>
          )}
        </div>

        {fmt.hasCommander && (
          <div className={`sl-commander${state.commander ? ' filled' : ''}`}>
            <span className="sl-commander-label">Command zone</span>
            {state.commander ? (
              <>
                <span
                  className="sl-name"
                  onMouseEnter={() => showPreview(state.commander!.name)}
                >
                  {state.commander.name}
                </span>
                <ManaGlyphs cost={state.commander.manaCost} />
                <button className="sl-addbtn" aria-label="Remove commander" onClick={() => dispatch({ kind: 'setCommander', card: null })}>
                  ✕
                </button>
              </>
            ) : (
              <span>No commander — focus a legendary creature and press C</span>
            )}
          </div>
        )}

        <div className="sl-rows" ref={rowsRef}>
          {boardRows.length === 0 && (
            <div className="sl-board-empty">
              {tab === 'main' ? (
                <>
                  The bench is empty.
                  <br />
                  <span className="sl-kbd">/</span> search · <span className="sl-kbd">Enter</span> add ·{' '}
                  <span className="sl-kbd">Shift+Enter</span> playset · <span className="sl-kbd">⌘K</span> quick add — or paste a
                  decklist anywhere.
                </>
              ) : tab === 'side' ? (
                `Nothing in the ${fmt.sideLabel.toLowerCase()} yet — press S on a main-deck row to move a copy here.`
              ) : (
                'Nothing in the maybe pile yet — switch to this tab and add cards from search to stash ideas here.'
              )}
            </div>
          )}
          {groups.map((g) => (
            <div key={g.type}>
              <div className="sl-group-head">
                {TYPE_PLURAL[g.type] ?? g.type} <span className="n">{g.count}</span>
              </div>
              {g.entries.map((e) => {
                const idx = rowIndexByName.get(e.name) ?? 0
                const cap = copyCap(e, fmt)
                const overCap = e.count > cap
                return (
                  <div
                    key={e.name}
                    className={`sl-row${focus.zone === 'board' && focus.index === idx ? ' sl-focused' : ''}${overCap ? ' over-cap' : ''}`}
                    onMouseEnter={() => showPreview(e.name)}
                    onClick={() => setFocus({ zone: 'board', index: idx })}
                  >
                    <CountControl
                      entry={e}
                      cap={cap}
                      onSet={(n) => dispatch({ kind: 'setCount', name: e.name, board: tab, count: n })}
                    />
                    <span className="sl-name">{e.name}</span>
                    <span className="sl-row-actions">
                      <button
                        title={tab === 'side' ? 'Move 1 to main (S)' : `Move 1 to ${fmt.sideLabel} (S)`}
                        aria-label={`Move ${e.name} to ${tab === 'side' ? 'main' : fmt.sideLabel}`}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          dispatch({ kind: 'move', name: e.name, from: tab, to: tab === 'side' ? 'main' : 'side', all: false })
                        }}
                      >
                        {tab === 'side' ? '⇤' : '⇥'}
                      </button>
                      <button
                        title="Cut all copies (0)"
                        aria-label={`Remove all ${e.name}`}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          dispatch({ kind: 'removeAll', name: e.name, board: tab })
                        }}
                      >
                        ✕
                      </button>
                    </span>
                    <ManaGlyphs cost={e.manaCost} />
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* stats rail */}
      <div className={`sl-rail${railOpen ? ' open' : ''}`}>
        <div>
          <div className="sl-stat-title">
            Mana curve
            {fmt.curveTarget.length > 0 && (
              <button className={`sl-ghost-toggle${ghostOn ? ' on' : ''}`} onClick={() => setGhostOn((o) => !o)} title="Show the format's typical curve as dashed targets">
                targets
              </button>
            )}
          </div>
          <div className="sl-curve">
            {stats.curve.map((n, mv) => (
              <div
                key={mv}
                className={`sl-curve-col${curveFilter === mv ? ' filtered' : ''}`}
                title={`mv ${mv === 7 ? '7+' : mv}: ${n} — filter to these`}
                onClick={() => setCurveFilter((f) => (f === mv ? null : mv))}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    setCurveFilter((f) => (f === mv ? null : mv))
                  }
                }}
                role="button"
                tabIndex={0}
                aria-pressed={curveFilter === mv}
                aria-label={`Filter to mana value ${mv === 7 ? '7 or more' : mv}: ${n} cards`}
              >
                <span className="sl-curve-n">{n || ''}</span>
                <div className="sl-curve-bar" style={{ height: `${(n / curveMax) * 44}px` }} />
                {ghostOn && fmt.curveTarget[mv] > 0 && (
                  <div className="sl-curve-ghost" style={{ bottom: `${(fmt.curveTarget[mv] / curveMax) * 44 + 15}px` }} />
                )}
                <span className="sl-curve-label">{mv === 7 ? '7+' : mv}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="sl-stat-title">Mana — demand vs sources</div>
          {WUBRG.filter((c) => stats.demand[c] > 0 || stats.sources[c] > 0).map((c) => {
            const maxSide = Math.max(1, ...WUBRG.map((x) => Math.max(stats.demand[x], stats.sources[x])))
            return (
              <div key={c} className="sl-colorrow">
                <span className="dot" style={{ background: MANA_HEX[c] }} />
                <span className="bars">
                  <span className="bar demand"><i style={{ width: `${(stats.demand[c] / maxSide) * 100}%` }} /></span>
                  <span className="bar sources"><i style={{ width: `${(stats.sources[c] / maxSide) * 100}%`, background: MANA_HEX[c] }} /></span>
                </span>
                <span className="nums">{stats.demand[c]}·{stats.sources[c]}</span>
              </div>
            )
          })}
          <div className="sl-stat-legend">top: pips needed · bottom: ~sources ({stats.lands} lands)</div>
        </div>

        <div>
          <div className="sl-stat-title">Types</div>
          <div className="sl-typelist">
            {[...TYPE_ORDER, 'Other'].filter((t) => stats.types[t]).map((t) => (
              <div key={t}>
                <span>{TYPE_PLURAL[t] ?? t}</span>
                <span className="n">{stats.types[t]}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="sl-stat-title">Format check</div>
          <div className="sl-check">
            {issues.map((it, i) => {
              const jump = it.cards?.length ? () => focusOffender(it.cards!) : undefined
              return (
                <div
                  key={i}
                  className={`sl-check-item ${it.kind}${jump ? ' clickable' : ''}`}
                  onClick={jump}
                  onKeyDown={jump ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); jump() } } : undefined}
                  role={jump ? 'button' : undefined}
                  tabIndex={jump ? 0 : undefined}
                  title={it.cards?.length ? `${it.cards.slice(0, 6).join(', ')}${it.cards.length > 6 ? '…' : ''} — jump to first` : undefined}
                >
                  {it.kind === 'ok' ? '✓' : '⚠'} {it.text}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* tally bar */}
      <div className="sl-tally">
        <span className={fmt.minMain > 0 && mainTotal >= fmt.minMain ? 'ok' : fmt.minMain > 0 ? 'warn' : ''}>
          MAIN {mainTotal}{fmt.minMain ? `/${fmt.minMain}` : ''} {fmt.minMain > 0 && mainTotal >= fmt.minMain ? '✓' : ''}
        </span>
        <span className={fmt.sideMax > 0 && sideTotal > fmt.sideMax ? 'warn' : ''}>
          {fmt.sideLabel.toUpperCase()} {sideTotal}{fmt.sideMax ? `/${fmt.sideMax}` : ''}
        </span>
        <span>avg mv {stats.avgMv.toFixed(2)}</span>
        {canUndo && (
          <button className="sl-undo-chip" onClick={undo} title="Undo (Ctrl+Z)">
            ↶ {undoLabel}
          </button>
        )}
        {lastLabel && !canUndo && <span>{lastLabel}</span>}
        <span className="sl-tally-spacer" />
        <span>autosaved</span>
      </div>

      {/* overlays */}
      {omniOpen && (
        <Omnibox
          onAdd={(card, playset) => addCard(card, { playset })}
          inMain={(name) => state.boards.main.find((e) => e.name === name)?.count ?? 0}
          onClose={() => setOmniOpen(false)}
        />
      )}
      {importOpen && (
        <ImportDialog
          onDone={(name, main, side, unresolved) => {
            applyImport(name, main, side, `imported “${name}”`)
            setImportOpen(false)
            toast(unresolved.length ? `Imported “${name}” — ${unresolved.length} not found: ${unresolved.slice(0, 4).join(', ')}` : `Imported “${name}”`)
          }}
          onClose={() => setImportOpen(false)}
        />
      )}
      {openOpen && (
        <OpenDialog
          onPick={async (d) => {
            setOpenOpen(false)
            try {
              const res = await loadDeck(d.path)
              applyImport(res.name, res.cards, res.sideboard ?? [], `opened “${res.name}”`)
              toast(`Opened “${res.name}”`)
            } catch (e) {
              toast(e instanceof Error ? `Open failed: ${e.message}` : 'Open failed')
            }
          }}
          onClose={() => setOpenOpen(false)}
        />
      )}
      {goldfishOpen && <Goldfish deck={state.boards.main} onClose={() => setGoldfishOpen(false)} />}

      {toasts.length > 0 &&
        createPortal(
          <div className="sl-toasts" role="status" aria-live="polite">
            {toasts.map((t) => (
              <div key={t.id} className="sl-toast">{t.text}</div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}

// ---------- basics popover ----------

function BasicsPopover({
  state, suggested, onSet, onClose,
}: {
  state: BuilderState
  suggested: Record<string, number>
  onSet: (counts: Record<string, number>) => void
  onClose: () => void
}) {
  const current: Record<string, number> = {}
  for (const b of BASIC_LANDS) current[b] = state.boards.main.find((e) => e.name === b)?.count ?? 0
  const colorOf: Record<string, string> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }
  return (
    <div className="sl-basics-pop" onMouseLeave={onClose}>
      {BASIC_LANDS.map((b) => (
        <div key={b} className="sl-basics-row">
          <span className="dot" style={{ background: MANA_HEX[colorOf[b]] }} />
          <span className="lname">{b}</span>
          <span className="sl-numstep">
            <button aria-label={`Fewer ${b}`} onClick={() => onSet({ [b]: current[b] - 1 })}>−</button>
            <span className="sl-count-num">{current[b]}</span>
            <button aria-label={`More ${b}`} onClick={() => onSet({ [b]: current[b] + 1 })}>+</button>
          </span>
        </div>
      ))}
      <button className="sl-btn" onClick={() => onSet(suggested)} title="Land count for this format, split by your casting costs">
        Fill suggested ({Object.values(suggested).reduce((a, b) => a + b, 0)})
      </button>
    </div>
  )
}

// ---------- omnibox (⌘K burst entry) ----------

function Omnibox({
  onAdd, inMain, onClose,
}: {
  onAdd: (card: CardInfoDto, playset: boolean) => void
  inMain: (name: string) => number
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<CardInfoDto[]>([])
  const [sel, setSel] = useState(0)
  const [lastAdded, setLastAdded] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => {
    if (!q.trim()) {
      setRows([])
      return
    }
    const t = setTimeout(async () => {
      try {
        setRows((await searchCards(q.trim(), {})).slice(0, 9))
        setSel(0)
      } catch {
        setRows([])
      }
    }, 200)
    return () => clearTimeout(t)
  }, [q])
  return createPortal(
    <div className="sl-overlay" onClick={onClose}>
      <div className="sl-omni sl-root" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          placeholder="Type a card name… Enter adds and keeps going"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return onClose()
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
            if (e.key === 'Enter' && rows[sel]) {
              e.preventDefault()
              onAdd(rows[sel], e.shiftKey)
              setLastAdded(`${e.shiftKey ? 'playset' : '+1'} ${rows[sel].name}`)
              setQ('')
              setRows([])
            }
          }}
          aria-label="Quick add"
        />
        <div className="sl-omni-hint">
          Enter +1 · Shift+Enter playset · Esc done {lastAdded && <span className="sl-omni-added"> ✓ {lastAdded}</span>}
        </div>
        <div className="sl-omni-rows">
          {rows.map((c, i) => (
            <div
              key={`${c.name}-${i}`}
              className={`sl-omni-row${i === sel ? ' sl-focused' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => {
                onAdd(c, false)
                setLastAdded(`+1 ${c.name}`)
                setQ('')
                setRows([])
                inputRef.current?.focus()
              }}
            >
              <span className="sl-name">{inMain(c.name) ? `${inMain(c.name)}× ` : ''}{c.name}</span>
              <ManaGlyphs cost={c.manaCost} />
              <span className="sl-typeline">{c.types.join(' ')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---------- import dialog ----------

function ImportDialog({
  onDone, onClose,
}: {
  onDone: (name: string, main: DeckCardEntry[], side: DeckCardEntry[], unresolved: string[]) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEscapeClose(onClose)
  return createPortal(
    <div className="sl-overlay" onClick={onClose}>
      <div className="sl-dialog sl-root" style={{ display: 'flex' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Import deck">
        <h2>Import a deck</h2>
        <label>Paste a decklist (MTGO / Moxfield export)</label>
        <textarea autoFocus rows={9} placeholder={'4 Lightning Bolt\n20 Mountain'} value={text} onChange={(e) => setText(e.target.value)} />
        <label>…or a Moxfield deck URL</label>
        <input type="text" placeholder="https://moxfield.com/decks/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        {err && <p className="sl-error">{err}</p>}
        <div className="sl-dialog-actions">
          <button className="sl-btn" onClick={onClose}>Cancel</button>
          <button
            className="sl-btn primary"
            disabled={busy || (!text.trim() && !url.trim())}
            onClick={async () => {
              setBusy(true)
              setErr(null)
              try {
                const res = await importDeck({ text: text.trim() || undefined, moxfieldUrl: url.trim() || undefined })
                onDone(res.name, res.cards, res.sideboard ?? [], res.unresolved ?? [])
              } catch (e) {
                setErr(e instanceof Error ? e.message : 'Import failed')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---------- open dialog ----------

function OpenDialog({ onPick, onClose }: { onPick: (d: DeckListItem) => void; onClose: () => void }) {
  const [decks, setDecks] = useState<DeckListItem[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEscapeClose(onClose)
  useEffect(() => {
    listDecks().then(setDecks, (e) => setErr(e instanceof Error ? e.message : 'Could not list decks'))
  }, [])
  const byCat = useMemo(() => {
    const m = new Map<string, DeckListItem[]>()
    for (const d of decks ?? []) {
      const k = d.category ?? 'Decks'
      m.set(k, [...(m.get(k) ?? []), d])
    }
    return [...m.entries()]
  }, [decks])
  return createPortal(
    <div className="sl-overlay" onClick={onClose}>
      <div className="sl-dialog sl-root" style={{ display: 'flex' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Open deck">
        <h2>Open a deck</h2>
        {err && <p className="sl-error">{err}</p>}
        {!decks && !err && <p>Loading…</p>}
        {byCat.map(([cat, items]) => (
          <div key={cat}>
            <label>{cat}</label>
            <div className="sl-menu" style={{ position: 'static', boxShadow: 'none', marginTop: 4 }}>
              {items.map((d) => (
                <button key={d.path} onClick={() => onPick(d)}>{d.name}</button>
              ))}
            </div>
          </div>
        ))}
        <div className="sl-dialog-actions">
          <button className="sl-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---------- goldfish ----------

function shuffle<T>(a: T[]): T[] {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

function Goldfish({ deck, onClose }: { deck: DeckCardEntry[]; onClose: () => void }) {
  const pool = useMemo(() => deck.flatMap((e) => Array(e.count).fill(e.name) as string[]), [deck])
  const [st, setSt] = useState(() => {
    const s = shuffle(pool)
    return { hand: s.slice(0, 7), lib: s.slice(7), mull: 0, toBottom: 0, turn: 1 }
  })
  const deal = (mull: number) => {
    const s = shuffle(pool)
    setSt({ hand: s.slice(0, 7), lib: s.slice(7), mull, toBottom: mull, turn: 1 })
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'n') deal(0)
      if (e.key === 'm') deal(st.mull + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return createPortal(
    <div className="sl-overlay" onClick={onClose}>
      <div className="sl-dialog sl-root" style={{ width: 'min(720px, 94vw)', display: 'flex' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Goldfish">
        <h2>
          Goldfish — turn {st.turn} · library {st.lib.length}
          {st.mull > 0 ? ` · mulligan ${st.mull}` : ''}
        </h2>
        {st.toBottom > 0 && <p style={{ margin: 0, color: 'var(--sl-brass)' }}>Click {st.toBottom} card{st.toBottom > 1 ? 's' : ''} to put on the bottom (London mulligan).</p>}
        <div className="sl-hand">
          {st.hand.map((name, i) => (
            <img
              key={`${name}-${i}`}
              className={`sl-hand-card${st.toBottom > 0 ? ' bottoming' : ''}`}
              src={cardImg(name)}
              alt={name}
              title={name}
              // no scan for this card → show the name on a plain card back
              onError={(e) => e.currentTarget.classList.add('noimg')}
              onClick={
                st.toBottom > 0
                  ? () => setSt((s) => ({ ...s, hand: s.hand.filter((_, x) => x !== i), lib: [...s.lib, name], toBottom: s.toBottom - 1 }))
                  : undefined
              }
            />
          ))}
        </div>
        <div className="sl-dialog-actions">
          <button className="sl-btn" onClick={onClose}>Close</button>
          <button className="sl-btn" onClick={() => deal(st.mull + 1)}>Mulligan (M)</button>
          <button className="sl-btn" onClick={() => deal(0)}>New hand (N)</button>
          <button
            className="sl-btn"
            disabled={st.toBottom > 0 || !st.lib.length}
            onClick={() => setSt((s) => ({ ...s, hand: [...s.hand, s.lib[0]], lib: s.lib.slice(1) }))}
          >
            Draw
          </button>
          <button
            className="sl-btn primary"
            disabled={st.toBottom > 0}
            onClick={() => setSt((s) => ({ ...s, turn: s.turn + 1, ...(s.lib.length ? { hand: [...s.hand, s.lib[0]], lib: s.lib.slice(1) } : {}) }))}
          >
            Next turn
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
