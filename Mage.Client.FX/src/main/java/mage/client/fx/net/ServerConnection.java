package mage.client.fx.net;

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
 * Thin façade over the shared {@link Session} (JBoss-remoting transport).
 * <p>
 * The whole point of the new client is that it reuses this layer unchanged: the
 * networking, serialization and protocol all live in {@code Mage.Common}. This
 * class only adds convenience and keeps the JavaFX views free of remoting
 * details. All calls here are blocking and are expected to run off the JavaFX
 * Application Thread (see {@code ServerConnectionService}).
 *
 * @author XMage FX client
 */
public class ServerConnection {

    private final FxMageClient client;
    private final Session session;

    public ServerConnection() {
        this.client = new FxMageClient();
        this.session = new SessionImpl(client);
    }

    public FxMageClient getClient() {
        return client;
    }

    public Session getSession() {
        return session;
    }

    /**
     * Open a session against the given server. Mirrors the {@code Connection}
     * setup the Swing client performs, using default (guest) user data so the
     * lobby is reachable without a saved profile.
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

    public UUID getMainRoomId() {
        return session.getMainRoomId();
    }

    /**
     * Tables currently open in the main room. Returns an empty list rather than
     * throwing so the UI layer can render a clean "no tables" state.
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
