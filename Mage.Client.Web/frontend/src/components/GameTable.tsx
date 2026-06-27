import { GameCard } from './GameCard'
import type { GamePlayer, GameState } from '../types'

interface Props {
  game: GameState | null
  onLeave: () => void
}

export function GameTable({ game, onLeave }: Props) {
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

  // First player rendered on the far side, the rest stacked toward the viewer.
  const players = game.players

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
      </div>

      <div className="game-board">
        {players.map((p) => (
          <PlayerArea key={p.id} player={p} active={p.name === game.activePlayer} />
        ))}
      </div>

      {game.stack.length > 0 && (
        <div className="game-stack panel">
          <div className="stack-title">Stack ({game.stack.length})</div>
          <div className="card-row">
            {game.stack.map((c) => (
              <GameCard key={c.id} card={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PlayerArea({ player, active }: { player: GamePlayer; active: boolean }) {
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
              <GameCard key={c.id} card={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
