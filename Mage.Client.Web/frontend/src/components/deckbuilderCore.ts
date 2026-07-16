// Pure state + math for the Stackline deck builder. No React, no DOM — every
// mutation is an action through applyAction so undo/redo and the tally-bar
// action labels fall out of one code path.
import type { CardInfoDto, DeckCardEntry } from '../types'

export type BoardId = 'main' | 'side' | 'maybe'
export type FormatId = 'constructed' | 'commander' | 'limited' | 'freeform'

export interface BuilderFormat {
  id: FormatId
  label: string
  minMain: number // 0 = no target
  copyLimit: number // per non-basic card; 99 ≈ unlimited
  singleton: boolean
  hasCommander: boolean
  sideLabel: string
  sideMax: number // 0 = uncapped
  suggestedLands: number
  // ghost curve target (counts per MV column 0..7+) at minMain scale
  curveTarget: number[]
}

export const FORMATS: BuilderFormat[] = [
  { id: 'constructed', label: 'Constructed', minMain: 60, copyLimit: 4, singleton: false, hasCommander: false, sideLabel: 'Sideboard', sideMax: 15, suggestedLands: 24, curveTarget: [0, 8, 11, 9, 5, 2, 1, 0] },
  { id: 'commander', label: 'Commander', minMain: 100, copyLimit: 1, singleton: true, hasCommander: true, sideLabel: 'Command zone', sideMax: 2, suggestedLands: 37, curveTarget: [0, 6, 11, 13, 11, 9, 7, 6] },
  { id: 'limited', label: 'Limited / Cube', minMain: 40, copyLimit: 99, singleton: false, hasCommander: false, sideLabel: 'Sideboard', sideMax: 0, suggestedLands: 17, curveTarget: [0, 4, 7, 6, 4, 2, 0, 0] },
  { id: 'freeform', label: 'Freeform', minMain: 0, copyLimit: 99, singleton: false, hasCommander: false, sideLabel: 'Sideboard', sideMax: 0, suggestedLands: 24, curveTarget: [] },
]
export const FORMAT_BY_ID = Object.fromEntries(FORMATS.map((f) => [f.id, f])) as Record<FormatId, BuilderFormat>

export const BASIC_LANDS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const
export const BASIC_BY_COLOR: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }
// Basic-land names, including Snow-Covered variants and Wastes. The server
// serializes only card *types* (LAND, …), never the "Basic" supertype, so the
// name check is the reliable signal — match snow basics by name too.
const BASIC_SET = new Set([
  ...BASIC_LANDS.map((b) => b.toLowerCase()),
  ...BASIC_LANDS.map((b) => `snow-covered ${b.toLowerCase()}`),
  'wastes',
])

export function isBasic(e: { name: string; types?: string[] }): boolean {
  return BASIC_SET.has(e.name.toLowerCase()) || (e.types ?? []).some((t) => t.toLowerCase() === 'basic')
}
export function isLand(e: { types?: string[] }): boolean {
  return (e.types ?? []).some((t) => t.toLowerCase() === 'land')
}
export function copyCap(e: DeckCardEntry, fmt: BuilderFormat): number {
  if (isBasic(e)) return 99
  return fmt.singleton ? 1 : fmt.copyLimit
}

export const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land'] as const
export const TYPE_PLURAL: Record<string, string> = {
  Creature: 'Creatures', Planeswalker: 'Planeswalkers', Instant: 'Instants', Sorcery: 'Sorceries',
  Artifact: 'Artifacts', Enchantment: 'Enchantments', Battle: 'Battles', Land: 'Lands', Other: 'Other',
}
export function primaryType(e: { types?: string[] }): string {
  return TYPE_ORDER.find((t) => (e.types ?? []).some((x) => x.toLowerCase() === t.toLowerCase())) ?? 'Other'
}

// ---------- state ----------

export interface BuilderState {
  name: string
  format: FormatId
  boards: Record<BoardId, DeckCardEntry[]>
  commander: DeckCardEntry | null
}

export const EMPTY_STATE: BuilderState = {
  name: 'Untitled deck',
  format: 'constructed',
  boards: { main: [], side: [], maybe: [] },
  commander: null,
}

export function entryFromCard(c: CardInfoDto | DeckCardEntry): DeckCardEntry {
  return {
    name: c.name,
    count: 'count' in c ? c.count : 0,
    manaValue: c.manaValue,
    colors: c.colors ?? null,
    types: c.types ?? [],
    manaCost: c.manaCost ?? null,
  }
}

