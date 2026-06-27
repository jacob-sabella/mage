package mage.client.web.net;

import mage.players.net.UserData;
import mage.remote.Connection;
import mage.remote.MageRemoteException;
import mage.remote.Session;
import mage.remote.SessionImpl;
import mage.view.TableView;

import java.util.Collection;
import java.util.Collections;
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

    public void disconnect() {
        if (session.isConnected()) {
            session.connectStop(false, false);
        }
    }
}
