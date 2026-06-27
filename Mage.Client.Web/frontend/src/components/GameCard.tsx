import { motion } from 'framer-motion'
import { usePrefs } from '../prefs'
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
  const { prefs } = usePrefs()
  const isCreature = card.types?.includes('Creature')
  const isPlaneswalker = card.types?.includes('Planeswalker')
  const clickable = !!onClick

  return (
    <motion.div
      // shared-element id: when this card moves between zones, it flies there
      layout
      layoutId={card.id}
      initial={{ opacity: 0, scale: 0.7, y: 14 }}
      animate={{ opacity: 1, scale: 1, y: 0, rotate: card.tapped ? 9 : 0 }}
      exit={{ opacity: 0, scale: 0.7, y: -10 }}
      whileHover={clickable ? { y: -8, scale: 1.06, zIndex: 5 } : { y: -3 }}
      whileTap={clickable ? { scale: 0.97 } : undefined}
      transition={{ type: 'spring', stiffness: 320, damping: 26, mass: 0.6 }}
      className={
        `game-card${card.tapped ? ' tapped' : ''}` +
        (highlight ? ` hl-${highlight}` : '') +
        (clickable ? ' clickable' : '')
      }
      style={{ background: background(card.colors) }}
      title={`${card.name}${card.manaCost ? '  ' + card.manaCost : ''}`}
      onClick={clickable ? () => onClick!(card) : undefined}
    >
      {prefs.cardImages && card.name && (
        <img
          className="gc-art"
          loading="lazy"
          src={`/api/cardimg?set=${encodeURIComponent(card.set ?? '')}&num=${encodeURIComponent(
            card.num ?? '',
          )}&name=${encodeURIComponent(card.name)}`}
          alt=""
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          }}
        />
      )}
      <div className="gc-sheen" />
      <div className="gc-name">{card.name}</div>
      <div className="gc-type">{card.types?.join(' ')}</div>
      {isCreature && (
        <div className="gc-pt">
          {card.power}/{card.toughness}
          {card.damage > 0 && <span className="gc-dmg"> −{card.damage}</span>}
        </div>
      )}
      {isPlaneswalker && card.loyalty != null && <div className="gc-pt">◆ {card.loyalty}</div>}
    </motion.div>
  )
}
