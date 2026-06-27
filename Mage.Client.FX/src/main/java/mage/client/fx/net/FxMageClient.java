package mage.client.fx.net;

import mage.interfaces.MageClient;
import mage.interfaces.callback.ClientCallback;
import mage.utils.MageVersion;

import java.util.function.Consumer;

/**
 * Client-side endpoint the server talks back to.
 * <p>
 * This is the JavaFX equivalent of the Swing {@code MageFrame}'s callback
 * handling: the server pushes {@link ClientCallback} events (chat, game
 * updates, join/leave, etc.) through {@link #onCallback}, and lifecycle
 * messages through the other methods. We keep it deliberately thin and expose
 * simple {@link Consumer} hooks so views can subscribe without this class
 * depending on any UI code.
 *
 * @author XMage FX client
 */
public class FxMageClient implements MageClient {

    private final MageVersion version;

    private Consumer<ClientCallback> callbackHandler = c -> { };
    private Consumer<String> messageHandler = m -> { };
    private Consumer<String> errorHandler = e -> { };
    private Runnable onConnected = () -> { };
    private Runnable onDisconnected = () -> { };

    public FxMageClient() {
        // Derive the protocol version from the shared engine jar, exactly like the
        // Swing client does, so the handshake matches the server it connects to.
        this.version = new MageVersion(FxMageClient.class);
    }

    @Override
    public MageVersion getVersion() {
        return version;
    }

    @Override
    public void connected(String message) {
        messageHandler.accept(message);
        onConnected.run();
    }

    @Override
    public void disconnected(boolean askToReconnect, boolean keepMySessionActive) {
        onDisconnected.run();
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
        // First connection established - nothing extra needed for the lobby slice.
    }

    @Override
    public void onCallback(ClientCallback callback) {
        callbackHandler.accept(callback);
    }

    // --- subscription hooks (set by the views) -------------------------------

    public void setCallbackHandler(Consumer<ClientCallback> handler) {
        this.callbackHandler = handler == null ? c -> { } : handler;
    }

    public void setMessageHandler(Consumer<String> handler) {
        this.messageHandler = handler == null ? m -> { } : handler;
    }

    public void setErrorHandler(Consumer<String> handler) {
        this.errorHandler = handler == null ? e -> { } : handler;
    }

    public void setOnConnected(Runnable onConnected) {
        this.onConnected = onConnected == null ? () -> { } : onConnected;
    }

    public void setOnDisconnected(Runnable onDisconnected) {
        this.onDisconnected = onDisconnected == null ? () -> { } : onDisconnected;
    }
}
