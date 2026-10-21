// Staff ranks and tools: owner > admin > mod > staff. The database enforces every rule (supabase/schema.sql);
// this file only shows the buttons that will work for the person using the app.
import { h, icon, avatar, toast, errorText, withBusy, field, sheet, confirmDialog, spinner, segmented, emptyState, clear, fill } from './ui.js';
import { app } from './state.js';
import { timeAgo } from './format.js';
import { logo } from './icons.js';

export const RANK = { owner: 4, admin: 3, mod: 2, staff: 1 };
export const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', mod: 'Mod', staff: 'Staff' };
export const rankOf = (role) => RANK[role] || 0;
export const myRank = () => rankOf(app.me && app.me.role);
/** Can I use staff tools on this person? Only on people ranked below me, never on myself. */
export const outranks = (role, userId) => myRank() > rankOf(role) && !!app.me && userId !== app.me.id;

export function roleBadge(role, size = 'sm') {
    if (!RANK[role]) return null;
    return h(
        'span',
        { class: `role-badge role-${role} role-${size}`, title: `FurZone ${ROLE_LABEL[role]}`, 'aria-label': `FurZone ${ROLE_LABEL[role]}` },
        icon('shieldCheck'),
        h('span', { text: ROLE_LABEL[role] })
    );
}

/** A restriction that is still in force, or null. */
export function activeRestriction(r) {
    return r && (!r.until || Date.parse(r.until) > Date.now()) ? r : null;
}

const FEATURES = [
    ['no_posting', 'Posting'],
    ['no_comments', 'Comments'],
    ['no_uploads', 'Picture & video uploads'],
    ['no_profile_edits', 'Profile changes']
];

