// The Inbox: Activity (boops, comments, follows, follow requests), Messages (direct messages, with Requests and
// Archived), the Lounge (FurZone chat shared with Discord) and News (VRChat updates and FurZone announcements).
import { h, icon, avatar, emptyState, errorText, spinner, withBusy, toast, sheet, confirmDialog, flagPill, fill } from '../ui.js';
import { app } from '../state.js';
import { timeAgo, hueOf, compactCount } from '../format.js';
import { roleBadge, myRank } from '../staff.js';
import { renderLounge } from './lounge.js';
import { openExternal } from '../platform.js';
import { captionNode } from './postcard.js';

const TEXT = {
    boop: ['heart', 'booped your post'],
    comment: ['comment', 'commented on your post'],
    follow: ['user', 'started following you']
};

const TABS = [
    ['activity', 'Activity', 'bell'],
    ['messages', 'Messages', 'mail'],
    ['lounge', 'Lounge', 'hash'],
    ['news', 'News', 'megaphone']
];

let lastBox = 'open';

export function renderInbox(view, ctx, tab = 'activity') {
    if (!TABS.some(([t]) => t === tab)) tab = 'activity';
    let alive = true;
    let cleanup = null;
    const body = h('div', { class: 'inbox-body' });
    const counts = {};
    const tabBar = h(
        'nav',
        { class: 'inbox-tabs', role: 'tablist', 'aria-label': 'Inbox' },
        TABS.map(([t, label, ic]) =>
            h(
                'a',
                { class: 'inbox-tab' + (t === tab ? ' on' : ''), href: `#/inbox/${t}`, role: 'tab', 'aria-selected': String(t === tab) },
                icon(ic),
                h('span', { text: label }),
                (counts[t] = h('span', { class: 'tab-count', hidden: true }))
            )
        )
    );
    const page = h('div', { class: 'page inbox-page' + (tab === 'lounge' ? ' fill' : '') }, h('h1', { class: 'page-title', text: 'Inbox' }), tabBar, body);
    view.append(page);

    const setCount = (t, n) => {
        counts[t].hidden = !n;
        counts[t].textContent = n > 99 ? '99+' : String(n);
    };
    app.backend
        .dmCounts()
        .then((c) => alive && setCount('messages', c.unread + c.requests))
        .catch(() => {});
    if (tab !== 'activity') setCount('activity', app.unreadActivity || 0);

    if (tab === 'activity') activity();
    else if (tab === 'messages') messages();
    else if (tab === 'lounge') cleanup = renderLounge(body, ctx);
    else news();

    // ---------------------------------------------------------------- activity

    async function activity() {
        fill(body, spinner());
        try {
            const [items, requests] = await Promise.all([app.backend.notifications(), app.backend.followRequests().catch(() => [])]);
            if (!alive) return;
            const parts = [];
            if (requests.length) {
                parts.push(
                    h(
                        'section',
                        { class: 'follow-requests' },
                        h('h2', { class: 'section-title' }, icon('lock'), `Follow requests`, h('span', { class: 'count-pill', text: String(requests.length) })),
                        requests.map(requestRow)
                    )
                );
            }
            if (items.length) parts.push(h('div', { class: 'inbox' }, items.map(noteRow)));
            else if (!requests.length) {
                const demo =
                    app.backend.kind === 'demo' &&
                    h('button', {
                        class: 'btn ghost',
                        text: 'Show me what it looks like',
                        onclick: (e) =>
                            withBusy(e.currentTarget, async () => {
                                await app.backend.demoActivity();
                                await activity();
                            })
                    });
                parts.push(emptyState('bell', 'All quiet', 'Boops, comments and new followers show up here.', demo));
            }
            fill(body, parts);
            if (items.some((n) => !n.read)) {
                await app.backend.markNotificationsRead();
                ctx.setUnread();
            }
        } catch (e) {
            fill(body, h('p', { class: 'form-error', text: errorText(e) }));
        }
    }

    function requestRow(r) {
        const row = h('div', { class: 'person request-row' });
        const answer = (accept) => async (e) =>
            withBusy(e.currentTarget, async () => {
                try {
                    await app.backend.answerFollowRequest(r.user.id, accept);
                    row.classList.add('leaving');
                    setTimeout(() => {
                        row.remove();
                        if (!body.querySelector('.request-row')) activity();
                    }, 220);
                    toast(accept ? `@${r.user.username} can see your posts now` : 'Request declined', accept ? 'success' : 'info');
                    ctx.setUnread();
                } catch (err) {
                    toast(errorText(err), 'error');
                }
            });
        fill(
            row,
            h('a', { class: 'person-link', href: `#/u/${r.user.username}` }, avatar(r.user, 'md', r.user.avatar_url), personName(r.user, `wants to follow you · ${timeAgo(r.created_at)}`)),
            h('button', { class: 'chip-btn primary', text: 'Approve', onclick: answer(true) }),
            h('button', { class: 'chip-btn', text: 'Decline', onclick: answer(false) })
        );
        return row;
    }

    function noteRow(n) {
        const [ic, what] = TEXT[n.kind] || ['bell', ''];
        const href = n.kind === 'follow' || !n.post_id ? `#/u/${n.actor.username}` : `#/p/${n.post_id}`;
        let thumb = null;
        if (n.post) {
            thumb =
                n.post.media_type === 'image'
                    ? h('img', { class: 'note-thumb', src: n.post.media_url, alt: '' })
                    : n.post.media_type === 'video'
                      ? h('span', { class: 'note-thumb vid' }, icon('video'))
                      : h('span', { class: 'note-thumb txt', style: { '--h': String(hueOf(n.post.caption)) } }, icon('paw'));
        }
        return h(
            'a',
            { class: 'note' + (n.read ? '' : ' unread'), href },
            h('span', { class: 'note-avatar' }, avatar(n.actor, 'md', n.actor.avatar_url), h('span', { class: 'note-kind k-' + n.kind }, icon(ic))),
            h(
                'span',
                { class: 'note-text' },
                h('strong', { text: n.actor.display_name || n.actor.username }),
                ' ',
                what,
                h('span', { class: 'muted', text: ' · ' + timeAgo(n.created_at) })
            ),
            thumb
        );
    }

    // ---------------------------------------------------------------- messages

    async function messages() {
        const boxes = h('div', { class: 'filter-row msg-boxes' });
        const list = h('div', { class: 'threads' }, spinner());
        const newBtn = h('button', { class: 'icon-btn new-msg', 'aria-label': 'New message', title: 'New message', onclick: () => newMessage(ctx) }, icon('edit'));
        fill(body, h('div', { class: 'msg-head' }, boxes, newBtn), list);
        let dmCounts = { unread: 0, requests: 0 };
        try {
            dmCounts = await app.backend.dmCounts();
        } catch {
            // counts are only decoration
        }
        function drawBoxes() {
            fill(
                boxes,
                [
                    ['open', 'Chats', 'mail'],
                    ['request', 'Requests', 'inbox'],
                    ['archived', 'Archived', 'archive']
                ].map(([v, label, ic]) =>
                    h(
                        'button',
                        {
                            class: 'filter-chip' + (lastBox === v ? ' on' : ''),
                            'aria-pressed': String(lastBox === v),
                            onclick: () => {
                                lastBox = v;
                                drawBoxes();
                                loadThreads();
                            }
                        },
                        icon(ic),
                        label,
                        v === 'request' && dmCounts.requests ? h('span', { class: 'chip-count', text: String(dmCounts.requests) }) : null
                    )
                )
            );
        }
        async function loadThreads() {
            fill(list, spinner());
            try {
                const rows = await app.backend.threads(lastBox);
                if (!alive) return;
                const empty = {
                    open: ['mail', 'No messages yet', 'Start a chat from someone\'s profile, or tap "New message".'],
                    request: ['inbox', 'No message requests', 'Messages from people you don\'t follow land here first.'],
                    archived: ['archive', 'Nothing archived', 'Archive a chat to tidy it away without deleting it.']
                }[lastBox];
                fill(list, rows.length ? rows.map((t, i) => threadRow(t, i)) : emptyState(...empty));
            } catch (e) {
                fill(list, h('p', { class: 'form-error', text: errorText(e) }));
            }
        }
        function threadRow(t, i) {
            const o = t.other;
            const preview = ((t.last_from_me ? 'You: ' : '') + t.last_body).replace(/furzone:\/\/post\/[A-Za-z0-9_-]+/gi, '🖼 a post');
            const row = h(
                'div',
                { class: 'thread' + (t.unread ? ' unread' : ''), style: { '--i': String(Math.min(i, 12)) } },
                h(
                    'a',
                    { class: 'thread-link', href: `#/dm/${o.username}` },
                    avatar(o, 'lg', o.avatar_url),
                    h(
                        'span',
                        { class: 'thread-text' },
                        h('span', { class: 'thread-top' }, h('strong', { text: o.display_name || o.username }), roleBadge(o.role), flagPill(o.flag), h('span', { class: 'muted when', text: timeAgo(t.last_message_at) })),
                        h('span', { class: 'thread-preview', text: preview })
                    ),
                    t.unread ? h('span', { class: 'unread-dot', text: t.unread > 9 ? '9+' : String(t.unread) }) : null
                )
            );
            if (t.state === 'request') {
                row.append(
                    h(
                        'div',
                        { class: 'thread-actions' },
                        o.flag && h('p', { class: 'thread-warning' }, icon('flag'), 'Careful: several people reported this account. Never share your password or pay anyone.'),
                        h('a', { class: 'chip-btn primary', href: `#/dm/${o.username}`, text: 'Open' }),
                        h('button', { class: 'chip-btn', text: 'Delete', onclick: () => setState(t, 'hidden', 'Request deleted') }),
                        h('button', { class: 'chip-btn danger', text: 'Block', onclick: () => blockThem(o) })
                    )
                );
            } else {
                row.append(
                    h('button', {
                        class: 'icon-btn sm thread-more',
                        'aria-label': 'More',
                        onclick: () =>
                            sheet(`@${o.username}`, (b, close) => {
                                const item = (ic, label, fn, danger) => h('button', { class: 'menu-item' + (danger ? ' danger' : ''), onclick: () => (close(), fn()) }, icon(ic), h('span', { text: label }));
                                b.append(
                                    t.state === 'archived' ? item('inbox', 'Move back to Chats', () => setState(t, 'open', 'Moved to Chats')) : item('archive', 'Archive', () => setState(t, 'archived', 'Archived')),
                                    item('trash', 'Delete conversation', async () => {
                                        if (await confirmDialog('Delete this conversation?', 'It disappears for you. They keep their copy.', { ok: 'Delete', danger: true })) setState(t, 'hidden', 'Conversation deleted');
                                    }, true)
                                );
                            })
                    }, icon('more'))
                );
            }
            return row;
        }
        async function setState(t, state, msg) {
            try {
                await app.backend.dmSetState(t.other_id, state);
                toast(msg, 'success');
                dmCounts = await app.backend.dmCounts().catch(() => dmCounts);
                drawBoxes();
                loadThreads();
                ctx.setUnread();
            } catch (e) {
                toast(errorText(e), 'error');
            }
        }
        async function blockThem(o) {
            if (!(await confirmDialog(`Block @${o.username}?`, "They can't message, follow or see you, and you won't see them.", { ok: 'Block', danger: true }))) return;
            try {
                await app.backend.block(o.id);
                await app.backend.dmSetState(o.id, 'hidden').catch(() => {});
                toast(`Blocked @${o.username}`, 'success');
                dmCounts = await app.backend.dmCounts().catch(() => dmCounts);
                drawBoxes();
                loadThreads();
                ctx.setUnread();
            } catch (e) {
                toast(errorText(e), 'error');
            }
        }
        drawBoxes();
        loadThreads();
    }

    // ---------------------------------------------------------------- news

    async function news() {
        const list = h('div', { class: 'news' }, spinner());
        const post = myRank() >= 3 && h('button', { class: 'chip-btn primary', onclick: () => announce(() => news()) }, icon('megaphone'), 'Post an announcement');
        fill(body, h('p', { class: 'muted news-intro' }, 'VRChat updates come from VRChat\'s official announcements.', post), list);
        const draw = (items) =>
            fill(list, items.length ? items.map(newsCard) : emptyState('megaphone', 'No news yet', 'VRChat updates and FurZone announcements show up here.'));
        try {
            draw(await app.backend.news());
            // Ask the server to check VRChat's news (it only really checks every 30 minutes), then refresh.
            const r = await app.backend.refreshNews();
            if (alive && r && r.added) draw(await app.backend.news());
        } catch (e) {
            fill(list, h('p', { class: 'form-error', text: errorText(e) }));
        }
    }

    function newsCard(n) {
        const long = (n.body || '').length > 280;
        const text = h('div', { class: 'news-body' + (long ? ' clamp' : '') }, captionNode(n.body || '', 'news-text'));
        return h(
            'article',
            { class: 'news-card src-' + n.source },
            h(
                'div',
                { class: 'news-src' },
                h('span', { class: 'news-logo' }, icon(n.source === 'vrchat' ? 'vrchat' : 'paw')),
                h('strong', { text: n.source === 'vrchat' ? 'VRChat update' : 'FurZone' }),
                h('span', { class: 'muted', text: '· ' + timeAgo(n.published_at) })
            ),
            h('h3', { text: n.title }),
            n.body && text,
            h(
                'div',
                { class: 'news-actions' },
                long && h('button', { class: 'chip-btn', text: 'Show more', onclick: (e) => (text.classList.remove('clamp'), e.currentTarget.remove()) }),
                n.url && h('button', { class: 'chip-btn primary', onclick: () => openExternal(n.url) }, 'Read the full post', icon('chevron'))
            )
        );
    }

    return () => {
        alive = false;
        if (typeof cleanup === 'function') cleanup();
    };
}