export type BuilderAction =
  | { kind: 'add'; card: DeckCardEntry; board: BoardId; delta: number } // delta may over-ask; clamped to cap
  | { kind: 'playset'; card: DeckCardEntry; board: BoardId }
  | { kind: 'setCount'; name: string; board: BoardId; count: number }
  | { kind: 'move'; name: string; from: BoardId; to: BoardId; all: boolean }
  | { kind: 'removeAll'; name: string; board: BoardId }
  | { kind: 'setCommander'; card: DeckCardEntry | null }
  | { kind: 'setFormat'; format: FormatId }
  | { kind: 'rename'; name: string }
  | { kind: 'replace'; state: BuilderState; label: string } // import / open / new
  | { kind: 'setBasics'; counts: Record<string, number> } // absolute counts per basic name, main board

function upsert(list: DeckCardEntry[], card: DeckCardEntry, count: number): DeckCardEntry[] {
  const ex = list.find((e) => e.name === card.name)
  if (count <= 0) return ex ? list.filter((e) => e.name !== card.name) : list
  if (ex) return ex.count === count ? list : list.map((e) => (e.name === card.name ? { ...e, count } : e))
  return [...list, { ...card, count }]
}
const countOf = (list: DeckCardEntry[], name: string) => list.find((e) => e.name === name)?.count ?? 0

export function applyAction(s: BuilderState, a: BuilderAction): BuilderState {
  const fmt = FORMAT_BY_ID[s.format]
  switch (a.kind) {
    case 'add': {
      const cur = countOf(s.boards[a.board], a.card.name)
      const next = Math.max(0, Math.min(copyCap(a.card, fmt), cur + a.delta))
      if (next === cur) return s
      return { ...s, boards: { ...s.boards, [a.board]: upsert(s.boards[a.board], entryFromCard(a.card), next) } }
    }
    case 'playset': {
      const cap = copyCap(a.card, fmt)
      const target = Math.min(cap, fmt.singleton ? 1 : 4)
      const cur = countOf(s.boards[a.board], a.card.name)
      if (cur >= target) return s
      return { ...s, boards: { ...s.boards, [a.board]: upsert(s.boards[a.board], entryFromCard(a.card), target) } }
    }
    case 'setCount': {
      const ex = s.boards[a.board].find((e) => e.name === a.name)
      if (!ex) return s
      const next = Math.max(0, Math.min(copyCap(ex, fmt), a.count))
      if (next === ex.count) return s
      return { ...s, boards: { ...s.boards, [a.board]: upsert(s.boards[a.board], ex, next) } }
    }
    case 'move': {
      const ex = s.boards[a.from].find((e) => e.name === a.name)
      if (!ex) return s
      const n = a.all ? ex.count : 1
      const dstCur = countOf(s.boards[a.to], a.name)
      const dstNext = Math.min(copyCap(ex, fmt), dstCur + n)
      const moved = dstNext - dstCur
      if (moved <= 0) return s
      return {
        ...s,
        boards: {
          ...s.boards,
          [a.from]: upsert(s.boards[a.from], ex, ex.count - moved),
          [a.to]: upsert(s.boards[a.to], ex, dstNext),
        },
      }
    }
    case 'removeAll': {
      if (!s.boards[a.board].some((e) => e.name === a.name)) return s
      return { ...s, boards: { ...s.boards, [a.board]: s.boards[a.board].filter((e) => e.name !== a.name) } }
    }
    case 'setCommander': {
      // the commander lives in its own zone: setting it returns the previous
      // commander to the maindeck, then pulls one copy of the new card out of
      // whichever board holds it (main → side → maybe) so no copy is lost
      let boards = s.boards
      if (s.commander) {
        const back = Math.min(copyCap(s.commander, fmt), countOf(boards.main, s.commander.name) + 1)
        boards = { ...boards, main: upsert(boards.main, s.commander, back) }
      }
      if (a.card === null) {
        if (!s.commander) return s
        return { ...s, commander: null, boards }
      }
      for (const b of ['main', 'side', 'maybe'] as BoardId[]) {
        const inB = boards[b].find((e) => e.name === a.card!.name)
        if (inB) {
          boards = { ...boards, [b]: upsert(boards[b], inB, inB.count - 1) }
          break
        }
      }
      return { ...s, commander: { ...entryFromCard(a.card), count: 1 }, boards }
    }
    case 'setFormat': {
      if (a.format === s.format) return s
      // leaving a commander format: return the commander to the maindeck so it
      // is neither invisible nor silently counted/saved
      if (s.commander && !FORMAT_BY_ID[a.format].hasCommander) {
        const back = countOf(s.boards.main, s.commander.name) + 1
        return { ...s, format: a.format, commander: null, boards: { ...s.boards, main: upsert(s.boards.main, s.commander, back) } }
      }
      return { ...s, format: a.format }
    }
    case 'rename':
      return a.name === s.name ? s : { ...s, name: a.name }
    case 'replace':
      return a.state
    case 'setBasics': {
      let main = s.boards.main
      for (const basic of BASIC_LANDS) {
        if (!(basic in a.counts)) continue
        const card: DeckCardEntry = { name: basic, count: 0, manaValue: 0, colors: '', types: ['Basic', 'Land'], manaCost: '' }
        main = upsert(main, card, Math.max(0, a.counts[basic]))
      }
      if (main === s.boards.main) return s
      return { ...s, boards: { ...s.boards, main } }
    }
  }
}

