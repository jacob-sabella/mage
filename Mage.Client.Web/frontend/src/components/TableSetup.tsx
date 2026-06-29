import { useEffect, useMemo, useState } from 'react'
import { fetchGameTypes, listDecks } from '../api'
import type { DeckListItem, GameTypeInfo, TableConfig } from '../api'
import { useEscapeClose } from '../useEscapeClose'

interface Props {
  token: string
  onCreate: (config: TableConfig) => void
  onClose: () => void
}

// value = exact server enum name, label = friendly text
const TIME_LIMITS: [string, string][] = [
  ['NONE', 'No limit'], ['MIN___5', '5 min'], ['MIN__10', '10 min'], ['MIN__15', '15 min'],
  ['MIN__20', '20 min'], ['MIN__25', '25 min'], ['MIN__30', '30 min'], ['MIN__40', '40 min'],
  ['MIN__60', '60 min'], ['MIN__90', '90 min'], ['MIN_120', '120 min'],
]
const BUFFERS: [string, string][] = [
  ['NONE', 'None'], ['SEC__01', '1 s'], ['SEC__02', '2 s'], ['SEC__03', '3 s'], ['SEC__05', '5 s'],
  ['SEC__10', '10 s'], ['SEC__15', '15 s'], ['SEC__20', '20 s'], ['SEC__25', '25 s'], ['SEC__30', '30 s'],
]
const MULLIGANS: [string, string][] = [
  ['GAME_DEFAULT', 'Game default'], ['LONDON', 'London'], ['SMOOTHED_LONDON', 'Smoothed London'],
  ['VANCOUVER', 'Vancouver'], ['PARIS', 'Paris'], ['CANADIAN_HIGHLANDER', 'Canadian Highlander'],
]
const SKILLS: [string, string][] = [['BEGINNER', 'Beginner'], ['CASUAL', 'Casual'], ['SERIOUS', 'Serious']]
const RANGES: [string, string][] = [['ALL', 'All'], ['ONE', 'One'], ['TWO', 'Two']]
const ATTACKS: [string, string][] = [['LEFT', 'Left only'], ['RIGHT', 'Right only'], ['MULTIPLE', 'Anyone']]

