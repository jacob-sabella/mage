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
    private final ObjectMapper json = new ObjectMapper();
    // real card art from a desktop XMage client's downloaded image cache
    private final ImageIndex images = new ImageIndex(
            System.getenv().getOrDefault("MAGE_IMAGE_DIR",
                    System.getProperty("user.home") + "/xmage/xmage/mage-client/plugins/images"));

    public static void main(String[] args) {
        int port = resolvePort(args);
        new WebClientApp().start(port);
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
        });

        app.post("/api/connect", this::handleConnect);
        app.get("/api/tables", this::handleTables);
        app.get("/api/session", this::handleSession);
        app.post("/api/chat", this::handleChat);
        app.post("/api/watch", this::handleWatch);
        app.post("/api/join", this::handleJoin);
        app.post("/api/tables/create", this::handleCreateTable);
        app.post("/api/game/respond", this::handleRespond);
        app.get("/api/cards/search", this::handleCardSearch);
        app.get("/api/cardimg", this::handleCardImage);
        app.get("/api/decks/load", this::handleDeckLoad);
        app.post("/api/decks/save", this::handleDeckSave);
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
            });
            ws.onClose(ctx -> {
                String token = ctx.queryParam("token");
                if (token != null) {
                    sockets.remove(token);
                }
            });
        });

        app.start(port);
        System.out.println("XMage web client running at http://localhost:" + port);
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
            ok = conn.connect(req.host, port, req.username);
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
        // On match start the server pushes START_GAME; the gateway then joins the game.
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
        UUID tableId;
        try {
            tableId = conn.createGameVsAi(req.deckPath);
        } catch (Exception e) {
            ctx.status(500).json(error("create failed: " + e.getMessage()));
            return;
        }
        if (tableId == null) {
            ctx.status(500).json(error("could not create/start game (is the deck valid?)"));
            return;
        }
        // START_GAME will arrive on the WS; the gateway joins the game then.
        ctx.json(Map.of("ok", true, "tableId", tableId.toString()));
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

    private void pushLog(WsContext ctx, String text) {
        Map<String, Object> msg = new LinkedHashMap<>();
        msg.put("type", "log");
        msg.put("text", text.replaceAll("<[^>]+>", "")); // strip server HTML markup
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
}
