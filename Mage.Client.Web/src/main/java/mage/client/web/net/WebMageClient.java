package mage.client.web.net;

import mage.interfaces.MageClient;
import mage.interfaces.callback.ClientCallback;
import mage.utils.MageVersion;

import java.util.function.Consumer;

/**
 * Client-side endpoint the XMage server pushes events back to, for one browser
 * session. The gateway forwards these to the browser over WebSocket.
 * <p>
 * Equivalent to the Swing {@code MageFrame}'s callback handling, kept UI-free:
 * views/transport hook in via the {@link Consumer} callbacks.
 *
 * @author XMage web client
 */
public class WebMageClient implements MageClient {

    private final MageVersion version;

    private Consumer<ClientCallback> callbackHandler = c -> { };
    private Consumer<String> messageHandler = m -> { };
    private Consumer<String> errorHandler = e -> { };

    public WebMageClient() {
        // Derive the protocol version from the shared engine jar, like the Swing
        // client, so the handshake matches the server.
        this.version = new MageVersion(WebMageClient.class);
    }

    @Override
    public MageVersion getVersion() {
        return version;
    }

    @Override
    public void connected(String message) {
        messageHandler.accept(message);
    }

    @Override
    public void disconnected(boolean askToReconnect, boolean keepMySessionActive) {
        messageHandler.accept("disconnected");
    }

    @Override
    public void showMessage(String message) {
        messageHandler.accept(message);
    }

    @Override
    public void showError(String message) {
        errorHandler.accept(message);
    }

    @Override
    public void onNewConnection() {
        // nothing extra needed for the lobby slice
    }

    @Override
    public void onCallback(ClientCallback callback) {
        if (callback != null) {
            // callback payloads (GameView, etc.) are compressed on the wire;
            // must decompress before getData(), exactly like the Swing client.
            callback.decompressData();
        }
        callbackHandler.accept(callback);
    }

    public void setCallbackHandler(Consumer<ClientCallback> handler) {
        this.callbackHandler = handler == null ? c -> { } : handler;
    }

    public void setMessageHandler(Consumer<String> handler) {
        this.messageHandler = handler == null ? m -> { } : handler;
    }

    public void setErrorHandler(Consumer<String> handler) {
        this.errorHandler = handler == null ? e -> { } : handler;
    }
}
