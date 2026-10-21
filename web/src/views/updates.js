// App updates for the Android and Windows apps: checks GitHub releases, downloads in the app (the native
// side verifies the SHA-256 before installing).
import { h, icon, toast, errorText, withBusy, fill } from '../ui.js';
import { platform, checkForUpdate, installUpdate, onUpdateProgress } from '../platform.js';
import { VERSION } from '../config.js';

const state = { info: null, checking: false, phase: '', percent: 0, error: '' };
const listeners = new Set();
let started = false;

function changed() {
    for (const fn of listeners) fn();
}

export async function check(manual = false) {
    if (platform === 'web' || state.checking) return;
    state.checking = true;
    state.error = '';
    changed();
    try {
        state.info = await checkForUpdate();
        if (state.info && state.info.available && !manual) {
            toast(`FurZone ${state.info.version} is out — update in Settings.`, 'info', 6000);
        }
    } catch (e) {
        state.error = errorText(e);
    } finally {
        state.checking = false;
        changed();
    }
}

export function startUpdateChecks() {
    if (started || platform === 'web') return;
    started = true;
    onUpdateProgress((phase, percent, message) => {
        state.phase = phase;
        state.percent = percent;
        if (phase === 'error') {
            state.error = message || 'The update failed.';
            toast(state.error, 'error', 6000);
        }
        changed();
    });
    setTimeout(() => check(false), 4000);
    setInterval(() => check(false), 6 * 3600 * 1000);
}

export function updateSection() {
    const box = h('div', { class: 'update-box' });
    function draw() {
        if (!box.isConnected && box.parentNode) return;
        const s = state;
        let status;
        if (platform === 'web') status = `Version ${VERSION}. Updates arrive automatically in the browser.`;
        else if (s.checking) status = 'Checking for updates…';
        else if (s.phase === 'downloading') status = `Downloading update… ${s.percent}%`;
        else if (s.phase === 'installing') status = 'Installing…';
        else if (s.error) status = s.error;
        else if (s.info && s.info.available) status = `Version ${s.info.version} is available.`;
        else if (s.info) status = `You're up to date (${VERSION}).`;
        else status = `Version ${VERSION}`;
        const busy = s.checking || s.phase === 'downloading' || s.phase === 'installing';
        const btn =
            platform === 'web'
                ? null
                : s.info && s.info.available
                  ? h(
                        'button',
                        {
                            class: 'btn primary',
                            disabled: busy,
                            onclick: (e) =>
                                withBusy(e.currentTarget, async () => {
                                    try {
                                        state.error = '';
                                        await installUpdate(s.info);
                                    } catch (err) {
                                        state.error = errorText(err);
                                        changed();
                                    }
                                })
                        },
                        icon('download'),
                        'Update now'
                    )
                  : h('button', { class: 'btn ghost', disabled: busy, onclick: () => check(true) }, icon('refresh'), 'Check for updates');
        fill(
            box,
            h('p', { class: 'update-status', text: status }),
            s.phase === 'downloading' ? h('div', { class: 'upload-progress' }, h('span', { style: { transform: `scaleX(${s.percent / 100})` } })) : null,
            s.info && s.info.available && s.info.notes ? h('p', { class: 'muted small', text: s.info.notes }) : null,
            btn
        );
    }
    listeners.add(draw);
    draw();
    return box;
}
