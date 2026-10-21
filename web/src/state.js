// Shared app state: the backend in use, the logged-in profile and small per-device preferences.

export const app = {
    backend: null,
    me: null,
    unread: 0,
    muted: loadPref('muted', true)
};

export function setBackend(backend) {
    app.backend = backend;
    app.me = null;
}

export async function refreshMe() {
    app.me = await app.backend.me();
    return app.me;
}

function loadPref(key, fallback) {
    try {
        const v = localStorage.getItem('furzone.pref.' + key);
        return v === null ? fallback : JSON.parse(v);
    } catch {
        return fallback;
    }
}

export function savePref(key, value) {
    app[key] = value;
    try {
        localStorage.setItem('furzone.pref.' + key, JSON.stringify(value));
    } catch {
        // private mode: fine, it just won't be remembered
    }
}
