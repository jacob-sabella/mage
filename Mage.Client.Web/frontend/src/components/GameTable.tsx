import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board3D, type BrowsableZone } from './Board3D'
import { ConfirmDialog } from './ConfirmDialog'
import { ZoneBrowser } from './ZoneBrowser'
import type { RespondKind } from '../api'
import { plain } from '../text'
import type { CounterDto, GameCard as CardType, GamePlayer, GameState, Prompt } from '../types'

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
  // spectator affordance: re-watch the table's NEXT game after this one ends
  onWatchNext?: () => void
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
// Key map matches the legacy Swing client: F3 cancel, F4 turn, F5 end step,
// F6 next main, F8 stack resolved, F9 my turn, F11 end step before my turn.
const SKIP_KEYS: Record<string, string> = {
  F3: 'PASS_PRIORITY_CANCEL_ALL_ACTIONS',
  F4: 'PASS_PRIORITY_UNTIL_NEXT_TURN',
  F5: 'PASS_PRIORITY_UNTIL_TURN_END_STEP',
  F6: 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE',
  F8: 'PASS_PRIORITY_UNTIL_STACK_RESOLVED',
  F9: 'PASS_PRIORITY_UNTIL_MY_NEXT_TURN',
  F11: 'PASS_PRIORITY_UNTIL_END_STEP_BEFORE_MY_NEXT_TURN',
}
const SKIP_BUTTONS = [
  { label: 'Turn', key: 'F4', action: 'PASS_PRIORITY_UNTIL_NEXT_TURN', title: 'Skip to the next turn' },
  { label: 'End step', key: 'F5', action: 'PASS_PRIORITY_UNTIL_TURN_END_STEP', title: 'Skip to this turn’s end step' },
  { label: 'Main', key: 'F6', action: 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE', title: 'Skip to the next main phase' },
  { label: 'Resolve', key: 'F8', action: 'PASS_PRIORITY_UNTIL_STACK_RESOLVED', title: 'Skip until the stack is resolved' },
  { label: 'My turn', key: 'F9', action: 'PASS_PRIORITY_UNTIL_MY_NEXT_TURN', title: 'Skip everything until your next turn' },
  { label: 'Pre-turn', key: 'F11', action: 'PASS_PRIORITY_UNTIL_END_STEP_BEFORE_MY_NEXT_TURN', title: 'Skip until the end step just before your turn' },
  { label: 'Cancel', key: 'F3', action: 'PASS_PRIORITY_CANCEL_ALL_ACTIONS', title: 'Cancel all armed skips' },
]

export function GameTable({ game, prompt, interactive, result, onRespond, onTapMany, maximized, onToggleMaximize, onLeave, onPlayAgain, onWatchNext }: Props) {
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
  // zone browser (graveyard / exile / command), opened from the player strip's
  // zone counts or by clicking a pile on the 3D board. Keyed by player NAME so
  // a fresh game push re-resolves to live cards.
  const [zoneBrowser, setZoneBrowser] = useState<{ playerName: string; zone: BrowsableZone } | null>(null)
  // target-candidate picker: dismissed state for the CURRENT prompt (a new
  // prompt re-opens it), plus the ids already sent in a multi-pick
  const [pickerClosed, setPickerClosed] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => {
    setPickerClosed(false)
    setPicked([])
  }, [prompt])
  // revealed / looked-at cards: auto-open the panel when NEW content arrives,
  // stay closed once dismissed until the content changes again
  const [revealOpen, setRevealOpen] = useState(false)
  const seenRevealSig = useRef('')
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
  // Auto-enabled on tiny screens (≤360px) and on SHORT viewports (landscape
  // phones, ≤540px tall) where the normal page layout can't fit board + dock;
  // portrait phones above 360px keep the manual toggle.
  const [boardFocus, setBoardFocus] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 360px), (max-height: 540px)').matches,
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

  // revealed + looked-at cards, merged into one dismissible panel (legacy pops
  // a window per reveal). lookedAt entries may carry nameless cards (id/set/num
  // only) — the browser tile falls back to the set/num face.
  const revealGroups = useMemo(() => {
    const groups: { name: string; cards: CardType[] }[] = []
    for (const g of game?.revealed ?? []) if (g.cards?.length) groups.push(g)
    for (const g of game?.lookedAt ?? []) if (g.cards?.length) groups.push(g)
    return groups
  }, [game])
  const revealSig = useMemo(
    () => revealGroups.map((g) => `${g.name}:${g.cards.map((c) => c.id).join(',')}`).join('|'),
    [revealGroups],
  )
  useEffect(() => {
    if (revealSig && revealSig !== seenRevealSig.current) {
      seenRevealSig.current = revealSig
      setRevealOpen(true)
    }
    if (!revealSig) {
      seenRevealSig.current = ''
      setRevealOpen(false)
    }
  }, [revealSig])

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

  // target-candidate picker: cards NOT on the battlefield (graveyard / library /
  // revealed picks). Empty candidates = ordinary board targeting (no picker).
  const candidates = (interactive && prompt?.kind === 'target' ? prompt.candidates : undefined) ?? []
  const multiPick = candidates.length > 0 && (prompt?.max ?? 0) > 1

  // What a card inside a browser overlay does on click — the normal respond
  // path when the card is actionable (a prompt candidate / playable), else nothing.
  function zoneCardAction(card: CardType): (() => void) | undefined {
    if (!interactive) return undefined
    if (prompt?.kind === 'target') {
      if (candidates.length && !candidates.some((c) => c.id === card.id)) return undefined
      return () => onRespond('uuid', card.id)
    }
    if (game?.canPlay.includes(card.id)) {
      return () => {
        lastActivatedRef.current = { card, t: Date.now() }
        onRespond('uuid', card.id)
      }
    }
    return undefined
  }

  const zoneCards = (p: GamePlayer, zone: BrowsableZone): CardType[] =>
    zone === 'graveyard' ? p.graveyard : zone === 'exile' ? p.exile : p.command ?? []
  const browserPlayer = zoneBrowser ? game.players.find((pl) => pl.name === zoneBrowser.playerName) : undefined

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
        {revealGroups.length > 0 && (
          <button className="btn ghost revealed-chip" onClick={() => setRevealOpen(true)} title="Show revealed cards">
            Revealed ({revealGroups.reduce((a, g) => a + g.cards.length, 0)})
          </button>
        )}
        {interactive && (
          <button className="btn ghost concede" onClick={() => setConfirmConcede(true)}>
            Concede
          </button>
        )}
      </div>


      <div className="player-strip">
        {game.players.map((p) => {
          // ONLY a real target prompt turns seats into targets — a plain priority
          // ('select') click must never send a spurious target response to the
          // server; it focuses the camera on that seat instead.
          const canTarget = interactive && prompt?.kind === 'target'
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
              {p.timeLeft != null && <MatchClock secs={p.timeLeft} running={!!p.timerActive} />}
              <PlayerCounters counters={p.counters} designations={p.designations} />
              <PStatCounts
                hand={p.handCount}
                lib={p.libraryCount}
                grave={p.graveyardCount}
                exile={p.exile.length}
                // during a target prompt the whole seat is the click target — the
                // zone counts must not swallow the targeting click
                onOpenZone={canTarget ? undefined : (zone) => setZoneBrowser({ playerName: p.name, zone })}
              />
              {p.manaPool && (
                <ManaPool
                  pool={p.manaPool}
                  onPay={
                    interactive && prompt && p.name === game.me && !canTarget
                      ? (t) => onRespond('mana', `${t}:${p.id}`)
                      : undefined
                  }
                />
              )}
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
          onOpenZone={(pl, zone) => setZoneBrowser({ playerName: pl.name, zone })}
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

        {/* zone browser: a seat's graveyard / exile / command as a card grid */}
        {zoneBrowser && browserPlayer && (
          <ZoneBrowser
            title={`${browserPlayer.name} — ${zoneBrowser.zone} (${zoneCards(browserPlayer, zoneBrowser.zone).length})`}
            sections={[{ cards: zoneCards(browserPlayer, zoneBrowser.zone) }]}
            onClose={() => setZoneBrowser(null)}
            onHoverCard={handleHoverCard}
            cardAction={zoneCardAction}
          />
        )}

        {/* target-candidate picker: auto-opens when a target prompt carries
            off-battlefield candidates (delve / flashback / tutor picks) */}
        {candidates.length > 0 && !pickerClosed && prompt && (
          <ZoneBrowser
            title={`${plain(prompt.message) || 'Choose a card'}${prompt.candidateZone ? ` — ${prompt.candidateZone}` : ''}`}
            sections={[{ cards: candidates }]}
            onClose={() => setPickerClosed(true)}
            onHoverCard={handleHoverCard}
            picked={picked}
            cardAction={(c) =>
              picked.includes(c.id) || (multiPick && prompt.max > 0 && picked.length >= prompt.max)
                ? undefined
                : () => {
                    onRespond('uuid', c.id)
                    if (multiPick) setPicked((prev) => [...prev, c.id])
                    else setPickerClosed(true)
                  }
            }
            footer={
              multiPick ? (
                <div className="zb-footer">
                  <span className="muted">
                    {prompt.min === prompt.max ? `pick ${prompt.max}` : `pick ${prompt.min}–${prompt.max}`}
                    {picked.length > 0 ? ` · ${picked.length} sent` : ''}
                  </span>
                  <button
                    className="btn primary"
                    // the server flips canCancel on once enough targets are
                    // chosen (each pick round-trips); picks made against THIS
                    // prompt push also count toward the minimum
                    disabled={!prompt.canCancel && picked.length < prompt.min}
                    onClick={() => {
                      // same semantics as the action bar's target Done
                      onRespond('boolean', 'false')
                      setPickerClosed(true)
                    }}
                  >
                    Done
                  </button>
                </div>
              ) : undefined
            }
          />
        )}

        {/* revealed / looked-at cards — read-only, auto-opens on new content,
            reopenable from the toolbar's Revealed chip while content exists */}
        {revealOpen && revealGroups.length > 0 && (
          <ZoneBrowser
            title="Revealed"
            sections={revealGroups}
            onClose={() => setRevealOpen(false)}
            onHoverCard={handleHoverCard}
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

        {result &&
          (() => {
            const won = /won|win|victor/i.test(result)
            const lost = /lost|lose|defeat|conced/i.test(result)
            const outcome = won ? 'win' : lost ? 'loss' : 'neutral'
            return (
              <div className="game-over-overlay">
                <div className={`game-over-card panel game-over-${outcome}`}>
                  <div className="game-over-emoji" aria-hidden>
                    {won ? '🏆' : lost ? '☠️' : '🎴'}
                  </div>
                  <div className="game-over-title">{won ? 'Victory' : lost ? 'Defeat' : 'Game over'}</div>
                  <div className="game-over-msg">{plain(result)}</div>
                  <div className="game-over-actions">
                    {onPlayAgain && (
                      <button className="btn primary" onClick={onPlayAgain}>
                        Play again
                      </button>
                    )}
                    {onWatchNext && (
                      <button className="btn primary" onClick={onWatchNext}>
                        Watch next game
                      </button>
                    )}
                    <button className={`btn${onPlayAgain || onWatchNext ? ' ghost' : ' primary'}`} onClick={onLeave}>
                      Back to lobby
                    </button>
                  </div>
                </div>
              </div>
            )
          })()}

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
            {(() => {
              const armed = game.players.find((p) => p.name === game.me)?.skips ?? []
              return SKIP_BUTTONS.filter((s) => s.key !== 'F3' || armed.length > 0).map((s) => (
                <button
                  key={s.action}
                  className={`btn skip-btn${armed.includes(s.action) ? ' armed' : ''}`}
                  onClick={() => onRespond('action', s.action)}
                  title={`${s.title} (${s.key})`}
                >
                  {s.label} <span className="skip-key">{s.key}</span>
                </button>
              ))
            })()}
          </div>
          {/* special actions: the server ships a single "Special" entry when any
              exist; responding {kind:'string', value:'special'} makes it follow
              up with a choice prompt listing the concrete actions */}
          {(game.special?.length ?? 0) > 0 && (
            <div className="dock-special">
              {game.special.map((s) => (
                <button key={s.id} className="btn special-btn" onClick={() => onRespond('string', s.id)} title="Special actions">
                  ✦ {plain(s.name)}
                </button>
              ))}
            </div>
          )}
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

/** Hand / library / graveyard / exile counts for a seat. On a roomy strip the
 *  labels are spelled out; when the seat chip gets narrow (4-player boards,
 *  phones) it switches to a compact `H4 · L28 · G2 · E0` form so every strip
 *  stays one line tall instead of wrapping into 2-3 ragged lines. Full names
 *  stay in the tooltip. The graveyard/exile counts double as buttons that open
 *  that zone's browser (spans with a button role — the seat chip is itself a
 *  button, so a nested <button> would be invalid HTML). */
function PStatCounts({
  hand,
  lib,
  grave,
  exile,
  onOpenZone,
}: {
  hand: number
  lib: number
  grave: number
  exile: number
  onOpenZone?: (zone: BrowsableZone) => void
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const seat = ref.current?.closest('.pstat')
    if (!seat || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 180))
    ro.observe(seat)
    return () => ro.disconnect()
  }, [])
  const zoneSeg = (text: string, zone: BrowsableZone, label: string) =>
    onOpenZone ? (
      <span
        role="button"
        tabIndex={-1}
        className="pstat-zone-btn"
        title={`Browse ${label}`}
        onClick={(e) => {
          e.stopPropagation() // don't also trigger the seat chip's focus/target click
          onOpenZone(zone)
        }}
      >
        {text}
      </span>
    ) : (
      text
    )
  return (
    <span
      ref={ref}
      className="muted pstat-counts"
      title={`Hand ${hand} · Library ${lib} · Graveyard ${grave} · Exile ${exile}`}
    >
      {compact ? `H${hand} · L${lib} · ` : `Hand ${hand} · Lib ${lib} · `}
      {zoneSeg(compact ? `G${grave}` : `Grave ${grave}`, 'graveyard', 'graveyard')}
      {' · '}
      {zoneSeg(compact ? `E${exile}` : `Exile ${exile}`, 'exile', 'exile')}
    </span>
  )
}

// player-counter glyphs for the common kinds (others render as `name:N`)
const COUNTER_ICON: Record<string, string> = { poison: '☠', energy: '⚡', experience: '✦' }

/** Per-player match clock (only shown when the match has a time limit). The
 *  server sends seconds-left with each push; between pushes we tick locally
 *  while the player's timer is running. Goes red under a minute. */
function MatchClock({ secs, running }: { secs: number; running: boolean }) {
  const [left, setLeft] = useState(secs)
  useEffect(() => setLeft(secs), [secs])
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [running, secs])
  const m = Math.floor(left / 60)
  const s = String(left % 60).padStart(2, '0')
  return (
    <span className={`pstat-clock${left < 60 ? ' low' : ''}${running ? ' running' : ''}`} title="Match time left">
      ⏱{m}:{s}
    </span>
  )
}

/** Player counters (poison/energy/experience/…) + designations (Monarch, …) as
 *  compact one-line chips right after the life total. Zero-count counters are
 *  hidden so a poison-free game shows nothing. */
function PlayerCounters({ counters, designations }: { counters?: CounterDto[]; designations?: string[] }) {
  const cs = (counters ?? []).filter((c) => c.count > 0)
  const ds = designations ?? []
  if (!cs.length && !ds.length) return null
  return (
    <span className="pstat-extras">
      {cs.map((c) => {
        const icon = COUNTER_ICON[c.name.toLowerCase()]
        return (
          <span key={c.name} className={`pstat-counter pc-${c.name.toLowerCase()}`} title={`${c.name}: ${c.count}`}>
            {icon ? `${icon}${c.count}` : `${c.name}:${c.count}`}
          </span>
        )
      })}
      {ds.map((d) => (
        <span key={d} className="chip pstat-desig" title={d}>
          {/^monarch$/i.test(d) ? '👑 ' : ''}
          {d}
        </span>
      ))}
    </span>
  )
}

const MANA_TYPE: Record<string, string> = { W: 'WHITE', U: 'BLUE', B: 'BLACK', R: 'RED', G: 'GREEN', C: 'COLORLESS' }

/** Floating mana pips. When `onPay` is set (your own pool while a prompt is
 *  up) each pip is a button — clicking it offers that mana for the current
 *  payment, like clicking the pool in the legacy client. */
function ManaPool({ pool, onPay }: { pool: string; onPay?: (manaType: string) => void }) {
  const syms = pool.match(/\{(\w)\}/g)?.map((s) => s[1]) ?? []
  if (syms.length === 0) return null
  return (
    <span className="mana-pool" title={onPay ? 'Mana pool — click to pay' : 'Mana pool'}>
      {syms.map((c, i) =>
        onPay && MANA_TYPE[c] ? (
          <button
            key={i}
            className="mana-pip mana-pip-pay"
            style={{ background: MANA_COLOR[c] ?? '#9aa0ad' }}
            aria-label={`Pay ${MANA_TYPE[c].toLowerCase()} mana`}
            onClick={(e) => {
              e.stopPropagation() // the seat chip behind is itself a button
              onPay(MANA_TYPE[c])
            }}
          >
            {c}
          </button>
        ) : (
          <span key={i} className="mana-pip" style={{ background: MANA_COLOR[c] ?? '#9aa0ad' }}>
            {c}
          </span>
        ),
      )}
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
  game.players.forEach((p) => {
    p.battlefield.forEach((c) => (byId[c.id] = c))
    // a castable commander shows up in the playable bar like any other card
    ;(p.command ?? []).forEach((c) => (byId[c.id] = c))
  })
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
        key={img}
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
        {(card.rules?.length ?? 0) > 0 && (
          <div className="card-preview-rules">
            {card.rules!.map((r, i) => (
              <p key={i}>{plain(r)}</p>
            ))}
          </div>
        )}
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

// full label + a deliberate two-char code used when the track is too narrow for
// full names (instead of CSS ellipsis mangling them into 'U..'/'M..' stubs)
const PHASE_SEGMENTS = [
  { label: 'Untap', abbr: 'UT' },
  { label: 'Upkeep', abbr: 'UP' },
  { label: 'Draw', abbr: 'DR' },
  { label: 'Main 1', abbr: 'M1' },
  { label: 'Combat', abbr: 'CB' },
  { label: 'Main 2', abbr: 'M2' },
  { label: 'End', abbr: 'END' },
]
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
 *  where in the turn we are. Below a width threshold the segments switch to
 *  fixed two-char codes (UT/UP/DR/M1/CB/M2/END) — the full name stays in the
 *  title tooltip — instead of ellipsizing into unreadable 'U..' stubs. */
function PhaseTrack({ phase, step }: { phase?: string | null; step?: string | null }) {
  const idx = phaseIndex(phase, step)
  const trackRef = useRef<HTMLDivElement>(null)
  const [abbr, setAbbr] = useState(false)
  useEffect(() => {
    const el = trackRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // ~7 full-name segments need ≈340px; below that, two-char codes
    const ro = new ResizeObserver(([entry]) => setAbbr(entry.contentRect.width < 340))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className={`phase-track${abbr ? ' abbr' : ''}`} ref={trackRef} aria-label="turn phase">
      {PHASE_SEGMENTS.map((seg, i) => (
        <div
          key={seg.label}
          className={`phase-seg${i === idx ? ' active' : i < idx ? ' past' : ''}`}
          title={i === idx && step ? `${seg.label} — ${step}` : seg.label}
        >
          {abbr ? seg.abbr : seg.label}
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
