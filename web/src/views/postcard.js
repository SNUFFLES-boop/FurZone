// One post, shown full-height: the media (or a colourful card for text posts), who posted it, the caption and
// the action rail. Used by the feed and the single-post page.
import { h, icon, avatar, toast, errorText, sheet, confirmDialog, withBusy, field } from '../ui.js';
import { captionParts, compactCount, timeAgo, hueOf } from '../format.js';
import { app, savePref } from '../state.js';
import { roleBadge, myRank, outranks, staffTools } from '../staff.js';

const REPORT_REASONS = ['Spam or scam', 'NSFW / not safe for work', 'Harassment or hate', 'Stolen art (no credit)', 'Something else'];

/** Caption text with tappable #tags and @mentions. Built from text nodes only. */
export function captionNode(text, cls = 'caption', tag = 'p') {
    return h(
        tag,
        { class: cls },
        captionParts(text).map((p) =>
            p.type === 'text' ? p.value : h('a', { class: p.type, href: p.type === 'tag' ? `#/explore/tag/${p.value}` : `#/u/${p.value}`, text: p.label })
        )
    );
}

export function badges(connections, size = 'sm') {
    if (!connections || !connections.length) return null;
    return h(
        'span',
        { class: 'conn-badges' },
        connections.includes('vrchat') &&
            h('span', { class: `conn conn-vrchat conn-${size}`, title: 'VRChat connected', 'aria-label': 'VRChat connected' }, icon('vrchat')),
        connections.includes('discord') &&
            h('span', { class: `conn conn-discord conn-${size}`, title: 'Discord connected', 'aria-label': 'Discord connected' }, icon('discord'))
    );
}

export function nameLine(user) {
    const sub = [user.species, user.pronouns].filter(Boolean).join(' · ');
    return h(
        'span',
        { class: 'name-line' },
        h('span', { class: 'name-top' }, h('strong', { text: user.display_name || user.username }), badges(user.connections), roleBadge(user.role)),
        h('span', { class: 'name-sub', text: sub ? `@${user.username} · ${sub}` : `@${user.username}` })
    );
}

function pawBurst(host, x, y) {
    const burst = h('span', { class: 'paw-burst', style: { left: x + 'px', top: y + 'px' } }, icon('paw'));
    for (let i = 0; i < 6; i++) burst.append(h('i', { style: { '--a': i * 60 + 'deg' } }));
    host.append(burst);
    setTimeout(() => burst.remove(), 900);
}

