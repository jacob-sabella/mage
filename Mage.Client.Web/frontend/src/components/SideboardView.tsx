import { useEffect, useMemo, useRef, useState } from 'react'
import { submitDraftDeck, updateDeck } from '../api'
import type { DraftDeckCard } from '../api'
import type { DraftBasics, DraftCard } from '../types'

const BASIC_KEYS: { key: keyof DraftBasics; label: string }[] = [
  { key: 'plains', label: 'Plains' },
  { key: 'island', label: 'Island' },
  { key: 'swamp', label: 'Swamp' },
  { key: 'mountain', label: 'Mountain' },
  { key: 'forest', label: 'Forest' },
]

function imgUrl(c: DraftCard) {
  return `/api/cardimg?set=${encodeURIComponent(c.set)}&num=${encodeURIComponent(c.num)}&name=${encodeURIComponent(c.name)}`
}

// collapse a card list into the submit endpoint's {name,set,num,qty} shape
function aggregate(cards: DraftCard[]): DraftDeckCard[] {
  const map = new Map<string, DraftDeckCard>()
  cards.forEach((c) => {
    const k = `${c.name}|${c.set}|${c.num}`
    const e = map.get(k)
    if (e) e.qty++
    else map.set(k, { name: c.name, set: c.set, num: c.num, qty: 1 })
  })
  return [...map.values()]
}

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/** Between-games sideboarding: swap cards between the main deck and the
 *  sideboard before the next game of the match starts. Every edit autosaves
 *  (debounced) so running out the clock keeps the work done so far. */
export function SideboardView({
  token,
  tableId,
  initialMain,
  initialSide,
  time,
  limited,
}: {
  token: string
  tableId: string
  initialMain: DraftCard[]
  initialSide: DraftCard[]
  // seconds allowed for sideboarding; null = untimed
  time: number | null
  limited: boolean
}) {
  const [main, setMain] = useState<DraftCard[]>(initialMain)
  const [side, setSide] = useState<DraftCard[]>(initialSide)
  const [basics, setBasics] = useState<DraftBasics>({ plains: 0, island: 0, swamp: 0, mountain: 0, forest: 0 })
  const [status, setStatus] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(time)

  // countdown — purely informational; the server enforces the real deadline
  useEffect(() => {
    setSecondsLeft(time)
    if (time == null) return
    const t = setInterval(() => setSecondsLeft((s) => (s == null || s <= 0 ? 0 : s - 1)), 1000)
    return () => clearInterval(t)
  }, [time])

  const basicsTotal = (Object.values(basics) as number[]).reduce((a, b) => a + b, 0)
  const mainCount = main.length + basicsTotal
  const minMain = limited ? 40 : 60
  const setBasic = (k: keyof DraftBasics, v: number) => setBasics((prev) => ({ ...prev, [k]: Math.max(0, v) }))

  // debounce-autosave every edit via /api/deck/update so a timeout keeps the work
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) return // skip the initial mount — nothing changed yet
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const m = main
    const s = side
    saveTimer.current = setTimeout(() => {
      updateDeck(token, tableId, aggregate(m), aggregate(s)).catch(() => {
        /* best-effort autosave */
      })
    }, 500)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [main, side, token, tableId])

  const toSide = (idx: number) => {
    dirty.current = true
    const c = main[idx]
    setMain(main.filter((_, i) => i !== idx))
    setSide([...side, c])
  }
  const toMain = (idx: number) => {
    dirty.current = true
    const c = side[idx]
    setSide(side.filter((_, i) => i !== idx))
    setMain([...main, c])
  }

  const submit = () => {
    setStatus('Submitting deck…')
    submitDraftDeck(token, tableId, aggregate(main), basics, aggregate(side))
      .then((r) => {
        if (r.ok) {
          setSubmitted(true)
          setStatus('Deck submitted — waiting for the next game…')
        } else {
          setStatus('Deck rejected by the server')
        }
      })
      .catch((e) => setStatus(`Submit failed: ${e instanceof Error ? e.message : 'error'}`))
  }

  const zones = useMemo(
    () =>
      [
        { id: 'main', label: 'Main deck', cards: main, move: toSide, hint: 'Move to sideboard' },
        { id: 'side', label: 'Sideboard', cards: side, move: toMain, hint: 'Move to main deck' },
      ] as const,
    [main, side],
  )

  return (
    <div className="sideboard-view construct-view">
      <div className="draft-head">
        <h1 className="h1">Sideboarding</h1>
        <span className="chip">main {mainCount}</span>
        <span className="chip">side {side.length}</span>
        {secondsLeft != null && (
          <span className={`sb-timer${secondsLeft < 30 ? ' urgent' : ''}`} title="Time left to sideboard">
            ⏱ {fmtClock(secondsLeft)}
          </span>
        )}
        {status && <span className="muted sb-status">{status}</span>}
        <span className="spacer" />
        <button className="btn primary" disabled={submitted} onClick={submit}>
          Submit deck
        </button>
      </div>

      {mainCount < minMain && (
        <p className="sb-warning" role="status">
          ⚠ Your main deck has {mainCount} cards — {limited ? 'limited' : 'constructed'} decks need at least {minMain}.
          You can still submit, but the server may reject it.
        </p>
      )}

      {limited && (
        <div className="construct-basics">
          <span className="muted">Lands:</span>
          {BASIC_KEYS.map((b) => (
            <span key={b.key} className="basic-step">
              <span className="basic-label">{b.label}</span>
              <button className="btn xs" onClick={() => setBasic(b.key, basics[b.key] - 1)} aria-label={`Fewer ${b.label}`}>
                −
              </button>
              <span className="basic-count">{basics[b.key]}</span>
              <button className="btn xs" onClick={() => setBasic(b.key, basics[b.key] + 1)} aria-label={`More ${b.label}`}>
                +
              </button>
            </span>
          ))}
        </div>
      )}

      {zones.map((z) => (
        <section key={z.id} className={`sb-zone sb-zone-${z.id}`} aria-label={z.label}>
          <div className="sb-zone-head">
            <span className="stack-title">
              {z.label} ({z.id === 'main' ? mainCount : z.cards.length})
            </span>
            <span className="muted sb-zone-hint">click a card to move it</span>
          </div>
          <div className="draft-booster sb-zone-cards">
            {z.cards.length === 0 && <p className="muted sb-empty">Empty.</p>}
            {z.cards.map((c, i) => (
              <button
                key={`${c.id}-${i}`}
                className="draft-card sb-card"
                onClick={() => z.move(i)}
                title={`${c.name} — ${z.hint}`}
              >
                <img
                  className="draft-card-img"
                  src={imgUrl(c)}
                  alt={c.name}
                  onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                />
                <span className="draft-card-name">{c.name}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
