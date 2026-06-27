# Mage.Client.Web — modern web client (work in progress)

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

| Method | Path                 | Body / query                          | Result            |
|--------|----------------------|---------------------------------------|-------------------|
| POST   | `/api/connect`       | `{host, port, username}`              | `{token, server}` |
| GET    | `/api/tables`        | `?token=…`                            | `[TableDto]`      |
| POST   | `/api/chat`          | `{token, message}`                    | `{ok}`            |
| POST   | `/api/watch`         | `{token, gameId}`                     | `{ok}` (board via WS) |
| POST   | `/api/join`          | `{token, tableId, deckPath}`          | `{ok}` (start via WS) |
| POST   | `/api/game/respond`  | `{token, gameId, kind, value}`        | `{ok}`            |
| POST   | `/api/disconnect`    | `{token}`                             | `{ok}`            |
| WS     | `/ws`                | `?token=…`                            | server push events|

WebSocket frames: `chat`, `game` (board + optional decision `prompt`),
`gameStart` (a joined match began), `message` / `error` / `event`.
`respond` kinds: `boolean`, `uuid`, `integer`, `string`, `action`, `concede`.

## What's implemented so far (vertical slice)

- Gateway (`WebClientApp`) on embedded Jetty (via Javalin) — REST + WebSocket.
- Real connection layer reusing the shared `Session`.
- **Login / connect** screen → opens a real upstream session.
- **Lobby** screen → lists live tables from `Session.getTables(...)`.
- WebSocket relays upstream messages/events to the browser (live event log).
- React + Vite + TypeScript frontend with an Obsidian dark design system.

These establish the architecture every later screen (deck editor, game table,
draft, tournaments, chat) plugs into.

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
proxies `/api` and `/ws` to the gateway on :8080:

```bash
cd frontend && npm run dev      # http://localhost:5173
```

## Gateway — build & run

Targets **Java 17** (Javalin/Jetty need 11+), while the rest of the project
still compiles to Java 8, so it's kept out of the default reactor behind the
`web-client` profile:

```bash
# compile
mvn -Pweb-client -pl Mage.Client.Web -am compile

# run the gateway + UI (defaults to port 8080, or set MAGE_WEB_PORT)
mvn -Pweb-client -pl Mage.Client.Web -am exec:java
```

Then open <http://localhost:8080> and connect to a running XMage server
(default `localhost:17171`).

## Roadmap

1. ✅ Gateway + connection + lobby vertical slice
2. ✅ Live chat (shared `ChatSession`)
3. ✅ Game table — spectate a live `GameView` (board, stack, phase)
4. ✅ Interactive play — join a table with a deck; priority / target / choice /
   amount decisions over the WebSocket, responses via `/api/game/respond`
5. Richer board: hand/graveyard/exile zones, combat arrows, card images
6. Deck editor (pairs with table creation + deck management)
7. Draft / sealed / tournament rooms; preferences, profile

### Notes on interactive play

- Decisions arrive as a `prompt` on the `game` WS frame and are projected by
  `PromptDto` (`ask` / `select` / `target` / `amount` / `choice` / `generic`).
- `/api/join` loads a `.dck` via the engine's `DeckImporter`; `deckPath` is a
  path on the **server** (gateway) host. The default sample deck is
  `Mage.Client/release/sample-decks/AI/FastRedHaste.dck`.
- Mana payment, pile, and ability-pick prompts currently render as generic
  (cancellable) prompts; dedicated controls are a follow-up.
