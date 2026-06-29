import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board3D } from './Board3D'
import type { RespondKind } from '../api'
import { plain } from '../text'
import type { GameCard as CardType, GameState, Prompt } from '../types'

interface Props {
  game: GameState | null
  prompt: Prompt | null
  interactive: boolean
  log?: string[]
  result?: string | null
  onRespond: (kind: RespondKind, value?: string) => void
  onLeave: () => void
  onPlayAgain?: () => void
}

// F-key skip shortcuts -> PlayerAction names sent via /api/game/respond (action).
const SKIP_KEYS: Record<string, string> = {
  F2: 'PASS_PRIORITY_UNTIL_NEXT_TURN',
  F4: 'PASS_PRIORITY_UNTIL_TURN_END_STEP',
  F6: 'PASS_PRIORITY_CANCEL_ALL_ACTIONS',
  F9: 'PASS_PRIORITY_UNTIL_MY_NEXT_TURN',
  F10: 'PASS_PRIORITY_UNTIL_STACK_RESOLVED',
}
const SKIP_BUTTONS = [
  { label: 'Next turn', key: 'F2', action: 'PASS_PRIORITY_UNTIL_NEXT_TURN' },
  { label: 'End turn', key: 'F4', action: 'PASS_PRIORITY_UNTIL_TURN_END_STEP' },
  { label: 'My turn', key: 'F9', action: 'PASS_PRIORITY_UNTIL_MY_NEXT_TURN' },
  { label: 'Resolve', key: 'F10', action: 'PASS_PRIORITY_UNTIL_STACK_RESOLVED' },
  { label: 'Cancel skips', key: 'F6', action: 'PASS_PRIORITY_CANCEL_ALL_ACTIONS' },
]

