// The Share menu for a post: inside FurZone (send in a message, post in the Lounge), other apps (Discord, X,
// Instagram, Facebook, Reddit, Bluesky, Threads, Telegram, WhatsApp, Messenger, Tumblr), copy, or the phone's
// own share menu. On Android, apps that are installed open directly.
import { h, icon, avatar, fill, toast, sheet, errorText, withBusy } from '../ui.js';
import { app } from '../state.js';
import { GITHUB_REPO } from '../config.js';
import { platform, openExternal, shareNative } from '../platform.js';

export const APP_LINK = `https://github.com/${GITHUB_REPO}/releases/latest`;

/** A link to a post that FurZone's chats turn into an "Open post" button. */
export const postToken = (id) => `furzone://post/${id}`;
export const POST_TOKEN = /furzone:\/\/post\/([A-Za-z0-9_-]{4,60})/gi;

const enc = encodeURIComponent;

// [key, label, Android package, colour, web link (or null: copy and open the site)]
const TARGETS = [
    ['discord', 'Discord', 'com.discord', '#5865F2', null, 'https://discord.com/app'],
    ['x', 'X', 'com.twitter.android', '#000000', (t) => `https://x.com/intent/post?text=${enc(t.text)}`],
    ['instagram', 'Instagram', 'com.instagram.android', '#E1306C', null, 'https://www.instagram.com/'],
    ['facebook', 'Facebook', 'com.facebook.katana', '#0866FF', (t) => `https://www.facebook.com/sharer/sharer.php?u=${enc(APP_LINK)}`],
    ['reddit', 'Reddit', 'com.reddit.frontpage', '#FF4500', (t) => `https://www.reddit.com/submit?url=${enc(APP_LINK)}&title=${enc(t.title)}`],
    ['bluesky', 'Bluesky', 'xyz.blueskyweb.app', '#1185FE', (t) => `https://bsky.app/intent/compose?text=${enc(t.text)}`],
    ['threads', 'Threads', 'com.instagram.barcelona', '#000000', (t) => `https://www.threads.net/intent/post?text=${enc(t.text)}`],
    ['telegram', 'Telegram', 'org.telegram.messenger', '#26A5E4', (t) => `https://t.me/share/url?url=${enc(APP_LINK)}&text=${enc(t.body)}`],
    ['whatsapp', 'WhatsApp', 'com.whatsapp', '#25D366', (t) => `https://wa.me/?text=${enc(t.text)}`],
    ['messenger', 'Messenger', 'com.facebook.orca', '#0866FF', null, 'https://www.messenger.com/'],
    ['tumblr', 'Tumblr', 'com.tumblr', '#36465D', (t) => `https://www.tumblr.com/widgets/share/tool?posttype=link&canonicalUrl=${enc(APP_LINK)}&title=${enc(t.title)}&caption=${enc(t.body)}`]
];

function texts(post) {
    const who = post.user.display_name || post.user.username;
    const cap = (post.caption || '').trim().slice(0, 200);
    const body = `${who} (@${post.user.username}) on FurZone${cap ? `: “${cap}”` : ''} 🐾`;
    return {
        title: `${who} on FurZone`,
        body,
        text: `${body}\nGet FurZone: ${APP_LINK}`
    };
}

async function copy(text, what = 'Copied') {
    try {
        await navigator.clipboard.writeText(text);
        toast(what, 'success');
        return true;
    } catch {
        toast("Couldn't copy. Long-press to copy instead.", 'error');
        return false;
    }
}

async function shareTo(target, post) {
    const [key, label, pkg, , web, site] = target;
    const t = texts(post);
    // Android: open the app directly with the text. (Instagram only takes pictures and videos, so for Instagram
    // the text is copied and the app opens.)
    if (platform === 'android' && key !== 'instagram') {
        const state = shareNative(t.text, pkg);
        if (state === 'ok') return;
        if (state === 'missing' && web) toast(`${label} isn't installed, so it opens on the web.`, 'info');
    }
    if (web) return openExternal(web(t));
    await copy(t.text, `Copied. Paste it in ${label}.`);
    if (site) openExternal(site);
}

