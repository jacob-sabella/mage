import { draftPick } from '../api'
import type { DraftCard, DraftState } from '../types'

function imgUrl(c: DraftCard) {
  return `/api/cardimg?set=${encodeURIComponent(c.set)}&num=${encodeURIComponent(c.num)}&name=${encodeURIComponent(c.name)}`
}

/** Booster-draft picker: shows the current pack as a grid of cards; click one to
 *  pick it, the next pack arrives over the WebSocket. */
export function DraftView({
  token,
  draftId,
  draft,
  onLeave,
}: {
  token: string
  draftId: string
  draft: DraftState | null
  onLeave: () => void
}) {
  const pick = (cardId: string) => draftPick(token, draftId, cardId).catch(() => {})
  const booster = draft?.booster ?? []
  const picks = draft?.picks ?? []
  return (
    <div className="draft-view">
      <div className="draft-head">
        <button className="btn ghost" onClick={onLeave}>
          ← Leave draft
        </button>
        <h1 className="h1">Booster Draft</h1>
        <span className="chip">{picks.length} picked</span>
      </div>

      <div className="draft-booster">
        {booster.length === 0 ? (
          <p className="muted draft-waiting">Waiting for the next pack…</p>
        ) : (
          booster.map((c) => (
            <button key={c.id} className="draft-card" onClick={() => pick(c.id)} title={c.name}>
              <img
                className="draft-card-img"
                src={imgUrl(c)}
                alt={c.name}
                onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
              />
              <span className="draft-card-name">{c.name}</span>
            </button>
          ))
        )}
      </div>

      {picks.length > 0 && (
        <div className="draft-picks panel">
          <div className="stack-title">Your picks ({picks.length})</div>
          <div className="draft-picks-row">
            {picks.map((c) => (
              <span key={c.id} className="draft-pick-chip">
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