export function renderSlide(post, { onRemoved } = {}) {
    const isMine = post.user.id === app.me.id;
    const slide = h('article', { class: 'slide', dataset: { id: post.id } });

    // ---- media ----
    let media;
    let video = null;
    if (post.media_type === 'video') {
        video = h('video', {
            src: post.media_url,
            playsinline: true,
            loop: true,
            preload: 'metadata',
            class: 'slide-video'
        });
        video.muted = app.muted;
        media = h('div', { class: 'slide-media' }, video, h('div', { class: 'video-progress' }, h('span')));
        const bar = media.querySelector('.video-progress span');
        video.addEventListener('timeupdate', () => {
            if (video.duration) bar.style.transform = `scaleX(${video.currentTime / video.duration})`;
        });
    } else if (post.media_type === 'image') {
        // Art is never cropped: the picture fits the card, over a blurred copy of itself.
        media = h(
            'div',
            { class: 'slide-media' },
            h('img', { class: 'slide-backdrop', src: post.media_url, alt: '', 'aria-hidden': 'true', decoding: 'async' }),
            h('img', { class: 'slide-img', src: post.media_url, alt: post.caption ? post.caption.slice(0, 120) : `Post by ${post.user.username}`, decoding: 'async' })
        );
    } else {
        const hue = hueOf(post.user.username + post.id);
        media = h(
            'div',
            { class: 'slide-media slide-text', style: { '--h': String(hue) } },
            h('span', { class: 'text-paw', 'aria-hidden': 'true' }, icon('paw')),
            captionNode(post.caption, 'text-post')
        );
    }

    // ---- actions ----
    const boopCount = h('span', { class: 'rail-count', text: compactCount(post.boops) });
    const boopBtn = h('button', { class: 'rail-btn boop' + (post.booped ? ' on' : ''), 'aria-pressed': String(post.booped), 'aria-label': 'Boop' }, icon('paw'), boopCount);
    let booping = false;
    async function setBoop(on) {
        if (booping || post.booped === on) return;
        booping = true;
        post.booped = on;
        post.boops += on ? 1 : -1;
        sync();
        try {
            await (on ? app.backend.boop(post.id) : app.backend.unboop(post.id));
        } catch (e) {
            post.booped = !on;
            post.boops += on ? -1 : 1;
            sync();
            toast(errorText(e), 'error');
        } finally {
            booping = false;
        }
    }
    function sync() {
        boopBtn.classList.toggle('on', post.booped);
        boopBtn.setAttribute('aria-pressed', String(post.booped));
        boopCount.textContent = compactCount(post.boops);
        commentCount.textContent = compactCount(post.comments);
    }
    boopBtn.onclick = () => {
        if (!post.booped) boopBtn.classList.add('pop');
        setTimeout(() => boopBtn.classList.remove('pop'), 400);
        setBoop(!post.booped);
    };
    const commentCount = h('span', { class: 'rail-count', text: compactCount(post.comments) });
    const commentBtn = h(
        'button',
        { class: 'rail-btn', 'aria-label': 'Comments', onclick: () => openComments(post, () => sync()) },
        icon('comment'),
        commentCount
    );
    const shareBtn = h('button', { class: 'rail-btn', 'aria-label': 'Share', onclick: () => share(post) }, icon('share'), h('span', { class: 'rail-count', text: 'Share' }));
    const moreBtn = h('button', { class: 'rail-btn', 'aria-label': 'More', onclick: () => postMenu(post, isMine, slide, onRemoved) }, icon('more'));

    const followBtn =
        !isMine && !post.following
            ? h('button', {
                  class: 'chip-btn follow',
                  text: 'Follow',
                  onclick: (e) =>
                      withBusy(e.currentTarget, async () => {
                          try {
                              await app.backend.follow(post.user.id);
                              post.following = true;
                              followBtn.remove();
                              toast(`Following @${post.user.username}`, 'success');
                          } catch (err) {
                              toast(errorText(err), 'error');
                          }
                      })
              })
            : null;

    const info = h(
        'div',
        { class: 'slide-info' },
        h(
            'div',
            { class: 'author' },
            h('a', { class: 'author-link', href: `#/u/${post.user.username}` }, avatar(post.user, 'md', post.user.avatar_url), nameLine(post.user)),
            followBtn
        ),
        post.media_type && post.caption && captionNode(post.caption),
        post.credit && h('p', { class: 'credit' }, icon('palette'), captionNode(post.credit, 'credit-text', 'span')),
        h('span', { class: 'when', text: timeAgo(post.created_at) })
    );

    slide.append(media, h('div', { class: 'slide-shade', 'aria-hidden': 'true' }), info, h('div', { class: 'rail' }, boopBtn, commentBtn, shareBtn, moreBtn));
    if (video) {
        const muteBtn = h('button', { class: 'mute-btn', 'aria-label': app.muted ? 'Unmute' : 'Mute' }, icon(app.muted ? 'mute' : 'volume'));
        muteBtn.onclick = (e) => {
            e.stopPropagation();
            savePref('muted', !app.muted);
            for (const v of document.querySelectorAll('.slide-video')) v.muted = app.muted;
            for (const b of document.querySelectorAll('.mute-btn')) {
                b.replaceChildren(icon(app.muted ? 'mute' : 'volume'));
                b.setAttribute('aria-label', app.muted ? 'Unmute' : 'Mute');
            }
        };
        slide.append(muteBtn);
    }

    // Double-tap anywhere on the media to boop; a single tap pauses/plays a video.
    let lastTap = 0;
    let tapTimer = 0;
    media.addEventListener('click', (e) => {
        const nowT = Date.now();
        if (nowT - lastTap < 300) {
            clearTimeout(tapTimer);
            const r = slide.getBoundingClientRect();
            pawBurst(slide, e.clientX - r.left, e.clientY - r.top);
            setBoop(true);
            lastTap = 0;
            return;
        }
        lastTap = nowT;
        if (video) {
            tapTimer = setTimeout(() => {
                if (video.paused) video.play().catch(() => {});
                else video.pause();
                slide.classList.toggle('paused', video.paused);
            }, 300);
        }
    });

    slide.activate = () => {
        if (video) {
            video.muted = app.muted;
            video.play().catch(() => {});
            slide.classList.remove('paused');
        }
    };
    slide.deactivate = () => {
        if (video) video.pause();
    };
    return slide;
}

