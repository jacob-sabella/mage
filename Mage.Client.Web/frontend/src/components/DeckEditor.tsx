import { useCallback, useState } from 'react'
import { loadDeck, saveDeck, searchCards } from '../api'
import type { CardInfoDto } from '../types'

const DEFAULT_DECK_PATH = ''

interface DeckEntry {
  name: string
  count: number
}

export function DeckEditor() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CardInfoDto[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  // deck is an ordered list of unique card names with quantities
  const [deck, setDeck] = useState<DeckEntry[]>([])
  const [deckName, setDeckName] = useState('My Deck')
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  const total = deck.reduce((sum, e) => sum + e.count, 0)

  const runSearch = useCallback(async () => {
    setSearching(true)
    setSearchError(null)
    try {
      const cards = await searchCards(query.trim())
      setResults(cards)
      setSearched(true)
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'search failed')
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [query])

  const addCard = useCallback((name: string) => {
    setDeck((prev) => {
      const existing = prev.find((e) => e.name === name)
      if (existing) {
        return prev.map((e) => (e.name === name ? { ...e, count: e.count + 1 } : e))
      }
      return [...prev, { name, count: 1 }]
    })
  }, [])

  const removeCard = useCallback((name: string) => {
    setDeck((prev) =>
      prev
        .map((e) => (e.name === name ? { ...e, count: e.count - 1 } : e))
        .filter((e) => e.count > 0),
    )
  }, [])

  const onOpen = useCallback(async () => {
    const path = window.prompt('Open deck (.dck) path on the server:', DEFAULT_DECK_PATH)
    if (!path) {
      return
    }
    setSaveStatus(null)
    try {
      const res = await loadDeck(path.trim())
      setDeck(res.cards.map((c) => ({ name: c.name, count: c.count })))
      setDeckName(res.name)
      const side = res.sideboard?.length ? ` (+${res.sideboard.length} sideboard/commander)` : ''
      setSaveStatus(`Loaded “${res.name}”${side}`)
    } catch (err) {
      setSaveStatus(err instanceof Error ? `Error: ${err.message}` : 'Error loading deck')
    }
  }, [])

  const onSave = useCallback(async () => {
    if (deck.length === 0) {
      return
    }
    const name = window.prompt('Deck name', deckName)
    if (name == null) {
      return
    }
    setDeckName(name)
    const path = window.prompt(
      'Save path on the server (.dck). Leave blank for a default file in the working directory.',
      '',
    )
    if (path == null) {
      return
    }
    // expand quantities into a flat list of card names for the gateway
    const cards: string[] = []
    for (const entry of deck) {
      for (let i = 0; i < entry.count; i++) {
        cards.push(entry.name)
      }
    }
    setSaving(true)
    setSaveStatus(null)
    try {
      const res = await saveDeck(name || 'Untitled', cards, path.trim() || undefined)
      setSaveStatus(`Saved to ${res.path}`)
    } catch (err) {
      setSaveStatus(err instanceof Error ? `Error: ${err.message}` : 'Error saving deck')
    } finally {
      setSaving(false)
    }
  }, [deck, deckName])

  return (
    <div className="deck-editor">
      <section className="panel deck-search">
        <div className="deck-search-bar">
          <input
            type="text"
            placeholder="Search cards by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                runSearch()
              }
            }}
          />
          <button className="btn primary" onClick={runSearch} disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
        {searchError && <p className="deck-error">{searchError}</p>}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Cost</th>
                <th>Type</th>
                <th>Set</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {results.map((card, i) => (
                <tr key={`${card.name}-${card.set}-${i}`}>
                  <td>{card.name}</td>
                  <td className="muted">{card.manaCost || '—'}</td>
                  <td className="muted">{card.types.join(' ')}</td>
                  <td className="muted">{card.set}</td>
                  <td className="row-actions">
                    <button className="btn watch-btn" onClick={() => addCard(card.name)}>
                      + Add
                    </button>
                  </td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td className="empty" colSpan={5}>
                    {searched
                      ? 'No cards found. (The card database may be empty in this environment.)'
                      : 'Search the card database to start building a deck.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel deck-list">
        <div className="deck-list-head">
          <h2 className="deck-title">{deckName}</h2>
          <span className="spacer" />
          <span className="chip">{total} cards</span>
          <button className="btn watch-btn" onClick={onOpen}>
            Open
          </button>
        </div>
        <div className="deck-list-body">
          {deck.length === 0 ? (
            <p className="empty">No cards yet. Add cards from the search results.</p>
          ) : (
            <ul className="deck-entries">
              {deck.map((entry) => (
                <li key={entry.name} className="deck-entry">
                  <span className="deck-entry-count">{entry.count}×</span>
                  <span className="deck-entry-name">{entry.name}</span>
                  <span className="deck-entry-actions">
                    <button className="btn ghost deck-mini-btn" onClick={() => removeCard(entry.name)}>
                      −
                    </button>
                    <button className="btn ghost deck-mini-btn" onClick={() => addCard(entry.name)}>
                      +
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="deck-list-foot">
          <button
            className="btn primary block"
            onClick={onSave}
            disabled={saving || deck.length === 0}
          >
            {saving ? 'Saving…' : 'Save deck (.dck)'}
          </button>
          {saveStatus && <p className="deck-save-status muted">{saveStatus}</p>}
        </div>
      </section>
    </div>
  )
}
