package mage.client.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.http.Context;
import io.javalin.http.staticfiles.Location;
import io.javalin.websocket.WsContext;
import mage.client.web.dto.TableDto;
import mage.client.web.net.ServerConnection;

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
                conn.getClient().setCallbackHandler(cb -> push(ctx, "event",
                        cb.getMethod() == null ? "" : cb.getMethod().toString()));
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
        String token = sessions.register(conn);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("token", token);
        body.put("server", req.host + ":" + port);
        ctx.json(body);
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

    private void push(WsContext ctx, String type, String payload) {
        try {
            Map<String, Object> msg = new LinkedHashMap<>();
            msg.put("type", type);
            msg.put("payload", payload);
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
}
