package mage.client.fx.view;

import javafx.application.Platform;
import javafx.concurrent.Task;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.PasswordField;
import javafx.scene.control.TextField;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.StackPane;
import javafx.scene.layout.VBox;
import mage.client.fx.net.ServerConnection;

/**
 * Modern connect screen. Collects server host/port/username and opens a real
 * session via {@link ServerConnection} on a background thread, then hands off
 * to the lobby on success.
 *
 * @author XMage FX client
 */
public class LoginView {

    private static final String DEFAULT_HOST = "localhost";
    private static final String DEFAULT_PORT = "17171";

    private final ServerConnection connection;
    private final Runnable onConnected;
    private final StackPane root = new StackPane();

    private TextField hostField;
    private TextField portField;
    private TextField userField;
    private Button connectButton;
    private Label status;

    public LoginView(ServerConnection connection, Runnable onConnected) {
        this.connection = connection;
        this.onConnected = onConnected;
        build();
    }

    public Region getRoot() {
        return root;
    }

    private void build() {
        VBox card = new VBox(6);
        card.getStyleClass().add("panel");
        card.setPadding(new Insets(32));
        card.setMaxWidth(380);
        card.setMaxHeight(Region.USE_PREF_SIZE);
        card.setAlignment(Pos.TOP_LEFT);

        Label title = new Label("Connect to a server");
        title.getStyleClass().add("h1");
        Label subtitle = new Label("Play Magic against players and AI opponents.");
        subtitle.getStyleClass().add("subtitle");

        hostField = textField(DEFAULT_HOST, "Host");
        portField = textField(DEFAULT_PORT, "Port");
        userField = textField("", "Your display name");

        // Password is part of the protocol but optional for guest play; kept here
        // so the screen maps cleanly onto the existing Connection model.
        PasswordField passwordField = new PasswordField();
        passwordField.setPromptText("Password (optional)");

        HBox hostRow = new HBox(12, labeled("SERVER", hostField), labeled("PORT", portField));
        HBox.setHgrow(hostField, Priority.ALWAYS);
        portField.setMaxWidth(110);

        connectButton = new Button("Connect");
        connectButton.getStyleClass().add("primary");
        connectButton.setMaxWidth(Double.MAX_VALUE);
        connectButton.setOnAction(e -> doConnect(passwordField));

        status = new Label("");
        status.setWrapText(true);

        card.getChildren().addAll(
                title,
                subtitle,
                spacer(14),
                hostRow,
                spacer(10),
                labeled("DISPLAY NAME", userField),
                spacer(10),
                labeled("PASSWORD", passwordField),
                spacer(18),
                connectButton,
                spacer(6),
                status);

        root.getChildren().add(card);
        StackPane.setAlignment(card, Pos.CENTER);
    }

    private void doConnect(PasswordField passwordField) {
        String host = hostField.getText();
        String userName = userField.getText();
        int port;
        try {
            port = Integer.parseInt(portField.getText().trim());
        } catch (NumberFormatException ex) {
            setStatus("Port must be a number.", true);
            return;
        }
        if (host.trim().isEmpty() || userName.trim().isEmpty()) {
            setStatus("Server and display name are required.", true);
            return;
        }

        setBusy(true);
        setStatus("Connecting to " + host.trim() + ":" + port + " …", false);

        Task<Boolean> task = new Task<Boolean>() {
            @Override
            protected Boolean call() {
                return connection.connect(host, port, userName);
            }
        };
        task.setOnSucceeded(e -> {
            setBusy(false);
            if (Boolean.TRUE.equals(task.getValue())) {
                onConnected.run();
            } else {
                String err = connection.getLastError();
                setStatus("Could not connect" + (err == null || err.isEmpty() ? "." : ": " + err), true);
            }
        });
        task.setOnFailed(e -> {
            setBusy(false);
            Throwable ex = task.getException();
            setStatus("Connection error: " + (ex == null ? "unknown" : ex.getMessage()), true);
        });
        Thread t = new Thread(task, "fx-connect");
        t.setDaemon(true);
        t.start();
    }

    private void setBusy(boolean busy) {
        connectButton.setDisable(busy);
        connectButton.setText(busy ? "Connecting…" : "Connect");
    }

    private void setStatus(String text, boolean error) {
        Runnable update = () -> {
            status.setText(text);
            status.getStyleClass().removeAll("status-error", "status-ok");
            status.getStyleClass().add(error ? "status-error" : "status-ok");
        };
        if (Platform.isFxApplicationThread()) {
            update.run();
        } else {
            Platform.runLater(update);
        }
    }

    private static TextField textField(String value, String prompt) {
        TextField field = new TextField(value);
        field.setPromptText(prompt);
        return field;
    }

    private static VBox labeled(String label, Region control) {
        Label l = new Label(label);
        l.getStyleClass().add("field-label");
        VBox box = new VBox(4, l, control);
        HBox.setHgrow(box, Priority.ALWAYS);
        return box;
    }

    private static Region spacer(double height) {
        Region r = new Region();
        r.setMinHeight(height);
        r.setPrefHeight(height);
        return r;
    }
}
