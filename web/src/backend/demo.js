// Demo backend: everything in memory, with a few furs already posting. Used before the server is set up
// ("Try the demo") and by the UI tests. It follows the same rules as the database.
import { normalizePost, normalizeProfile, extractTags } from './shape.js';

const HOUR = 3600 * 1000;
const VRC_ID = /^usr_[0-9a-f-]{36}$/;

const SEED_USERS = [
    ['embertail', 'Ember', 'Red fox', 'they/them', 'Suiter, artist, professional chaos gremlin 🔥', ['discord', 'vrchat']],
    ['blitzwolf', 'Blitz', 'Arctic wolf', 'he/him', 'VRChat DJ every Friday. Awoo responsibly.', ['vrchat']],
    ['mochibun', 'Mochi', 'Bunny', 'she/her', 'Soft art & stickers. Commissions open!', ['discord']],
    ['neonproto', 'NEON', 'Protogen', 'it/its', 'beep boop. visor go brrr', ['vrchat', 'discord']],
    ['skysergal', 'Sky', 'Sergal', 'he/they', 'Cheese wedge enthusiast', []],
    ['pastelpaws', 'Pastel', 'Cat', 'she/they', 'Making the world softer, one doodle at a time', []]
];

const SEED_POSTS = [
    ['neonproto', 'New visor faces just dropped. Who wants to see the angry one? #protogen #vrchat #avatar', '', 2],
    ['embertail', 'First time out in the new suit at the con today!! Everyone was so nice 🦊 #fursuit #con', 'Suit by @mochibun', 4],
    ['mochibun', 'YCH slots are open! 3 left. DM me on Discord 💕 #art #ych #commissions', '', 7],
    ['blitzwolf', 'Friday DJ set at the Black Cat tonight, 9pm EST. Bring your tails. #vrchat #music', '', 11],
    ['pastelpaws', 'Doodled my friends as tiny beans today #art #doodle', 'Art by me', 18],
    ['skysergal', 'Unpopular opinion: cheese is a personality. #sergal', '', 26],
    ['embertail', 'Ref sheet finally finished!! Thank you so much @pastelpaws #refsheet #art', 'Art by @pastelpaws', 40],
    ['neonproto', 'Hosting a protogen meetup in VRChat this weekend — all species welcome #vrchat #meetup', '', 55],
    ['blitzwolf', 'Awoo. That is all. #wolf', '', 70]
];

