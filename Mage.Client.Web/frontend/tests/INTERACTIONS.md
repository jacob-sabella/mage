# Interaction-coverage suite

`tests/interaction-coverage.spec.ts` — opt-in via `INTERACT=1`
(`npm run test:interact`). Where the **usability** suite (`AUDIT=1`) audits how
the UI *looks* (layout, overflow, focus-visible, motion), this suite audits how
the UI *behaves*: every interactive control is driven through the input
modalities that apply to it and the **outcome** is asserted each way. A control
that works on click but not tap, or that the keyboard can't reach/fire, is a bug
fixed at the source — never by weakening the assertion.

It is **gated** (not part of the default `npm test` run) because it drives full
page loads across mouse/touch/keyboard for every view (~61 tests, ~40s). Run it
explicitly:

```
npm run test:interact      # this suite (INTERACT=1)
npm test                   # default integration suite (stays green; this file self-skips)
npm run test:audit         # usability/layout suite (AUDIT=1)
```

## The three modalities

| Modality   | Driver                                   | Asserts |
|------------|------------------------------------------|---------|
| **Mouse**  | `locator.click()`                        | the effect (modal opens, count changes, card played, nav switches, network respond fires) |
| **Touch**  | `locator.tap()` in a `hasTouch` + `isMobile` context | the *same* effect — a tap target that works on click but not tap is a bug |
| **Keyboard** | `locator.focus()` → `keyboard.press('Enter' \| 'Space')` | the same effect; native `<button>`/`<a>`/inputs just work, custom clickable `<div>`/`<span>` must be made real controls |

Touch blocks run at `768×1024` with `isMobile: true` so the browser reports a
coarse, hover-incapable pointer (`@media (hover: none)`) — the realistic mobile
condition — while staying wide enough that chat + the 3D board (both gated at
≤760px) keep all controls on-screen.

## Controls × modalities covered

| View | Controls | Mouse | Touch | Keyboard | Modality-specific |
|------|----------|:---:|:---:|:---:|---|
| **Login** | server presets, Connect, name field | ✓ | ✓ | ✓ | Enter-in-field connects; every preset + Connect focusable |
| **Lobby + top nav** | New game, Draft vs AI, History, Refresh, Disconnect, Play/Deck/Settings tabs, Join/Watch row actions, chat hide/show | ✓ | ✓ | ✓ | Space activates a button; all primary controls focusable |
| **TableSetup modal** | format `<select>`, AI/Open seat steppers, deck list, Advanced toggle, Create/Start | ✓ | ✓ | ✓ | Enter on steppers; **Esc closes the modal** |
| **WaitingRoom** | Add AI, Start match (gated on full), Cancel table | ✓ | ✓ | ✓ | Start enables only once seats fill |
| **Deck editor** | search input, Search, +/- on entries, basics, gallery/table view toggle, Import, Open, New, Save, Sample hand, card-tile add/remove | ✓ | ✓ | ✓ | **`/` focuses search**, Enter searches; hover preview (mouse) / tap preview + long-press (touch); in-deck **remove (−) badge visible on touch** |
| **Card preview** | board hover/right-click, deck-list hover, deck-entry/tile tap | ✓ | ✓ | ✓ (stack item) | hover (desktop), tap/long-press (touch), focus (stack item) |
| **3D game board** | Pass, Done, Yes/No, skip-bar, playable chips, view menu, zoom +/-, zoom-reset %, stack item | ✓ | ✓ | ✓ | **hotkeys** `P`/Space (pass), `D` (done), `Y`/`N` (ask), `F2` (skip to next turn); view-fab + zoom respond to tap |
| **Game over** | Play again, Back to lobby | ✓ | ✓ | ✓ | |
| **Settings** | checkboxes (card images, mana, motion, sound), theme swatches, sliders | ✓ | ✓ | ✓ | Space toggles a focused checkbox |
| **Draft / Construct** | booster pick, Auto-build, Submit, basics steppers | ✓ | ✓ | ✓ | Enter picks a card / submits the deck |
| **Global / overlays** | `?` shortcuts overlay, help FAB, Report problem, `Esc` to close | ✓ | ✓ | ✓ | `?` opens overlay, `Esc` closes any modal/overlay |

## Interaction bugs found & fixed (source, not tests)

1. **Zoom-% reset was a `<span onClick>` (keyboard-dead).** `Board3D.tsx`
   `ZoomBar` — converted to a real `<button>` (+ CSS reset), so the "reset zoom"
   affordance is focusable and fires on Enter/Space.
2. **Stack item was a `<div onClick>` (keyboard-dead).** `GameTable.tsx` stack
   panel — converted to a `<button>` with `onFocus`/`onBlur` preview, so the
   resolving-spell preview is keyboard-reachable.
3. **In-deck "remove (−)" badge was hover-only → unreachable on touch.**
   `theme.css` `.card-tile-remove` was `opacity:0` until `.card-tile:hover`; on a
   touch device (no hover) the control was invisible. Added
   `@media (hover: none) { … opacity: 1 }` plus a `:focus-visible` reveal, so the
   badge is visible/usable on touch and keyboard, matching the gallery's tap-to-add.
4. **Deck-list +/- (and the whole entry list) became unclickable on short
   desktop heights.** The pinned card preview (`flex: 1`) starved the scrollable
   entry list to ~0px so rows bled *behind* the foot, and `.deck-list-foot`
   intercepted clicks. Fixed in `theme.css`: the deck-list preview is now a
   bounded height (`clamp(150px,26vh,240px)`), the entry body keeps a real
   `min-height: 140px`, and the panel itself scrolls when over-constrained — so
   the entry controls are always reachable by mouse/touch/keyboard.

## Intentional exceptions

- **3D board canvas gestures (pan / pinch-zoom / tap-a-card on the WebGL
  surface).** The board is a react-three-fiber `<canvas>`; card hits are resolved
  by GPU raycasting, which Playwright's synthetic taps/pointers can't address
  deterministically headless. We instead assert the touch-reachable **DOM**
  controls that drive the same outcomes — the view menu (`Overview`/`2D`/`3D`/
  `Auto`, per-seat focus), the zoom `+`/`−`/reset, and the playable chips — plus
  the long-press/right-click/hover preview wiring in `Board3D.tsx`. The OrbitControls
  pan/pinch path (mobile "free" mode) is exercised manually, not in CI.
- **Deck-entry row preview (`<li onClick/onMouseEnter>`).** The row hosts the real
  `+`/`−` `<button>`s, so it can't itself be a `<button>` (no nested buttons). Its
  click/hover/tap **preview** is a redundant convenience — the same art is
  previewed from the gallery tile (hover + long-press) and the row's quantity
  controls are fully keyboard-operable — so the row is covered by mouse + touch and
  intentionally not given a separate keyboard handler.
- **Decorative-only elements** (brand mark, sheen, phase track, seat glow, life
  flashes) have no action and are out of scope.
