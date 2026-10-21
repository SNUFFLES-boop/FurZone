package com.snufflesboop.furzone;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * FurZone on Android: the app's web code, served from inside the APK at https://appassets.androidplatform.net,
 * in a locked-down WebView. Only the app itself, Discord's login and our Supabase project may load in it;
 * every other link opens in the phone's browser.
 */
public class MainActivity extends Activity {
    static final String APP_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + APP_HOST + "/index.html";
    private static final int PICK_FILE = 41;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private Updater updater;
    /** The page currently shown; the JS bridge only answers the app's own page. */
    private volatile String currentHost = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(false);
        webView = new WebView(this);
        webView.setBackgroundColor(0xFF0F0B1A);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setGeolocationEnabled(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSafeBrowsingEnabled(true);
        s.setUserAgentString(s.getUserAgentString() + " FurZoneAndroid/" + BuildConfig.VERSION_NAME);

        updater = new Updater(this, new Updater.Listener() {
            @Override
            public void onState(String state, int percent, String message) {
                sendToPage("{\"type\":\"update\",\"state\":" + json(state) + ",\"percent\":" + percent
                        + ",\"message\":" + json(message) + "}");
            }
        });
        webView.addJavascriptInterface(new Bridge(), "FurZoneAndroid");
        webView.setWebViewClient(new Client());
        webView.setWebChromeClient(new Chrome());

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        // On Discord's login (or any page that isn't the app), back returns to the app instead of leaving it.
        if (!APP_HOST.equals(currentHost)) {
            if (webView.canGoBack()) {
                webView.goBack();
            } else {
                webView.loadUrl(START_URL);
            }
            return;
        }
        webView.evaluateJavascript("window.furzoneBack ? window.furzoneBack() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (!"true".equals(value)) {
                    moveTaskToBack(true);
                }
            }
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        updater.shutdown();
        webView.destroy();
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == PICK_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    void sendToPage(final String json) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (APP_HOST.equals(currentHost)) {
                    webView.evaluateJavascript("window.__furzoneNative && window.__furzoneNative(" + json(json) + ")", null);
                }
            }
        });
    }

    static String json(String s) {
        if (s == null) {
            return "\"\"";
        }
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '<': b.append("\\u003c"); break;
                default:
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) {
                        b.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    } else {
                        b.append(c);
                    }
            }
        }
        return b.append('"').toString();
    }

    void openExternal(Uri uri) {
        if (uri == null || !"https".equals(uri.getScheme())) {
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException ignored) {
            // No browser installed.
        }
    }

    /** Which pages may load inside the app (everything else opens in the browser). */
    static boolean allowedInApp(Uri uri) {
        if (uri == null || !"https".equals(uri.getScheme()) || uri.getHost() == null) {
            return false;
        }
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        if (host.equals(APP_HOST)) {
            return true;
        }
        // Discord login, and our Supabase project's sign-in endpoints that hand back to the app.
        if (host.equals("discord.com") || host.endsWith(".discord.com")) {
            return true;
        }
        String path = uri.getPath() == null ? "" : uri.getPath();
        return (host.endsWith(".supabase.co") || host.endsWith(".supabase.in")) && path.startsWith("/auth/v1/");
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) {
                return false;
            }
            Uri uri = request.getUrl();
            if (allowedInApp(uri)) {
                return false;
            }
            openExternal(uri);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            Uri uri = Uri.parse(url);
            currentHost = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!APP_HOST.equals(uri.getHost())) {
                return null;
            }
            String path = uri.getPath() == null || uri.getPath().equals("/") ? "/index.html" : uri.getPath();
            if (path.contains("..")) {
                return notFound();
            }
            try {
                InputStream in = getAssets().open("www" + path);
                Map<String, String> headers = new HashMap<>();
                headers.put("X-Content-Type-Options", "nosniff");
                headers.put("Cache-Control", path.startsWith("/assets/") ? "max-age=31536000, immutable" : "no-cache");
                return new WebResourceResponse(mime(path), mime(path).startsWith("text/") ? "utf-8" : null, 200, "OK", headers, in);
            } catch (IOException e) {
                return notFound();
            }
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(),
                new java.io.ByteArrayInputStream(new byte[0]));
    }

    static String mime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(null);
            }
            fileCallback = callback;
            try {
                startActivityForResult(params.createIntent(), PICK_FILE);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }

    /** What the page can ask the app to do. Ignored unless the app's own page is showing. */
    private class Bridge {
        private boolean fromApp() {
            return APP_HOST.equals(currentHost);
        }

        @JavascriptInterface
        public int versionCode() {
            return BuildConfig.VERSION_CODE;
        }

        @JavascriptInterface
        public void openExternal(final String url) {
            if (fromApp()) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        MainActivity.this.openExternal(Uri.parse(url));
                    }
                });
            }
        }

        @JavascriptInterface
        public void installUpdate(String url, String sha256, long size) {
            if (fromApp()) {
                updater.install(url, sha256, size);
            }
        }
    }
}
