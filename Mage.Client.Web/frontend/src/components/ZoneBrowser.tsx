import type { ReactNode } from 'react'
import { useEscapeClose } from '../useEscapeClose'
import type { GameCard } from '../types'

/**
 * One overlay reused for every "look at a pile of cards" surface:
 *   • zone browsers (graveyard / exile / command — opened from the strip or the
 *     3D piles),
 *   • the target-candidate picker (delve/flashback/tutor picks that aren't on
 *     the battlefield),
 *   • the revealed / looked-at panel (read-only).
 *
 * Cards render as a deck-editor-style tile grid; hover drives the existing big
 * card preview; a card only reacts to clicks when `cardAction` returns a
 * handler for it (candidate / playable). Esc and ✕ close.
 */
export function ZoneBrowser({
  title,
  sections,
  onClose,
  onHoverCard,
  cardAction,
  picked,
  footer,
}: {
  title: string
  sections: { name?: string; cards: GameCard[] }[]
  onClose: () => void
  onHoverCard?: (c: GameCard | null) => void
  // returns a click handler when the card is actionable (in prompt candidates /
  // playable), undefined for a read-only card
  cardAction?: (c: GameCard) => (() => void) | undefined
  // ids already chosen in a multi-pick (marked in the grid)
  picked?: string[]
  footer?: ReactNode
}) {
  useEscapeClose(onClose)
  return (
    <div className="zone-browser-backdrop" onClick={onClose}>
      <div className="zone-browser panel" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="zb-head">
          <span className="zb-title">{title}</span>
          <button className="btn ghost zb-close" onClick={onClose} aria-label="Close" title="Close">
            ✕
          </button>
        </div>
        <div className="zb-body">
          {sections.map((s, si) => (
            <div key={si} className="zb-section">
              {s.name && (
                <div className="zb-section-title">
                  {s.name} ({s.cards.length})
                </div>
              )}
              {s.cards.length === 0 ? (
                <div className="muted zb-empty">Empty</div>
              ) : (
                <div className="zb-grid">
                  {s.cards.map((c) => (
                    <ZoneCardTile
                      key={c.id}
                      card={c}
                      action={cardAction?.(c)}
                      picked={!!picked?.includes(c.id)}
                      onHoverCard={onHoverCard}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        {footer}
      </div>
    </div>
  )
}

function ZoneCardTile({
  card,
  action,
  picked,
  onHoverCard,
}: {
  card: GameCard
  action?: () => void
  picked: boolean
  onHoverCard?: (c: GameCard | null) => void
}) {
  // lookedAt entries may arrive with NO name — only id/set/num (SimpleCardView
  // upstream); the set/num image lookup still resolves the face
  const label = card.name || [card.set, card.num].filter(Boolean).join(' ') || 'Unknown card'
  const img = `/api/cardimg?set=${encodeURIComponent(card.set ?? '')}&num=${encodeURIComponent(
    card.num ?? '',
  )}&name=${encodeURIComponent(card.name ?? '')}`
  const rules = card.rules ?? []
  return (
    <div className={`card-tile zb-card${action ? ' zb-actionable' : ''}${picked ? ' zb-picked' : ''}`}>
      <button
        type="button"
        className="card-tile-art"
        aria-label={action ? `Choose ${label}` : label}
        onClick={action}
        onMouseEnter={() => onHoverCard?.(card)}
        onMouseLeave={() => onHoverCard?.(null)}
        onFocus={() => onHoverCard?.(card)}
        onBlur={() => onHoverCard?.(null)}
      >
        {/* emblems / planes / dungeons have no card face — a text card from rules[] */}
        {rules.length > 0 ? (
          <span className="zb-text-card">
            <span className="zb-text-card-name">{label}</span>
            {rules.map((r, i) => (
              <span key={i} className="zb-text-card-rule">
                {r}
              </span>
            ))}
          </span>
        ) : (
          <>
            <span className="card-tile-fallback">{label}</span>
            <img src={img} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
          </>
        )}
        {picked && <span className="zb-picked-tag">✓</span>}
      </button>
      <span className="zb-card-name" title={label}>
        {label}
      </span>
    </div>
  )
}