function untilText(r) {
    return r.until ? `until ${new Date(r.until).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'with no end date';
}

/** One line describing a restriction, e.g. "Posting and Comments turned off until Oct 30". */
export function restrictionText(r) {
    if (!activeRestriction(r)) return '';
    if (r.banned) return `Banned ${untilText(r)}`;
    const off = FEATURES.filter(([k]) => r[k]).map(([, label]) => label);
    return `${off.join(', ')} turned off ${untilText(r)}`;
}

const NO_LIMITS = { banned: false, no_posting: false, no_comments: false, no_uploads: false, no_profile_edits: false, days: null, reason: '' };

/** Unban / lift every limit, with a confirmation toast. Returns true when it worked. */
export async function liftAll(p) {
    try {
        await app.backend.staffRestrict(p.id, NO_LIMITS);
        toast(`@${p.username} has no limits now`, 'success');
        return true;
    } catch (e) {
        toast(errorText(e), 'error');
        return false;
    }
}

/** For staff on someone's profile: shows a ban or limits, with Unban and Staff tools right there. */
export function staffStrip(p, reload) {
    const strip = h('div', { class: 'staff-strip', hidden: true });
    app.backend
        .staffRestriction(p.id)
        .then((r) => {
            r = activeRestriction(r);
            if (!r) return;
            const canEdit = myRank() >= 2 && outranks(p.role, p.id);
            const lift = canEdit && h('button', { class: 'chip-btn ok', text: r.banned ? 'Unban' : 'Lift limits' });
            if (lift) lift.onclick = () => withBusy(lift, async () => (await liftAll(p)) && reload && reload());
            fill(
                strip,
                icon('ban'),
                h('span', { class: 'grow' }, h('strong', { text: restrictionText(r) }), r.reason ? h('span', { class: 'muted', text: ` · “${r.reason}”` }) : null),
                lift,
                canEdit && h('button', { class: 'chip-btn ghost', text: 'Edit', onclick: () => staffTools(p, reload) })
            );
            strip.hidden = false;
        })
        .catch(() => {});
    return strip;
}

// ---------------------------------------------------------------- the banned screen

export function renderBanned(root, me, signOut) {
    const r = me.restriction;
    root.append(
        h(
            'div',
            { class: 'banned' },
            logo(72),
            h('h1', { text: 'Your account is banned' }),
            h('p', { class: 'muted', text: r.until ? `You can come back ${untilText(r).replace('until ', 'on ')}.` : 'This ban has no end date.' }),
            r.reason && h('p', { class: 'banned-reason' }, h('strong', { text: 'Reason: ' }), r.reason),
            h('p', { class: 'fine', text: 'If you think this is a mistake, contact the FurZone team.' }),
            h('button', { class: 'btn ghost', text: 'Log out', onclick: signOut })
        )
    );
}

// ---------------------------------------------------------------- staff tools for one person

export function staffTools(p, onChange) {
    sheet(
        `Staff tools · @${p.username}`,
        (body, close) => {
            const status = h('div', { class: 'staff-status' }, spinner());
            body.append(status);
            const mine = myRank();

            app.backend
                .staffRestriction(p.id)
                .then((r) => draw(activeRestriction(r)))
                .catch((e) => status.replaceChildren(h('p', { class: 'form-error', text: errorText(e) })));

            function draw(r) {
                status.replaceChildren(
                    h('div', { class: 'staff-who' }, avatar(p, 'md', p.avatar_url), h('span', { class: 'grow' }, h('strong', { text: p.display_name || p.username }), ' ', roleBadge(p.role))),
                    r
                        ? h('p', { class: 'staff-state warn' }, icon('ban'), h('span', null, restrictionText(r), r.reason ? ` · “${r.reason}”` : ''))
                        : h('p', { class: 'staff-state ok' }, icon('check'), 'No limits on this account.')
                );
                if (mine >= 2) body.append(limitsForm(r));
                else body.append(h('p', { class: 'muted', text: 'Staff can review reports and hide posts. Mods and above can limit or ban accounts.' }));
                if (mine >= 3) body.append(roleForm());
            }

            function limitsForm(r) {
                const box = (key, label, danger) => {
                    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch' });
                    input.checked = !!(r && r[key]);
                    return [h('label', { class: 'settings-item' + (danger ? ' danger' : '') }, h('span', { class: 'grow', text: label }), input), input];
                };
                const [banRow, ban] = box('banned', 'Ban the whole account', true);
                const rows = FEATURES.map(([k, label]) => box(k, `Turn off ${label.toLowerCase()}`));
                const days = h(
                    'select',
                    { class: 'select' },
                    [
                        ['1', '1 day'],
                        ['3', '3 days'],
                        ['7', '7 days'],
                        ['30', '30 days'],
                        ['365', '1 year'],
                        ['', 'No end date']
                    ].map(([v, t]) => h('option', { value: v, text: t }))
                );
                days.value = r && !r.until ? '' : '7';
                const reason = h('input', { type: 'text', maxlength: 300, placeholder: 'Why? (the person sees this)', value: (r && r.reason) || '' });
                const apply = h('button', { class: 'btn primary grow', text: 'Apply' });
                const lift = h('button', { class: 'btn ghost grow', text: 'Lift all', disabled: !r });
                const send = (lifting) =>
                    withBusy(lifting ? lift : apply, async () => {
                        const choice = {
                            banned: !lifting && ban.checked,
                            ...Object.fromEntries(FEATURES.map(([k], i) => [k, !lifting && rows[i][1].checked])),
                            days: days.value ? Number(days.value) : null,
                            reason: reason.value.trim()
                        };
                        const anything = choice.banned || FEATURES.some(([k]) => choice[k]);
                        if (!lifting && !anything) return toast('Pick at least one thing to turn off, or use Lift all.', 'error');
                        if (choice.banned && !(await confirmDialog(`Ban @${p.username}?`, 'They are logged out everywhere, and their posts and comments disappear for everyone but staff.', { ok: 'Ban', danger: true }))) return;
                        try {
                            await app.backend.staffRestrict(p.id, choice);
                            toast(lifting || !anything ? 'All limits lifted' : choice.banned ? `@${p.username} is banned` : 'Limits saved', 'success');
                            close();
                            onChange && onChange();
                        } catch (e) {
                            toast(errorText(e), 'error');
                        }
                    });
                apply.onclick = () => send(false);
                lift.onclick = () => send(true);
                return h(
                    'section',
                    { class: 'staff-section' },
                    h('h3', { class: 'sub-title', text: 'Limits & bans' }),
                    h('div', { class: 'settings-card' }, banRow, rows.map(([row]) => row)),
                    h('div', { class: 'row gap' }, field('For how long', days), field('Reason', reason)),
                    mine < 3 && h('p', { class: 'fine', text: 'Mods can ban for up to 30 days. Longer bans need an admin.' }),
                    h('div', { class: 'row gap' }, lift, apply)
                );
            }

            function roleForm() {
                const options = [
                    ['', 'Member (no rank)'],
                    ['staff', 'Staff'],
                    ['mod', 'Mod']
                ];
                if (mine >= 4) options.push(['admin', 'Admin']);
                const select = h('select', { class: 'select' }, options.map(([v, t]) => h('option', { value: v, text: t })));
                select.value = p.role || '';
                const save = h('button', { class: 'btn ghost', text: 'Save rank' });
                save.onclick = () =>
                    withBusy(save, async () => {
                        try {
                            await app.backend.staffSetRole(p.id, select.value || null);
                            toast(select.value ? `@${p.username} is now ${ROLE_LABEL[select.value]}` : `@${p.username} has no rank now`, 'success');
                            close();
                            onChange && onChange();
                        } catch (e) {
                            toast(errorText(e), 'error');
                        }
                    });
                return h(
                    'section',
                    { class: 'staff-section' },
                    h('h3', { class: 'sub-title', text: 'Rank' }),
                    h('p', { class: 'fine', text: 'Staff review reports and hide posts. Mods also delete posts and limit or ban accounts. Admins also manage ranks.' }),
                    h('div', { class: 'row gap' }, select, save)
                );
            }
        },
        { tall: true }
    );
}

// ---------------------------------------------------------------- the Staff page

export function renderStaffPage(view, ctx, tab = 'reports') {
    if (myRank() < 1) {
        view.append(emptyState('shield', 'Staff only', 'This page is for the FurZone team.'));
        return null;
    }
    let alive = true;
    const tabs = [
        ['reports', 'Reports'],
        ['limited', 'Bans'],
        ['team', 'Team']
    ];
    if (myRank() >= 3) tabs.push(['log', 'Log']);
    if (!tabs.some(([t]) => t === tab)) tab = 'reports';
    const body = h('div', { class: 'staff-body' });
    view.append(
        h(
            'div',
            { class: 'page staff' },
            h('h1', { class: 'page-title' }, icon('shieldCheck'), 'Staff', roleBadge(app.me.role, 'md')),
            segmented(tabs, tab, (t) => ctx.go(`#/staff/${t}`), 'Staff'),
            body
        )
    );

    const load = (promise, render, empty) => {
        body.replaceChildren(spinner());
        promise
            .then((items) => alive && body.replaceChildren(...(items.length ? items.map(render) : [empty])))
            .catch((e) => alive && body.replaceChildren(h('p', { class: 'form-error pad', text: errorText(e) })));
    };

    if (tab === 'reports') load(app.backend.staffReports(), reportCard, emptyState('check', 'All clear', 'No reported posts right now.'));
    else if (tab === 'limited') load(app.backend.staffLimited(), limitedRow, emptyState('check', 'Nobody is banned or limited', ''));
    else if (tab === 'team') load(app.backend.staffTeam(), teamRow, emptyState('user', 'No team yet', ''));
    else load(app.backend.staffLog(), logRow, emptyState('shield', 'Nothing logged yet', ''));

    if (tab === 'team' && myRank() >= 3) {
        view.querySelector('.staff').append(h('p', { class: 'fine center pad', text: 'To give someone a rank: open their profile → ⋯ → Staff tools.' }));
    }

    function reportCard(item) {
        const card = h('article', { class: 'report-card' + (item.post.hidden ? ' is-hidden' : '') });
        const act = (label, cls, fn) => {
            const b = h('button', { class: 'chip-btn ' + cls, text: label });
            b.onclick = () => withBusy(b, fn);
            return b;
        };
        const done = (msg) => {
            toast(msg, 'success');
            card.remove();
            if (!body.querySelector('.report-card')) body.replaceChildren(emptyState('check', 'All clear', 'No reported posts right now.'));
        };
        const run = (fn, msg) => async () => {
            try {
                await fn();
                done(msg);
            } catch (e) {
                toast(errorText(e), 'error');
            }
        };
        const hideBtn = act(item.post.hidden ? 'Show again' : 'Hide', 'ghost', async () => {
            try {
                await app.backend.staffSetHidden(item.post.id, !item.post.hidden);
                item.post.hidden = !item.post.hidden;
                hideBtn.textContent = item.post.hidden ? 'Show again' : 'Hide';
                card.classList.toggle('is-hidden', item.post.hidden);
                toast(item.post.hidden ? 'Post hidden' : 'Post visible again', 'success');
            } catch (e) {
                toast(errorText(e), 'error');
            }
        });
        card.append(
            h(
                'a',
                { class: 'report-who', href: `#/u/${item.user.username}` },
                avatar(item.user, 'sm', item.user.avatar_url),
                h('strong', { text: item.user.display_name || item.user.username }),
                h('span', { class: 'muted', text: '@' + item.user.username })
            ),
            h(
                'a',
                { class: 'report-post', href: `#/p/${item.post.id}` },
                item.post.media_type === 'image' && h('img', { src: item.post.media_url, alt: '', loading: 'lazy' }),
                item.post.media_type === 'video' && h('span', { class: 'report-video' }, icon('video')),
                h('span', { class: 'report-caption', text: item.post.caption || '(no caption)' })
            ),
            h(
                'p',
                { class: 'report-meta' },
                icon('flag'),
                h('strong', { text: `${item.reports} report${item.reports === 1 ? '' : 's'}` }),
                h('span', { text: ` · ${item.reasons.join(', ')} · ${timeAgo(item.last_report)}` }),
                item.post.hidden && h('span', { class: 'pill hidden-pill', text: 'Hidden' })
            ),
            h(
                'div',
                { class: 'report-actions' },
                act('Looks fine', 'ok', run(() => app.backend.staffDismiss(item.post.id), 'Reports cleared')),
                hideBtn,
                myRank() >= 2 &&
                    act('Delete', 'danger', async () => {
                        if (!(await confirmDialog('Delete this post?', 'It is removed for everyone, with its boops and comments.', { ok: 'Delete', danger: true }))) return;
                        await run(() => app.backend.staffDeletePost(item.post.id), 'Post deleted')();
                    })
            )
        );
        return card;
    }

    function limitedRow(x) {
        const r = x.restriction;
        const row = h('div', { class: 'report-card' });
        const canEdit = myRank() >= 2 && outranks(x.user.role, x.user.id);
        const lift = canEdit && h('button', { class: 'chip-btn ok', text: r.banned ? 'Unban' : 'Lift limits' });
        if (lift) {
            lift.onclick = () =>
                withBusy(lift, async () => {
                    if (await liftAll(x.user)) {
                        row.remove();
                        if (!body.querySelector('.report-card')) body.replaceChildren(emptyState('check', 'Nobody is banned or limited', ''));
                    }
                });
        }
        fill(
            row,
            h(
                'a',
                { class: 'report-who', href: `#/u/${x.user.username}` },
                avatar(x.user, 'sm', x.user.avatar_url),
                h('strong', { text: x.user.display_name || x.user.username }),
                h('span', { class: 'muted', text: '@' + x.user.username })
            ),
            h('p', { class: 'report-meta' }, icon('ban'), h('strong', { text: restrictionText(r) }), r.reason ? h('span', { text: ` · “${r.reason}”` }) : null),
            canEdit && h('div', { class: 'report-actions' }, lift, h('button', { class: 'chip-btn ghost', text: 'Edit', onclick: () => staffTools(x.user, () => ctx.go('#/staff/limited')) }))
        );
        return row;
    }

    function teamRow(m) {
        return h(
            'a',
            { class: 'person', href: `#/u/${m.user.username}` },
            avatar(m.user, 'md', m.user.avatar_url),
            h('span', { class: 'grow' }, h('strong', { text: m.user.display_name || m.user.username }), h('span', { class: 'muted', text: ' @' + m.user.username })),
            roleBadge(m.role)
        );
    }

    function logRow(e) {
        const who = (p) => (p ? '@' + p.username : 'someone');
        const d = e.details || {};
        const off = FEATURES.filter(([k]) => d[k]).map(([, l]) => l.toLowerCase());
        const span = d.days ? ` for ${d.days} day${d.days === 1 ? '' : 's'}` : '';
        const text = {
            set_role: `gave ${who(e.target)} the rank ${d.role ? ROLE_LABEL[d.role] : 'Member'}`,
            ban: `banned ${who(e.target)}${span || ' with no end date'}`,
            limit: `turned off ${off.join(', ') || 'features'} for ${who(e.target)}${span}`,
            lift: `lifted all limits on ${who(e.target)}`,
            hide_post: `hid a post by ${who(e.target)}`,
            unhide_post: `showed a post by ${who(e.target)} again`,
            delete_post: `deleted a post by ${who(e.target)}`,
            delete_comment: `deleted a comment by ${who(e.target)}`,
            dismiss_reports: `cleared the reports on a post by ${who(e.target)}`
        }[e.action] || e.action;
        return h(
            'div',
            { class: 'log-row' },
            avatar(e.actor || {}, 'sm', e.actor && e.actor.avatar_url),
            h(
                'p',
                { class: 'grow' },
                h('strong', { text: who(e.actor) }),
                ' ' + text,
                d.reason ? h('span', { class: 'muted', text: ` · “${d.reason}”` }) : null,
                h('span', { class: 'muted', text: ` · ${timeAgo(e.created_at)}` })
            )
        );
    }

    return () => {
        alive = false;
        clear(body);
    };
}
