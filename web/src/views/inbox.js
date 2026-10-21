import { h, icon, avatar, emptyState, errorText, spinner, withBusy } from '../ui.js';
import { app } from '../state.js';
import { timeAgo, hueOf } from '../format.js';

const TEXT = {
    boop: ['paw', 'booped your post'],
    comment: ['comment', 'commented on your post'],
    follow: ['user', 'started following you']
};

export function renderInbox(view, ctx) {
    const list = h('div', { class: 'inbox' }, spinner());
    view.append(h('div', { class: 'page' }, h('h1', { class: 'page-title', text: 'Inbox' }), list));

    async function load() {
        try {
            const items = await app.backend.notifications();
            if (!list.isConnected) return;
            if (!items.length) {
                const demo =
                    app.backend.kind === 'demo' &&
                    h('button', {
                        class: 'btn ghost',
                        text: 'Show me what it looks like',
                        onclick: (e) =>
                            withBusy(e.currentTarget, async () => {
                                await app.backend.demoActivity();
                                await load();
                            })
                    });
                list.replaceChildren(emptyState('bell', 'All quiet', 'Boops, comments and new followers show up here.', demo));
                return;
            }
            list.replaceChildren(...items.map(row));
            if (items.some((n) => !n.read)) {
                await app.backend.markNotificationsRead();
                ctx.setUnread(0);
            }
        } catch (e) {
            list.replaceChildren(h('p', { class: 'form-error', text: errorText(e) }));
        }
    }

    function row(n) {
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

    load();
}
