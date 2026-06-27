package mage.client.web.dto;

import mage.cards.repository.CardInfo;
import mage.constants.CardType;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Lightweight, JSON-friendly projection of a {@link CardInfo} row from the
 * engine's local card database, for the web deck editor's search results.
 *
 * @author XMage web client
 */
public class CardInfoDto {

    public String name;
    public String manaCost;
    public String colors;
    public List<String> types;
    public String set;
    public String rarity;
    public int manaValue;

    public static CardInfoDto from(CardInfo card) {
        CardInfoDto dto = new CardInfoDto();
        if (card == null) {
            return dto;
        }
        dto.name = card.getName();
        dto.colors = colorLetters(card.getColor());
        try {
            dto.manaCost = String.join("", card.getManaCosts(CardInfo.ManaCostSide.ALL));
        } catch (Exception e) {
            dto.manaCost = "";
        }
        try {
            List<CardType> cardTypes = card.getTypes();
            dto.types = cardTypes == null ? List.of()
                    : cardTypes.stream().map(Enum::name).collect(Collectors.toList());
        } catch (Exception e) {
            dto.types = List.of();
        }
        dto.set = card.getSetCode();
        dto.rarity = card.getRarity() == null ? null : card.getRarity().toString();
        dto.manaValue = card.getManaValue();
        return dto;
    }

    private static String colorLetters(mage.ObjectColor color) {
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
