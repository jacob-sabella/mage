package mage.client.web;

import mage.ObjectColor;
import mage.cards.repository.CardInfo;
import mage.constants.CardType;
import mage.constants.Rarity;
import mage.constants.SubType;
import mage.constants.SuperType;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses a Scryfall-lite search string into card-DB criteria hints plus a set of
 * post-filter predicates the DB query can't express (colours, mana-value ranges,
 * power/toughness). Isolated + free of any I/O so it can be reasoned about and
 * unit-tested on its own.
 *
 * <p>Supported tokens (bare words match the name, ANDed):
 * <pre>
 *   t:&lt;type|subtype|supertype&gt;   o:"oracle text"      r:&lt;rarity&gt;
 *   s:|e:|set:&lt;code&gt;              c:|color:&lt;WUBRGC&gt;
 *   mv|cmc &lt;op&gt; N               pow|tou &lt;op&gt; N   (op is one of &gt;= &lt;= &gt; &lt; = :)
 * </pre>
 * Unknown {@code key:value} tokens fall back to name words so nothing is silently
 * dropped.
 */
final class CardSearchQuery {

    final List<String> nameWords = new ArrayList<>();
    String oracle;
    final List<CardType> types = new ArrayList<>();
    final List<SubType> subtypes = new ArrayList<>();
    final List<SuperType> supertypes = new ArrayList<>();
    final List<Rarity> rarities = new ArrayList<>();
    final List<String> sets = new ArrayList<>();
    Integer mvExact, mvMin, mvMax;
    Integer powMin, powMax, touMin, touMax;
    String colorFilter = ""; // WUBRGC letters, OR-matched (card has any of these)

    // token splitter that keeps "quoted phrases" whole
    private static final Pattern TOKENS = Pattern.compile("(\\w+):\"([^\"]*)\"|\"([^\"]*)\"|(\\S+)");
    private static final Pattern RANGE =
        Pattern.compile("^(mv|cmc|pow|power|tou|toughness)(>=|<=|>|<|=|:)(\\d+)$", Pattern.CASE_INSENSITIVE);

    static CardSearchQuery parse(String q) {
        CardSearchQuery sq = new CardSearchQuery();
        if (q == null) {
            return sq;
        }
        Matcher m = TOKENS.matcher(q.trim());
        while (m.find()) {
            if (m.group(1) != null) {
                // key:"quoted value"
                sq.applyKeyed(m.group(1).toLowerCase(Locale.ROOT), m.group(2));
            } else if (m.group(3) != null) {
                // bare "quoted phrase" → name
                if (!m.group(3).isEmpty()) {
                    sq.nameWords.add(m.group(3).toLowerCase(Locale.ROOT));
                }
            } else if (m.group(4) != null && !m.group(4).isEmpty()) {
                sq.consume(m.group(4));
            }
        }
        return sq;
    }

    private void consume(String raw) {
        Matcher rm = RANGE.matcher(raw);
        if (rm.matches()) {
            applyRange(rm.group(1).toLowerCase(Locale.ROOT), rm.group(2), Integer.parseInt(rm.group(3)));
            return;
        }
        int colon = raw.indexOf(':');
        if (colon > 0) {
            String key = raw.substring(0, colon).toLowerCase(Locale.ROOT);
            String val = raw.substring(colon + 1);
            if (!val.isEmpty() && applyKeyed(key, val)) {
                return;
            }
        }
        nameWords.add(raw.toLowerCase(Locale.ROOT));
    }

    private void applyRange(String key, String op, int v) {
        switch (key) {
            case "mv":
            case "cmc":
                if (op.equals(":") || op.equals("=")) mvExact = v;
                else if (op.equals(">=")) mvMin = v;
                else if (op.equals("<=")) mvMax = v;
                else if (op.equals(">")) mvMin = v + 1;
                else if (op.equals("<")) mvMax = v - 1;
                break;
            case "pow":
            case "power":
                if (op.equals(":") || op.equals("=")) { powMin = v; powMax = v; }
                else if (op.equals(">=")) powMin = v;
                else if (op.equals("<=")) powMax = v;
                else if (op.equals(">")) powMin = v + 1;
                else if (op.equals("<")) powMax = v - 1;
                break;
            case "tou":
            case "toughness":
                if (op.equals(":") || op.equals("=")) { touMin = v; touMax = v; }
                else if (op.equals(">=")) touMin = v;
                else if (op.equals("<=")) touMax = v;
                else if (op.equals(">")) touMin = v + 1;
                else if (op.equals("<")) touMax = v - 1;
                break;
            default:
                break;
        }
    }

