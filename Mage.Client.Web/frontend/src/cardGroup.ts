import type { GameCard } from './types'

// How a pile of cards can be organised into sections. `castable` needs a
// per-card playability predicate (only meaningful for your hand), so zone
// browsers use ZONE_GROUPS (no castable) and the hand uses HAND_GROUPS.
export type GroupBy = 'type' | 'color' | 'mana' | 'castable'

export const GROUP_LABEL: Record<GroupBy, string> = {
  type: 'Type',
  color: 'Color',
  mana: 'Mana value',
  castable: 'Castable',
}
export const HAND_GROUPS: GroupBy[] = ['type', 'color', 'mana', 'castable']
export const ZONE_GROUPS: GroupBy[] = ['type', 'color', 'mana']

/** Converted mana cost from a `{2}{U}{U}`-style string (X counts as 0). */
export function manaValue(cost?: string | null): number {
  let mv = 0
  for (const m of cost?.match(/\{([^}]+)\}/g) ?? []) {
    const s = m.slice(1, -1)
    if (/^\d+$/.test(s)) mv += parseInt(s, 10)
    else if (/^[XYZ]$/.test(s)) mv += 0
    else mv += 1 // a coloured, hybrid or phyrexian pip
  }
  return mv
}

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Battle', 'Land']
function typeGroup(types: string[]): string {
  const lc = types.map((t) => t.toLowerCase())
  for (const t of TYPE_ORDER) if (lc.includes(t.toLowerCase())) return t
  return 'Other'
}

const COLOR_NAME: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }
function colorGroup(colors?: string | null): string {
  const c = (colors ?? '').replace(/[^WUBRG]/gi, '').toUpperCase()
  if (!c) return 'Colorless'
  if (new Set(c).size > 1) return 'Multicolor'
  return COLOR_NAME[c[0]] ?? 'Colorless'
}

// section display order per grouping — keeps buckets in a sensible, stable order
const SECTION_ORDER: Record<GroupBy, string[]> = {
  type: [...TYPE_ORDER, 'Other'],
  color: ['White', 'Blue', 'Black', 'Red', 'Green', 'Multicolor', 'Colorless'],
  mana: [], // numeric — sorted ascending below
  castable: ['Playable now', 'Not playable'],
}

/** Bucket cards into ordered { key, cards } sections for the chosen attribute.
 *  `isPlayable` is only consulted for the 'castable' grouping. */
export function groupCards(
  cards: GameCard[],
  by: GroupBy,
  isPlayable?: (c: GameCard) => boolean,
): { key: string; cards: GameCard[] }[] {
  const keyOf = (c: GameCard): string =>
    by === 'type'
      ? typeGroup(c.types ?? [])
      : by === 'color'
        ? colorGroup(c.colors)
        : by === 'mana'
          ? String(manaValue(c.manaCost))
          : isPlayable?.(c)
            ? 'Playable now'
            : 'Not playable'
  const buckets = new Map<string, GameCard[]>()
  for (const c of cards) {
    const k = keyOf(c)
    ;(buckets.get(k) ?? buckets.set(k, []).get(k)!).push(c)
  }
  const order = SECTION_ORDER[by]
  const keys = [...buckets.keys()].sort((a, b) => {
    if (by === 'mana') return Number(a) - Number(b)
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
  })
  for (const list of buckets.values()) {
    list.sort((a, b) => manaValue(a.manaCost) - manaValue(b.manaCost) || a.name.localeCompare(b.name))
  }
  return keys.map((k) => ({ key: by === 'mana' ? `Mana ${k}` : k, cards: buckets.get(k)! }))
}
