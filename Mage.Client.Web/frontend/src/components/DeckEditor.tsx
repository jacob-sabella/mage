import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { importDeck, loadDeck, saveDeck, searchCards, uploadDeck } from '../api'
import { useEscapeClose } from '../useEscapeClose'
import { DeckPicker } from './DeckPicker'
import { ConfirmDialog } from './ConfirmDialog'
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

// one-tap starting points that show off the query syntax
const QUICK_SEARCHES: { label: string; q: string }[] = [
  { label: 'Creatures', q: 't:creature' },
  { label: 'Card draw', q: 'o:"draw a card"' },
  { label: 'Removal', q: 'o:"destroy target"' },
  { label: 'Counters', q: 'o:"counter target spell"' },
  { label: 'Cheap', q: 'mv<=2' },
  { label: 'Bombs', q: 'mv>=6' },
  { label: 'Big beaters', q: 't:creature pow>=5' },
]

// the search grammar, surfaced in the "?" popover; examples are click-to-run
const SYNTAX_ROWS: { token: string; desc: string; example: string }[] = [
  { token: 'name', desc: 'name contains (bare words, ANDed)', example: 'lightning' },
  { token: 't:', desc: 'type · subtype · supertype', example: 't:goblin' },
  { token: 'o:', desc: 'oracle / rules text', example: 'o:"draw a card"' },
  { token: 'mv: cmc:', desc: 'mana value — also >= <= > <', example: 'mv>=3' },
  { token: 'pow: tou:', desc: 'power / toughness — with >= <= > <', example: 'pow>=4' },
  { token: 'c: color:', desc: 'colors (WUBRGC)', example: 'c:rg' },
  { token: 'r:', desc: 'rarity (common/uncommon/rare/mythic)', example: 'r:mythic' },
  { token: 's: set:', desc: 'set code', example: 's:mh3' },
]
const BASICS: { c: string; name: string }[] = [
  { c: 'W', name: 'Plains' }, { c: 'U', name: 'Island' }, { c: 'B', name: 'Swamp' }, { c: 'R', name: 'Mountain' }, { c: 'G', name: 'Forest' },
]

const BASIC_LANDS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes'])
function isBasic(e: DeckCardEntry) {
  return BASIC_LANDS.has(e.name.toLowerCase()) || (e.types ?? []).some((t) => t.toLowerCase() === 'basic')
}
function isLand(e: DeckCardEntry) {
  return (e.types ?? []).some((t) => t.toLowerCase() === 'land')
}

// Deck-building formats. A format only drives *guidance* (legality bar, copy
// limits, singleton, the side/command zone) — nothing is ever blocked.
type FormatId = 'constructed' | 'commander' | 'limited' | 'freeform'
interface DeckFormat {
  id: FormatId
  label: string
  minMain: number // legality target (0 = no minimum)
  copyLimit: number // max copies of a non-basic (99 ≈ unlimited)
  singleton: boolean // 1-of everything except basics
  hasCommander: boolean
  sideLabel: string // heading for the secondary zone
  sideMax: number // 0 = no cap shown
  blurb: string
}
const FORMATS: DeckFormat[] = [
  { id: 'constructed', label: 'Constructed', minMain: 60, copyLimit: 4, singleton: false, hasCommander: false, sideLabel: 'Sideboard', sideMax: 15, blurb: '60+ cards · max 4 copies · 15-card sideboard' },
  { id: 'commander', label: 'Commander', minMain: 100, copyLimit: 1, singleton: true, hasCommander: true, sideLabel: 'Command zone', sideMax: 2, blurb: '100 cards · singleton · a commander' },
  { id: 'limited', label: 'Limited / Cube', minMain: 40, copyLimit: 99, singleton: false, hasCommander: false, sideLabel: 'Sideboard', sideMax: 0, blurb: '40+ cards from a limited pool' },
  { id: 'freeform', label: 'Freeform', minMain: 0, copyLimit: 99, singleton: false, hasCommander: false, sideLabel: 'Sideboard', sideMax: 0, blurb: 'No deck-building restrictions' },
]
const FORMAT_BY_ID = Object.fromEntries(FORMATS.map((f) => [f.id, f])) as Record<FormatId, DeckFormat>

