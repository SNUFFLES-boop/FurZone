// The Lounge: one big chat room, IRC style. When the Discord bridge is set up, messages go both ways
// between FurZone and a Discord channel.
import { h, icon, avatar, fill, errorText, spinner, toast, confirmDialog, flagPill, sheet } from '../ui.js';
import { app } from '../state.js';
import { hueOf } from '../format.js';
import { roleBadge, myRank } from '../staff.js';
import { openExternal } from '../platform.js';

const SYNC_MS = 8000;

function clock(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso) {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Text with web links made clickable. Links open outside the app. */
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

export function renderLounge(body, ctx) {
    let alive = true;
    let msgs = [];
    let status = { sending: false, reading: false };
    let syncTimer = 0;
    let refreshQueued = false;
    let loadingOlder = false;
    let noMoreOlder = false;

    let syncProblem = '';
    const pill = h('button', { class: 'lounge-status', type: 'button', onclick: () => myRank() >= 3 && checkLink() }, 'Connecting…');
    const peopleBtn = h('button', { class: 'icon-btn sm lounge-people', type: 'button', 'aria-label': 'Who is here', title: 'Who is here', onclick: () => whoIsHere() }, icon('user'));
    const log = h('div', { class: 'lounge-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Lounge chat' }, spinner());
    const input = h('input', { type: 'text', maxlength: 1000, placeholder: 'Say something nice…', 'aria-label': 'Message', enterkeyhint: 'send', autocomplete: 'off' });
    const send = h('button', { class: 'icon-btn send-btn', 'aria-label': 'Send', type: 'submit' }, icon('send'));
    const left = h('span', { class: 'char-left', hidden: true });
    const composer = h('form', { class: 'chat-composer', onsubmit: (e) => (e.preventDefault(), post()) }, input, left, send);
    input.oninput = () => {
        const n = 1000 - input.value.length;
        left.hidden = n > 100;
        left.textContent = String(n);
    };

    fill(
        body,
        h(
            'div',
            { class: 'lounge' },
            h('div', { class: 'lounge-head' }, h('span', { class: 'lounge-title' }, icon('hash'), 'lounge'), h('span', { class: 'lounge-head-right' }, peopleBtn, pill)),
            log,
            h('p', { class: 'lounge-rules fine' }, 'Be kind. Messages here are public', status.sending ? ' and also shared to Discord.' : '.'),
            composer
        )
    );
    const rules = body.querySelector('.lounge-rules');

    function setStatus() {
        const linked = status.sending || status.reading;
        // Admins see when the Discord link needs fixing, and can tap to find out what's wrong.
        const broken = myRank() >= 3 && (!!syncProblem || (linked && !(status.sending && status.reading)));
        fill(pill, icon(linked ? 'discord' : 'paw'), broken ? 'Discord: needs a fix' : linked ? 'Linked with Discord' : 'FurZone only');
        pill.classList.toggle('linked', linked && !broken);
        pill.classList.toggle('broken', broken);
        pill.disabled = myRank() < 3;
        fill(rules, 'Be kind. Messages here are public', status.sending ? ' and are also shared to our Discord.' : '.');
    }

    const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;

    function line(m, prev) {
        const fromDiscord = m.source === 'discord';
        const u = m.user;
        const name = fromDiscord ? m.discord_author || 'Discord user' : u ? u.display_name || u.username : 'Someone';
        const same =
            prev &&
            prev.source === m.source &&
            (fromDiscord ? prev.discord_author === m.discord_author : prev.user_id === m.user_id) &&
            new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000;
        const mine = !fromDiscord && app.me && m.user_id === app.me.id;
        const canDelete = !fromDiscord && (mine || myRank() >= 2);
        const who = fromDiscord
            ? h('span', { class: 'chat-name discord-name', style: { '--h': String(hueOf(name)) } }, h('span', { class: 'chat-src', title: 'From Discord' }, icon('discord')), h('span', { text: name }))
            : h('a', { class: 'chat-name', href: u ? `#/u/${u.username}` : '#/inbox/lounge', style: { '--h': String(hueOf(name)) } }, h('span', { text: name }), u && roleBadge(u.role), u && flagPill(u.flag));
        const pic = fromDiscord
            ? m.discord_avatar
                ? h('span', { class: 'avatar avatar-sm' }, h('img', { src: m.discord_avatar, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }))
                : avatar({ username: name }, 'sm')
            : avatar(u || { username: name }, 'sm', u && u.avatar_url);
        return h(
            'div',
            { class: 'chat-line' + (same ? ' cont' : '') + (mine ? ' mine' : '') + (fromDiscord ? ' from-discord' : ''), dataset: { id: String(m.id) } },
            h('span', { class: 'chat-pic' }, same ? null : pic),
            h(
                'div',
                { class: 'chat-main' },
                same ? null : h('div', { class: 'chat-top' }, who, h('time', { class: 'chat-time', datetime: m.created_at, text: clock(m.created_at) })),
                h('p', { class: 'chat-body' }, linkify(m.body))
            ),
            canDelete &&
                h('button', {
                    class: 'icon-btn sm chat-del',
                    'aria-label': 'Delete message',
                    onclick: async () => {
                        if (!(await confirmDialog('Delete this message?', mine ? 'It disappears from the Lounge.' : 'You are removing someone else\'s message as staff.', { ok: 'Delete', danger: true }))) return;
                        try {
                            await app.backend.loungeDelete(m.id);
                            msgs = msgs.filter((x) => x.id !== m.id);
                            draw(false);
                        } catch (e) {
                            toast(errorText(e), 'error');
                        }
                    }
                }, icon('trash'))
        );
    }

    function draw(stick) {
        const keep = stick === undefined ? nearBottom() : stick;
        const fromBottom = log.scrollHeight - log.scrollTop;
        const rows = [];
        if (msgs.length >= 60 && !noMoreOlder) {
            rows.push(h('button', { class: 'chip-btn older', text: 'Load older messages', onclick: older }));
        }
        let prev = null;
        let lastDay = '';
        for (const m of msgs) {
            const day = dayLabel(m.created_at);
            if (day !== lastDay) {
                rows.push(h('div', { class: 'chat-day' }, h('span', { text: day })));
                lastDay = day;
                prev = null;
            }
            rows.push(line(m, prev));
            prev = m;
        }
        if (!msgs.length) {
            rows.push(h('div', { class: 'chat-empty' }, icon('hash'), h('p', { text: 'No messages yet. Say hi! 👋' })));
        }
        fill(log, rows);
        if (keep) log.scrollTop = log.scrollHeight;
        else log.scrollTop = log.scrollHeight - fromBottom;
    }

    /** Get the newest messages and merge them in (also drops ones that were deleted). */
    async function refresh(stick) {
        try {
            const latest = await app.backend.loungeMessages();
            if (!alive) return;
            const oldest = latest.length ? latest[0].created_at : null;
            const older = oldest && latest.length >= 60 ? msgs.filter((m) => m.created_at < oldest) : [];
            msgs = [...older, ...latest];
            draw(stick);
        } catch (e) {
            if (alive && !msgs.length) fill(log, h('p', { class: 'form-error pad', text: errorText(e) }));
        }
    }

    async function older() {
        if (loadingOlder || !msgs.length) return;
        loadingOlder = true;
        try {
            const page = await app.backend.loungeMessages(msgs[0].created_at);
            const seen = new Set(msgs.map((m) => m.id));
            const fresh = page.filter((m) => !seen.has(m.id));
            if (!fresh.length) noMoreOlder = true;
            msgs = [...fresh, ...msgs];
            draw(false);
        } catch (e) {
            toast(errorText(e), 'error');
        } finally {
            loadingOlder = false;
        }
    }

    // Many changes can arrive at once (a Discord catch-up): refresh at most every 400 ms.
    function queueRefresh() {
        if (refreshQueued) return;
        refreshQueued = true;
        setTimeout(() => {
            refreshQueued = false;
            if (alive) refresh();
        }, 400);
    }

    async function post() {
        const text = input.value.trim();
        if (!text) return;
        send.disabled = true;
        try {
            await app.backend.loungeSend(text);
            input.value = '';
            input.oninput();
            await refresh(true);
        } catch (e) {
            toast(errorText(e), 'error');
        } finally {
            send.disabled = false;
            input.focus();
        }
    }

    // Ask the server to pull new Discord messages. The server itself only checks every few seconds.
    async function sync() {
        clearTimeout(syncTimer);
        if (!alive) return;
        if (status.reading && document.visibilityState === 'visible') {
            const r = await app.backend.loungeSync();
            if (alive && r && r.added) queueRefresh();
            const problem = (r && r.error) || '';
            if (alive && problem !== syncProblem) {
                syncProblem = problem;
                setStatus();
            }
        }
        if (alive) syncTimer = setTimeout(sync, SYNC_MS);
    }

    /** Everyone who chatted in the messages loaded here, FurZone people and Discord people. */
    function whoIsHere() {
        const fz = new Map();
        const dc = new Map();
        for (const m of [...msgs].reverse()) {
            if (m.source === 'discord') {
                const name = m.discord_author || 'Discord user';
                if (!dc.has(name)) dc.set(name, m);
            } else if (m.user && !fz.has(m.user.id)) fz.set(m.user.id, m);
        }
        sheet('In the Lounge', (b, close) => {
            const section = (title, ic, rows, empty) =>
                h('section', { class: 'who-section' }, h('h3', { class: 'who-title' }, icon(ic), title, h('span', { class: 'count-pill', text: String(rows.length) })), rows.length ? h('div', { class: 'people' }, rows) : h('p', { class: 'muted', text: empty }));
            const fzRows = [...fz.values()].map((m) =>
                h('a', { class: 'person person-link', href: `#/u/${m.user.username}`, onclick: () => close() }, avatar(m.user, 'md', m.user.avatar_url), h('span', { class: 'name-line' }, h('span', { class: 'name-top' }, h('strong', { text: m.user.display_name || m.user.username }), roleBadge(m.user.role), flagPill(m.user.flag)), h('span', { class: 'name-sub', text: '@' + m.user.username + ' · on FurZone' })))
            );
            const dcRows = [...dc.entries()].map(([name, m]) =>
                h(
                    'div',
                    { class: 'person' },
                    m.discord_avatar ? h('span', { class: 'avatar avatar-md' }, h('img', { src: m.discord_avatar, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })) : avatar({ username: name }, 'md'),
                    h('span', { class: 'name-line' }, h('span', { class: 'name-top' }, h('strong', { text: name }), h('span', { class: 'chat-src' }, icon('discord'))), h('span', { class: 'name-sub', text: 'on Discord' }))
                )
            );
            b.append(
                h('p', { class: 'muted', text: 'People who chatted here recently.' }),
                section('FurZone', 'paw', fzRows, 'No one from FurZone yet.'),
                section('Discord', 'discord', dcRows, status.reading ? 'No one from Discord yet.' : 'Discord isn\'t linked yet.')
            );
        }, { tall: true });
    }

    /** Admins: check each part of the Discord link and show what to fix. */
    function checkLink() {
        sheet('Discord link', (b) => {
            const list = h('div', { class: 'link-checks' }, spinner('Checking'));
            b.append(h('p', { class: 'muted', text: 'Checking the webhook, the bot and the channel…' }), list);
            app.backend
                .loungeCheck()
                .then((checks) =>
                    fill(
                        list,
                        checks.map((c) => h('div', { class: 'link-check' + (c.ok ? ' ok' : ' bad') }, icon(c.ok ? 'check' : 'close'), h('span', { text: c.text })))
                    )
                )
                .catch((e) => fill(list, h('p', { class: 'form-error', text: errorText(e) })));
        });
    }

    const stop = app.backend.subscribeLounge(queueRefresh);
    // Realtime can drop on a bad connection: a slow refresh keeps the room up to date anyway.
    const slow = setInterval(() => document.visibilityState === 'visible' && refresh(), 30000);

    setStatus();
    refresh(true);
    app.backend.loungeStatus().then((s) => {
        if (!alive) return;
        status = s || status;
        setStatus();
        sync();
    });

    return () => {
        alive = false;
        clearTimeout(syncTimer);
        clearInterval(slow);
        if (typeof stop === 'function') stop();
    };
}
