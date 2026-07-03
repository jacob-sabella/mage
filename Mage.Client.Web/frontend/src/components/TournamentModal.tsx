import { useEffect, useState } from 'react'
import { getTournament } from '../api'
import type { TournamentDto } from '../types'

/** Spectator's tournament panel: standings + per-round pairings, polled while
 *  open. A running pairing's Watch button spectates its sub-table duel through
 *  the normal watch-table flow. */
export function TournamentModal({
  token,
  tournamentId,
  onWatchTable,
  onClose,
}: {
  token: string
  tournamentId: string
  onWatchTable: (tableId: string, gameId?: string | null) => void
  onClose: () => void
}) {
  const [data, setData] = useState<TournamentDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      getTournament(token, tournamentId)
        .then((t) => {
          if (alive) {
            setData(t)
            setError(null)
          }
        })
        .catch(() => {
          if (alive) setError('Could not load the tournament')
        })
    load()
    const t = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [token, tournamentId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="tournament-backdrop" onClick={onClose}>
      <div className="tournament-modal panel" role="dialog" aria-label="Tournament" onClick={(e) => e.stopPropagation()}>
        <div className="tournament-head">
          <div>
            <h2>{data?.name ?? 'Tournament'}</h2>
            <span className="muted">
              {data ? `${data.type} · ${data.state}${data.runningInfo ? ` · ${data.runningInfo}` : ''}` : 'Loading…'}
            </span>
          </div>
          <button className="btn ghost" onClick={onClose} aria-label="Close tournament view">
            ✕
          </button>
        </div>
        {error && <p className="muted">{error}</p>}
        {data && !data.watchingAllowed && <p className="muted">The host disabled spectating for this tournament’s duels.</p>}
        {data && (
          <div className="tournament-body">
            <section>
              <h3>Standings</h3>
              <table className="tournament-standings">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Points</th>
                    <th>Results</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {data.players.map((p) => (
                    <tr key={p.name} className={p.quit ? 'quit' : ''}>
                      <td>{p.name}</td>
                      <td>{p.points}</td>
                      <td>{p.results}</td>
                      <td>{p.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section>
              <h3>Rounds</h3>
              {data.rounds.length === 0 && <p className="muted">Pairings appear when the first round starts.</p>}
              {data.rounds.map((r) => (
                <div className="tournament-round" key={r.round}>
                  <h4>Round {r.round}</h4>
                  {r.games.map((g, i) => (
                    <div className="tournament-pairing" key={`${g.gameId ?? i}`}>
                      <span className="pairing-players">{g.players}</span>
                      <span className="muted pairing-state">{g.result || g.state}</span>
                      {data.watchingAllowed && g.tableId && /duel|playing|sideboard/i.test(g.state) && (
                        <button className="btn watch-btn" onClick={() => onWatchTable(g.tableId!, g.gameId)}>
                          Watch
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