export function createDemoBackend({ now = () => Date.now() } = {}) {
    let seq = 0;
    const id = (prefix) => `${prefix}_${(++seq).toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const accounts = new Map(); // email -> { password, userId }
    const profiles = new Map();
    const connections = []; // { user_id, provider, external_id, handle, verified_at }
    const posts = []; // newest first
    const boops = new Set();
    const comments = [];
    const follows = new Set();
    const blocks = new Set(); // `${blocker}:${blocked}`
    const notifications = [];
    const reports = new Set();
    const blobs = new Map();
    const vrcCodes = new Map();
    const listeners = new Set();
    let session = null;

    const mediaUrl = (path) => blobs.get(path) || '';
    const iso = (t) => new Date(t).toISOString();
    const providersOf = (uid) => connections.filter((c) => c.user_id === uid).map((c) => c.provider).sort();
    const P = (row) => (row ? normalizeProfile({ ...row, connections: providersOf(row.id) }, mediaUrl) : null);
    const blocked = (a, b) => blocks.has(`${a}:${b}`) || blocks.has(`${b}:${a}`);
    const delay = (v) => new Promise((r) => setTimeout(() => r(v), 40));

    function addProfile(username, display_name, species = '', pronouns = '', bio = '') {
        const row = {
            id: id('usr'),
            username,
            display_name,
            species,
            pronouns,
            bio,
            avatar_path: null,
            banner_path: null,
            ref_path: null,
            followers_count: 0,
            following_count: 0,
            posts_count: 0,
            created_at: iso(now() - 300 * 24 * HOUR)
        };
        profiles.set(row.id, row);
        return row;
    }

    function notify(recipient, actor, kind, postId) {
        if (recipient && recipient !== actor) {
            notifications.unshift({ id: id('ntf'), user_id: recipient, actor_id: actor, kind, post_id: postId || null, created_at: iso(now()), read_at: null });
        }
    }

    function addPost(userId, { caption = '', credit = '', media_path = null, media_type = null }, at) {
        const row = {
            id: id('post'),
            user_id: userId,
            caption: caption.trim(),
            credit: credit.trim(),
            tags: extractTags(caption),
            media_path,
            media_type,
            boops_count: 0,
            comments_count: 0,
            reports_count: 0,
            hidden: false,
            created_at: iso(at)
        };
        posts.push(row);
        posts.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
        profiles.get(userId).posts_count++;
        return row;
    }

    function doFollow(a, b) {
        if (a === b || follows.has(`${a}:${b}`) || blocked(a, b)) return false;
        follows.add(`${a}:${b}`);
        profiles.get(a).following_count++;
        profiles.get(b).followers_count++;
        notify(b, a, 'follow');
        return true;
    }

    function doBoop(uid, p) {
        const key = `${uid}:${p.id}`;
        if (boops.has(key)) return;
        boops.add(key);
        p.boops_count++;
        notify(p.user_id, uid, 'boop', p.id);
    }

    // ---- seed ----
    const seeded = new Map();
    for (const [u, n, species, pronouns, bio, conns] of SEED_USERS) {
        const row = addProfile(u, n, species, pronouns, bio);
        seeded.set(u, row.id);
        for (const provider of conns) {
            connections.push({ user_id: row.id, provider, external_id: id(provider), handle: n, verified_at: iso(now()) });
        }
    }
    for (const [u, caption, credit, hoursAgo] of [...SEED_POSTS].reverse()) {
        addPost(seeded.get(u), { caption, credit }, now() - hoursAgo * HOUR);
    }
    const seedIds = [...seeded.values()];
    posts.forEach((p, i) => {
        for (let k = 0; k < 2 + (i % 4); k++) {
            const who = seedIds[(i + k + 1) % seedIds.length];
            if (who !== p.user_id) doBoop(who, p);
        }
    });
    for (const [a, b] of [
        ['mochibun', 'embertail'],
        ['embertail', 'pastelpaws'],
        ['neonproto', 'blitzwolf'],
        ['blitzwolf', 'neonproto']
    ]) {
        doFollow(seeded.get(a), seeded.get(b));
    }
    const suitPost = posts.find((p) => p.caption.startsWith('First time out'));
    for (const [u, body] of [
        ['mochibun', 'You look AMAZING in it!! 😭💕'],
        ['blitzwolf', 'Top tier floof']
    ]) {
        comments.push({ id: id('cmt'), post_id: suitPost.id, user_id: seeded.get(u), body, created_at: iso(now() - HOUR) });
        suitPost.comments_count++;
    }
    notifications.length = 0; // seed activity isn't news to anyone

    // ---- helpers ----
    function me() {
        if (!session) throw new Error('Not logged in');
        return session.userId;
    }
    function emit(event) {
        for (const cb of listeners) cb(event, session ? { ...session } : null);
    }
    function canSee(p) {
        return p.user_id === session.userId || (!p.hidden && !blocked(session.userId, p.user_id));
    }
    function row(p) {
        const pr = profiles.get(p.user_id);
        return normalizePost(
            {
                ...p,
                username: pr.username,
                display_name: pr.display_name,
                avatar_path: pr.avatar_path,
                species: pr.species,
                pronouns: pr.pronouns,
                connections: providersOf(pr.id),
                booped: boops.has(`${session.userId}:${p.id}`),
                following: follows.has(`${session.userId}:${p.user_id}`)
            },
            mediaUrl
        );
    }
    function newAccount(email, password, username) {
        const r = addProfile(username, username);
        r.created_at = iso(now());
        accounts.set(email, { password, userId: r.id });
        // New accounts follow two people so the Following feed isn't empty.
        doFollow(r.id, seeded.get('embertail'));
        doFollow(r.id, seeded.get('neonproto'));
        return r;
    }

    return {
        kind: 'demo',
        mediaUrl,
        auth: {
            async session() {
                return session ? { ...session } : null;
            },
            onChange(cb) {
                listeners.add(cb);
                return () => listeners.delete(cb);
            },
            async signIn(email, password) {
                const acc = accounts.get(String(email).toLowerCase());
                if (!acc || acc.password !== password) throw new Error('Invalid login credentials');
                session = { userId: acc.userId, email };
                emit('SIGNED_IN');
            },
            async signUp(email, password, username) {
                const key = String(email).toLowerCase();
                if (accounts.has(key)) throw new Error('User already registered');
                if ([...profiles.values()].some((p) => p.username === username)) throw new Error('That username is taken.');
                const r = newAccount(key, password, username);
                session = { userId: r.id, email: key };
                emit('SIGNED_IN');
                return { needsConfirmation: false };
            },
            async signOut() {
                session = null;
                emit('SIGNED_OUT');
            },
            async usernameAvailable(name) {
                return /^[a-z0-9_]{3,20}$/.test(name) && [...profiles.values()].every((p) => p.username !== name);
            },
            async sendResetCode() {
                return delay();
            },
            async resetPassword(email, code, newPassword) {
                const acc = accounts.get(String(email).toLowerCase());
                if (!acc || code !== '123456') throw new Error('Token has expired or is invalid');
                acc.password = newPassword;
                session = { userId: acc.userId, email };
                emit('SIGNED_IN');
            },
            async changePassword(newPassword) {
                for (const acc of accounts.values()) if (acc.userId === me()) acc.password = newPassword;
            },
            // In the demo, "Discord" connects straight away (no real Discord involved).
            async discordLoginUrl() {
                return 'demo:discord-login';
            },
            async discordLinkUrl() {
                return 'demo:discord-link';
            },
            async finishOAuth() {
                return false;
            },
            async demoDiscord(kind) {
                if (kind === 'login') {
                    const email = `discord${seq}@demo.local`;
                    const r = newAccount(email, Math.random().toString(36), `discordfur${seq}`);
                    session = { userId: r.id, email };
                }
                const uid = me();
                if (!connections.some((c) => c.user_id === uid && c.provider === 'discord')) {
                    connections.push({ user_id: uid, provider: 'discord', external_id: id('dc'), handle: profiles.get(uid).display_name, verified_at: iso(now()) });
                }
                emit('SIGNED_IN');
            },
            async hasPassword() {
                return true;
            },
            async deleteAccount() {
                const uid = me();
                profiles.delete(uid);
                for (let i = posts.length - 1; i >= 0; i--) if (posts[i].user_id === uid) posts.splice(i, 1);
                for (const [k, acc] of accounts) if (acc.userId === uid) accounts.delete(k);
                session = null;
                emit('SIGNED_OUT');
            }
        },

        async me() {
            return P(profiles.get(me()));
        },
        async profileByUsername(username) {
            me();
            return delay(P([...profiles.values()].find((p) => p.username === String(username).toLowerCase())));
        },
        async connections(userId) {
            me();
            return connections.filter((c) => c.user_id === userId).map((c) => ({ ...c }));
        },
        async updateProfile(patch) {
            const r = profiles.get(me());
            if ('username' in patch && patch.username !== r.username) {
                if (!/^[a-z0-9_]{3,20}$/.test(patch.username)) throw new Error('Pick a username of 3-20 letters, numbers or _.');
                if ([...profiles.values()].some((p) => p.username === patch.username)) throw new Error('That username is taken.');
            }
            const limits = { display_name: 40, pronouns: 24, species: 40, bio: 300 };
            for (const [k, max] of Object.entries(limits)) {
                if (k in patch && String(patch[k]).length > max) throw new Error(`That's too long (${max} max).`);
            }
            for (const k of ['username', 'display_name', 'pronouns', 'species', 'bio', 'avatar_path', 'banner_path', 'ref_path']) {
                if (k in patch) r[k] = patch[k];
            }
            return P(r);
        },
        async uploadImage(kind, blob) {
            const path = `${me()}/${kind}-${Date.now()}`;
            blobs.set(path, URL.createObjectURL(blob));
            return this.updateProfile({ [kind + '_path']: path });
        },
        async searchUsers(q) {
            me();
            const term = String(q || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
            if (!term) return [];
            return [...profiles.values()]
                .filter((p) => p.username.includes(term) || p.species.toLowerCase().replace(/\s/g, '').includes(term))
                .slice(0, 20)
                .map(P);
        },
        async trendingTags() {
            me();
            const counts = new Map();
            for (const p of posts) if (!p.hidden) for (const t of p.tags) counts.set(t, (counts.get(t) || 0) + 1);
            return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([tag, uses]) => ({ tag, uses }));
        },

        async feed({ scope = 'all', before = null, limit = 8, tag = null } = {}) {
            const uid = me();
            const rows = posts.filter(
                (p) =>
                    canSee(p) &&
                    !p.hidden &&
                    (!before || Date.parse(p.created_at) < Date.parse(before)) &&
                    (!tag || p.tags.includes(String(tag).toLowerCase())) &&
                    (scope !== 'following' || p.user_id === uid || follows.has(`${uid}:${p.user_id}`))
            );
            return delay(rows.slice(0, limit).map(row));
        },
        async post(postId) {
            me();
            const p = posts.find((x) => x.id === postId && canSee(x));
            return p ? row(p) : null;
        },
        async userPosts(userId, before = null) {
            me();
            return delay(
                posts
                    .filter((p) => p.user_id === userId && canSee(p) && (!before || Date.parse(p.created_at) < Date.parse(before)))
                    .slice(0, 30)
                    .map(row)
            );
        },
        async createPost({ caption, credit, file, mediaType }, onProgress) {
            const uid = me();
            if (posts.filter((p) => p.user_id === uid && now() - Date.parse(p.created_at) < HOUR).length >= 20) {
                throw new Error('Slow down: too many posts right now. Try again in a bit.');
            }
            if (!file && !String(caption || '').trim()) throw new Error('Add a picture, a video or some words.');
            let media_path = null;
            if (file) {
                media_path = `${uid}/${mediaType}-${Date.now()}`;
                blobs.set(media_path, URL.createObjectURL(file));
                for (const f of [0.3, 0.7, 1]) {
                    await delay();
                    if (onProgress) onProgress(f);
                }
            }
            return row(addPost(uid, { caption: caption || '', credit: credit || '', media_path, media_type: file ? mediaType : null }, now()));
        },
        async editPost(postId, { caption, credit }) {
            const p = posts.find((x) => x.id === postId && x.user_id === me());
            if (p) {
                p.caption = caption.trim();
                p.credit = credit.trim();
                p.tags = extractTags(p.caption);
            }
        },
        async deletePost(post) {
            const i = posts.findIndex((x) => x.id === post.id && x.user_id === me());
            if (i >= 0) {
                posts.splice(i, 1);
                profiles.get(me()).posts_count--;
            }
        },
        async boop(postId) {
            const p = posts.find((x) => x.id === postId && canSee(x));
            if (p) doBoop(me(), p);
        },
        async unboop(postId) {
            const p = posts.find((x) => x.id === postId);
            if (p && boops.delete(`${me()}:${postId}`)) p.boops_count--;
        },
        async comments(postId) {
            const uid = me();
            return delay(
                comments
                    .filter((c) => c.post_id === postId && !blocked(uid, c.user_id))
                    .map((c) => ({ id: c.id, body: c.body, created_at: c.created_at, user: P(profiles.get(c.user_id)) }))
            );
        },
        async addComment(postId, body) {
            const uid = me();
            const text = String(body || '').trim();
            if (!text || text.length > 500) throw new Error('Comments are 1–500 characters.');
            const p = posts.find((x) => x.id === postId && canSee(x));
            if (!p) throw new Error("You can't comment on that.");
            const c = { id: id('cmt'), post_id: postId, user_id: uid, body: text, created_at: iso(now()) };
            comments.push(c);
            p.comments_count++;
            notify(p.user_id, uid, 'comment', p.id);
            return { id: c.id, body: c.body, created_at: c.created_at, user: P(profiles.get(uid)) };
        },
        async deleteComment(commentId) {
            const i = comments.findIndex((c) => c.id === commentId);
            if (i < 0) return;
            const c = comments[i];
            const p = posts.find((x) => x.id === c.post_id);
            if (c.user_id !== me() && (!p || p.user_id !== me())) return;
            comments.splice(i, 1);
            if (p) p.comments_count--;
        },
        async report(postId) {
            const key = `${me()}:${postId}`;
            if (reports.has(key)) return;
            reports.add(key);
            const p = posts.find((x) => x.id === postId);
            if (p && ++p.reports_count >= 5) p.hidden = true;
        },
        async follow(userId) {
            if (!doFollow(me(), userId) && blocked(me(), userId)) throw new Error("You can't follow them.");
        },
        async unfollow(userId) {
            const a = me();
            if (follows.delete(`${a}:${userId}`)) {
                profiles.get(a).following_count--;
                profiles.get(userId).followers_count--;
            }
        },
        async isFollowing(userId) {
            return follows.has(`${me()}:${userId}`);
        },
        async block(userId) {
            const a = me();
            blocks.add(`${a}:${userId}`);
            await this.unfollow(userId);
            if (follows.delete(`${userId}:${a}`)) {
                profiles.get(userId).following_count--;
                profiles.get(a).followers_count--;
            }
        },
        async unblock(userId) {
            blocks.delete(`${me()}:${userId}`);
        },
        async blocked() {
            const a = me();
            return [...blocks].filter((k) => k.startsWith(a + ':')).map((k) => P(profiles.get(k.split(':')[1])));
        },
        async notifications() {
            const uid = me();
            return notifications
                .filter((n) => n.user_id === uid && !blocked(uid, n.actor_id))
                .map((n) => {
                    const p = n.post_id && posts.find((x) => x.id === n.post_id);
                    return {
                        id: n.id,
                        kind: n.kind,
                        created_at: n.created_at,
                        read: !!n.read_at,
                        post_id: n.post_id,
                        actor: P(profiles.get(n.actor_id)),
                        post: p ? { media_url: mediaUrl(p.media_path), media_type: p.media_type, caption: p.caption } : null
                    };
                });
        },
        async unreadCount() {
            const uid = me();
            return notifications.filter((n) => n.user_id === uid && !n.read_at).length;
        },
        async markNotificationsRead() {
            const uid = me();
            for (const n of notifications) if (n.user_id === uid && !n.read_at) n.read_at = iso(now());
        },
        /** Demo only: someone boops your latest post, so the Inbox has something in it. */
        async demoActivity() {
            const uid = me();
            const mine = posts.find((p) => p.user_id === uid);
            const fan = seeded.get('mochibun');
            doFollow(fan, uid);
            if (mine) doBoop(fan, mine);
        },
        async startVrchatLink(vrchatUserId) {
            const uid = me();
            const vrc = String(vrchatUserId || '').trim().toLowerCase();
            if (!VRC_ID.test(vrc)) throw new Error("That doesn't look like a VRChat user id (usr_…).");
            if (connections.some((c) => c.provider === 'vrchat' && c.external_id === vrc && c.user_id !== uid)) {
                throw new Error('That VRChat account is already connected to someone else.');
            }
            const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            const code = 'FURZONE-' + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => alphabet[b % 32]).join('');
            vrcCodes.set(uid, { vrc, code });
            return code;
        },
        /** The demo can't read VRChat, so it trusts you added the code. */
        async verifyVrchat() {
            const uid = me();
            const pending = vrcCodes.get(uid);
            if (!pending) throw new Error('Start again: get a new code first.');
            const i = connections.findIndex((c) => c.user_id === uid && c.provider === 'vrchat');
            if (i >= 0) connections.splice(i, 1);
            const handle = profiles.get(uid).display_name || profiles.get(uid).username;
            connections.push({ user_id: uid, provider: 'vrchat', external_id: pending.vrc, handle, verified_at: iso(now()) });
            vrcCodes.delete(uid);
            await delay();
            return { connected: true, handle };
        },
        async unlink(provider) {
            const uid = me();
            const i = connections.findIndex((c) => c.user_id === uid && c.provider === provider);
            if (i >= 0) connections.splice(i, 1);
        }
    };
}
