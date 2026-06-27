import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { GameCard } from './GameCard'
import type { RespondKind } from '../api'
import type { GameCard as CardType, GamePlayer, GameState, Prompt } from '../types'

/** A flex row of cards with enter/exit/reflow animation. */
function CardRow({
  cards,
  cardProps,
}: {
  cards: CardType[]
  cardProps: (c: CardType) => { highlight?: 'play' | 'target'; onClick?: (c: CardType) => void }
}) {
  return (
    <div className="card-row">
      <AnimatePresence mode="popLayout">
        {cards.map((c) => (
          <GameCard key={c.id} card={c} {...cardProps(c)} />
        ))}
      </AnimatePresence>
    </div>
  )
}

interface Props {
  game: GameState | null
  prompt: Prompt | null
  interactive: boolean
  log?: string[]
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

export function GameTable({ game, prompt, interactive, log = [], onRespond, onLeave }: Props) {
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

      <div className="game-board">
        {game.players.map((p) => (
          <PlayerArea
            key={p.id}
            player={p}
            active={p.name === game.activePlayer}
            cardProps={cardProps}
            // during a target/select decision a player can be the target
            onTarget={
              interactive && prompt && (prompt.kind === 'target' || prompt.kind === 'select')
                ? () => onRespond('uuid', p.id)
                : undefined
            }
          />
        ))}
      </div>

      {game.stack.length > 0 && (
        <motion.div
          className="game-stack panel"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="stack-title">Stack ({game.stack.length})</div>
          <CardRow cards={game.stack} cardProps={cardProps} />
        </motion.div>
      )}

      {game.myHand.length > 0 && (
        <div className="hand-zone panel">
          <div className="stack-title">Your hand ({game.myHand.length})</div>
          <CardRow cards={game.myHand} cardProps={cardProps} />
        </div>
      )}

      {interactive && prompt && <ActionBar prompt={prompt} onRespond={onRespond} />}

      {log.length > 0 && <GameLog lines={log} />}
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
            {l}
          </div>
        ))}
      </div>
    </div>
  )
}

function PlayerArea({
  player,
  active,
  cardProps,
  onTarget,
}: {
  player: GamePlayer
  active: boolean
  cardProps: (c: CardType) => { highlight?: 'play' | 'target'; onClick?: (c: CardType) => void }
  onTarget?: () => void
}) {
  return (
    <div className={`player-area${active ? ' active' : ''}`}>
      <div
        className={`player-bar${onTarget ? ' targetable' : ''}`}
        onClick={onTarget}
        title={onTarget ? `Target ${player.name}` : undefined}
      >
        <span className="player-name">{player.name}</span>
        <motion.span
          className="life"
          key={player.life}
          initial={{ scale: 1.5, color: '#7df0c0' }}
          animate={{ scale: 1, color: '#4ec98a' }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
        >
          ♥ {player.life}
        </motion.span>
        <span className="zone-counts muted">
          Hand {player.handCount} · Library {player.libraryCount} · Grave {player.graveyardCount}
        </span>
        {active && <span className="chip active-chip">Active</span>}
      </div>
      <div className="battlefield">
        {player.battlefield.length === 0 ? (
          <span className="muted empty-field">No permanents</span>
        ) : (
          <CardRow cards={player.battlefield} cardProps={cardProps} />
        )}
      </div>
      {player.graveyard.length > 0 && (
        <ZoneRow label="Graveyard" cards={player.graveyard} cardProps={cardProps} />
      )}
      {player.exile.length > 0 && <ZoneRow label="Exile" cards={player.exile} cardProps={cardProps} />}
    </div>
  )
}

function ZoneRow({
  label,
  cards,
  cardProps,
}: {
  label: string
  cards: CardType[]
  cardProps: (c: CardType) => { highlight?: 'play' | 'target'; onClick?: (c: CardType) => void }
}) {
  return (
    <div className="zone-row">
      <div className="zone-row-title">
        {label} ({cards.length})
      </div>
      <CardRow cards={cards} cardProps={cardProps} />
    </div>
  )
}

function ActionBar({ prompt, onRespond }: { prompt: Prompt; onRespond: (kind: RespondKind, value?: string) => void }) {
  const [amount, setAmount] = useState('')

  return (
    <div className="action-bar panel">
      <span className="action-message">{prompt.message || promptFallback(prompt.kind)}</span>
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

      {prompt.kind === 'generic' && prompt.canCancel && (
        <button className="btn" onClick={() => onRespond('boolean', 'false')}>
          Cancel
        </button>
      )}
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
