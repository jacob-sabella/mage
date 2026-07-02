package mage.client.web.dto;

import mage.choices.Choice;
import mage.interfaces.callback.ClientCallbackMethod;
import mage.view.GameClientMessage;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * A decision the server is asking the seated player to make, projected for the
 * browser. The web UI renders controls based on {@link #kind} and posts the
 * answer back through /api/game/respond.
 *
 * @author XMage web client
 */
public class PromptDto {

    public String kind;        // ask | select | target | amount | choice | pile | generic
    public String message;
    public boolean canCancel;  // a "boolean false" answer is accepted (pass / cancel / done)
    public int min;
    public int max;
    public List<ChoiceOption> choices = new ArrayList<>();
    public String choiceKind = "string"; // how a chosen option is sent: string | uuid
    public List<String> targets = new ArrayList<>(); // already-selected target ids
    // for kind == "target": the candidate cards to pick from, when the server
    // sends them (e.g. picking from graveyard/library/hand); empty when the
    // targets are ordinary board objects the UI already renders
    public List<GameDto.CardDto> candidates = new ArrayList<>();
    // zone the candidates live in ("hand" | "graveyard" | "library" | ...) or null
    public String candidateZone;
    // for kind == "pile": the two piles to choose between (boolean true = pile1)
    public List<GameDto.CardDto> pile1 = new ArrayList<>();
    public List<GameDto.CardDto> pile2 = new ArrayList<>();
    // for kind == "multiAmount": one entry per amount to set (answer = "a b c")
    public List<MultiEntry> multi = new ArrayList<>();

    public static class MultiEntry {
        public String label;
        public int min;
        public int max;
        public int def;

        MultiEntry(String label, int min, int max, int def) {
            this.label = label;
            this.min = min;
            this.max = max;
            this.def = def;
        }
    }

    public static class ChoiceOption {
        public String key;
        public String label;

        ChoiceOption(String key, String label) {
            this.key = key;
            this.label = label;
        }
    }

    /** Build from a GameClientMessage-style decision callback. */
    public static PromptDto from(ClientCallbackMethod method, GameClientMessage message) {
        PromptDto dto = new PromptDto();
        dto.message = message.getMessage();
        switch (method) {
            case GAME_ASK:
                dto.kind = "ask";
                dto.canCancel = false;
                break;
            case GAME_SELECT:
                dto.kind = "select"; // you have priority
                dto.canCancel = true; // boolean false = pass priority
                break;
            case GAME_TARGET:
                dto.kind = "target";
                // the server re-sends the prompt with required=false once the
                // target's minimum is satisfied — that's the "Done is allowed" signal
                dto.canCancel = !message.isFlag();
                addTargets(dto, message.getTargets());
                // the candidate card set (server side sends it for zone picks)
                addPile(dto.candidates, message.getCardsView1());
                dto.candidateZone = zoneOf(message.getOptions());
                break;
            case GAME_GET_AMOUNT:
                dto.kind = "amount";
                dto.canCancel = false;
                dto.min = message.getMin();
                dto.max = message.getMax();
                break;
            case GAME_CHOOSE_CHOICE:
                dto.kind = "choice";
                dto.canCancel = true;
                addChoices(dto, message.getChoice());
                break;
            case GAME_PLAY_MANA:
            case GAME_PLAY_XMANA:
                // pay by clicking mana sources (permanents); cancel to abort
                dto.kind = "target";
                dto.canCancel = true;
                break;
            case GAME_CHOOSE_PILE:
                // split-pile effects (e.g. Fact or Fiction): boolean true = pile 1
                dto.kind = "pile";
                dto.canCancel = false;
                addPile(dto.pile1, message.getCardsView1());
                addPile(dto.pile2, message.getCardsView2());
                break;
            case GAME_GET_MULTI_AMOUNT:
                // distribute amounts (e.g. "deal X damage divided as you choose").
                // answer is sent as a space-joined string of per-entry amounts.
                dto.kind = "multiAmount";
                dto.canCancel = false;
                dto.min = message.getMin(); // total lower bound
                dto.max = message.getMax(); // total upper bound
                if (message.getMessages() != null) {
                    for (mage.util.MultiAmountMessage m : message.getMessages()) {
                        dto.multi.add(new MultiEntry(m.message, m.min, m.max, m.defaultValue));
                    }
                }
                break;
            default:
                // pile, multi-amount, etc. - surface the text with a cancel escape
                dto.kind = "generic";
                dto.canCancel = true;
                break;
        }
        return dto;
    }

    /** Build from an ability-picker callback (choose which ability/mode). */
    public static PromptDto fromAbilityPicker(mage.view.AbilityPickerView picker) {
        PromptDto dto = new PromptDto();
        dto.kind = "choice";
        dto.choiceKind = "uuid"; // chosen option is an ability id sent as a UUID
        dto.canCancel = true;
        dto.message = picker.getMessage();
        if (picker.getChoices() != null) {
            for (Map.Entry<UUID, String> e : picker.getChoices().entrySet()) {
                dto.choices.add(new ChoiceOption(e.getKey().toString(), e.getValue()));
            }
        }
        return dto;
    }

    /** The zone the target candidates live in, when the server names one. */
    private static String zoneOf(Map<String, java.io.Serializable> options) {
        Object zone = options == null ? null : options.get("targetZone");
        if (zone instanceof mage.constants.Zone) {
            return ((mage.constants.Zone) zone).name().toLowerCase(java.util.Locale.ROOT);
        }
        return null;
    }

    private static void addPile(List<GameDto.CardDto> out, mage.view.CardsView cards) {
        if (cards != null) {
            for (mage.view.CardView card : cards.values()) {
                out.add(GameDto.CardDto.from(card));
            }
        }
    }

    private static void addTargets(PromptDto dto, Set<UUID> targets) {
        if (targets != null) {
            for (UUID id : targets) {
                dto.targets.add(id.toString());
            }
        }
    }

    private static void addChoices(PromptDto dto, Choice choice) {
        if (choice == null) {
            return;
        }
        if (choice.isKeyChoice() && choice.getKeyChoices() != null) {
            for (Map.Entry<String, String> entry : choice.getKeyChoices().entrySet()) {
                dto.choices.add(new ChoiceOption(entry.getKey(), entry.getValue()));
            }
        } else if (choice.getChoices() != null) {
            for (String value : choice.getChoices()) {
                dto.choices.add(new ChoiceOption(value, value));
            }
        }
    }
}
