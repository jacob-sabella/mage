package mage.client.fx;

import javafx.application.Application;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Scene;
import javafx.scene.layout.BorderPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.StackPane;
import javafx.scene.paint.Color;
import javafx.scene.shape.Circle;
import javafx.scene.text.Text;
import javafx.stage.Stage;
import mage.client.fx.net.ServerConnection;
import mage.client.fx.view.LobbyView;
import mage.client.fx.view.LoginView;

/**
 * Entry point for the modern JavaFX XMage client.
 * <p>
 * This is a working vertical slice: it owns a single {@link ServerConnection}
 * (the reused Mage.Common session) and swaps screens inside one window -
 * login first, then the server lobby once connected. New screens (deck editor,
 * game table, draft, ...) plug into the same shell + design system.
 *
 * @author XMage FX client
 */
public class MageFxApp extends Application {

    private final ServerConnection connection = new ServerConnection();
    private final StackPane contentArea = new StackPane();

    @Override
    public void start(Stage stage) {
        BorderPane shell = new BorderPane();
        shell.getStyleClass().add("app-bg");
        shell.setTop(buildTopBar());

        contentArea.setPadding(new Insets(24));
        shell.setCenter(contentArea);

        showLogin();

        Scene scene = new Scene(shell, 1080, 720);
        scene.getStylesheets().add(
                getClass().getResource("/mage/client/fx/css/obsidian.css").toExternalForm());

        stage.setScene(scene);
        stage.setTitle("XMage — Obsidian");
        stage.setMinWidth(900);
        stage.setMinHeight(600);
        stage.show();
    }

    private HBox buildTopBar() {
        HBox bar = new HBox(10);
        bar.getStyleClass().add("topbar");
        bar.setAlignment(Pos.CENTER_LEFT);

        Circle dot = new Circle(6);
        dot.getStyleClass().add("brand-dot");
        dot.setFill(Color.web("#5b8cff"));

        Text name = new Text("XMage");
        name.getStyleClass().add("h2");
        name.setFill(Color.web("#e2e6ee"));

        Text tag = new Text("Obsidian");
        tag.getStyleClass().add("brand-accent");
        tag.setFill(Color.web("#2dd4bf"));

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        bar.getChildren().addAll(dot, name, tag, spacer);
        return bar;
    }

    /** Swap the central screen. */
    private void setContent(Region view) {
        contentArea.getChildren().setAll(view);
    }

    public void showLogin() {
        setContent(new LoginView(connection, this::showLobby).getRoot());
    }

    public void showLobby() {
        setContent(new LobbyView(connection, this::showLogin).getRoot());
    }

    public static void main(String[] args) {
        launch(args);
    }
}