/** Pick someone and send them the post in a message. */
function sendInMessage(post) {
    sheet(
        'Send to…',
        (body, close) => {
            const input = h('input', { type: 'search', placeholder: 'Search by name or species', 'aria-label': 'Who to send it to', maxlength: 40, autocapitalize: 'none', spellcheck: 'false' });
            const results = h('div', { class: 'people' });
            let seq = 0;
            const t = texts(post);
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
                            ? people.map((p) => {
                                  const send = h('button', { class: 'chip-btn primary', type: 'button', text: 'Send' });
                                  send.onclick = () =>
                                      withBusy(send, async () => {
                                          try {
                                              await app.backend.sendDm(p.id, `${t.body}\n${postToken(post.id)}`);
                                              send.textContent = 'Sent';
                                              send.disabled = true;
                                              toast(`Sent to @${p.username}`, 'success');
                                          } catch (e) {
                                              toast(errorText(e), 'error', 5000);
                                          }
                                      });
                                  return h('div', { class: 'person' }, avatar(p, 'md', p.avatar_url), h('span', { class: 'name-line grow' }, h('strong', { text: p.display_name || p.username }), h('span', { class: 'name-sub', text: '@' + p.username })), send);
                              })
                            : h('p', { class: 'muted pad', text: `No one matches "${q}".` })
                    );
                } catch (e) {
                    fill(results, h('p', { class: 'form-error', text: errorText(e) }));
                }
            };
            body.append(h('label', { class: 'search-box' }, icon('search'), input), results);
            void close;
        },
        { tall: true }
    );
}

export function openShare(post) {
    sheet('Share', (body, close) => {
        const t = texts(post);
        const go = (fn) => () => {
            close();
            fn();
        };
        const tile = (ic, label, color, fn) =>
            h('button', { class: 'share-tile', type: 'button', onclick: go(fn) }, h('span', { class: 'share-icon', style: { '--c': color } }, icon(ic)), h('span', { class: 'share-label', text: label }));
        body.append(
            h(
                'div',
                { class: 'share-preview' },
                post.media_type === 'image' ? h('img', { src: post.media_url, alt: '' }) : avatar(post.user, 'md', post.user.avatar_url),
                h('span', { class: 'share-preview-text' }, h('strong', { text: post.user.display_name || post.user.username }), h('span', { class: 'muted', text: post.caption ? post.caption.slice(0, 90) : `@${post.user.username}` }))
            ),
            h('h3', { class: 'share-heading', text: 'On FurZone' }),
            h(
                'div',
                { class: 'share-grid' },
                tile('send', 'Message', 'var(--violet)', () => sendInMessage(post)),
                tile('hash', 'Lounge', 'var(--pink)', async () => {
                    try {
                        await app.backend.loungeSend(`${t.body}\n${postToken(post.id)}`);
                        toast('Shared in the Lounge', 'success');
                    } catch (e) {
                        toast(errorText(e), 'error');
                    }
                })
            ),
            h('h3', { class: 'share-heading', text: 'Other apps' }),
            h(
                'div',
                { class: 'share-grid' },
                TARGETS.map((target) => tile(target[0], target[1], target[3], () => shareTo(target, post)))
            ),
            h(
                'div',
                { class: 'share-grid' },
                tile('copy', 'Copy', '#475569', () => copy(t.text)),
                tile('more', 'More…', '#475569', async () => {
                    if (platform === 'android' && shareNative(t.text, '') === 'ok') return;
                    try {
                        if (navigator.share) return await navigator.share({ title: t.title, text: t.text });
                    } catch {
                        return; // closed the share menu
                    }
                    copy(t.text);
                })
            ),
            h('p', { class: 'fine muted', text: "Posts can only be seen in the FurZone app, so the link helps your friends get it." })
        );
    });
}
