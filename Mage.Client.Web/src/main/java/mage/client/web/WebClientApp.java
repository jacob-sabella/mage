package mage.client.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.http.Context;
import io.javalin.http.staticfiles.Location;
import io.javalin.websocket.WsContext;
import mage.client.web.dto.GameDto;
import mage.client.web.dto.PromptDto;
import mage.client.web.dto.TableDto;
import mage.client.web.net.ServerConnection;
import mage.constants.PlayerAction;
import mage.interfaces.callback.ClientCallback;
import mage.interfaces.callback.ClientCallbackMethod;
import mage.view.ChatMessage;
import mage.view.GameClientMessage;
import mage.view.GameView;
import mage.view.TableClientMessage;

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
        app.post("/api/chat", this::handleChat);
        app.post("/api/watch", this::handleWatch);
        app.post("/api/join", this::handleJoin);
        app.post("/api/game/respond", this::handleRespond);
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
        boolean ok;
        try {
            ok = conn.connect(req.host, port, req.username);
        } catch (Exception e) {
            ctx.status(502).json(error("connection error: " + e.getMessage()));
            return;
        }
        if (!ok) {
            String err = conn.getLastError();
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
                conn.joinGame(gameId);
                Map<String, Object> msg = new LinkedHashMap<>();
                msg.put("type", "gameStart");
                msg.put("gameId", gameId.toString());
                pushMap(ctx, msg);
            }
            return;
        }
        // a decision is being asked of us (priority, target, choice, ...)
        if (cb.getData() instanceof GameClientMessage) {
            GameClientMessage message = (GameClientMessage) cb.getData();
            pushGame(ctx, cb.getObjectId(), message.getGameView(), PromptDto.from(method, message));
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
}
