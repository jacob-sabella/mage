package mage.client.web.dto;

import mage.ObjectColor;
import mage.constants.CardType;
import mage.view.CardView;
import mage.view.CommandObjectView;
import mage.view.CounterView;
import mage.view.DungeonView;
import mage.view.EmblemView;
import mage.view.GameView;
import mage.view.LookedAtView;
import mage.view.PermanentView;
import mage.view.PlaneView;
import mage.view.PlayerView;
import mage.view.RevealedView;
import mage.view.SimpleCardView;
import mage.view.StackAbilityView;

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
    public String me; // the seated/viewing player's name (null for spectators)
    public List<PlayerDto> players = new ArrayList<>();
    public List<CardDto> stack = new ArrayList<>();
    // ids of objects the viewing player may currently play/activate (for highlighting)
    public List<String> canPlay = new ArrayList<>();
    // the seated player's hand (empty for pure spectators)
    public List<CardDto> myHand = new ArrayList<>();
    public List<CombatDto> combat = new ArrayList<>();
    // special actions available to the priority player. The upstream GameView only
    // carries a boolean flag; answering with the string "special" (the id below)
    // makes the server push a choice prompt listing the concrete actions.
    public List<SpecialActionDto> special = new ArrayList<>();
    // face-up card reveals (e.g. "Reveal the top card of your library")
    public List<NamedCardsDto> revealed = new ArrayList<>();
    // cards only the seated player may look at (e.g. scry, "look at the top N")
    public List<NamedCardsDto> lookedAt = new ArrayList<>();

    public static GameDto from(GameView game) {
        GameDto dto = new GameDto();
        dto.turn = game.getTurn();
        dto.phase = game.getPhase() == null ? null : game.getPhase().toString();
        dto.step = game.getStep() == null ? null : game.getStep().toString();
        dto.activePlayer = game.getActivePlayerName();
        dto.priorityPlayer = game.getPriorityPlayerName();
        dto.me = game.getMyPlayer() == null ? null : game.getMyPlayer().getName();

        for (PlayerView player : game.getPlayers()) {
            dto.players.add(PlayerDto.from(player));
        }
        if (game.getStack() != null) {
            for (CardView card : game.getStack().values()) {
                dto.stack.add(CardDto.from(card));
            }
        }
        if (game.getCanPlayObjects() != null) {
            for (UUID id : game.getCanPlayObjects().getObjects().keySet()) {
                dto.canPlay.add(id.toString());
            }
        }
        if (game.getMyHand() != null) {
            for (CardView card : game.getMyHand().values()) {
                dto.myHand.add(CardDto.from(card));
            }
        }
        if (game.getCombat() != null) {
            for (mage.view.CombatGroupView cg : game.getCombat()) {
                dto.combat.add(CombatDto.from(cg));
            }
        }
        if (game.getSpecial()) {
            // the view doesn't carry the list; expose one entry whose id is the
            // string answer that asks the server for the concrete actions
            dto.special.add(new SpecialActionDto("special", "Special"));
        }
        if (game.getRevealed() != null) {
            for (RevealedView rv : game.getRevealed()) {
                NamedCardsDto named = new NamedCardsDto(rv.getName());
                if (rv.getCards() != null) {
                    for (CardView card : rv.getCards().values()) {
                        named.cards.add(CardDto.from(card));
                    }
                }
                dto.revealed.add(named);
            }
        }
        if (game.getLookedAt() != null) {
            for (LookedAtView lv : game.getLookedAt()) {
                NamedCardsDto named = new NamedCardsDto(lv.getName());
                if (lv.getCards() != null) {
                    for (SimpleCardView card : lv.getCards().values()) {
                        named.cards.add(CardDto.fromSimple(card));
                    }
                }
                dto.lookedAt.add(named);
            }
        }
        return dto;
    }

    /** A named group of cards (a reveal window or a look-at window). */
    public static class NamedCardsDto {
        public String name;
        public List<CardDto> cards = new ArrayList<>();

        NamedCardsDto(String name) {
            this.name = name;
        }
    }

    /** A special action the priority player can take (e.g. pay with delve). */
    public static class SpecialActionDto {
        public String id;
        public String name;

        SpecialActionDto(String id, String name) {
            this.id = id;
            this.name = name;
        }
    }

    /** A counter on a card or player, e.g. {"name":"poison","count":2}. */
    public static class CounterDto {
        public String name;
        public int count;

        CounterDto(String name, int count) {
            this.name = name;
            this.count = count;
        }
    }

    public static class CombatDto {
        public List<String> attackers = new ArrayList<>();
        public List<String> blockers = new ArrayList<>();
        public String defender;
        public String defenderId;
        public boolean blocked;

        static CombatDto from(mage.view.CombatGroupView cg) {
            CombatDto dto = new CombatDto();
            // Use the card id (not the name): the web board keys battlefield cards
            // by id, so the arrow renderer resolves attacker/blocker positions by id.
            if (cg.getAttackers() != null) {
                for (CardView c : cg.getAttackers().values()) {
                    if (c.getId() != null) dto.attackers.add(c.getId().toString());
                }
            }
            if (cg.getBlockers() != null) {
                for (CardView c : cg.getBlockers().values()) {
                    if (c.getId() != null) dto.blockers.add(c.getId().toString());
                }
            }
            dto.defender = cg.getDefenderName();
            // the id as well: planeswalker/battle defenders are battlefield cards,
            // which the web board resolves by id (names aren't unique)
            dto.defenderId = cg.getDefenderId() == null ? null : cg.getDefenderId().toString();
            dto.blocked = cg.isBlocked();
            return dto;
        }
    }

    public static class PlayerDto {
        public String id;
        public String name;
        public int life;
        public int libraryCount;
        public int handCount;
        public int graveyardCount;
        public boolean active;
        public String manaPool; // compact floating mana, e.g. "2 {R}{R}{C}" (empty if none)
        public List<CardDto> battlefield = new ArrayList<>();
        public List<CardDto> graveyard = new ArrayList<>();
        public List<CardDto> exile = new ArrayList<>();
        // command zone objects (commanders, emblems, planes, dungeons)
        public List<CardDto> command = new ArrayList<>();
        // player counters (poison, energy, experience, rad, ...)
        public List<CounterDto> counters = new ArrayList<>();
        // designations such as "Monarch", "Initiative", "City's Blessing"
        public List<String> designations = new ArrayList<>();

        static PlayerDto from(PlayerView player) {
            PlayerDto dto = new PlayerDto();
            dto.id = player.getPlayerId() == null ? null : player.getPlayerId().toString();
            dto.name = player.getName();
            dto.life = player.getLife();
            dto.libraryCount = player.getLibraryCount();
            dto.handCount = player.getHandCount();
            dto.graveyardCount = player.getGraveyard() == null ? 0 : player.getGraveyard().size();
            dto.active = player.isActive();
            dto.manaPool = manaPoolStr(player.getManaPool());
            Map<UUID, PermanentView> battlefield = player.getBattlefield();
            if (battlefield != null) {
                for (PermanentView permanent : battlefield.values()) {
                    dto.battlefield.add(CardDto.from(permanent));
                }
            }
            if (player.getGraveyard() != null) {
                for (CardView card : player.getGraveyard().values()) {
                    dto.graveyard.add(CardDto.from(card));
                }
            }
            if (player.getExile() != null) {
                for (CardView card : player.getExile().values()) {
                    dto.exile.add(CardDto.from(card));
                }
            }
            if (player.getCommandObjectList() != null) {
                for (CommandObjectView commandObject : player.getCommandObjectList()) {
                    dto.command.add(CardDto.from(commandObject));
                }
            }
            if (player.getCounters() != null) {
                for (CounterView counter : player.getCounters()) {
                    dto.counters.add(new CounterDto(counter.getName(), counter.getCount()));
                }
            }
            // monarch/initiative are game-level flags, not Designation objects
            if (player.isMonarch()) {
                dto.designations.add("Monarch");
            }
            if (player.isInitiative()) {
                dto.designations.add("Initiative");
            }
            if (player.getDesignationNames() != null) {
                for (String designation : player.getDesignationNames()) {
                    if (!dto.designations.contains(designation)) {
                        dto.designations.add(designation);
                    }
                }
            }
            return dto;
        }

        private static String manaPoolStr(mage.view.ManaPoolView m) {
            if (m == null) {
                return "";
            }
            StringBuilder sb = new StringBuilder();
            appendSym(sb, "W", m.getWhite());
            appendSym(sb, "U", m.getBlue());
            appendSym(sb, "B", m.getBlack());
            appendSym(sb, "R", m.getRed());
            appendSym(sb, "G", m.getGreen());
            appendSym(sb, "C", m.getColorless());
            return sb.toString();
        }

        private static void appendSym(StringBuilder sb, String c, int n) {
            for (int i = 0; i < n; i++) {
                sb.append('{').append(c).append('}');
            }
        }
    }

    public static class CardDto {
        public String id;
        public String name;
        public String set;
        public String num;
        public String power;
        public String toughness;
        public String loyalty;
        public String manaCost;
        public String colors;
        public List<String> types = new ArrayList<>();
        public boolean tapped;
        public int damage;
        // counters on this object, e.g. +1/+1, loyalty, charge (loyalty is ALSO
        // kept in the dedicated field above for compatibility)
        public List<CounterDto> counters = new ArrayList<>();
        // ids of permanents/cards attached TO this permanent (auras, equipment)
        public List<String> attachments = new ArrayList<>();
        // id of what this permanent is attached to, or null
        public String attachedTo;
        public boolean faceDown;
        public boolean isToken;
        public boolean isCopy;
        // for command zone objects: "commander" | "emblem" | "plane" | "dungeon" (null otherwise)
        public String commandType;
        // rules text; only filled for command objects without a printed card
        // face (emblems/planes/dungeons), null otherwise
        public List<String> rules;
        // Set only for stack abilities: identifies the source card so the UI can
        // show the right name and look up the card image.
        public String sourceName;
        public String sourceSet;
        public String sourceNum;
        // For a spell/ability on the stack: the ids it targets (drives the board's
        // source→target arrows). sourceId is the battlefield source of an ability,
        // so the arrow can start from the actual permanent.
        public List<String> targets = new ArrayList<>();
        public String sourceId;

        static CardDto from(CardView card) {
            CardDto dto = new CardDto();
            dto.id = card.getId() == null ? null : card.getId().toString();
            dto.name = card.getName();
            dto.set = card.getExpansionSetCode();
            dto.num = card.getCardNumber();
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
            dto.faceDown = card.isFaceDown();
            dto.isToken = card.isToken();
            dto.isCopy = card.isOriginalACopy();
            if (card.getCounters() != null) {
                for (CounterView counter : card.getCounters()) {
                    dto.counters.add(new CounterDto(counter.getName(), counter.getCount()));
                }
            }
            if (card instanceof PermanentView) {
                PermanentView permanent = (PermanentView) card;
                dto.tapped = permanent.isTapped();
                dto.damage = permanent.getDamage();
                dto.isCopy = permanent.isCopy();
                if (permanent.getAttachments() != null) {
                    for (UUID attachment : permanent.getAttachments()) {
                        if (attachment != null) dto.attachments.add(attachment.toString());
                    }
                }
                dto.attachedTo = permanent.getAttachedTo() == null ? null : permanent.getAttachedTo().toString();
            }
            if (card instanceof StackAbilityView) {
                CardView source = ((StackAbilityView) card).getSourceCard();
                if (source != null) {
                    dto.sourceName = source.getName();
                    dto.sourceSet = source.getExpansionSetCode();
                    dto.sourceNum = source.getCardNumber();
                    dto.sourceId = source.getId() == null ? null : source.getId().toString();
                }
            }
            // targets of a spell/ability on the stack (populated by CardView.addTargets)
            if (card.getTargets() != null) {
                for (UUID t : card.getTargets()) {
                    if (t != null) dto.targets.add(t.toString());
                }
            }
            return dto;
        }

        /** A command zone object: commander (a real card) or emblem/plane/dungeon. */
        static CardDto from(CommandObjectView commandObject) {
            CardDto dto;
            if (commandObject instanceof CardView) {
                // CommanderView is a full CardView (real card face)
                dto = from((CardView) commandObject);
            } else {
                // emblems/planes/dungeons have no printed card face - name/rules only
                dto = new CardDto();
                dto.id = commandObject.getId() == null ? null : commandObject.getId().toString();
                dto.name = commandObject.getName();
                dto.set = commandObject.getExpansionSetCode();
                if (commandObject instanceof EmblemView) {
                    dto.num = ((EmblemView) commandObject).getCardNumber();
                }
                if (commandObject.getRules() != null) {
                    dto.rules = new ArrayList<>(commandObject.getRules());
                }
            }
            dto.commandType = commandTypeOf(commandObject);
            return dto;
        }

        private static String commandTypeOf(CommandObjectView commandObject) {
            if (commandObject instanceof EmblemView) return "emblem";
            if (commandObject instanceof PlaneView) return "plane";
            if (commandObject instanceof DungeonView) return "dungeon";
            return "commander";
        }

        /** From a SimpleCardView (looked-at windows): only id + printing are known. */
        static CardDto fromSimple(SimpleCardView card) {
            CardDto dto = new CardDto();
            dto.id = card.getId() == null ? null : card.getId().toString();
            dto.set = card.getExpansionSetCode();
            dto.num = card.getCardNumber();
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
