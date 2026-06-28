import { useCallback, useEffect, useRef, useState } from 'react'
import { Board3D } from './Board3D'
import type { RespondKind } from '../api'
import { plain } from '../text'
import type { GameCard as CardType, GameState, Prompt } from '../types'

interface Props {
  game: GameState | null
  prompt: Prompt | null
  interactive: boolean
  log?: string[]
  result?: string | null
  onRespond: (kind: RespondKind, value?: string) => void
  onLeave: () => void
}

// F-key skip shortcuts -> PlayerAction names sent via /api/game/respond (action).
const SKIP_KEYS: Record<string, string> = {
  F2: 'PASS_PRIORITY_UNTIL_NEXT_TURN',
  F4: 'PASS_PRIORITY_UNTIL_TURN_END_STEP',
  F6: 'PASS_PRIORITY_CANCEL_ALL_ACTIONS',
  F9: 'PASS_PRIORITY_UNTIL_MY_NEXT_TURN',
  F10: 'PASS_PRIORITY_UNTIL_STACK_RESOLVED',
}
const SKIP_BUTTONS = [
  { label: 'Next turn', key: 'F2', action: 'PASS_PRIORITY_UNTIL_NEXT_TURN' },
  { label: 'End turn', key: 'F4', action: 'PASS_PRIORITY_UNTIL_TURN_END_STEP' },
  { label: 'My turn', key: 'F9', action: 'PASS_PRIORITY_UNTIL_MY_NEXT_TURN' },
  { label: 'Resolve', key: 'F10', action: 'PASS_PRIORITY_UNTIL_STACK_RESOLVED' },
  { label: 'Cancel skips', key: 'F6', action: 'PASS_PRIORITY_CANCEL_ALL_ACTIONS' },
]

