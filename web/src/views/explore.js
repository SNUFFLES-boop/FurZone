import { h, icon, avatar, emptyState, toast, errorText, withBusy, spinner, fill } from '../ui.js';
import { compactCount, hueOf } from '../format.js';
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

const SORTS = [
    ['trending', 'Trending', 'flame'],
    ['popular', 'Popular', 'heart'],
    ['viewed', 'Most viewed', 'eye'],
    ['newest', 'Newest', 'clock']
];
const RANGES = [
    ['day', 'Today'],
    ['week', 'This week'],
    ['month', 'This month'],
    ['all', 'All time']
];
const TYPES = [
    ['all', 'Everything', 'sparkles'],
    ['image', 'Pictures', 'image'],
    ['video', 'Videos', 'video'],
    ['text', 'Text', 'comment']
];
const PAGE = 24;
// Remembered while the app is open, so going back to Explore keeps your choice.
const picks = { sort: 'trending', range: 'week', type: 'all' };

/** A square-ish preview of a post with its hearts and views; the top three get a rank. */
export function postTile(post, i, { rank = false } = {}) {
    return h(
        'a',
        { class: 'tile', href: `#/p/${post.id}`, 'aria-label': post.caption.slice(0, 80) || 'Post', style: { '--i': String(Math.min(i, 14)) } },
        post.media_type === 'image'
            ? h('img', { src: post.media_url, alt: '', loading: 'lazy' })
            : post.media_type === 'video'
              ? [h('video', { src: post.media_url + '#t=0.1', muted: true, preload: 'metadata', playsinline: true }), h('span', { class: 'tile-badge' }, icon('video'))]
              : h('span', { class: 'tile-text', style: { '--h': String(hueOf(post.user.username + post.id)) }, text: post.caption.slice(0, 90) }),
        rank && i < 3 && h('span', { class: 'tile-rank rank-' + (i + 1), text: '#' + (i + 1) }),
        h(
            'span',
            { class: 'tile-stats' },
            h('span', null, icon('heart'), compactCount(post.boops)),
            post.views ? h('span', null, icon('eye'), compactCount(post.views)) : null
        )
    );
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
    const trending = h('div', { class: 'tag-row' }, spinner());
    const suggestions = h('div', { class: 'people' });
    const sortRow = h('div', { class: 'pill-tabs', role: 'tablist', 'aria-label': 'Sort posts' });
    const rangeRow = h('div', { class: 'filter-row', 'aria-label': 'Time' });
    const typeRow = h('div', { class: 'filter-row', 'aria-label': 'Kind of post' });
    const grid = h('div', { class: 'grid discover' });
    const more = h('button', { class: 'btn ghost block load-more', text: 'Show more', hidden: true });
    let alive = true;
    let offset = 0;
    let loadSeq = 0;

    let seq = 0;
    let timer = 0;
    input.oninput = () => {
        clearTimeout(timer);
        const q = input.value.trim();
        if (!q) return fill(results);
        if (q.startsWith('#')) {
            const t = q.slice(1).toLowerCase().replace(/[^a-z0-9_]/g, '');
            return fill(results, t ? h('a', { class: 'tag-jump', href: `#/explore/tag/${t}` }, icon('hash'), `See posts tagged #${t}`) : '');
        }
        const mine = ++seq;
        fill(results, spinner());
        timer = setTimeout(async () => {
            try {
                const people = await app.backend.searchUsers(q);
                if (mine !== seq) return;
                fill(results, 
                    ...(people.length ? people.map((p) => personRow(p)) : [h('p', { class: 'muted pad', text: `No one matches "${q}".` })])
                );
            } catch (e) {
                if (mine === seq) fill(results, h('p', { class: 'form-error', text: errorText(e) }));
            }
        }, 300);
    };

    function chip(list, key, row, withIcons) {
        fill(row, 
            ...list.map(([v, label, ic]) =>
                h(
                    'button',
                    {
                        class: 'filter-chip' + (picks[key] === v ? ' on' : ''),
                        role: key === 'sort' ? 'tab' : null,
                        'aria-selected': key === 'sort' ? String(picks[key] === v) : null,
                        'aria-pressed': key === 'sort' ? null : String(picks[key] === v),
                        onclick: () => {
                            if (picks[key] === v) return;
                            picks[key] = v;
                            drawControls();
                            load(true);
                        }
                    },
                    withIcons && ic ? icon(ic) : null,
                    label
                )
            )
        );
    }

    function drawControls() {
        chip(SORTS, 'sort', sortRow, true);
        chip(RANGES, 'range', rangeRow, false);
        chip(TYPES, 'type', typeRow, true);
        rangeRow.hidden = picks.sort === 'newest';
    }

    async function load(reset) {
        const mine = ++loadSeq;
        if (reset) {
            offset = 0;
            fill(grid, spinner());
            more.hidden = true;
        }
        try {
            const range = picks.sort === 'newest' ? 'all' : picks.range;
            const posts = await app.backend.explore({ sort: picks.sort, range, type: picks.type, offset, limit: PAGE });
            if (!alive || mine !== loadSeq) return;
            if (reset) fill(grid);
            const start = offset;
            grid.append(...posts.map((p, i) => postTile(p, start + i, { rank: picks.sort !== 'newest' })));
            offset += posts.length;
            more.hidden = posts.length < PAGE;
            if (!grid.children.length) {
                fill(grid, 
                    emptyState(
                        'sparkles',
                        'Nothing here yet',
                        picks.range === 'day' && picks.sort !== 'newest' ? 'Nothing posted today. Try "This week" or "All time".' : 'Try another filter, or be the first to post!'
                    )
                );
            }
        } catch (e) {
            if (alive && mine === loadSeq) fill(grid, h('p', { class: 'form-error', text: errorText(e) }));
        }
    }
    more.onclick = () => withBusy(more, () => load(false));

    view.append(
        h(
            'div',
            { class: 'page explore' },
            h('h1', { class: 'page-title', text: 'Explore' }),
            h('label', { class: 'search-box' }, icon('search'), input),
            results,
            h('h2', { class: 'section-title' }, icon('hash'), 'Trending tags'),
            trending,
            h('h2', { class: 'section-title' }, icon('sparkles'), 'Discover'),
            sortRow,
            h('div', { class: 'filters' }, typeRow, rangeRow),
            grid,
            more,
            h('h2', { class: 'section-title' }, icon('paw'), 'Furs to follow'),
            suggestions
        )
    );
    drawControls();
    load(true);

    app.backend
        .trendingTags()
        .then((tags) =>
            fill(trending, 
                ...(tags.length
                    ? tags.map((t, i) =>
                          h('a', { class: 'tag-chip', href: `#/explore/tag/${t.tag}`, style: { '--i': String(i) } }, h('span', { text: '#' + t.tag }), h('small', { text: String(t.uses) }))
                      )
                    : [h('p', { class: 'muted', text: 'Tags people use this week show up here.' })])
            )
        )
        .catch((e) => fill(trending, h('p', { class: 'form-error', text: errorText(e) })));

    // A few active people from the feed you don't follow yet.
    app.backend
        .feed({ scope: 'all', limit: 30 })
        .then(async (posts) => {
            const seenIds = new Set([app.me.id]);
            const people = [];
            for (const p of posts) {
                if (seenIds.has(p.user.id) || p.following) continue;
                seenIds.add(p.user.id);
                people.push(p.user);
            }
            const full = (await Promise.all(people.slice(0, 6).map((u) => app.backend.profileByUsername(u.username)))).filter(Boolean);
            if (!alive) return;
            fill(suggestions, 
                ...(full.length ? full.map((p) => personRow(p)) : [h('p', { class: 'muted', text: "You're following everyone who's posted. Nice!" })])
            );
        })
        .catch(() => fill(suggestions));

    return () => (alive = false);
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
