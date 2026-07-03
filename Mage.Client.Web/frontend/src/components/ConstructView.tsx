import { useEffect, useState } from 'react'
import { submitDraftDeck } from '../api'
import type { DraftDeckCard } from '../api'
import type { DraftBasics, DraftCard } from '../types'

const BASIC_KEYS: { key: keyof DraftBasics; label: string }[] = [
  { key: 'plains', label: 'Plains' },
  { key: 'island', label: 'Island' },
  { key: 'swamp', label: 'Swamp' },
  { key: 'mountain', label: 'Mountain' },
  { key: 'forest', label: 'Forest' },
]
const COLOR_TO_BASIC: Record<string, keyof DraftBasics> = { W: 'plains', U: 'island', B: 'swamp', R: 'mountain', G: 'forest' }
const COLORS = ['W', 'U', 'B', 'R', 'G'] as const

function imgUrl(c: DraftCard) {
  return `/api/cardimg?set=${encodeURIComponent(c.set)}&num=${encodeURIComponent(c.num)}&name=${encodeURIComponent(c.name)}`
}
const isBasic = (c: DraftCard) => /^(plains|island|swamp|mountain|forest)$/i.test(c.name)

/** Build a deck from the drafted pool after the draft, then submit to start the
 *  tournament matches. Toggle pool cards into the deck, add basic lands; an
 *  Auto-build picks all spells and a manabase from the pool's colors. */
export function ConstructView({
  token,
  tableId,
  pool,
  time = null,
  onLeave,
}: {
  token: string
  tableId: string
  pool: DraftCard[]
  // seconds allowed for deck construction; null = untimed
  time?: number | null
  onLeave: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [basics, setBasics] = useState<DraftBasics>({ plains: 0, island: 0, swamp: 0, mountain: 0, forest: 0 })
  const [status, setStatus] = useState<string | null>(null)
  // construction countdown (informational — the server enforces the deadline)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(time)
  useEffect(() => {
    setSecondsLeft(time)
    if (time == null) return
    const t = setInterval(() => setSecondsLeft((s) => (s == null || s <= 0 ? 0 : s - 1)), 1000)
    return () => clearInterval(t)
  }, [time])
  const basicsTotal = (Object.values(basics) as number[]).reduce((a, b) => a + b, 0)
  const total = selected.size + basicsTotal

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const setBasic = (k: keyof DraftBasics, v: number) => setBasics((prev) => ({ ...prev, [k]: Math.max(0, v) }))

  const autoBuild = () => {
    const spells = pool.filter((c) => !isBasic(c))
    const sel = new Set(spells.map((c) => c.id))
    const pip: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
    let any = 0
    spells.forEach((c) => {
      for (const ch of c.colors ?? '') {
        if (pip[ch] !== undefined) {
          pip[ch]++
          any++
        }
      }
    })
    const need = Math.max(0, 40 - sel.size)
    const nb: DraftBasics = { plains: 0, island: 0, swamp: 0, mountain: 0, forest: 0 }
    if (need > 0) {
      if (any === 0) {
        nb.island = need // colorless pool fallback
      } else {
        let assigned = 0
        COLORS.forEach((ch) => {
          const n = Math.round(need * (pip[ch] / any))
          nb[COLOR_TO_BASIC[ch]] = n
          assigned += n
        })
        const diff = need - assigned
        if (diff !== 0) {
          const top = COLORS.reduce((a, b) => (pip[b] > pip[a] ? b : a), 'U' as (typeof COLORS)[number])
          nb[COLOR_TO_BASIC[top]] = Math.max(0, nb[COLOR_TO_BASIC[top]] + diff)
        }
      }
    }
    setSelected(sel)
    setBasics(nb)
  }

  const submit = () => {
    const map = new Map<string, DraftDeckCard>()
    pool
      .filter((c) => selected.has(c.id))
      .forEach((c) => {
        const k = `${c.name}|${c.set}|${c.num}`
        const e = map.get(k)
        if (e) e.qty++
        else map.set(k, { name: c.name, set: c.set, num: c.num, qty: 1 })
      })
    setStatus('Submitting deck…')
    submitDraftDeck(token, tableId, [...map.values()], basics)
      .then((r) => {
        if (!r.ok) setStatus('Deck rejected (need a legal 40+ card deck)')
      })
      .catch((e) => setStatus(`Submit failed: ${e instanceof Error ? e.message : 'error'}`))
  }

  return (
    <div className="construct-view">
      <div className="draft-head">
        <button className="btn ghost" onClick={onLeave}>
          ← Leave
        </button>
        <h1 className="h1">Build your deck</h1>
        <span className={`chip${total >= 40 ? '' : ' under'}`}>{total} cards</span>
        {secondsLeft != null && (
          <span className={`sb-timer${secondsLeft < 30 ? ' urgent' : ''}`} title="Time left to build">
            ⏱ {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
          </span>
        )}
        {status && <span className="muted">{status}</span>}
        <span className="spacer" />
        <button className="btn" onClick={autoBuild}>
          Auto-build
        </button>
        <button className="btn primary" disabled={total < 40} onClick={submit}>
          Submit &amp; play
        </button>
      </div>

      <div className="construct-basics">
        <span className="muted">Lands:</span>
        {BASIC_KEYS.map((b) => (
          <span key={b.key} className="basic-step">
            <span className="basic-label">{b.label}</span>
            <button className="btn xs" onClick={() => setBasic(b.key, basics[b.key] - 1)}>
              −
            </button>
            <span className="basic-count">{basics[b.key]}</span>
            <button className="btn xs" onClick={() => setBasic(b.key, basics[b.key] + 1)}>
              +
            </button>
          </span>
        ))}
      </div>

      <div className="draft-booster">
        {pool.map((c) => (
          <button
            key={c.id}
            className={`draft-card${selected.has(c.id) ? ' selected' : ''}`}
            onClick={() => toggle(c.id)}
            title={c.name}
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
    </div>
  )
}
