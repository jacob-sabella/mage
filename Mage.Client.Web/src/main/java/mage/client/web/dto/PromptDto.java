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

    public String kind;        // ask | select | target | amount | choice | generic
    public String message;
    public boolean canCancel;  // a "boolean false" answer is accepted (pass / cancel / done)
    public int min;
    public int max;
    public List<ChoiceOption> choices = new ArrayList<>();
    public List<String> targets = new ArrayList<>(); // already-selected target ids

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
                dto.canCancel = true; // boolean false = done / cancel
                addTargets(dto, message.getTargets());
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
            default:
                // mana payment, pile, etc. - surface the text with a cancel escape
                dto.kind = "generic";
                dto.canCancel = true;
                break;
        }
        return dto;
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
