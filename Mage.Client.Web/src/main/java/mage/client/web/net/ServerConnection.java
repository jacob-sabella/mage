package mage.client.web.net;

import mage.players.net.UserData;
import mage.remote.Connection;
import mage.remote.MageRemoteException;
import mage.remote.Session;
import mage.remote.SessionImpl;
import mage.view.TableView;

import java.util.Collection;
import java.util.Collections;
import java.util.Optional;
import java.util.UUID;

/**
 * One upstream XMage session, owned by the gateway on behalf of a single
 * browser session. Reuses the shared {@link Session} (JBoss transport)
 * unchanged - no protocol/serialization code is duplicated here.
 * <p>
 * Calls are blocking and run on gateway worker threads, never the browser.
 *
 * @author XMage web client
 */
public class ServerConnection {

    private final WebMageClient client;
    private final Session session;
    private volatile UUID mainChatId;

    public ServerConnection() {
        this.client = new WebMageClient();
        this.session = new SessionImpl(client);
    }

    public WebMageClient getClient() {
        return client;
    }

    public Session getSession() {
        return session;
    }

    /**
     * Open a session against the given server, using default (guest) user data
     * so the lobby is reachable without a saved profile.
     *
     * @return true when the handshake succeeds
     */
    public boolean connect(String host, int port, String userName) {
        Connection connection = new Connection();
        connection.setHost(host.trim());
        connection.setPort(port);
        connection.setUsername(userName.trim());
        connection.setProxyType(Connection.ProxyType.NONE);
        connection.setUserData(UserData.getDefaultUserDataView());
        return session.connectStart(connection);
    }

    public boolean isConnected() {
        return session.isConnected();
    }

    public String getLastError() {
        return session.getLastError();
    }

    /**
     * Tables currently open in the main room. Returns an empty list rather than
     * throwing so the gateway can return a clean empty result.
     */
    public Collection<TableView> getTables() {
        try {
            UUID roomId = session.getMainRoomId();
            if (roomId == null) {
                return Collections.emptyList();
            }
            Collection<TableView> tables = session.getTables(roomId);
            return tables == null ? Collections.emptyList() : tables;
        } catch (MageRemoteException e) {
            return Collections.emptyList();
        }
    }

    /**
     * Join the main room's chat so its messages start arriving via callbacks.
     * Best-effort: returns false if the room/chat can't be resolved.
     */
    public boolean joinMainChat() {
        UUID roomId = session.getMainRoomId();
        if (roomId == null) {
            return false;
        }
        Optional<UUID> chatId = session.getRoomChatId(roomId);
        if (!chatId.isPresent()) {
            return false;
        }
        boolean joined = session.joinChat(chatId.get());
        if (joined) {
            this.mainChatId = chatId.get();
        }
        return joined;
    }

    public UUID getMainChatId() {
        return mainChatId;
    }

    /** Send a message to the main room chat. */
    public boolean sendChat(String message) {
        if (mainChatId == null || message == null || message.trim().isEmpty()) {
            return false;
        }
        return session.sendChatMessage(mainChatId, message);
    }

    /**
     * Start spectating a game. The server then pushes GAME_INIT / GAME_UPDATE
     * callbacks (carrying a GameView) for this game id.
     */
    public boolean watchGame(UUID gameId) {
        return gameId != null && session.watchGame(gameId);
    }

    public boolean stopWatching(UUID gameId) {
        return gameId != null && session.stopWatching(gameId);
    }

    public void disconnect() {
        if (mainChatId != null) {
            try {
                session.leaveChat(mainChatId);
            } catch (Exception ignored) {
                // ignore - disconnecting anyway
            }
            mainChatId = null;
        }
        if (session.isConnected()) {
            session.connectStop(false, false);
        }
    }
}
