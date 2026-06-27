import { usePrefs } from '../prefs'

/** Map a single mana token (the bit inside {…}) to a mana-font class suffix. */
function symClass(tok: string): string {
  const t = tok.trim()
  if (t === 'T') return 'tap'
  if (t === 'Q') return 'untap'
  if (t === '½') return 'half'
  if (t === '∞') return 'infinity'
  return t.toLowerCase().replace(/\//g, '') // {W/U} -> wu, {2/W} -> 2w, {W/P} -> wp
}

/** Render an MTG mana cost ("{3}{B}{B}") as symbols (mana-font) or, when the
 *  user prefers, the raw text. */
export function ManaCost({ cost, className }: { cost?: string | null; className?: string }) {
  const { prefs } = usePrefs()
  if (!cost) return null
  const toks = cost.match(/\{([^}]+)\}/g)?.map((s) => s.slice(1, -1)) ?? []
  if (toks.length === 0 || !prefs.manaIcons) {
    return <span className={`mana-text ${className ?? ''}`}>{cost}</span>
  }
  return (
    <span className={`mana-icons ${className ?? ''}`}>
      {toks.map((t, i) => (
        <i key={i} className={`ms ms-cost ms-shadow ms-${symClass(t)}`} title={`{${t}}`} aria-label={`{${t}}`} />
      ))}
    </span>
  )
}
