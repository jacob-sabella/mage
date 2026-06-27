package mage.client.web.net;

import mage.cards.decks.DeckCardLists;
import mage.cards.decks.importer.DeckImporter;
import mage.constants.MultiplayerAttackOption;
import mage.constants.PlayerAction;
import mage.constants.RangeOfInfluence;
import mage.constants.MatchBufferTime;
import mage.constants.MatchTimeLimit;
import mage.constants.SkillLevel;
import mage.game.match.MatchOptions;
import mage.players.PlayerType;
import mage.players.net.UserData;
import mage.remote.Connection;
import mage.remote.MageRemoteException;
import mage.remote.Session;
import mage.remote.SessionImpl;
import mage.view.MatchView;
import mage.view.TableView;

import java.util.Collection;
import java.util.Collections;
import java.util.Optional;
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
    private volatile UUID mainChatId;
    private volatile String playerName;

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
        return connect(host, port, userName, -1, null);
    }

    /** Connect with an optional profile (avatar id, flag) carried in UserData. */
    public boolean connect(String host, int port, String userName, int avatarId, String flagName) {
        this.playerName = userName.trim();
        Connection connection = new Connection();
        connection.setHost(host.trim());
        connection.setPort(port);
        connection.setUsername(userName.trim());
        connection.setProxyType(Connection.ProxyType.NONE);
        UserData userData = UserData.getDefaultUserDataView();
        if (avatarId >= 0) {
            userData.setAvatarId(avatarId);
        }
        if (flagName != null && !flagName.trim().isEmpty()) {
            userData.setFlagName(flagName.trim());
        }
        connection.setUserData(userData);
        return session.connectStart(connection);
    }

    public boolean isConnected() {
        return session.isConnected();
    }

    public String getServerHost() {
        return session.getServerHost();
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

    /**
     * Join the main room's chat so its messages start arriving via callbacks.
     * Best-effort: returns false if the room/chat can't be resolved.
     */
    public boolean joinMainChat() {
        UUID roomId = session.getMainRoomId();
        if (roomId == null) {
            return false;
        }
        Optional<UUID> chatId = session.getRoomChatId(roomId);
        if (!chatId.isPresent()) {
            return false;
        }
        boolean joined = session.joinChat(chatId.get());
        if (joined) {
            this.mainChatId = chatId.get();
        }
        return joined;
    }

    public UUID getMainChatId() {
        return mainChatId;
    }

    /** Send a message to the main room chat. */
    public boolean sendChat(String message) {
        if (mainChatId == null || message == null || message.trim().isEmpty()) {
            return false;
        }
        return session.sendChatMessage(mainChatId, message);
    }

    /**
     * Start spectating a game. The server then pushes GAME_INIT / GAME_UPDATE
     * callbacks (carrying a GameView) for this game id.
     */
    public boolean watchGame(UUID gameId) {
        return gameId != null && session.watchGame(gameId);
    }

    public boolean stopWatching(UUID gameId) {
        return gameId != null && session.stopWatching(gameId);
    }

    /**
     * Sit down at an existing open table with a deck loaded from a .dck file on
     * the server. When the match starts the server pushes START_GAME, after
     * which {@link #joinGame} subscribes to the live decision callbacks.
     */
    public boolean joinTable(UUID tableId, String deckPath) {
        UUID roomId = session.getMainRoomId();
        if (roomId == null || tableId == null) {
            return false;
        }
        DeckCardLists deck = DeckImporter.importDeckFromFile(deckPath, false);
        return session.joinTable(roomId, tableId, playerName, PlayerType.HUMAN, 1, deck, "");
    }

    /** Subscribe to a game's callbacks as a seated player (called on START_GAME). */
    public boolean joinGame(UUID gameId) {
        return gameId != null && session.joinGame(gameId);
    }

    /**
     * Create a 1v1 table vs a computer opponent, seat both players with the
     * given deck, and start the match. The server then pushes START_GAME and
     * the live decision callbacks. Uses Freeform Commander so most decks
     * (incl. singleton/commander) are accepted. Returns the table id, or null.
     */
    public UUID createGameVsAi(String deckPath) {
        UUID roomId = session.getMainRoomId();
        if (roomId == null) {
            return null;
        }
        DeckCardLists deck = DeckImporter.importDeckFromFile(deckPath, false);

        // Pick a format that accepts the chosen deck: commander decks (a small
        // sideboard holding the commander + a large singleton main) use Freeform
        // Commander; everything else uses Two Player Duel with the most lenient
        // (no-banlist) constructed validator.
        int mainTotal = totalCards(deck.getCards());
        int sideTotal = totalCards(deck.getSideboard());
        boolean commander = sideTotal >= 1 && sideTotal <= 3 && mainTotal >= 90;
        String gameType = commander ? "Freeform Commander Two Player Duel" : "Two Player Duel";
        String deckType = commander ? "Variant Magic - Freeform Commander" : "Constructed - Freeform";

        MatchOptions options = new MatchOptions(playerName + "'s game", gameType, false);
        options.getPlayerTypes().add(PlayerType.HUMAN);
        options.getPlayerTypes().add(PlayerType.COMPUTER_MAD);
        options.setDeckType(deckType);
        options.setLimited(false);
        options.setWinsNeeded(1);
        options.setSkillLevel(SkillLevel.CASUAL);
        options.setRange(RangeOfInfluence.ALL);
        options.setAttackOption(MultiplayerAttackOption.LEFT);
        options.setMatchTimeLimit(MatchTimeLimit.NONE);
        options.setMatchBufferTime(MatchBufferTime.NONE);
        // accept any player regardless of quit ratio / rating (solo vs AI)
        options.setQuitRatio(100);
        options.setMinimumRating(0);

        TableView table = session.createTable(roomId, options);
        if (table == null) {
            return null;
        }
        UUID tableId = table.getTableId();
        boolean aiOk = session.joinTable(roomId, tableId, "Computer", PlayerType.COMPUTER_MAD, 6, deck, "");
        boolean meOk = session.joinTable(roomId, tableId, playerName, PlayerType.HUMAN, 1, deck, "");
        if (!aiOk || !meOk || !session.startMatch(roomId, tableId)) {
            session.removeTable(roomId, tableId);
            return null;
        }
        return tableId;
    }

    private static int totalCards(java.util.List<mage.cards.decks.DeckCardInfo> cards) {
        int t = 0;
        if (cards != null) {
            for (mage.cards.decks.DeckCardInfo c : cards) {
                t += Math.max(1, c.getAmount());
            }
        }
        return t;
    }

    // --- player responses (server tracks the current pending decision) -------

    public boolean respondBoolean(UUID gameId, boolean value) {
        return gameId != null && session.sendPlayerBoolean(gameId, value);
    }

    public boolean respondUUID(UUID gameId, UUID value) {
        return gameId != null && value != null && session.sendPlayerUUID(gameId, value);
    }

    public boolean respondInteger(UUID gameId, int value) {
        return gameId != null && session.sendPlayerInteger(gameId, value);
    }

    public boolean respondString(UUID gameId, String value) {
        return gameId != null && session.sendPlayerString(gameId, value);
    }

    public boolean sendAction(UUID gameId, PlayerAction action) {
        return gameId != null && action != null && session.sendPlayerAction(action, gameId, null);
    }

    public boolean concede(UUID gameId) {
        return gameId != null && session.quitMatch(gameId);
    }

    /** Finished matches in the main room (history). Empty on error. */
    public Collection<MatchView> getFinishedMatches() {
        try {
            UUID roomId = session.getMainRoomId();
            if (roomId == null) {
                return Collections.emptyList();
            }
            Collection<MatchView> matches = session.getFinishedMatches(roomId);
            return matches == null ? Collections.emptyList() : matches;
        } catch (MageRemoteException e) {
            return Collections.emptyList();
        }
    }

    public void disconnect() {
        if (mainChatId != null) {
            try {
                session.leaveChat(mainChatId);
            } catch (Exception ignored) {
                // ignore - disconnecting anyway
            }
            mainChatId = null;
        }
        if (session.isConnected()) {
            session.connectStop(false, false);
        }
    }
}