function personName(u, sub) {
    return h(
        'span',
        { class: 'name-line' },
        h('span', { class: 'name-top' }, h('strong', { text: u.display_name || u.username }), roleBadge(u.role), flagPill(u.flag)),
        h('span', { class: 'name-sub', text: sub || '@' + u.username })
    );
}

/** Pick someone to message. */
function newMessage(ctx) {
    sheet(
        'New message',
        (body) => {
            const input = h('input', { type: 'search', placeholder: 'Search by name or species', 'aria-label': 'Who to message', maxlength: 40, autocapitalize: 'none', spellcheck: 'false' });
            const results = h('div', { class: 'people' });
            let seq = 0;
            input.oninput = async () => {
                const q = input.value.trim();
                const mine = ++seq;
                if (!q) return fill(results);
                try {
                    const people = (await app.backend.searchUsers(q)).filter((p) => p.id !== app.me.id);
                    if (mine !== seq) return;
                    fill(
                        results,
                        people.length
                            ? people.map((p) =>
                                  h('a', { class: 'person person-link', href: `#/dm/${p.username}` }, avatar(p, 'md', p.avatar_url), personName(p))
                              )
                            : h('p', { class: 'muted pad', text: `No one matches "${q}".` })
                    );
                } catch (e) {
                    fill(results, h('p', { class: 'form-error', text: errorText(e) }));
                }
            };
            body.append(h('label', { class: 'search-box' }, icon('search'), input), results);
        },
        { tall: true }
    );
}

/** Admins and the owner: post FurZone news (it also goes to Discord if the bridge is set up). */
function announce(onDone) {
    sheet('Post an announcement', (body, close) => {
        const title = h('input', { type: 'text', maxlength: 200, placeholder: 'Title' });
        const text = h('textarea', { maxlength: 4000, rows: 5, placeholder: 'What do people need to know?' });
        const link = h('input', { type: 'text', maxlength: 500, placeholder: 'https://… (optional)', autocapitalize: 'none' });
        const send = h('button', { class: 'btn primary block', text: 'Post' });
        send.onclick = () =>
            withBusy(send, async () => {
                if (!title.value.trim()) return toast('Give it a title.', 'error');
                if (link.value.trim() && !/^https:\/\//.test(link.value.trim())) return toast('Links must start with https://', 'error');
                try {
                    await app.backend.postAnnouncement(title.value.trim(), text.value.trim(), link.value.trim());
                    toast('Announcement posted', 'success');
                    close();
                    onDone && onDone();
                } catch (e) {
                    toast(errorText(e), 'error');
                }
            });
        const field = (label, input) => h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), input);
        body.append(field('Title', title), field('Message', text), field('Link', link), send);
    });
}

export { compactCount };