export function GameTable({ game, prompt, interactive, log = [], result, onRespond, onLeave }: Props) {
  const [preview, setPreview] = useState<CardType | null>(null)
  const [pressedCard, setPressedCard] = useState<CardType | null>(null)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce clearing the preview so rapid enter/leave events (from 3D raycasting)
  // don't cause a 1-frame flash of null between cards.
  const handleHoverCard = useCallback((card: CardType | null) => {
    if (card) {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      setPreview(card)
    } else {
      clearTimerRef.current = setTimeout(() => setPreview(null), 180)
    }
  }, [])

  useEffect(() => {
    if (!interactive) return
    const onKey = (e: KeyboardEvent) => {
      const action = SKIP_KEYS[e.key]
      if (action) {
        e.preventDefault()
        onRespond('action', action)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [interactive, onRespond])

  useEffect(() => {
    const clear = () => setPressedCard(null)
    window.addEventListener('pointerup', clear)
    return () => window.removeEventListener('pointerup', clear)
  }, [])

  if (!game) {
    return (
      <div className="game-table">
        <div className="game-toolbar">
          <button className="btn ghost" onClick={onLeave}>
            ← Back to lobby
          </button>
          <span className="muted">Waiting for game state…</span>
        </div>
        <div className="game-waiting panel">Connecting to the game…</div>
      </div>
    )
  }

  // Decide how a card responds to clicks given the current decision. A pending
  // target prompt takes precedence; otherwise any server-playable card (canPlay)
  // glows and can be played by clicking it directly on the board — matching the
  // "Play / activate" bar so playable cards are obvious in the 3D view too.
  function cardProps(card: CardType): { highlight?: 'play' | 'target'; onClick?: (c: CardType) => void } {
    if (!interactive) return {}
    if (prompt?.kind === 'target') {
      return { highlight: 'target', onClick: () => onRespond('uuid', card.id) }
    }
    if (game?.canPlay.includes(card.id)) {
      return { highlight: 'play', onClick: () => onRespond('uuid', card.id) }
    }
    return {}
  }

  return (
    <div className="game-table">
      <div className="game-toolbar">
        <button className="btn ghost" onClick={onLeave}>
          ← Back
        </button>
        <span className="turn-label">
          <b>T{game.turn}</b>
          {game.activePlayer ? ` · ${game.activePlayer}` : ''}
        </span>
        <PhaseTrack phase={game.phase} step={game.step} />
        <span className="spacer" />
        {game.priorityPlayer && (
          <span className={`prio-chip${game.priorityPlayer === game.me ? ' you' : ''}`}>
            {game.priorityPlayer === game.me ? 'Your priority' : `Priority: ${game.priorityPlayer}`}
          </span>
        )}
        {interactive && (
          <button
            className="btn ghost concede"
            onClick={() => {
              if (confirm('Concede this game?')) onRespond('concede')
            }}
          >
            Concede
          </button>
        )}
      </div>


      <div className="player-strip">
        {game.players.map((p) => {
          const canTarget = interactive && prompt && (prompt.kind === 'target' || prompt.kind === 'select')
          return (
            <button
              key={p.id}
              className={`pstat${p.name === game.activePlayer ? ' active' : ''}${canTarget ? ' targetable' : ''}`}
              onClick={canTarget ? () => onRespond('uuid', p.id) : undefined}
            >
              <span className="pstat-name">{p.name}</span>
              <span className="pstat-life">♥ {p.life}</span>
              <span className="muted pstat-counts">
                Hand {p.handCount} · Lib {p.libraryCount} · Grave {p.graveyardCount}
              </span>
              {p.manaPool && <ManaPool pool={p.manaPool} />}
              {p.name === game.activePlayer && <span className="chip active-chip">Active</span>}
            </button>
          )
        })}
      </div>

      <div className="board-wrap">
        <Board3D
          game={game}
          cardProps={cardProps}
          onHoverCard={handleHoverCard}
          onPressCard={setPressedCard}
          targets={prompt?.kind === 'target' ? prompt.targets : undefined}
        />
        <CardPreview card={preview} />
        <CardZoomOverlay card={pressedCard} />

        {game.combat.length > 0 && (
          <div className="combat-panel panel overlay-tr">
            <div className="stack-title">Combat</div>
            {game.combat.map((cg, i) => (
              <div className="combat-group" key={i}>
                <span className="combat-attackers">{cg.attackers.join(', ') || '—'}</span>
                <span className="combat-arrow">→</span>
                <span className="combat-defender">{cg.defender}</span>
                {cg.blockers.length > 0 ? (
                  <span className="combat-blockers muted">blocked by {cg.blockers.join(', ')}</span>
                ) : (
                  <span className="combat-unblocked">unblocked</span>
                )}
              </div>
            ))}
          </div>
        )}

        {log.length > 0 && <GameLog lines={log} />}

        {result && (
          <div className="game-over-overlay">
            <div className="game-over-card panel">
              <div className="game-over-title">{/won|win/i.test(result) ? '🏆 ' : ''}Game over</div>
              <div className="game-over-msg">{plain(result)}</div>
              <button className="btn primary" onClick={onLeave}>
                Back to lobby
              </button>
            </div>
          </div>
        )}
      </div>

      {/* one fixed control dock so the turn controls + actions never move around */}
      {interactive && (
        <div className="control-dock panel">
          <div className="dock-skips">
            {SKIP_BUTTONS.map((s) => (
              <button
                key={s.action}
                className="btn skip-btn"
                onClick={() => onRespond('action', s.action)}
                title={`${s.label} (${s.key})`}
              >
                {s.label} <span className="skip-key">{s.key}</span>
              </button>
            ))}
          </div>
          {prompt?.kind === 'select' && <PlayableBar game={game} onRespond={onRespond} onHoverCard={handleHoverCard} onPressCard={setPressedCard} />}
          <span className="spacer" />
          <ActionBar prompt={prompt} onRespond={onRespond} />
        </div>
      )}
    </div>
  )
}

const MANA_COLOR: Record<string, string> = { W: '#e9e3c0', U: '#4a90e2', B: '#6b5b73', R: '#e0555f', G: '#3aa55f', C: '#9aa0ad' }

/** Floating mana pool as colored pips (W U B R G C). */
function ManaPool({ pool }: { pool: string }) {
  const syms = pool.match(/\{(\w)\}/g)?.map((s) => s[1]) ?? []
  if (syms.length === 0) return null
  return (
    <span className="mana-pool" title="Mana pool">
      {syms.map((c, i) => (
        <span key={i} className="mana-pip" style={{ background: MANA_COLOR[c] ?? '#9aa0ad' }}>
          {c}
        </span>
      ))}
    </span>
  )
}

function PlayableBar({
  game,
  onRespond,
  onHoverCard,
  onPressCard,
}: {
  game: GameState
  onRespond: (kind: RespondKind, value?: string) => void
  onHoverCard?: (c: CardType | null) => void
  onPressCard?: (c: CardType | null) => void
}) {
  const byId: Record<string, CardType> = {}
  game.myHand.forEach((c) => (byId[c.id] = c))
  game.players.forEach((p) => p.battlefield.forEach((c) => (byId[c.id] = c)))
  const playable = game.canPlay.map((id) => byId[id]).filter(Boolean)
  if (playable.length === 0) return null
  return (
    <div className="playable-bar panel">
      <span className="muted playable-label">Play / activate:</span>
      {playable.map((c) => (
        <button
          key={c.id}
          className="btn play-chip"
          onClick={() => onRespond('uuid', c.id)}
          onMouseEnter={() => onHoverCard?.(c)}
          onMouseLeave={() => onHoverCard?.(null)}
          onMouseDown={() => onPressCard?.(c)}
        >
          {c.name}
        </button>
      ))}
    </div>
  )
}

/** A large, fully-readable card panel shown while hovering a card (3D or the
 *  playable bar): art + name + mana cost + type line + P/T or loyalty. */
function CardPreview({ card }: { card: CardType | null }) {
  if (!card) return null
  const cost = (card.manaCost?.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1))
  const img = `/api/cardimg?set=${encodeURIComponent(card.set ?? '')}&num=${encodeURIComponent(
    card.num ?? '',
  )}&name=${encodeURIComponent(card.name)}`
  const isCreature = (card.types ?? []).some((t) => /creature/i.test(t))
  const isPw = (card.types ?? []).some((t) => /planeswalker/i.test(t))
  const pt = isCreature && card.power != null && card.toughness != null ? `${card.power}/${card.toughness}` : null
  const loy = isPw && card.loyalty != null ? `Loyalty ${card.loyalty}` : null
  return (
    <div className="card-preview" role="dialog" aria-label={`Card: ${card.name}`}>
      <img
        className="card-preview-img"
        src={img}
        alt={card.name}
        onError={(e) => ((e.currentTarget.style.visibility = 'hidden'))}
      />
      <div className="card-preview-info">
        <div className="card-preview-head">
          <span className="card-preview-name">{card.name}</span>
          <span className="card-preview-cost">
            {cost.map((s, i) => (
              <span key={i} className="mana-pip" style={{ background: MANA_COLOR[s] ?? '#9aa0ad' }}>
                {s}
              </span>
            ))}
          </span>
        </div>
        <div className="card-preview-type muted">{(card.types ?? []).join(' ')}</div>
        {(pt || loy) && <div className="card-preview-pt">{pt ?? loy}</div>}
      </div>
    </div>
  )
}

function CardZoomOverlay({ card }: { card: CardType | null }) {
  if (!card) return null
  const img = `/api/cardimg?set=${encodeURIComponent(card.set ?? '')}&num=${encodeURIComponent(
    card.num ?? '',
  )}&name=${encodeURIComponent(card.name)}`
  return (
    <div className="card-zoom-overlay">
      <img className="card-zoom-img" src={img} alt={card.name} />
    </div>
  )
}

function GameLog({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])
  return (
    <div className="game-log panel">
      <div className="stack-title">Game log</div>
      <div className="game-log-body" ref={ref}>
        {lines.map((l, i) => (
          <div className="game-log-line" key={i}>
            {plain(l)}
          </div>
        ))}
      </div>
    </div>
  )
}

function ActionBar({ prompt, onRespond }: { prompt: Prompt | null; onRespond: (kind: RespondKind, value?: string) => void }) {
  const [amount, setAmount] = useState('')

  if (!prompt) {
    return (
      <div className="action-bar">
        <span className="action-message muted">Waiting — use the buttons on the left to advance the turn.</span>
      </div>
    )
  }

  return (
    <div className="action-bar">
      <span className="action-message">{plain(prompt.message) || promptFallback(prompt.kind)}</span>
      <span className="spacer" />

      {prompt.kind === 'ask' && (
        <>
          <button className="btn primary" onClick={() => onRespond('boolean', 'true')}>
            Yes
          </button>
          <button className="btn" onClick={() => onRespond('boolean', 'false')}>
            No
          </button>
        </>
      )}

      {prompt.kind === 'select' && (
        <>
          <span className="muted hint">Click a card to play / declare · Done confirms · Pass skips</span>
          {/* Done = boolean true: confirms the current selection, e.g. declared
              attackers/blockers. Pass = boolean false: pass priority. */}
          <button className="btn" onClick={() => onRespond('boolean', 'true')}>
            Done
          </button>
          <button className="btn primary" onClick={() => onRespond('boolean', 'false')}>
            Pass
          </button>
        </>
      )}

      {prompt.kind === 'target' && (
        <>
          <span className="muted hint">Click a target</span>
          {prompt.canCancel && (
            <button className="btn" onClick={() => onRespond('boolean', 'false')}>
              Done
            </button>
          )}
        </>
      )}

      {prompt.kind === 'amount' && (
        <>
          <input
            className="amount-input"
            type="number"
            min={prompt.min}
            max={prompt.max}
            value={amount}
            placeholder={`${prompt.min}–${prompt.max}`}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button
            className="btn primary"
            onClick={() => onRespond('integer', amount === '' ? String(prompt.min) : amount)}
          >
            OK
          </button>
        </>
      )}

      {prompt.kind === 'choice' && (
        <div className="choice-list">
          {prompt.choices.map((c) => (
            <button key={c.key} className="btn" onClick={() => onRespond(prompt.choiceKind ?? 'string', c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {prompt.kind === 'pile' && (
        <div className="pile-choice">
          <div className="pile">
            <div className="pile-cards">
              {(prompt.pile1 ?? []).map((c) => (
                <span key={c.id} className="pile-card">
                  {c.name}
                </span>
              ))}
            </div>
            <button className="btn primary" onClick={() => onRespond('boolean', 'true')}>
              Take pile 1
            </button>
          </div>
          <div className="pile">
            <div className="pile-cards">
              {(prompt.pile2 ?? []).map((c) => (
                <span key={c.id} className="pile-card">
                  {c.name}
                </span>
              ))}
            </div>
            <button className="btn primary" onClick={() => onRespond('boolean', 'false')}>
              Take pile 2
            </button>
          </div>
        </div>
      )}

      {prompt.kind === 'multiAmount' && <MultiAmountControl prompt={prompt} onRespond={onRespond} />}

      {prompt.kind === 'generic' && prompt.canCancel && (
        <button className="btn" onClick={() => onRespond('boolean', 'false')}>
          Cancel
        </button>
      )}
    </div>
  )
}

/** Distribute amounts across several entries (e.g. "X damage divided as you
 *  choose"); answer is the per-entry amounts joined by spaces. */
function MultiAmountControl({ prompt, onRespond }: { prompt: Prompt; onRespond: (kind: RespondKind, value?: string) => void }) {
  const entries = prompt.multi ?? []
  const [vals, setVals] = useState<number[]>(() => entries.map((e) => e.def))
  const total = vals.reduce((a, b) => a + b, 0)
  const inRange = total >= prompt.min && total <= prompt.max
  const set = (i: number, v: number) =>
    setVals((prev) => prev.map((x, j) => (j === i ? Math.max(entries[j].min, Math.min(entries[j].max, v || 0)) : x)))
  return (
    <div className="multi-amount">
      {entries.map((e, i) => (
        <label key={i} className="multi-row">
          <span className="multi-label">{plain(e.label)}</span>
          <input
            type="number"
            className="multi-input"
            min={e.min}
            max={e.max}
            value={vals[i]}
            onChange={(ev) => set(i, parseInt(ev.target.value, 10))}
          />
        </label>
      ))}
      <span className={`multi-total${inRange ? '' : ' bad'}`}>
        total {total} / {prompt.min === prompt.max ? prompt.min : `${prompt.min}–${prompt.max}`}
      </span>
      <button className="btn primary" disabled={!inRange} onClick={() => onRespond('string', vals.join(' '))}>
        OK
      </button>
    </div>
  )
}

const PHASE_SEGMENTS = ['Untap', 'Upkeep', 'Draw', 'Main 1', 'Combat', 'Main 2', 'End']
function phaseIndex(phase?: string | null, step?: string | null): number {
  const s = `${step || ''} ${phase || ''}`.toLowerCase()
  if (/untap/.test(s)) return 0
  if (/upkeep/.test(s)) return 1
  if (/draw/.test(s)) return 2
  if (/precombat main/.test(s)) return 3
  if (/postcombat main/.test(s)) return 5
  if (/combat|attack|block|damage/.test(s)) return 4
  if (/end|cleanup/.test(s)) return 6
  if (/main/.test(s)) return 3
  return -1
}

/** A horizontal turn-structure track with the current step lit, so it's obvious
 *  where in the turn we are. */
function PhaseTrack({ phase, step }: { phase?: string | null; step?: string | null }) {
  const idx = phaseIndex(phase, step)
  return (
    <div className="phase-track" aria-label="turn phase">
      {PHASE_SEGMENTS.map((label, i) => (
        <div
          key={label}
          className={`phase-seg${i === idx ? ' active' : i < idx ? ' past' : ''}`}
          title={i === idx && step ? `${label} — ${step}` : label}
        >
          {label}
        </div>
      ))}
      {step && <span className="phase-step muted">{step}</span>}
    </div>
  )
}

function promptFallback(kind: Prompt['kind']): string {
  switch (kind) {
    case 'select':
      return 'You have priority.'
    case 'target':
      return 'Choose a target.'
    case 'amount':
      return 'Choose an amount.'
    case 'choice':
      return 'Make a choice.'
    default:
      return 'Waiting…'
  }
}