export function describeAction(a: BuilderAction): string {
  switch (a.kind) {
    case 'add': return `${a.delta > 0 ? '+' : ''}${a.delta} ${a.card.name}`
    case 'playset': return `playset ${a.card.name}`
    case 'setCount': return `${a.name} → ×${a.count}`
    case 'move': return `${a.name} → ${a.to}`
    case 'removeAll': return `cut ${a.name}`
    case 'setCommander': return a.card ? `commander: ${a.card.name}` : 'commander removed'
    case 'setFormat': return `format: ${a.format}`
    case 'rename': return 'renamed'
    case 'replace': return a.label
    case 'setBasics': return 'basics updated'
  }
}

// ---------- stats ----------

export const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const
export const MANA_HEX: Record<string, string> = {
  W: '#f8f6d8', U: '#179fd8', B: '#a69f9d', R: '#e4553b', G: '#26714a', C: '#8e86a3',
}

export interface BuilderStats {
  total: number
  lands: number
  spells: number
  avgMv: number
  curve: number[] // 0..7+
  colorCounts: Record<string, number> // card color identity counts (nonland)
  demand: Record<string, number> // colored pips in casting costs
  sources: Record<string, number> // lands producing each color (heuristic)
  sourcesTotal: number
  types: Record<string, number>
}

const zeroWUBRGC = (): Record<string, number> => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })

export function pipsOf(manaCost?: string | null): string[] {
  return (manaCost?.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1))
}

export function computeStats(main: DeckCardEntry[], commander: DeckCardEntry | null): BuilderStats {
  const all = commander ? [...main, commander] : main
  const curve = Array(8).fill(0) as number[]
  const colorCounts = zeroWUBRGC()
  const demand = zeroWUBRGC()
  const sources = zeroWUBRGC()
  const types: Record<string, number> = {}
  let lands = 0
  let spells = 0
  let mvSum = 0
  let sourcesTotal = 0
  for (const e of all) {
    types[primaryType(e)] = (types[primaryType(e)] ?? 0) + e.count
    if (isLand(e)) {
      lands += e.count
      // heuristic mana production: basics by name, otherwise the card's color
      // string; colorless/unknown lands count toward C
      const basicColor = Object.entries(BASIC_BY_COLOR).find(([, n]) => n === e.name)?.[0]
      const produced = basicColor ? [basicColor] : (e.colors ? [...e.colors] : ['C'])
      for (const c of produced) sources[c in sources ? c : 'C'] += e.count
      sourcesTotal += e.count
      continue
    }
    spells += e.count
    mvSum += (e.manaValue ?? 0) * e.count
    curve[Math.min(Math.max(0, Math.round(e.manaValue ?? 0)), 7)] += e.count
    const cs = e.colors ?? ''
    if (cs) for (const c of cs) colorCounts[c in colorCounts ? c : 'C'] += e.count
    else colorCounts.C += e.count
    for (const pip of pipsOf(e.manaCost)) {
      // {W}, {2/W}, {W/P}, {W/U}: count every colored letter once
      for (const ch of pip) if (ch in demand && ch !== 'C') demand[ch] += e.count
      if (pip === 'C') demand.C += e.count
    }
  }
  return {
    total: all.reduce((n, e) => n + e.count, 0),
    lands, spells,
    avgMv: spells ? mvSum / spells : 0,
    curve, colorCounts, demand, sources, sourcesTotal, types,
  }
}

