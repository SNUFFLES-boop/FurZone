// Demo backend: everything in memory, with a few furs already posting. Used before the server is set up
// ("Try the demo") and by the UI tests. It follows the same rules as the database.
import { normalizePost, normalizeProfile, normalizeRestriction, extractTags } from './shape.js';

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

// Demo only: what seeded accounts say back in messages and the Lounge.
const DEMO_REPLIES = {
    mochibun: ['hii!! 🐰', 'omg yes', 'that sounds so fun', 'see you in VRChat later?'],
    blitzwolf: ['awoo! 🐺', 'nice one', 'haha for real']
};
const LOUNGE_REPLIES = ['haha same', 'welcome to the lounge! 🐾', 'anyone in VRChat right now?', 'love that', 'brb getting snacks'];

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
    const followAt = new Map(); // `${follower}:${followee}` -> when
    const boopAt = new Map(); // `${user}:${post}` -> when
    const blocks = new Set(); // `${blocker}:${blocked}`
    const notifications = [];
    const commentLikes = new Set(); // `${user}:${comment}`
    const views = new Set(); // `${user}:${post}`
    const reports = new Map(); // `${reporter}:${post}` -> { reason, at }
    const staff = new Map(); // user id -> owner | admin | mod | staff
    const restrictions = new Map(); // user id -> { banned, no_posting, …, reason, until }
    const staffLog = [];
    const followRequests = new Map(); // `${requester}:${target}` -> created_at
    const userReports = new Map(); // `${reporter}:${target}` -> reason
    const flagClears = new Map(); // user id -> cleared_at
    const threads = new Map(); // `${owner}:${other}` -> { state, last_message_at, last_body, last_from_me, unread, cleared_at }
    const dms = []; // { id, sender_id, recipient_id, body, created_at, read_at }
    const chat = []; // Lounge messages
    let chatSeq = 0;
    const dmListeners = new Set();
    const phones = new Map(); // phone -> user id
    let pendingPhone = null;
    const loungeListeners = new Set();
    const news = [];
    const blobs = new Map();
    const vrcCodes = new Map();
    const listeners = new Set();
    let session = null;

    const mediaUrl = (path) => blobs.get(path) || '';
    const iso = (t) => new Date(t).toISOString();
    const providersOf = (uid) => connections.filter((c) => c.user_id === uid).map((c) => c.provider).sort();
    const P = (row) =>
        row ? normalizeProfile({ ...row, connections: providersOf(row.id), role: staff.get(row.id) || null, flag: flagOf(row.id) }, mediaUrl) : null;
    const RANKS = { owner: 4, admin: 3, mod: 2, staff: 1 };
    const rank = (uid) => RANKS[staff.get(uid)] || 0;
    const limitsOf = (uid) => normalizeRestriction(restrictions.get(uid));
    const isBanned = (uid) => !!(limitsOf(uid) && limitsOf(uid).banned);
    /** Same rule as the database: 3+ different people reported them (or their posts) since staff last cleared it. */
    function flagOf(uid) {
        if (rank(uid)) return null;
        const since = flagClears.get(uid) || '';
        const votes = new Map(); // reporter -> reason
        for (const [k, r] of userReports) {
            const [reporter, target] = k.split(':');
            if (target === uid && r.at > since) votes.set(reporter, r.reason);
        }
        for (const [k, r] of reports) {
            const [reporter, postId] = k.split(':');
            const post = posts.find((x) => x.id === postId);
            if (post && post.user_id === uid && r.at > since && !votes.has(reporter)) votes.set(reporter, /spam|scam/i.test(r.reason) ? 'spam' : /harass|hate/i.test(r.reason) ? 'bad' : 'nuisance');
        }
        if (votes.size < 3) return null;
        const counts = new Map();
        for (const reason of votes.values()) counts.set(reason, (counts.get(reason) || 0) + 1);
        const order = ['scam', 'bad', 'spam', 'nuisance'];
        return [...counts].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))[0][0];
    }
    const canSeePostsOf = (viewer, owner) =>
        viewer === owner || !profiles.get(owner) || !profiles.get(owner).is_private || follows.has(`${viewer}:${owner}`);
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
            is_private: false,
            dm_policy: 'everyone',
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
            views_count: 0,
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
        followAt.set(`${a}:${b}`, iso(now()));
        profiles.get(a).following_count++;
        profiles.get(b).followers_count++;
        notify(b, a, 'follow');
        return true;
    }

    function doBoop(uid, p) {
        const key = `${uid}:${p.id}`;
        if (boops.has(key)) return;
        boops.add(key);
        boopAt.set(key, iso(now()));
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
        comments.push({ id: id('cmt'), post_id: suitPost.id, user_id: seeded.get(u), body, created_at: iso(now() - HOUR), likes: 0 });
        suitPost.comments_count++;
    }
    staff.set(seeded.get('blitzwolf'), 'mod');
    staff.set(seeded.get('mochibun'), 'staff');
    const cheese = posts.find((p) => p.caption.startsWith('Unpopular opinion'));
    for (const [u, reason] of [
        ['pastelpaws', 'Spam'],
        ['neonproto', 'Rude or hateful']
    ]) {
        reports.set(`${seeded.get(u)}:${cheese.id}`, { reason, at: iso(now() - 2 * HOUR) });
        cheese.reports_count++;
    }
    // Some views and comment hearts, so Explore and comments have something to sort by.
    posts.forEach((p, i) => (p.views_count = 12 + ((i * 37) % 90) + p.boops_count * 3));
    comments[0].likes = 3;
    // A private account, and an account several people reported as a scam (for the labels).
    const otter = addProfile('shyotter', 'Shy Otter', 'Otter', 'she/her', 'Private account, ask nicely 🦦');
    otter.is_private = true;
    addPost(otter.id, { caption: 'Only my followers can see this one #otter' }, now() - 5 * HOUR);
    const vbux = addProfile('freevbux', 'FREE VRC+ 💸', '', '', 'click my link!!!');
    for (const u of ['embertail', 'blitzwolf', 'mochibun']) userReports.set(`${seeded.get(u)}:${vbux.id}`, { reason: 'scam', at: iso(now() - HOUR) });
    // The Lounge, with a couple of messages "from Discord".
    const say = (user_id, body, minutesAgo, discord) =>
        chat.push({ id: ++chatSeq, source: discord ? 'discord' : 'furzone', user_id, body, created_at: iso(now() - minutesAgo * 60000), discord_author: discord || null, discord_avatar: null });
    say(null, 'anyone going to the Black Cat tonight? 🐾', 42, 'Rexy');
    say(seeded.get('blitzwolf'), 'DJ set starts at 9! come hang', 39);
    say(null, 'omw!! saving a spot by the bar', 35, 'Kiwi');
    say(seeded.get('mochibun'), 'YCH slots still open btw 💕', 12);
    // Sample news (the real app reads VRChat's official Steam announcements).
    news.push(
        { id: 'news1', source: 'furzone', title: 'Welcome to FurZone!', body: 'Be kind, credit artists, and have fun. The Lounge chat is linked with our Discord server.', url: null, published_at: iso(now() - 3 * HOUR) },
        { id: 'news2', source: 'vrchat', title: 'VRChat update (sample)', body: 'This is where VRChat\'s official update notes appear, with a link to the full post.', url: 'https://store.steampowered.com/news/app/438100', published_at: iso(now() - 30 * HOUR) }
    );
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
        return (
            p.user_id === session.userId ||
            rank(session.userId) >= 1 ||
            (!p.hidden && !blocked(session.userId, p.user_id) && !isBanned(p.user_id) && canSeePostsOf(session.userId, p.user_id))
        );
    }
    /** Writes a direct message and updates both people's conversation lists, like send_dm() does. */
    function deliver(from, to, body, at = now()) {
        const msg = { id: id('dm'), sender_id: from, recipient_id: to, body, created_at: iso(at), read_at: null };
        dms.push(msg);
        const mine = threads.get(`${from}:${to}`) || {};
        threads.set(`${from}:${to}`, { ...mine, state: 'open', last_message_at: msg.created_at, last_body: body.slice(0, 140), last_from_me: true, unread: 0 });
        const theirs = threads.get(`${to}:${from}`);
        let state;
        if (theirs && (theirs.state === 'open' || theirs.state === 'archived')) state = theirs.state;
        else if (follows.has(`${to}:${from}`) || dms.some((m) => m.sender_id === to && m.recipient_id === from) || rank(from)) state = 'open';
        else state = 'request';
        threads.set(`${to}:${from}`, { ...(theirs || {}), state, last_message_at: msg.created_at, last_body: body.slice(0, 140), last_from_me: false, unread: ((theirs && theirs.unread) || 0) + 1 });
        return msg;
    }
    /** Same messages as the database's restriction checks. */
    function checkLimits(uid, what) {
        const r = limitsOf(uid);
        if (!r) return;
        const ending = r.until ? ' until ' + new Date(r.until).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        if (r.banned) throw new Error(`Your account is banned${ending}.`);
        if (what === 'post' && r.no_posting) throw new Error(`A moderator turned off posting for your account${ending}.`);
        if (what === 'upload' && r.no_uploads) throw new Error(`A moderator turned off picture and video uploads for your account${ending}.`);
        if (what === 'comment' && r.no_comments) throw new Error(`A moderator turned off commenting for your account${ending}.`);
        if (what === 'profile' && r.no_profile_edits) throw new Error(`A moderator turned off profile changes for your account${ending}.`);
    }
    function staffNeed(min) {
        const mine = rank(me());
        if (mine < min) {
            throw new Error(
                { 1: 'Only staff can do that.', 2: 'Only mods and above can do that.', 3: 'Only admins and the owner can do that.' }[min] || 'Only the owner can do that.'
            );
        }
        return mine;
    }
    function staffTarget(mine, target) {
        if (!profiles.has(target)) throw new Error("That account doesn't exist.");
        if (target === me()) throw new Error("You can't do that to your own account.");
        if (rank(target) >= mine) throw new Error('You can only act on people ranked below you.');
    }
    function note(action, target_user, target_post, details = {}) {
        staffLog.unshift({ id: staffLog.length + 1, actor_id: me(), action, target_user, target_post, details, created_at: iso(now()) });
    }
    /** Same "hot" ranking as the server: top 10 of the last 30 days among posts with hearts or comments. */
    function hotRanks() {
        const cutoff = now() - 30 * 24 * HOUR;
        const score = (p) => (p.boops_count * 3 + p.comments_count * 4 + (p.views_count || 0)) / Math.pow((now() - Date.parse(p.created_at)) / HOUR + 2, 1.3);
        const list = posts
            .filter((p) => !p.hidden && !isBanned(p.user_id) && Date.parse(p.created_at) > cutoff && p.boops_count + p.comments_count > 0)
            .sort((a, b) => score(b) - score(a) || (a.created_at < b.created_at ? 1 : -1));
        return new Map(list.map((p, i) => [p.id, i + 1]));
    }
    function row(p, ranks) {
        const pr = profiles.get(p.user_id);
        const rank = ranks instanceof Map ? ranks.get(p.id) : null;
        return normalizePost(
            {
                ...p,
                trend_rank: rank && rank <= 10 ? rank : null,
                username: pr.username,
                display_name: pr.display_name,
                avatar_path: pr.avatar_path,
                species: pr.species,
                pronouns: pr.pronouns,
                connections: providersOf(pr.id),
                role: staff.get(pr.id) || null,
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
        // The first account made in the demo is the owner, so the staff tools can be tried out.
        if (![...staff.values()].includes('owner')) staff.set(r.id, 'owner');
        // New accounts follow two people so the Following feed isn't empty.
        doFollow(r.id, seeded.get('embertail'));
        doFollow(r.id, seeded.get('neonproto'));
        // A friendly message and a spammy message request, so the inbox has something to show.
        deliver(seeded.get('mochibun'), r.id, 'Hii! Welcome to FurZone 💕 love your vibe', now() - 20 * 60000);
        deliver(vbux.id, r.id, 'FREE VRChat+ for everyone!! just log in at my link 💸💸', now() - 8 * 60000);
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
            // Phone numbers: in the demo no text is sent; the code is always 123456.
            async sendPhoneCode(phone, username) {
                if (!phones.has(phone) && !username) throw new Error('Signups not allowed for otp');
                if (username && !phones.has(phone) && [...profiles.values()].some((p) => p.username === username)) throw new Error('That username is taken.');
                pendingPhone = { phone, username };
                return delay();
            },
            async verifyPhoneCode(phone, code) {
                if (code !== '123456' || !pendingPhone || pendingPhone.phone !== phone) throw new Error('Token has expired or is invalid');
                let uid = phones.get(phone);
                if (!uid) {
                    uid = newAccount('phone:' + phone, null, pendingPhone.username).id;
                    phones.set(phone, uid);
                }
                pendingPhone = null;
                session = { userId: uid, email: null };
                emit('SIGNED_IN');
            },
            async addPhone(phone) {
                me();
                if (phones.has(phone) && phones.get(phone) !== me()) throw new Error('A user with this phone number has already been registered');
                pendingPhone = { phone };
                return delay();
            },
            async confirmPhone(phone, code) {
                const a = me();
                if (code !== '123456' || !pendingPhone || pendingPhone.phone !== phone) throw new Error('Token has expired or is invalid');
                for (const [p, u] of phones) if (u === a) phones.delete(p);
                phones.set(phone, a);
                pendingPhone = null;
            },
            async myPhone() {
                const a = me();
                for (const [p, u] of phones) if (u === a) return p;
                return '';
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
            const r = profiles.get(me());
            return normalizeProfile({ ...r, connections: providersOf(r.id), role: staff.get(r.id) || null, restriction: restrictions.get(r.id) }, mediaUrl);
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
            checkLimits(me(), 'profile');
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
            checkLimits(me(), 'upload');
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

        async feed({ scope = 'all', sort = 'new', before = null, offset = 0, limit = 8, tag = null } = {}) {
            const uid = me();
            const ranks = hotRanks();
            let rows = posts.filter(
                (p) =>
                    canSee(p) &&
                    !p.hidden &&
                    !isBanned(p.user_id) &&
                    (sort === 'popular' || !before || Date.parse(p.created_at) < Date.parse(before)) &&
                    (sort !== 'popular' || ranks.has(p.id)) &&
                    (!tag || p.tags.includes(String(tag).toLowerCase())) &&
                    (scope !== 'following' || p.user_id === uid || follows.has(`${uid}:${p.user_id}`))
            );
            if (sort === 'popular') rows = rows.sort((a, b) => ranks.get(a.id) - ranks.get(b.id)).slice(offset);
            return delay(rows.slice(0, limit).map((p) => row(p, ranks)));
        },
        async likers(postId, limit = 50) {
            const a = me();
            const p = posts.find((x) => x.id === postId && canSee(x));
            if (!p) return [];
            return delay(
                [...boops]
                    .filter((k) => k.endsWith(':' + postId))
                    .map((k) => k.split(':')[0])
                    .filter((u) => profiles.has(u) && !blocked(a, u) && !isBanned(u))
                    .sort((x, y) => Number(follows.has(`${a}:${y}`)) - Number(follows.has(`${a}:${x}`)))
                    .slice(0, limit)
                    .map((u) => ({ ...P(profiles.get(u)), liked_at: boopAt.get(`${u}:${postId}`) || iso(now()) }))
            );
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
            checkLimits(uid, 'post');
            if (file) checkLimits(uid, 'upload');
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
                checkLimits(me(), 'post');
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
            checkLimits(me(), 'any');
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
                    .filter((c) => c.post_id === postId && (c.user_id === uid || rank(uid) >= 1 || (!blocked(uid, c.user_id) && !isBanned(c.user_id))))
                    .map((c) => ({
                        id: c.id,
                        body: c.body,
                        created_at: c.created_at,
                        likes: c.likes || 0,
                        liked: commentLikes.has(`${uid}:${c.id}`),
                        user: { ...P(profiles.get(c.user_id)), you_follow: follows.has(`${uid}:${c.user_id}`), follows_you: follows.has(`${c.user_id}:${uid}`) }
                    }))
            );
        },
        async addComment(postId, body) {
            const uid = me();
            const text = String(body || '').trim();
            if (!text || text.length > 500) throw new Error('Comments are 1–500 characters.');
            checkLimits(uid, 'comment');
            const p = posts.find((x) => x.id === postId && canSee(x));
            if (!p) throw new Error("You can't comment on that.");
            const c = { id: id('cmt'), post_id: postId, user_id: uid, body: text, created_at: iso(now()), likes: 0 };
            comments.push(c);
            p.comments_count++;
            notify(p.user_id, uid, 'comment', p.id);
            return { id: c.id, body: c.body, created_at: c.created_at, likes: 0, liked: false, user: P(profiles.get(uid)) };
        },
        async likeComment(commentId) {
            const uid = me();
            checkLimits(uid, 'any');
            const c = comments.find((x) => x.id === commentId);
            if (!c || blocked(uid, c.user_id)) throw new Error("You can't like that.");
            if (!commentLikes.has(`${uid}:${commentId}`)) {
                commentLikes.add(`${uid}:${commentId}`);
                c.likes = (c.likes || 0) + 1;
            }
        },
        async unlikeComment(commentId) {
            const c = comments.find((x) => x.id === commentId);
            if (c && commentLikes.delete(`${me()}:${commentId}`)) c.likes--;
        },
        async recordView(postId) {
            const uid = me();
            const p = posts.find((x) => x.id === postId);
            if (!p || p.user_id === uid || views.has(`${uid}:${postId}`)) return;
            views.add(`${uid}:${postId}`);
            p.views_count++;
        },
        async explore({ sort = 'trending', range = 'week', type = 'all', offset = 0, limit = 30 } = {}) {
            me();
            const span = { day: 24, week: 168, month: 720 }[range] || Infinity;
            const age = (p) => (now() - Date.parse(p.created_at)) / HOUR;
            const score = (p) => (p.boops_count * 3 + p.comments_count * 4 + p.views_count) / Math.pow(age(p) + 2, 1.3);
            const by = {
                trending: (a, b) => score(b) - score(a),
                popular: (a, b) => b.boops_count - a.boops_count,
                viewed: (a, b) => b.views_count - a.views_count,
                newest: () => 0
            }[sort] || (() => 0);
            const rows = posts
                .filter((p) => !p.hidden && !isBanned(p.user_id) && canSee(p) && age(p) < span)
                .filter((p) => type === 'all' || (type === 'text' ? !p.media_type : p.media_type === type))
                .sort((a, b) => by(a, b) || Date.parse(b.created_at) - Date.parse(a.created_at));
            return delay(rows.slice(offset, offset + limit).map(row));
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
        async report(postId, reason = 'Other') {
            checkLimits(me(), 'any');
            const key = `${me()}:${postId}`;
            if (reports.has(key)) return;
            reports.set(key, { reason, at: iso(now()) });
            const p = posts.find((x) => x.id === postId);
            if (p && ++p.reports_count >= 5) p.hidden = true;
        },
        async follow(userId) {
            checkLimits(me(), 'any');
            if (profiles.get(userId) && profiles.get(userId).is_private && !follows.has(`${me()}:${userId}`)) throw new Error('That account is private: send a follow request.');
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
        // ---- staff: the same rules as the database's staff_* functions ----
        async staffRestriction(userId) {
            staffNeed(1);
            return limitsOf(userId);
        },
        async staffRestrict(userId, c) {
            const mine = staffNeed(2);
            staffTarget(mine, userId);
            const old = restrictions.get(userId);
            if (mine < 3 && old && old.banned && !old.until) throw new Error('Only admins and the owner can change a permanent ban.');
            if (mine < 3 && c.banned && (!c.days || c.days > 30)) throw new Error('Mods can ban for up to 30 days. Ask an admin for longer.');
            const keys = ['banned', 'no_posting', 'no_comments', 'no_uploads', 'no_profile_edits'];
            const lifting = !keys.some((k) => c[k]);
            if (lifting) restrictions.delete(userId);
            else {
                restrictions.set(userId, {
                    ...Object.fromEntries(keys.map((k) => [k, !!c[k]])),
                    reason: String(c.reason || '').trim(),
                    until: c.days ? iso(now() + c.days * 24 * HOUR) : null
                });
            }
            note(lifting ? 'lift' : c.banned ? 'ban' : 'limit', userId, null, { ...c });
            await delay();
        },
        async staffSetRole(userId, role) {
            const mine = staffNeed(3);
            const want = role ? RANKS[role] : 0;
            if (role && (!want || role === 'owner')) throw new Error('Pick staff, mod or admin.');
            staffTarget(mine, userId);
            if (want >= mine) throw new Error('You can only hand out ranks below your own.');
            if (role) staff.set(userId, role);
            else staff.delete(userId);
            note('set_role', userId, null, { role: role || null });
        },
        async staffSetHidden(postId, hidden) {
            const mine = staffNeed(1);
            const p = posts.find((x) => x.id === postId);
            if (!p) throw new Error('That post is gone.');
            staffTarget(mine, p.user_id);
            p.hidden = !!hidden;
            note(hidden ? 'hide_post' : 'unhide_post', p.user_id, p.id);
        },
        async staffDeletePost(postId) {
            const mine = staffNeed(2);
            const i = posts.findIndex((x) => x.id === postId);
            if (i < 0) throw new Error('That post is gone.');
            staffTarget(mine, posts[i].user_id);
            const [p] = posts.splice(i, 1);
            profiles.get(p.user_id).posts_count--;
            for (const k of [...reports.keys()]) if (k.endsWith(':' + postId)) reports.delete(k);
            note('delete_post', p.user_id, p.id, { caption: p.caption.slice(0, 200) });
        },
        async staffDeleteComment(commentId) {
            const mine = staffNeed(2);
            const i = comments.findIndex((c) => c.id === commentId);
            if (i < 0) return;
            staffTarget(mine, comments[i].user_id);
            const [c] = comments.splice(i, 1);
            const p = posts.find((x) => x.id === c.post_id);
            if (p) p.comments_count--;
            note('delete_comment', c.user_id, c.post_id, { body: c.body.slice(0, 200) });
        },
        async staffDismiss(postId) {
            const mine = staffNeed(1);
            const p = posts.find((x) => x.id === postId);
            if (!p) throw new Error('That post is gone.');
            staffTarget(mine, p.user_id);
            for (const k of [...reports.keys()]) if (k.endsWith(':' + postId)) reports.delete(k);
            p.reports_count = 0;
            p.hidden = false;
            note('dismiss_reports', p.user_id, p.id);
        },
        async staffReports() {
            staffNeed(1);
            const byPost = new Map();
            for (const [k, r] of reports) {
                const postId = k.slice(k.indexOf(':') + 1);
                const p = posts.find((x) => x.id === postId);
                if (!p) continue;
                const item = byPost.get(postId) || { p, reasons: new Set(), count: 0, last: r.at };
                item.reasons.add(r.reason);
                item.count++;
                if (r.at > item.last) item.last = r.at;
                byPost.set(postId, item);
            }
            return delay(
                [...byPost.values()]
                    .sort((a, b) => (a.last < b.last ? 1 : -1))
                    .map(({ p, reasons, count, last }) => ({
                        post: { id: p.id, caption: p.caption, media_url: mediaUrl(p.media_path), media_type: p.media_type, hidden: p.hidden },
                        user: P(profiles.get(p.user_id)),
                        reports: count,
                        reasons: [...reasons],
                        last_report: last
                    }))
            );
        },
        async staffLimited() {
            staffNeed(1);
            return [...restrictions.keys()]
                .map((uid) => ({ restriction: limitsOf(uid), user: P(profiles.get(uid)) }))
                .filter((x) => x.restriction && x.user);
        },
        async staffTeam() {
            staffNeed(1);
            return [...staff]
                .filter(([uid]) => profiles.has(uid))
                .map(([uid, role]) => ({ role, granted_at: iso(now()), user: P(profiles.get(uid)) }))
                .sort((a, b) => RANKS[b.role] - RANKS[a.role]);
        },
        async staffLog() {
            staffNeed(3);
            return staffLog.map((e) => ({ ...e, actor: P(profiles.get(e.actor_id)), target: P(profiles.get(e.target_user)) }));
        },

        // ---- privacy ----
        async updatePrivacy(patch) {
            const r = profiles.get(me());
            if ('dm_policy' in patch && !['everyone', 'following', 'nobody'].includes(patch.dm_policy)) throw new Error('Pick everyone, following or nobody.');
            const wasPrivate = r.is_private;
            if ('is_private' in patch) r.is_private = !!patch.is_private;
            if ('dm_policy' in patch) r.dm_policy = patch.dm_policy;
            if (wasPrivate && !r.is_private) {
                for (const k of [...followRequests.keys()]) {
                    const [from, to] = k.split(':');
                    if (to === r.id) {
                        doFollow(from, to);
                        followRequests.delete(k);
                    }
                }
            }
            return this.me();
        },
        async followState(userId) {
            const a = me();
            return follows.has(`${a}:${userId}`) ? 'following' : followRequests.has(`${a}:${userId}`) ? 'requested' : 'none';
        },
        async requestFollow(userId) {
            const a = me();
            checkLimits(a, 'any');
            if (blocked(a, userId)) throw new Error("You can't follow them.");
            if (follows.has(`${a}:${userId}`)) return 'following';
            if (!profiles.get(userId).is_private) {
                doFollow(a, userId);
                return 'following';
            }
            followRequests.set(`${a}:${userId}`, iso(now()));
            return 'requested';
        },
        async cancelFollowRequest(userId) {
            followRequests.delete(`${me()}:${userId}`);
        },
        async followRequests() {
            const a = me();
            return [...followRequests]
                .filter(([k]) => k.endsWith(':' + a))
                .map(([k, at]) => ({ created_at: at, user: P(profiles.get(k.split(':')[0])) }));
        },
        async followers(userId) {
            const a = me();
            if (userId !== a && rank(a) < 1) return [];
            return delay(
                [...follows]
                    .filter((k) => k.endsWith(':' + userId))
                    .map((k) => ({ created_at: followAt.get(k) || iso(now() - 3 * 24 * HOUR), user: P(profiles.get(k.split(':')[0])) }))
                    .sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
            );
        },
        async following(userId) {
            const a = me();
            if (userId !== a && rank(a) < 1) return [];
            return delay(
                [...follows]
                    .filter((k) => k.startsWith(userId + ':'))
                    .map((k) => ({ created_at: followAt.get(k) || iso(now() - 3 * 24 * HOUR), user: P(profiles.get(k.split(':')[1])) }))
                    .sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
            );
        },
        async removeFollower(userId) {
            const a = me();
            if (follows.delete(`${userId}:${a}`)) {
                profiles.get(userId).following_count--;
                profiles.get(a).followers_count--;
            }
        },
        async myInsights() {
            const a = me();
            const mine = posts.filter((p) => p.user_id === a);
            const ids = new Set(mine.map((p) => p.id));
            const week = now() - 7 * 24 * HOUR;
            const fanCount = new Map();
            for (const k of boops) {
                const [u, pid] = k.split(':');
                if (ids.has(pid) && u !== a && !blocked(a, u)) fanCount.set(u, (fanCount.get(u) || 0) + 1);
            }
            for (const c of comments) if (ids.has(c.post_id) && c.user_id !== a && !blocked(a, c.user_id)) fanCount.set(c.user_id, (fanCount.get(c.user_id) || 0) + 1);
            const followerKeys = [...follows].filter((k) => k.endsWith(':' + a));
            return delay({
                posts: mine.length,
                followers: followerKeys.length,
                following: [...follows].filter((k) => k.startsWith(a + ':')).length,
                hearts: mine.reduce((t, p) => t + p.boops_count, 0),
                views: mine.reduce((t, p) => t + (p.views_count || 0), 0),
                comments: mine.reduce((t, p) => t + p.comments_count, 0),
                followers_week: followerKeys.filter((k) => Date.parse(followAt.get(k) || 0) > week).length,
                hearts_week: [...boops].filter((k) => ids.has(k.split(':')[1]) && Date.parse(boopAt.get(k) || 0) > week).length,
                top_fans: [...fanCount.entries()]
                    .sort((x, y) => y[1] - x[1])
                    .slice(0, 5)
                    .map(([u, n]) => ({ ...P(profiles.get(u)), n }))
            });
        },
        async userPopular(userId) {
            me();
            return delay(
                posts
                    .filter((p) => p.user_id === userId && canSee(p))
                    .sort((x, y) => y.boops_count - x.boops_count || (y.views_count || 0) - (x.views_count || 0) || (x.created_at < y.created_at ? 1 : -1))
                    .slice(0, 30)
                    .map(row)
            );
        },
        async followRequestCount() {
            const a = me();
            return [...followRequests.keys()].filter((k) => k.endsWith(':' + a)).length;
        },
        async answerFollowRequest(userId, accept) {
            const a = me();
            if (!followRequests.delete(`${userId}:${a}`)) throw new Error('That request is gone.');
            if (accept) doFollow(userId, a);
        },

        // ---- direct messages ----
        async threads(state = 'open') {
            const a = me();
            return delay(
                [...threads]
                    .filter(([k, t]) => k.startsWith(a + ':') && t.state === state)
                    .map(([k, t]) => ({ other_id: k.split(':')[1], ...t, other: P(profiles.get(k.split(':')[1])) }))
                    .filter((t) => t.other)
                    .sort((x, y) => (x.last_message_at < y.last_message_at ? 1 : -1))
            );
        },
        async thread(otherId) {
            const t = threads.get(`${me()}:${otherId}`);
            return t ? { state: t.state, unread: t.unread } : null;
        },
        async dmCounts() {
            const a = me();
            let unread = 0;
            let requests = 0;
            for (const [k, t] of threads) {
                if (!k.startsWith(a + ':')) continue;
                if (t.state === 'open' || t.state === 'archived') unread += t.unread;
                if (t.state === 'request') requests++;
            }
            return { unread, requests };
        },
        async dmMessages(otherId, before = null) {
            const a = me();
            const cleared = (threads.get(`${a}:${otherId}`) || {}).cleared_at || '';
            return delay(
                dms
                    .filter((m) => ((m.sender_id === a && m.recipient_id === otherId) || (m.sender_id === otherId && m.recipient_id === a)) && m.created_at > cleared && (!before || m.created_at < before))
                    .sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
                    .slice(0, 50)
                    .map((m) => ({ id: m.id, sender_id: m.sender_id, body: m.body, created_at: m.created_at, read_at: m.read_at }))
            );
        },
        async sendDm(otherId, body) {
            const a = me();
            const text = String(body || '').trim();
            const them = profiles.get(otherId);
            if (!them || otherId === a) throw new Error("That account doesn't exist.");
            if (!text || text.length > 2000) throw new Error('Messages are 1-2000 characters.');
            if (blocked(a, otherId)) throw new Error("You can't message them.");
            const r = limitsOf(a);
            if (r && (r.banned || r.no_comments)) throw new Error('A moderator turned off messaging for your account.');
            const theirs = threads.get(`${otherId}:${a}`);
            const known = (theirs && (theirs.state === 'open' || theirs.state === 'archived')) || follows.has(`${otherId}:${a}`) || dms.some((m) => m.sender_id === otherId && m.recipient_id === a) || rank(a);
            if (!known && (them.dm_policy === 'nobody' || them.dm_policy === 'following')) {
                throw new Error(`@${them.username} isn't taking messages from people they don't follow.`);
            }
            const sent = deliver(a, otherId, text).id;
            // Demo only: friendly seeded accounts write back, so the chat feels alive.
            if (DEMO_REPLIES[them.username] && !blocked(a, otherId)) {
                setTimeout(() => {
                    if (!profiles.has(a) || blocked(a, otherId)) return;
                    const msg = deliver(otherId, a, DEMO_REPLIES[them.username][dms.length % DEMO_REPLIES[them.username].length]);
                    for (const fn of dmListeners) fn({ ...msg });
                }, 1600);
            }
            return sent;
        },
        async dmMarkRead(otherId) {
            const a = me();
            for (const m of dms) if (m.sender_id === otherId && m.recipient_id === a && !m.read_at) m.read_at = iso(now());
            const t = threads.get(`${a}:${otherId}`);
            if (t) t.unread = 0;
        },
        async dmSetState(otherId, state) {
            const t = threads.get(`${me()}:${otherId}`);
            if (!t) throw new Error('That conversation is gone.');
            if (!['open', 'archived', 'hidden'].includes(state)) throw new Error('Pick open, archived or hidden.');
            t.state = state;
            if (state === 'hidden') {
                t.cleared_at = iso(now());
                t.unread = 0;
            }
        },
        subscribeDms(fn) {
            dmListeners.add(fn);
            return () => dmListeners.delete(fn);
        },

        // ---- reports about people ----
        async reportUser(userId, reason) {
            const a = me();
            checkLimits(a, 'any');
            if (!['spam', 'scam', 'nuisance', 'bad'].includes(reason)) throw new Error('Pick a reason.');
            if (userId === a) throw new Error("You can't report yourself.");
            if (!userReports.has(`${a}:${userId}`)) userReports.set(`${a}:${userId}`, { reason, at: iso(now()) });
        },
        async staffClearFlag(userId) {
            const mine = staffNeed(2);
            staffTarget(mine, userId);
            flagClears.set(userId, iso(now()));
            note('clear_flag', userId, null);
        },

        // ---- the Lounge ----
        async loungeStatus() {
            return { sending: true, reading: true };
        },
        async loungeMessages() {
            const a = me();
            return delay(
                chat
                    .filter((m) => !m.user_id || m.user_id === a || rank(a) >= 1 || (!blocked(a, m.user_id) && !isBanned(m.user_id)))
                    .slice(-60)
                    .map((m) => ({ ...m, user: m.user_id ? P(profiles.get(m.user_id)) : null }))
            );
        },
        async loungeSend(body) {
            const a = me();
            const text = String(body || '').trim();
            const r = limitsOf(a);
            if (r && (r.banned || r.no_comments)) throw new Error('A moderator turned off chat for your account.');
            if (!text || text.length > 1000) throw new Error('Messages are 1-1000 characters.');
            const m = { id: ++chatSeq, source: 'furzone', user_id: a, body: text, created_at: iso(now()), discord_author: null, discord_avatar: null };
            chat.push(m);
            // Demo only: someone "on Discord" answers now and then.
            if (chat.length % 2 === 0) {
                setTimeout(() => {
                    chat.push({ id: ++chatSeq, source: 'discord', user_id: null, body: LOUNGE_REPLIES[chat.length % LOUNGE_REPLIES.length], created_at: iso(now()), discord_author: 'Kiwi', discord_avatar: null });
                    for (const fn of loungeListeners) fn();
                }, 2200);
            }
            return m;
        },
        async loungeSync() {
            return { added: 0 };
        },
        async loungeCheck() {
            staffNeed(3);
            return [
                { ok: true, text: 'The webhook works: FurZone messages can go to Discord.' },
                { ok: true, text: 'The bot token works (FurZoneBot).' },
                { ok: true, text: 'FurZoneBot can read messages: Discord messages will show in the Lounge.' }
            ];
        },
        async loungeDelete(chatId) {
            const a = me();
            const i = chat.findIndex((m) => m.id === chatId);
            if (i < 0) throw new Error('That message is gone.');
            if (chat[i].user_id !== a && rank(a) < 2) throw new Error('You can only delete your own messages.');
            chat.splice(i, 1);
            for (const fn of loungeListeners) fn();
        },
        subscribeLounge(fn) {
            loungeListeners.add(fn);
            return () => loungeListeners.delete(fn);
        },

        // ---- news ----
        async news() {
            me();
            return [...news].sort((x, y) => (x.published_at < y.published_at ? 1 : -1));
        },
        async refreshNews() {
            return { added: 0 };
        },
        async postAnnouncement(title, body, url) {
            staffNeed(3);
            if (!String(title || '').trim()) throw new Error('Give it a title.');
            if (url && !/^https:\/\//.test(url)) throw new Error('Links must start with https://');
            news.push({ id: id('news'), source: 'furzone', title: title.trim(), body: String(body || '').trim(), url: url || null, published_at: iso(now()) });
            note('announce', null, null, { title });
        },

        // ---- search ----
        async searchPosts(q) {
            me();
            const term = String(q || '').trim().toLowerCase();
            if (term.length < 2) return [];
            const tag = term.replace(/^#/, '');
            return delay(
                posts
                    .filter((p) => canSee(p) && !p.hidden && !isBanned(p.user_id) && (p.tags.includes(tag) || p.caption.toLowerCase().includes(term)))
                    .sort((x, y) => y.boops_count - x.boops_count)
                    .slice(0, 30)
                    .map(row)
            );
        },

        async unlink(provider) {
            const uid = me();
            const i = connections.findIndex((c) => c.user_id === uid && c.provider === provider);
            if (i >= 0) connections.splice(i, 1);
        }
    };
}
