import { useState } from 'react'
import { GameCard } from './GameCard'
import type { RespondKind } from '../api'
import type { GameCard as CardType, GamePlayer, GameState, Prompt } from '../types'

interface Props {
  game: GameState | null
  prompt: Prompt | null
  interactive: boolean
  onRespond: (kind: RespondKind, value?: string) => void
  onLeave: () => void
}

export function GameTable({ game, prompt, interactive, onRespond, onLeave }: Props) {
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
        <span className="phase-pill">
          {game.phase}
          {game.step && game.step !== game.phase ? ` · ${game.step}` : ''}
        </span>
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

      <div className="game-board">
        {game.players.map((p) => (
          <PlayerArea key={p.id} player={p} active={p.name === game.activePlayer} cardProps={cardProps} />
        ))}
      </div>

      {game.stack.length > 0 && (
        <div className="game-stack panel">
          <div className="stack-title">Stack ({game.stack.length})</div>
          <div className="card-row">
            {game.stack.map((c) => (
              <GameCard key={c.id} card={c} {...cardProps(c)} />
            ))}
          </div>
        </div>
      )}

      {interactive && prompt && <ActionBar prompt={prompt} onRespond={onRespond} />}
    </div>
  )
}

function PlayerArea({
  player,
  active,
  cardProps,
}: {
  player: GamePlayer
  active: boolean
  cardProps: (c: CardType) => { highlight?: 'play' | 'target'; onClick?: (c: CardType) => void }
}) {
  return (
    <div className={`player-area${active ? ' active' : ''}`}>
      <div className="player-bar">
        <span className="player-name">{player.name}</span>
        <span className="life">♥ {player.life}</span>
        <span className="zone-counts muted">
          Hand {player.handCount} · Library {player.libraryCount} · Grave {player.graveyardCount}
        </span>
        {active && <span className="chip active-chip">Active</span>}
      </div>
      <div className="battlefield">
        {player.battlefield.length === 0 ? (
          <span className="muted empty-field">No permanents</span>
        ) : (
          <div className="card-row">
            {player.battlefield.map((c) => (
              <GameCard key={c.id} card={c} {...cardProps(c)} />
            ))}
          </div>
        )}
      </div>
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
          <span className="muted hint">Click a highlighted card to play it</span>
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
            <button key={c.key} className="btn" onClick={() => onRespond('string', c.key)}>
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
