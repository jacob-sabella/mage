package mage.client.web.dto;

import mage.view.TableView;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Lightweight, JSON-friendly projection of the server's {@link TableView}.
 * The full view carries a large object graph; the browser only needs these
 * lobby columns.
 *
 * @author XMage web client
 */
public class TableDto {

    public String id;
    public String name;
    public String gameType;
    public String deckType;
    public String controller;
    public String seats;
    public String state;
    public String skillLevel;
    public boolean isTournament;
    public boolean passwordProtected;
    public List<String> games = new ArrayList<>();

    public static TableDto from(TableView table) {
        TableDto dto = new TableDto();
        dto.id = table.getTableId() == null ? null : table.getTableId().toString();
        dto.name = table.getTableName();
        dto.gameType = table.getGameType();
        dto.deckType = table.getDeckType();
        dto.controller = table.getControllerName();
        dto.seats = table.getSeatsInfo();
        dto.state = table.getTableStateText();
        dto.skillLevel = table.getSkillLevel() == null ? null : table.getSkillLevel().toString();
        dto.isTournament = table.isTournament();
        dto.passwordProtected = table.isPassworded();
        if (table.getGames() != null) {
            for (UUID gameId : table.getGames()) {
                dto.games.add(gameId.toString());
            }
        }
        return dto;
    }
}
