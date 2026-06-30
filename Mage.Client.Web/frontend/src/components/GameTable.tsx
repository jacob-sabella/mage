import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board3D } from './Board3D'
import { ConfirmDialog } from './ConfirmDialog'
import type { RespondKind } from '../api'
import { plain } from '../text'
import type { GameCard as CardType, GameState, Prompt } from '../types'

interface Props {
  game: GameState | null
  prompt: Prompt | null
  interactive: boolean
  result?: string | null
  onRespond: (kind: RespondKind, value?: string) => void
  // tap several lands from a same-named stack in sequence (one priority round each)
  onTapMany?: (ids: string[]) => void
  // desktop in-tab "maximize the board" mode (owned by LobbyView so it can also
  // collapse the chat column)
  maximized?: boolean
  onToggleMaximize?: () => void
  onLeave: () => void
  onPlayAgain?: () => void
}

// What the contextual card menu is currently showing. `members` is the collapsed
// land stack (when opened on one); `abilities` is the xmage ability-picker list,
// set only when the menu auto-opened anchored to a just-activated card.
type MenuState = {
  card: CardType
  members?: CardType[]
  abilities?: { key: string; label: string }[]
  choiceKind?: string
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

export function GameTable({ game, prompt, interactive, result, onRespond, onTapMany, maximized, onToggleMaximize, onLeave, onPlayAgain }: Props) {
  const [preview, setPreview] = useState<CardType | null>(null)
  const [pressedCard, setPressedCard] = useState<CardType | null>(null)
  // resolve combat card ids → names (defenders may be a player name, left as-is)
  const cardName = useMemo(() => {
    const m = new Map<string, string>()
    game?.players.forEach((p) => p.battlefield.forEach((c) => m.set(c.id, c.name)))
    return (id: string) => m.get(id) ?? id
  }, [game])
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [confirmConcede, setConfirmConcede] = useState(false)
  // clicking a player in the strip swings the camera to their board (multiplayer)
  const [focusSeat, setFocusSeat] = useState<{ name: string; n: number } | null>(null)
  // the last battlefield card the viewer clicked to activate — used to anchor the
  // ability picker menu to the card the abilities came from (xmage doesn't tell us)
  const lastActivatedRef = useRef<{ card: CardType; t: number } | null>(null)
  // the floating Stack/Combat panels crowd the board on phones — collapse them by
  // default there (tap the header to expand); leave them open on roomy screens
  const compact =
    typeof window !== 'undefined' && window.matchMedia('(max-width: 760px), (max-height: 540px)').matches
  const [stackOpen, setStackOpen] = useState(!compact)
  const [combatOpen, setCombatOpen] = useState(!compact)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // mobile immersive mode: a real landscape game HUD — the board fills the
  // screen, the app chrome is hidden, and player info / controls become compact
  // on-board panels instead of a scrolling page. Toggled with the ⛶ button.
  const [boardFocus, setBoardFocus] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 360px)').matches,
  )
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('board-focus', boardFocus)
    return () => root.classList.remove('board-focus')
  }, [boardFocus])

  // entering immersive: go true fullscreen + ask for landscape (best-effort; iOS
  // ignores orientation lock, the CSS still works). Must run in the click gesture.
  const toggleImmersive = useCallback(() => {
    const next = !boardFocus
    type OrientationLock = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void }
    const orient = (typeof screen !== 'undefined' ? screen.orientation : undefined) as OrientationLock | undefined
    if (next) {
      document.documentElement.requestFullscreen?.().catch(() => {})
      orient?.lock?.('landscape').catch(() => {})
    } else {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
      orient?.unlock?.()
    }
    setBoardFocus(next)
  }, [boardFocus])

  // if the user drops out of fullscreen via a system gesture, leave immersive too
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) setBoardFocus(false)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const handleOpenMenu = useCallback((card: CardType, members?: CardType[]) => {
    if (navigator.vibrate) navigator.vibrate(30)
    setMenu({ card, members })
  }, [])

  // Anchor the xmage ability picker (a uuid `choice` prompt) to the card the
  // viewer just activated, so its options appear as a menu on that card rather
  // than only as buttons in the bottom bar. Closes the ability menu when the
  // picker goes away. Manually-opened menus (no `abilities`) are left alone.
  useEffect(() => {
    if (prompt?.kind === 'choice' && prompt.choiceKind === 'uuid') {
      const la = lastActivatedRef.current
      if (la && Date.now() - la.t < 5000) {
        setMenu({ card: la.card, abilities: prompt.choices, choiceKind: prompt.choiceKind })
      }
    } else {
      setMenu((m) => (m?.abilities ? null : m))
    }
  }, [prompt])

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
      return {
        highlight: 'play',
        onClick: () => {
          // remember what we just activated so an ability-picker prompt that comes
          // back can anchor its menu to this card
          lastActivatedRef.current = { card, t: Date.now() }
          onRespond('uuid', card.id)
        },
      }
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
          <button className="btn ghost concede" onClick={() => setConfirmConcede(true)}>
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
              title={canTarget ? `Target ${p.name}` : `Focus ${p.name}'s board`}
              onClick={
                canTarget
                  ? () => onRespond('uuid', p.id)
                  : () => setFocusSeat((prev) => ({ name: p.name, n: (prev?.n ?? 0) + 1 }))
              }
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
        onClick={toggleImmersive}
        title={boardFocus ? 'Exit fullscreen' : 'Fullscreen board'}
        aria-label={boardFocus ? 'Exit fullscreen board' : 'Fullscreen board'}
      >
        {boardFocus ? '✕' : '⛶'}
      </button>

      {/* desktop in-tab maximize: board fills the window, site chrome hides */}
      {onToggleMaximize && (
        <button
          className="maximize-toggle"
          onClick={onToggleMaximize}
          title={maximized ? 'Exit maximized board (Esc)' : 'Maximize board'}
          aria-label={maximized ? 'Exit maximized board' : 'Maximize board'}
        >
          {maximized ? '✕' : '⛶'}
        </button>
      )}

      <div className="board-wrap">
        <Board3D
          game={game}
          cardProps={cardProps}
          onHoverCard={handleHoverCard}
          onOpenMenu={handleOpenMenu}
          targets={prompt?.kind === 'target' ? prompt.targets : undefined}
          focusSeat={focusSeat}
        />
        <CardPreview card={preview} />
        <CardZoomOverlay card={pressedCard} />
        {menu && (
          <CardMenu
            menu={menu}
            game={game}
            prompt={prompt}
            interactive={interactive}
            onRespond={onRespond}
            onTapMany={onTapMany}
            onClose={() => setMenu(null)}
          />
        )}

        {/* your hand as a fixed screen-space fan at the bottom (like other MTG
            clients) instead of laid flat on the 3D table */}
        {game.myHand && game.myHand.length > 0 && (
          <HandFan cards={game.myHand} cardProps={cardProps} onHoverCard={handleHoverCard} onOpenMenu={handleOpenMenu} />
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
                        <span className="stack-item-name">
                          {c.sourceName ? `${c.sourceName} (ability)` : c.name}
                        </span>
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

        {confirmConcede && (
          <ConfirmDialog
            title="Concede this game?"
            message="You'll forfeit the match and return to the lobby."
            confirmLabel="Concede"
            danger
            onConfirm={() => {
              setConfirmConcede(false)
              onRespond('concede')
            }}
            onCancel={() => setConfirmConcede(false)}
          />
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
          {/* when the ability picker is anchored to a card menu, don't also list
              the same options in the bottom bar */}
          <ActionBar prompt={prompt} onRespond={onRespond} hideChoice={!!menu?.abilities} />
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

/** Your hand as a fixed, overlapping fan pinned to the bottom of the screen —
 *  the way MTG Arena / xmage desktop show a hand — rather than laid on the 3D
 *  table where the camera angle makes it hard to read. Playable cards glow; click
 *  plays (when castable), hover shows the big preview, right-click / long-press
 *  opens the card menu. */
function HandFan({
  cards,
  cardProps,
  onHoverCard,
  onOpenMenu,
}: {
  cards: CardType[]
  cardProps: (c: CardType) => { highlight?: 'play' | 'target'; onClick?: (c: CardType) => void }
  onHoverCard: (c: CardType | null) => void
  onOpenMenu: (c: CardType, members?: CardType[]) => void
}) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  const fanRef = useRef<HTMLDivElement>(null)
  // ←/→ move focus between hand cards; Enter/Space activates (native button)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const btns = Array.from(fanRef.current?.querySelectorAll<HTMLButtonElement>('.hand-card') ?? [])
    const idx = btns.indexOf(document.activeElement as HTMLButtonElement)
    if (idx < 0) return
    e.preventDefault()
    const next = e.key === 'ArrowRight' ? Math.min(btns.length - 1, idx + 1) : Math.max(0, idx - 1)
    btns[next]?.focus()
  }
  return (
    <div className="hand-fan" role="group" aria-label="Your hand" ref={fanRef} onKeyDown={onKeyDown}>
      {cards.map((card, i) => {
        const { highlight, onClick } = cardProps(card)
        const cost = (card.manaCost?.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1))
        const img = `/api/cardimg?set=${encodeURIComponent(card.set ?? '')}&num=${encodeURIComponent(
          card.num ?? '',
        )}&name=${encodeURIComponent(card.name)}`
        return (
          <button
            key={card.id}
            className={`hand-card${highlight === 'play' ? ' playable' : ''}${highlight === 'target' ? ' targetable' : ''}`}
            style={{ zIndex: i }}
            aria-label={`${card.name}${highlight === 'play' ? ', playable' : ''}`}
            onMouseEnter={() => onHoverCard(card)}
            onMouseLeave={() => onHoverCard(null)}
            onClick={() => {
              if (longPressed.current) {
                longPressed.current = false
                return
              }
              onClick?.(card)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              onOpenMenu(card)
            }}
            onPointerDown={(e) => {
              if (e.pointerType !== 'touch') return
              longPressed.current = false
              pressTimer.current = setTimeout(() => {
                longPressed.current = true
                onOpenMenu(card)
              }, 450)
            }}
            onPointerUp={() => {
              if (pressTimer.current) clearTimeout(pressTimer.current)
            }}
            title={card.name}
          >
            <img className="hand-card-art" src={img} alt={card.name} onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
            {cost.length > 0 && (
              <span className="hand-card-cost">
                {cost.map((s, j) => (
                  <span key={j} className="mana-pip" style={{ background: MANA_COLOR[s] ?? '#9aa0ad' }}>
                    {s}
                  </span>
                ))}
              </span>
            )}
            <span className="hand-card-name">{card.name}</span>
          </button>
        )
      })}
    </div>
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
  const isAbility = !!card.sourceName
  // For abilities on the stack use the source card's image; the ability itself has no art.
  const imgSet = card.sourceSet ?? card.set
  const imgNum = card.sourceNum ?? card.num
  const imgName = card.sourceName ?? card.name
  const cost = (card.manaCost?.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1))
  const img = `/api/cardimg?set=${encodeURIComponent(imgSet ?? '')}&num=${encodeURIComponent(
    imgNum ?? '',
  )}&name=${encodeURIComponent(imgName)}`
  const isCreature = (card.types ?? []).some((t) => /creature/i.test(t))
  const isPw = (card.types ?? []).some((t) => /planeswalker/i.test(t))
  const pt = isCreature && card.power != null && card.toughness != null ? `${card.power}/${card.toughness}` : null
  const loy = isPw && card.loyalty != null ? `Loyalty ${card.loyalty}` : null
  const displayName = isAbility ? `${card.sourceName} (ability)` : card.name
  return (
    <div className="card-preview" role="dialog" aria-label={`Card: ${displayName}`}>
      <img
        className="card-preview-img"
        src={img}
        alt={displayName}
        onError={(e) => ((e.currentTarget.style.visibility = 'hidden'))}
      />
      <div className="card-preview-info">
        <div className="card-preview-head">
          <span className="card-preview-name">{displayName}</span>
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

/** Contextual card menu — one surface reused for a card's primary action (play /
 *  target), an xmage ability picker anchored to the card, and tapping/undoing a
 *  chosen number of lands from a same-named stack. */
function CardMenu({
  menu,
  game,
  prompt,
  interactive,
  onRespond,
  onTapMany,
  onClose,
}: {
  menu: MenuState
  game: GameState | null
  prompt: Prompt | null
  interactive: boolean
  onRespond: (kind: RespondKind, value?: string) => void
  onTapMany?: (ids: string[]) => void
  onClose: () => void
}) {
  const { card, members, abilities, choiceKind } = menu
  const img = `/api/cardimg?set=${encodeURIComponent(card.set ?? '')}&num=${encodeURIComponent(
    card.num ?? '',
  )}&name=${encodeURIComponent(card.name)}`
  const cost = (card.manaCost?.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1))
  const canPlay = interactive && (game?.canPlay.includes(card.id) ?? false)
  const canTarget = interactive && prompt?.kind === 'target'
  const isCreature = card.types?.includes('Creature')

  // land-stack controls: which of the collapsed lands are still untappable / tapped
  const untapped = useMemo(() => (members ?? []).filter((m) => !m.tapped), [members])
  const tappedCount = (members?.length ?? 0) - untapped.length
  const isStack = (members?.length ?? 0) > 1
  const [n, setN] = useState(1)
  const tapCount = Math.min(Math.max(1, n), Math.max(1, untapped.length))

  // A touch long-press opens this menu while the finger is still down; lifting the
  // finger then fires a synthetic `click` on the full-screen backdrop, which would
  // instantly close the just-opened menu. Ignore backdrop clicks within a short
  // grace window of opening so long-press stays usable.
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
            {isStack && (
              <div className="card-action-status muted">
                {untapped.length} untapped · {tappedCount} tapped
              </div>
            )}
            {!isStack && card.tapped && <div className="card-action-status muted">Tapped</div>}
          </div>
        </div>

        {/* xmage ability picker, anchored to this card */}
        {abilities && abilities.length > 0 && (
          <div className="card-action-abilities">
            {abilities.map((a) => (
              <button
                key={a.key}
                className="btn"
                onClick={() => {
                  onRespond((choiceKind as RespondKind) ?? 'uuid', a.key)
                  onClose()
                }}
              >
                {plain(a.label)}
              </button>
            ))}
          </div>
        )}

        {/* land-stack tap / undo controls */}
        {isStack && interactive && (
          <div className="card-action-stack">
            {untapped.length > 0 && onTapMany && (
              <div className="stack-tap-row">
                <div className="stack-stepper" role="group" aria-label="Lands to tap">
                  <button className="btn ghost" aria-label="Fewer" disabled={tapCount <= 1} onClick={() => setN((v) => Math.max(1, v - 1))}>
                    −
                  </button>
                  <span className="stack-stepper-n">{tapCount}</span>
                  <button
                    className="btn ghost"
                    aria-label="More"
                    disabled={tapCount >= untapped.length}
                    onClick={() => setN((v) => Math.min(untapped.length, v + 1))}
                  >
                    +
                  </button>
                </div>
                <button
                  className="btn primary"
                  onClick={() => {
                    onTapMany(untapped.slice(0, tapCount).map((m) => m.id))
                    onClose()
                  }}
                >
                  Tap {tapCount}
                </button>
              </div>
            )}
            {tappedCount > 0 && (
              // xmage UNDO reverts the most-recent floated mana (repeatable), not a
              // specific permanent — so this is "undo my last tap", not a per-land untap
              <button className="btn" onClick={() => onRespond('action', 'UNDO')}>
                Undo tap
              </button>
            )}
          </div>
        )}

        <div className="card-action-buttons">
          {canPlay && (
            <button className="btn primary" onClick={() => { onRespond('uuid', card.id); onClose() }}>
              {isStack ? 'Tap 1' : 'Play'}
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

function ActionBar({ prompt, onRespond, hideChoice }: { prompt: Prompt | null; onRespond: (kind: RespondKind, value?: string) => void; hideChoice?: boolean }) {
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

      {prompt.kind === 'ask' &&
        (() => {
          // a mulligan ask reads far clearer as Mulligan / Keep than Yes / No
          const mull = /mulligan/i.test(prompt.message ?? '')
          return (
            <>
              <button className="btn primary" onClick={() => onRespond('boolean', 'true')}>
                {mull ? 'Mulligan' : 'Yes'} <span className="skip-key">Y</span>
              </button>
              <button className="btn" onClick={() => onRespond('boolean', 'false')}>
                {mull ? 'Keep' : 'No'} <span className="skip-key">N</span>
              </button>
            </>
          )
        })()}

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

      {prompt.kind === 'choice' && !hideChoice && (
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
