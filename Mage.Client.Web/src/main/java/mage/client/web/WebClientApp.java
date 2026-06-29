package mage.client.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.http.Context;
import io.javalin.http.staticfiles.Location;
import io.javalin.websocket.WsContext;
import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.cards.decks.importer.DeckImporter;
import mage.cards.decks.exporter.XmageDeckExporter;
import mage.cards.repository.CardCriteria;
import mage.cards.repository.CardInfo;
import mage.cards.repository.CardRepository;
import mage.client.web.dto.CardInfoDto;
import mage.client.web.dto.DraftDto;
import mage.client.web.dto.GameDto;
import mage.client.web.dto.PromptDto;
import mage.client.web.dto.TableDto;
import mage.client.web.net.ServerConnection;
import mage.constants.PlayerAction;
import mage.interfaces.callback.ClientCallback;
import mage.interfaces.callback.ClientCallbackMethod;
import mage.interfaces.callback.ClientCallbackType;
import mage.view.ChatMessage;
import mage.view.GameClientMessage;
import mage.view.GameView;
import mage.view.TableClientMessage;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Web gateway + UI host for the modern browser-based XMage client.
 * <p>
 * Architecture: browsers can't speak the server's JBoss/Java-serialization
 * transport, so this JVM process sits in the middle. It reuses the shared
 * {@link ServerConnection}/{@code Session} to talk upstream, and exposes a
 * small HTTP + WebSocket/JSON API plus the static web UI to the browser.
 *
 * <pre>
 *   browser  ⇄  (HTTP/WS + JSON)  ⇄  gateway  ⇄  (JBoss remoting)  ⇄  XMage server
 * </pre>
 *
 * Endpoints:
 *   POST /api/connect    {host, port, username}  → {token}
 *   GET  /api/tables?token=...                   → [TableDto]
 *   POST /api/disconnect {token}                 → {ok}
 *   WS   /ws?token=...                            → server push (messages/events)
 *
 * @author XMage web client
 */
public class WebClientApp {

    private final SessionRegistry sessions = new SessionRegistry();
    // token -> live websocket, so upstream callbacks can be pushed to the browser
    private final ConcurrentHashMap<String, WsContext> sockets = new ConcurrentHashMap<>();
    // token -> last log line sent; used to suppress consecutive duplicate log spam
    private final ConcurrentHashMap<String, String> lastLogLine = new ConcurrentHashMap<>();
    private final ObjectMapper json = new ObjectMapper();
    // outbound HTTP client for server-side GitHub issue creation (report-a-problem)
    private final java.net.http.HttpClient http = java.net.http.HttpClient.newBuilder()
            .connectTimeout(java.time.Duration.ofSeconds(10))
            .build();
    // real card art from a desktop XMage client's downloaded image cache
    private final String imageDir = System.getenv().getOrDefault("MAGE_IMAGE_DIR",
            System.getProperty("user.home") + "/xmage/xmage/mage-client/plugins/images");
    private final ImageIndex images = new ImageIndex(imageDir);
    // in-app downloader: fills the cache with card art from Scryfall on demand
    private final ImageDownloader downloader = new ImageDownloader(imageDir, images);

    public static void main(String[] args) {
        int port = resolvePort(args);
        new WebClientApp().start(port);
        // Build the local card DB in the background so deck-editor search/import
        // work. CardRepository drops its table on every new build and relies on
        // CardScanner.scan() (Mage.Sets) to repopulate — the server does this on
        // startup; the gateway must too, or its DB stays empty.
        Thread scan = new Thread(() -> {
            try {
                long t = System.currentTimeMillis();
                System.out.println("Building card DB (CardScanner.scan)…");
                mage.cards.repository.CardScanner.scan();
                System.out.println("Card DB ready in " + (System.currentTimeMillis() - t) / 1000 + "s");
            } catch (Throwable e) {
                System.err.println("Card scan failed: " + e);
            }
        }, "card-scan");
        scan.setDaemon(true);
        scan.start();
    }

    private static int resolvePort(String[] args) {
        if (args != null && args.length > 0) {
            try {
                return Integer.parseInt(args[0]);
            } catch (NumberFormatException ignored) {
                // fall through to default
            }
        }
        String env = System.getenv("MAGE_WEB_PORT");
        if (env != null) {
            try {
                return Integer.parseInt(env.trim());
            } catch (NumberFormatException ignored) {
                // fall through to default
            }
        }
        return 8080;
    }

    public void start(int port) {
        Javalin app = Javalin.create(config -> {
            // serve the SPA from src/main/resources/web
            config.staticFiles.add(staticFiles -> {
                staticFiles.directory = "/web";
                staticFiles.location = Location.CLASSPATH;
            });
            // Don't drop idle game sockets — players sit on long mulligans / the
            // opponent's turn with no frames flowing. A heartbeat (below) keeps them
            // active, and this raises the hard ceiling well past any normal wait.
            config.jetty.wsFactoryConfig(factory ->
                    factory.setIdleTimeout(java.time.Duration.ofHours(2)));
        });

        app.post("/api/connect", this::handleConnect);
        app.get("/api/tables", this::handleTables);
        app.get("/api/session", this::handleSession);
        app.get("/api/matches", this::handleMatches);
        app.post("/api/chat", this::handleChat);
        app.post("/api/watch", this::handleWatch);
        app.post("/api/join", this::handleJoin);
        app.get("/api/gametypes", this::handleGameTypes);
        app.post("/api/tables/create", this::handleCreateTable);
        app.post("/api/tables/remove", this::handleRemoveTable);
        app.post("/api/tables/start", this::handleStartTable);
        app.post("/api/tables/add-ai", this::handleAddAi);
        app.post("/api/draft/create", this::handleCreateDraft);
        app.post("/api/draft/pick", this::handleDraftPick);
        app.post("/api/draft/submit", this::handleDraftSubmit);
        app.post("/api/game/respond", this::handleRespond);
        app.get("/api/cards/search", this::handleCardSearch);
        app.get("/api/cardimg", this::handleCardImage);
        app.get("/api/images/stats", this::handleImageStats);
        app.post("/api/images/download", this::handleImageDownload);
        app.post("/api/images/download/cancel", this::handleImageDownloadCancel);
        app.get("/api/images/download/progress", this::handleImageDownloadProgress);
        app.get("/api/decks/list", this::handleDecksList);
        app.get("/api/decks/load", this::handleDeckLoad);
        app.post("/api/decks/save", this::handleDeckSave);
        app.post("/api/decks/import", this::handleDeckImport);
        app.post("/api/decks/upload", this::handleDeckUpload);
        app.post("/api/report", this::handleReport);
        app.get("/api/report-image/{id}", this::handleReportImage);
        app.post("/api/disconnect", this::handleDisconnect);

        app.ws("/ws", ws -> {
            ws.onConnect(ctx -> {
                String token = ctx.queryParam("token");
                ServerConnection conn = sessions.get(token);
                if (conn == null) {
                    ctx.closeSession(4001, "unknown session");
                    return;
                }
                sockets.put(token, ctx);
                // forward upstream messages/events to this browser
                conn.getClient().setMessageHandler(msg -> push(ctx, "message", msg));
                conn.getClient().setErrorHandler(err -> push(ctx, "error", err));
                conn.getClient().setCallbackHandler(cb -> pushCallback(ctx, conn, cb));
                push(ctx, "ready", "connected");
                // if the upstream session is still in a game (e.g. the browser
                // reloaded mid-game), re-open the board and re-subscribe so the
                // server resends GAME_UPDATE — the player rejoins where they left off
                UUID resumeGame = conn.getActiveGameId();
                if (resumeGame != null) {
                    Map<String, Object> msg = new LinkedHashMap<>();
                    msg.put("type", "gameStart");
                    msg.put("gameId", resumeGame.toString());
                    pushMap(ctx, msg);
                    runAsync("fx-rejoin", () -> conn.joinGame(resumeGame));
                }
            });
            ws.onClose(ctx -> {
                String token = ctx.queryParam("token");
                if (token != null) {
                    sockets.remove(token);
                    lastLogLine.remove(token);
                }
            });
        });

        app.start(port);
        startHeartbeat();
        System.out.println("XMage web client running at http://localhost:" + port);
    }

