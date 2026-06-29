import { useCallback, useEffect, useState } from 'react'
import { addAiToTable, fetchTables, removeTable, startTable } from '../api'
import type { TableDto } from '../types'

interface Props {
  token: string
  tableId: string
  deckPath: string // the owner's deck, used to fill open seats with AI
  onCancel: () => void
}

/** Pre-game room for an open table: shows seats and lets the owner add AI / start. */
export function WaitingRoom({ token, tableId, deckPath, onCancel }: Props) {
  const [table, setTable] = useState<TableDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const tables = await fetchTables(token)
      setTable(tables.find((t) => t.id === tableId) ?? null)
    } catch {
      /* keep last */
    }
  }, [token, tableId])

  useEffect(() => {
    refresh()
    const h = setInterval(refresh, 2000)
    return () => clearInterval(h)
  }, [refresh])

  const [filled, total] = (table?.seats ?? '1/2').split('/').map((n) => parseInt(n, 10) || 0)
  const full = total > 0 && filled >= total

  const addAi = async () => {
    setBusy(true)
    setNote(null)
    try {
      const r = await addAiToTable(token, tableId, deckPath)
      if (!r.ok) setNote('Could not add an AI (no open seat?)')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    setBusy(true)
    setNote(null)
    try {
      const r = await startTable(token, tableId)
      if (!r.ok) setNote('Could not start — fill every seat first.')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    setBusy(true)
    removeTable(token, tableId).catch(() => {})
    onCancel()
  }

  return (
    <div className="panel waiting-room">
      <div className="waiting-head">
        <h2 className="h2">{table?.name ?? 'Your table'}</h2>
        <span className="muted">{table?.gameType ?? ''}</span>
      </div>

      <div className="waiting-seats">
        <div className="waiting-seat-bar" aria-label={`${filled} of ${total} seats filled`}>
          {Array.from({ length: Math.max(total, 1) }).map((_, i) => (
            <span key={i} className={`seat-dot${i < filled ? ' filled' : ''}`} />
          ))}
        </div>
        <span className="waiting-count">
          {filled} / {total} seats {full ? '— ready' : '— waiting for players'}
        </span>
      </div>

      {note && <p className="deck-error">{note}</p>}

      <div className="waiting-actions">
        {!full && (
          <button className="btn" onClick={addAi} disabled={busy} title="Fill an open seat with an AI">
            Add AI
          </button>
        )}
        <button className="btn primary" onClick={start} disabled={busy || !full} title={full ? 'Start the match' : 'Fill every seat first'}>
          Start match
        </button>
        <span className="spacer" />
        <button className="btn ghost" onClick={cancel} disabled={busy}>
          Cancel table
        </button>
      </div>

      <p className="muted waiting-hint">
        Share that you've opened “{table?.name ?? 'a table'}” — others see it under Open tables and can Join. Fill the
        rest with AI, then Start.
      </p>
    </div>
  )
}
