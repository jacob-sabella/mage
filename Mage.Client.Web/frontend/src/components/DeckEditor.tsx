import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { importDeck, loadDeck, saveDeck, searchCards, uploadDeck } from '../api'
import { useEscapeClose } from '../useEscapeClose'
import { DeckPicker } from './DeckPicker'
import { ManaCost } from './ManaCost'
import type { CardInfoDto, DeckCardEntry } from '../types'
import { getCachedUrl, preloadImage } from '../imageCache'
const COLOR_HEX: Record<string, string> = {
  W: '#e9e3c8',
  U: '#4a90d9',
  B: '#9b7cb6',
  R: '#e0555f',
  G: '#4ec98a',
  C: '#9aa3b2',
}
const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land']
const BASICS: { c: string; name: string }[] = [
  { c: 'W', name: 'Plains' }, { c: 'U', name: 'Island' }, { c: 'B', name: 'Swamp' }, { c: 'R', name: 'Mountain' }, { c: 'G', name: 'Forest' },
]

const BASIC_LANDS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes'])
function isBasic(e: DeckCardEntry) {
  return BASIC_LANDS.has(e.name.toLowerCase()) || (e.types ?? []).some((t) => t.toLowerCase() === 'basic')
}
/** A non-basic card past the 4-copy constructed limit. */
function overLimit(e: DeckCardEntry) {
  return e.count > 4 && !isBasic(e)
}

function isLand(e: DeckCardEntry) {
  return (e.types ?? []).some((t) => t.toLowerCase() === 'land')
}

const TYPE_LABEL: Record<string, string> = {
  Creature: 'Creatures', Planeswalker: 'Planeswalkers', Instant: 'Instants', Sorcery: 'Sorceries',
  Artifact: 'Artifacts', Enchantment: 'Enchantments', Battle: 'Battles', Land: 'Lands', Other: 'Other',
}

/** Group deck entries by primary card type, in play order, sorted by mana value. */
function groupDeck(deck: DeckCardEntry[]): { type: string; entries: DeckCardEntry[]; count: number }[] {
  const buckets: Record<string, DeckCardEntry[]> = {}
  for (const e of deck) {
    const t = TYPE_ORDER.find((x) => (e.types ?? []).some((y) => y.toLowerCase() === x.toLowerCase())) ?? 'Other'
    ;(buckets[t] ??= []).push(e)
  }
  return [...TYPE_ORDER, 'Other']
    .filter((t) => buckets[t]?.length)
    .map((t) => ({
      type: t,
      count: buckets[t].reduce((s, e) => s + e.count, 0),
      entries: buckets[t].sort((a, b) => (a.manaValue ?? 0) - (b.manaValue ?? 0) || a.name.localeCompare(b.name)),
    }))
}