// ---------- format guidance (never blocking) ----------

export interface FormatIssue {
  kind: 'ok' | 'warn'
  text: string
  cards?: string[] // offender names, for click-to-focus
}

export function checkFormat(s: BuilderState, _stats: BuilderStats): FormatIssue[] {
  const fmt = FORMAT_BY_ID[s.format]
  const out: FormatIssue[] = []
  const mainTotal = s.boards.main.reduce((n, e) => n + e.count, 0) + (s.commander ? 1 : 0)
  if (fmt.minMain > 0) {
    out.push(
      mainTotal >= fmt.minMain
        ? { kind: 'ok', text: `${mainTotal} / ${fmt.minMain} cards` }
        : { kind: 'warn', text: `${mainTotal} / ${fmt.minMain} — ${fmt.minMain - mainTotal} to go` },
    )
  } else {
    out.push({ kind: 'ok', text: `${mainTotal} cards` })
  }
  const over = s.boards.main.filter((e) => e.count > copyCap(e, fmt)).map((e) => e.name)
  if (over.length) out.push({ kind: 'warn', text: fmt.singleton ? `not singleton: ${over.length}` : `over ${fmt.copyLimit} copies: ${over.length}`, cards: over })
  if (fmt.sideMax > 0) {
    const side = s.boards.side.reduce((n, e) => n + e.count, 0)
    if (side > fmt.sideMax) out.push({ kind: 'warn', text: `${fmt.sideLabel} ${side} / ${fmt.sideMax}`, cards: s.boards.side.map((e) => e.name) })
  }
  if (fmt.hasCommander) {
    if (!s.commander) out.push({ kind: 'warn', text: 'no commander set — press C on a legendary creature' })
    else {
      const identity = new Set([...(s.commander.colors ?? '')])
      const off = s.boards.main.filter((e) => [...(e.colors ?? '')].some((c) => !identity.has(c))).map((e) => e.name)
      if (off.length) out.push({ kind: 'warn', text: `off-identity: ${off.length}`, cards: off })
    }
  }
  return out
}

/** Suggested basic-land split: format's land count minus existing nonbasic
 *  lands, split across colors proportional to pip demand. */
export function suggestBasics(s: BuilderState, stats: BuilderStats): Record<string, number> {
  const fmt = FORMAT_BY_ID[s.format]
  const nonBasicLands = s.boards.main.filter((e) => isLand(e) && !isBasic(e)).reduce((n, e) => n + e.count, 0)
  const want = Math.max(0, fmt.suggestedLands - nonBasicLands)
  const totalDemand = WUBRG.reduce((n, c) => n + stats.demand[c], 0)
  const out: Record<string, number> = {}
  if (totalDemand === 0) {
    for (const b of BASIC_LANDS) out[b] = 0
    out.Plains = want // arbitrary but visible; the user edits from here
    return out
  }
  let assigned = 0
  const shares = WUBRG.map((c) => ({ c, exact: (stats.demand[c] / totalDemand) * want }))
  for (const sh of shares) {
    const n = Math.floor(sh.exact)
    out[BASIC_BY_COLOR[sh.c]] = n
    assigned += n
  }
  // hand out remainders to the largest fractional parts
  const rest = shares
    .map((sh) => ({ ...sh, frac: sh.exact - Math.floor(sh.exact) }))
    .sort((a, b) => b.frac - a.frac)
  for (let i = 0; i < want - assigned; i++) out[BASIC_BY_COLOR[rest[i % rest.length].c]] += 1
  return out
}

/** Ghost curve target scaled to the format's spell count. */
export function ghostCurve(format: FormatId): number[] {
  return FORMAT_BY_ID[format].curveTarget
}

// ---------- import/export ----------

export function decklistText(s: BuilderState): string {
  const lines = (list: DeckCardEntry[]) => list.map((e) => `${e.count} ${e.name}`).join('\n')
  // Keep the commander in the maindeck block (no blank line before it) so a
  // text importer that splits sideboard at the FIRST blank line doesn't file
  // the commander — and any real sideboard — into the wrong zone.
  const main = [lines(s.boards.main), s.commander ? `1 ${s.commander.name}` : ''].filter(Boolean).join('\n')
  let text = main
  if (s.boards.side.length) text += `\n\n${lines(s.boards.side)}`
  return text
}
