// The animated background (paws, stars, hearts or bubbles floating up).
// Made to stay smooth and easy on the battery:
//  - one canvas for the whole app, drawn behind everything, never more than 1.5x pixel density;
//  - each shape is drawn once into a small picture (a sprite) and then just copied, which is very cheap;
//  - the number of shapes follows the screen size, and drops by itself if frames start taking too long;
//  - it stops completely when the app is in the background, on video pages, or with calm motion turned on.
import { look, calm, onLookChange } from './look.js';
import { iconPath } from './icons.js';

const PATHS = {
    paws: iconPath('paw'),
    stars: 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2l-6.1 3.4 1.4-6.8L2.2 9.1l6.9-.8z',
    hearts: iconPath('heart')
};

// Shapes per 100,000 screen pixels (CSS pixels), and a hard ceiling.
const DENSITY = { few: 1.4, some: 3, lots: 5.5 };
const MAX = 110;
const SIZES = [14, 20, 28, 38];
const MAX_DPR = 1.5;

let canvas = null;
let ctx = null;
let sprites = [];
let parts = [];
let w = 0;
let h = 0;
let dpr = 1;
let raf = 0;
let last = 0;
let pageAllows = true;
let target = 0;
let scale = 1; // lowered when the device struggles
let slowFrames = 0;
let fastFrames = 0;
let resizeTimer = 0;

function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    return ['--violet-rgb', '--pink-rgb', '--orange-rgb'].map((v) => (cs.getPropertyValue(v).trim() || '255 255 255').split(/\s+/).join(','));
}

/** Draws every shape once, in each theme colour and size, into tiny canvases we copy from later. */
function makeSprites() {
    const kind = look().background;
    const colors = themeColors();
    sprites = [];
    for (const c of colors) {
        for (const size of SIZES) {
            const px = Math.ceil(size * dpr) + 4;
            const s = document.createElement('canvas');
            s.width = s.height = px;
            const g = s.getContext('2d');
            g.translate(px / 2, px / 2);
            if (kind === 'bubbles') {
                const r = (size * dpr) / 2;
                const grad = g.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
                grad.addColorStop(0, `rgba(${c},0.55)`);
                grad.addColorStop(0.7, `rgba(${c},0.18)`);
                grad.addColorStop(1, `rgba(${c},0.45)`);
                g.fillStyle = grad;
                g.beginPath();
                g.arc(0, 0, r, 0, Math.PI * 2);
                g.fill();
            } else {
                const k = (size * dpr) / 24;
                g.scale(k, k);
                g.translate(-12, -12);
                g.fillStyle = `rgb(${c})`;
                g.fill(new Path2D(PATHS[kind] || PATHS.paws));
            }
            sprites.push({ img: s, size: px / dpr });
        }
    }
}

function spawn(p, anywhere) {
    const sprite = sprites[(Math.random() * sprites.length) | 0];
    const depth = Math.random(); // far shapes are small, faint and slow
    p.sprite = sprite;
    p.x = Math.random() * w;
    p.y = anywhere ? Math.random() * h : h + sprite.size + Math.random() * 40;
    p.vy = -(8 + depth * 22); // pixels per second, upward
    p.sway = 6 + Math.random() * 14;
    p.phase = Math.random() * Math.PI * 2;
    p.freq = 0.25 + Math.random() * 0.5;
    p.rot = (Math.random() - 0.5) * 0.8;
    p.vr = (Math.random() - 0.5) * 0.35;
    p.alpha = 0.05 + depth * 0.11;
    p.x0 = p.x;
    return p;
}

function wanted() {
    return Math.min(MAX, Math.round(((w * h) / 100000) * DENSITY[look().amount] * scale));
}

function fitCount() {
    target = wanted();
    while (parts.length < target) parts.push(spawn({}, true));
    if (parts.length > target) parts.length = target;
}

function resize() {
    if (!canvas) return;
    w = window.innerWidth;
    h = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    makeSprites();
    for (const p of parts) p.sprite = sprites[(Math.random() * sprites.length) | 0];
    fitCount();
    draw(0);
}

function draw(dt) {
    ctx.clearRect(0, 0, w, h);
    const t = performance.now() / 1000;
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (dt) {
            p.y += p.vy * dt;
            p.rot += p.vr * dt;
            if (p.y < -p.sprite.size - 10) spawn(p, false);
        }
        const x = p.x0 + Math.sin(t * p.freq + p.phase) * p.sway;
        const s = p.sprite.size;
        ctx.globalAlpha = p.alpha;
        if (p.rot) {
            const cos = Math.cos(p.rot);
            const sin = Math.sin(p.rot);
            ctx.setTransform(cos * dpr, sin * dpr, -sin * dpr, cos * dpr, x * dpr, p.y * dpr);
            ctx.drawImage(p.sprite.img, -s / 2, -s / 2, s, s);
        } else {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.drawImage(p.sprite.img, x - s / 2, p.y - s / 2, s, s);
        }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
}

function frame(now) {
    raf = 0;
    if (!running()) return;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    // Keep an eye on how long frames take; fewer shapes if the device is struggling, more if it's fine.
    if (dt > 0.028) {
        if (++slowFrames > 45 && scale > 0.35) {
            scale = Math.max(0.35, scale * 0.75);
            slowFrames = 0;
            fitCount();
        }
    } else if (dt && dt < 0.018) {
        slowFrames = Math.max(0, slowFrames - 1);
        if (scale < 1 && ++fastFrames > 600) {
            scale = Math.min(1, scale * 1.15);
            fastFrames = 0;
            fitCount();
        }
    }
    draw(dt);
    raf = requestAnimationFrame(frame);
}

function running() {
    return !!canvas && pageAllows && look().background !== 'none' && document.visibilityState === 'visible' && !calm();
}

/** Starts, stops or freezes the background to match the settings and the page. */
function update() {
    if (!canvas) return;
    const show = pageAllows && look().background !== 'none';
    canvas.hidden = !show;
    if (!show) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        return;
    }
    if (running()) {
        if (!raf) {
            last = 0;
            raf = requestAnimationFrame(frame);
        }
    } else {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        draw(0); // calm motion: the shapes stay still
    }
}

export function startParticles() {
    if (canvas || typeof document === 'undefined') return;
    canvas = document.createElement('canvas');
    canvas.className = 'particles';
    canvas.setAttribute('aria-hidden', 'true');
    ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
        canvas = null;
        return;
    }
    document.body.prepend(canvas);
    resize();
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 150);
    });
    document.addEventListener('visibilitychange', update);
    const mq = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)');
    if (mq && mq.addEventListener) mq.addEventListener('change', update);
    onLookChange(() => {
        scale = 1;
        makeSprites();
        for (const p of parts) p.sprite = sprites[(Math.random() * sprites.length) | 0];
        fitCount();
        update();
        draw(0);
    });
    update();
}

/** Video pages (the feed, a single post) cover the whole screen: no need to draw behind them. */
export function particlesForPage(page) {
    pageAllows = !(page === 'home' || page === 'p');
    update();
}
