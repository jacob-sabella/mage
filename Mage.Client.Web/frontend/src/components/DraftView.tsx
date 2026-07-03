import { useEffect, useState } from 'react'
import { draftPick } from '../api'
import type { DraftCard, DraftState } from '../types'

function imgUrl(c: DraftCard) {
  return `/api/cardimg?set=${encodeURIComponent(c.set)}&num=${encodeURIComponent(c.num)}&name=${encodeURIComponent(c.name)}`
}

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

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

  // pick timer: restarts from draft.timeout on every draftPick frame and ticks
  // down locally (the server enforces the real deadline / auto-picks)
  const [secondsLeft, setSecondsLeft] = useState(0)
  useEffect(() => {
    const t0 = draft?.timeout ?? 0
    setSecondsLeft(t0)
    if (t0 <= 0) return
    const t = setInterval(() => setSecondsLeft((s) => (s <= 0 ? 0 : s - 1)), 1000)
    return () => clearInterval(t)
  }, [draft])

  // "Pack 2 · Pick 4 — Core 2019" when the gateway ships the position
  const position =
    draft?.boosterNum != null && draft?.cardNum != null
      ? `Pack ${draft.boosterNum} · Pick ${draft.cardNum}`
      : null
  const sets = draft?.setNames?.length ? draft.setNames.join(' · ') : null

  return (
    <div className="draft-view">
      <div className="draft-head">
        <button className="btn ghost" onClick={onLeave}>
          ← Leave draft
        </button>
        <h1 className="h1">Booster Draft</h1>
        {position && (
          <span className="draft-position" data-testid="draft-position">
            {position}
            {sets ? <span className="muted draft-sets"> — {sets}</span> : null}
          </span>
        )}
        <span className="chip">{picks.length} picked</span>
        {(draft?.timeout ?? 0) > 0 && (
          <span className={`sb-timer draft-timer${secondsLeft <= 10 ? ' urgent' : ''}`} title="Time left to pick">
            ⏱ {fmtClock(secondsLeft)}
          </span>
        )}
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
            {picks.map((c, i) => (
              <span key={`${c.id}-${i}`} className="draft-pick-thumb" title={c.name}>
                <img
                  className="draft-pick-img"
                  src={imgUrl(c)}
                  alt={c.name}
                  onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                />
                <span className="draft-pick-name">{c.name}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
