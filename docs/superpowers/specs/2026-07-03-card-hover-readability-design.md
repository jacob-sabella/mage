# Card readability: cursor hover bubble + board enlarge + sharper art

Date: 2026-07-03
Status: approved

## Problem

Reading cards in a live game is hard. The hover preview is a small fixed panel
at the bottom-left — far from where the player is looking — with 12.5px rules
text. Cards on the 3D board are only readable when the camera is close, and the
gateway fetches Scryfall art at the default ~488×680, which goes soft when the
camera zooms in.

## Design

### 1. Cursor hover bubble (game board only)

Replace the game board's bottom-left `CardPreview` with a floating bubble that
appears beside the hovered card:

- `GameTable` keeps one `pointermove` listener writing the cursor position to a
  ref (no re-renders). When a hover sets the preview card, the bubble positions
  `fixed` beside that point: right of the cursor by default, flipped left when
  it would overflow, clamped vertically.
- The anchor is captured once per hovered card — the bubble does not chase the
  cursor pixel-by-pixel.
- Content: card image ~280px wide, name + mana cost, type line, P/T or loyalty,
  rules text at 14px.
- `pointer-events: none` so the bubble can never steal the hover (the flicker
  loop the old preview solved by other means).
- Touch devices keep the existing long-press `CardZoomOverlay`; the bubble is a
  hover (mouse) affordance.
- The deck editor keeps its column panel — it is load-bearing in that layout
  and separately audited (usability rule 8b).

### 2. Bigger hover-enlarge on the board

`Card3D`'s hover pop grows from 1.14×/0.28 lift to ~1.4×/0.5 lift. The two
hazards are already solved in the code: the invisible stable hit-mesh prevents
the enter/leave feedback loop, and badges are in-scene (occludable) rather than
DOM overlays. The old size was small only because the corner preview was the
designated "full read" — the bubble takes that job now.

### 3. Sharper art textures

`ImageDownloader` requests Scryfall `format=image&version=large` (672×936)
instead of the default (~488×680). Newly downloaded images are crisper on the
board; the existing cache re-downloads through the usual settings flow. No
client change — the texture pipeline already uses mipmaps + max anisotropy.

## Testing

- `game.spec.ts`: bubble appears near the hover point, flips/clamps at screen
  edges, carries ≥14px rules text, disappears on unhover, and the old fixed
  panel is gone from the board.
- Re-run the usability audit — rule 4 (CLS on hover) and rule 11 (content
  independence) both guard exactly this surface.

## Rollout

Frontend + one-line gateway change, deployed via the vibe branch / watchtower
flow. Java change requires a JVM restart on deployment targets. `version=large`
affects newly downloaded images only — the existing cache keeps its resolution
until re-downloaded from settings.

## Implementation notes (2026-07-03)

- The bubble anchors from a window-capture `pointermove`/`pointerover` listener:
  capture phase is required because both DOM enter handlers and the 3D canvas's
  raycast enter fire mid-event, before bubble-phase listeners — the first
  implementation anchored at a stale (0,0).
- Placement measures `offsetWidth/Height` under a `ResizeObserver`: the base
  `.card-preview-img { flex: 1 }` rule (flex-basis 0%) collapsed the image on
  first layout, so a one-shot measure placed the bubble off-screen; the bubble's
  image is also `flex: 0 0 auto` now so the first layout is final.
- Suites after the change: default 158 passed, AUDIT 227 passed,
  INTERACT 66 passed.
