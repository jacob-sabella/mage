package mage.client.web;

import mage.cards.repository.CardCriteria;
import mage.cards.repository.CardInfo;
import mage.cards.repository.CardRepository;

import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Headless, on-demand card-image downloader for the web client. It resolves
 * Scryfall image URLs the same deterministic way XMage's own downloader does
 * ({@code https://api.scryfall.com/cards/<set>/<number>?format=image}), fetches
 * the art politely (rate-limited, descriptive User-Agent), and writes it into the
 * served cache using the same {@code <SET>/<Name>.full.jpg} layout that
 * {@link ImageIndex} reads — so newly-downloaded art renders immediately.
 *
 * Only missing images are fetched and each run is capped, so it never hammers
 * Scryfall or runs away. Downloaded art only changes visuals, never the rules.
 * (Kept dependency-free of the Swing client module on purpose.)
 */
public class ImageDownloader {

    /** Live progress snapshot, polled by the Settings UI. */
    public static class Progress {
        public volatile boolean running = false;
        public volatile boolean cancelled = false;
        public volatile int scanned = 0;    // cards examined
        public volatile int candidates = 0; // missing images attempted this run
        public final AtomicInteger done = new AtomicInteger();
        public final AtomicInteger failed = new AtomicInteger();
        public volatile int skipped = 0;    // already present
        public volatile String current = "";
        public volatile String message = "idle";
    }

    private static final long RATE_MS = 120; // be polite to Scryfall (>= 50-100ms)
    private static final String USER_AGENT = "XMageWebClient/1.0 (+https://github.com/jacob-sabella/mage)";
    private static final int DEFAULT_LIMIT = 250;

    private final String imageDir;
    private final ImageIndex index;
    private final Progress progress = new Progress();
    private volatile Thread worker;

    public ImageDownloader(String imageDir, ImageIndex index) {
        this.imageDir = imageDir;
        this.index = index;
    }

    public Progress progress() {
        return progress;
    }

    /** Start a background download of up to {@code limit} missing images. */
    public synchronized boolean start(int limit) {
        if (progress.running) {
            return false;
        }
        if (imageDir == null || imageDir.isEmpty()) {
            progress.message = "no image directory configured on the server";
            return false;
        }
        final int cap = limit > 0 ? limit : DEFAULT_LIMIT;
        progress.running = true;
        progress.cancelled = false;
        progress.scanned = 0;
        progress.candidates = 0;
        progress.skipped = 0;
        progress.done.set(0);
        progress.failed.set(0);
        progress.current = "";
        progress.message = "scanning the card database…";
        worker = new Thread(() -> run(cap), "image-downloader");
        worker.setDaemon(true);
        worker.start();
        return true;
    }

    public void cancel() {
        if (progress.running) {
            progress.cancelled = true;
            progress.message = "cancelling…";
        }
    }

    private void run(int cap) {
        try {
            List<CardInfo> cards = CardRepository.instance.findCards(new CardCriteria());
            int got = 0;
            for (CardInfo ci : cards) {
                if (progress.cancelled) {
                    break;
                }
                progress.scanned++;
                String set = ci.getSetCode();
                String name = ci.getName();
                String number = ci.getCardNumber();
                if (set == null || set.isEmpty() || name == null || name.isEmpty()) {
                    continue;
                }
                File out = targetFile(set, name);
                if (out.exists() && out.length() > 1000) {
                    progress.skipped++;
                    continue;
                }
                progress.candidates++;
                progress.current = name + " (" + set + ")";
                boolean ok = downloadOne(set, number, out);
                if (ok) {
                    progress.done.incrementAndGet();
                    got++;
                } else {
                    progress.failed.incrementAndGet();
                }
                if (got >= cap) {
                    progress.message = "stopped at the " + cap + "-image limit for this run — run again for more";
                    break;
                }
                try {
                    Thread.sleep(RATE_MS);
                } catch (InterruptedException ie) {
                    break;
                }
            }
            index.invalidate(); // newly-downloaded art becomes visible
            if (progress.message.startsWith("scanning") || progress.message.startsWith("cancelling")) {
                progress.message = progress.cancelled
                        ? "cancelled — " + progress.done.get() + " downloaded"
                        : "done — " + progress.done.get() + " downloaded, " + progress.failed.get() + " failed";
            }
        } catch (Throwable t) {
            progress.message = "error: " + t.getClass().getSimpleName() + (t.getMessage() == null ? "" : " " + t.getMessage());
        } finally {
            progress.running = false;
            progress.current = "";
        }
    }

    /** Target file in the served cache, matching CardImageUtils' card layout. */
    private File targetFile(String set, String name) {
        File dir = new File(imageDir, set.toUpperCase(Locale.ENGLISH));
        return new File(dir, prepareName(name) + ".full.jpg");
    }

    /** Strip filesystem-illegal characters exactly like CardImageUtils does. */
    private static String prepareName(String n) {
        return n.replace("//", "-").replace("\\", "").replace("/", "").replace(":", "").replace("*", "")
                .replace("?", "").replace("\"", "").replace("<", "").replace(">", "").replace("|", "");
    }

    private static String encodeSegment(String s) {
        try {
            return URLEncoder.encode(s.trim(), StandardCharsets.UTF_8.name()).replace("+", "%20");
        } catch (Exception e) {
            return s.trim();
        }
    }

    private boolean downloadOne(String set, String number, File out) {
        String s = set.toLowerCase(Locale.ENGLISH);
        String n = encodeSegment(number == null ? "" : number);
        if (n.isEmpty()) {
            return false;
        }
        // primary + a variation-tolerant fallback, mirroring ScryfallImageSource
        String url1 = "https://api.scryfall.com/cards/" + s + "/" + n + "?format=image";
        String url2 = "https://api.scryfall.com/cards/" + s + "/" + n + "?format=image&include_variations=true";
        return fetch(url1, out) || fetch(url2, out);
    }

    private boolean fetch(String url, File out) {
        HttpURLConnection conn = null;
        File tmp = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestProperty("User-Agent", USER_AGENT);
            conn.setRequestProperty("Accept", "image/*");
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(20000);
            if (conn.getResponseCode() != 200) {
                return false;
            }
            String ct = conn.getContentType();
            if (ct != null && !ct.toLowerCase(Locale.ROOT).startsWith("image")) {
                return false;
            }
            File parent = out.getParentFile();
            if (parent != null) {
                parent.mkdirs();
            }
            tmp = new File(out.getAbsolutePath() + ".part");
            try (InputStream in = conn.getInputStream(); OutputStream os = new FileOutputStream(tmp)) {
                byte[] buf = new byte[8192];
                int r;
                long total = 0;
                while ((r = in.read(buf)) != -1) {
                    os.write(buf, 0, r);
                    total += r;
                    if (total > 30_000_000L) {
                        break; // sanity cap
                    }
                }
            }
            if (tmp.length() < 1000) {
                tmp.delete();
                return false;
            }
            Files.move(tmp.toPath(), out.toPath(), StandardCopyOption.REPLACE_EXISTING);
            return true;
        } catch (Exception e) {
            if (tmp != null) {
                tmp.delete();
            }
            return false;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }
}
