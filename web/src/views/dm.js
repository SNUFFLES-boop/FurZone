// One direct-message conversation: #/dm/<username>.
import { h, icon, avatar, fill, errorText, spinner, toast, sheet, confirmDialog, flagPill, emptyState, withBusy } from '../ui.js';
import { app } from '../state.js';
import { roleBadge } from '../staff.js';
import { reportUser } from './profile.js';
import { openExternal } from '../platform.js';

const POLL_MS = 15000;

function clock(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso) {
    const d = new Date(iso);
    if (d.toDateString() === new Date().toDateString()) return 'Today';
    if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function linkify(text) {
    const out = [];
    const re = /https:\/\/[^\s<>"]+/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const url = m[0].replace(/[.,!?)]+$/, '');
        out.push(h('a', { class: 'chat-link', href: url, rel: 'noopener noreferrer nofollow', text: url, onclick: (e) => (e.preventDefault(), openExternal(url)) }));
        last = m.index + url.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

export function renderDm(view, ctx, username) {
    let alive = true;
    let other = null;
    let state = null; // my side of the thread: open | request | archived | hidden | null (never talked)
    let msgs = [];
    let noMoreOlder = false;
    let pollTimer = 0;

    const head = h('header', { class: 'dm-head' });
    const banner = h('div', { class: 'dm-banner', hidden: true });
    const log = h('div', { class: 'dm-log', role: 'log', 'aria-live': 'polite' }, spinner());
    const input = h('textarea', { rows: 1, maxlength: 2000, placeholder: 'Message…', 'aria-label': 'Message', enterkeyhint: 'send' });
    const send = h('button', { class: 'icon-btn send-btn', 'aria-label': 'Send', type: 'submit' }, icon('send'));
    const composer = h('form', { class: 'chat-composer dm-composer', onsubmit: (e) => (e.preventDefault(), post()) }, input, send);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            post();
        }
    });
    input.addEventListener('input', grow);
    function grow() {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    }

    const page = h('div', { class: 'page dm-page fill' }, head, banner, log, composer);
    view.append(page);

    const back = () => (history.length > 1 ? history.back() : (location.hash = '#/inbox/messages'));

    async function start() {
        try {
            other = await app.backend.profileByUsername(username);
            if (!alive) return;
            if (!other) {
                fill(page, h('div', { class: 'pad' }, emptyState('user', 'No one here', `There's no account called @${username}.`, h('a', { class: 'btn ghost', href: '#/inbox/messages', text: 'Back to messages' }))));
                return;
            }
            if (other.id === app.me.id) {
                location.hash = '#/inbox/messages';
                return;
            }
            const t = await app.backend.thread(other.id);
            state = t ? t.state : null;
            drawHead();
            drawBanner();
            await load();
            if (state === 'open' || state === 'archived') markRead();
            schedulePoll();
            if (state !== 'request') input.focus({ preventScroll: true });
        } catch (e) {
            fill(log, h('p', { class: 'form-error pad', text: errorText(e) }));
        }
    }

    function drawHead() {
        fill(
            head,
            h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: back }, icon('back')),
            h(
                'a',
                { class: 'dm-who', href: `#/u/${other.username}` },
                avatar(other, 'md', other.avatar_url),
                h(
                    'span',
                    { class: 'name-line' },
                    h('span', { class: 'name-top' }, h('strong', { text: other.display_name || other.username }), roleBadge(other.role)),
                    h('span', { class: 'name-sub', text: '@' + other.username })
                )
            ),
            h('button', { class: 'icon-btn', 'aria-label': 'More', onclick: menu }, icon('more'))
        );
    }

    function drawBanner() {
        const parts = [];
        if (other.flag) {
            parts.push(
                h(
                    'div',
                    { class: 'dm-warning' },
                    flagPill(other.flag, 'md'),
                    h('p', { text: 'Several people reported this account. Never share your password, codes or personal info, and never send money or gift cards.' })
                )
            );
        }
        if (state === 'request') {
            parts.push(
                h(
                    'div',
                    { class: 'dm-request' },
                    h('p', null, h('strong', { text: `@${other.username}` }), " wants to message you. They won't see that you've read this until you accept."),
                    h(
                        'div',
                        { class: 'row gap' },
                        h('button', {
                            class: 'chip-btn primary',
                            text: 'Accept',
                            onclick: (e) =>
                                withBusy(e.currentTarget, async () => {
                                    try {
                                        await app.backend.dmSetState(other.id, 'open');
                                        state = 'open';
                                        drawBanner();
                                        markRead();
                                        input.focus();
                                    } catch (err) {
                                        toast(errorText(err), 'error');
                                    }
                                })
                        }),
                        h('button', { class: 'chip-btn', text: 'Delete', onclick: () => remove() }),
                        h('button', { class: 'chip-btn danger', text: 'Block', onclick: () => block() })
                    )
                )
            );
        }
        if (state === 'archived') {
            parts.push(
                h(
                    'div',
                    { class: 'dm-note' },
                    icon('archive'),
                    h('span', { class: 'grow', text: 'This chat is archived.' }),
                    h('button', { class: 'chip-btn', text: 'Unarchive', onclick: () => setState('open', 'Moved back to Chats') })
                )
            );
        }
        fill(banner, parts);
        banner.hidden = !parts.length;
        composer.hidden = state === 'request';
    }

    function draw(stick = true) {
        const fromBottom = log.scrollHeight - log.scrollTop;
        const rows = [];
        if (msgs.length >= 50 && !noMoreOlder) rows.push(h('button', { class: 'chip-btn older', text: 'Load older messages', onclick: older }));
        if (!msgs.length) {
            rows.push(
                h(
                    'div',
                    { class: 'chat-empty' },
                    avatar(other, 'xl', other.avatar_url),
                    h('strong', { text: other.display_name || other.username }),
                    h('p', { class: 'muted', text: `Say hi to @${other.username}! If they don't follow you, your first message arrives as a request.` })
                )
            );
        }
        let lastDay = '';
        let prev = null;
        // The newest message of mine that they've read gets a "Seen".
        let seenId = null;
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].sender_id === app.me.id) {
                if (msgs[i].read_at) seenId = msgs[i].id;
                break;
            }
        }
        for (const m of msgs) {
            const day = dayLabel(m.created_at);
            if (day !== lastDay) {
                rows.push(h('div', { class: 'chat-day' }, h('span', { text: day })));
                lastDay = day;
                prev = null;
            }
            const mine = m.sender_id === app.me.id;
            const grouped = prev && prev.sender_id === m.sender_id && new Date(m.created_at) - new Date(prev.created_at) < 3 * 60000;
            rows.push(
                h(
                    'div',
                    { class: 'bubble-row' + (mine ? ' mine' : '') + (grouped ? ' grouped' : '') + (m.pending ? ' pending' : '') },
                    h('div', { class: 'bubble', title: new Date(m.created_at).toLocaleString() }, h('p', null, linkify(m.body)), h('time', { text: clock(m.created_at) })),
                    m.id === seenId && h('span', { class: 'seen' }, icon('check'), 'Seen')
                )
            );
            prev = m;
        }
        fill(log, rows);
        if (stick) log.scrollTop = log.scrollHeight;
        else log.scrollTop = log.scrollHeight - fromBottom;
    }

    async function load() {
        const page = await app.backend.dmMessages(other.id);
        if (!alive) return;
        msgs = page.slice().reverse();
        draw(true);
    }

    async function older() {
        if (!msgs.length) return;
        try {
            const page = await app.backend.dmMessages(other.id, msgs[0].created_at);
            const seen = new Set(msgs.map((m) => m.id));
            const fresh = page.filter((m) => !seen.has(m.id)).reverse();
            if (fresh.length < 50) noMoreOlder = true;
            msgs = [...fresh, ...msgs];
            draw(false);
        } catch (e) {
            toast(errorText(e), 'error');
        }
    }

    /** Check for new messages and read receipts (realtime does most of the work; this is the backup). */
    async function poll() {
        if (!alive || !other) return;
        try {
            const page = await app.backend.dmMessages(other.id);
            if (!alive) return;
            const latest = page.slice().reverse();
            const near = log.scrollHeight - log.scrollTop - log.clientHeight < 100;
            const oldest = latest.length ? latest[0].created_at : null;
            const keep = oldest && latest.length >= 50 ? msgs.filter((m) => !m.pending && m.created_at < oldest) : [];
            const before = JSON.stringify(msgs.map((m) => [m.id, m.read_at]));
            msgs = [...keep, ...latest];
            if (JSON.stringify(msgs.map((m) => [m.id, m.read_at])) !== before) {
                draw(near);
                if (state === 'open' || state === 'archived') markRead();
            }
        } catch {
            // offline: try again later
        }
    }

    function schedulePoll() {
        clearTimeout(pollTimer);
        pollTimer = setTimeout(async () => {
            if (document.visibilityState === 'visible') await poll();
            if (alive) schedulePoll();
        }, POLL_MS);
    }

    async function markRead() {
        try {
            await app.backend.dmMarkRead(other.id);
            ctx.setUnread();
        } catch {
            // not important
        }
    }

    async function post() {
        const text = input.value.trim();
        if (!text || !other) return;
        if (send.disabled) return;
        send.disabled = true;
        const temp = { id: 'tmp-' + Date.now(), sender_id: app.me.id, body: text, created_at: new Date().toISOString(), read_at: null, pending: true };
        msgs.push(temp);
        input.value = '';
        grow();
        draw(true);
        try {
            await app.backend.sendDm(other.id, text);
            if (state === null || state === 'hidden') state = 'open';
            if (state === 'archived') state = 'open';
            drawBanner();
            await poll();
            msgs = msgs.filter((m) => m !== temp);
            draw(true);
        } catch (e) {
            msgs = msgs.filter((m) => m !== temp);
            input.value = text;
            grow();
            draw(true);
            toast(errorText(e), 'error', 5000);
        } finally {
            send.disabled = false;
            input.focus();
        }
    }

    async function setState(s, msg) {
        try {
            await app.backend.dmSetState(other.id, s);
            state = s;
            toast(msg, 'success');
            drawBanner();
            ctx.setUnread();
        } catch (e) {
            toast(errorText(e), 'error');
        }
    }

    async function remove() {
        if (!(await confirmDialog('Delete this conversation?', 'It disappears for you. They keep their copy.', { ok: 'Delete', danger: true }))) return;
        try {
            await app.backend.dmSetState(other.id, 'hidden');
            toast('Conversation deleted', 'success');
            ctx.setUnread();
            location.hash = '#/inbox/messages';
        } catch (e) {
            toast(errorText(e), 'error');
        }
    }

    async function block() {
        if (!(await confirmDialog(`Block @${other.username}?`, "They can't message, follow or see you, and you won't see them.", { ok: 'Block', danger: true }))) return;
        try {
            await app.backend.block(other.id);
            await app.backend.dmSetState(other.id, 'hidden').catch(() => {});
            toast(`Blocked @${other.username}`, 'success');
            ctx.setUnread();
            location.hash = '#/inbox/messages';
        } catch (e) {
            toast(errorText(e), 'error');
        }
    }

    function menu() {
        sheet(`@${other.username}`, (b, close) => {
            const item = (ic, label, fn, danger) => h('button', { class: 'menu-item' + (danger ? ' danger' : ''), onclick: () => (close(), fn()) }, icon(ic), h('span', { text: label }));
            fill(
                b,
                item('user', 'View profile', () => (location.hash = `#/u/${other.username}`)),
                state === 'open' && item('archive', 'Archive chat', () => setState('archived', 'Archived')),
                state === 'archived' && item('inbox', 'Move back to Chats', () => setState('open', 'Moved back to Chats')),
                state && item('trash', 'Delete conversation', remove, true),
                item('flag', `Report @${other.username}`, () => reportUser(other), true),
                item('ban', `Block @${other.username}`, block, true)
            );
        });
    }

    // New messages arrive through main.js (one realtime listener for the whole app).
    const onDm = (e) => {
        const m = e.detail;
        if (!other || !m || m.sender_id !== other.id) return;
        if (msgs.some((x) => x.id === m.id)) return;
        const near = log.scrollHeight - log.scrollTop - log.clientHeight < 100;
        msgs.push({ id: m.id, sender_id: m.sender_id, body: m.body, created_at: m.created_at, read_at: m.read_at });
        if (state === null || state === 'hidden') {
            app.backend.thread(other.id).then((t) => {
                state = t ? t.state : state;
                drawBanner();
            });
        }
        draw(near);
        if (state === 'open' || state === 'archived') markRead();
    };
    window.addEventListener('furzone:dm', onDm);

    start();

    return () => {
        alive = false;
        clearTimeout(pollTimer);
        window.removeEventListener('furzone:dm', onDm);
    };
}
