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
    }

    private static DraftCard toCard(UUID id, SimpleCardView v) {
        DraftCard c = new DraftCard();
        c.id = id.toString();
        c.set = v.getExpansionSetCode();
        c.num = v.getCardNumber();
        CardInfo info = CardRepository.instance.findCard(c.set, c.num);
        c.name = info == null ? (c.set + " #" + c.num) : info.getName();
        return c;
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
