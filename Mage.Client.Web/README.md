# Mage.Client.Web — modern web client

A ground-up, browser-based UI for XMage, intended to eventually replace the
legacy Swing client (`Mage.Client`).

## Architecture

Browsers can't speak the XMage server's transport (**JBoss Remoting over Java
serialization**), so this module is a thin **JVM gateway** that sits in the
middle and reuses the shared `Mage.Common` session unchanged:

```
browser  ⇄  HTTP/WS + JSON  ⇄  gateway (this module)  ⇄  JBoss remoting  ⇄  XMage server
```

- The gateway opens a real upstream session per browser via
  `mage.remote.Session` (`net/ServerConnection`, `net/WebMageClient`) — no
  protocol or serialization code is duplicated.
- It exposes a small HTTP + WebSocket/JSON API and serves the static web UI.
- The browser runs the actual new interface — a **React + Vite + TypeScript**
  app in `frontend/`, built into `src/main/resources/web`.

Because the engine, networking and protocol stay shared, all existing
functionality remains reachable — only the presentation layer is new.

## API

| Method | Path                 | Body / query                          | Result                 |
|--------|----------------------|---------------------------------------|------------------------|
| POST   | `/api/connect`       | `{host, port, username}`              | `{token, server}`      |
| GET    | `/api/session`       | `?token=…`                            | `{ok, server}` (resume)|
| GET    | `/api/tables`        | `?token=…`                            | `[TableDto]`           |
| GET    | `/api/matches`       | `?token=…`                            | `[MatchDto]` (history) |
| POST   | `/api/chat`          | `{token, message}`                    | `{ok}`                 |
| POST   | `/api/watch`         | `{token, gameId}`                     | `{ok}` (board via WS)  |
| POST   | `/api/join`          | `{token, tableId, deckPath}`          | `{ok}` (start via WS)  |
| POST   | `/api/tables/create` | `{token, deckPath}`                   | `{ok, tableId}` (vs AI)|
| POST   | `/api/game/respond`  | `{token, gameId, kind, value}`        | `{ok}`                 |
| GET    | `/api/cards/search`  | `?q=&colors=&type=&cmc=`              | `[CardInfoDto]`        |
| GET    | `/api/cardimg`       | `?set=&num=&name=`                     | image/jpeg (real art)  |
| GET    | `/api/decks/load`    | `?path=…`                             | `{name, cards, sideboard}` |
| POST   | `/api/decks/save`    | `{name, cards, path?}`                | `{ok, path}`           |
| POST   | `/api/disconnect`    | `{token}`                             | `{ok}`                 |
| WS     | `/ws`                | `?token=…`                            | server push events     |

WebSocket frames: `chat`, `game` (board + optional decision `prompt`),
`gameStart`, `log` (game narration), `message` / `error` / `event`.
`respond` kinds: `boolean`, `uuid`, `integer`, `string`, `action`, `concede`.
Decision prompts (`PromptDto.kind`): `ask` · `select` (priority; Pass=false,
Done=true) · `target` (cards **and** players) · `amount` · `choice`
(`choiceKind` string|uuid) · `generic`. The action kind sends a
`PlayerAction` (skip/stops, e.g. `PASS_PRIORITY_UNTIL_MY_NEXT_TURN`).

## Implemented

- **Connect** — official-server presets (Beta/US/EU/EU2/Local); real server
  errors surfaced (e.g. version mismatch). **Session resume** across refresh.
- **Lobby** — live tables (Watch / Join), **New game vs AI** (Freeform
  Commander, seats a `COMPUTER_MAD` opponent + you, starts the match), room
  **chat**, **match history**.
- **Game** — live board (players/life/zones, hand, stack, **combat display**),
  real **card art** from a desktop client's image cache. Interactive play:
  priority (play/Pass/Done), targets (cards **and** players), mulligan, choices,
  amounts, **ability-picker**, discard, concede. **Game log**. **Skip/stops**
  bar with F2/F4/F6/F9/F10 shortcuts (`PlayerAction` passes).
- **Deck editor** — card **search with filters** (color/type/cmc), build with
  quantities, **stats** (mana curve, color pips, type counts), **sideboard**,
  **open** an existing `.dck`, and **save** to `.dck`.
- **Look & feel** — Obsidian dark theme, three.js particle backdrop,
  framer-motion card motion (shared-element zone transitions).

### Critical detail

Callback payloads are compressed: `WebMageClient.onCallback` must call
`callback.decompressData()` before `getData()`, or every game-state callback
throws `IllegalStateException: Client data must be decompressed first` and the
board/prompts never reach the browser.