/** Max copies of this card allowed by the format (basics are always unlimited). */
function copyMax(e: DeckCardEntry, fmt: DeckFormat): number {
  if (isBasic(e)) return Infinity
  return fmt.singleton ? 1 : fmt.copyLimit
}
function overLimitFor(e: DeckCardEntry, fmt: DeckFormat): boolean {
  return e.count > copyMax(e, fmt)
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
  format?: FormatId
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

  // card currently being dragged from the results grid → deck (drag-and-drop add)
  const draggedCard = useRef<CardInfoDto | null>(null)
  const [dropActive, setDropActive] = useState(false)

  // restore an in-progress deck from a previous session so a refresh never
  // discards your work-in-progress deck
  const draft0 = useMemo(loadDraft, [])
  const [deck, setDeck] = useState<DeckCardEntry[]>(draft0?.deck ?? [])
  const [sideboard, setSideboard] = useState<DeckCardEntry[]>(draft0?.sideboard ?? [])
  const [deckName, setDeckName] = useState(draft0?.name ?? 'My Deck')
  const [format, setFormat] = useState<FormatId>(draft0?.format ?? 'constructed')
  const fmt = FORMAT_BY_ID[format]
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [confirmNew, setConfirmNew] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // maindeck shown as a text list or a grid of card images (persisted)
  const [deckView, setDeckView] = useState<'list' | 'visual'>(
    () => (localStorage.getItem('mage.deckListView') === 'visual' ? 'visual' : 'list'),
  )
  useEffect(() => {
    localStorage.setItem('mage.deckListView', deckView)
  }, [deckView])
  // hover a card (search result or deck entry) to float a preview bubble
  // beside the cursor — same idiom as the in-game hover bubble, so the
  // preview is always next to what you're pointing at, never scrolled away
  const [preview, setPreview] = useState<PreviewCard | null>(null)
  const [previewAnchor, setPreviewAnchor] = useState<{ x: number; y: number } | null>(null)
  const previewClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showPreview = useCallback((card: PreviewCard | null, at?: { x: number; y: number }) => {
    if (previewClearTimer.current) clearTimeout(previewClearTimer.current)
    if (card !== null) {
      setPreview(card)
      if (at) setPreviewAnchor(at)
    } else {
      previewClearTimer.current = setTimeout(() => {
        setPreview(null)
        setPreviewAnchor(null)
      }, 150)
    }
  }, [])

  // touch: a long-press opens the bubble and there is no mouseleave — the next
  // touch anywhere dismisses it (mouse keeps its enter/leave semantics)
  useEffect(() => {
    if (!preview) return
    const clear = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      setPreview(null)
      setPreviewAnchor(null)
    }
    document.addEventListener('pointerdown', clear, true)
    return () => document.removeEventListener('pointerdown', clear, true)
  }, [preview])

  const total = deck.reduce((s, e) => s + e.count, 0)
  const deckCount = useMemo(() => Object.fromEntries(deck.map((e) => [e.name, e.count])), [deck])
  const overLimitNames = useMemo(() => deck.filter((e) => overLimitFor(e, fmt)).map((e) => e.name), [deck, fmt])

  // persist the in-progress deck on every change
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ deck, sideboard, name: deckName, format }))
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [deck, sideboard, deckName, format])

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

  // playset=true (shift-click) tops the card up to a 4-of; otherwise adds one.
  // Both respect the format's copy cap (1 for singleton, exempting basics).
  const addCard = useCallback((card: CardInfoDto, playset = false) => {
    setDeck((prev) => {
      const ex = prev.find((e) => e.name === card.name)
      const entry: DeckCardEntry = ex ?? { name: card.name, count: 0, manaValue: card.manaValue, colors: card.colors, types: card.types, manaCost: card.manaCost }
      const cap = copyMax(entry, fmt)
      const count = playset ? Math.min(cap, Math.max(entry.count, 4)) : Math.min(cap, entry.count + 1)
      if (ex) return prev.map((e) => (e.name === card.name ? { ...e, count } : e))
      return [...prev, { ...entry, count }]
    })
  }, [fmt])

  const incName = useCallback((name: string) => {
    setDeck((prev) => prev.map((e) => (e.name === name ? { ...e, count: Math.min(copyMax(e, fmt), e.count + 1) } : e)))
  }, [fmt])
  const decName = useCallback((name: string) => {
    setDeck((prev) => prev.map((e) => (e.name === name ? { ...e, count: e.count - 1 } : e)).filter((e) => e.count > 0))
  }, [])

  // move one copy between the maindeck and the side/command zone
  const moveEntry = useCallback((name: string, from: 'deck' | 'side') => {
    const [src, setSrc, setDst] = from === 'deck' ? ([deck, setDeck, setSideboard] as const) : ([sideboard, setSideboard, setDeck] as const)
    const e = src.find((x) => x.name === name)
    if (!e) return
    setSrc((prev) => prev.map((x) => (x.name === name ? { ...x, count: x.count - 1 } : x)).filter((x) => x.count > 0))
    setDst((prev) => {
      const ex = prev.find((x) => x.name === name)
      return ex ? prev.map((x) => (x.name === name ? { ...x, count: x.count + 1 } : x)) : [...prev, { ...e, count: 1 }]
    })
  }, [deck, sideboard])

  const [pickerOpen, setPickerOpen] = useState(false)
  const [sampleOpen, setSampleOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  useEscapeClose(useCallback(() => setImportOpen(false), []))
  const [importText, setImportText] = useState('')
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [unresolved, setUnresolved] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // "/" jumps to the card search (unless already typing somewhere)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
  const doNewDeck = useCallback(() => {
    setDeck([])
    setSideboard([])
    setDeckName('My Deck')
    setUnresolved([])
    setSaveStatus(null)
  }, [])
  const onNewDeck = useCallback(() => {
    if (deck.length) setConfirmNew(true)
    else doNewDeck()
  }, [deck.length, doNewDeck])

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
      <DeckHoverBubble card={preview} anchor={previewAnchor} />
      <section className="panel deck-search">
        <div className="deck-search-bar">
          <input
            ref={searchRef}
            type="text"
            placeholder={'Search — name, t:creature, o:"draw a card", mv>=3, c:rg …  ( / )'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch()
              else if (e.key === 'Escape' && query) {
                e.preventDefault()
                setQuery('')
              }
            }}
          />
          <button
            className={`btn ghost deck-syntax-btn${helpOpen ? ' active' : ''}`}
            title="Search syntax"
            aria-label="Search syntax help"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((o) => !o)}
          >
            ?
          </button>
          <button className="btn primary" onClick={runSearch} disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
        {helpOpen && (
          <SearchSyntaxHelp
            onExample={(q) => {
              setQuery(q)
              setHelpOpen(false)
              searchRef.current?.focus()
            }}
          />
        )}
        <div className="deck-quick-chips" role="group" aria-label="Quick searches">
          {QUICK_SEARCHES.map((c) => (
            <button
              key={c.q}
              className={`deck-chip${query === c.q ? ' on' : ''}`}
              title={c.q}
              onClick={() => setQuery(c.q)}
            >
              {c.label}
            </button>
          ))}
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
                onDragCard={(c) => (draggedCard.current = c)}
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
                      onMouseEnter={(e) => showPreview(card, { x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => showPreview(null)}
                    >
                      <td className="deck-table-add">
                        <button className="btn ghost deck-mini-btn" aria-label={`Add ${card.name}`} title="Shift-click for a playset of 4" onClick={(e) => addCard(card, e.shiftKey)}>
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

      <section
        className={`panel deck-list${dropActive ? ' deck-drop-active' : ''}`}
        onDragOver={(e) => {
          if (!draggedCard.current) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!dropActive) setDropActive(true)
        }}
        onDragLeave={(e) => {
          // only clear when the pointer actually leaves the panel (not a child)
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActive(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDropActive(false)
          const c = draggedCard.current
          draggedCard.current = null
          if (c) addCard(c)
        }}
      >
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
          <span
            className={`chip deck-count-chip${fmt.minMain > 0 && total >= fmt.minMain ? ' ok' : ''}`}
            title={
              fmt.minMain > 0
                ? `${fmt.label}: ${total} of ${fmt.minMain} cards${total >= fmt.minMain ? ' — ready' : ` — ${fmt.minMain - total} to go`}`
                : `${total} cards`
            }
          >
            {fmt.minMain > 0 ? `${total} / ${fmt.minMain}` : `${total} cards`}
          </span>
        </div>
        {deck.length > 0 && fmt.minMain > 0 && (
          <div
            className={`deck-legality${total >= fmt.minMain ? ' ok' : ''}`}
            title={`${fmt.label} decks want at least ${fmt.minMain} cards`}
          >
            <div className="deck-legality-bar">
              <div className="deck-legality-fill" style={{ width: `${Math.min(100, (total / fmt.minMain) * 100)}%` }} />
            </div>
          </div>
        )}

        <div className="deck-format-row">
          <select
            id="deck-format"
            className="filter-select"
            value={format}
            onChange={(e) => setFormat(e.target.value as FormatId)}
            aria-label="Deck format"
            title={fmt.blurb}
          >
            {FORMATS.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          <span className="muted deck-format-blurb">{fmt.blurb}</span>
        </div>
        <div className="deck-toolbar">
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

        {overLimitNames.length > 0 && (
          <p
            className="deck-limit-warn"
            title={fmt.singleton ? 'Singleton: at most 1 of each non-basic card' : `At most ${fmt.copyLimit} copies of a card (basic lands are exempt)`}
          >
            ⚠ {fmt.singleton ? 'Singleton — extra copies of' : `Over the ${fmt.copyLimit}-copy limit:`} {overLimitNames.join(', ')}
          </p>
        )}

        {deck.length > 0 && <DeckStats stats={stats} />}

        <div className="deck-basics">
          <span className="muted" title="Add a basic land">Basics</span>
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
          <span className="spacer" />
          {deck.length > 0 && (
            <div className="view-switch deck-view-switch" role="group" aria-label="Deck view">
              <button
                className={`view-switch-btn${deckView === 'list' ? ' active' : ''}`}
                onClick={() => setDeckView('list')}
                aria-pressed={deckView === 'list'}
              >
                ☰ List
              </button>
              <button
                className={`view-switch-btn${deckView === 'visual' ? ' active' : ''}`}
                onClick={() => setDeckView('visual')}
                aria-pressed={deckView === 'visual'}
              >
                ▦ Visual
              </button>
            </div>
          )}
        </div>

        <div className="deck-list-body">
          {deck.length === 0 ? (
            <p className="empty">No cards yet. Click a card on the left, or Import / Open a deck.</p>
          ) : deckView === 'visual' ? (
            <div className="deck-visual">
              {groups.map((g) => (
                <div className="deck-visual-group" key={g.type}>
                  <div className="deck-group-title">
                    {TYPE_LABEL[g.type] ?? g.type} <span className="muted">{g.count}</span>
                  </div>
                  <div className="deck-visual-grid">
                    {g.entries.map((e) => (
                      <div
                        key={e.name}
                        className={`deck-visual-card${overLimitFor(e, fmt) ? ' over-limit' : ''}`}
                        onMouseEnter={(ev) => showPreview(e, { x: ev.clientX, y: ev.clientY })}
                        onMouseLeave={() => showPreview(null)}
                        title={`${e.count}× ${e.name}`}
                      >
                        <img
                          className="deck-visual-img"
                          loading="lazy"
                          src={`/api/cardimg?set=&num=&name=${encodeURIComponent(e.name)}`}
                          alt={e.name}
                          onError={(ev) => (ev.currentTarget.style.visibility = 'hidden')}
                        />
                        <span className="deck-visual-count">{e.count}×</span>
                        <div className="deck-visual-ctrl">
                          <button className="btn ghost deck-mini-btn" aria-label={`Decrease ${e.name}`} onClick={() => decName(e.name)}>
                            −
                          </button>
                          <button className="btn ghost deck-mini-btn" aria-label={`Increase ${e.name}`} onClick={() => incName(e.name)}>
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
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
                        className={`deck-entry${overLimitFor(e, fmt) ? ' over-limit' : ''}`}
                        onMouseEnter={(ev) => showPreview(e, { x: ev.clientX, y: ev.clientY })}
                        onMouseLeave={() => showPreview(null)}
                        onClick={(ev) => showPreview(e, { x: ev.clientX, y: ev.clientY })}
                      >
                        <span className="deck-entry-count">{e.count}×</span>
                        <span className="deck-entry-name">{e.name}</span>
                        {e.manaCost && <ManaCost cost={e.manaCost} className="deck-entry-cost" />}
                        <span className="deck-entry-actions">
                          <button className="btn ghost deck-mini-btn deck-move-btn" aria-label={`Move ${e.name} to ${fmt.sideLabel}`} title={`Move to ${fmt.sideLabel}`} onClick={() => moveEntry(e.name, 'deck')}>
                            ⇥
                          </button>
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
                {fmt.sideLabel} ({sideboard.reduce((s, e) => s + e.count, 0)}
                {fmt.sideMax ? ` / ${fmt.sideMax}` : ''})
              </div>
              <ul className="deck-entries">
                {sideboard.map((e) => (
                  <li key={e.name} className="deck-entry" onMouseEnter={(ev) => showPreview(e, { x: ev.clientX, y: ev.clientY })} onMouseLeave={() => showPreview(null)} onClick={(ev) => showPreview(e, { x: ev.clientX, y: ev.clientY })}>
                    <span className="deck-entry-count">{e.count}×</span>
                    <span className="deck-entry-name">{e.name}</span>
                    {e.manaCost && <ManaCost cost={e.manaCost} className="deck-entry-cost" />}
                    <span className="deck-entry-actions">
                      <button className="btn ghost deck-mini-btn deck-move-btn" aria-label={`Move ${e.name} to maindeck`} title="Move to maindeck" onClick={() => moveEntry(e.name, 'side')}>
                        ⇤
                      </button>
                    </span>
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
          <div className="deck-foot-row">
            <button className="btn ghost" onClick={onCopyList} disabled={deck.length === 0}>
              Copy decklist
            </button>
            <button className="btn ghost" aria-label="Download .txt" onClick={onDownloadTxt} disabled={deck.length === 0}>
              .txt
            </button>
            <button className="btn ghost" aria-label="Goldfish (playtest)" onClick={() => setSampleOpen(true)} disabled={deck.length === 0}>
              Goldfish
            </button>
          </div>
          {saveStatus && <p className="deck-save-status muted">{saveStatus}</p>}
          {unresolved.length > 0 && <p className="deck-error">Not found: {unresolved.join(', ')}</p>}
        </div>
      </section>

      {pickerOpen && (
        <DeckPicker title="Open a deck" onPick={(d) => doLoad(d.path)} onClose={() => setPickerOpen(false)} />
      )}

      {sampleOpen && <GoldfishModal deck={deck} onClose={() => setSampleOpen(false)} />}

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

      {confirmNew && (
        <ConfirmDialog
          title="Start a new deck?"
          message="This clears the current deck and its auto-saved draft."
          confirmLabel="New deck"
          danger
          onConfirm={() => {
            setConfirmNew(false)
            doNewDeck()
          }}
          onCancel={() => setConfirmNew(false)}
        />
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

interface GoldfishState {
  hand: DeckCardEntry[]
  library: DeckCardEntry[]
  turn: number
  mull: number
  pendingBottom: number // London: cards still owed to the bottom after a mulligan
}

/** Goldfish playtest: shuffle the deck, keep/mulligan an opening hand (London —
 *  bottom N after N mulligans), then draw through it turn by turn. */
function GoldfishModal({ deck, onClose }: { deck: DeckCardEntry[]; onClose: () => void }) {
  useEscapeClose(onClose)
  const pool = useMemo(() => deck.flatMap((e) => Array(e.count).fill(e) as DeckCardEntry[]), [deck])
  const deal = useCallback(
    (mulls: number): Pick<GoldfishState, 'hand' | 'library' | 'pendingBottom'> => {
      const s = shuffle(pool)
      return { hand: s.slice(0, 7), library: s.slice(7), pendingBottom: mulls }
    },
    [pool],
  )
  const [st, setSt] = useState<GoldfishState>(() => ({ ...deal(0), turn: 1, mull: 0 }))
  const { hand, library, turn, mull, pendingBottom } = st
  const busy = pendingBottom > 0

  const draw = () =>
    setSt((s) => (s.library.length ? { ...s, hand: [...s.hand, s.library[0]], library: s.library.slice(1) } : s))
  const nextTurn = () =>
    setSt((s) => ({
      ...s,
      turn: s.turn + 1,
      ...(s.library.length ? { hand: [...s.hand, s.library[0]], library: s.library.slice(1) } : {}),
    }))
  const mulligan = () => setSt((s) => ({ ...deal(s.mull + 1), turn: 1, mull: s.mull + 1 }))
  const newGame = () => setSt({ ...deal(0), turn: 1, mull: 0 })
  const bottomCard = (idx: number) =>
    setSt((s) =>
      s.pendingBottom <= 0
        ? s
        : {
            ...s,
            hand: s.hand.filter((_, i) => i !== idx),
            library: [...s.library, s.hand[idx]],
            pendingBottom: s.pendingBottom - 1,
          },
    )

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel goldfish-modal" role="dialog" aria-label="Goldfish playtest" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head goldfish-head">
          <h2 className="h1">Goldfish</h2>
          <span className="muted goldfish-meta">
            Turn {turn} · Library {library.length} · Hand {hand.length}
            {mull > 0 ? ` · Mulligan ${mull}` : ''}
          </span>
        </div>
        {busy && (
          <p className="goldfish-hint">
            Put {pendingBottom} card{pendingBottom > 1 ? 's' : ''} on the bottom — click a card to bottom it.
          </p>
        )}
        <div className={`goldfish-hand${busy ? ' bottoming' : ''}`}>
          {hand.map((c, i) => (
            <img
              key={`${c.name}-${i}`}
              className="sample-card"
              loading="lazy"
              src={`/api/cardimg?set=&num=&name=${encodeURIComponent(c.name)}`}
              alt={c.name}
              title={busy ? `Bottom ${c.name}` : c.name}
              onClick={busy ? () => bottomCard(i) : undefined}
              onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
            />
          ))}
        </div>
        <div className="modal-actions goldfish-actions">
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
          <span className="spacer" />
          <button className="btn ghost" onClick={mulligan} title="London mulligan">
            Mulligan
          </button>
          <button className="btn ghost" onClick={newGame}>
            New hand
          </button>
          <button className="btn ghost" onClick={draw} disabled={busy || library.length === 0}>
            Draw
          </button>
          <button className="btn primary" onClick={nextTurn} disabled={busy}>
            Next turn
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

type PreviewCard = { name: string; set?: string | null; num?: string | null; manaCost?: string | null; types?: string[] }
const PIP_COLOR: Record<string, string> = { W: '#e9e3c0', U: '#4a90e2', B: '#6b5b73', R: '#e0555f', G: '#3aa55f', C: '#9aa0ad' }

/** Popover documenting the search grammar; each row's example is click-to-run. */
function SearchSyntaxHelp({ onExample }: { onExample: (q: string) => void }) {
  return (
    <div className="deck-syntax-help panel" role="dialog" aria-label="Search syntax">
      <p className="deck-syntax-lead muted">
        Combine tokens freely — <code>t:creature c:rg mv&lt;=3</code>. Tap an example to try it.
      </p>
      <ul className="deck-syntax-list">
        {SYNTAX_ROWS.map((r) => (
          <li key={r.token} className="deck-syntax-row">
            <code className="deck-syntax-token">{r.token}</code>
            <span className="deck-syntax-desc muted">{r.desc}</span>
            <button className="deck-chip deck-syntax-eg" onClick={() => onExample(r.example)} title={`Search ${r.example}`}>
              {r.example}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A clickable card-art tile in the search grid: click the art to add a copy,
 *  shows a copies-in-deck badge + a remove button, and drives the hover preview. */
function CardTile({
  card,
  count,
  onAdd,
  onRemove,
  onHover,
  onDragCard,
}: {
  card: CardInfoDto
  count: number
  onAdd: (c: CardInfoDto, playset?: boolean) => void
  onRemove: (name: string) => void
  onHover: (c: PreviewCard | null, at?: { x: number; y: number }) => void
  onDragCard?: (c: CardInfoDto | null) => void
}) {
  const img = `/api/cardimg?set=${encodeURIComponent(card.set ?? '')}&num=${encodeURIComponent((card as { num?: string }).num ?? '')}&name=${encodeURIComponent(card.name)}`
  // touch: long-press previews (no hover on touch); a quick tap still adds
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  return (
    <div
      className={`card-tile${count > 0 ? ' in-deck' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', card.name)
        e.dataTransfer.effectAllowed = 'copy'
        onDragCard?.(card)
      }}
      onDragEnd={() => onDragCard?.(null)}
      onMouseEnter={(e) => onHover(card, { x: e.clientX, y: e.clientY })}
      onMouseLeave={() => onHover(null)}
    >
      <button
        className="card-tile-art"
        onPointerDown={(e) => {
          if (e.pointerType !== 'touch') return
          const at = { x: e.clientX, y: e.clientY }
          longPressed.current = false
          pressTimer.current = setTimeout(() => {
            longPressed.current = true
            onHover(card, at)
          }, 400)
        }}
        onPointerUp={() => {
          if (pressTimer.current) clearTimeout(pressTimer.current)
        }}
        aria-label={`Add ${card.name}`}
        title={`Add ${card.name} (shift-click for a playset of 4)`}
        onClick={(e) => {
          if (pressTimer.current) clearTimeout(pressTimer.current)
          if (longPressed.current) {
            longPressed.current = false // long-press previewed — don't also add
            return
          }
          onAdd(card, e.shiftKey)
        }}
      >
        <img src={img} alt={card.name} loading="lazy" onError={(e) => (e.currentTarget.style.opacity = '0')} />
        <span className="card-tile-fallback">{card.name}</span>
        {/* crisp DOM name so cards are readable even when the art's printed text isn't */}
        <span className="card-tile-caption">{card.name}</span>
      </button>
      {count > 0 && (
        <>
          <span className="card-tile-count" key={count} aria-label={`${count} in deck`}>{count}</span>
          <button className="card-tile-remove" aria-label={`Remove ${card.name}`} title={`Remove ${card.name}`} onClick={() => onRemove(card.name)}>
            −
          </button>
        </>
      )}
    </div>
  )
}

/** Floating card preview beside the cursor — the same idiom as the in-game
 *  hover bubble: position:fixed, prefers the side away from the viewport edge,
 *  clamped on-screen, pointer-events:none so it never steals the hover. It
 *  costs the deck column no height, and it's always next to the row you're on. */
function DeckHoverBubble({ card, anchor }: { card: PreviewCard | null; anchor: { x: number; y: number } | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [imgSrc, setImgSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!card) {
      setImgSrc(null)
      return
    }
    const apiUrl = `/api/cardimg?set=${encodeURIComponent(card.set ?? '')}&num=${encodeURIComponent(card.num ?? '')}&name=${encodeURIComponent(card.name)}`
    const cached = getCachedUrl(apiUrl)
    // only swap instantly when cached; otherwise keep the current image visible
    // until the new one loads, so hovering uncached cards doesn't blank-flash
    if (cached) setImgSrc(cached)
    let alive = true
    preloadImage(apiUrl).then((url) => {
      if (alive) setImgSrc(url)
    })
    return () => {
      alive = false
    }
  }, [card?.name, card?.set, card?.num])

  // measure AFTER render, then place: prefer the side of the cursor with room
  // (deck rows sit at the right edge, so this usually flips left over the
  // search panel), clamp vertically. A ResizeObserver re-places when the image
  // loads and changes the bubble's size.
  useLayoutEffect(() => {
    const el = ref.current
    if (!card || !anchor || !el) {
      setPos(null)
      return
    }
    const place = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      const GAP = 24
      const M = 8
      let left = anchor.x + GAP
      if (left + w > vw - M) left = anchor.x - GAP - w
      left = Math.max(M, Math.min(left, vw - w - M))
      const top = Math.max(M, Math.min(anchor.y - h / 2, vh - h - M))
      setPos({ left, top })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [card, anchor])

  if (!card || !anchor) return null
  const cost = (card.manaCost?.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1))
  return (
    <div
      ref={ref}
      className="card-hover-bubble"
      role="dialog"
      aria-label={`Card: ${card.name}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {imgSrc && (
        <img key={imgSrc} className="card-preview-img" src={imgSrc} alt={card.name} onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
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
            <div className="curve-bar" style={{ height: n ? `${(n / maxCurve) * 26 + 2}px` : '0' }} />
            <div className="curve-label">{i === 7 ? '7+' : i}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
