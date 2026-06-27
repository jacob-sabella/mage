import { useCallback, useEffect, useState } from 'react'
import { disconnect, fetchTables } from '../api'
import { useServerEvents } from '../useServerEvents'
import type { Session, TableDto } from '../types'

interface Props {
  session: Session
  onDisconnected: () => void
  onOnlineChange: (online: boolean) => void
}

export function LobbyView({ session, onDisconnected, onOnlineChange }: Props) {
  const [tables, setTables] = useState<TableDto[]>([])
  const [refreshing, setRefreshing] = useState(false)

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

  // a server-side table change is a good cue to refresh
  const { events, online } = useServerEvents(session.token, (e) => {
    if (e.type === 'event') refresh()
  })

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    onOnlineChange(online)
  }, [online, onOnlineChange])

  async function handleDisconnect() {
    await disconnect(session.token)
    onDisconnected()
  }

  return (
    <section className="view lobby-view">
      <div className="lobby-header">
        <h1 className="h1">Open tables</h1>
        <span className="chip">
          {tables.length} {tables.length === 1 ? 'table' : 'tables'}
        </span>
        <span className="spacer" />
        <button className="btn" disabled={refreshing} onClick={refresh}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button className="btn ghost" onClick={handleDisconnect}>
          Disconnect
        </button>
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
              </tr>
            ))}
          </tbody>
        </table>
        {tables.length === 0 && (
          <p className="empty">No open tables right now. Create one or refresh.</p>
        )}
      </div>

      <div className="event-log">
        {events.map((e, i) => (
          <div className="line" key={i}>
            <span className="tag">[{e.type}] </span>
            {e.payload}
          </div>
        ))}
      </div>
    </section>
  )
}