function Select({ label, value, set, opts }: { label: string; value: string; set: (v: string) => void; opts: [string, string][] }) {
  return (
    <label className="ts-field">
      <span>{label}</span>
      <select className="filter-select" value={value} onChange={(e) => set(e.target.value)}>
        {opts.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  )
}

function Stepper({ label, value, set, min, max }: { label: string; value: number; set: (n: number) => void; min: number; max: number }) {
  return (
    <label className="ts-field ts-stepper">
      <span>{label}</span>
      <span className="ts-stepper-ctl">
        <button type="button" className="btn ghost deck-mini-btn" disabled={value <= min} onClick={() => set(Math.max(min, value - 1))} aria-label={`Fewer ${label}`}>−</button>
        <span className="ts-stepper-val">{value}</span>
        <button type="button" className="btn ghost deck-mini-btn" disabled={value >= max} onClick={() => set(Math.min(max, value + 1))} aria-label={`More ${label}`}>+</button>
      </span>
    </label>
  )
}

/** Full XMage game-session setup: format, seats, deck and all match options. */
export function TableSetup({ token, onCreate, onClose }: Props) {
  useEscapeClose(onClose)
  const [gameTypes, setGameTypes] = useState<GameTypeInfo[]>([])
  const [gameType, setGameType] = useState('Two Player Duel')
  const [decks, setDecks] = useState<DeckListItem[]>([])
  const [deckPath, setDeckPath] = useState('')
  const [deckQuery, setDeckQuery] = useState('')
  const [gameName, setGameName] = useState('')
  const [aiOpponents, setAiOpponents] = useState(1)
  const [openSeats, setOpenSeats] = useState(0)
  const [advanced, setAdvanced] = useState(false)
  const [timeLimit, setTimeLimit] = useState('NONE')
  const [bufferTime, setBufferTime] = useState('NONE')
  const [mulliganType, setMulliganType] = useState('GAME_DEFAULT')
  const [freeMulligans, setFreeMulligans] = useState(0)
  const [skillLevel, setSkillLevel] = useState('CASUAL')
  const [range, setRange] = useState('ALL')
  const [attackOption, setAttackOption] = useState('LEFT')
  const [rated, setRated] = useState(false)
  const [spectatorsAllowed, setSpectatorsAllowed] = useState(true)
  const [rollbackAllowed, setRollbackAllowed] = useState(true)
  const [winsNeeded, setWinsNeeded] = useState(1)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchGameTypes(token).then(setGameTypes).catch(() => {})
    listDecks().then(setDecks).catch((e) => setError(e instanceof Error ? e.message : 'failed to list decks'))
  }, [token])

  const current = gameTypes.find((g) => g.name === gameType)
  const maxPlayers = current?.maxPlayers ?? 2
  const minPlayers = current?.minPlayers ?? 2
  // total seats = you + AI + open humans; clamp to the format's player range
  const totalSeats = 1 + aiOpponents + openSeats
  const maxOpponents = Math.max(0, maxPlayers - 1)

  // keep seats valid when the format changes
  useEffect(() => {
    const maxOpp = Math.max(0, maxPlayers - 1)
    if (aiOpponents + openSeats > maxOpp) {
      setOpenSeats((o) => Math.max(0, Math.min(o, maxOpp)))
      setAiOpponents((a) => Math.max(0, Math.min(a, maxOpp - Math.min(openSeats, maxOpp))))
    }
    if (1 + aiOpponents + openSeats < minPlayers) {
      setAiOpponents((a) => a + (minPlayers - (1 + a + openSeats)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameType, maxPlayers, minPlayers])

  const filteredDecks = useMemo(() => {
    const q = deckQuery.trim().toLowerCase()
    return decks.filter((d) => (q ? d.name.toLowerCase().includes(q) : true)).slice(0, 300)
  }, [decks, deckQuery])

  const canCreate = !!deckPath && totalSeats >= minPlayers && totalSeats <= maxPlayers
  const submit = () => {
    if (!canCreate) return
    onCreate({
      deckPath, gameName: gameName.trim() || undefined, gameType, aiOpponents, openSeats,
      timeLimit, bufferTime, mulliganType, freeMulligans, skillLevel, range, attackOption,
      rated, spectatorsAllowed, rollbackAllowed, winsNeeded,
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel table-setup" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="h2">New game</h2>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="ts-body">
          <div className="ts-row">
            <label className="ts-field ts-grow">
              <span>Table name</span>
              <input className="picker-search" placeholder="(optional)" value={gameName} onChange={(e) => setGameName(e.target.value)} />
            </label>
            <label className="ts-field ts-grow">
              <span>Format</span>
              <select className="filter-select" value={gameType} onChange={(e) => setGameType(e.target.value)}>
                {gameTypes.length === 0 && <option value="Two Player Duel">Two Player Duel</option>}
                {gameTypes.map((g) => (
                  <option key={g.name} value={g.name}>{g.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="ts-row">
            <Stepper label="AI opponents" value={aiOpponents} set={setAiOpponents} min={0} max={Math.max(0, maxOpponents - openSeats)} />
            <Stepper label="Open seats (humans)" value={openSeats} set={setOpenSeats} min={0} max={Math.max(0, maxOpponents - aiOpponents)} />
            <div className="ts-field">
              <span>Players</span>
              <span className="ts-seats-summary">{totalSeats} <span className="muted">/ {maxPlayers} max</span></span>
            </div>
          </div>

          <div className="ts-deck">
            <div className="ts-deck-head">
              <span>Your deck{deckPath ? '' : ' — pick one'}</span>
              <input className="picker-search" placeholder="Search decks…" value={deckQuery} onChange={(e) => setDeckQuery(e.target.value)} />
            </div>
            {error && <p className="deck-error">{error}</p>}
            <div className="ts-deck-list">
              {filteredDecks.map((d) => (
                <button
                  key={d.path}
                  className={`picker-item${deckPath === d.path ? ' selected' : ''}`}
                  onClick={() => setDeckPath(d.path)}
                >
                  <span className="picker-name">{d.name}</span>
                  <span className="muted picker-cat">{d.category}</span>
                </button>
              ))}
              {decks.length === 0 && !error && <p className="muted">Loading decks…</p>}
            </div>
          </div>

          <button className="ts-advanced-toggle" onClick={() => setAdvanced((a) => !a)}>
            {advanced ? '▾' : '▸'} Advanced options
          </button>
          {advanced && (
            <div className="ts-advanced">
              <div className="ts-row">
                <Select label="Turn time limit" value={timeLimit} set={setTimeLimit} opts={TIME_LIMITS} />
                <Select label="Priority buffer" value={bufferTime} set={setBufferTime} opts={BUFFERS} />
                <Select label="Mulligan rule" value={mulliganType} set={setMulliganType} opts={MULLIGANS} />
              </div>
              <div className="ts-row">
                <Stepper label="Free mulligans" value={freeMulligans} set={setFreeMulligans} min={0} max={7} />
                <Stepper label="Wins needed" value={winsNeeded} set={setWinsNeeded} min={1} max={5} />
                <Select label="AI skill" value={skillLevel} set={setSkillLevel} opts={SKILLS} />
              </div>
              {(current?.useRange ?? false) && (
                <div className="ts-row">
                  <Select label="Range of influence" value={range} set={setRange} opts={RANGES} />
                  {(current?.useAttackOption ?? false) && <Select label="Attack option" value={attackOption} set={setAttackOption} opts={ATTACKS} />}
                </div>
              )}
              <div className="ts-row ts-checks">
                <label className="ts-check"><input type="checkbox" checked={rated} onChange={(e) => setRated(e.target.checked)} /> Rated</label>
                <label className="ts-check"><input type="checkbox" checked={spectatorsAllowed} onChange={(e) => setSpectatorsAllowed(e.target.checked)} /> Allow spectators</label>
                <label className="ts-check"><input type="checkbox" checked={rollbackAllowed} onChange={(e) => setRollbackAllowed(e.target.checked)} /> Allow rollback</label>
              </div>
            </div>
          )}
        </div>

        <div className="ts-foot">
          <span className="muted">{openSeats > 0 ? 'Opens a table; others can join before you start.' : 'Starts immediately vs AI.'}</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={!canCreate}>
            {openSeats > 0 ? 'Create table' : 'Start game'}
          </button>
        </div>
      </div>
    </div>
  )
}
