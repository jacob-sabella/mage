import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
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

  // Decide how a card responds to clicks given the current decision.
  function cardProps(card: CardType): { highlight?: 'play' | 'target'; onClick?: (c: CardType) => void } {
    if (!interactive || !prompt) return {}
    if (prompt.kind === 'select' && game!.canPlay.includes(card.id)) {
      return { highlight: 'play', onClick: () => onRespond('uuid', card.id) }
    }
    if (prompt.kind === 'target') {
      return { highlight: 'target', onClick: () => onRespond('uuid', card.id) }
    }
    return {}
  }

  return (
    <div className="game-table">
      <div className="game-toolbar">
        <button className="btn ghost" onClick={onLeave}>
          ← Back to lobby
        </button>
        <span className="chip">Turn {game.turn}</span>
        <motion.span
          className="phase-pill"
          key={`${game.phase}-${game.step}`}
          initial={{ scale: 1.18, boxShadow: '0 0 18px rgba(91,140,255,0.6)' }}
          animate={{ scale: 1, boxShadow: '0 0 0px rgba(91,140,255,0)' }}
          transition={{ duration: 0.5 }}
        >
          {game.phase}
          {game.step && game.step !== game.phase ? ` · ${game.step}` : ''}
        </motion.span>
        <span className="spacer" />
        {game.priorityPlayer && <span className="muted">Priority: {game.priorityPlayer}</span>}
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

      {interactive && (
        <div className="skip-bar">
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
      )}

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

      <Board3D game={game} cardProps={cardProps} onHoverCard={setPreview} />
      <CardPreview card={preview} />

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

      {game.combat.length > 0 && (
        <div className="combat-panel panel">
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

      {/* DOM affordance to play/select cards by name (the 3D meshes are also
          clickable, but this is easier and keeps the action accessible). */}
      {interactive && prompt?.kind === 'select' && (
        <PlayableBar game={game} onRespond={onRespond} onHoverCard={setPreview} />
      )}

      {interactive && prompt && <ActionBar prompt={prompt} onRespond={onRespond} />}

      {log.length > 0 && <GameLog lines={log} />}
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
}: {
  game: GameState
  onRespond: (kind: RespondKind, value?: string) => void
  onHoverCard?: (c: CardType | null) => void
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

function ActionBar({ prompt, onRespond }: { prompt: Prompt; onRespond: (kind: RespondKind, value?: string) => void }) {
  const [amount, setAmount] = useState('')

  return (
    <div className="action-bar panel">
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
