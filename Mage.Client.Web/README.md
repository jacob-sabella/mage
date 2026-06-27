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
- The browser runs the actual new interface (`src/main/resources/web`).

Because the engine, networking and protocol stay shared, all existing
functionality remains reachable — only the presentation layer is new.

## API

| Method | Path              | Body / query                | Result            |
|--------|-------------------|-----------------------------|-------------------|
| POST   | `/api/connect`    | `{host, port, username}`    | `{token, server}` |
| GET    | `/api/tables`     | `?token=…`                  | `[TableDto]`      |
| POST   | `/api/disconnect` | `{token}`                   | `{ok}`            |
| WS     | `/ws`             | `?token=…`                  | server push events|

## What's implemented so far (vertical slice)

- Gateway (`WebClientApp`) on embedded Jetty (via Javalin) — REST + WebSocket.
- Real connection layer reusing the shared `Session`.
- **Login / connect** screen → opens a real upstream session.
- **Lobby** screen → lists live tables from `Session.getTables(...)`.
- WebSocket relays upstream messages/events to the browser (live event log).
- Obsidian dark design system (`web/styles.css`).

These establish the architecture every later screen (deck editor, game table,
draft, tournaments, chat) plugs into.

## Build & run

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
2. Deck editor
3. Game table (battlefield, hand, stack) — render `mage.view.GameView` to the DOM/Canvas
4. Draft / sealed / tournament rooms
5. Chat, preferences, profile
