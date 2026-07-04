# Content-independence usability rule + view-fab tooltip fix

Date: 2026-07-03
Status: approved

## Problem

The web client's UI sometimes reshuffles elements when a *sibling's* content
grows or overflows — a long player name widening the player strip and shoving
the life/hand counts, a big number nudging a chip, an overstuffed panel pushing
neighbouring chrome. This "elements jumping around based on other elements'
contents" is the class of defect the user explicitly dislikes.

The existing usability suite (`tests/usability.spec.ts`, opt-in via `AUDIT=1`,
documented in `tests/USABILITY.md`) enforces 10 rules (overflow, no-cover, tap
targets, CLS, bounded animation, idle drift, z-order, readability,
scrollability, focus) — but it renders every screen with a **single fixed
fixture**, so content-driven reflow is never exercised.

Separately, the in-game "View options" fab uses a native `title="View options"`
tooltip that the browser paints over the open camera panel (see the reported
screenshot). Native title tooltips are un-styleable and un-testable.

## Goals

1. Add a programmatic rule that catches content-driven reflow.
2. Replace the native fab tooltip with a controlled, testable one.

Non-goals: touching the WebGL board's canvas-drawn card faces (not DOM, not
box-testable); any unrelated layout refactor.

## Design

### Rule 11 — Content independence (usability.spec.ts, `AUDIT=1`)

Render a screen **twice** — once with **nominal** content, once with
**pathological-but-valid** ("stress") content — and assert:

- **Anchor stability:** a set of content-independent DOM anchors keep the same
  bounding box between the two loads, within a 1px epsilon. If a long name or a
  large number moves an anchor, that's the defect.
- **No new overflow:** the stress load still satisfies rule 1
  (`scrollWidth - clientWidth <= 2`).
- **No new covering:** the stress load still satisfies rule 2 (anchor centres
  hit-test to themselves).

Runs across `REP_VIEWPORTS` (phone / landscape / tablet / laptop).

Because the 3D board draws card faces + power/toughness in a WebGL canvas, the
stress targets **DOM chrome only**: player strip, toolbar, mana pool, bottom
dock, floating log/stack/combat panels.

Custom states are injected with the existing `gotoCustomGame(page, game,
prompt)` harness helper — no new `Scenario` enum values.

#### Game board — anchors and stress dimensions

Anchors (must not move when content varies): `.game-toolbar` Back button, the
phase track (`PhaseTrack`), `.view-fab`, Concede / Rollback.

Stress dimensions (each its own game state):
- 30+ char space-less player names → must ellipsize, not widen the strip.
- 3-digit / negative life totals → must not shift the Active chip / opponent block.
- Long mana-pool string (many pips) → wraps/clips in its slot.
- Overstuffed hand + huge `120/120` focus badge → bottom dock stays put.
- Deep stack + 6-group combat + long log lines → toolbar/dock don't move.

#### Second tier — user-typed text surfaces

Same nominal-vs-stress technique on:
- **Lobby:** long usernames / table names. Anchors: nav tabs, primary buttons.
- **Deck editor:** long deck name + long card names in the visual grid.
  Anchors: nav tabs, primary action buttons.

These are where content is user-controlled and thus most likely to break.

### View-fab tooltip fix (Board3D.tsx)

Replace `title="View options"` on `.view-fab` with a small styled in-DOM
tooltip that:
- is **suppressed while the panel is open** (redundant — the panel is visible),
- when shown (fab hovered/focused, panel closed) is positioned clear of the
  panel region,
- keeps `aria-label="View options"` for accessibility.

Test: with the panel open and the fab hovered, no tooltip covers the panel's
Auto/3D/2D/Free controls (rule-2 hit-test).

## Testing

- New rule 11 block in `tests/usability.spec.ts`, opt-in behind `AUDIT=1`.
- Tooltip regression test in the same suite (or `game`-scoped spec).
- `tests/USABILITY.md` gains a "Rule 11 — Content independence" section and a
  short "content defects found & fixed" note if the new rule surfaces real ones.

## Rollout

Opt-in only (`npm run test:audit`); no change to default CI runtime. Any
violation the rule surfaces is fixed in CSS/component, never by weakening the
check — same contract as the rest of the suite.

## Implementation note (2026-07-03)

Rule 11 landed for the **in-game board** — where the reported reflow lived. It
surfaced four real reflows (long name wrapping the turn label; fat mana pool
wrapping the match clock; wide turn label wrapping the toolbar buttons; long
name widening the player-stat), all fixed in `theme.css` by clamping/ellipsizing
the offending text and pinning the toolbar buttons. See
`frontend/tests/USABILITY.md` for the catalogue.

The **lobby** and **deck-editor** second tier is **deferred**: the test harness
(`installMocks`) only injects custom *game* state, not lobby tables / users or
deck-editor content, so stressing those surfaces needs a harness extension.
Tracked as a follow-up in USABILITY.md. The tooltip fix (native `title` →
controlled `.view-fab-tip`) shipped with a regression test in
`frontend/tests/game.spec.ts`.
