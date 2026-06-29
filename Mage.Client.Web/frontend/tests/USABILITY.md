# Usability ruleset (human-centric)

This is the enforced contract for the web client's UI. Every rule below is
checked programmatically by `tests/usability.spec.ts` (opt-in via `AUDIT=1`,
run with `npm run test:audit`) across the full viewport matrix (280px → 2560px,
portrait + landscape) and every view (login, lobby / Open tables, deck editor
gallery + table, deck-picker modal, card preview, 3D game board, **dense 3- and
4-player boards** (`game3p` / `game4p` — worst-case multiplayer layouts: ~18
permanents per seat, full hands, a 3-deep stack, a 6-group combat panel),
settings, match history, draft, construct, game-over, shortcuts overlay).

A violation is a real defect: the fix goes in the CSS / component, never in the
test. The goal is a UI that never cuts content off, never hides or covers a
control, never jumps or jitters, and stays readable and reachable everywhere.

## The rules

1. **No horizontal overflow.** `documentElement.scrollWidth - clientWidth <= 2`
   on every view at every viewport. Content is never cut off the side.

2. **No covering / clipping of controls or text.** Hit-test the centre of every
   primary control with `elementFromPoint`; it must resolve to that control (or
   a descendant), not something painted on top. Off-screen-but-scrollable is OK;
   on-screen-and-covered is not.

3. **Comfortable tap targets.** Primary controls are ≥ 40×40px on mobile
   (viewport ≤ 760px wide) and ≥ 24px on desktop. Undersized = fail.

4. **No layout shift (CLS).** Cumulative Layout Shift measured by a
   `PerformanceObserver` over load and over common interactions (hovering a
   card / deck entry, opening a modal) stays below 0.05. Hovering must never
   reflow surrounding elements.

5. **No jarring / unbounded animation.** Computed `animation-duration` /
   `transition-duration` on visible elements is bounded (≤ 600ms) unless the
   element is a clearly decorative looping element (allowlisted by class:
   backdrops, spinners, glows, pulses). With `reduce-motion` set there must be
   no non-trivial motion: every animation/transition duration collapses to ~0
   and the decorative 3D backdrop is not mounted.

6. **No random / unexpected movement.** Key controls sampled twice ~1s apart
   with no interaction must not move beyond a 1px epsilon (decorative animated
   backdrops are excluded by class).

7. **Correct z-order.** Modals / overlays / toasts / dialogs render above page
   content and are hit-testable on top; floating in-game panels (log, stack,
   combat) must not cover the primary turn controls. On the dense `game3p` /
   `game4p` boards this is enforced geometrically: the floating stack/combat
   rail (`.overlay-tr`), the game log and the player-strip must not overlap each
   other or the Pass / Done / play-chip / view-fab controls at any viewport.

8. **Readable text.** No primary text below 11px. Uppercase micro-labels, mana
   pips and similar decorative glyphs are exempt; body/control text is not.
   Text clipped by `overflow:hidden` mid-content must carry an ellipsis.

9. **Scrollability.** Any view whose content exceeds the viewport exposes a
   scroll container — nothing important is trapped off-screen and unreachable.

10. **Visible keyboard focus.** Primary interactive controls are focusable and
    the app ships a `:focus-visible` styling rule so keyboard users can see
    where they are.

## Dense multiplayer boards — layout defects found & fixed

Adding the `game3p` / `game4p` screens to the matrix surfaced three real layout
defects on worst-case multiplayer boards (all fixed in `theme.css`, never by
weakening the check):

1. **Stack/combat rail grew down into the bottom-right game log (desktop /
   tablet / landscape).** A 3-deep stack + 6-group combat made the top-right
   `.overlay-tr` rail tall enough to collide with the log on short boards. Fixed
   by capping the rail and the log to disjoint vertical bands (`max-height: 50%`
   on the rail with `overflow-y:auto`; `min(180px,34%)` on the log) so the rail
   scrolls inside its band instead of reaching the log.
2. **Log (top-right) and stack/combat rail (top-left) collided in the middle on
   phones.** Both were wide enough to meet near the centre. Fixed by making both
   narrow (`min(150px,42vw)` log, `min(160px,46vw)` rail) so they can never
   touch even at 280px.
3. **The 3-4 seat player-strip wrapped to 2-4 tall rows on phones, squeezing the
   board so the floating combat rail covered the bottom dock's play-chips.**
   Fixed by making the mobile player-strip a single horizontally-scrollable row
   (`flex-wrap: nowrap; overflow-x: auto`) so it stays ~one line high and leaves
   the board real estate.
</content>
