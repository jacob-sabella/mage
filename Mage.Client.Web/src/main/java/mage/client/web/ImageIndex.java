package mage.client.web;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Indexes a desktop XMage client's downloaded card images
 * ({@code .../mage-client/plugins/images/<SET>/<Name>.<num>.full.jpg}) so the
 * web client can render real card art. Lookups are by set + name (+ optional
 * collector number); misses simply fall back to the text card in the UI.
 *
 * @author XMage web client
 */
public class ImageIndex {

    // <name>.<collector>.full.jpg  OR  <name>.full.jpg
    private static final Pattern FILE = Pattern.compile("^(.*?)(?:\\.([^.]+))?\\.full\\.jpg$");

    private final File root;
    private volatile boolean built;
    private final Map<String, File> byKey = new HashMap<>(1 << 16);

    public ImageIndex(String rootPath) {
        this.root = rootPath == null ? null : new File(rootPath);
    }

    public boolean isAvailable() {
        return root != null && root.isDirectory();
    }

    /** Resolve an image file for a card, or null. Tries most-specific first. */
    public synchronized File lookup(String set, String name, String number) {
        if (!isAvailable() || name == null || name.isEmpty()) {
            return null;
        }
        ensureBuilt();
        String s = set == null ? "" : set.toUpperCase(Locale.ROOT);
        String n = norm(name);
        if (!number.isEmpty()) {
            File f = byKey.get(s + '|' + n + '|' + number);
            if (f != null) return f;
        }
        File f = byKey.get(s + '|' + n);
        if (f != null) return f;
        return byKey.get('*' + n); // any set with this name
    }

    private void ensureBuilt() {
        if (built) {
            return;
        }
        try (Stream<Path> walk = Files.walk(root.toPath(), 3)) {
            walk.filter(Files::isRegularFile).forEach(p -> {
                String file = p.getFileName().toString();
                if (!file.endsWith(".full.jpg")) {
                    return;
                }
                Matcher m = FILE.matcher(file);
                if (!m.matches()) {
                    return;
                }
                String name = norm(m.group(1));
                String num = m.group(2) == null ? "" : m.group(2);
                Path parent = p.getParent();
                String set = parent == null ? "" : parent.getFileName().toString().toUpperCase(Locale.ROOT);
                File f = p.toFile();
                if (!num.isEmpty()) {
                    byKey.putIfAbsent(set + '|' + name + '|' + num, f);
                }
                byKey.putIfAbsent(set + '|' + name, f);
                byKey.putIfAbsent('*' + name, f);
            });
        } catch (Exception ignored) {
            // partial index is fine; misses fall back to text cards
        }
        built = true;
    }

    private static String norm(String s) {
        return s == null ? "" : s.trim().toLowerCase(Locale.ROOT);
    }
}
