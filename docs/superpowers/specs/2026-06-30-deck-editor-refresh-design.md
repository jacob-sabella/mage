# Deck Editor Refresh — Design

Status: **in progress** (approved 2026-06-30; user ran `/loop complete all phases`).
Branch: `vibe/xmage-claude-react-ui`. Frontend: `Mage.Client.Web/frontend`.
Gateway (Java search backend): `Mage.Client.Web/src/main/java/mage/client/web`.

## Problem

The deck editor looks clean but fails on functionality. Root causes (from code):
- **Search is name-only** (`CardCriteria.nameContains`) + a type dropdown + one exact CMC.
  No oracle text, keywords, CMC ranges, P/T, set, or legality. You can only find cards you
  already know by name — the core failure.
- **No format awareness**: `X/60` + 4-copy limit hardcoded. No Commander (singleton/commander
  zone), no Cube, no legality.
- Thin analytics (just a mana curve). Slow add flow. Sideboard+Commander jammed into one list.
  Static 7-card "playtest". Results capped at 100.

## Community benchmark (research)

Moxfield = cleanest UI + powerful instant search + hotkeys + packages. Archidekt = visual,
category-based grouping. Universal wants: search by name/type/ability/text (Scryfall syntax),
real-time stats (curve, colors, ratios), goldfish playtest, import/export, drag-drop or text add.

## Direction — keep the look, rebuild the engine. Three phases.

### Phase 1 — Real search  ✅ (shipping)
- **Backend** `CardSearchQuery` (isolated parser) + rewired `handleCardSearch`. Scryfall-lite:
  bare words = name (ANDed); `t:` type/subtype/supertype; `o:` oracle (`CardCriteria.rules`);
  `mv|cmc` with `>= <= > < = :`; `pow|tou` with ops; `c:`/`color:`; `r:` rarity; `s:`/`set:`.
  DB-native where possible (name, rules, types, sub/supertypes, rarities, sets, exact mv);
  colours + mv ranges + P/T post-filtered in the fetch loop. Legacy `type`/`cmc`/`colors`
  params folded into the query string (one parse path; old filter rail still works).
- **Frontend**: syntax-aware search box, `?` popover documenting the grammar (click-to-run
  examples), quick-search chips. Filter rail retained.
- Tests: `deckSearch.spec.ts` (q passed verbatim, chips, popover). Existing deck tests updated.

### Phase 2 — Format-aware zones  (next)
- `Format` model → `{minMain, copyLimit, singleton, hasCommander, sideboardMax}`.
- Formats: Constructed-60 (4-of, 15 SB), Commander (100, singleton, commander zone,
  color-identity), Cube/Limited (singleton-ish / 40), Freeform (no nagging).
- Separate Maindeck / Sideboard / Commander zones; move cards between; legality + copy-limit
  warnings driven by the selected format (replace hardcoded 60/4).
- Needs a `id:` color-identity post-filter (CardInfo may need a getter — verify).

### Phase 3 — Build feel  (after)
- Richer live analytics: curve + color-source pips + type counts + avg MV + land count.
- Fast add: drag-drop results→deck, quantity stepper, shift=playset (respect singleton).
- Visual deck-grid toggle. Real goldfish playtest (draw / mulligan / scry / draw-step).
- 3-pane desktop layout (filter rail · results · deck), tabbed/stacked on mobile.

## Build/verify notes
- Gateway compile: `mvn -Pweb-client -pl Mage.Client.Web compile` (needs the `-Pweb-client`
  profile; module artifactId `mage-client-web`). Online (deps resolve slowly).
- Frontend: `npm run build`; tests `CI=1 npx playwright test …` (CI forces a fresh build —
  reuseExistingServer serves stale otherwise). Card DB search uses the mock harness in faux
  tests, so frontend tests don't need the gateway.
- Sync the vibe branch before each commit (other AI push too). Commit source, then rebuild
  bundled assets separately.