async function share(post) {
    const text = `@${post.user.username} on FurZone${post.caption ? ': ' + post.caption.slice(0, 200) : ''}`;
    try {
        if (navigator.share) await navigator.share({ text });
        else {
            await navigator.clipboard.writeText(text);
            toast('Copied to clipboard', 'success');
        }
    } catch {
        // share sheet closed
    }
}

function postMenu(post, isMine, slide, onRemoved) {
    sheet('Post', (body, close) => {
        const item = (ic, label, fn, danger) =>
            h('button', { class: 'menu-item' + (danger ? ' danger' : ''), onclick: () => (close(), fn()) }, icon(ic), h('span', { text: label }));
        if (isMine) {
            body.append(
                item('edit', 'Edit caption & credit', () => editPost(post, slide)),
                item(
                    'trash',
                    'Delete post',
                    async () => {
                        if (!(await confirmDialog('Delete this post?', "It's gone for good, with its boops and comments.", { ok: 'Delete', danger: true }))) return;
                        try {
                            await app.backend.deletePost(post);
                            toast('Post deleted', 'success');
                            if (onRemoved) onRemoved(post);
                        } catch (e) {
                            toast(errorText(e), 'error');
                        }
                    },
                    true
                )
            );
        } else {
            if (myRank() >= 1 && outranks(post.user.role, post.user.id)) {
                const staffItems = [
                    h('p', { class: 'menu-label', text: 'Staff' }),
                    item('eyeOff', 'Hide post (staff)', async () => {
                        try {
                            await app.backend.staffSetHidden(post.id, true);
                            toast('Post hidden from everyone but staff', 'success');
                            if (onRemoved) onRemoved(post);
                        } catch (e) {
                            toast(errorText(e), 'error');
                        }
                    }),
                    myRank() >= 2 &&
                        item(
                            'trash',
                            'Delete post (staff)',
                            async () => {
                                if (!(await confirmDialog('Delete this post?', 'It is removed for everyone, with its boops and comments.', { ok: 'Delete', danger: true }))) return;
                                try {
                                    await app.backend.staffDeletePost(post.id);
                                    toast('Post deleted', 'success');
                                    if (onRemoved) onRemoved(post);
                                } catch (e) {
                                    toast(errorText(e), 'error');
                                }
                            },
                            true
                        ),
                    item('shieldCheck', `Staff tools for @${post.user.username}`, () => staffTools(post.user)),
                    h('div', { class: 'menu-sep' })
                ];
                body.append(...staffItems.filter(Boolean));
            }
            body.append(
                item('user', `View @${post.user.username}`, () => (location.hash = `#/u/${post.user.username}`)),
                item('flag', 'Report post', () => reportPost(post, slide, onRemoved), true),
                item(
                    'ban',
                    `Block @${post.user.username}`,
                    async () => {
                        if (!(await confirmDialog(`Block @${post.user.username}?`, "You won't see each other's posts or comments, and they can't follow or boop you.", { ok: 'Block', danger: true }))) return;
                        try {
                            await app.backend.block(post.user.id);
                            toast(`Blocked @${post.user.username}`, 'success');
                            if (onRemoved) onRemoved(post, { user: true });
                        } catch (e) {
                            toast(errorText(e), 'error');
                        }
                    },
                    true
                )
            );
        }
    });
}

