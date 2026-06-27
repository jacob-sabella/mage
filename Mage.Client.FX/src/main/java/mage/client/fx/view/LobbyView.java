package mage.client.fx.view;

import javafx.application.Platform;
import javafx.beans.property.ReadOnlyStringWrapper;
import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.concurrent.Task;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.TableColumn;
import javafx.scene.control.TableView;
import javafx.scene.layout.BorderPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.VBox;
import mage.client.fx.net.ServerConnection;

import java.util.Collection;
import java.util.function.Function;

/**
 * Server lobby: live list of open tables, pulled from the real session via
 * {@link ServerConnection#getTables()}. Demonstrates that the new UI consumes
 * the shared {@code mage.view} DTOs directly - the same objects the Swing
 * client renders.
 *
 * @author XMage FX client
 */
public class LobbyView {

    private final ServerConnection connection;
    private final Runnable onDisconnected;
    private final BorderPane root = new BorderPane();

    private final ObservableList<mage.view.TableView> tables = FXCollections.observableArrayList();
    private TableView<mage.view.TableView> tableView;
    private Button refreshButton;
    private Label countLabel;

    public LobbyView(ServerConnection connection, Runnable onDisconnected) {
        this.connection = connection;
        this.onDisconnected = onDisconnected;
        build();
        refresh();
    }

    public Region getRoot() {
        return root;
    }

    private void build() {
        root.setTop(buildHeader());

        VBox body = new VBox(12);
        body.setPadding(new Insets(20, 4, 4, 4));
        body.getChildren().add(buildTable());
        VBox.setVgrow(tableView, Priority.ALWAYS);
        root.setCenter(body);
    }

    private HBox buildHeader() {
        Label title = new Label("Open tables");
        title.getStyleClass().add("h1");

        countLabel = new Label("");
        countLabel.getStyleClass().add("chip");

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        refreshButton = new Button("Refresh");
        refreshButton.setOnAction(e -> refresh());

        Button disconnect = new Button("Disconnect");
        disconnect.getStyleClass().add("ghost");
        disconnect.setOnAction(e -> {
            connection.disconnect();
            onDisconnected.run();
        });

        HBox header = new HBox(12, title, countLabel, spacer, refreshButton, disconnect);
        header.setAlignment(Pos.CENTER_LEFT);
        header.setPadding(new Insets(4, 4, 0, 4));
        return header;
    }

    private TableView<mage.view.TableView> buildTable() {
        tableView = new TableView<>(tables);
        tableView.setColumnResizePolicy(TableView.CONSTRAINED_RESIZE_POLICY);
        tableView.setPlaceholder(new Label("No open tables right now. Create one or refresh."));

        tableView.getColumns().add(column("Table", 0.30, mage.view.TableView::getTableName));
        tableView.getColumns().add(column("Game type", 0.22, mage.view.TableView::getGameType));
        tableView.getColumns().add(column("Host", 0.16, mage.view.TableView::getControllerName));
        tableView.getColumns().add(column("Seats", 0.16, mage.view.TableView::getSeatsInfo));
        tableView.getColumns().add(column("State", 0.16, mage.view.TableView::getTableStateText));
        return tableView;
    }

    private TableColumn<mage.view.TableView, String> column(
            String title, double widthRatio, Function<mage.view.TableView, String> getter) {
        TableColumn<mage.view.TableView, String> col = new TableColumn<>(title);
        col.setCellValueFactory(c -> new ReadOnlyStringWrapper(safe(getter.apply(c.getValue()))));
        col.setMaxWidth(widthRatio * 10000);
        col.setPrefWidth(widthRatio * 1000);
        return col;
    }

    private void refresh() {
        refreshButton.setDisable(true);
        refreshButton.setText("Refreshing…");

        Task<Collection<mage.view.TableView>> task = new Task<Collection<mage.view.TableView>>() {
            @Override
            protected Collection<mage.view.TableView> call() {
                return connection.getTables();
            }
        };
        task.setOnSucceeded(e -> {
            tables.setAll(task.getValue());
            countLabel.setText(tables.size() + (tables.size() == 1 ? " table" : " tables"));
            doneRefreshing();
        });
        task.setOnFailed(e -> doneRefreshing());

        Thread t = new Thread(task, "fx-lobby-refresh");
        t.setDaemon(true);
        t.start();
    }

    private void doneRefreshing() {
        Platform.runLater(() -> {
            refreshButton.setDisable(false);
            refreshButton.setText("Refresh");
        });
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }
}
