package mage.client.web.dto;

import mage.view.RoundView;
import mage.view.TournamentGameView;
import mage.view.TournamentPlayerView;
import mage.view.TournamentView;

import java.util.ArrayList;
import java.util.List;

/**
 * JSON-friendly projection of the server's {@link TournamentView}: standings
 * plus per-round pairings. Each running pairing carries the sub-table id, so
 * spectating a tournament duel goes through the normal watch-table flow.
 *
 * @author XMage web client
 */
public class TournamentDto {

    public String name;
    public String type;
    public String state;
    public String runningInfo;
    public boolean watchingAllowed;
    public List<PlayerDto> players = new ArrayList<>();
    public List<RoundDto> rounds = new ArrayList<>();

    public static TournamentDto from(TournamentView view) {
        TournamentDto dto = new TournamentDto();
        dto.name = view.getTournamentName();
        dto.type = view.getTournamentType();
        dto.state = view.getTournamentState();
        dto.runningInfo = view.getRunningInfo();
        dto.watchingAllowed = view.isWatchingAllowed();
        for (TournamentPlayerView p : view.getPlayers()) {
            PlayerDto pd = new PlayerDto();
            pd.name = p.getName();
            pd.state = p.getState();
            pd.points = p.getPoints();
            pd.results = p.getResults();
            pd.quit = p.hasQuit();
            dto.players.add(pd);
        }
        int roundNum = 0;
        for (RoundView r : view.getRounds()) {
            roundNum++;
            RoundDto rd = new RoundDto();
            rd.round = roundNum;
            for (TournamentGameView g : r.getGames()) {
                GameDto gd = new GameDto();
                gd.round = g.getRoundNum();
                gd.gameId = g.getGameId() == null ? null : g.getGameId().toString();
                gd.tableId = g.getTableId() == null ? null : g.getTableId().toString();
                gd.state = g.getState();
                gd.result = g.getResult();
                gd.players = g.getPlayers();
                rd.games.add(gd);
            }
            dto.rounds.add(rd);
        }
        return dto;
    }

    public static class PlayerDto {
        public String name;
        public String state;
        public int points;
        public String results;
        public boolean quit;
    }

    public static class RoundDto {
        public int round;
        public List<GameDto> games = new ArrayList<>();
    }

    public static class GameDto {
        public int round;
        public String gameId;
        public String tableId; // the sub-table — spectate via /api/watch-table
        public String state;
        public String result;
        public String players; // "Alice - Bob" display string from the server
    }
}