function reportPost(post, slide, onRemoved) {
    sheet('Report post', (body, close) => {
        body.append(h('p', { class: 'muted', text: 'Reports are private. When enough people report a post it is hidden until a moderator checks it.' }));
        for (const reason of REPORT_REASONS) {
            body.append(
                h('button', {
                    class: 'menu-item',
                    text: reason,
                    onclick: async () => {
                        close();
                        try {
                            await app.backend.report(post.id, reason);
                            toast("Thanks — we've got it from here.", 'success');
                            if (onRemoved) onRemoved(post);
                        } catch (e) {
                            toast(errorText(e), 'error');
                        }
                    }
                })
            );
        }
    });
}

function editPost(post, slide) {
    sheet('Edit post', (body, close) => {
        const caption = h('textarea', { maxlength: 1000, rows: 4 });
        caption.value = post.caption;
        const credit = h('input', { type: 'text', maxlength: 80, placeholder: 'Art by @someone' });
        credit.value = post.credit;
        const save = h('button', { class: 'btn primary block', text: 'Save' });
        save.onclick = () =>
            withBusy(save, async () => {
                if (!post.media_type && !caption.value.trim()) return toast('A text post needs some words.', 'error');
                try {
                    await app.backend.editPost(post.id, { caption: caption.value, credit: credit.value });
                    post.caption = caption.value.trim();
                    post.credit = credit.value.trim();
                    slide.replaceWith(renderSlide(post));
                    close();
                    toast('Saved', 'success');
                } catch (e) {
                    toast(errorText(e), 'error');
                }
            });
        body.append(field('Caption', caption), field('Credit', credit), save);
    });
}

export function openComments(post, onChange) {
    sheet(
        'Comments',
        (body, close) => {
            const list = h('div', { class: 'comments' }, h('div', { class: 'spinner' }));
            const input = h('input', { type: 'text', maxlength: 500, placeholder: 'Say something nice…', 'aria-label': 'Comment' });
            const send = h('button', { class: 'btn primary', type: 'submit', 'aria-label': 'Send' }, icon('chevron'));
            const form = h('form', { class: 'comment-form' }, avatar(app.me, 'sm', app.me.avatar_url), input, send);

            function row(c) {
                const own = c.user.id === app.me.id || post.user.id === app.me.id;
                const canDelete = own || (myRank() >= 2 && outranks(c.user.role, c.user.id));
                const el = h(
                    'div',
                    { class: 'comment' },
                    h('a', { href: `#/u/${c.user.username}`, onclick: () => close() }, avatar(c.user, 'sm', c.user.avatar_url)),
                    h(
                        'div',
                        { class: 'comment-body' },
                        h('div', { class: 'comment-head' }, h('strong', { text: c.user.display_name || c.user.username }), h('span', { class: 'muted', text: timeAgo(c.created_at) })),
                        captionNode(c.body, 'comment-text')
                    ),
                    canDelete &&
                        h('button', {
                            class: 'icon-btn sm',
                            'aria-label': 'Delete comment',
                            onclick: async () => {
                                try {
                                    await (own ? app.backend.deleteComment(c.id) : app.backend.staffDeleteComment(c.id));
                                    el.remove();
                                    post.comments = Math.max(0, post.comments - 1);
                                    onChange && onChange();
                                } catch (e) {
                                    toast(errorText(e), 'error');
                                }
                            }
                        }, icon('trash'))
                );
                return el;
            }

            app.backend
                .comments(post.id)
                .then((items) => {
                    list.replaceChildren(...(items.length ? items.map(row) : [h('p', { class: 'muted center pad', text: 'No comments yet. Be the first!' })]));
                })
                .catch((e) => list.replaceChildren(h('p', { class: 'form-error', text: errorText(e) })));

            form.onsubmit = (e) => {
                e.preventDefault();
                const text = input.value.trim();
                if (!text) return;
                withBusy(send, async () => {
                    try {
                        const c = await app.backend.addComment(post.id, text);
                        if (list.querySelector('.center')) list.replaceChildren();
                        list.append(row(c));
                        input.value = '';
                        post.comments++;
                        onChange && onChange();
                        list.lastChild.scrollIntoView({ block: 'nearest' });
                    } catch (err) {
                        toast(errorText(err), 'error');
                    }
                });
            };
            body.append(list, form);
        },
        { tall: true }
    );
}
