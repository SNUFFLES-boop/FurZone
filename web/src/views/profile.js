import { h, icon, avatar, emptyState, toast, errorText, withBusy, field, sheet, spinner, confirmDialog } from '../ui.js';
import { app, refreshMe } from '../state.js';
import { compactCount, hueOf, validUsername, prepareImage, mediaKind } from '../format.js';
import { captionNode, badges } from './postcard.js';
import { connectionsSection } from './connect.js';
import { openExternal } from '../platform.js';
import { roleBadge, myRank, outranks, staffTools, staffStrip } from '../staff.js';

export function renderProfile(view, ctx, username) {
    const page = h('div', { class: 'page profile' }, spinner());
    view.append(page);
    let alive = true;

    async function load() {
        try {
            const p = username === app.me.username ? await refreshMe() : await app.backend.profileByUsername(username);
            if (!alive) return;
            if (!p) {
                page.replaceChildren(emptyState('user', 'No one here', `There's no @${username} on FurZone.`));
                return;
            }
            draw(p);
        } catch (e) {
            page.replaceChildren(h('p', { class: 'form-error pad', text: errorText(e) }));
        }
    }

    function draw(p) {
        const isMe = p.id === app.me.id;
        const hue = hueOf(p.username);
        const banner = h('div', { class: 'banner', style: { '--h': String(hue) } }, p.banner_url && h('img', { src: p.banner_url, alt: '' }));
        const actions = h('div', { class: 'profile-actions' });
        if (isMe) {
            actions.append(
                h('button', { class: 'btn ghost', onclick: () => editProfile(p, load) }, icon('edit'), 'Edit profile'),
                h('a', { class: 'icon-btn ghost-btn', href: '#/settings', 'aria-label': 'Settings' }, icon('settings'))
            );
        } else {
            const follow = h('button', { class: 'btn primary', text: 'Follow' });
            app.backend
                .isFollowing(p.id)
                .then((on) => on && (follow.textContent = 'Following', follow.className = 'btn ghost'))
                .catch(() => {});
            follow.onclick = () =>
                withBusy(follow, async () => {
                    const on = follow.textContent === 'Following';
                    try {
                        await (on ? app.backend.unfollow(p.id) : app.backend.follow(p.id));
                        follow.textContent = on ? 'Follow' : 'Following';
                        follow.className = on ? 'btn primary' : 'btn ghost';
                        followers.textContent = compactCount((p.followers_count += on ? -1 : 1));
                    } catch (e) {
                        toast(errorText(e), 'error');
                    }
                });
            actions.append(
                follow,
                h('button', { class: 'icon-btn ghost-btn', 'aria-label': 'More', onclick: () => profileMenu(p, ctx, load) }, icon('more'))
            );
        }
        const followers = h('strong', { text: compactCount(p.followers_count) });
        const chips = [p.species && h('span', { class: 'pill' }, icon('paw'), p.species), p.pronouns && h('span', { class: 'pill', text: p.pronouns })].filter(Boolean);

        const grid = h('div', { class: 'grid' }, spinner());
        const conns = h('div', { class: 'profile-conns' });
        page.replaceChildren(
            banner,
            h(
                'div',
                { class: 'profile-head' },
                h('div', { class: 'profile-avatar' }, avatar(p, 'xl', p.avatar_url)),
                actions
            ),
            h(
                'div',
                { class: 'profile-id' },
                h('h1', null, h('span', { text: p.display_name || p.username }), badges(p.connections, 'md'), roleBadge(p.role, 'md')),
                h('p', { class: 'handle', text: '@' + p.username }),
                chips.length ? h('div', { class: 'pills' }, chips) : null,
                p.bio && captionNode(p.bio, 'bio'),
                conns
            ),
            !isMe && myRank() >= 1 && staffStrip(p, load),
            h(
                'div',
                { class: 'stats' },
                h('span', null, h('strong', { text: compactCount(p.posts_count) }), ' posts'),
                h('span', null, followers, ' followers'),
                h('span', null, h('strong', { text: compactCount(p.following_count) }), ' following')
            ),
            p.ref_url &&
                h(
                    'button',
                    { class: 'ref-card', onclick: () => viewImage(p.ref_url, `${p.display_name || p.username}'s ref sheet`) },
                    h('img', { src: p.ref_url, alt: '' }),
                    h('span', null, icon('palette'), 'Ref sheet')
                ),
            grid
        );

        app.backend
            .connections(p.id)
            .then((list) => {
                const items = list.map((c) =>
                    c.provider === 'vrchat'
                        ? h(
                              'button',
                              { class: 'conn-line vrchat', onclick: () => openExternal(`https://vrchat.com/home/user/${c.external_id}`) },
                              icon('vrchat'),
                              h('span', null, 'VRChat · ', h('strong', { text: c.handle || 'connected' })),
                              icon('shieldCheck', 'verified')
                          )
                        : h('span', { class: 'conn-line discord' }, icon('discord'), h('span', null, 'Discord · ', h('strong', { text: c.handle || 'connected' })), icon('shieldCheck', 'verified'))
                );
                conns.replaceChildren(...items);
            })
            .catch(() => {});

        app.backend
            .userPosts(p.id)
            .then((posts) => {
                grid.replaceChildren(
                    ...(posts.length
                        ? posts.map((post) =>
                              h(
                                  'a',
                                  { class: 'tile', href: `#/p/${post.id}`, 'aria-label': post.caption.slice(0, 80) || 'Post' },
                                  post.media_type === 'image'
                                      ? h('img', { src: post.media_url, alt: '', loading: 'lazy' })
                                      : post.media_type === 'video'
                                        ? [h('video', { src: post.media_url + '#t=0.1', muted: true, preload: 'metadata', playsinline: true }), h('span', { class: 'tile-badge' }, icon('video'))]
                                        : h('span', { class: 'tile-text', style: { '--h': String(hueOf(post.user.username + post.id)) }, text: post.caption.slice(0, 90) }),
                                  h('span', { class: 'tile-boops' }, icon('heart'), compactCount(post.boops))
                              )
                          )
                        : [emptyState('image', isMe ? 'Your first post goes here' : 'No posts yet', '', isMe && h('a', { class: 'btn primary', href: '#/new', text: 'Create a post' }))])
                );
            })
            .catch((e) => grid.replaceChildren(h('p', { class: 'form-error', text: errorText(e) })));
    }

    load();
    return () => (alive = false);
}