## Project layout

```
Mage.Client.Web/
├── frontend/                     React + Vite + TypeScript source (the UI)
│   └── src/{api,useServerEvents,components/*}
├── src/main/java/mage/client/web  the JVM gateway
└── src/main/resources/web        built UI served by the gateway (generated)
```

## Frontend (React)

The Vite build outputs straight into the gateway's static dir, so the built UI
is committed and the gateway runs without Node. Rebuild after UI changes:

```bash
cd frontend
npm install
npm run build          # → ../src/main/resources/web
```

For fast UI iteration, run the gateway (below) and the Vite dev server, which
proxies `/api` and `/ws` to the gateway on :8090:

```bash
cd frontend && npm run dev      # http://localhost:5173
```

## Gateway — build & run

Targets **Java 17** (Javalin/Jetty need 11+), while the rest of the project
still compiles to Java 8, so it's kept out of the default reactor behind the
`web-client` profile.

**JBoss Remoting + Java serialization needs `--add-opens` on Java 9+** — without
them, login fails with `Unable to make ... java.io.ObjectOutputStream.clear()
accessible`. The provided script sets them:

```bash
# build the gateway + deps, then run with the required --add-opens (port 8090)
mvn -Pweb-client -pl Mage.Client.Web -am package -DskipTests
./Mage.Client.Web/scripts/run-gateway.sh [port]
```

`scripts/run-gateway.sh` resolves the runtime classpath via Maven (cached in
`target/gateway-classpath.txt`) and launches `WebClientApp` with the
`--add-opens` flags JBoss needs on Java 9+.

Optionally set `MAGE_IMAGE_DIR` to a desktop client's image cache
(`.../mage-client/plugins/images`) for real card art. Then open
<http://localhost:8090> and connect (default server `localhost:17171`).

The card search / deck load / image features use the engine's local
`CardRepository`; point the gateway's working dir at a populated `db/` (e.g.
copy a server's `db/cards.h2.mv.db`) or it returns empty results.

## Tests

Playwright integration tests drive the built UI in a headless browser against a
**faux backend** (stubbed REST + a mock WebSocket with sample data,
`frontend/tests/harness.ts`) — deterministic, no gateway/server needed.

```bash
cd frontend && npm test
```

`gotoScreen(page, 'game' | 'lobby' | 'mulligan' | 'target' | 'combat')` jumps
straight to a populated screen, so tests (and development) skip the connect/
deck-pick setup. Coverage: login + presets, lobby (tables, Join/Watch, history),
deck picker, 3D board + status strip + snap-views, prompts (priority/mulligan/
target/declare-attackers), the playable-cards bar, respond round-trip, deck
editor, settings persistence.

**Live smoke test** (`npm run smoke`, needs `ws` + a running gateway/server):
`scripts/smoke-game.mjs` creates a real game vs AI and auto-plays it through the
gateway, asserting the protocol loop survives every prompt kind and every combat
phase (priority, mana payment, attackers, blockers, combat damage) with no
respond errors. It's exploratory (its auto-play policy is best-effort, so depth
varies) — the deterministic guarantee is the Playwright suite above; this is for
flushing out real-server regressions.

## Roadmap

Done: connect + presets + resume · lobby + chat + match history · spectate ·
create-game-vs-AI · interactive play (priority/target incl. players/mulligan/
choice/amount/ability-picker/discard/concede) · skip/stops + F-keys · combat
display · game log · card art · deck editor (search+filters/build/stats/
sideboard/open/save) · 3D + motion.

Resilience: a keep-alive ping holds the upstream session open, and the browser
WebSocket auto-reconnects; the board is adopted from the first game frame so a
missed `gameStart` still opens it.

Not yet: replay playback (needs server history enabled) · tournaments
(draft/sealed) · profile/avatar · preferences persistence (beyond card-images).
Combat/scry/mana ergonomics want more live playtesting.

### Notes on interactive play

- Decisions arrive as a `prompt` on the `game` WS frame, projected by
  `PromptDto`. Cards and players are clickable targets; the action bar adapts
  to the prompt kind.
- `/api/join` and `/api/tables/create` load a `.dck` via the engine's
  `DeckImporter`; `deckPath` is a path on the **gateway** host.
- Mana payment maps to click-a-source (target). Pile / multi-amount prompts
  still render as generic (cancellable) prompts; dedicated controls are a
  follow-up.