    private boolean applyKeyed(String key, String val) {
        switch (key) {
            case "o":
            case "oracle":
            case "text":
                oracle = oracle == null ? val : oracle + " " + val;
                return true;
            case "t":
            case "type":
                resolveType(val);
                return true;
            case "r":
            case "rarity":
                Rarity ra = rarity(val);
                if (ra != null) rarities.add(ra);
                return true;
            case "s":
            case "e":
            case "set":
            case "edition":
                sets.add(val.toUpperCase(Locale.ROOT));
                return true;
            case "c":
            case "color":
            case "colors":
                colorFilter = val.toUpperCase(Locale.ROOT)
                    .replace("WHITE", "W").replace("BLUE", "U").replace("BLACK", "B")
                    .replace("RED", "R").replace("GREEN", "G").replace("COLORLESS", "C");
                return true;
            default:
                return false;
        }
    }

    private void resolveType(String val) {
        try {
            types.add(CardType.valueOf(val.toUpperCase(Locale.ROOT)));
            return;
        } catch (IllegalArgumentException ignored) {
            // not a card type
        }
        for (SuperType st : SuperType.values()) {
            if (st.name().equalsIgnoreCase(val) || st.toString().equalsIgnoreCase(val)) {
                supertypes.add(st);
                return;
            }
        }
        try {
            subtypes.add(SubType.byDescription(capitalize(val)));
            return;
        } catch (Exception ignored) {
            // not a subtype either
        }
        nameWords.add(val.toLowerCase(Locale.ROOT));
    }

    private static String capitalize(String s) {
        if (s.isEmpty()) return s;
        return Character.toUpperCase(s.charAt(0)) + s.substring(1).toLowerCase(Locale.ROOT);
    }

    private static Rarity rarity(String v) {
        switch (v.toLowerCase(Locale.ROOT)) {
            case "c":
            case "common":
                return Rarity.COMMON;
            case "u":
            case "uncommon":
                return Rarity.UNCOMMON;
            case "r":
            case "rare":
                return Rarity.RARE;
            case "m":
            case "mythic":
                return Rarity.MYTHIC;
            default:
                return null;
        }
    }

    /** Does the query still need the in-memory pass after the DB fetch? */
    boolean needsPostFilter() {
        return nameWords.size() > 1 || !colorFilter.isEmpty()
            || mvMin != null || mvMax != null
            || powMin != null || powMax != null || touMin != null || touMax != null;
    }

    /** Apply the filters the DB query cannot express. */
    boolean matches(CardInfo card) {
        if (!nameWords.isEmpty()) {
            String name = card.getName() == null ? "" : card.getName().toLowerCase(Locale.ROOT);
            for (String w : nameWords) {
                if (!name.contains(w)) return false;
            }
        }
        if (!colorFilter.isEmpty() && !matchesColor(card, colorFilter)) return false;
        int mv = card.getManaValue();
        if (mvMin != null && mv < mvMin) return false;
        if (mvMax != null && mv > mvMax) return false;
        if (powMin != null || powMax != null) {
            Integer p = intOrNull(card.getPower());
            if (p == null) return false;
            if (powMin != null && p < powMin) return false;
            if (powMax != null && p > powMax) return false;
        }
        if (touMin != null || touMax != null) {
            Integer t = intOrNull(card.getToughness());
            if (t == null) return false;
            if (touMin != null && t < touMin) return false;
            if (touMax != null && t > touMax) return false;
        }
        return true;
    }

    private static Integer intOrNull(String s) {
        if (s == null || s.isEmpty()) return null;
        try {
            return Integer.valueOf(s.trim());
        } catch (NumberFormatException e) {
            return null; // "*" and the like are not numeric
        }
    }

    private static boolean matchesColor(CardInfo card, String filter) {
        ObjectColor c = card.getColor();
        if (c == null) return filter.contains("C");
        if (filter.contains("W") && c.isWhite()) return true;
        if (filter.contains("U") && c.isBlue()) return true;
        if (filter.contains("B") && c.isBlack()) return true;
        if (filter.contains("R") && c.isRed()) return true;
        if (filter.contains("G") && c.isGreen()) return true;
        if (filter.contains("C") && c.isColorless()) return true;
        return false;
    }
}
