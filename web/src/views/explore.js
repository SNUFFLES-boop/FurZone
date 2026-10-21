import { h, icon, avatar, emptyState, toast, errorText, withBusy, spinner } from '../ui.js';
import { app } from '../state.js';
import { nameLine } from './postcard.js';
import { slideList } from './feed.js';

export function personRow(p, { onOpen } = {}) {
    const isMe = p.id === app.me.id;
    const row = h(
        'div',
        { class: 'person' },
        h('a', { class: 'person-link', href: `#/u/${p.username}`, onclick: onOpen }, avatar(p, 'md', p.avatar_url), nameLine(p))
    );
    if (!isMe) {
        const btn = h('button', { class: 'chip-btn follow', text: 'Follow' });
        app.backend
            .isFollowing(p.id)
            .then((on) => {
                if (on) {
                    btn.textContent = 'Following';
                    btn.classList.add('on');
                }
            })
            .catch(() => {});
        btn.onclick = () =>
            withBusy(btn, async () => {
                const on = btn.classList.contains('on');
                try {
                    await (on ? app.backend.unfollow(p.id) : app.backend.follow(p.id));
                    btn.classList.toggle('on', !on);
                    btn.textContent = on ? 'Follow' : 'Following';
                } catch (e) {
                    toast(errorText(e), 'error');
                }
            });
        row.append(btn);
    }
    return row;
}

export function renderExplore(view, ctx, tag) {
    if (tag) return renderTag(view, tag);

    const input = h('input', {
        type: 'search',
        placeholder: 'Search furs by name or species',
        'aria-label': 'Search',
        maxlength: 40,
        autocapitalize: 'none',
        spellcheck: 'false'
    });
    const results = h('div', { class: 'results' });
    const trending = h('div', { class: 'tag-cloud' }, spinner());
    const suggestions = h('div', { class: 'people' });

    let seq = 0;
    let timer = 0;
    input.oninput = () => {
        clearTimeout(timer);
        const q = input.value.trim();
        if (!q) return results.replaceChildren();
        if (q.startsWith('#')) {
            const t = q.slice(1).toLowerCase().replace(/[^a-z0-9_]/g, '');
            return results.replaceChildren(t ? h('a', { class: 'tag-jump', href: `#/explore/tag/${t}` }, icon('hash'), `See posts tagged #${t}`) : '');
        }
        const mine = ++seq;
        results.replaceChildren(spinner());
        timer = setTimeout(async () => {
            try {
                const people = await app.backend.searchUsers(q);
                if (mine !== seq) return;
                results.replaceChildren(
                    ...(people.length ? people.map((p) => personRow(p)) : [h('p', { class: 'muted pad', text: `No one matches "${q}".` })])
                );
            } catch (e) {
                if (mine === seq) results.replaceChildren(h('p', { class: 'form-error', text: errorText(e) }));
            }
        }, 300);
    };

    view.append(
        h(
            'div',
            { class: 'page explore' },
            h('h1', { class: 'page-title', text: 'Explore' }),
            h('label', { class: 'search-box' }, icon('search'), input),
            results,
            h('h2', { class: 'section-title' }, icon('sparkles'), 'Trending tags'),
            trending,
            h('h2', { class: 'section-title' }, icon('paw'), 'Furs to follow'),
            suggestions
        )
    );

    app.backend
        .trendingTags()
        .then((tags) =>
            trending.replaceChildren(
                ...(tags.length
                    ? tags.map((t, i) =>
                          h('a', { class: 'tag-chip', href: `#/explore/tag/${t.tag}`, style: { '--i': String(i) } }, h('span', { text: '#' + t.tag }), h('small', { text: String(t.uses) }))
                      )
                    : [h('p', { class: 'muted', text: 'Tags people use this week show up here.' })])
            )
        )
        .catch((e) => trending.replaceChildren(h('p', { class: 'form-error', text: errorText(e) })));

    // A few active people from the feed you don't follow yet.
    app.backend
        .feed({ scope: 'all', limit: 30 })
        .then(async (posts) => {
            const seen = new Set([app.me.id]);
            const people = [];
            for (const p of posts) {
                if (seen.has(p.user.id) || p.following) continue;
                seen.add(p.user.id);
                people.push(p.user);
            }
            const full = (await Promise.all(people.slice(0, 6).map((u) => app.backend.profileByUsername(u.username)))).filter(Boolean);
            suggestions.replaceChildren(
                ...(full.length ? full.map((p) => personRow(p)) : [h('p', { class: 'muted', text: "You're following everyone who's posted. Nice!" })])
            );
        })
        .catch(() => suggestions.replaceChildren());
}

function renderTag(view, tag) {
    const clean = String(tag).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
    const body = h('div', { class: 'feed-body' });
    view.append(
        h(
            'div',
            { class: 'feed' },
            h(
                'header',
                { class: 'feed-head' },
                h('button', { class: 'icon-btn glass', 'aria-label': 'Back', onclick: () => history.back() }, icon('back')),
                h('span', { class: 'tag-title', text: '#' + clean }),
                h('span')
            ),
            body
        )
    );
    const list = slideList(body, (before) => app.backend.feed({ scope: 'all', before, limit: 6, tag: clean }), {
        empty: () => emptyState('hash', `No #${clean} posts yet`, 'Use the tag in a caption and yours will be the first.', h('a', { class: 'btn primary', href: '#/new', text: 'Create a post' }))
    });
    return () => list.destroy();
}
