package mage.client.web.dto;

import mage.ObjectColor;
import mage.constants.CardType;
import mage.view.CardView;
import mage.view.GameView;
import mage.view.PermanentView;
import mage.view.PlayerView;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * JSON-friendly projection of the server's {@link GameView}, for spectating.
 * Carries the board state the web UI renders: turn / phase, each player's
 * vitals and battlefield, and the stack. The full view holds far more (combat
 * groups, exile, reveals, playable objects, ...) which later slices can add.
 *
 * @author XMage web client
 */
public class GameDto {

    public int turn;
    public String phase;
    public String step;
    public String activePlayer;
    public String priorityPlayer;
    public List<PlayerDto> players = new ArrayList<>();
    public List<CardDto> stack = new ArrayList<>();

    public static GameDto from(GameView game) {
        GameDto dto = new GameDto();
        dto.turn = game.getTurn();
        dto.phase = game.getPhase() == null ? null : game.getPhase().toString();
        dto.step = game.getStep() == null ? null : game.getStep().toString();
        dto.activePlayer = game.getActivePlayerName();
        dto.priorityPlayer = game.getPriorityPlayerName();

        for (PlayerView player : game.getPlayers()) {
            dto.players.add(PlayerDto.from(player));
        }
        if (game.getStack() != null) {
            for (CardView card : game.getStack().values()) {
                dto.stack.add(CardDto.from(card));
            }
        }
        return dto;
    }

    public static class PlayerDto {
        public String id;
        public String name;
        public int life;
        public int libraryCount;
        public int handCount;
        public int graveyardCount;
        public boolean active;
        public List<CardDto> battlefield = new ArrayList<>();

        static PlayerDto from(PlayerView player) {
            PlayerDto dto = new PlayerDto();
            dto.id = player.getPlayerId() == null ? null : player.getPlayerId().toString();
            dto.name = player.getName();
            dto.life = player.getLife();
            dto.libraryCount = player.getLibraryCount();
            dto.handCount = player.getHandCount();
            dto.graveyardCount = player.getGraveyard() == null ? 0 : player.getGraveyard().size();
            dto.active = player.isActive();
            Map<UUID, PermanentView> battlefield = player.getBattlefield();
            if (battlefield != null) {
                for (PermanentView permanent : battlefield.values()) {
                    dto.battlefield.add(CardDto.from(permanent));
                }
            }
            return dto;
        }
    }

    public static class CardDto {
        public String id;
        public String name;
        public String power;
        public String toughness;
        public String loyalty;
        public String manaCost;
        public String colors;
        public List<String> types = new ArrayList<>();
        public boolean tapped;
        public int damage;

        static CardDto from(CardView card) {
            CardDto dto = new CardDto();
            dto.id = card.getId() == null ? null : card.getId().toString();
            dto.name = card.getName();
            dto.power = card.getPower();
            dto.toughness = card.getToughness();
            dto.loyalty = card.getLoyalty();
            dto.manaCost = card.getManaCostStr();
            dto.colors = colorLetters(card.getColor());
            if (card.getCardTypes() != null) {
                for (CardType type : card.getCardTypes()) {
                    dto.types.add(type.toString());
                }
            }
            if (card instanceof PermanentView) {
                PermanentView permanent = (PermanentView) card;
                dto.tapped = permanent.isTapped();
                dto.damage = permanent.getDamage();
            }
            return dto;
        }
    }

    /** Compact WUBRG string for a card's color, e.g. "UR" or "" for colorless. */
    static String colorLetters(ObjectColor color) {
        if (color == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        if (color.isWhite()) sb.append('W');
        if (color.isBlue()) sb.append('U');
        if (color.isBlack()) sb.append('B');
        if (color.isRed()) sb.append('R');
        if (color.isGreen()) sb.append('G');
        return sb.toString();
    }
}
