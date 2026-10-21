package com.snufflesboop.furzone;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** Installs an update from the app's GitHub releases after checking its size and SHA-256. */
final class Updater {
    interface Listener {
        void onState(String state, int percent, String message);
    }

    private static final String ACTION = "com.snufflesboop.furzone.INSTALL_RESULT";

    private final Activity activity;
    private final Listener listener;
    private BroadcastReceiver receiver;
    private volatile boolean busy;

    Updater(Activity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
    }

    void install(final String url, final String sha256, final long size) {
        if (busy) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
            listener.onState("error", 0, "Allow FurZone to install updates, then tap Update again.");
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName())));
            return;
        }
        busy = true;
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Updater.this.run(url, sha256, size);
                } finally {
                    busy = false;
                }
            }
        }, "furzone-update").start();
    }

    private void run(String url, String sha256, long size) {
        PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(activity.getPackageName());
        // Android always asks you before installing an update (the app never installs anything by itself).
        int sessionId = -1;
        try {
            sessionId = installer.createSession(params);
            try (PackageInstaller.Session session = installer.openSession(sessionId)) {
                final int[] last = {-1};
                try (InputStream in = VerifiedDownload.open(url, VerifiedDownload.releasesPrefix(BuildConfig.GITHUB_REPO), "FurZone-Android/" + BuildConfig.VERSION_NAME);
                     OutputStream out = session.openWrite("update.apk", 0, size)) {
                    VerifiedDownload.copyVerified(in, out, sha256, size, new VerifiedDownload.Progress() {
                        @Override
                        public void onProgress(long done, long total) {
                            int pct = (int) (done * 100 / total);
                            if (pct != last[0]) {
                                last[0] = pct;
                                listener.onState("downloading", pct, "");
                            }
                        }
                    });
                    session.fsync(out);
                }
                listenForResult();
                Intent intent = new Intent(ACTION).setPackage(activity.getPackageName());
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent pending = PendingIntent.getBroadcast(activity, sessionId, intent, flags);
                listener.onState("installing", 100, "");
                session.commit(pending.getIntentSender());
            }
        } catch (IOException | RuntimeException e) {
            if (sessionId != -1) {
                try {
                    installer.abandonSession(sessionId);
                } catch (RuntimeException ignored) {
                    // Already gone.
                }
            }
            String msg = e.getMessage();
            listener.onState("error", 0, msg == null ? "The update failed." : msg);
        }
    }

    private synchronized void listenForResult() {
        if (receiver != null) {
            return;
        }
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                    if (confirm != null) {
                        confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        activity.startActivity(confirm);
                    }
                } else if (status == PackageInstaller.STATUS_SUCCESS) {
                    listener.onState("done", 100, "");
                } else {
                    String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                    listener.onState("error", 0, status == PackageInstaller.STATUS_FAILURE_ABORTED ? "Update cancelled."
                            : msg == null ? "The update failed." : msg);
                }
            }
        };
        IntentFilter filter = new IntentFilter(ACTION);
        if (Build.VERSION.SDK_INT >= 33) {
            activity.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            activity.registerReceiver(receiver, filter);
        }
    }

    synchronized void shutdown() {
        if (receiver != null) {
            try {
                activity.unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
                // Not registered.
            }
            receiver = null;
        }
    }
}
