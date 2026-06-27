import type { GameCard as CardType } from '../types'

// Tint a card by its WUBRG color string.
const COLOR_BG: Record<string, string> = {
  W: '#3a3a30',
  U: '#1e2c40',
  B: '#2a2630',
  R: '#3a2424',
  G: '#1f3024',
}

function background(colors?: string | null): string {
  if (!colors) return '#2b2f3a' // colorless / artifact
  if (colors.length > 1) return '#3a3320' // multicolor (gold)
  return COLOR_BG[colors] ?? '#2b2f3a'
}

interface Props {
  card: CardType
  highlight?: 'play' | 'target'
  onClick?: (card: CardType) => void
}

export function GameCard({ card, highlight, onClick }: Props) {
  const isCreature = card.types?.includes('Creature')
  const isPlaneswalker = card.types?.includes('Planeswalker')
  const clickable = !!onClick

  return (
    <div
      className={
        `game-card${card.tapped ? ' tapped' : ''}` +
        (highlight ? ` hl-${highlight}` : '') +
        (clickable ? ' clickable' : '')
      }
      style={{ background: background(card.colors) }}
      title={`${card.name}${card.manaCost ? '  ' + card.manaCost : ''}`}
      onClick={clickable ? () => onClick!(card) : undefined}
    >
      <div className="gc-name">{card.name}</div>
      <div className="gc-type">{card.types?.join(' ')}</div>
      {isCreature && (
        <div className="gc-pt">
          {card.power}/{card.toughness}
          {card.damage > 0 && <span className="gc-dmg"> −{card.damage}</span>}
        </div>
      )}
      {isPlaneswalker && card.loyalty != null && <div className="gc-pt">◆ {card.loyalty}</div>}
    </div>
  )
}
