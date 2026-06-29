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
npm run test:gesture       # on-canvas 3D gestures (GESTURE=1) — see section below
```

> This suite covers the **DOM** controls around the 3D board. Gestures **on** the
> WebGL canvas (tap-a-card, long-press, pinch/pan/rotate, wheel/DOM zoom) are
> covered by `tests/gesture-coverage.spec.ts` — see "On-canvas 3D gestures" below.

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
5. **Long-press card preview closed itself on a real touch device.**
   `GameTable.tsx` `CardActionSheet` — a touch long-press opens the action sheet
   *while the finger is still down*; lifting then fires a synthetic `click` on the
   full-screen `.card-action-backdrop`, whose `onClick={onClose}` instantly closed
   the just-opened sheet (so long-press preview was unusable on a phone). Found by
   `gesture-coverage.spec.ts` driving a genuine CDP touch hold+release. Fixed by
   ignoring backdrop clicks within a 400 ms grace window of opening.

## On-canvas 3D gestures — now tested (`tests/gesture-coverage.spec.ts`)

The earlier "intentional exception" — that GPU-raycast card hits and OrbitControls
pan/pinch couldn't be driven deterministically headless — has been **closed**.
A new opt-in suite (`GESTURE=1` — `npm run test:gesture`) drives genuine
pointer/touch/wheel events on the WebGL `<canvas>` and asserts the actual outcome.

The enabler is a small readonly debug hook, `window.__board3d`, added inside the
`<Canvas>` in `Board3D.tsx` (the `BoardDebug` component):

| call | returns |
|------|---------|
| `cards()` | `[{id,x,y}]` — every on-screen card mesh, projected to **canvas pixels** |
| `cardScreenPos(id)` | one card's canvas-pixel position (so a tap can be aimed at a real card) |
| `camera()` | `{pos, target, distance}` — live three.js camera + orbit/look target |
| `zoom()` / `mode()` | the custom zoom factor and current view mode |

It is **always exposed** (not `import.meta.env.DEV`-gated): the test webServer
serves a production `vite build` where `DEV` is `false`, so a DEV gate would hide
it. The object is minimal, side-effect-free, and removed on unmount — acceptable
for a game client. Card meshes carry `userData.cardId` so the hook can project
them; tests add the canvas bounding-box offset to turn canvas pixels into page
pixels for `page.mouse` / `page.touchscreen` / CDP `Input.dispatchTouchEvent`.

| Gesture | Driver | Asserted via the hook |
|---------|--------|-----------------------|
| **Tap a card** (mouse + touch) | `page.mouse.click` / `page.touchscreen.tap` at the projected card pixel | faux backend records `/api/game/respond` `{kind:'uuid', value:<cardId>}` |
| **Long-press preview** (touch) | CDP `touchStart` → 600 ms hold → `touchEnd` | the `.card-action-sheet` opens; a quick CDP tap does **not** |
| **Pinch-zoom** (touch) | two CDP touch points spreading apart | OrbitControls `camera().distance` shrinks |
| **Pan** (touch) | one-finger CDP drag (mobile `free` mode, `ONE: PAN`) | `camera().target` moves |
| **Rotate** (mouse) | `page.mouse` drag in desktop `Free` mode | `camera().pos` moves, `distance` ~constant |
| **Wheel zoom** (mouse) | `page.mouse.wheel` over the canvas (`free` mode) | `camera().distance` changes |
| **DOM zoom controls** | click / tap / Enter on `−` `%` `+` (`3d`/`2d` modes) | `zoom()` factor **and** `camera().distance` change |

Multi-touch (pinch) and one-finger pan/long-press are dispatched through CDP
`Input.dispatchTouchEvent` rather than synthetic `PointerEvent`s, because three's
`OrbitControls` calls `domElement.setPointerCapture(pointerId)` on the first
pointer — a capture that only succeeds for a real (CDP-originated) active pointer,
not a JS-constructed one. Mixing `page.touchscreen.tap` with a separate CDP
session also corrupts the touch state, so each touch test drives one channel.

Everything is verified headless under SwiftShader (software WebGL) — **no gesture
in this list is left "manual / uncovered".** The pinch test additionally asserts
the board boots into `free` mode on a ≤760 px coarse-pointer (mobile) viewport,
where `OrbitControls` maps `ONE → PAN`, `TWO → DOLLY_PAN`, rotation locked.

## Intentional exceptions

- **Deck-entry row preview (`<li onClick/onMouseEnter>`).** The row hosts the real
  `+`/`−` `<button>`s, so it can't itself be a `<button>` (no nested buttons). Its
  click/hover/tap **preview** is a redundant convenience — the same art is
  previewed from the gallery tile (hover + long-press) and the row's quantity
  controls are fully keyboard-operable — so the row is covered by mouse + touch and
  intentionally not given a separate keyboard handler.
- **Decorative-only elements** (brand mark, sheen, phase track, seat glow, life
  flashes) have no action and are out of scope.
