package mage.client.web.dto;

import mage.cards.repository.CardInfo;
import mage.cards.repository.CardRepository;
import mage.view.DraftPickView;
import mage.view.SimpleCardView;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * A booster-draft pick projected for the browser: the booster to pick from and
 * the cards already picked. Card names are resolved from the bundled
 * {@link CardRepository} (the draft view only carries set code + number), which
 * also lets the UI fetch art via /api/cardimg.
 *
 * @author XMage web client
 */
public class DraftDto {

    public List<DraftCard> booster = new ArrayList<>();
    public List<DraftCard> picks = new ArrayList<>();
    public int timeout;

    public static class DraftCard {
        public String id;
        public String name;
        public String set;
        public String num;
        public String colors = ""; // WUBRG letters (for manabase auto-build)
    }

    /** Project a SimpleCardsView (e.g. the drafted pool from a DeckView) to cards. */
    public static List<DraftCard> cardsFrom(mage.view.SimpleCardsView cards) {
        List<DraftCard> out = new ArrayList<>();
        if (cards != null) {
            cards.forEach((id, cv) -> out.add(toCard(id, cv)));
        }
        return out;
    }

    private static DraftCard toCard(UUID id, SimpleCardView v) {
        DraftCard c = new DraftCard();
        c.id = id.toString();
        c.set = v.getExpansionSetCode();
        c.num = v.getCardNumber();
        CardInfo info = CardRepository.instance.findCard(c.set, c.num);
        c.name = info == null ? (c.set + " #" + c.num) : info.getName();
        c.colors = info == null ? "" : colorLetters(info);
        return c;
    }

    private static String colorLetters(CardInfo info) {
        StringBuilder sb = new StringBuilder();
        mage.ObjectColor color = info.getColor();
        if (color == null) {
            return "";
        }
        if (color.isWhite()) sb.append('W');
        if (color.isBlue()) sb.append('U');
        if (color.isBlack()) sb.append('B');
        if (color.isRed()) sb.append('R');
        if (color.isGreen()) sb.append('G');
        return sb.toString();
    }

    public static DraftDto from(DraftPickView v) {
        DraftDto dto = new DraftDto();
        if (v.getBooster() != null) {
            v.getBooster().forEach((id, cv) -> dto.booster.add(toCard(id, cv)));
        }
        if (v.getPicks() != null) {
            v.getPicks().forEach((id, cv) -> dto.picks.add(toCard(id, cv)));
        }
        dto.timeout = v.getTimeout();
        return dto;
    }
}
