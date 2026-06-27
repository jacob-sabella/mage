package mage.client.web.dto;

import mage.view.MatchView;

/**
 * JSON-friendly projection of a finished {@link MatchView} for the lobby's
 * match history.
 *
 * @author XMage web client
 */
public class MatchDto {

    public String name;
    public String gameType;
    public String players;
    public String result;
    public boolean replayAvailable;
    public Long endTime;

    public static MatchDto from(MatchView match) {
        MatchDto dto = new MatchDto();
        dto.name = match.getMatchName();
        dto.gameType = match.getGameType();
        dto.players = match.getPlayers();
        dto.result = match.getResult();
        dto.replayAvailable = match.isReplayAvailable();
        dto.endTime = match.getEndTime() == null ? null : match.getEndTime().getTime();
        return dto;
    }
}
