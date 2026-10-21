import com.snufflesboop.furzone.VerifiedDownload;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.MessageDigest;

/** Plain-Java tests for the update download checks: java -cp build/test VerifiedDownloadTest */
public class VerifiedDownloadTest {
    static int passed;

    static void check(boolean ok, String what) {
        if (!ok) {
            throw new AssertionError(what);
        }
        passed++;
    }

    static void fails(String what, Runnable r) {
        try {
            r.run();
        } catch (RuntimeException e) {
            if (e.getCause() instanceof IOException) {
                passed++;
                return;
            }
            throw e;
        }
        throw new AssertionError("expected a refusal: " + what);
    }

    static String sha(byte[] b) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (byte x : MessageDigest.getInstance("SHA-256").digest(b)) {
            sb.append(String.format("%02x", x));
        }
        return sb.toString();
    }

    static void copy(byte[] data, String sha, long size) {
        try {
            VerifiedDownload.copyVerified(new ByteArrayInputStream(data), new ByteArrayOutputStream(), sha, size, null);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    public static void main(String[] args) throws Exception {
        String prefix = VerifiedDownload.releasesPrefix("SNUFFLES-boop/FurZone");
        check(prefix.equals("https://github.com/SNUFFLES-boop/FurZone/releases/download/"), "prefix");
        check(VerifiedDownload.allowedUrl(prefix + "v1.0.42/FurZone.apk", prefix), "release asset allowed");
        check(!VerifiedDownload.allowedUrl("https://github.com/evil/FurZone/releases/download/v1/FurZone.apk", prefix), "other owner");
        check(!VerifiedDownload.allowedUrl("https://github.com.evil.com/SNUFFLES-boop/FurZone/releases/download/v1/FurZone.apk", prefix), "lookalike host");
        check(!VerifiedDownload.allowedUrl(prefix + "../../evil/x.apk", prefix), "path climbing");
        check(!VerifiedDownload.allowedUrl(prefix + "v1/FurZone.apk?x=1", prefix), "query");
        check(!VerifiedDownload.allowedUrl("http://github.com/SNUFFLES-boop/FurZone/releases/download/v1/FurZone.apk", prefix), "plain http");
        check(!VerifiedDownload.allowedUrl(null, prefix), "null");

        byte[] apk = "PK pretend apk bytes".getBytes("UTF-8");
        String good = sha(apk);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        final long[] seen = {0};
        VerifiedDownload.copyVerified(new ByteArrayInputStream(apk), out, good.toUpperCase(), apk.length, new VerifiedDownload.Progress() {
            public void onProgress(long done, long total) {
                seen[0] = done;
            }
        });
        check(out.size() == apk.length && seen[0] == apk.length, "good download copied with progress");
        final String other = sha("other".getBytes());
        fails("wrong checksum", () -> copy(apk, other, apk.length));
        fails("no checksum", () -> copy(apk, "", apk.length));
        fails("bigger than said", () -> copy(apk, good, apk.length - 1));
        fails("cut short", () -> copy(apk, good, apk.length + 5));
        fails("no size", () -> copy(apk, good, 0));
        System.out.println(passed + " download checks passed");
    }
}