    /** Push a tiny heartbeat to every open socket so it never goes idle (which would
     *  otherwise close the connection during a long wait — mulligan, opponent turn). */
    private void startHeartbeat() {
        java.util.concurrent.ScheduledExecutorService hb =
                java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
                    Thread t = new Thread(r, "ws-heartbeat");
                    t.setDaemon(true);
                    return t;
                });
        hb.scheduleAtFixedRate(() -> {
            for (WsContext ctx : sockets.values()) {
                try {
                    if (ctx.session.isOpen()) {
                        push(ctx, "heartbeat", "");
                    }
                } catch (Exception ignored) {
                    // dead sockets are cleaned up on close
                }
            }
        }, 25, 25, java.util.concurrent.TimeUnit.SECONDS);
    }

    private void handleConnect(Context ctx) {
        ConnectRequest req = ctx.bodyAsClass(ConnectRequest.class);
        if (req == null || req.host == null || req.username == null) {
            ctx.status(400).json(error("host and username are required"));
            return;
        }
        int port = req.port == 0 ? 17171 : req.port;

        ServerConnection conn = new ServerConnection();
        // Capture any server-side reason (e.g. version mismatch) delivered via
        // showMessage/showError/callback during the login handshake, before a WS
        // exists. The server often sends the rejection reason asynchronously.
        final String[] reason = { null };
        conn.getClient().setMessageHandler(m -> { if (m != null && !m.isEmpty()) reason[0] = m; });
        conn.getClient().setErrorHandler(m -> { if (m != null && !m.isEmpty()) reason[0] = m; });
        conn.getClient().setCallbackHandler(cb -> {
            if (cb != null && cb.getData() instanceof ChatMessage) {
                String text = ((ChatMessage) cb.getData()).getMessage();
                if (text != null && !text.isEmpty()) reason[0] = text;
            }
        });
        boolean ok;
        try {
            ok = conn.connect(req.host, port, req.username,
                    req.avatarId == null ? -1 : req.avatarId, req.flagName);
            if (!ok) {
                // give the async rejection callback a moment to arrive
                Thread.sleep(1500);
            }
        } catch (Exception e) {
            ctx.status(502).json(error("connection error: " + e.getMessage()));
            return;
        } finally {
            // reset to no-ops; the WS handler installs the real ones on connect
            conn.getClient().setMessageHandler(null);
            conn.getClient().setErrorHandler(null);
            conn.getClient().setCallbackHandler(null);
        }
        if (!ok) {
            String err = conn.getLastError();
            if (err == null || err.isEmpty()) {
                err = reason[0];
            }
            ctx.status(502).json(error(err == null || err.isEmpty() ? "could not connect" : err));
            return;
        }
        // best-effort: join the main room chat so messages start flowing
        try {
            conn.joinMainChat();
        } catch (Exception ignored) {
            // chat is non-critical for the lobby
        }

        String token = sessions.register(conn);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("token", token);
        body.put("server", req.host + ":" + port);
        ctx.json(body);
    }

    private void handleChat(Context ctx) {
        ChatRequest req = ctx.bodyAsClass(ChatRequest.class);
        ServerConnection conn = sessions.get(req == null ? null : req.token);
        if (conn == null) {
            ctx.status(401).json(error("not connected"));
            return;
        }
        boolean ok = conn.sendChat(req.message);
        ctx.json(Map.of("ok", ok));
    }

    private void handleWatch(Context ctx) {
        WatchRequest req = ctx.bodyAsClass(WatchRequest.class);
        ServerConnection conn = sessions.get(req == null ? null : req.token);
        if (conn == null) {
            ctx.status(401).json(error("not connected"));
            return;
        }
        if (req.gameId == null) {
            ctx.status(400).json(error("gameId is required"));
            return;
        }
        boolean ok;
        try {
            ok = conn.watchGame(UUID.fromString(req.gameId));
        } catch (IllegalArgumentException e) {
            ctx.status(400).json(error("invalid gameId"));
            return;
        }
        // The board itself arrives asynchronously via GAME_INIT/GAME_UPDATE on the WS.
        ctx.json(Map.of("ok", ok));
    }

    private void handleJoin(Context ctx) {
        JoinRequest req = ctx.bodyAsClass(JoinRequest.class);
        ServerConnection conn = sessions.get(req == null ? null : req.token);
        if (conn == null) {
            ctx.status(401).json(error("not connected"));
            return;
        }
        if (req.tableId == null || req.deckPath == null) {
            ctx.status(400).json(error("tableId and deckPath are required"));
            return;
        }
        boolean ok;
        try {
            ok = conn.joinTable(UUID.fromString(req.tableId), req.deckPath);
        } catch (IllegalArgumentException e) {
            ctx.status(400).json(error("invalid tableId"));
            return;
        }
        // The table owner starts the match from the waiting room (manual start), so
        // joining just seats this player; START_GAME arrives when the owner starts.
        ctx.json(Map.of("ok", ok));
    }

    private void handleRespond(Context ctx) {
        RespondRequest req = ctx.bodyAsClass(RespondRequest.class);
        ServerConnection conn = sessions.get(req == null ? null : req.token);
        if (conn == null) {
            ctx.status(401).json(error("not connected"));
            return;
        }
        UUID gameId;
        try {
            gameId = UUID.fromString(req.gameId);
        } catch (Exception e) {
            ctx.status(400).json(error("invalid gameId"));
            return;
        }
        boolean ok;
        switch (req.kind == null ? "" : req.kind) {
            case "boolean":
                ok = conn.respondBoolean(gameId, Boolean.parseBoolean(req.value));
                break;
            case "uuid":
                try {
                    ok = conn.respondUUID(gameId, UUID.fromString(req.value));
                } catch (Exception e) {
                    ctx.status(400).json(error("invalid uuid value"));
                    return;
                }
                break;
            case "integer":
                try {
                    ok = conn.respondInteger(gameId, Integer.parseInt(req.value));
                } catch (NumberFormatException e) {
                    ctx.status(400).json(error("invalid integer value"));
                    return;
                }
                break;
            case "string":
                ok = conn.respondString(gameId, req.value);
                break;
            case "action":
                try {
                    ok = conn.sendAction(gameId, PlayerAction.valueOf(req.value));
                } catch (IllegalArgumentException e) {
                    ctx.status(400).json(error("unknown action"));
                    return;
                }
                break;
            case "concede":
                ok = conn.concede(gameId);
                break;
            default:
                ctx.status(400).json(error("unknown response kind"));
                return;
        }
        ctx.json(Map.of("ok", ok));
    }

    private void handleTables(Context ctx) {
        ServerConnection conn = sessions.get(ctx.queryParam("token"));
        if (conn == null) {
            ctx.status(401).json(error("not connected"));
            return;
        }
        ctx.json(conn.getTables().stream().map(TableDto::from).collect(Collectors.toList()));
    }

    private void handleMatches(Context ctx) {
        ServerConnection conn = sessions.get(ctx.queryParam("token"));
        if (conn == null) {
            ctx.status(401).json(error("not connected"));
            return;
        }
        ctx.json(conn.getFinishedMatches().stream()
                .map(mage.client.web.dto.MatchDto::from).collect(Collectors.toList()));
    }

    // validate a stored token so a refreshed browser can resume its session
    private void handleSession(Context ctx) {
        ServerConnection conn = sessions.get(ctx.queryParam("token"));
        if (conn == null || !conn.isConnected()) {
            ctx.status(401).json(error("no session"));
            return;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", true);
        body.put("server", conn.getServerHost());
        ctx.json(body);
    }

    /**
     * Search the engine's local card database. This runs entirely against the
     * gateway's bundled {@link CardRepository}, so it needs no upstream session.
     * The card DB may be empty (it's downloaded at runtime); we degrade to an
     * empty result rather than failing.
     */
    private void handleCardSearch(Context ctx) {
        String query = ctx.queryParam("q");
        if (query == null) {
            query = "";
        }
        query = query.trim();

        List<CardInfoDto> results = new ArrayList<>();
        try {
            CardCriteria criteria = new CardCriteria();
            if (!query.isEmpty()) {
                criteria.nameContains(query);
            }
            // type + cmc filter reliably in the DB query
            String type = ctx.queryParam("type");
            if (type != null && !type.isEmpty()) {
                try {
                    criteria.types(mage.constants.CardType.valueOf(type.toUpperCase()));
                } catch (IllegalArgumentException ignored) {
                    // unknown type filter -> ignore
                }
            }
            String cmc = ctx.queryParam("cmc");
            if (cmc != null && !cmc.isEmpty()) {
                try {
                    criteria.manaValue(Integer.parseInt(cmc));
                } catch (NumberFormatException ignored) {
                    // ignore bad cmc
                }
            }
            // color is filtered post-query: the DB color flags are unreliable
            // (red(true) returns off-color cards), so match on the real color.
            String colors = ctx.queryParam("colors");
            String colorFilter = colors == null ? "" : colors.toUpperCase();
            criteria.count(colorFilter.isEmpty() ? 100L : 400L);

            List<CardInfo> cards = CardRepository.instance.findCards(criteria);
            if (cards != null) {
                for (CardInfo card : cards) {
                    if (card == null) {
                        continue;
                    }
                    if (!colorFilter.isEmpty() && !matchesColorFilter(card, colorFilter)) {
                        continue;
                    }
                    results.add(CardInfoDto.from(card));
                    if (results.size() >= 100) {
                        break;
                    }
                }
            }
        } catch (Exception e) {
            // empty / unavailable card DB in this sandbox: return what we have
        }
        ctx.json(results);
    }

    /**
     * Build a {@link DeckCardLists} from the requested card names (resolving
     * each against the local DB for set/number) and write it to a {@code .dck}
     * file on the gateway host via the engine's {@link XmageDeckExporter}.
     */
    private void handleDeckSave(Context ctx) {
        DeckSaveRequest req = ctx.bodyAsClass(DeckSaveRequest.class);
        if (req == null || req.cards == null || req.cards.isEmpty()) {
            ctx.status(400).json(error("at least one card is required"));
            return;
        }

        DeckCardLists lists = new DeckCardLists();
        lists.setName(req.name == null || req.name.isEmpty() ? "Untitled" : req.name);

        // Collapse duplicate names into amounts, preserving first-seen order.
        LinkedHashMap<String, Integer> counts = new LinkedHashMap<>();
        for (String cardName : req.cards) {
            if (cardName == null || cardName.trim().isEmpty()) {
                continue;
            }
            counts.merge(cardName.trim(), 1, Integer::sum);
        }

        List<DeckCardInfo> deckCards = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : counts.entrySet()) {
            String cardName = entry.getKey();
            String setCode = "";
            String cardNumber = "";
            try {
                CardInfo info = CardRepository.instance.findCard(cardName);
                if (info != null) {
                    setCode = info.getSetCode() == null ? "" : info.getSetCode();
                    cardNumber = info.getCardNumber() == null ? "" : info.getCardNumber();
                }
            } catch (Exception ignored) {
                // unknown / empty DB: still record the card by name
            }
            deckCards.add(new DeckCardInfo(cardName, cardNumber, setCode, entry.getValue()));
        }
        lists.setCards(deckCards);

        String path = req.path == null ? null : req.path.trim();
        if (path == null || path.isEmpty()) {
            String safe = lists.getName().replaceAll("[^a-zA-Z0-9-_ ]", "_").trim();
            if (safe.isEmpty()) {
                safe = "deck";
            }
            path = safe + ".dck";
        } else if (!path.toLowerCase().endsWith(".dck")) {
            path = path + ".dck";
        }

        try {
            File file = new File(path);
            File parent = file.getAbsoluteFile().getParentFile();
            if (parent != null && !parent.exists()) {
                parent.mkdirs();
            }
            new XmageDeckExporter().writeDeck(file, lists);
        } catch (IOException e) {
            ctx.status(500).json(error("could not write deck: " + e.getMessage()));
            return;
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", true);
        body.put("path", new File(path).getAbsolutePath());
        ctx.json(body);
    }

    private void handleDisconnect(Context ctx) {
        String token = ctx.queryParam("token");
        if (token == null) {
            DisconnectRequest req = ctx.bodyAsClass(DisconnectRequest.class);
            token = req == null ? null : req.token;
        }
        ServerConnection conn = sessions.remove(token);
        if (conn != null) {
            conn.disconnect();
        }
        sockets.remove(token);
        ctx.json(Map.of("ok", true));
    }

    private void handleCreateTable(Context ctx) {
        CreateRequest req = ctx.bodyAsClass(CreateRequest.class);
        ServerConnection conn = sessions.get(req == null ? null : req.token);
        if (conn == null) {
            ctx.status(401).json(error("not connected"));
            return;
        }
        if (req.deckPath == null || req.deckPath.isEmpty()) {
            ctx.status(400).json(error("deckPath is required"));
            return;
        }
        // map the request (new config fields, with legacy fallbacks) to a TableConfig
        ServerConnection.TableConfig cfg = new ServerConnection.TableConfig();
        cfg.deckPath = req.deckPath;
        cfg.gameName = req.gameName;
        boolean legacyVsHuman = Boolean.TRUE.equals(req.vsHuman);
        if (req.gameType != null && !req.gameType.isEmpty()) {
            cfg.gameType = req.gameType;
        } else if (legacyVsHuman || (req.openSeats != null && req.openSeats > 0)) {
            cfg.gameType = "Two Player Duel";
        } else {
            int oppo = req.opponents == null ? 1 : req.opponents;
            cfg.gameType = oppo >= 2 ? "Free For All" : "Two Player Duel";
        }
        cfg.aiOpponents = req.aiOpponents != null ? req.aiOpponents
                : legacyVsHuman ? 0 : (req.opponents == null ? 1 : req.opponents);
        cfg.openSeats = req.openSeats != null ? req.openSeats : (legacyVsHuman ? 1 : 0);
        if (req.timeLimit != null) cfg.timeLimit = req.timeLimit;
        if (req.bufferTime != null) cfg.bufferTime = req.bufferTime;
        if (req.mulliganType != null) cfg.mulliganType = req.mulliganType;
        if (req.freeMulligans != null) cfg.freeMulligans = req.freeMulligans;
        if (req.skillLevel != null) cfg.skillLevel = req.skillLevel;
        if (req.range != null) cfg.range = req.range;
        if (req.attackOption != null) cfg.attackOption = req.attackOption;
        if (req.rated != null) cfg.rated = req.rated;
        if (req.spectatorsAllowed != null) cfg.spectatorsAllowed = req.spectatorsAllowed;
        if (req.rollbackAllowed != null) cfg.rollbackAllowed = req.rollbackAllowed;
        if (req.planeChase != null) cfg.planeChase = req.planeChase;
        if (req.password != null) cfg.password = req.password;
        if (req.quitRatio != null) cfg.quitRatio = req.quitRatio;
        if (req.minimumRating != null) cfg.minimumRating = req.minimumRating;
        if (req.winsNeeded != null) cfg.winsNeeded = req.winsNeeded;
        if (req.customStartLife != null) cfg.customStartLife = req.customStartLife;
        if (req.customStartHandSize != null) cfg.customStartHandSize = req.customStartHandSize;

        UUID tableId;
        try {
            tableId = conn.createConfiguredTable(cfg);
        } catch (Exception e) {
            ctx.status(500).json(error("create failed: " + e.getMessage()));
            return;
        }
        if (tableId == null) {
            ctx.status(500).json(error("could not create the table (is the deck valid for the format?)"));
            return;
        }
        // No open human seats → start immediately (vs-AI quick play). Otherwise the
        // table waits in a room for humans to join and the owner to start it.
        boolean started = cfg.openSeats <= 0;
        if (started) {
            conn.startMatch(tableId);
        }
        ctx.json(Map.of("ok", true, "tableId", tableId.toString(), "started", started, "openSeats", cfg.openSeats));
    }

    private void handleGameTypes(Context ctx) {
        ServerConnection conn = sessions.get(ctx.queryParam("token"));
        if (conn == null) {
            ctx.status(401).json(error("not connected"));
            return;
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (mage.view.GameTypeView gt : conn.getGameTypes()) {
            out.add(Map.of(
                    "name", gt.getName(),
                    "minPlayers", gt.getMinPlayers(),
                    "maxPlayers", gt.getMaxPlayers(),
                    "useRange", gt.isUseRange(),
                    "useAttackOption", gt.isUseAttackOption()));
        }
        ctx.json(out);
    }

    private void handleStartTable(Context ctx) {
        JoinRequest req = ctx.bodyAsClass(JoinRequest.class);
        ServerConnection conn = sessions.get(req == null ? null : req.token);
        if (conn == null) {
            ctx.status(401).json(error("not connected"));
            return;
        }
        if (req.tableId == null) {
            ctx.status(400).json(error("tableId is required"));
            return;
        }
        boolean ok;
        try {
            ok = conn.startMatch(UUID.fromString(req.tableId));
        } catch (IllegalArgumentException e) {
            ctx.status(400).json(error("invalid tableId"));
            return;
        }
        ctx.json(Map.of("ok", ok));
    }

    private void handleAddAi(Context ctx) {
        JoinRequest req = ctx.bodyAsClass(JoinRequest.class);
        ServerConnection conn = sessions.get(req == null ? null : req.token);
        if (conn == null) {
            ctx.status(401).json(error("not connected"));
            return;
        }
        if (req.tableId == null || req.deckPath == null) {
            ctx.status(400).json(error("tableId and deckPath are required"));
            return;
        }
        boolean ok;
        try {
            ok = conn.addAi(UUID.fromString(req.tableId), req.deckPath, 1);
        } catch (IllegalArgumentException e) {
            ctx.status(400).json(error("invalid tableId"));
            return;
        }
        ctx.json(Map.of("ok", ok));
    }

    // cancel an open table (e.g. a PvP table nobody has joined yet)
    private void handleRemoveTable(Context ctx) {
        JoinRequest req = ctx.bodyAsClass(JoinRequest.class);
        ServerConnection conn = sessions.get(req == null ? null : req.token);
        if (conn == null) {
            ctx.status(401).json(error("not connected"));
            return;
        }
        if (req.tableId == null) {
            ctx.status(400).json(error("tableId is required"));
            return;
        }
        boolean ok;
        try {
            ok = conn.removeTable(UUID.fromString(req.tableId));
        } catch (IllegalArgumentException e) {
            ctx.status(400).json(error("invalid tableId"));
            return;
        }
        ctx.json(Map.of("ok", ok));
    }

    // browse available .dck files so the UI doesn't need file paths
    private void handleDecksList(Context ctx) {
        List<Map<String, Object>> out = new ArrayList<>();
        // repo sample decks, categorized by their subfolder
        scanDecks(new File("Mage.Client/release/sample-decks"), null, out);
        // user decks: any *.dck directly in the home dir, and an optional dir
        scanDecksFlat(new File(System.getProperty("user.home")), "My decks", out);
        String custom = System.getenv("MAGE_DECK_DIR");
        if (custom != null && !custom.isEmpty()) {
            scanDecks(new File(custom), "My decks", out);
        }
        out.sort((a, b) -> {
            int c = String.valueOf(a.get("category")).compareToIgnoreCase(String.valueOf(b.get("category")));
            return c != 0 ? c : String.valueOf(a.get("name")).compareToIgnoreCase(String.valueOf(b.get("name")));
        });
        ctx.json(out);
    }

    private static void scanDecks(File root, String forcedCategory, List<Map<String, Object>> out) {
        if (root == null || !root.isDirectory()) {
            return;
        }
        try (java.util.stream.Stream<java.nio.file.Path> walk = java.nio.file.Files.walk(root.toPath())) {
            walk.filter(java.nio.file.Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().toLowerCase().endsWith(".dck"))
                    .forEach(p -> {
                        String category = forcedCategory;
                        if (category == null) {
                            java.nio.file.Path rel = root.toPath().relativize(p);
                            category = rel.getNameCount() > 1 ? rel.getName(0).toString() : "Other";
                        }
                        addDeck(out, p.toFile(), category);
                    });
        } catch (Exception ignored) {
            // skip unreadable trees
        }
    }

    private static void scanDecksFlat(File dir, String category, List<Map<String, Object>> out) {
        if (dir == null || !dir.isDirectory()) {
            return;
        }
        File[] files = dir.listFiles((d, n) -> n.toLowerCase().endsWith(".dck"));
        if (files != null) {
            for (File f : files) {
                addDeck(out, f, category);
            }
        }
    }

    private static void addDeck(List<Map<String, Object>> out, File f, String category) {
        String name = f.getName();
        if (name.toLowerCase().endsWith(".dck")) {
            name = name.substring(0, name.length() - 4);
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("path", f.getAbsolutePath());
        m.put("category", category);
        out.add(m);
    }

    private void handleDeckLoad(Context ctx) {
        String path = ctx.queryParam("path");
        if (path == null || path.isEmpty()) {
            ctx.status(400).json(error("path is required"));
            return;
        }
        File f = new File(path);
        if (!f.isFile()) {
            ctx.status(404).json(error("deck file not found: " + path));
            return;
        }
        DeckCardLists deck;
        try {
            deck = DeckImporter.importDeckFromFile(path, false);
        } catch (Exception e) {
            ctx.status(400).json(error("could not read deck: " + e.getMessage()));
            return;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", deck.getName() == null ? f.getName() : deck.getName());
        body.put("cards", aggregate(deck.getCards()));
        body.put("sideboard", aggregate(deck.getSideboard()));
        ctx.json(body);
    }

    // collapse a flat card list into [{name, count, manaValue, colors, types, manaCost}]
    private static List<Map<String, Object>> aggregate(List<DeckCardInfo> cards) {
        LinkedHashMap<String, Integer> counts = new LinkedHashMap<>();
        if (cards != null) {
            for (DeckCardInfo c : cards) {
                int amt = c.getAmount() > 0 ? c.getAmount() : 1;
                counts.merge(c.getCardName(), amt, Integer::sum);
            }
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<String, Integer> e : counts.entrySet()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", e.getKey());
            m.put("count", e.getValue());
            CardInfo info = CardRepository.instance.findCard(e.getKey());
            if (info != null) {
                m.put("manaValue", info.getManaValue());
                m.put("colors", colorLetters(info.getColor()));
                m.put("types", info.getTypes());
                m.put("manaCost", String.join("", info.getManaCosts(CardInfo.ManaCostSide.ALL)));
            } else {
                m.put("manaValue", 0);
                m.put("colors", "");
                m.put("types", java.util.Collections.emptyList());
                m.put("manaCost", "");
            }
            out.add(m);
        }
        return out;
    }

    // card matches if it shares any requested color, or is colorless when "C" asked
    private static boolean matchesColorFilter(CardInfo card, String filter) {
        mage.ObjectColor c = card.getColor();
        if (c == null) {
            return filter.contains("C");
        }
        if (filter.contains("W") && c.isWhite()) return true;
        if (filter.contains("U") && c.isBlue()) return true;
        if (filter.contains("B") && c.isBlack()) return true;
        if (filter.contains("R") && c.isRed()) return true;
        if (filter.contains("G") && c.isGreen()) return true;
        if (filter.contains("C") && c.isColorless()) return true;
        return false;
    }

    private static String colorLetters(mage.ObjectColor color) {
        if (color == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        if (color.isWhite()) sb.append('W');
        if (color.isBlue()) sb.append('U');
        if (color.isBlack()) sb.append('B');
        if (color.isRed()) sb.append('R');
        if (color.isGreen()) sb.append('G');
        return sb.toString();
    }

    private void handleCardImage(Context ctx) {
        String name = ctx.queryParam("name");
        if (name == null || name.isEmpty()) {
            ctx.status(400);
            return;
        }
        String set = ctx.queryParam("set");
        String num = ctx.queryParam("num");
        File f = images.lookup(set == null ? "" : set, name, num == null ? "" : num);
        if (f == null || !f.isFile()) {
            ctx.status(404);
            return;
        }
        try {
            ctx.contentType("image/jpeg");
            ctx.header("Cache-Control", "public, max-age=604800");
            ctx.result(java.nio.file.Files.readAllBytes(f.toPath()));
        } catch (Exception e) {
            ctx.status(404);
        }
    }

    /** Exposes the server-side card/token image cache (what XMage downloads into):
     *  how many card-art files are present, across how many sets, total size, the
     *  directory, and the image sources XMage pulls from. */
    private void handleImageStats(Context ctx) {
        ImageIndex.Stats st = images.stats();
        java.util.Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("available", st.available);
        out.put("dir", st.dir);
        out.put("files", st.files);
        out.put("sets", st.sets);
        out.put("bytes", st.bytes);
        // the image sources XMage's downloader can pull card + token art from
        out.put("sources", java.util.List.of("Scryfall", "Gatherer / WizardCards", "Grabbag (tokens)"));
        ctx.json(out);
    }

    /** Kick off a background download of missing card art (capped per run). */
    private void handleImageDownload(Context ctx) {
        int limit = 0;
        try {
            String body = ctx.body();
            if (body != null && body.contains("limit")) {
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"limit\"\\s*:\\s*(\\d+)").matcher(body);
                if (m.find()) {
                    limit = Integer.parseInt(m.group(1));
                }
            }
        } catch (Exception ignored) {
        }
        boolean started = downloader.start(limit);
        java.util.Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("started", started);
        out.put("message", downloader.progress().message);
        ctx.json(out);
    }

    private void handleImageDownloadCancel(Context ctx) {
        downloader.cancel();
        ctx.json(java.util.Map.of("cancelled", true));
    }

    private void handleImageDownloadProgress(Context ctx) {
        ImageDownloader.Progress p = downloader.progress();
        java.util.Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("running", p.running);
        out.put("cancelled", p.cancelled);
        out.put("scanned", p.scanned);
        out.put("candidates", p.candidates);
        out.put("done", p.done.get());
        out.put("failed", p.failed.get());
        out.put("skipped", p.skipped);
        out.put("totalMissing", p.totalMissing);
        out.put("current", p.current);
        out.put("message", p.message);
        ctx.json(out);
    }

    /** Translate an upstream callback into a browser-friendly WS frame. */
    private void pushCallback(WsContext ctx, ServerConnection conn, ClientCallback cb) {
        ClientCallbackMethod method = cb == null ? null : cb.getMethod();
        if ((method == ClientCallbackMethod.CHATMESSAGE || method == ClientCallbackMethod.SERVER_MESSAGE)
                && cb.getData() instanceof ChatMessage) {
            ChatMessage m = (ChatMessage) cb.getData();
            Map<String, Object> msg = new LinkedHashMap<>();
            msg.put("type", "chat");
            msg.put("user", m.getUsername());
            msg.put("text", m.getMessage());
            msg.put("color", m.getColor() == null ? null : m.getColor().toString());
            msg.put("time", m.getTime() == null ? null : m.getTime().getTime());
            msg.put("messageType", m.getMessageType() == null ? null : m.getMessageType().toString());
            pushMap(ctx, msg);
            return;
        }
        // a match we joined has started: subscribe to its game callbacks and tell the UI
        if (method == ClientCallbackMethod.START_GAME && cb.getData() instanceof TableClientMessage) {
            UUID gameId = ((TableClientMessage) cb.getData()).getGameId();
            if (gameId != null) {
                // joinGame is a remote call - never run it inline on the callback
                // thread (re-entrant remoting), do it on a worker.
                Thread t = new Thread(() -> conn.joinGame(gameId), "fx-joingame");
                t.setDaemon(true);
                t.start();
                Map<String, Object> msg = new LinkedHashMap<>();
                msg.put("type", "gameStart");
                msg.put("gameId", gameId.toString());
                pushMap(ctx, msg);
            }
            return;
        }
        // tournament started: entering it is what kicks off the draft
        if (method == ClientCallbackMethod.START_TOURNAMENT && cb.getData() instanceof TableClientMessage) {
            UUID tournamentId = cb.getObjectId();
            if (tournamentId != null) {
                runAsync("fx-jointourney", () -> conn.joinTournament(tournamentId));
                Map<String, Object> msg = new LinkedHashMap<>();
                msg.put("type", "tournamentStart");
                msg.put("tournamentId", tournamentId.toString());
                pushMap(ctx, msg);
            }
            return;
        }
        // booster draft started: subscribe to its DRAFT_PICK callbacks
        if (method == ClientCallbackMethod.START_DRAFT && cb.getData() instanceof TableClientMessage) {
            UUID draftId = cb.getObjectId();
            if (draftId != null) {
                runAsync("fx-joindraft", () -> conn.joinDraft(draftId));
                Map<String, Object> msg = new LinkedHashMap<>();
                msg.put("type", "draftStart");
                msg.put("draftId", draftId.toString());
                pushMap(ctx, msg);
            }
            return;
        }
        // a booster to pick from (initial deal or after each pick)
        if ((method == ClientCallbackMethod.DRAFT_INIT || method == ClientCallbackMethod.DRAFT_PICK)
                && cb.getData() instanceof mage.view.DraftClientMessage) {
            UUID draftId = cb.getObjectId();
            mage.view.DraftClientMessage dm = (mage.view.DraftClientMessage) cb.getData();
            Map<String, Object> msg = new LinkedHashMap<>();
            msg.put("type", "draftPick");
            msg.put("draftId", draftId == null ? null : draftId.toString());
            msg.put("draft", dm.getDraftPickView() == null ? null : DraftDto.from(dm.getDraftPickView()));
            pushMap(ctx, msg);
            if (draftId != null) {
                runAsync("fx-boosterack", () -> conn.setBoosterLoaded(draftId));
            }
            return;
        }
        if (method == ClientCallbackMethod.DRAFT_UPDATE) {
            push(ctx, "draftUpdate", "");
            return;
        }
        if (method == ClientCallbackMethod.DRAFT_OVER) {
            push(ctx, "draftOver", "");
            return;
        }
        // deck construction from the drafted pool (after the draft)
        if ((method == ClientCallbackMethod.CONSTRUCT || method == ClientCallbackMethod.SIDEBOARD)
                && cb.getData() instanceof TableClientMessage) {
            TableClientMessage tm = (TableClientMessage) cb.getData();
            java.util.List<DraftDto.DraftCard> pool = new java.util.ArrayList<>();
            if (tm.getDeck() != null) {
                pool.addAll(DraftDto.cardsFrom(tm.getDeck().getCards()));
                pool.addAll(DraftDto.cardsFrom(tm.getDeck().getSideboard()));
            }
            Map<String, Object> msg = new LinkedHashMap<>();
            msg.put("type", "construct");
            msg.put("tableId", tm.getCurrentTableId() == null ? null : tm.getCurrentTableId().toString());
            msg.put("pool", pool);
            pushMap(ctx, msg);
            return;
        }
        // the game ended: surface the result (who won) + the final board
        if (method == ClientCallbackMethod.GAME_OVER && cb.getData() instanceof GameClientMessage) {
            GameClientMessage m = (GameClientMessage) cb.getData();
            conn.clearActiveGame(); // don't try to rejoin a finished game on reload
            Map<String, Object> msg = new LinkedHashMap<>();
            msg.put("type", "gameOver");
            msg.put("gameId", cb.getObjectId() == null ? null : cb.getObjectId().toString());
            msg.put("text", m.getMessage());
            msg.put("game", m.getGameView() == null ? null : GameDto.from(m.getGameView()));
            pushMap(ctx, msg);
            return;
        }
        // a GameClientMessage is either a real decision (DIALOG) or just an
        // informational board update ("Waiting for X"). Only DIALOG callbacks
        // become an actionable prompt.
        if (cb.getData() instanceof GameClientMessage) {
            GameClientMessage message = (GameClientMessage) cb.getData();
            boolean isDialog = method != null && method.getType() == ClientCallbackType.DIALOG;
            PromptDto prompt = isDialog ? PromptDto.from(method, message) : null;
            // surface informational text (phase/turn narration, actions) as a log line
            if (!isDialog && message.getMessage() != null && !message.getMessage().isEmpty()) {
                pushLog(ctx, message.getMessage());
            }
            pushGame(ctx, cb.getObjectId(), message.getGameView(), prompt);
            return;
        }
        // choose an ability / mode (different payload type)
        if (cb.getData() instanceof mage.view.AbilityPickerView) {
            mage.view.AbilityPickerView picker = (mage.view.AbilityPickerView) cb.getData();
            pushGame(ctx, cb.getObjectId(), picker.getGameView(), PromptDto.fromAbilityPicker(picker));
            return;
        }
        // live game state (spectating or our own board update): GAME_INIT / GAME_UPDATE
        if (cb.getData() instanceof GameView) {
            pushGame(ctx, cb.getObjectId(), (GameView) cb.getData(), null);
            return;
        }
        // table changes etc. - a cue for the browser to refresh
        push(ctx, "event", method == null ? "" : method.toString());
    }

    private void handleCreateDraft(Context ctx) {
        CreateDraftRequest req = ctx.bodyAsClass(CreateDraftRequest.class);
        ServerConnection conn = sessions.get(req == null ? null : req.token);
        if (conn == null) {
            ctx.status(401).json(error("not connected"));
            return;
        }
        if (req.set == null || req.set.isEmpty()) {
            ctx.status(400).json(error("set is required"));
            return;
        }
        UUID tableId;
        try {
            tableId = conn.createDraft(req.set, req.packs == null ? 3 : req.packs,
                    req.opponents == null ? 3 : req.opponents);
        } catch (Exception e) {
            ctx.status(500).json(error("create draft failed: " + e.getMessage()));
            return;
        }
        if (tableId == null) {
            ctx.status(500).json(error("could not create/start the draft"));
            return;
        }
        // START_DRAFT + the boosters arrive on the WS.
        ctx.json(Map.of("ok", true, "tableId", tableId.toString()));
    }

    private static final String[] BASIC_LANDS = {"Plains", "Island", "Swamp", "Mountain", "Forest"};

    private void handleDraftSubmit(Context ctx) {
        SubmitDeckRequest req = ctx.bodyAsClass(SubmitDeckRequest.class);
        ServerConnection conn = sessions.get(req == null ? null : req.token);
        if (conn == null) {
            ctx.status(401).json(error("not connected"));
            return;
        }
        if (req.tableId == null) {
            ctx.status(400).json(error("tableId is required"));
            return;
        }
        DeckCardLists lists = new DeckCardLists();
        lists.setName("Draft deck");
        List<DeckCardInfo> cards = new ArrayList<>();
        if (req.cards != null) {
            for (DeckCardReq c : req.cards) {
                if (c == null || c.name == null || c.qty <= 0) {
                    continue;
                }
                cards.add(new DeckCardInfo(c.name, c.num == null ? "" : c.num, c.set == null ? "" : c.set, c.qty));
            }
        }
        // basic lands, resolved to a real printing from the local DB
        int[] basics = req.basics == null ? new int[5] : new int[]{req.basics.plains, req.basics.island, req.basics.swamp, req.basics.mountain, req.basics.forest};
        for (int i = 0; i < BASIC_LANDS.length; i++) {
            if (basics[i] <= 0) {
                continue;
            }
            String set = "";
            String num = "";
            try {
                CardInfo info = CardRepository.instance.findCard(BASIC_LANDS[i]);
                if (info != null) {
                    set = info.getSetCode() == null ? "" : info.getSetCode();
                    num = info.getCardNumber() == null ? "" : info.getCardNumber();
                }
            } catch (Exception ignored) {
                // fall back to name-only
            }
            cards.add(new DeckCardInfo(BASIC_LANDS[i], num, set, basics[i]));
        }
        lists.setCards(cards);
        try {
            boolean ok = conn.submitDeck(UUID.fromString(req.tableId), lists);
            if (!ok) {
                ctx.status(500).json(error("deck rejected (need a legal deck, usually 40+ cards)"));
                return;
            }
        } catch (Exception e) {
            ctx.status(500).json(error("submit failed: " + e.getMessage()));
            return;
        }
        ctx.json(Map.of("ok", true));
    }

    private void handleDraftPick(Context ctx) {
        DraftPickRequest req = ctx.bodyAsClass(DraftPickRequest.class);
        ServerConnection conn = sessions.get(req == null ? null : req.token);
        if (conn == null) {
            ctx.status(401).json(error("not connected"));
            return;
        }
        if (req.draftId == null || req.cardId == null) {
            ctx.status(400).json(error("draftId and cardId are required"));
            return;
        }
        try {
            conn.sendCardPick(UUID.fromString(req.draftId), UUID.fromString(req.cardId));
        } catch (Exception e) {
            ctx.status(500).json(error("pick failed: " + e.getMessage()));
            return;
        }
        ctx.json(Map.of("ok", true));
    }

    /** Run a (possibly remoting) call off the callback thread to avoid re-entrancy. */
    private static void runAsync(String name, Runnable r) {
        Thread t = new Thread(r, name);
        t.setDaemon(true);
        t.start();
    }

    private void pushLog(WsContext ctx, String text) {
        String clean = text.replaceAll("<[^>]+>", ""); // strip server HTML markup
        // suppress consecutive duplicate log lines (e.g. repeated "Waiting for X" spam)
        String token = ctx.queryParam("token");
        if (token != null) {
            String prev = lastLogLine.put(token, clean);
            if (clean.equals(prev)) return;
        }
        Map<String, Object> msg = new LinkedHashMap<>();
        msg.put("type", "log");
        msg.put("text", clean);
        pushMap(ctx, msg);
    }

    private void pushGame(WsContext ctx, UUID gameId, GameView gameView, PromptDto prompt) {
        Map<String, Object> msg = new LinkedHashMap<>();
        msg.put("type", "game");
        msg.put("gameId", gameId == null ? null : gameId.toString());
        msg.put("game", gameView == null ? null : GameDto.from(gameView));
        msg.put("prompt", prompt);
        pushMap(ctx, msg);
    }

    private void push(WsContext ctx, String type, String payload) {
        Map<String, Object> msg = new LinkedHashMap<>();
        msg.put("type", type);
        msg.put("payload", payload);
        pushMap(ctx, msg);
    }

    private void pushMap(WsContext ctx, Map<String, Object> msg) {
        try {
            ctx.send(json.writeValueAsString(msg));
        } catch (Exception ignored) {
            // socket may have closed; the registry cleanup handles removal
        }
    }

    private static Map<String, Object> error(String message) {
        return Map.of("error", message);
    }

    // --- request bodies ------------------------------------------------------

    public static class ConnectRequest {
        public String host;
        public int port;
        public String username;
        public Integer avatarId;
        public String flagName;
    }

    public static class DisconnectRequest {
        public String token;
    }

    public static class ChatRequest {
        public String token;
        public String message;
    }

    public static class WatchRequest {
        public String token;
        public String gameId;
    }

    public static class CreateRequest {
        public String token;
        public String deckPath;
        public Integer opponents; // legacy: number of AI opponents (default 1)
        public Boolean vsHuman;   // legacy: true = open a 1-open-seat PvP table

        // full table configuration (preferred). When present, these drive the table.
        public String gameName;
        public String gameType;     // e.g. "Two Player Duel", "Free For All"
        public Integer aiOpponents; // AI seats
        public Integer openSeats;   // open human seats
        public String timeLimit;    // MatchTimeLimit enum name
        public String bufferTime;   // MatchBufferTime enum name
        public String mulliganType; // MulliganType enum name
        public Integer freeMulligans;
        public String skillLevel;   // SkillLevel enum name
        public String range;        // RangeOfInfluence enum name
        public String attackOption; // MultiplayerAttackOption enum name
        public Boolean rated;
        public Boolean spectatorsAllowed;
        public Boolean rollbackAllowed;
        public Boolean planeChase;
        public String password;
        public Integer quitRatio;
        public Integer minimumRating;
        public Integer winsNeeded;
        public Integer customStartLife;
        public Integer customStartHandSize;
    }

    public static class CreateDraftRequest {
        public String token;
        public String set;       // set code for the boosters (e.g. "M19")
        public Integer packs;    // boosters per player (default 3)
        public Integer opponents; // AI draft bots (default 3)
    }

    public static class DraftPickRequest {
        public String token;
        public String draftId;
        public String cardId;
    }

    public static class SubmitDeckRequest {
        public String token;
        public String tableId;
        public List<DeckCardReq> cards;
        public Basics basics;
    }

    public static class DeckCardReq {
        public String name;
        public String set;
        public String num;
        public int qty;
    }

    public static class Basics {
        public int plains;
        public int island;
        public int swamp;
        public int mountain;
        public int forest;
    }

    public static class JoinRequest {
        public String token;
        public String tableId;
        public String deckPath;
    }

    public static class RespondRequest {
        public String token;
        public String gameId;
        public String kind;  // boolean | uuid | integer | string | action | concede
        public String value;
    }

    public static class DeckSaveRequest {
        public String name;
        public List<String> cards;
        public String path;  // optional .dck path on the gateway host
    }

    public static class ReportRequest {
        public String title;
        public String body;
        public String kind; // "bug" (default) or "feature"
        public ReportContext context;
        public String origin; // browser origin, for building the screenshot URL
        public String screenshot; // data:image/jpeg;base64,... of the screen
        public com.fasterxml.jackson.databind.JsonNode gameState; // live game snapshot
    }

    // where report screenshots are stored + served from (/api/report-image/{id})
    private static final File REPORT_DIR = new File(System.getProperty("java.io.tmpdir"), "mage-web-reports");

    public static class ReportContext {
        public String appVersion;
        public String view;
        public String url;
        public String userAgent;
    }

    /**
     * Create a GitHub issue on the fork from an in-app "report a problem" form.
     * The token comes from the GITHUB_TOKEN env var and never leaves the server;
     * GitHub's raw error body is never echoed to the browser. Runs synchronously
     * on the Jetty worker thread (already off the main thread).
     */
    private void handleReport(Context ctx) {
        ReportRequest req = ctx.bodyAsClass(ReportRequest.class);
        if (req == null || req.title == null || req.title.trim().isEmpty()) {
            ctx.status(400).json(error("a title is required"));
            return;
        }
        String token = System.getenv("GITHUB_TOKEN");
        if (token == null || token.isBlank()) {
            ctx.status(503).json(error("problem reporting is not configured on this server"));
            return;
        }
        String repo = System.getenv().getOrDefault("GITHUB_REPO", "jacob-sabella/mage");

        StringBuilder md = new StringBuilder();
        String desc = req.body == null ? "" : req.body.trim();
        if (!desc.isEmpty()) {
            md.append(desc).append("\n\n");
        }
        // persist the screenshot (if any) and embed it so triage sees the screen
        String imgId = saveReportImage(req.screenshot);
        if (imgId != null) {
            String base = req.origin == null || req.origin.isBlank() ? "" : req.origin.trim().replaceAll("/+$", "");
            md.append("![screenshot](").append(base).append("/api/report-image/").append(imgId).append(")\n\n");
        }

        md.append("---\n\n<details><summary>Client context</summary>\n\n");
        if (req.context != null) {
            appendContext(md, "App version", req.context.appVersion);
            appendContext(md, "View", req.context.view);
            appendContext(md, "URL", req.context.url);
            appendContext(md, "User agent", req.context.userAgent);
        }
        if (req.gameState != null && !req.gameState.isNull()) {
            try {
                String pretty = json.writerWithDefaultPrettyPrinter().writeValueAsString(req.gameState);
                if (pretty.length() > 12000) {
                    pretty = pretty.substring(0, 12000) + "\n… (truncated)";
                }
                md.append("\n**Game state:**\n\n```json\n").append(pretty).append("\n```\n");
            } catch (Exception ignored) {
                // state is best-effort context
            }
        }
        md.append("\n</details>\n");

        boolean feature = "feature".equalsIgnoreCase(req.kind);
        Map<String, Object> issue = new LinkedHashMap<>();
        issue.put("title", (feature ? "[Feature] " : "[Bug] ") + req.title.trim());
        issue.put("body", md.toString());
        issue.put("labels", List.of(feature ? "enhancement" : "web-report"));

        String payload;
        try {
            payload = json.writeValueAsString(issue);
        } catch (Exception e) {
            ctx.status(500).json(error("could not build the issue"));
            return;
        }

        java.net.http.HttpRequest ghReq = java.net.http.HttpRequest.newBuilder()
                .uri(java.net.URI.create("https://api.github.com/repos/" + repo + "/issues"))
                .header("Authorization", "Bearer " + token)
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .header("Content-Type", "application/json")
                .header("User-Agent", "xmage-web-client")
                .timeout(java.time.Duration.ofSeconds(15))
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString(
                        payload, java.nio.charset.StandardCharsets.UTF_8))
                .build();
        try {
            java.net.http.HttpResponse<String> resp =
                    http.send(ghReq, java.net.http.HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 201) {
                @SuppressWarnings("unchecked")
                Map<String, Object> created = json.readValue(resp.body(), Map.class);
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("ok", true);
                out.put("url", created.get("html_url"));
                out.put("number", created.get("number"));
                ctx.json(out);
            } else {
                System.err.println("GitHub issue create failed: HTTP " + resp.statusCode());
                ctx.status(502).json(error("GitHub rejected the report (HTTP " + resp.statusCode() + ")"));
            }
        } catch (Exception e) {
            ctx.status(502).json(error("could not reach GitHub: " + e.getClass().getSimpleName()));
        }
    }

    /** Decode a data-URL screenshot and store it; returns its id (filename stem) or null. */
    private static String saveReportImage(String dataUrl) {
        if (dataUrl == null || !dataUrl.startsWith("data:image/")) {
            return null;
        }
        int comma = dataUrl.indexOf(',');
        if (comma < 0) {
            return null;
        }
        String b64 = dataUrl.substring(comma + 1);
        byte[] bytes;
        try {
            bytes = java.util.Base64.getDecoder().decode(b64);
        } catch (Exception e) {
            return null;
        }
        if (bytes.length == 0 || bytes.length > 6_000_000) {
            return null;
        }
        try {
            REPORT_DIR.mkdirs();
            String id = java.util.UUID.randomUUID().toString();
            java.nio.file.Files.write(new File(REPORT_DIR, id + ".jpg").toPath(), bytes);
            return id;
        } catch (Exception e) {
            return null;
        }
    }

    /** Serve a stored report screenshot by id (so GitHub can render it in the issue). */
    private void handleReportImage(Context ctx) {
        String id = ctx.pathParam("id");
        if (!id.matches("[a-fA-F0-9-]{36}")) { // UUID only — no path traversal
            ctx.status(404);
            return;
        }
        File f = new File(REPORT_DIR, id + ".jpg");
        if (!f.isFile()) {
            ctx.status(404);
            return;
        }
        try {
            ctx.contentType("image/jpeg");
            ctx.header("Cache-Control", "public, max-age=2592000");
            ctx.result(java.nio.file.Files.readAllBytes(f.toPath()));
        } catch (Exception e) {
            ctx.status(404);
        }
    }

    /** Append one context line, collapsing newlines so values can't break the markdown block. */
    private static void appendContext(StringBuilder md, String label, String value) {
        if (value == null || value.isBlank()) {
            return;
        }
        String clean = value.replaceAll("[\\r\\n]+", " ").trim();
        if (clean.length() > 500) {
            clean = clean.substring(0, 500) + "…";
        }
        md.append("- **").append(label).append(":** ").append(clean).append("\n");
    }

    public static class DeckImportRequest {
        public String text;        // a pasted MTGO/Moxfield-style decklist
        public String moxfieldUrl; // OR a public Moxfield deck URL / id
        public String name;
    }

    private static final java.util.regex.Pattern UNRESOLVED_CARD =
            java.util.regex.Pattern.compile("Could not find card: '(.+?)' at line");
    private static final String MOX_UA =
            "XMageWebClient/1.0 (https://github.com/jacob-sabella/mage; deck import)";

    /**
     * Import a deck from a pasted text decklist OR a public Moxfield deck URL.
     * Reuses the engine's text importer (write to a temp .txt, parse it) so card
     * resolution + sideboard handling come for free. Returns the parsed deck in
     * the same shape as /api/decks/load, plus any unresolved card names.
     */
    private void handleDeckImport(Context ctx) {
        DeckImportRequest req = ctx.bodyAsClass(DeckImportRequest.class);
        boolean hasText = req != null && req.text != null && !req.text.trim().isEmpty();
        boolean hasUrl = req != null && req.moxfieldUrl != null && !req.moxfieldUrl.trim().isEmpty();
        if (!hasText && !hasUrl) {
            ctx.status(400).json(error("provide text or moxfieldUrl"));
            return;
        }

        String deckText;
        String defaultName = req.name == null || req.name.isEmpty() ? "Imported deck" : req.name;
        if (hasUrl) {
            try {
                String[] mox = fetchMoxfield(req.moxfieldUrl.trim()); // [text, name]
                deckText = mox[0];
                if ((req.name == null || req.name.isEmpty()) && mox[1] != null) {
                    defaultName = mox[1];
                }
            } catch (Exception e) {
                ctx.status(502).json(error("Moxfield fetch failed: " + e.getMessage()
                        + " — paste the deck's Export text instead."));
                return;
            }
        } else {
            deckText = req.text;
        }

        StringBuilder errors = new StringBuilder();
        DeckCardLists lists;
        java.nio.file.Path tmp = null;
        try {
            tmp = java.nio.file.Files.createTempFile("mage-import-", ".txt");
            java.nio.file.Files.writeString(tmp, deckText);
            lists = DeckImporter.importDeckFromFile(tmp.toString(), errors, false);
        } catch (Exception e) {
            ctx.status(400).json(error("could not parse deck: " + e.getMessage()));
            return;
        } finally {
            if (tmp != null) {
                try {
                    java.nio.file.Files.deleteIfExists(tmp);
                } catch (Exception ignored) {
                }
            }
        }
        lists.setName(defaultName);

        java.util.LinkedHashSet<String> unresolved = new java.util.LinkedHashSet<>();
        java.util.regex.Matcher m = UNRESOLVED_CARD.matcher(errors.toString());
        while (m.find()) {
            unresolved.add(m.group(1));
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", lists.getName());
        body.put("cards", aggregate(lists.getCards()));
        body.put("sideboard", aggregate(lists.getSideboard()));
        body.put("unresolved", new ArrayList<>(unresolved));
        ctx.json(body);
    }

    /** Fetch a public Moxfield deck and flatten it to MTGO-style "qty name" text. Returns [text, name]. */
    private String[] fetchMoxfield(String url) throws Exception {
        java.util.regex.Matcher idm = java.util.regex.Pattern.compile("/decks/([A-Za-z0-9_-]+)").matcher(url);
        String publicId;
        if (idm.find()) {
            publicId = idm.group(1);
        } else if (url.matches("[A-Za-z0-9_-]+")) {
            publicId = url;
        } else {
            throw new IllegalArgumentException("not a Moxfield deck URL");
        }

        com.fasterxml.jackson.databind.JsonNode root = null;
        for (String api : new String[]{
                "https://api2.moxfield.com/v2/decks/all/" + publicId,
                "https://api2.moxfield.com/v3/decks/all/" + publicId}) {
            java.net.http.HttpRequest r = java.net.http.HttpRequest.newBuilder(java.net.URI.create(api))
                    .header("User-Agent", MOX_UA)
                    .header("Accept", "application/json")
                    .timeout(java.time.Duration.ofSeconds(15))
                    .GET().build();
            java.net.http.HttpResponse<String> resp = http.send(r, java.net.http.HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 200) {
                root = json.readTree(resp.body());
                break;
            }
        }
        if (root == null) {
            throw new IllegalStateException("deck not public or API blocked");
        }

        StringBuilder main = new StringBuilder();
        StringBuilder side = new StringBuilder();
        com.fasterxml.jackson.databind.JsonNode boards = root.path("boards");
        appendMoxBoard(main, firstNonEmpty(root.path("mainboard"), boards.path("mainboard").path("cards")));
        appendMoxBoard(side, firstNonEmpty(root.path("sideboard"), boards.path("sideboard").path("cards")));
        // commanders → sideboard (XMage .dck convention; UI labels it "Sideboard / Commander")
        appendMoxBoard(side, firstNonEmpty(root.path("commanders"), boards.path("commanders").path("cards")));

        String name = root.path("name").asText(null);
        return new String[]{main + "\n\n" + side, name}; // blank line → importer switches to sideboard
    }

    private static com.fasterxml.jackson.databind.JsonNode firstNonEmpty(
            com.fasterxml.jackson.databind.JsonNode a, com.fasterxml.jackson.databind.JsonNode b) {
        return (a != null && a.isObject() && a.size() > 0) ? a : b;
    }

    private static void appendMoxBoard(StringBuilder sb, com.fasterxml.jackson.databind.JsonNode board) {
        if (board == null || !board.isObject()) {
            return;
        }
        board.fields().forEachRemaining(e -> {
            com.fasterxml.jackson.databind.JsonNode entry = e.getValue();
            int qty = entry.path("quantity").asInt(0);
            String name = entry.path("card").path("name").asText("");
            if (qty > 0 && !name.isEmpty()) {
                sb.append(qty).append(' ').append(name).append('\n');
            }
        });
    }

    /** Directory where uploaded decks live so they surface in /api/decks/list. */
    private static File userDeckDir() {
        String custom = System.getenv("MAGE_DECK_DIR");
        if (custom != null && !custom.isEmpty()) {
            File dir = new File(custom);
            dir.mkdirs();
            return dir;
        }
        return new File(System.getProperty("user.home"));
    }

    /** Reduce a client-supplied name to a safe single-segment *.dck filename. */
    private static String safeDeckFileName(String raw) {
        String base = raw == null ? "" : raw;
        int slash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
        if (slash >= 0) {
            base = base.substring(slash + 1);
        }
        if (base.toLowerCase().endsWith(".dck")) {
            base = base.substring(0, base.length() - 4);
        }
        base = base.replaceAll("[^a-zA-Z0-9-_ ]", "_").trim();
        if (base.isEmpty()) {
            base = "deck";
        }
        return base + ".dck";
    }

    /**
     * Accept an uploaded .dck (multipart field "file", or a raw text body with a
     * ?name= query), validate it parses as a deck, and store it in the user deck
     * dir so it appears in /api/decks/list.
     */
    private void handleDeckUpload(Context ctx) {
        String originalName;
        byte[] data;
        try {
            io.javalin.http.UploadedFile up = ctx.uploadedFile("file");
            if (up != null) {
                originalName = up.filename();
                try (java.io.InputStream in = up.content()) {
                    data = in.readAllBytes();
                }
            } else {
                originalName = ctx.queryParam("name");
                data = ctx.bodyAsBytes();
            }
        } catch (Exception e) {
            ctx.status(400).json(error("could not read upload: " + e.getMessage()));
            return;
        }
        if (data == null || data.length == 0) {
            ctx.status(400).json(error("empty upload"));
            return;
        }
        if (data.length > 1_000_000) {
            ctx.status(413).json(error("deck file too large"));
            return;
        }

        File tmp;
        try {
            tmp = File.createTempFile("upload-", ".dck");
            java.nio.file.Files.write(tmp.toPath(), data);
        } catch (IOException e) {
            ctx.status(500).json(error("could not buffer upload: " + e.getMessage()));
            return;
        }
        try {
            StringBuilder errors = new StringBuilder();
            DeckCardLists parsed = DeckImporter.importDeckFromFile(tmp.getAbsolutePath(), errors, false);
            int cardCount = (parsed == null || parsed.getCards() == null) ? 0 : parsed.getCards().size();
            if (cardCount == 0) {
                String why = errors.length() > 0 ? errors.toString().trim() : "no cards parsed";
                ctx.status(400).json(error("not a valid .dck deck: " + why));
                return;
            }
            File dir = userDeckDir();
            String fileName = safeDeckFileName(originalName);
            File dest = new File(dir, fileName);
            String stem = fileName.substring(0, fileName.length() - 4);
            for (int n = 2; dest.exists(); n++) {
                dest = new File(dir, stem + " (" + n + ").dck");
            }
            java.nio.file.Files.copy(tmp.toPath(), dest.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);

            String storedName = dest.getName().substring(0, dest.getName().length() - 4);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("ok", true);
            body.put("name", storedName);
            body.put("path", dest.getAbsolutePath());
            ctx.json(body);
        } catch (IOException e) {
            ctx.status(500).json(error("could not store deck: " + e.getMessage()));
        } finally {
            tmp.delete();
        }
    }
}
