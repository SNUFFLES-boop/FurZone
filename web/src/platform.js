// The app runs inside the Android app (WebView), the Windows app (WebView2) or a browser. This talks to
// whichever native shell is around: version, opening links outside the app, and installing updates.
import { GITHUB_REPO } from './config.js';

const android = typeof window !== 'undefined' ? window.FurZoneAndroid : undefined;
const webview2 = typeof window !== 'undefined' && window.chrome && window.chrome.webview;

export const platform = android ? 'android' : webview2 ? 'windows' : 'web';

let seq = 0;
const pending = new Map();
const progressListeners = new Set();
let shareWaiter = null;

function onNativeMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'reply' && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.value);
    } else if (msg.type === 'share') {
        const fn = shareWaiter;
        shareWaiter = null;
        if (fn) fn(msg.state || 'error', msg.message || '');
    } else if (msg.type === 'update') {
        for (const fn of progressListeners) fn(msg.state, msg.percent || 0, msg.message || '');
    }
}

if (webview2) webview2.addEventListener('message', (e) => onNativeMessage(e.data));
if (typeof window !== 'undefined') {
    // Android calls window.__furzoneNative with JSON strings.
    window.__furzoneNative = (json) => {
        try {
            onNativeMessage(JSON.parse(json));
        } catch {
            // ignore malformed messages
        }
    };
}

function callWindows(type, args = {}) {
    return new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        webview2.postMessage({ id, type, ...args });
        setTimeout(() => {
            if (pending.has(id)) {
                pending.delete(id);
                reject(new Error('The app did not answer.'));
            }
        }, 15000);
    });
}

export async function nativeVersionCode() {
    if (android) return Number(android.versionCode()) || 0;
    if (webview2) return Number(await callWindows('versionCode')) || 0;
    return 0;
}

export function openExternal(url) {
    if (!/^https:\/\//.test(url)) return;
    if (android) android.openExternal(url);
    else if (webview2) callWindows('openExternal', { url }).catch(() => {});
    else window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * The full-screen video player: on Android, hide the status and navigation bars, keep the screen on and turn
 * the screen ('auto' follows the phone, or 'landscape' / 'portrait'). Returns false where the app can't
 * (a browser, or an older Android app), so the page uses the browser's own full screen instead.
 */
export function setPlayerMode(on, orientation = 'auto') {
    if (android && typeof android.setPlayer === 'function') {
        try {
            android.setPlayer(!!on, String(orientation));
            return true;
        } catch {
            return false;
        }
    }
    return false;
}

/**
 * Android: share text straight to an app (pkg like 'com.discord'), or the phone's share menu (pkg '').
 * Returns 'ok', 'missing' (that app isn't installed) or 'unsupported' (not the Android app / older app).
 */
export function shareNative(text, pkg = '') {
    if (!android || typeof android.share !== 'function') return 'unsupported';
    try {
        return String(android.share(String(text), String(pkg || '')));
    } catch {
        return 'unsupported';
    }
}

/**
 * Android: download the post's picture or video, then share the file (with the text) to an app or the share
 * menu. Resolves 'ok' | 'missing' | 'error' | 'unsupported'.
 */
export function shareMediaNative(url, mime, text, pkg = '') {
    if (!android || typeof android.shareMedia !== 'function') return Promise.resolve('unsupported');
    return new Promise((resolve) => {
        shareWaiter = (state) => resolve(state);
        try {
            android.shareMedia(String(url), String(mime), String(text), String(pkg || ''));
        } catch {
            shareWaiter = null;
            resolve('unsupported');
        }
        setTimeout(() => {
            if (shareWaiter) {
                shareWaiter = null;
                resolve('error');
            }
        }, 120000);
    });
}

export function onUpdateProgress(fn) {
    progressListeners.add(fn);
    return () => progressListeners.delete(fn);
}

// ---------- updates ----------

const ASSET = { android: 'FurZone.apk', windows: 'FurZone_Setup.exe' };

/**
 * Reads the newest GitHub release. Its tag is v1.0.<versionCode>; the download must come with a SHA-256
 * (GitHub's asset digest, or a "sha256 <file>: <hex>" line the release workflow writes) or it's ignored.
 */
export function parseRelease(release, kind) {
    if (!release || typeof release !== 'object' || release.draft || release.prerelease) return null;
    const m = /^v?\d+\.\d+\.(\d+)$/.exec(String(release.tag_name || ''));
    if (!m) return null;
    const name = ASSET[kind];
    const asset = (release.assets || []).find((a) => a && a.name === name);
    if (!asset || typeof asset.browser_download_url !== 'string') return null;
    let sha = /^sha256:([0-9a-f]{64})$/i.exec(String(asset.digest || ''));
    if (!sha) {
        const esc = name.replace(/[.]/g, '\\.');
        sha = new RegExp(`sha256 ${esc}: ([0-9a-f]{64})`, 'i').exec(String(release.body || ''));
    }
    if (!sha) return null;
    return {
        versionCode: Number(m[1]),
        version: String(release.tag_name).replace(/^v/, ''),
        notes: String(release.body || '')
            .split('\n')
            .filter((l) => l.trim() && !/^sha256 /i.test(l))
            .join('\n')
            .slice(0, 1500),
        url: asset.browser_download_url,
        sha256: sha[1].toLowerCase(),
        size: Number(asset.size) || 0
    };
}

export async function checkForUpdate() {
    if (platform === 'web') return null;
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store'
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(res.status === 403 ? 'GitHub is busy. Try again later.' : `Update check failed (${res.status})`);
    const info = parseRelease(await res.json(), platform);
    if (!info) return null;
    const current = await nativeVersionCode();
    return { ...info, current, available: info.versionCode > current };
}

export async function installUpdate(info) {
    if (android) {
        android.installUpdate(info.url, info.sha256, info.size);
        return;
    }
    if (webview2) await callWindows('installUpdate', { url: info.url, sha256: info.sha256, size: info.size });
}
