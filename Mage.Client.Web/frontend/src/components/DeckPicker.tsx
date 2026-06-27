import { useEffect, useMemo, useState } from 'react'
import { listDecks } from '../api'
import type { DeckListItem } from '../api'

interface Props {
  title?: string
  onPick: (deck: DeckListItem) => void
  onClose: () => void
}

/** Modal browser for prebuilt / saved .dck files — no file paths needed. */
export function DeckPicker({ title = 'Choose a deck', onPick, onClose }: Props) {
  const [decks, setDecks] = useState<DeckListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')

  useEffect(() => {
    listDecks()
      .then(setDecks)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to list decks'))
      .finally(() => setLoading(false))
  }, [])

  const categories = useMemo(
    () => Array.from(new Set(decks.map((d) => d.category))).sort((a, b) => a.localeCompare(b)),
    [decks],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return decks
      .filter((d) => (category ? d.category === category : true))
      .filter((d) => (q ? d.name.toLowerCase().includes(q) : true))
      .slice(0, 400)
  }, [decks, query, category])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="h2">{title}</h2>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="picker-controls">
          <input
            autoFocus
            className="picker-search"
            placeholder="Search decks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="filter-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories ({decks.length})</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="picker-list">
          {loading && <p className="muted">Loading decks…</p>}
          {error && <p className="deck-error">{error}</p>}
          {!loading && filtered.length === 0 && <p className="muted">No decks match.</p>}
          {filtered.map((d) => (
            <button key={d.path} className="picker-item" onClick={() => onPick(d)}>
              <span className="picker-name">{d.name}</span>
              <span className="muted picker-cat">{d.category}</span>
            </button>
          ))}
          {!loading && filtered.length === 400 && (
            <p className="muted picker-more">Showing first 400 — refine your search.</p>
          )}
        </div>
      </div>
    </div>
  )
}
