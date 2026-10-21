// How the app looks and behaves: colour theme, animated background, motion, text size, video autoplay,
// upload and video quality, and little vibrations on likes.
// Saved on this device only (nothing about it goes to the server).

export const THEMES = {
    sunset: { label: 'Sunset', colors: ['139 92 246', '236 72 153', '251 146 60'] },
    ocean: { label: 'Ocean', colors: ['59 130 246', '6 182 212', '45 212 191'] },
    forest: { label: 'Forest', colors: ['16 185 129', '34 197 94', '234 179 8'] },
    berry: { label: 'Berry', colors: ['217 70 239', '244 63 94', '251 113 133'] },
    ember: { label: 'Ember', colors: ['239 68 68', '249 115 22', '250 204 21'] },
    frost: { label: 'Frost', colors: ['129 140 248', '56 189 248', '196 181 253'] }
};

export const BACKGROUNDS = [
    ['none', 'None'],
    ['paws', 'Paws'],
    ['stars', 'Stars'],
    ['hearts', 'Hearts'],
    ['bubbles', 'Bubbles']
];

export const AMOUNTS = [
    ['few', 'Few'],
    ['some', 'Some'],
    ['lots', 'Lots']
];

export const TEXT_SIZES = [
    ['small', 'Small', 0.92],
    ['normal', 'Normal', 1],
    ['large', 'Large', 1.1],
    ['huge', 'Huge', 1.22]
];

const DEFAULTS = { theme: 'sunset', background: 'paws', amount: 'some', motion: 'full', text: 'normal', autoplay: true, upload: 'best', video: 'best', haptics: true };
const KEY = 'furzone.look';
const listeners = new Set();
let current = load();

function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
        const out = { ...DEFAULTS };
        if (THEMES[saved.theme]) out.theme = saved.theme;
        if (BACKGROUNDS.some(([v]) => v === saved.background)) out.background = saved.background;
        if (AMOUNTS.some(([v]) => v === saved.amount)) out.amount = saved.amount;
        if (saved.motion === 'calm' || saved.motion === 'full') out.motion = saved.motion;
        if (TEXT_SIZES.some(([v]) => v === saved.text)) out.text = saved.text;
        if (typeof saved.autoplay === 'boolean') out.autoplay = saved.autoplay;
        if (saved.upload === 'standard' || saved.upload === 'best') out.upload = saved.upload;
        if (saved.video === 'saver' || saved.video === 'best') out.video = saved.video;
        if (typeof saved.haptics === 'boolean') out.haptics = saved.haptics;
        return out;
    } catch {
        return { ...DEFAULTS };
    }
}

export function look() {
    return current;
}

/** Calm motion: the person picked it, or their device asks for less motion. */
export function calm() {
    return current.motion === 'calm' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

export function setLook(patch) {
    current = { ...current, ...patch };
    try {
        localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
        // private mode: it works until the app closes
    }
    applyLook();
    for (const fn of listeners) fn(current);
}

export function onLookChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function resetLook() {
    setLook({ ...DEFAULTS });
}

/** Puts the choices on the page: colour variables, calm mode and text size. */
export function applyLook() {
    const root = document.documentElement;
    const [a, b, c] = THEMES[current.theme].colors;
    root.style.setProperty('--violet-rgb', a);
    root.style.setProperty('--pink-rgb', b);
    root.style.setProperty('--orange-rgb', c);
    root.classList.toggle('calm', current.motion === 'calm');
    const size = TEXT_SIZES.find(([v]) => v === current.text);
    root.style.setProperty('--zoom', String(size ? size[2] : 1));
    root.dataset.theme = current.theme;
}