// auto-saved work-in-progress deck (survives reloads)
const DRAFT_KEY = 'mage.deck.draft'
interface DeckDraft {
  deck: DeckCardEntry[]
  sideboard: DeckCardEntry[]
  name: string
}
function loadDraft(): DeckDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as DeckDraft) : null
  } catch {
    return null
  }
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
  const [fSort, setFSort] = useState<'name' | 'cmc' | 'color'>('name')
  const [fRarity, setFRarity] = useState('')
  const [fView, setFView] = useState<'gallery' | 'table'>(
    () => (localStorage.getItem('mage.deckView') === 'table' ? 'table' : 'gallery'),
  )
  useEffect(() => {
    localStorage.setItem('mage.deckView', fView)
  }, [fView])

  // restore an in-progress deck from a previous session so a refresh never
  // discards your work-in-progress deck
  const draft0 = useMemo(loadDraft, [])
  const [deck, setDeck] = useState<DeckCardEntry[]>(draft0?.deck ?? [])
  const [sideboard, setSideboard] = useState<DeckCardEntry[]>(draft0?.sideboard ?? [])
  const [deckName, setDeckName] = useState(draft0?.name ?? 'My Deck')
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  // hover a card (search result or deck entry) to preview its art
  const [preview, setPreview] = useState<PreviewCard | null>(null)
  const previewClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showPreview = useCallback((card: PreviewCard | null) => {
    if (previewClearTimer.current) clearTimeout(previewClearTimer.current)
    if (card !== null) {
      setPreview(card)
    } else {
      previewClearTimer.current = setTimeout(() => setPreview(null), 150)
    }
  }, [])

  const total = deck.reduce((s, e) => s + e.count, 0)
  const deckCount = useMemo(() => Object.fromEntries(deck.map((e) => [e.name, e.count])), [deck])
  const overLimitNames = useMemo(() => deck.filter(overLimit).map((e) => e.name), [deck])

  // persist the in-progress deck on every change
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ deck, sideboard, name: deckName }))
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [deck, sideboard, deckName])

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

  // live search: results update as you type / change filters (debounced), and
  // an immediate grid on first mount
  useEffect(() => {
    const t = setTimeout(runSearch, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, fColors, fType, fCmc])

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
  const [sampleOpen, setSampleOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  useEscapeClose(useCallback(() => setImportOpen(false), []))
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

  // start a fresh deck (clears the auto-saved draft)
  const onNewDeck = useCallback(() => {
    if (deck.length && !window.confirm('Clear the current deck and start a new one?')) return
    setDeck([])
    setSideboard([])
    setDeckName('My Deck')
    setUnresolved([])
    setSaveStatus(null)
  }, [deck.length])

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

  // export the deck as MTGO/Moxfield-style text and copy it to the clipboard
  const decklistText = useCallback(() => {
    const lines = (entries: DeckCardEntry[]) => entries.map((e) => `${e.count} ${e.name}`).join('\n')
    let text = lines(deck)
    if (sideboard.length) text += `\n\n${lines(sideboard)}`
    return text
  }, [deck, sideboard])

  const onCopyList = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(decklistText())
      setSaveStatus('Decklist copied to clipboard')
    } catch {
      setSaveStatus('Copy failed — clipboard unavailable')
    }
  }, [decklistText])

  const onDownloadTxt = useCallback(() => {
    const blob = new Blob([decklistText()], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(deckName || 'deck').replace(/[^a-z0-9-_ ]/gi, '_').trim() || 'deck'}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setSaveStatus('Decklist downloaded')
  }, [decklistText, deckName])

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
  const groups = useMemo(() => groupDeck(deck), [deck])
  const sortedResults = useMemo(() => {
    const arr = fRarity ? results.filter((c) => (c.rarity ?? '').toLowerCase().includes(fRarity.toLowerCase())) : [...results]
    if (fSort === 'cmc') arr.sort((a, b) => (a.manaValue ?? 0) - (b.manaValue ?? 0) || a.name.localeCompare(b.name))
    else if (fSort === 'color') arr.sort((a, b) => (a.colors ?? 'Z').localeCompare(b.colors ?? 'Z') || a.name.localeCompare(b.name))
    else arr.sort((a, b) => a.name.localeCompare(b.name))
    return arr
  }, [results, fSort, fRarity])

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
          <select className="filter-select" value={fRarity} onChange={(e) => setFRarity(e.target.value)} title="Rarity">
            <option value="">Any rarity</option>
            <option value="common">Common</option>
            <option value="uncommon">Uncommon</option>
            <option value="rare">Rare</option>
            <option value="mythic">Mythic</option>
          </select>
          {(query || fColors || fType || fCmc || fRarity) && (
            <button
              className="btn ghost filter-clear"
              title="Clear all filters"
              onClick={() => {
                setQuery('')
                setFColors('')
                setFType('')
                setFCmc('')
                setFRarity('')
              }}
            >
              Clear ✕
            </button>
          )}
        </div>
        {searchError && <p className="deck-error">{searchError}</p>}
        {results.length > 0 && (
          <div className="deck-results-bar">
            <span className="muted">
              {sortedResults.length} card{sortedResults.length === 1 ? '' : 's'}
              {fRarity && results.length !== sortedResults.length ? ` of ${results.length}` : ''}
            </span>
            <span className="spacer" />
            <div className="view-switch" role="group" aria-label="Result view">
              <button
                className={`view-switch-btn${fView === 'gallery' ? ' active' : ''}`}
                onClick={() => setFView('gallery')}
                title="Gallery view"
                aria-pressed={fView === 'gallery'}
              >
                ▦ Gallery
              </button>
              <button
                className={`view-switch-btn${fView === 'table' ? ' active' : ''}`}
                onClick={() => setFView('table')}
                title="Table view"
                aria-pressed={fView === 'table'}
              >
                ☰ Table
              </button>
            </div>
            <label className="muted results-sort">
              Sort
              <select className="filter-select" value={fSort} onChange={(e) => setFSort(e.target.value as typeof fSort)}>
                <option value="name">Name</option>
                <option value="cmc">Mana value</option>
                <option value="color">Color</option>
              </select>
            </label>
          </div>
        )}
        {sortedResults.length === 0 ? (
          <p className="empty deck-grid-empty">
            {searched ? 'No cards found.' : 'Search the card database to start building a deck.'}
          </p>
        ) : fView === 'gallery' ? (
          <div className="card-grid">
            {sortedResults.map((card, i) => (
              <CardTile
                key={`${card.name}-${card.set}-${i}`}
                card={card}
                count={deckCount[card.name] ?? 0}
                onAdd={addCard}
                onRemove={decName}
                onHover={showPreview}
              />
            ))}
          </div>
        ) : (
          <div className="table-wrap deck-table-wrap">
            <table className="data-table deck-table">
              <thead>
                <tr>
                  <th />
                  <th>Name</th>
                  <th>Cost</th>
                  <th>Type</th>
                  <th>Rarity</th>
                  <th>Set</th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((card, i) => {
                  const n = deckCount[card.name] ?? 0
                  return (
                    <tr
                      key={`${card.name}-${card.set}-${i}`}
                      className={n > 0 ? 'in-deck' : ''}
                      onMouseEnter={() => showPreview(card)}
                      onMouseLeave={() => showPreview(null)}
                    >
                      <td className="deck-table-add">
                        <button className="btn ghost deck-mini-btn" aria-label={`Add ${card.name}`} onClick={() => addCard(card)}>
                          +
                        </button>
                        {n > 0 && (
                          <button className="btn ghost deck-mini-btn" aria-label={`Remove ${card.name}`} onClick={() => decName(card.name)}>
                            −
                          </button>
                        )}
                        {n > 0 && <span className="deck-table-count">{n}</span>}
                      </td>
                      <td className="deck-table-name">{card.name}</td>
                      <td>{card.manaCost ? <ManaCost cost={card.manaCost} /> : '—'}</td>
                      <td className="muted">{card.types.join(' ')}</td>
                      <td className="muted">{card.rarity ?? '—'}</td>
                      <td className="muted">{card.set ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel deck-list">
        <DeckCardPreview card={preview} />
        <div className="deck-list-head">
          <input
            className="deck-title deck-title-input"
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
            aria-label="Deck name"
            title="Rename deck"
            spellCheck={false}
          />
          <span className="deck-title-pencil" aria-hidden>✎</span>
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
          <button className="btn ghost watch-btn" onClick={onNewDeck} disabled={deck.length === 0 && sideboard.length === 0}>
            New
          </button>
          <input ref={fileInputRef} type="file" accept=".dck" style={{ display: 'none' }} onChange={onUpload} />
        </div>

        <div className="deck-basics">
          <span className="muted">Add basics</span>
          {BASICS.map((b) => (
            <button
              key={b.name}
              className="basic-btn"
              style={{ background: COLOR_HEX[b.c] }}
              aria-label={`Add ${b.name}`}
              title={`Add ${b.name}`}
              onClick={() => addCard({ name: b.name, types: ['Land'], manaValue: 0, colors: '', manaCost: '', set: '', rarity: 'Common' })}
            >
              {b.c}
            </button>
          ))}
        </div>

        {deck.length > 0 && (
          <div className={`deck-legality${total >= 60 ? ' ok' : ''}`} title="Constructed decks need at least 60 cards">
            <div className="deck-legality-bar">
              <div className="deck-legality-fill" style={{ width: `${Math.min(100, (total / 60) * 100)}%` }} />
            </div>
            <span className="deck-legality-label muted">
              {total} / 60 {total >= 60 ? '· ready' : `· ${60 - total} to go`}
            </span>
          </div>
        )}
        {overLimitNames.length > 0 && (
          <p className="deck-limit-warn" title="Constructed decks allow at most 4 copies of a card (basic lands are exempt)">
            ⚠ Over the 4-copy limit: {overLimitNames.join(', ')}
          </p>
        )}

        {deck.length > 0 && <DeckStats stats={stats} />}

        <div className="deck-list-body">
          {deck.length === 0 ? (
            <p className="empty">No cards yet. Click a card on the left, or Import / Open a deck.</p>
          ) : (
            <div className="deck-groups">
              {groups.map((g) => (
                <div className="deck-group" key={g.type}>
                  <div className="deck-group-title">
                    {TYPE_LABEL[g.type] ?? g.type} <span className="muted">{g.count}</span>
                  </div>
                  <ul className="deck-entries">
                    {g.entries.map((e) => (
                      <li
                        key={e.name}
                        className={`deck-entry${overLimit(e) ? ' over-limit' : ''}`}
                        onMouseEnter={() => showPreview(e)}
                        onMouseLeave={() => showPreview(null)}
                        onClick={() => showPreview(e)}
                      >
                        <span className="deck-entry-count">{e.count}×</span>
                        <span className="deck-entry-name">{e.name}</span>
                        {e.manaCost && <ManaCost cost={e.manaCost} className="deck-entry-cost" />}
                        <span className="deck-entry-actions">
                          <button className="btn ghost deck-mini-btn" aria-label={`Decrease ${e.name}`} onClick={() => decName(e.name)}>
                            −
                          </button>
                          <button className="btn ghost deck-mini-btn" aria-label={`Increase ${e.name}`} onClick={() => incName(e.name)}>
                            +
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {sideboard.length > 0 && (
            <>
              <div className="zone-row-title deck-side-title">
                Sideboard / Commander ({sideboard.reduce((s, e) => s + e.count, 0)})
              </div>
              <ul className="deck-entries">
                {sideboard.map((e) => (
                  <li key={e.name} className="deck-entry" onMouseEnter={() => showPreview(e)} onClick={() => showPreview(e)}>
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
          <button className="btn ghost block" onClick={onCopyList} disabled={deck.length === 0}>
            Copy decklist
          </button>
          <button className="btn ghost block" onClick={onDownloadTxt} disabled={deck.length === 0}>
            Download .txt
          </button>
          <button className="btn ghost block" onClick={() => setSampleOpen(true)} disabled={total < 7}>
            Sample hand
          </button>
          {saveStatus && <p className="deck-save-status muted">{saveStatus}</p>}
          {unresolved.length > 0 && <p className="deck-error">Not found: {unresolved.join(', ')}</p>}
        </div>
      </section>

      {pickerOpen && (
        <DeckPicker title="Open a deck" onPick={(d) => doLoad(d.path)} onClose={() => setPickerOpen(false)} />
      )}

      {sampleOpen && <SampleHandModal deck={deck} onClose={() => setSampleOpen(false)} />}

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

function shuffle<T>(a: T[]): T[] {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

/** Draw a random opening hand from the deck (weighted by copies) to test it. */
function SampleHandModal({ deck, onClose }: { deck: DeckCardEntry[]; onClose: () => void }) {
  useEscapeClose(onClose)
  const pool = useMemo(() => deck.flatMap((e) => Array(e.count).fill(e) as DeckCardEntry[]), [deck])
  const [hand, setHand] = useState<DeckCardEntry[]>(() => shuffle(pool).slice(0, 7))
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel sample-hand-modal" role="dialog" aria-label="Sample hand" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="h1">Sample hand</h2>
        </div>
        <div className="sample-hand">
          {hand.map((c, i) => (
            <img
              key={i}
              className="sample-card"
              loading="lazy"
              src={`/api/cardimg?set=&num=&name=${encodeURIComponent(c.name)}`}
              alt={c.name}
              title={c.name}
              onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
            />
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" onClick={() => setHand(shuffle(pool).slice(0, 7))}>
            New hand
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

type PreviewCard = { name: string; set?: string | null; num?: string | null; manaCost?: string | null; types?: string[] }
const PIP_COLOR: Record<string, string> = { W: '#e9e3c0', U: '#4a90e2', B: '#6b5b73', R: '#e0555f', G: '#3aa55f', C: '#9aa0ad' }

/** A clickable card-art tile in the search grid: click the art to add a copy,
 *  shows a copies-in-deck badge + a remove button, and drives the hover preview. */
function CardTile({
  card,
  count,
  onAdd,
  onRemove,
  onHover,
}: {
  card: CardInfoDto
  count: number
  onAdd: (c: CardInfoDto) => void
  onRemove: (name: string) => void
  onHover: (c: PreviewCard | null) => void
}) {
  const img = `/api/cardimg?set=${encodeURIComponent(card.set ?? '')}&num=${encodeURIComponent((card as { num?: string }).num ?? '')}&name=${encodeURIComponent(card.name)}`
  return (
    <div
      className={`card-tile${count > 0 ? ' in-deck' : ''}`}
      onMouseEnter={() => onHover(card)}
      onMouseLeave={() => onHover(null)}
    >
      <button className="card-tile-art" aria-label={`Add ${card.name}`} title={`Add ${card.name}`} onClick={() => onAdd(card)}>
        <img src={img} alt={card.name} loading="lazy" onError={(e) => (e.currentTarget.style.opacity = '0')} />
        <span className="card-tile-fallback">{card.name}</span>
        {/* crisp DOM name so cards are readable even when the art's printed text isn't */}
        <span className="card-tile-caption">{card.name}</span>
      </button>
      {count > 0 && (
        <>
          <span className="card-tile-count" aria-label={`${count} in deck`}>{count}</span>
          <button className="card-tile-remove" aria-label={`Remove ${card.name}`} title={`Remove ${card.name}`} onClick={() => onRemove(card.name)}>
            −
          </button>
        </>
      )}
    </div>
  )
}

/** Inline card-art preview pinned at the top of the deck list panel. */
function DeckCardPreview({ card }: { card: PreviewCard | null }) {
  const [imgSrc, setImgSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!card) {
      setImgSrc(null)
      return
    }
    const apiUrl = `/api/cardimg?set=${encodeURIComponent(card.set ?? '')}&num=${encodeURIComponent(card.num ?? '')}&name=${encodeURIComponent(card.name)}`
    setImgSrc(getCachedUrl(apiUrl))
    let alive = true
    preloadImage(apiUrl).then((url) => {
      if (alive) setImgSrc(url)
    })
    return () => {
      alive = false
    }
  }, [card?.name, card?.set, card?.num])

  if (!card) return <div className="card-preview card-preview-empty muted">Hover a card to preview</div>
  const cost = (card.manaCost?.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1))
  return (
    <div className="card-preview" role="dialog" aria-label={`Card: ${card.name}`}>
      {imgSrc && (
        <img className="card-preview-img" src={imgSrc} alt={card.name} onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
      )}
      <div className="card-preview-info">
        <div className="card-preview-head">
          <span className="card-preview-name">{card.name}</span>
          <span className="card-preview-cost">
            {cost.map((s, i) => (
              <span key={i} className="mana-pip" style={{ background: PIP_COLOR[s] ?? '#9aa0ad' }}>
                {s}
              </span>
            ))}
          </span>
        </div>
        <div className="card-preview-type muted">{(card.types ?? []).join(' ')}</div>
      </div>
    </div>
  )
}

interface Stats {
  lands: number
  spells: number
  avgCmc: number // average mana value of nonland cards
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
  let cmcSum = 0
  for (const e of deck) {
    const land = isLand(e)
    if (land) lands += e.count
    else {
      spells += e.count
      cmcSum += (e.manaValue ?? 0) * e.count
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
  return { lands, spells, avgCmc: spells ? cmcSum / spells : 0, curve, colors, types }
}

function DeckStats({ stats }: { stats: Stats }) {
  const maxCurve = Math.max(1, ...stats.curve)
  return (
    <div className="deck-stats">
      <div className="deck-stats-row">
        <span className="muted">
          {stats.spells} spells · {stats.lands} lands{stats.spells ? ` · avg ${stats.avgCmc.toFixed(1)} MV` : ''}
        </span>
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