export function GameTable({ game, prompt, interactive, log = [], result, onRespond, onLeave, onPlayAgain }: Props) {
  const [preview, setPreview] = useState<CardType | null>(null)
  const [pressedCard, setPressedCard] = useState<CardType | null>(null)
  // resolve combat card ids → names (defenders may be a player name, left as-is)
  const cardName = useMemo(() => {
    const m = new Map<string, string>()
    game?.players.forEach((p) => p.battlefield.forEach((c) => m.set(c.id, c.name)))
    return (id: string) => m.get(id) ?? id
  }, [game])
  const [actionSheetCard, setActionSheetCard] = useState<CardType | null>(null)
  // the floating Stack/Combat panels crowd the board on phones — collapse them by
  // default there (tap the header to expand); leave them open on roomy screens
  const compact = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches
  const [stackOpen, setStackOpen] = useState(!compact)
  const [combatOpen, setCombatOpen] = useState(!compact)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // mobile "focus board" mode: hide chat + strips for a full-screen table
  // tiny screens can't fit the strips + chat + board, so start focused (board
  // fills the screen, strips/chat hidden) — still toggleable with the ⛶ button
  const [boardFocus, setBoardFocus] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 360px)').matches,
  )
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('board-focus', boardFocus)
    return () => root.classList.remove('board-focus')
  }, [boardFocus])

  const handleLongPress = useCallback((card: CardType) => {
    if (navigator.vibrate) navigator.vibrate(30)
    setActionSheetCard(card)
  }, [])

  // Debounce clearing the preview so rapid enter/leave events (from 3D raycasting)
  // don't cause a 1-frame flash of null between cards.
  const handleHoverCard = useCallback((card: CardType | null) => {
    if (card) {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      setPreview(card)
    } else {
      clearTimerRef.current = setTimeout(() => setPreview(null), 180)
    }
  }, [])

  useEffect(() => {
    if (!interactive) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const action = SKIP_KEYS[e.key]
      if (action) {
        e.preventDefault()
        onRespond('action', action)
        return
      }
      // quick confirm/decline for the current decision
      const k = e.key.toLowerCase()
      if (prompt?.kind === 'select') {
        if (e.key === ' ' || k === 'p') {
          e.preventDefault()
          onRespond('boolean', 'false') // pass / skip
        } else if (k === 'd') {
          e.preventDefault()
          onRespond('boolean', 'true') // done / confirm
        }
      } else if (prompt?.kind === 'ask') {
        if (k === 'y') {
          e.preventDefault()
          onRespond('boolean', 'true')
        } else if (k === 'n') {
          e.preventDefault()
          onRespond('boolean', 'false')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [interactive, onRespond, prompt])

  useEffect(() => {
    const clear = () => setPressedCard(null)
    window.addEventListener('pointerup', clear)
    return () => window.removeEventListener('pointerup', clear)
  }, [])

  if (!game) {
    return (
      <div className="game-table">
        <div className="game-toolbar">
          <button className="btn ghost" onClick={onLeave}>
            ← Back to lobby
          </button>
          <span className="muted">Waiting for game state…</span>
        </div>
        <div className="game-waiting panel">Connecting to the game…</div>
      </div>
    )
  }

  // Decide how a card responds to clicks given the current decision. A pending
  // target prompt takes precedence; otherwise any server-playable card (canPlay)
  // glows and can be played by clicking it directly on the board — matching the
  // "Play / activate" bar so playable cards are obvious in the 3D view too.
  function cardProps(card: CardType): { highlight?: 'play' | 'target'; onClick?: (c: CardType) => void } {
    if (!interactive) return {}
    if (prompt?.kind === 'target') {
      return { highlight: 'target', onClick: () => onRespond('uuid', card.id) }
    }
    if (game?.canPlay.includes(card.id)) {
      return { highlight: 'play', onClick: () => onRespond('uuid', card.id) }
    }
    return {}
  }

  return (
    <div className="game-table">
      <div className="game-toolbar">
        <button className="btn ghost" onClick={onLeave}>
          ← Back
        </button>
        <span className="turn-label">
          <b>T{game.turn}</b>
          {game.activePlayer ? ` · ${game.activePlayer}` : ''}
        </span>
        <PhaseTrack phase={game.phase} step={game.step} />
        <span className="spacer" />
        {game.priorityPlayer && (
          <span className={`prio-chip${game.priorityPlayer === game.me ? ' you' : ''}`}>
            {game.priorityPlayer === game.me ? 'Your priority' : `Priority: ${game.priorityPlayer}`}
          </span>
        )}
        {interactive && (
          <button
            className="btn ghost concede"
            onClick={() => {
              if (confirm('Concede this game?')) onRespond('concede')
            }}
          >
            Concede
          </button>
        )}
      </div>


      <div className="player-strip">
        {game.players.map((p) => {
          const canTarget = interactive && prompt && (prompt.kind === 'target' || prompt.kind === 'select')
          return (
            <button
              key={p.id}
              className={`pstat${p.name === game.activePlayer ? ' active' : ''}${canTarget ? ' targetable' : ''}`}
              onClick={canTarget ? () => onRespond('uuid', p.id) : undefined}
            >
              <span className="pstat-name">{p.name}</span>
              <LifeTotal life={p.life} />
              <span className="muted pstat-counts">
                Hand {p.handCount} · Lib {p.libraryCount} · Grave {p.graveyardCount}
              </span>
              {p.manaPool && <ManaPool pool={p.manaPool} />}
              {p.name === game.activePlayer && <span className="chip active-chip">Active</span>}
            </button>
          )
        })}
      </div>

      <button
        className="focus-toggle"
        onClick={() => setBoardFocus((f) => !f)}
        title={boardFocus ? 'Exit focus' : 'Focus board'}
        aria-label={boardFocus ? 'Exit focus board' : 'Focus board'}
      >
        {boardFocus ? '✕' : '⛶'}
      </button>

      <div className="board-wrap">
        <Board3D
          game={game}
          cardProps={cardProps}
          onHoverCard={handleHoverCard}
          onPressCard={setPressedCard}
          onLongPressCard={handleLongPress}
          targets={prompt?.kind === 'target' ? prompt.targets : undefined}
        />
        <CardPreview card={preview} />
        <CardZoomOverlay card={pressedCard} />
        {actionSheetCard && (
          <CardActionSheet
            card={actionSheetCard}
            game={game}
            prompt={prompt}
            interactive={interactive}
            onRespond={onRespond}
            onClose={() => setActionSheetCard(null)}
          />
        )}

        {(game.stack.length > 0 || game.combat.length > 0) && (
          <div className="overlay-tr board-overlays">
            {game.stack.length > 0 && (
              <div className={`stack-panel panel overlay-panel${stackOpen ? '' : ' collapsed'}`}>
                <button className="overlay-head" onClick={() => setStackOpen((o) => !o)} title={stackOpen ? 'Collapse' : 'Expand'}>
                  <span className="stack-title">Stack ({game.stack.length})</span>
                  <span className="overlay-toggle" aria-hidden>{stackOpen ? '▾' : '▸'}</span>
                </button>
                {stackOpen && (
                  <div className="overlay-body">
                    {/* top of the stack resolves first (LIFO) */}
                    {[...game.stack].reverse().map((c, i) => (
                      <button
                        type="button"
                        className={`stack-item${i === 0 ? ' next' : ''}`}
                        key={c.id}
                        onMouseEnter={() => handleHoverCard(c)}
                        onMouseLeave={() => handleHoverCard(null)}
                        onFocus={() => handleHoverCard(c)}
                        onBlur={() => handleHoverCard(null)}
                        onClick={() => handleHoverCard(c)}
                      >
                        {i === 0 && <span className="stack-next-tag">next</span>}
                        <span className="stack-item-name">{c.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {game.combat.length > 0 && (
              <div className={`combat-panel panel overlay-panel${combatOpen ? '' : ' collapsed'}`}>
                <button className="overlay-head" onClick={() => setCombatOpen((o) => !o)} title={combatOpen ? 'Collapse' : 'Expand'}>
                  <span className="stack-title">Combat ({game.combat.length})</span>
                  <span className="overlay-toggle" aria-hidden>{combatOpen ? '▾' : '▸'}</span>
                </button>
                {combatOpen && (
                  <div className="overlay-body">
                    {game.combat.map((cg, i) => (
                      <div className="combat-group" key={i}>
                        <span className="combat-attackers">{cg.attackers.map(cardName).join(', ') || '—'}</span>
                        <span className="combat-arrow">→</span>
                        <span className="combat-defender">{cg.defender ? cardName(cg.defender) : '—'}</span>
                        {cg.blockers.length > 0 ? (
                          <span className="combat-blockers muted">blocked by {cg.blockers.map(cardName).join(', ')}</span>
                        ) : (
                          <span className="combat-unblocked">unblocked</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {log.length > 0 && <GameLog lines={log} />}

        {result && (
          <div className="game-over-overlay">
            <div className="game-over-card panel">
              <div className="game-over-title">{/won|win/i.test(result) ? '🏆 ' : ''}Game over</div>
              <div className="game-over-msg">{plain(result)}</div>
              <div className="game-over-actions">
                {onPlayAgain && (
                  <button className="btn primary" onClick={onPlayAgain}>
                    Play again
                  </button>
                )}
                <button className={`btn${onPlayAgain ? ' ghost' : ' primary'}`} onClick={onLeave}>
                  Back to lobby
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* one fixed control dock so the turn controls + actions never move around */}
      {interactive && (
        <div className="control-dock panel">
          <div className="dock-skips">
            {SKIP_BUTTONS.map((s) => (
              <button
                key={s.action}
                className="btn skip-btn"
                onClick={() => onRespond('action', s.action)}
                title={`${s.label} (${s.key})`}
              >
                {s.label} <span className="skip-key">{s.key}</span>
              </button>
            ))}
          </div>
          {prompt?.kind === 'select' && <PlayableBar game={game} onRespond={onRespond} onHoverCard={handleHoverCard} onPressCard={setPressedCard} />}
          <span className="spacer" />
          <ActionBar prompt={prompt} onRespond={onRespond} />
        </div>
      )}
      {!interactive && !result && game.me && (
        <div className="control-dock waiting-dock panel">
          <span className="waiting-spinner" aria-hidden />
          Waiting for {game.activePlayer && game.activePlayer !== game.me ? game.activePlayer : 'opponent'}…
        </div>
      )}
    </div>
  )
}

const MANA_COLOR: Record<string, string> = { W: '#e9e3c0', U: '#4a90e2', B: '#6b5b73', R: '#e0555f', G: '#3aa55f', C: '#9aa0ad' }

/** Floating mana pool as colored pips (W U B R G C). */
/** Life total that flashes green/red and floats a +N/-N delta when it changes,
 *  so life swings (damage, gain) are obvious at a glance. */
function LifeTotal({ life }: { life: number }) {
  const prev = useRef(life)
  const [delta, setDelta] = useState<number | null>(null)
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  useEffect(() => {
    if (life === prev.current) return
    const d = life - prev.current
    prev.current = life
    setDelta(d)
    setFlash(d > 0 ? 'up' : 'down')
    const t = setTimeout(() => {
      setDelta(null)
      setFlash(null)
    }, 1100)
    return () => clearTimeout(t)
  }, [life])
  return (
    <span className={`pstat-life${flash ? ` flash-${flash}` : ''}`}>
      ♥ {life}
      {delta != null && <span className={`life-delta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? `+${delta}` : delta}</span>}
    </span>
  )
}

function ManaPool({ pool }: { pool: string }) {
  const syms = pool.match(/\{(\w)\}/g)?.map((s) => s[1]) ?? []
  if (syms.length === 0) return null
  return (
    <span className="mana-pool" title="Mana pool">
      {syms.map((c, i) => (
        <span key={i} className="mana-pip" style={{ background: MANA_COLOR[c] ?? '#9aa0ad' }}>
          {c}
        </span>
      ))}
    </span>
  )
}

function PlayableBar({
  game,
  onRespond,
  onHoverCard,
  onPressCard,
}: {
  game: GameState
  onRespond: (kind: RespondKind, value?: string) => void
  onHoverCard?: (c: CardType | null) => void
  onPressCard?: (c: CardType | null) => void
}) {
  const byId: Record<string, CardType> = {}
  game.myHand.forEach((c) => (byId[c.id] = c))
  game.players.forEach((p) => p.battlefield.forEach((c) => (byId[c.id] = c)))
  const playable = game.canPlay.map((id) => byId[id]).filter(Boolean)
  if (playable.length === 0) return null
  return (
    <div className="playable-bar panel">
      <span className="muted playable-label">Play / activate:</span>
      {playable.map((c) => (
        <button
          key={c.id}
          className="btn play-chip"
          onClick={() => onRespond('uuid', c.id)}
          onMouseEnter={() => onHoverCard?.(c)}
          onMouseLeave={() => onHoverCard?.(null)}
          onMouseDown={() => onPressCard?.(c)}
        >
          {c.name}
          {c.manaCost && (
            <span className="play-chip-cost">
              {(c.manaCost.match(/\{([^}]+)\}/g) ?? []).map((s, i) => {
                const sym = s.slice(1, -1)
                return (
                  <span key={i} className="mana-pip" style={{ background: MANA_COLOR[sym] ?? '#6b7280' }}>
                    {sym}
                  </span>
                )
              })}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** A large, fully-readable card panel shown while hovering a card (3D or the
 *  playable bar): art + name + mana cost + type line + P/T or loyalty. */
function CardPreview({ card }: { card: CardType | null }) {
  if (!card) return null
  const cost = (card.manaCost?.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1))
  const img = `/api/cardimg?set=${encodeURIComponent(card.set ?? '')}&num=${encodeURIComponent(
    card.num ?? '',
  )}&name=${encodeURIComponent(card.name)}`
  const isCreature = (card.types ?? []).some((t) => /creature/i.test(t))
  const isPw = (card.types ?? []).some((t) => /planeswalker/i.test(t))
  const pt = isCreature && card.power != null && card.toughness != null ? `${card.power}/${card.toughness}` : null
  const loy = isPw && card.loyalty != null ? `Loyalty ${card.loyalty}` : null
  return (
    <div className="card-preview" role="dialog" aria-label={`Card: ${card.name}`}>
      <img
        className="card-preview-img"
        src={img}
        alt={card.name}
        onError={(e) => ((e.currentTarget.style.visibility = 'hidden'))}
      />
      <div className="card-preview-info">
        <div className="card-preview-head">
          <span className="card-preview-name">{card.name}</span>
          <span className="card-preview-cost">
            {cost.map((s, i) => (
              <span key={i} className="mana-pip" style={{ background: MANA_COLOR[s] ?? '#9aa0ad' }}>
                {s}
              </span>
            ))}
          </span>
        </div>
        <div className="card-preview-type muted">{(card.types ?? []).join(' ')}</div>
        {(pt || loy) && <div className="card-preview-pt">{pt ?? loy}</div>}
      </div>
    </div>
  )
}

function CardZoomOverlay({ card }: { card: CardType | null }) {
  if (!card) return null
  const img = `/api/cardimg?set=${encodeURIComponent(card.set ?? '')}&num=${encodeURIComponent(
    card.num ?? '',
  )}&name=${encodeURIComponent(card.name)}`
  return (
    <div className="card-zoom-overlay">
      <img className="card-zoom-img" src={img} alt={card.name} />
    </div>
  )
}

function CardActionSheet({
  card,
  game,
  prompt,
  interactive,
  onRespond,
  onClose,
}: {
  card: CardType
  game: GameState | null
  prompt: Prompt | null
  interactive: boolean
  onRespond: (kind: RespondKind, value?: string) => void
  onClose: () => void
}) {
  const img = `/api/cardimg?set=${encodeURIComponent(card.set ?? '')}&num=${encodeURIComponent(
    card.num ?? '',
  )}&name=${encodeURIComponent(card.name)}`
  const cost = (card.manaCost?.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1))
  const canPlay = interactive && (game?.canPlay.includes(card.id) ?? false)
  const canTarget = interactive && prompt?.kind === 'target'
  const isCreature = card.types?.includes('Creature')

  // A touch long-press opens this sheet while the finger is still down; lifting
  // the finger then fires a synthetic `click` on the full-screen backdrop, which
  // would instantly close the just-opened sheet. Ignore backdrop clicks that
  // arrive within a short grace window of opening so long-press preview is usable.
  const openedAt = useRef(Date.now())
  const onBackdrop = () => {
    if (Date.now() - openedAt.current < 400) return
    onClose()
  }

  return (
    <div className="card-action-backdrop" onClick={onBackdrop}>
      <div className="card-action-sheet panel" onClick={(e) => e.stopPropagation()}>
        <div className="card-action-content">
          <img
            className="card-action-art"
            src={img}
            alt={card.name}
            onError={(e) => ((e.currentTarget.style.visibility = 'hidden'))}
          />
          <div className="card-action-info">
            <div className="card-action-name">{card.name}</div>
            {cost.length > 0 && (
              <div className="card-action-cost">
                {cost.map((s, i) => (
                  <span key={i} className="mana-pip" style={{ background: MANA_COLOR[s] ?? '#9aa0ad' }}>
                    {s}
                  </span>
                ))}
              </div>
            )}
            {card.types && <div className="card-action-type muted">{card.types.join(' ')}</div>}
            {isCreature && card.power != null && card.toughness != null && (
              <div className="card-action-pt">
                {card.power}/{card.toughness}
                {card.damage > 0 && <span style={{ color: 'var(--danger)' }}> −{card.damage}</span>}
              </div>
            )}
            {card.tapped && <div className="card-action-status muted">Tapped</div>}
          </div>
        </div>
        <div className="card-action-buttons">
          {canPlay && (
            <button className="btn primary" onClick={() => { onRespond('uuid', card.id); onClose() }}>
              Play
            </button>
          )}
          {canTarget && (
            <button className="btn primary" onClick={() => { onRespond('uuid', card.id); onClose() }}>
              Target
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function GameLog({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (el && !collapsed) el.scrollTop = el.scrollHeight
  }, [lines, collapsed])
  return (
    <div className={`game-log panel${collapsed ? ' collapsed' : ''}`}>
      <button className="game-log-head" onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand log' : 'Collapse log'}>
        <span className="stack-title">Game log</span>
        <span className="game-log-toggle" aria-hidden>{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className="game-log-body" ref={ref}>
          {lines.map((l, i) => (
            <div className="game-log-line" key={i}>
              {plain(l)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ActionBar({ prompt, onRespond }: { prompt: Prompt | null; onRespond: (kind: RespondKind, value?: string) => void }) {
  const [amount, setAmount] = useState('')

  if (!prompt) {
    return (
      <div className="action-bar">
        <span className="action-message muted">Waiting — use the buttons on the left to advance the turn.</span>
      </div>
    )
  }

  return (
    <div className="action-bar">
      <span className="action-message">{plain(prompt.message) || promptFallback(prompt.kind)}</span>
      <span className="spacer" />

      {prompt.kind === 'ask' && (
        <>
          <button className="btn primary" onClick={() => onRespond('boolean', 'true')}>
            Yes <span className="skip-key">Y</span>
          </button>
          <button className="btn" onClick={() => onRespond('boolean', 'false')}>
            No <span className="skip-key">N</span>
          </button>
        </>
      )}

      {prompt.kind === 'select' && (
        <>
          <span className="muted hint">Click a card to play / declare · Done confirms · Pass skips</span>
          {/* Done = boolean true: confirms the current selection, e.g. declared
              attackers/blockers. Pass = boolean false: pass priority. */}
          <button className="btn" onClick={() => onRespond('boolean', 'true')}>
            Done <span className="skip-key">D</span>
          </button>
          <button className="btn primary" onClick={() => onRespond('boolean', 'false')}>
            Pass <span className="skip-key">P</span>
          </button>
        </>
      )}

      {prompt.kind === 'target' && (
        <>
          <span className="muted hint">Click a target</span>
          {prompt.canCancel && (
            <button className="btn" onClick={() => onRespond('boolean', 'false')}>
              Done
            </button>
          )}
        </>
      )}

      {prompt.kind === 'amount' && (
        <>
          <input
            className="amount-input"
            type="number"
            min={prompt.min}
            max={prompt.max}
            value={amount}
            placeholder={`${prompt.min}–${prompt.max}`}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button
            className="btn primary"
            onClick={() => onRespond('integer', amount === '' ? String(prompt.min) : amount)}
          >
            OK
          </button>
        </>
      )}

      {prompt.kind === 'choice' && (
        <div className="choice-list">
          {prompt.choices.map((c) => (
            <button key={c.key} className="btn" onClick={() => onRespond(prompt.choiceKind ?? 'string', c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {prompt.kind === 'pile' && (
        <div className="pile-choice">
          <div className="pile">
            <div className="pile-cards">
              {(prompt.pile1 ?? []).map((c) => (
                <span key={c.id} className="pile-card">
                  {c.name}
                </span>
              ))}
            </div>
            <button className="btn primary" onClick={() => onRespond('boolean', 'true')}>
              Take pile 1
            </button>
          </div>
          <div className="pile">
            <div className="pile-cards">
              {(prompt.pile2 ?? []).map((c) => (
                <span key={c.id} className="pile-card">
                  {c.name}
                </span>
              ))}
            </div>
            <button className="btn primary" onClick={() => onRespond('boolean', 'false')}>
              Take pile 2
            </button>
          </div>
        </div>
      )}

      {prompt.kind === 'multiAmount' && <MultiAmountControl prompt={prompt} onRespond={onRespond} />}

      {prompt.kind === 'generic' && prompt.canCancel && (
        <button className="btn" onClick={() => onRespond('boolean', 'false')}>
          Cancel
        </button>
      )}
    </div>
  )
}

/** Distribute amounts across several entries (e.g. "X damage divided as you
 *  choose"); answer is the per-entry amounts joined by spaces. */
function MultiAmountControl({ prompt, onRespond }: { prompt: Prompt; onRespond: (kind: RespondKind, value?: string) => void }) {
  const entries = prompt.multi ?? []
  const [vals, setVals] = useState<number[]>(() => entries.map((e) => e.def))
  const total = vals.reduce((a, b) => a + b, 0)
  const inRange = total >= prompt.min && total <= prompt.max
  const set = (i: number, v: number) =>
    setVals((prev) => prev.map((x, j) => (j === i ? Math.max(entries[j].min, Math.min(entries[j].max, v || 0)) : x)))
  return (
    <div className="multi-amount">
      {entries.map((e, i) => (
        <label key={i} className="multi-row">
          <span className="multi-label">{plain(e.label)}</span>
          <input
            type="number"
            className="multi-input"
            min={e.min}
            max={e.max}
            value={vals[i]}
            onChange={(ev) => set(i, parseInt(ev.target.value, 10))}
          />
        </label>
      ))}
      <span className={`multi-total${inRange ? '' : ' bad'}`}>
        total {total} / {prompt.min === prompt.max ? prompt.min : `${prompt.min}–${prompt.max}`}
      </span>
      <button className="btn primary" disabled={!inRange} onClick={() => onRespond('string', vals.join(' '))}>
        OK
      </button>
    </div>
  )
}

const PHASE_SEGMENTS = ['Untap', 'Upkeep', 'Draw', 'Main 1', 'Combat', 'Main 2', 'End']
function phaseIndex(phase?: string | null, step?: string | null): number {
  const s = `${step || ''} ${phase || ''}`.toLowerCase()
  if (/untap/.test(s)) return 0
  if (/upkeep/.test(s)) return 1
  if (/draw/.test(s)) return 2
  if (/precombat main/.test(s)) return 3
  if (/postcombat main/.test(s)) return 5
  if (/combat|attack|block|damage/.test(s)) return 4
  if (/end|cleanup/.test(s)) return 6
  if (/main/.test(s)) return 3
  return -1
}

/** A horizontal turn-structure track with the current step lit, so it's obvious
 *  where in the turn we are. */
function PhaseTrack({ phase, step }: { phase?: string | null; step?: string | null }) {
  const idx = phaseIndex(phase, step)
  return (
    <div className="phase-track" aria-label="turn phase">
      {PHASE_SEGMENTS.map((label, i) => (
        <div
          key={label}
          className={`phase-seg${i === idx ? ' active' : i < idx ? ' past' : ''}`}
          title={i === idx && step ? `${label} — ${step}` : label}
        >
          {label}
        </div>
      ))}
      {step && <span className="phase-step muted">{step}</span>}
    </div>
  )
}

function promptFallback(kind: Prompt['kind']): string {
  switch (kind) {
    case 'select':
      return 'You have priority.'
    case 'target':
      return 'Choose a target.'
    case 'amount':
      return 'Choose an amount.'
    case 'choice':
      return 'Make a choice.'
    default:
      return 'Waiting…'
  }
}
