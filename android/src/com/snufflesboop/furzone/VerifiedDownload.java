package com.snufflesboop.furzone;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

/**
 * Downloads an update and refuses it unless it is exactly the file the release described: only from this
 * app's GitHub releases, the right size, the right SHA-256. Android then also refuses an APK that isn't
 * signed with the same key as the installed app. Plain Java, so it's tested on the JVM.
 */
public final class VerifiedDownload {
    public interface Progress {
        void onProgress(long done, long total);
    }

    /** Where updates may come from: https://github.com/<owner>/<repo>/releases/download/ */
    public static String releasesPrefix(String repo) {
        return "https://github.com/" + repo + "/releases/download/";
    }
    static final long MAX_BYTES = 200L * 1024 * 1024;

    private VerifiedDownload() {
    }

    /** Only this app's GitHub release files; nothing with tricks like "..", queries or other hosts. */
    public static boolean allowedUrl(String url, String allowedPrefix) {
        if (url == null || !url.startsWith(allowedPrefix)) {
            return false;
        }
        String rest = url.substring(allowedPrefix.length());
        return rest.matches("[A-Za-z0-9._-]+/[A-Za-z0-9._-]+") && !rest.contains("..");
    }

    public static String normalizeSha(String sha256) throws IOException {
        String s = sha256 == null ? "" : sha256.trim().toLowerCase(Locale.ROOT);
        if (!s.matches("[0-9a-f]{64}")) {
            throw new IOException("This update has no valid checksum, so it can't be trusted.");
        }
        return s;
    }

    /** Copies in to out while hashing; throws if the size or checksum is wrong. */
    public static void copyVerified(InputStream in, OutputStream out, String sha256, long size, Progress progress)
            throws IOException {
        String want = normalizeSha(sha256);
        if (size <= 0 || size > MAX_BYTES) {
            throw new IOException("This update has no valid size.");
        }
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
        byte[] buffer = new byte[64 * 1024];
        long done = 0;
        int n;
        while ((n = in.read(buffer)) != -1) {
            done += n;
            if (done > size) {
                throw new IOException("The download is bigger than the update said.");
            }
            digest.update(buffer, 0, n);
            out.write(buffer, 0, n);
            if (progress != null) {
                progress.onProgress(done, size);
            }
        }
        if (done != size) {
            throw new IOException("The download stopped early. Try again.");
        }
        if (!want.equals(hex(digest.digest()))) {
            throw new IOException("The download doesn't match the update's checksum, so it wasn't installed.");
        }
    }

    /** Opens the download, following GitHub's redirect to its file storage (https only). */
    public static InputStream open(String url, String allowedPrefix, String userAgent) throws IOException {
        if (!allowedUrl(url, allowedPrefix)) {
            throw new IOException("Updates only come from the app's own GitHub releases.");
        }
        String next = url;
        for (int hops = 0; hops < 5; hops++) {
            HttpURLConnection c = (HttpURLConnection) new URL(next).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", userAgent);
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = c.getHeaderField("Location");
                c.disconnect();
                if (location == null) {
                    break;
                }
                URL resolved = new URL(new URL(next), location);
                if (!"https".equals(resolved.getProtocol())) {
                    throw new IOException("Refused an insecure download link.");
                }
                next = resolved.toString();
                continue;
            }
            if (code != 200) {
                c.disconnect();
                throw new IOException("Download failed (HTTP " + code + ")");
            }
            return c.getInputStream();
        }
        throw new IOException("Too many redirects.");
    }

    static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
        }
        return sb.toString();
    }
}