function viewImage(url, label) {
    sheet(label, h('img', { class: 'full-image', src: url, alt: label }), { tall: true });
}

function profileMenu(p, ctx, reload) {
    sheet(`@${p.username}`, (body, close) => {
        if (myRank() >= 1 && outranks(p.role, p.id)) {
            body.append(
                h('button', { class: 'menu-item', onclick: () => (close(), staffTools(p, reload)) }, icon('shieldCheck'), h('span', { text: 'Staff tools' }))
            );
        }
        body.append(
            h(
                'button',
                {
                    class: 'menu-item danger',
                    onclick: async () => {
                        close();
                        if (!(await confirmDialog(`Block @${p.username}?`, "You won't see each other's posts or comments, and they can't follow or boop you.", { ok: 'Block', danger: true }))) return;
                        try {
                            await app.backend.block(p.id);
                            toast(`Blocked @${p.username}`, 'success');
                            ctx.go('#/home');
                        } catch (e) {
                            toast(errorText(e), 'error');
                        }
                    }
                },
                icon('ban'),
                h('span', { text: `Block @${p.username}` })
            )
        );
    });
}

export function editProfile(p, onSaved) {
    sheet(
        'Edit profile',
        (body, close) => {
            const display = h('input', { type: 'text', maxlength: 40, value: p.display_name });
            const user = h('input', { type: 'text', maxlength: 20, value: p.username, autocapitalize: 'none', spellcheck: 'false' });
            const species = h('input', { type: 'text', maxlength: 40, value: p.species, placeholder: 'Red fox, protogen, dragon…' });
            const pronouns = h('input', { type: 'text', maxlength: 24, value: p.pronouns, placeholder: 'they/them' });
            const bio = h('textarea', { maxlength: 300, rows: 4, placeholder: 'Tell the pack about yourself' });
            bio.value = p.bio;
            user.oninput = () => (user.value = user.value.toLowerCase().replace(/[^a-z0-9_]/g, ''));

            const imageButton = (kind, label, current) => {
                const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
                const btn = h(
                    'button',
                    { type: 'button', class: 'image-pick ' + kind, onclick: () => input.click() },
                    current ? h('img', { src: current, alt: '' }) : icon(kind === 'avatar' ? 'user' : 'image'),
                    h('span', { text: label })
                );
                input.onchange = () =>
                    withBusy(btn, async () => {
                        const f = input.files && input.files[0];
                        if (!f) return;
                        try {
                            mediaKind(f);
                            const sizes = { avatar: 640, banner: 1600, ref: 2400 };
                            const ready = await prepareImage(f, sizes[kind]);
                            await app.backend.uploadImage(kind, ready);
                            btn.querySelector('img, svg').replaceWith(h('img', { src: URL.createObjectURL(ready), alt: '' }));
                            toast('Updated', 'success');
                            onSaved && onSaved();
                        } catch (e) {
                            toast(errorText(e), 'error');
                        }
                    });
                return [btn, input];
            };

            const save = h('button', { class: 'btn primary block', text: 'Save' });
            save.onclick = () =>
                withBusy(save, async () => {
                    if (!validUsername(user.value)) return toast('Usernames are 3–20 letters, numbers or _.', 'error');
                    try {
                        await app.backend.updateProfile({
                            display_name: display.value.trim(),
                            username: user.value,
                            species: species.value.trim(),
                            pronouns: pronouns.value.trim(),
                            bio: bio.value.trim()
                        });
                        await refreshMe();
                        close();
                        toast('Profile saved', 'success');
                        if (location.hash !== `#/u/${app.me.username}`) location.hash = `#/u/${app.me.username}`;
                        else onSaved && onSaved();
                    } catch (e) {
                        toast(errorText(e), 'error');
                    }
                });

            body.append(
                h('div', { class: 'image-row' }, imageButton('avatar', 'Avatar', p.avatar_url), imageButton('banner', 'Banner', p.banner_url), imageButton('ref', 'Ref sheet', p.ref_url)),
                field('Display name', display),
                field('Username', h('div', { class: 'input-wrap' }, h('span', { class: 'prefix', text: '@' }), user)),
                h('div', { class: 'row gap' }, field('Species', species), field('Pronouns', pronouns)),
                field('Bio', bio),
                h('h3', { class: 'sub-title', text: 'Connected accounts' }),
                connectionsSection(onSaved),
                save
            );
        },
        { tall: true }
    );
}
