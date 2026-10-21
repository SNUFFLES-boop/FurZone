// Your followers and who you follow (only you can see these lists), and Insights: how your posts are doing.
import { h, icon, avatar, emptyState, errorText, spinner, toast, sheet, confirmDialog, segmented, fill, withBusy } from '../ui.js';
import { app } from '../state.js';
import { compactCount, timeAgo } from '../format.js';
import { personRow } from './explore.js';

/** The Followers / Following lists, with search, "Remove" for your followers, and Follow back. */
export function openFollowLists(p, which = 'followers', onChange) {
    const isMe = p.id === app.me.id;
    let current = which;
    let rows = [];
    let changed = false;
    sheet(
        isMe ? 'Your people' : `@${p.username}`,
        (body) => {
            const tabs = h('div');
            const search = h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search this list', maxlength: 40, autocapitalize: 'none', spellcheck: 'false' });
            const list = h('div', { class: 'people follow-list' }, spinner());
            const drawTabs = () =>
                fill(
                    tabs,
                    segmented(
                        [
                            ['followers', `Followers · ${compactCount(p.followers_count)}`],
                            ['following', `Following · ${compactCount(p.following_count)}`]
                        ],
                        current,
                        (v) => {
                            current = v;
                            drawTabs();
                            load();
                        },
                        'Followers or following'
                    )
                );
            function draw() {
                const q = search.value.trim().toLowerCase();
                const shown = q ? rows.filter((r) => (r.user.username + ' ' + (r.user.display_name || '') + ' ' + (r.user.species || '')).toLowerCase().includes(q)) : rows;
                if (!rows.length) {
                    return fill(
                        list,
                        emptyState(
                            current === 'followers' ? 'user' : 'compass',
                            current === 'followers' ? 'No followers yet' : 'Not following anyone yet',
                            current === 'followers' ? 'When someone follows you, they show up here.' : 'Find furs to follow in Explore.'
                        )
                    );
                }
                fill(
                    list,
                    shown.length ? shown.map(row) : h('p', { class: 'muted pad', text: `No one matches "${q}".` })
                );
            }
            function row(r) {
                const el = personRow(r.user);
                el.querySelector('.name-sub')?.append(` · ${timeAgo(r.created_at)}`);
                if (isMe && current === 'followers') {
                    const remove = h('button', { class: 'chip-btn', text: 'Remove' });
                    remove.onclick = async () => {
                        if (!(await confirmDialog(`Remove @${r.user.username}?`, "They stop following you. They aren't told, and they can follow you again (unless your account is private).", { ok: 'Remove' }))) return;
                        await withBusy(remove, async () => {
                            try {
                                await app.backend.removeFollower(r.user.id);
                                rows = rows.filter((x) => x !== r);
                                p.followers_count = Math.max(0, p.followers_count - 1);
                                changed = true;
                                drawTabs();
                                draw();
                                toast(`Removed @${r.user.username}`, 'success');
                            } catch (e) {
                                toast(errorText(e), 'error');
                            }
                        });
                    };
                    el.append(remove);
                }
                return el;
            }
            async function load() {
                fill(list, spinner());
                try {
                    rows = await (current === 'followers' ? app.backend.followers(p.id) : app.backend.following(p.id));
                    draw();
                } catch (e) {
                    fill(list, h('p', { class: 'form-error', text: errorText(e) }));
                }
            }
            search.oninput = draw;
            drawTabs();
            body.append(
                tabs,
                h('label', { class: 'search-box follow-search' }, icon('search'), search),
                list,
                isMe && h('p', { class: 'fine muted', text: 'Only you can see these lists. Others just see the numbers.' })
            );
            load();
        },
        { tall: true, onClose: () => changed && onChange && onChange() }
    );
}

/** Insights on your own profile: totals, this week, your top post and your biggest fans. */
export async function renderInsights(box, p, tile) {
    const [s, top] = await Promise.all([app.backend.myInsights(), app.backend.userPopular(p.id).then((list) => list[0] || null)]);
    const card = (ic, label, value, sub, onclick) =>
        h(
            onclick ? 'button' : 'div',
            { class: 'insight-card', onclick },
            h('span', { class: 'insight-icon' }, icon(ic)),
            h('strong', { text: compactCount(value) }),
            h('span', { class: 'insight-label', text: label }),
            sub && h('span', { class: 'insight-sub', text: sub })
        );
    fill(
        box,
        h(
            'div',
            { class: 'insight-grid' },
            card('user', 'Followers', s.followers, s.followers_week ? `+${s.followers_week} this week` : null, () => openFollowLists(p, 'followers')),
            card('heart', 'Hearts', s.hearts, s.hearts_week ? `+${s.hearts_week} this week` : null),
            card('eye', 'Views', s.views, null),
            card('comment', 'Comments', s.comments, null)
        ),
        top &&
            top.boops > 0 &&
            h(
                'section',
                { class: 'insight-section' },
                h('h3', { class: 'section-title' }, icon('flame'), 'Your most popular post'),
                h('div', { class: 'insight-top' }, tile(top), h('div', { class: 'insight-top-text' }, h('p', { text: top.caption ? top.caption.slice(0, 140) : 'Untitled' }), h('p', { class: 'muted' }, `${compactCount(top.boops)} hearts · ${compactCount(top.views || 0)} views · ${compactCount(top.comments || 0)} comments`)))
            ),
        h(
            'section',
            { class: 'insight-section' },
            h('h3', { class: 'section-title' }, icon('sparkles'), 'Your biggest fans'),
            h('p', { class: 'muted small', text: 'Who hearted and commented on your posts the most in the last 30 days.' }),
            s.top_fans.length
                ? h(
                      'div',
                      { class: 'people' },
                      s.top_fans.map((f, i) =>
                          h(
                              'a',
                              { class: 'person person-link fan-row', href: `#/u/${f.username}` },
                              h('span', { class: 'fan-rank', text: String(i + 1) }),
                              avatar(f, 'md', f.avatar_url),
                              h('span', { class: 'name-line' }, h('strong', { text: f.display_name || f.username }), h('span', { class: 'name-sub', text: '@' + f.username })),
                              h('span', { class: 'fan-count' }, icon('heart'), compactCount(f.n))
                          )
                      )
                  )
                : h('p', { class: 'muted', text: 'No fans yet. Post something and share it!' })
        ),
        h('button', { class: 'btn ghost block', onclick: () => openFollowLists(p, 'followers') }, icon('user'), 'See all your followers')
    );
}
