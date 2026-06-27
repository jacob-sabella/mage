# Mage.Client.FX — modern JavaFX client (work in progress)

A ground-up, modern desktop UI for XMage built on **JavaFX**, intended to
eventually replace the legacy Swing client (`Mage.Client`).

## Why JavaFX (and not a web UI)

The client/server boundary already lives in `Mage.Common`:

- `mage.remote.Session` / `SessionImpl` — the connection
- `mage.interfaces.MageServer` — the server API
- `mage.interfaces.callback.*` — server → client push events
- `mage.view.*` — the serializable DTOs (GameView, CardView, TableView, …)

That transport is **JBoss Remoting over Java serialization**. A non-JVM
front-end (web/Flutter/Tauri) can't speak it without a separate gateway that
re-serializes every call and callback to JSON *and* a full re-implementation of
card/battlefield rendering — which makes "retain all functions" very hard.

A JVM toolkit reuses that entire layer unchanged, so only the **view** is new.
JavaFX gives us CSS theming, FXML, GPU-accelerated rendering, and true
cross-platform desktop support (Windows / macOS / Linux). The game engine and
network protocol stay shared with the Swing client.

## What's implemented so far (vertical slice)

- App shell + navigation (`MageFxApp`) with the **Obsidian** design system
  (`css/obsidian.css`) — the same palette as the new Swing theme.
- Real connection layer (`net/ServerConnection`, `net/FxMageClient`) wrapping
  the shared `Session` — no protocol code duplicated.
- **Login / connect** screen → opens a real session on a background thread.
- **Lobby** screen → lists live tables straight from `Session.getTables(...)`.

These establish the architecture every later screen (deck editor, game table,
draft, tournaments, chat) plugs into.

## Build & run

This module targets **Java 17** (OpenJFX needs 11+), while the rest of the
project still compiles to Java 8, so it is kept out of the default reactor
behind the `fx-client` profile:

```bash
# compile
mvn -Pfx-client -pl Mage.Client.FX -am compile

# run
mvn -Pfx-client -pl Mage.Client.FX -am javafx:run
```

The JavaFX native jars default to the `linux` classifier (CI host). For local
desktop builds override the platform:

```bash
mvn -Pfx-client -Djavafx.platform=mac -pl Mage.Client.FX -am javafx:run   # or: win
```

## Roadmap

1. ✅ Connection + lobby vertical slice
2. Deck editor
3. Game table (battlefield, hand, stack) reusing `cardrender`
4. Draft / sealed / tournament rooms
5. Chat, preferences, profile
