package mage.client.web;

import mage.client.web.net.ServerConnection;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Maps an opaque browser token to its upstream {@link ServerConnection}.
 * Each browser that connects gets one entry; the token is handed back to the
 * browser and presented on every subsequent request.
 *
 * @author XMage web client
 */
public class SessionRegistry {

    private final ConcurrentHashMap<String, ServerConnection> byToken = new ConcurrentHashMap<>();

    public String register(ServerConnection connection) {
        String token = UUID.randomUUID().toString();
        byToken.put(token, connection);
        return token;
    }

    public ServerConnection get(String token) {
        return token == null ? null : byToken.get(token);
    }

    public ServerConnection remove(String token) {
        return token == null ? null : byToken.remove(token);
    }
}
