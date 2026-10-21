// Small pure helpers (tested in Node), plus media preparation that needs a browser.

const USERNAME = /^[a-z0-9_]{3,20}$/;

export function validUsername(name) {
    return USERNAME.test(String(name || ''));
}

/** 0 (too short) .. 4 (strong). */
export function passwordStrength(pw) {
    const s = String(pw || '');
    if (s.length < 8) return 0;
    let score = 1;
    if (s.length >= 12) score++;
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
    if (/\d/.test(s) && /[^A-Za-z0-9]/.test(s)) score++;
    else if (/\d/.test(s) || /[^A-Za-z0-9]/.test(s)) score += 0.5;
    return Math.min(4, Math.floor(score));
}

export function timeAgo(value, now = Date.now()) {
    const t = typeof value === 'number' ? value : Date.parse(value);
    if (!Number.isFinite(t)) return '';
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return 'now';
    const m = Math.round(s / 60);
    if (m < 60) return m + 'm';
    const h = Math.round(m / 60);
    if (h < 24) return h + 'h';
    const d = Math.round(h / 24);
    if (d < 7) return d + 'd';
    const w = Math.round(d / 7);
    if (w < 52) return w + 'w';
    return Math.round(d / 365) + 'y';
}

export function compactCount(n) {
    const v = Number(n) || 0;
    if (v < 1000) return String(v);
    if (v < 10000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    if (v < 1e6) return Math.round(v / 1000) + 'K';
    return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
}

/**
 * Splits a caption into plain text, #tags and @mentions, so the app can make the last two tappable
 * without ever treating the caption as HTML.
 */
export function captionParts(text) {
    const parts = [];
    const re = /(#[A-Za-z0-9_]{1,30})|(@[a-z0-9_]{3,20})/gi;
    let last = 0;
    let m;
    const s = String(text || '');
    while ((m = re.exec(s))) {
        if (m.index > last) parts.push({ type: 'text', value: s.slice(last, m.index) });
        if (m[1]) parts.push({ type: 'tag', value: m[1].slice(1).toLowerCase(), label: m[1] });
        else parts.push({ type: 'mention', value: m[2].slice(1).toLowerCase(), label: m[2] });
        last = m.index + m[0].length;
    }
    if (last < s.length) parts.push({ type: 'text', value: s.slice(last) });
    return parts;
}

/** VRChat profile link or bare id → usr_… (lower case), or '' when it isn't one. */
export function vrchatIdFrom(input) {
    const m = /(usr_[0-9a-f-]{36})/i.exec(String(input || ''));
    return m ? m[1].toLowerCase() : '';
}

/** A stable colour (hue 0-359) for a name, used for initials and text-post backgrounds. */
export function hueOf(name) {
    let hash = 0;
    for (const ch of String(name || '?')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return hash % 360;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
/** "4K", "Full HD", "HD" or "" for a picture or video size. */
export function qualityLabel(w, h) {
    const side = Math.min(Number(w) || 0, Number(h) || 0);
    if (side >= 2160) return '4K';
    if (side >= 1440) return '2K';
    if (side >= 1080) return 'Full HD';
    if (side >= 720) return 'HD';
    return '';
}

/** 1.2 MB, 340 KB */
export function fileSize(bytes) {
    const b = Number(bytes) || 0;
    if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1).replace(/\.0$/, '') + ' MB';
    return Math.max(1, Math.round(b / 1024)) + ' KB';
}

export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 180;

/** 'image' | 'video', or throws a readable error for anything else. */
export function mediaKind(file) {
    const type = String((file && file.type) || '');
    if (IMAGE_TYPES.includes(type)) return 'image';
    if (VIDEO_TYPES.includes(type)) return 'video';
    throw new Error('Pick a photo (JPG, PNG, WebP, GIF) or a video (MP4, WebM, MOV).');
}

/**
 * Photos are re-drawn before upload: smaller, and without hidden data such as the GPS location your
 * phone stores in them. GIFs are kept as they are so they still move.
 */
export async function prepareImage(file, maxSide = 2048, quality = 0.88) {
    if (file.type === 'image/gif') {
        if (file.size > MAX_BYTES) throw new Error('That GIF is over 50 MB.');
        return file;
    }
    const bitmap = await createImageBitmap(file).catch(() => {
        throw new Error("Couldn't open that picture.");
    });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob) throw new Error("Couldn't prepare that picture.");
    const out = new File([blob], 'image.' + (type === 'image/png' ? 'png' : 'jpg'), { type });
    out.width = w;
    out.height = h;
    return out;
}

/** Checks a video's size and length before uploading it. */
export function checkVideo(file) {
    if (file.size > MAX_BYTES) return Promise.reject(new Error('That video is over 50 MB. Trim it or pick a shorter one.'));
    return new Promise((resolve, reject) => {
        const v = document.createElement('video');
        const url = URL.createObjectURL(file);
        const done = (fn) => {
            URL.revokeObjectURL(url);
            fn();
        };
        v.preload = 'metadata';
        v.onloadedmetadata = () =>
            done(() =>
                v.duration > MAX_VIDEO_SECONDS
                    ? reject(new Error('Videos can be up to 3 minutes.'))
                    : resolve(file)
            );
        v.onerror = () => done(() => resolve(file)); // can't read it here; the server still checks size and type
        v.src = url;
    });
}
