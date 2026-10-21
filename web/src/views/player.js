// FurZone's video player.
//
// In the feed: a seek bar you can drag (with the time shown while you drag), hold the video for 2× speed,
// a sound button and a full screen button. Wide videos fit the screen instead of being cut off.
//
// Full screen: the same video (it keeps playing where it was) on a black screen, in portrait or landscape,
// with play/pause, ±10 s (buttons or double-tap the sides), speed, loop, fit/fill, picture-in-picture where the
// device supports it, and keyboard shortcuts on computers. Controls hide by themselves while it plays.
import { h, icon, avatar, fill, registerLayer } from '../ui.js';
import { app, savePref } from '../state.js';
import { platform, setPlayerMode } from '../platform.js';

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SKIP = 10;
const HIDE_AFTER = 3000;
const HOLD_MS = 380;

/** 0:07, 1:23, 1:02:03 */
export function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const s = Math.floor(sec % 60);
    const m = Math.floor((sec / 60) % 60);
    const hr = Math.floor(sec / 3600);
    const ss = String(s).padStart(2, '0');
    return hr ? `${hr}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const isWide = (video) => video.videoWidth > 0 && video.videoWidth > video.videoHeight * 1.1;

/** Sound on/off for every video at once (remembered on this device). */
export function setMuted(muted) {
    savePref('muted', muted);
    for (const v of document.querySelectorAll('video.slide-video')) v.muted = muted;
    for (const b of document.querySelectorAll('[data-sound-btn]')) {
        fill(b, icon(muted ? 'mute' : 'volume'));
        b.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
    }
}

export function soundButton(cls) {
    const b = h('button', { class: cls, type: 'button', dataset: { soundBtn: '1' }, 'aria-label': app.muted ? 'Turn sound on' : 'Turn sound off' }, icon(app.muted ? 'mute' : 'volume'));
    b.addEventListener('click', (e) => {
        e.stopPropagation();
        setMuted(!app.muted);
    });
    return b;
}

/**
 * A seek bar for a video: drag (or tap) anywhere on it to jump; shows the time while dragging, and how much is
 * already loaded. Returns { el, destroy }.
 */
export function scrubber(video, { onDrag } = {}) {
    const loaded = h('span', { class: 'scrub-loaded' });
    const played = h('span', { class: 'scrub-played' });
    const knob = h('span', { class: 'scrub-knob' });
    const bubble = h('span', { class: 'scrub-bubble', hidden: true });
    const track = h('span', { class: 'scrub-track' }, loaded, played, knob);
    const el = h('div', { class: 'scrub', role: 'slider', tabindex: '0', 'aria-label': 'Seek', 'aria-valuemin': '0' }, track, bubble);
    let dragging = false;
    let resume = false;
    let target = 0;
    let lastSeek = 0;
    let raf = 0;

    const dur = () => (Number.isFinite(video.duration) ? video.duration : 0);
    function paint(f) {
        f = Math.min(1, Math.max(0, f || 0));
        played.style.transform = `scaleX(${f})`;
        knob.style.left = `${f * 100}%`;
    }
    function paintLoaded() {
        const d = dur();
        if (!d) return;
        let end = 0;
        for (let i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= video.currentTime + 0.5) end = Math.max(end, video.buffered.end(i));
        }
        loaded.style.transform = `scaleX(${Math.min(1, end / d)})`;
    }
    function label() {
        el.setAttribute('aria-valuemax', String(Math.round(dur())));
        el.setAttribute('aria-valuenow', String(Math.round(video.currentTime)));
        el.setAttribute('aria-valuetext', `${formatTime(video.currentTime)} of ${formatTime(dur())}`);
    }
    // Smooth while playing (timeupdate alone only fires about 4 times a second).
    function loop() {
        raf = 0;
        if (!dragging && dur()) paint(video.currentTime / dur());
        if (!video.paused && el.isConnected) raf = requestAnimationFrame(loop);
    }
    const onPlay = () => !raf && (raf = requestAnimationFrame(loop));
    const onTime = () => {
        if (!dragging && dur()) paint(video.currentTime / dur());
        label();
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('progress', paintLoaded);
    video.addEventListener('loadedmetadata', onTime);
    video.addEventListener('seeked', paintLoaded);

    function at(e) {
        const r = track.getBoundingClientRect();
        return Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1)));
    }
    function show(f) {
        target = f * dur();
        paint(f);
        bubble.hidden = false;
        bubble.textContent = `${formatTime(target)} / ${formatTime(dur())}`;
        bubble.style.left = `${f * 100}%`;
        // Show the frame under your finger, without asking for a new frame on every pixel.
        const now = performance.now();
        if (now - lastSeek > 140 && dur()) {
            lastSeek = now;
            if (typeof video.fastSeek === 'function') video.fastSeek(target);
            else video.currentTime = target;
        }
    }
    el.addEventListener('pointerdown', (e) => {
        if (!dur()) return;
        e.stopPropagation();
        e.preventDefault();
        dragging = true;
        el.classList.add('dragging');
        resume = !video.paused;
        video.pause();
        try {
            el.setPointerCapture(e.pointerId);
        } catch {
            // older WebViews
        }
        onDrag && onDrag(true);
        show(at(e));
    });
    el.addEventListener('pointermove', (e) => dragging && show(at(e)));
    const end = () => {
        if (!dragging) return;
        dragging = false;
        el.classList.remove('dragging');
        bubble.hidden = true;
        video.currentTime = target;
        if (resume) video.play().catch(() => {});
        onDrag && onDrag(false);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            video.currentTime = Math.min(dur(), Math.max(0, video.currentTime + (e.key === 'ArrowLeft' ? -5 : 5)));
        }
    });
    onTime();
    paintLoaded();
    if (!video.paused) onPlay();

    return {
        el,
        destroy() {
            cancelAnimationFrame(raf);
            video.removeEventListener('play', onPlay);
            video.removeEventListener('timeupdate', onTime);
            video.removeEventListener('progress', paintLoaded);
            video.removeEventListener('loadedmetadata', onTime);
            video.removeEventListener('seeked', paintLoaded);
        }
    };
}

/**
 * Press and hold a video to watch it at 2×. Calls onHold(true/false); returns a function that says whether the
 * last press was a hold (so the tap that ends it doesn't also pause the video).
 */
function holdForSpeed(surface, video, onHold) {
    let timer = 0;
    let holding = false;
    let wasHold = false;
    let startX = 0;
    let startY = 0;
    let before = 1;
    surface.addEventListener('pointerdown', (e) => {
        if (e.button > 0 || e.target.closest('button, a, .scrub, input')) return;
        wasHold = false;
        startX = e.clientX;
        startY = e.clientY;
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (video.paused) return;
            holding = true;
            wasHold = true;
            before = video.playbackRate;
            video.playbackRate = 2;
            onHold(true);
        }, HOLD_MS);
    });
    surface.addEventListener('pointermove', (e) => {
        if (!holding && Math.hypot(e.clientX - startX, e.clientY - startY) > 12) clearTimeout(timer);
    });
    const stop = () => {
        clearTimeout(timer);
        if (!holding) return;
        holding = false;
        video.playbackRate = before;
        onHold(false);
    };
    surface.addEventListener('pointerup', stop);
    surface.addEventListener('pointercancel', stop);
    surface.addEventListener('pointerleave', stop);
    surface.addEventListener('contextmenu', (e) => holding && e.preventDefault());
    return () => {
        const w = wasHold;
        wasHold = false;
        return w;
    };
}

/**
 * Feed controls for one video slide. `media` is the box the video sits in.
 * opts: { post, onOpenFull } -> returns { wasHold() } for the slide's tap handler.
 */
export function feedVideo(slide, media, video, { post, onBoop, isBooped, onComments }) {
    const speedBadge = h('span', { class: 'speed-badge', hidden: true }, icon('forward'), '2× speed');
    const bar = scrubber(video, { onDrag: (on) => slide.classList.toggle('scrubbing', on) });
    const fullPill = h('button', { class: 'full-pill', type: 'button', hidden: true, onclick: (e) => (e.stopPropagation(), open()) }, icon('expand'), 'Full screen');
    const tools = h(
        'div',
        { class: 'video-tools' },
        soundButton('video-tool'),
        h('button', { class: 'video-tool', type: 'button', 'aria-label': 'Full screen', onclick: (e) => (e.stopPropagation(), open()) }, icon('expand'))
    );
    media.append(speedBadge, fullPill, h('div', { class: 'video-bar' }, bar.el));
    slide.append(tools);

    // Wide (landscape) videos fit the card instead of being cut off, with a "Full screen" button under them.
    function shape() {
        const wide = isWide(video);
        slide.classList.toggle('wide-video', wide);
        fullPill.hidden = !wide;
        if (wide) {
            const r = media.getBoundingClientRect();
            const shown = Math.min(r.height, (r.width * video.videoHeight) / video.videoWidth);
            fullPill.style.top = `${r.height / 2 + shown / 2 + 14}px`;
        }
    }
    video.addEventListener('loadedmetadata', shape);
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => video.videoWidth && shape()).observe(media);

    const wasHold = holdForSpeed(media, video, (on) => {
        speedBadge.hidden = !on;
        slide.classList.toggle('fast', on);
    });
    // The big play sign shows whenever the video on screen is paused (but not while dragging the seek bar).
    video.addEventListener('play', () => slide.classList.remove('paused'));
    video.addEventListener('pause', () => slide.classList.contains('active') && !slide.classList.contains('scrubbing') && slide.classList.add('paused'));

    function open() {
        openPlayer({ video, post, home: media, onBoop, isBooped, onComments });
    }
    return { wasHold };
}

let current = null;

/** The full-screen player. Moves the video element in (so it keeps its place and buffer) and back out on close. */
export function openPlayer({ video, post, home, onBoop, isBooped, onComments }) {
    if (current) current.close();
    const nextSibling = video.nextSibling;
    const wasPlaying = !video.paused || video.currentTime === 0;
    const startLoop = video.loop;
    let orientation = isWide(video) ? 'landscape' : 'portrait';
    let fit = 'contain';
    let hideTimer = 0;
    let tapTimer = 0;
    let lastTap = { t: 0, zone: '' };
    let closed = false;
    const native = platform === 'android' && setPlayerMode(true, orientation);

    // ---- pieces ----
    const stage = h('div', { class: 'player-stage' });
    const spinnerEl = h('div', { class: 'player-wait', hidden: true }, h('span', { class: 'spinner' }));
    const errorEl = h('div', { class: 'player-error', hidden: true });
    const ripple = h('div', { class: 'player-ripple', hidden: true });
    const hintEl = h('div', { class: 'player-hint', hidden: true, role: 'status' });
    const menuEl = h('div', { class: 'player-menu', hidden: true, role: 'menu' });
    const speedBadge = h('span', { class: 'speed-badge', hidden: true }, icon('forward'), '2× speed');
    const bigPlay = h('button', { class: 'player-big', type: 'button', 'aria-label': 'Play' }, icon('play'));
    const back10 = h('button', { class: 'player-skip', type: 'button', 'aria-label': `Back ${SKIP} seconds` }, icon('rewind'), h('span', { text: String(SKIP) }));
    const fwd10 = h('button', { class: 'player-skip', type: 'button', 'aria-label': `Forward ${SKIP} seconds` }, icon('forward'), h('span', { text: String(SKIP) }));
    const timeNow = h('span', { class: 'player-time', text: '0:00' });
    const timeAll = h('span', { class: 'player-time muted', text: '0:00' });
    const bar = scrubber(video, { onDrag: (on) => (on ? showControls(true) : showControls()) });
    const speedBtn = h('button', { class: 'player-btn text', type: 'button', 'aria-label': 'Playback speed' }, speedLabel());
    const loopBtn = h('button', { class: 'player-btn', type: 'button', 'aria-label': 'Repeat', 'aria-pressed': String(video.loop) }, icon('repeat'));
    const fitBtn = h('button', { class: 'player-btn', type: 'button', 'aria-label': 'Fill the screen', 'aria-pressed': 'false' }, icon('fit'));
    const rotateBtn = h('button', { class: 'player-btn', type: 'button', 'aria-label': 'Turn the screen' }, icon('rotate'));
    const fsBtn = h('button', { class: 'player-btn', type: 'button', 'aria-label': 'Exit full screen' }, icon('shrink'));
    const pipBtn =
        document.pictureInPictureEnabled && platform !== 'android' && typeof video.requestPictureInPicture === 'function'
            ? h('button', { class: 'player-btn', type: 'button', 'aria-label': 'Picture in picture' }, icon('pip'))
            : null;
    const volume = h('input', { class: 'player-volume', type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Volume' });
    volume.value = String(app.muted ? 0 : video.volume);
    const heartBtn = onBoop ? h('button', { class: 'player-btn' + (isBooped() ? ' on' : ''), type: 'button', 'aria-label': 'Heart' }, icon('heart')) : null;
    const commentBtn = onComments ? h('button', { class: 'player-btn', type: 'button', 'aria-label': 'Comments' }, icon('comment')) : null;

    const top = h(
        'div',
        { class: 'player-top' },
        h('button', { class: 'player-btn', type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('back')),
        post &&
            h(
                'div',
                { class: 'player-who' },
                avatar(post.user, 'sm', post.user.avatar_url),
                h('span', { class: 'player-who-text' }, h('strong', { text: post.user.display_name || post.user.username }), post.caption && h('span', { class: 'muted', text: post.caption.slice(0, 120) }))
            ),
        heartBtn,
        commentBtn
    );
    const middle = h('div', { class: 'player-middle' }, back10, bigPlay, fwd10);
    const bottom = h(
        'div',
        { class: 'player-bottom' },
        h('div', { class: 'player-seek' }, timeNow, bar.el, timeAll),
        h(
            'div',
            { class: 'player-row' },
            h('div', { class: 'player-group' }, soundButton('player-btn'), volume),
            h('div', { class: 'player-group' }, speedBtn, loopBtn, fitBtn, pipBtn, rotateBtn, fsBtn)
        )
    );
    const controls = h('div', { class: 'player-controls' }, top, middle, bottom);
    const root = h('div', { class: 'player', role: 'dialog', 'aria-label': 'Video player', tabindex: '-1' }, stage, spinnerEl, errorEl, ripple, speedBadge, controls, hintEl, menuEl);

    // ---- put the video in ----
    video.classList.add('player-video');
    stage.append(video);
    document.body.append(root);
    document.documentElement.classList.add('player-open');
    const unregister = registerLayer(() => close());
    requestAnimationFrame(() => root.classList.add('in'));
    root.focus({ preventScroll: true });
    if (wasPlaying) video.play().catch(() => {});

    // Browsers and the Windows app: real full screen (needs the tap that opened the player).
    if (!native && root.requestFullscreen) {
        root.requestFullscreen({ navigationUI: 'hide' }).then(lockOrientation).catch(() => {});
    }

    // ---- state painting ----
    function speedLabel() {
        return `${video.playbackRate}×`;
    }
    function paint() {
        const playing = !video.paused;
        fill(bigPlay, icon(playing ? 'pause' : 'play'));
        bigPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        root.classList.toggle('playing', playing);
        timeNow.textContent = formatTime(video.currentTime);
        timeAll.textContent = formatTime(video.duration);
        fill(speedBtn, speedLabel());
        loopBtn.classList.toggle('on', video.loop);
        loopBtn.setAttribute('aria-pressed', String(video.loop));
        fitBtn.classList.toggle('on', fit === 'cover');
        fitBtn.setAttribute('aria-pressed', String(fit === 'cover'));
        stage.dataset.fit = fit;
        const inFs = native || !!document.fullscreenElement;
        fill(fsBtn, icon(inFs ? 'shrink' : 'expand'));
        fsBtn.setAttribute('aria-label', inFs ? (native ? 'Close the player' : 'Exit full screen') : 'Full screen');
        rotateBtn.hidden = !native && !(screen.orientation && screen.orientation.lock);
        if (heartBtn) heartBtn.classList.toggle('on', isBooped());
    }
    function showControls(stay) {
        root.classList.add('show');
        clearTimeout(hideTimer);
        if (!stay && !video.paused) hideTimer = setTimeout(() => root.classList.remove('show'), HIDE_AFTER);
    }
    function toggleControls() {
        if (root.classList.contains('show') && !video.paused) {
            clearTimeout(hideTimer);
            root.classList.remove('show');
        } else showControls();
    }
    function playPause() {
        if (video.paused) video.play().catch(() => {});
        else video.pause();
        showControls();
    }
    function skip(sec) {
        const d = Number.isFinite(video.duration) ? video.duration : 0;
        video.currentTime = Math.min(Math.max(0, video.currentTime + sec), d || video.currentTime + sec);
        ripple.hidden = false;
        ripple.className = 'player-ripple ' + (sec < 0 ? 'left' : 'right');
        fill(ripple, icon(sec < 0 ? 'rewind' : 'forward'), `${Math.abs(sec)} s`);
        void ripple.offsetWidth;
        ripple.classList.add('go');
        clearTimeout(ripple.t);
        ripple.t = setTimeout(() => (ripple.hidden = true), 650);
        showControls();
    }
    async function lockOrientation() {
        try {
            if (orientation === 'auto') screen.orientation.unlock();
            else await screen.orientation.lock(orientation);
        } catch {
            // not every device or browser allows it
        }
    }
    function rotate() {
        orientation = { auto: 'landscape', landscape: 'portrait', portrait: 'auto' }[orientation];
        if (native) setPlayerMode(true, orientation);
        else lockOrientation();
        hint({ landscape: 'Landscape', portrait: 'Portrait', auto: 'Turns with your phone' }[orientation]);
        showControls();
    }
    // Menus and messages live inside the player: in full screen, nothing outside it can show on top.
    function hint(text) {
        fill(hintEl, text);
        hintEl.hidden = false;
        hintEl.classList.remove('go');
        void hintEl.offsetWidth;
        hintEl.classList.add('go');
        clearTimeout(hintEl.t);
        hintEl.t = setTimeout(() => (hintEl.hidden = true), 1400);
    }
    function closeMenu() {
        menuEl.hidden = true;
        fill(menuEl);
    }
    function pickSpeed() {
        if (!menuEl.hidden) return closeMenu();
        fill(
            menuEl,
            h('p', { class: 'player-menu-title', text: 'Playback speed' }),
            SPEEDS.map((sp) =>
                h(
                    'button',
                    {
                        class: 'player-menu-item' + (video.playbackRate === sp ? ' on' : ''),
                        type: 'button',
                        onclick: (e) => {
                            e.stopPropagation();
                            video.playbackRate = sp;
                            closeMenu();
                            paint();
                            showControls();
                        }
                    },
                    h('span', { text: sp === 1 ? 'Normal' : `${sp}×` }),
                    video.playbackRate === sp && icon('check')
                )
            )
        );
        menuEl.hidden = false;
        showControls(true);
    }
    async function toggleFullscreen() {
        if (native) return close();
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await root.requestFullscreen({ navigationUI: 'hide' });
        } catch {
            // ignore
        }
        paint();
    }

    // ---- wiring ----
    bigPlay.onclick = (e) => (e.stopPropagation(), playPause());
    back10.onclick = (e) => (e.stopPropagation(), skip(-SKIP));
    fwd10.onclick = (e) => (e.stopPropagation(), skip(SKIP));
    speedBtn.onclick = (e) => (e.stopPropagation(), pickSpeed());
    loopBtn.onclick = (e) => {
        e.stopPropagation();
        video.loop = !video.loop;
        hint(video.loop ? 'Repeat on' : 'Repeat off');
        paint();
        showControls();
    };
    fitBtn.onclick = (e) => {
        e.stopPropagation();
        fit = fit === 'contain' ? 'cover' : 'contain';
        hint(fit === 'cover' ? 'Fill the screen' : 'Fit the whole video');
        paint();
        showControls();
    };
    rotateBtn.onclick = (e) => (e.stopPropagation(), rotate());
    fsBtn.onclick = (e) => (e.stopPropagation(), toggleFullscreen());
    if (pipBtn) {
        pipBtn.onclick = async (e) => {
            e.stopPropagation();
            try {
                await video.requestPictureInPicture();
            } catch {
                hint("Picture-in-picture isn't available here.");
            }
        };
    }
    if (heartBtn) heartBtn.onclick = (e) => (e.stopPropagation(), onBoop(), setTimeout(paint, 30));
    // Comments open over the feed, so the player closes first (the video stays where it was).
    if (commentBtn) commentBtn.onclick = (e) => (e.stopPropagation(), close(), onComments());
    volume.addEventListener('input', () => {
        const v = Number(volume.value);
        video.volume = v;
        if ((v === 0) !== app.muted) setMuted(v === 0);
        showControls();
    });
    volume.addEventListener('click', (e) => e.stopPropagation());

    const wasHold = holdForSpeed(stage, video, (on) => {
        speedBadge.hidden = !on;
        if (on) root.classList.remove('show');
    });
    // Taps: one tap shows or hides the controls; double-tap the left or right side to skip, the middle to pause.
    stage.addEventListener('click', (e) => {
        if (!menuEl.hidden) return closeMenu();
        if (wasHold()) return;
        const r = stage.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const zone = x < 0.35 ? 'left' : x > 0.65 ? 'right' : 'middle';
        const now = Date.now();
        if (now - lastTap.t < 300 && lastTap.zone === zone) {
            clearTimeout(tapTimer);
            lastTap = { t: 0, zone: '' };
            if (zone === 'left') skip(-SKIP);
            else if (zone === 'right') skip(SKIP);
            else playPause();
            return;
        }
        lastTap = { t: now, zone };
        clearTimeout(tapTimer);
        tapTimer = setTimeout(toggleControls, 260);
    });
    // Taps on the control layer's empty space act like taps on the video.
    controls.addEventListener('click', (e) => {
        if (e.target === controls || e.target === middle) stage.dispatchEvent(new MouseEvent('click', { clientX: e.clientX, clientY: e.clientY }));
    });
    controls.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && showControls());

    const onKey = (e) => {
        if (e.target.closest && e.target.closest('input, textarea') && e.target !== volume) return;
        const k = e.key.toLowerCase();
        const handled = {
            ' ': playPause,
            k: playPause,
            j: () => skip(-SKIP),
            l: () => skip(SKIP),
            arrowleft: () => skip(-5),
            arrowright: () => skip(5),
            arrowup: () => ((video.volume = Math.min(1, video.volume + 0.1)), (volume.value = String(video.volume)), app.muted && setMuted(false), showControls()),
            arrowdown: () => ((video.volume = Math.max(0, video.volume - 0.1)), (volume.value = String(video.volume)), showControls()),
            m: () => (setMuted(!app.muted), showControls()),
            f: toggleFullscreen,
            escape: () => (!menuEl.hidden ? closeMenu() : document.fullscreenElement ? document.exitFullscreen().catch(() => {}) : close()),
            '>': () => ((video.playbackRate = SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(video.playbackRate) + 1)] || 1), paint()),
            '<': () => ((video.playbackRate = SPEEDS[Math.max(0, SPEEDS.indexOf(video.playbackRate) - 1)] || 1), paint())
        }[k];
        if (!handled && /^[0-9]$/.test(k) && Number.isFinite(video.duration)) {
            video.currentTime = (video.duration * Number(k)) / 10;
            showControls();
            e.preventDefault();
            return;
        }
        if (handled) {
            e.preventDefault();
            handled();
        }
    };
    document.addEventListener('keydown', onKey);

    const events = {
        play: () => (paint(), showControls()),
        pause: () => (paint(), showControls(true)),
        ratechange: paint,
        timeupdate: () => (timeNow.textContent = formatTime(video.currentTime)),
        durationchange: paint,
        loadedmetadata: paint,
        waiting: () => (spinnerEl.hidden = false),
        playing: () => ((spinnerEl.hidden = true), (errorEl.hidden = true)),
        canplay: () => (spinnerEl.hidden = true),
        error: () => {
            spinnerEl.hidden = true;
            errorEl.hidden = false;
            fill(
                errorEl,
                h('p', { text: "This video can't play right now." }),
                h('button', { class: 'btn ghost', type: 'button', text: 'Try again', onclick: (e) => (e.stopPropagation(), video.load(), video.play().catch(() => {})) })
            );
        },
        ended: () => showControls(true)
    };
    for (const [ev, fn] of Object.entries(events)) video.addEventListener(ev, fn);
    const onFs = () => paint();
    document.addEventListener('fullscreenchange', onFs);

    paint();
    showControls();

    function close() {
        if (closed) return;
        closed = true;
        current = null;
        unregister();
        clearTimeout(hideTimer);
        clearTimeout(tapTimer);
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('fullscreenchange', onFs);
        for (const [ev, fn] of Object.entries(events)) video.removeEventListener(ev, fn);
        bar.destroy();
        if (native) setPlayerMode(false);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        try {
            if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
        } catch {
            // ignore
        }
        if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
        // The video goes back into the feed, still playing (or paused) where it was.
        video.classList.remove('player-video');
        video.loop = startLoop;
        if (home && home.isConnected) home.insertBefore(video, nextSibling && nextSibling.parentNode === home ? nextSibling : home.firstChild);
        else video.pause();
        document.documentElement.classList.remove('player-open');
        root.classList.remove('in');
        setTimeout(() => root.remove(), 220);
    }
    current = { close };
    return current;
}
