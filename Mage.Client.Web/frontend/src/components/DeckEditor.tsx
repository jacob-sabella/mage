import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { importDeck, loadDeck, saveDeck, searchCards, uploadDeck } from '../api'
import { DeckPicker } from './DeckPicker'
import { ManaCost } from './ManaCost'
import type { CardInfoDto, DeckCardEntry } from '../types'
const COLOR_HEX: Record<string, string> = {
  W: '#e9e3c8',
  U: '#4a90d9',
  B: '#9b7cb6',
  R: '#e0555f',
  G: '#4ec98a',
  C: '#9aa3b2',
}
const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land']

function isLand(e: DeckCardEntry) {
  return (e.types ?? []).some((t) => t.toLowerCase() === 'land')
}

export function DeckEditor() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CardInfoDto[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [fColors, setFColors] = useState('')
  const [fType, setFType] = useState('')
  const [fCmc, setFCmc] = useState('')

  const [deck, setDeck] = useState<DeckCardEntry[]>([])
  const [sideboard, setSideboard] = useState<DeckCardEntry[]>([])
  const [deckName, setDeckName] = useState('My Deck')
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  const total = deck.reduce((s, e) => s + e.count, 0)

  const runSearch = useCallback(async () => {
    setSearching(true)
    setSearchError(null)
    try {
      setResults(await searchCards(query.trim(), { colors: fColors, type: fType, cmc: fCmc }))
      setSearched(true)
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'search failed')
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [query, fColors, fType, fCmc])

  const toggleColor = (c: string) => setFColors((p) => (p.includes(c) ? p.replace(c, '') : p + c))

  // show some cards immediately instead of a blank table
  useEffect(() => {
    runSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addCard = useCallback((card: CardInfoDto) => {
    setDeck((prev) => {
      const ex = prev.find((e) => e.name === card.name)
      if (ex) return prev.map((e) => (e.name === card.name ? { ...e, count: e.count + 1 } : e))
      return [
        ...prev,
        { name: card.name, count: 1, manaValue: card.manaValue, colors: card.colors, types: card.types, manaCost: card.manaCost },
      ]
    })
  }, [])

  const incName = useCallback((name: string) => {
    setDeck((prev) => prev.map((e) => (e.name === name ? { ...e, count: e.count + 1 } : e)))
  }, [])
  const decName = useCallback((name: string) => {
    setDeck((prev) => prev.map((e) => (e.name === name ? { ...e, count: e.count - 1 } : e)).filter((e) => e.count > 0))
  }, [])

  const [pickerOpen, setPickerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [unresolved, setUnresolved] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const doImport = useCallback(async () => {
    setImporting(true)
    setUnresolved([])
    setSaveStatus(null)
    try {
      const res = await importDeck({ text: importText.trim() || undefined, moxfieldUrl: importUrl.trim() || undefined })
      setDeck(res.cards)
      setSideboard(res.sideboard ?? [])
      setDeckName(res.name)
      setUnresolved(res.unresolved ?? [])
      setSaveStatus(
        res.unresolved?.length ? `Imported “${res.name}” — ${res.unresolved.length} card(s) not found` : `Imported “${res.name}”`,
      )
      setImportOpen(false)
      setImportText('')
      setImportUrl('')
    } catch (err) {
      setSaveStatus(err instanceof Error ? `Error: ${err.message}` : 'Import failed')
    } finally {
      setImporting(false)
    }
  }, [importText, importUrl])

  const onUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    setSaveStatus(null)
    try {
      const res = await uploadDeck(file)
      setSaveStatus(`Uploaded “${res.name}” to the server`)
      try {
        const loaded = await loadDeck(res.path)
        setDeck(loaded.cards)
        setSideboard(loaded.sideboard ?? [])
        setDeckName(loaded.name)
      } catch {
        /* upload succeeded; preview is best-effort */
      }
    } catch (err) {
      setSaveStatus(err instanceof Error ? `Error: ${err.message}` : 'Upload failed')
    }
  }, [])

  const doLoad = useCallback(async (path: string) => {
    setPickerOpen(false)
    setSaveStatus(null)
    try {
      const res = await loadDeck(path)
      setDeck(res.cards)
      setSideboard(res.sideboard ?? [])
      setDeckName(res.name)
      setSaveStatus(`Loaded “${res.name}”`)
    } catch (err) {
      setSaveStatus(err instanceof Error ? `Error: ${err.message}` : 'Error loading deck')
    }
  }, [])

  const onSave = useCallback(async () => {
    if (deck.length === 0) return
    const name = window.prompt('Deck name', deckName)
    if (name == null) return
    setDeckName(name)
    const path = window.prompt('Save path on the server (.dck). Blank = default file.', '')
    if (path == null) return
    const cards: string[] = []
    for (const e of deck) for (let i = 0; i < e.count; i++) cards.push(e.name)
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

  const stats = useMemo(() => computeStats(deck), [deck])

  return (
    <div className="deck-editor">
      <section className="panel deck-search">
        <div className="deck-search-bar">
          <input
            type="text"
            placeholder="Search cards by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          />
          <button className="btn primary" onClick={runSearch} disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="deck-filters">
          {(['W', 'U', 'B', 'R', 'G', 'C'] as const).map((c) => (
            <button
              key={c}
              className={`filter-pip${fColors.includes(c) ? ' on' : ''}`}
              style={{ background: fColors.includes(c) ? COLOR_HEX[c] : undefined }}
              onClick={() => toggleColor(c)}
              title={`Filter: ${c}`}
            >
              {c}
            </button>
          ))}
          <select className="filter-select" value={fType} onChange={(e) => setFType(e.target.value)}>
            <option value="">Any type</option>
            {TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            className="filter-cmc"
            type="number"
            min={0}
            placeholder="CMC"
            value={fCmc}
            onChange={(e) => setFCmc(e.target.value)}
          />
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
                  <td className="cost-cell">{card.manaCost ? <ManaCost cost={card.manaCost} /> : '—'}</td>
                  <td className="muted">{card.types.join(' ')}</td>
                  <td className="muted">{card.set}</td>
                  <td className="row-actions">
                    <button className="btn watch-btn" onClick={() => addCard(card)}>
                      + Add
                    </button>
                  </td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td className="empty" colSpan={5}>
                    {searched ? 'No cards found.' : 'Search the card database to start building a deck.'}
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
          <button className="btn watch-btn" onClick={() => setImportOpen(true)}>
            Import
          </button>
          <button className="btn watch-btn" onClick={() => fileInputRef.current?.click()}>
            Upload
          </button>
          <button className="btn watch-btn" onClick={() => setPickerOpen(true)}>
            Open
          </button>
          <input ref={fileInputRef} type="file" accept=".dck" style={{ display: 'none' }} onChange={onUpload} />
        </div>

        {deck.length > 0 && <DeckStats stats={stats} />}

        <div className="deck-list-body">
          {deck.length === 0 ? (
            <p className="empty">No cards yet. Add from search, or Open a .dck.</p>
          ) : (
            <ul className="deck-entries">
              {deck.map((e) => (
                <li key={e.name} className="deck-entry">
                  <span className="deck-entry-count">{e.count}×</span>
                  <span className="deck-entry-name">{e.name}</span>
                  {e.manaCost && <ManaCost cost={e.manaCost} className="deck-entry-cost" />}
                  <span className="deck-entry-actions">
                    <button className="btn ghost deck-mini-btn" onClick={() => decName(e.name)}>
                      −
                    </button>
                    <button className="btn ghost deck-mini-btn" onClick={() => incName(e.name)}>
                      +
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {sideboard.length > 0 && (
            <>
              <div className="zone-row-title deck-side-title">
                Sideboard / Commander ({sideboard.reduce((s, e) => s + e.count, 0)})
              </div>
              <ul className="deck-entries">
                {sideboard.map((e) => (
                  <li key={e.name} className="deck-entry">
                    <span className="deck-entry-count">{e.count}×</span>
                    <span className="deck-entry-name">{e.name}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="deck-list-foot">
          <button className="btn primary block" onClick={onSave} disabled={saving || deck.length === 0}>
            {saving ? 'Saving…' : 'Save deck (.dck)'}
          </button>
          {saveStatus && <p className="deck-save-status muted">{saveStatus}</p>}
          {unresolved.length > 0 && <p className="deck-error">Not found: {unresolved.join(', ')}</p>}
        </div>
      </section>

      {pickerOpen && (
        <DeckPicker title="Open a deck" onPick={(d) => doLoad(d.path)} onClose={() => setPickerOpen(false)} />
      )}

      {importOpen && (
        <div className="modal-backdrop" onClick={() => setImportOpen(false)}>
          <div className="modal panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 className="deck-title">Import deck</h2>
            </div>
            <label className="muted">Paste a decklist (MTGO / Moxfield export)</label>
            <textarea
              className="import-textarea setting-input"
              rows={10}
              placeholder={'4 Lightning Bolt\n20 Mountain'}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <label className="muted">…or a Moxfield public deck URL</label>
            <input
              className="setting-input"
              type="text"
              placeholder="https://moxfield.com/decks/xxxxxxxx"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
            />
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setImportOpen(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={doImport}
                disabled={importing || (!importText.trim() && !importUrl.trim())}
              >
                {importing ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface Stats {
  lands: number
  spells: number
  curve: number[] // index 0..7 (7 = 7+), nonland
  colors: Record<string, number>
  types: Record<string, number>
}

function computeStats(deck: DeckCardEntry[]): Stats {
  const curve = Array(8).fill(0)
  const colors: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  const types: Record<string, number> = {}
  let lands = 0
  let spells = 0
  for (const e of deck) {
    const land = isLand(e)
    if (land) lands += e.count
    else {
      spells += e.count
      curve[Math.min(e.manaValue ?? 0, 7)] += e.count
      const cs = e.colors ?? ''
      if (cs) for (const c of cs) colors[c] = (colors[c] ?? 0) + e.count
      else colors.C += e.count
    }
    for (const t of e.types ?? []) {
      const key = t.charAt(0) + t.slice(1).toLowerCase()
      types[key] = (types[key] ?? 0) + e.count
    }
  }
  return { lands, spells, curve, colors, types }
}

function DeckStats({ stats }: { stats: Stats }) {
  const maxCurve = Math.max(1, ...stats.curve)
  return (
    <div className="deck-stats">
      <div className="deck-stats-row">
        <span className="muted">{stats.spells} spells · {stats.lands} lands</span>
        <span className="spacer" />
        <span className="pips">
          {(['W', 'U', 'B', 'R', 'G', 'C'] as const).map((c) =>
            stats.colors[c] ? (
              <span key={c} className="pip" style={{ background: COLOR_HEX[c] }} title={`${c}: ${stats.colors[c]}`}>
                {stats.colors[c]}
              </span>
            ) : null,
          )}
        </span>
      </div>
      <div className="curve">
        {stats.curve.map((n, i) => (
          <div className="curve-col" key={i} title={`CMC ${i === 7 ? '7+' : i}: ${n}`}>
            <div className="curve-bar" style={{ height: `${(n / maxCurve) * 46 + 2}px` }} />
            <div className="curve-label">{i === 7 ? '7+' : i}</div>
          </div>
        ))}
      </div>
      <div className="type-counts">
        {TYPE_ORDER.filter((t) => stats.types[t]).map((t) => (
          <span key={t} className="muted type-count">
            {t} {stats.types[t]}
          </span>
        ))}
      </div>
    </div>
  )
}
