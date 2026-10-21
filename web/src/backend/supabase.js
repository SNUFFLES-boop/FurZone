// The real backend: Supabase (Postgres + Auth + Storage + one Edge Function). Every rule that matters for
// security lives in the database (supabase/schema.sql); this file only shapes requests and answers.
import { createClient } from '@supabase/supabase-js';
import { normalizePost, normalizeProfile, normalizeRestriction, mediaPath } from './shape.js';

const BUCKET = 'media';

export function createSupabaseBackend(url, anonKey) {
    const client = createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
        global: { headers: { 'x-client-info': 'furzone-app' } }
    });

    const mediaUrl = (path) => (path ? client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : '');
    const shapePost = (row) => normalizePost(row, mediaUrl);
    const shapeProfile = (row) => normalizeProfile(row, mediaUrl);
    const PROFILE_COLS = 'id, username, display_name, avatar_path, species, pronouns';

    async function must(promise) {
        const { data, error } = await promise;
        if (error) throw error;
        return data;
    }

    async function session() {
        const { data } = await client.auth.getSession();
        return data.session;
    }

    async function userId() {
        const s = await session();
        if (!s) throw new Error('Not logged in');
        return s.user.id;
    }

    async function connectionsOf(ids) {
        if (!ids.length) return new Map();
        const rows = await must(client.from('connections').select('user_id, provider, handle, external_id').in('user_id', ids));
        const map = new Map();
        for (const r of rows) {
            if (!map.has(r.user_id)) map.set(r.user_id, []);
            map.get(r.user_id).push(r.provider);
        }
        return map;
    }

    async function rolesOf(ids) {
        if (!ids.length) return new Map();
        const rows = await must(client.from('staff').select('user_id, role').in('user_id', ids));
        return new Map(rows.map((r) => [r.user_id, r.role]));
    }

    /** Rank badges and public report labels for a list of people, as Maps by id. */
    async function flagsOf(ids) {
        if (!ids.length) return new Map();
        const rows = await must(client.rpc('user_flags', { ids }));
        return new Map(rows.map((r) => [r.user_id, r.label]));
    }

    async function decorate(people) {
        const ids = [...new Set(people.filter(Boolean).map((p) => p.id))];
        const [roles, flags] = await Promise.all([rolesOf(ids), flagsOf(ids)]);
        for (const p of people) {
            if (!p) continue;
            p.role = roles.get(p.id) || null;
            p.flag = flags.get(p.id) || null;
        }
        return people;
    }

    async function invoke(name, body) {
        const { data, error } = await client.functions.invoke(name, { body });
        if (error) {
            let message = error.message;
            try {
                const b = await error.context.json();
                message = b.error || message;
            } catch {
                // keep the generic message
            }
            const err = new Error(message);
            err.status = error.context && error.context.status;
            throw err;
        }
        return data;
    }

    async function roleOf(id) {
        const row = await must(client.from('staff').select('role').eq('user_id', id).maybeSingle());
        return row ? row.role : null;
    }

    /** Uploads with progress (supabase-js can't report it), straight to Storage's REST endpoint. */
    async function upload(path, blob, contentType, onProgress) {
        const s = await session();
        if (!s) throw new Error('Not logged in');
        const target = `${url}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
        await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', target);
            xhr.setRequestHeader('Authorization', 'Bearer ' + s.access_token);
            xhr.setRequestHeader('apikey', anonKey);
            xhr.setRequestHeader('Content-Type', contentType);
            xhr.setRequestHeader('x-upsert', 'false');
            xhr.setRequestHeader('cache-control', 'max-age=31536000');
            xhr.upload.onprogress = (e) => onProgress && e.lengthComputable && onProgress(e.loaded / e.total);
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) return resolve();
                let message = 'Upload failed (' + xhr.status + ')';
                try {
                    message = JSON.parse(xhr.responseText).message || message;
                } catch {
                    // keep the status text
                }
                if (xhr.status === 413 || /size/i.test(message)) message = 'That file is too big (50 MB max).';
                if (/mime/i.test(message)) message = 'That file type is not allowed.';
                reject(new Error(message));
            };
            xhr.onerror = () => reject(new Error('Upload failed: network error'));
            xhr.send(blob);
        });
    }

    async function oauthUrl(kind, redirectTo) {
        const options = { redirectTo, skipBrowserRedirect: true, scopes: 'identify' };
        const data =
            kind === 'link'
                ? await must(client.auth.linkIdentity({ provider: 'discord', options }))
                : await must(client.auth.signInWithOAuth({ provider: 'discord', options }));
        return data.url;
    }

    return {
        kind: 'supabase',
        mediaUrl,

        auth: {
            async session() {
                const s = await session();
                return s ? { userId: s.user.id, email: s.user.email } : null;
            },
            onChange(cb) {
                const { data } = client.auth.onAuthStateChange((event, s) => {
                    cb(event, s ? { userId: s.user.id, email: s.user.email } : null);
                });
                return () => data.subscription.unsubscribe();
            },
            async signIn(email, password) {
                await must(client.auth.signInWithPassword({ email, password }));
            },
            /** Returns { needsConfirmation } when the project asks people to confirm their email first. */
            async signUp(email, password, username) {
                const data = await must(
                    client.auth.signUp({ email, password, options: { data: { username, display_name: username } } })
                );
                return { needsConfirmation: !data.session };
            },
            async signOut() {
                await client.auth.signOut();
            },
            async usernameAvailable(name) {
                return Boolean(await must(client.rpc('username_available', { name })));
            },
            async sendResetCode(email) {
                await must(client.auth.resetPasswordForEmail(email));
            },
            async resetPassword(email, code, newPassword) {
                await must(client.auth.verifyOtp({ email, token: code, type: 'recovery' }));
                await must(client.auth.updateUser({ password: newPassword }));
            },
            async changePassword(newPassword) {
                await must(client.auth.updateUser({ password: newPassword }));
            },
            /** Where to send the person to log in with Discord (the app navigates there). */
            discordLoginUrl: (redirectTo) => oauthUrl('login', redirectTo),
            discordLinkUrl: (redirectTo) => oauthUrl('link', redirectTo),
            /** After Discord sends people back: trade the one-time code for a session. */
            async finishOAuth(href) {
                const u = new URL(href);
                const params = new URLSearchParams(u.search + '&' + u.hash.replace(/^#/, ''));
                const err = params.get('error_description') || params.get('error');
                if (err) throw new Error(err.replace(/\+/g, ' '));
                const code = params.get('code');
                if (!code) return false;
                await must(client.auth.exchangeCodeForSession(code));
                return true;
            },
            async hasPassword() {
                const s = await session();
                return !!(s && s.user.identities && s.user.identities.some((i) => i.provider === 'email'));
            },
            async deleteAccount() {
                const id = await userId();
                // Files first: once the account is gone, they can't be reached to delete them.
                const files = await client.storage.from(BUCKET).list(id, { limit: 1000 });
                if (!files.error && files.data.length) {
                    await client.storage.from(BUCKET).remove(files.data.map((f) => `${id}/${f.name}`));
                }
                await must(client.rpc('delete_my_account'));
                await client.auth.signOut();
            }
        },

        async me() {
            const id = await userId();
            const [row, conns, role, restriction] = await Promise.all([
                must(client.from('profiles').select('*').eq('id', id).single()),
                connectionsOf([id]),
                roleOf(id),
                must(client.from('restrictions').select('*').eq('user_id', id).maybeSingle())
            ]);
            return shapeProfile({ ...row, connections: conns.get(id) || [], role, restriction });
        },
        async profileByUsername(username) {
            const row = await must(client.from('profiles').select('*').eq('username', String(username).toLowerCase()).maybeSingle());
            if (!row) return null;
            const [conns, role, flags] = await Promise.all([connectionsOf([row.id]), roleOf(row.id), flagsOf([row.id])]);
            return shapeProfile({ ...row, connections: conns.get(row.id) || [], role, flag: flags.get(row.id) || null });
        },
        async connections(userIdArg) {
            return must(client.from('connections').select('provider, handle, external_id, verified_at').eq('user_id', userIdArg));
        },
        async updateProfile(patch) {
            const id = await userId();
            const allowed = {};
            for (const k of ['username', 'display_name', 'pronouns', 'species', 'bio', 'avatar_path', 'banner_path', 'ref_path']) {
                if (k in patch) allowed[k] = patch[k];
            }
            await must(client.from('profiles').update(allowed).eq('id', id));
            return this.me();
        },
        /** kind: avatar | banner | ref */
        async uploadImage(kind, blob) {
            const id = await userId();
            const type = blob.type || 'image/jpeg';
            const path = mediaPath(id, kind, type);
            await upload(path, blob, type);
            const column = kind + '_path';
            const old = (await this.me())[column];
            const updated = await this.updateProfile({ [column]: path });
            if (old) await client.storage.from(BUCKET).remove([old]);
            return updated;
        },
        async searchUsers(q) {
            const term = String(q || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
            if (!term) return [];
            const rows = await must(
                client
                    .from('profiles')
                    .select('*')
                    .or(`username.ilike.%${term}%,species.ilike.%${term}%`)
                    .order('followers_count', { ascending: false })
                    .limit(20)
            );
            const conns = await connectionsOf(rows.map((r) => r.id));
            return decorate(rows.map((r) => shapeProfile({ ...r, connections: conns.get(r.id) || [] })));
        },
        async trendingTags() {
            return must(client.rpc('trending_tags', { p_limit: 12 }));
        },

        async feed({ scope = 'all', before = null, limit = 8, tag = null } = {}) {
            const rows = await must(client.rpc('feed', { p_scope: scope, p_before: before, p_limit: limit, p_tag: tag }));
            const roles = await rolesOf([...new Set(rows.map((r) => r.user_id))]);
            return rows.map((r) => shapePost({ ...r, role: roles.get(r.user_id) || null }));
        },
        async post(id) {
            const row = await must(client.from('posts').select(`*, profiles!posts_user_id_fkey!inner(${PROFILE_COLS})`).eq('id', id).maybeSingle());
            if (!row) return null;
            const me = await userId();
            const [booped, following, conns, role] = await Promise.all([
                client.from('boops').select('post_id').eq('post_id', id).eq('user_id', me).maybeSingle(),
                client.from('follows').select('followee_id').eq('follower_id', me).eq('followee_id', row.user_id).maybeSingle(),
                connectionsOf([row.user_id]),
                roleOf(row.user_id)
            ]);
            return shapePost({
                ...row,
                ...row.profiles,
                id: row.id,
                booped: !!booped.data,
                following: !!following.data,
                connections: conns.get(row.user_id) || [],
                role
            });
        },
        async userPosts(userIdArg, before = null) {
            let q = client
                .from('posts')
                .select(`*, profiles!posts_user_id_fkey!inner(${PROFILE_COLS})`)
                .eq('user_id', userIdArg)
                .order('created_at', { ascending: false })
                .limit(30);
            if (before) q = q.lt('created_at', before);
            const rows = await must(q);
            const role = await roleOf(userIdArg);
            return rows.map((r) => shapePost({ ...r, ...r.profiles, id: r.id, role }));
        },
        async createPost({ caption, credit, file, mediaType }, onProgress) {
            const id = await userId();
            let media_path = null;
            if (file) {
                media_path = mediaPath(id, mediaType, file.type);
                await upload(media_path, file, file.type, onProgress);
            }
            try {
                const row = await must(
                    client
                        .from('posts')
                        .insert({ caption: caption || '', credit: credit || '', media_path, media_type: file ? mediaType : null })
                        .select('*')
                        .single()
                );
                const me = await this.me();
                return shapePost({ ...row, ...me, id: row.id, user_id: me.id });
            } catch (error) {
                if (media_path) await client.storage.from(BUCKET).remove([media_path]);
                throw error;
            }
        },
        async editPost(postId, { caption, credit }) {
            await must(client.from('posts').update({ caption, credit }).eq('id', postId));
        },
        async deletePost(post) {
            await must(client.from('posts').delete().eq('id', post.id));
            if (post.media_path) await client.storage.from(BUCKET).remove([post.media_path]);
        },
        async boop(postId) {
            const { error } = await client.from('boops').insert({ post_id: postId });
            if (error && error.code !== '23505') throw error; // already booped is fine
        },
        async unboop(postId) {
            const id = await userId();
            await must(client.from('boops').delete().eq('post_id', postId).eq('user_id', id));
        },
        async comments(postId) {
            const rows = await must(
                client
                    .from('comments')
                    .select(`id, body, created_at, user_id, boops_count, profiles!comments_user_id_fkey!inner(${PROFILE_COLS})`)
                    .eq('post_id', postId)
                    .order('created_at', { ascending: true })
                    .limit(300)
            );
            const me = await userId();
            const people = [...new Set(rows.map((r) => r.user_id))];
            const ids = rows.map((r) => r.id);
            const [roles, liked, iFollow, followMe, flags] = await Promise.all([
                rolesOf(people),
                ids.length ? must(client.from('comment_boops').select('comment_id').eq('user_id', me).in('comment_id', ids)) : [],
                people.length ? must(client.from('follows').select('followee_id').eq('follower_id', me).in('followee_id', people)) : [],
                people.length ? must(client.from('follows').select('follower_id').eq('followee_id', me).in('follower_id', people)) : [],
                flagsOf(people)
            ]);
            const likedSet = new Set(liked.map((r) => r.comment_id));
            const following = new Set(iFollow.map((r) => r.followee_id));
            const followers = new Set(followMe.map((r) => r.follower_id));
            return rows.map((r) => ({
                id: r.id,
                body: r.body,
                created_at: r.created_at,
                likes: Number(r.boops_count) || 0,
                liked: likedSet.has(r.id),
                user: {
                    ...shapeProfile({ ...r.profiles, role: roles.get(r.user_id) || null, flag: flags.get(r.user_id) || null }),
                    you_follow: following.has(r.user_id),
                    follows_you: followers.has(r.user_id)
                }
            }));
        },
        async addComment(postId, body) {
            const row = await must(client.from('comments').insert({ post_id: postId, body }).select('id, body, created_at').single());
            return { ...row, user: await this.me() };
        },
        async likeComment(commentId) {
            const { error } = await client.from('comment_boops').insert({ comment_id: commentId });
            if (error && error.code !== '23505') throw error;
        },
        async unlikeComment(commentId) {
            const id = await userId();
            await must(client.from('comment_boops').delete().eq('comment_id', commentId).eq('user_id', id));
        },
        /** Counts a view (once per person; the database ignores your own posts). Never fails loudly. */
        async recordView(postId) {
            await client.rpc('record_view', { p_post: postId });
        },
        async explore({ sort = 'trending', range = 'week', type = 'all', offset = 0, limit = 30 } = {}) {
            const rows = await must(client.rpc('explore', { p_sort: sort, p_range: range, p_type: type, p_limit: limit, p_offset: offset }));
            return rows.map(shapePost);
        },
        async deleteComment(commentId) {
            await must(client.from('comments').delete().eq('id', commentId));
        },
        async report(postId, reason) {
            const { error } = await client.from('reports').insert({ post_id: postId, reason });
            if (error && error.code !== '23505') throw error;
        },
        async follow(userIdArg) {
            const { error } = await client.from('follows').insert({ followee_id: userIdArg });
            if (error && error.code !== '23505') throw error;
        },
        async unfollow(userIdArg) {
            const id = await userId();
            await must(client.from('follows').delete().eq('follower_id', id).eq('followee_id', userIdArg));
        },
        async isFollowing(userIdArg) {
            const id = await userId();
            return !!(await must(
                client.from('follows').select('followee_id').eq('follower_id', id).eq('followee_id', userIdArg).maybeSingle()
            ));
        },
        async block(userIdArg) {
            const { error } = await client.from('blocks').insert({ blocked_id: userIdArg });
            if (error && error.code !== '23505') throw error;
        },
        async unblock(userIdArg) {
            const id = await userId();
            await must(client.from('blocks').delete().eq('blocker_id', id).eq('blocked_id', userIdArg));
        },
        async blocked() {
            const rows = await must(
                client.from('blocks').select('blocked_id, created_at').order('created_at', { ascending: false })
            );
            if (!rows.length) return [];
            const profiles = await must(client.from('profiles').select('*').in('id', rows.map((r) => r.blocked_id)));
            return profiles.map(shapeProfile);
        },
        async notifications() {
            const rows = await must(
                client
                    .from('notifications')
                    .select(
                        `id, kind, created_at, read_at, post_id,
                         actor:profiles!notifications_actor_id_fkey(${PROFILE_COLS}),
                         post:posts(media_path, media_type, caption)`
                    )
                    .order('created_at', { ascending: false })
                    .limit(100)
            );
            const actors = rows.map((r) => shapeProfile(r.actor));
            await decorate(actors);
            return rows.map((r, i) => ({
                id: r.id,
                kind: r.kind,
                created_at: r.created_at,
                read: !!r.read_at,
                post_id: r.post_id,
                actor: actors[i],
                post: r.post ? { media_url: mediaUrl(r.post.media_path), media_type: r.post.media_type, caption: r.post.caption } : null
            }));
        },
        async unreadCount() {
            const { count, error } = await client.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
            if (error) throw error;
            return count || 0;
        },
        async markNotificationsRead() {
            await must(client.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null));
        },
        async startVrchatLink(vrchatUserId) {
            return must(client.rpc('start_vrchat_link', { vrchat_user_id: vrchatUserId }));
        },
        async verifyVrchat() {
            const { data, error } = await client.functions.invoke('vrchat-verify', { body: {} });
            if (error) {
                let message = error.message;
                try {
                    const body = await error.context.json();
                    message = body.error || message;
                } catch {
                    // keep the generic message
                }
                throw new Error(message);
            }
            return data;
        },
        // ---- staff (every rule is checked again by the database) ----
        async staffRestriction(userIdArg) {
            return normalizeRestriction(await must(client.from('restrictions').select('*').eq('user_id', userIdArg).maybeSingle()));
        },
        async staffRestrict(userIdArg, c) {
            await must(
                client.rpc('staff_restrict', {
                    target: userIdArg,
                    p_banned: !!c.banned,
                    p_no_posting: !!c.no_posting,
                    p_no_comments: !!c.no_comments,
                    p_no_uploads: !!c.no_uploads,
                    p_no_profile_edits: !!c.no_profile_edits,
                    p_days: c.days || null,
                    p_reason: c.reason || ''
                })
            );
        },
        async staffSetRole(userIdArg, role) {
            await must(client.rpc('staff_set_role', { target: userIdArg, new_role: role || null }));
        },
        async staffSetHidden(postId, hidden) {
            await must(client.rpc('staff_set_post_hidden', { p_post: postId, p_hidden: hidden }));
        },
        async staffDeletePost(postId) {
            const path = await must(client.rpc('staff_delete_post', { p_post: postId }));
            if (path) await client.storage.from(BUCKET).remove([path]);
        },
        async staffDeleteComment(commentId) {
            await must(client.rpc('staff_delete_comment', { p_comment: commentId }));
        },
        async staffDismiss(postId) {
            await must(client.rpc('staff_dismiss_reports', { p_post: postId }));
        },
        async staffReports() {
            const rows = await must(client.rpc('staff_reports'));
            return rows.map((r) => ({
                post: { id: r.post_id, caption: r.caption || '', media_url: mediaUrl(r.media_path), media_type: r.media_type, hidden: r.hidden },
                user: shapeProfile({ id: r.user_id, username: r.username, display_name: r.display_name, avatar_path: r.avatar_path }),
                reports: Number(r.reports) || 0,
                reasons: r.reasons || [],
                last_report: r.last_report
            }));
        },
        async staffLimited() {
            const rows = await must(
                client
                    .from('restrictions')
                    .select(`*, user:profiles!restrictions_user_id_fkey(${PROFILE_COLS})`)
                    .order('set_at', { ascending: false })
                    .limit(200)
            );
            const roles = await rolesOf(rows.map((r) => r.user_id));
            return rows
                .map((r) => ({ restriction: normalizeRestriction(r), user: shapeProfile({ ...r.user, role: roles.get(r.user_id) || null }) }))
                .filter((x) => x.restriction);
        },
        async staffTeam() {
            const rows = await must(
                client.from('staff').select(`role, granted_at, user:profiles!staff_user_id_fkey(${PROFILE_COLS})`).order('granted_at', { ascending: true })
            );
            const order = { owner: 0, admin: 1, mod: 2, staff: 3 };
            return rows
                .map((r) => ({ role: r.role, granted_at: r.granted_at, user: shapeProfile(r.user) }))
                .sort((a, b) => order[a.role] - order[b.role]);
        },
        async staffLog() {
            const rows = await must(
                client
                    .from('staff_log')
                    .select(
                        `id, action, target_post, details, created_at,
                         actor:profiles!staff_log_actor_id_fkey(${PROFILE_COLS}),
                         target:profiles!staff_log_target_user_fkey(${PROFILE_COLS})`
                    )
                    .order('created_at', { ascending: false })
                    .limit(200)
            );
            return rows.map((r) => ({ ...r, actor: shapeProfile(r.actor), target: shapeProfile(r.target) }));
        },

        // ---- privacy ----
        async updatePrivacy(patch) {
            const id = await userId();
            const allowed = {};
            for (const k of ['is_private', 'dm_policy']) if (k in patch) allowed[k] = patch[k];
            await must(client.from('profiles').update(allowed).eq('id', id));
            return this.me();
        },
        /** 'following' | 'requested' | 'none' */
        async followState(userIdArg) {
            const me = await userId();
            const [f, r] = await Promise.all([
                client.from('follows').select('followee_id').eq('follower_id', me).eq('followee_id', userIdArg).maybeSingle(),
                client.from('follow_requests').select('target_id').eq('requester_id', me).eq('target_id', userIdArg).maybeSingle()
            ]);
            return f.data ? 'following' : r.data ? 'requested' : 'none';
        },
        async requestFollow(userIdArg) {
            return must(client.rpc('request_follow', { target: userIdArg }));
        },
        async cancelFollowRequest(userIdArg) {
            const me = await userId();
            await must(client.from('follow_requests').delete().eq('requester_id', me).eq('target_id', userIdArg));
        },
        async followRequests() {
            const me = await userId();
            const rows = await must(
                client
                    .from('follow_requests')
                    .select(`created_at, requester:profiles!follow_requests_requester_id_fkey(${PROFILE_COLS})`)
                    .eq('target_id', me)
                    .order('created_at', { ascending: false })
            );
            const people = await decorate(rows.map((r) => shapeProfile(r.requester)));
            return rows.map((r, i) => ({ created_at: r.created_at, user: people[i] }));
        },
        /** People who follow userIdArg (only works for your own profile; the database keeps lists private). */
        async followers(userIdArg) {
            const rows = await must(
                client
                    .from('follows')
                    .select(`created_at, who:profiles!follows_follower_id_fkey(${PROFILE_COLS})`)
                    .eq('followee_id', userIdArg)
                    .order('created_at', { ascending: false })
                    .limit(500)
            );
            const people = await decorate(rows.map((r) => shapeProfile(r.who)));
            return rows.map((r, i) => ({ created_at: r.created_at, user: people[i] }));
        },
        async following(userIdArg) {
            const rows = await must(
                client
                    .from('follows')
                    .select(`created_at, who:profiles!follows_followee_id_fkey(${PROFILE_COLS})`)
                    .eq('follower_id', userIdArg)
                    .order('created_at', { ascending: false })
                    .limit(500)
            );
            const people = await decorate(rows.map((r) => shapeProfile(r.who)));
            return rows.map((r, i) => ({ created_at: r.created_at, user: people[i] }));
        },
        async removeFollower(userIdArg) {
            const me = await userId();
            await must(client.from('follows').delete().eq('follower_id', userIdArg).eq('followee_id', me));
        },
        async myInsights() {
            const data = await must(client.rpc('my_insights'));
            const fans = await decorate((data.top_fans || []).map((f) => ({ ...shapeProfile(f), n: f.n })));
            return { ...data, top_fans: fans };
        },
        /** Someone's posts with the most hearts (then views) first. */
        async userPopular(userIdArg) {
            const rows = await must(
                client
                    .from('posts')
                    .select(`*, profiles!posts_user_id_fkey!inner(${PROFILE_COLS})`)
                    .eq('user_id', userIdArg)
                    .order('boops_count', { ascending: false })
                    .order('views_count', { ascending: false })
                    .order('created_at', { ascending: false })
                    .limit(30)
            );
            const role = await roleOf(userIdArg);
            return rows.map((r) => shapePost({ ...r, ...r.profiles, id: r.id, role }));
        },
        async followRequestCount() {
            const me = await userId();
            const { count, error } = await client.from('follow_requests').select('requester_id', { count: 'exact', head: true }).eq('target_id', me);
            if (error) throw error;
            return count || 0;
        },
        async answerFollowRequest(userIdArg, accept) {
            await must(client.rpc('answer_follow_request', { requester: userIdArg, accept }));
        },

        // ---- direct messages ----
        async threads(state = 'open') {
            const me = await userId();
            const rows = await must(
                client
                    .from('dm_threads')
                    .select(`other_id, state, last_message_at, last_body, last_from_me, unread, other:profiles!dm_threads_other_id_fkey(${PROFILE_COLS})`)
                    .eq('user_id', me)
                    .eq('state', state)
                    .order('last_message_at', { ascending: false })
                    .limit(100)
            );
            const people = await decorate(rows.map((r) => shapeProfile(r.other)));
            return rows.map((r, i) => ({ ...r, other: people[i] }));
        },
        async thread(otherId) {
            const me = await userId();
            return must(client.from('dm_threads').select('state, unread').eq('user_id', me).eq('other_id', otherId).maybeSingle());
        },
        async dmCounts() {
            const [row] = await must(client.rpc('dm_counts'));
            return { unread: Number(row && row.unread) || 0, requests: Number(row && row.requests) || 0 };
        },
        async dmMessages(otherId, before = null) {
            return must(client.rpc('dm_messages', { other: otherId, p_before: before, p_limit: 50 }));
        },
        async sendDm(otherId, body) {
            return must(client.rpc('send_dm', { target: otherId, body }));
        },
        async dmMarkRead(otherId) {
            await must(client.rpc('dm_mark_read', { other: otherId }));
        },
        async dmSetState(otherId, state) {
            await must(client.rpc('dm_set_state', { other: otherId, new_state: state }));
        },
        /** Calls back when a message arrives for you. Returns a function that stops listening. */
        subscribeDms(onMessage) {
            let channel = null;
            userId()
                .then((me) => {
                    channel = client
                        .channel('dm-' + me)
                        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${me}` }, (p) => onMessage(p.new))
                        .subscribe();
                })
                .catch(() => {});
            return () => channel && client.removeChannel(channel);
        },

        // ---- reports about people ----
        async reportUser(userIdArg, reason, details = '') {
            const { error } = await client.from('user_reports').insert({ target_id: userIdArg, reason, details });
            if (error && error.code !== '23505') throw error;
        },
        async staffClearFlag(userIdArg) {
            await must(client.rpc('staff_clear_flag', { target: userIdArg }));
        },

        // ---- the Lounge ----
        async loungeStatus() {
            try {
                return await invoke('furzone-lounge', { action: 'status' });
            } catch {
                return { sending: false, reading: false };
            }
        },
        async loungeMessages(before = null) {
            let q = client
                .from('chat_messages')
                .select(`id, source, body, created_at, user_id, discord_author, discord_avatar, user:profiles!chat_messages_user_id_fkey(${PROFILE_COLS})`)
                .order('created_at', { ascending: false })
                .limit(60);
            if (before) q = q.lt('created_at', before);
            const rows = await must(q);
            const people = await decorate(rows.map((r) => (r.user ? shapeProfile(r.user) : null)));
            return rows.map((r, i) => ({ ...r, user: people[i] })).reverse();
        },
        async loungeSend(body) {
            try {
                return await invoke('furzone-lounge', { action: 'send', body });
            } catch (e) {
                // The bridge isn't deployed: post straight to the Lounge (FurZone only).
                if (e.status === 404) return must(client.from('chat_messages').insert({ body }).select('*').single());
                throw e;
            }
        },
        async loungeSync() {
            try {
                return await invoke('furzone-lounge', { action: 'sync' });
            } catch (e) {
                return { added: 0, error: e.message };
            }
        },
        /** Admins: which parts of the Discord link work, and what to fix. */
        async loungeCheck() {
            return (await invoke('furzone-lounge', { action: 'check' })).checks || [];
        },
        async loungeDelete(id) {
            await must(client.from('chat_messages').delete().eq('id', id));
        },
        subscribeLounge(onChange) {
            const channel = client
                .channel('lounge')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => onChange())
                .subscribe();
            return () => client.removeChannel(channel);
        },

        // ---- news ----
        async news() {
            return must(client.from('announcements').select('*').order('published_at', { ascending: false }).limit(40));
        },
        async refreshNews() {
            try {
                return await invoke('vrchat-news', {});
            } catch {
                return { added: 0 };
            }
        },
        async postAnnouncement(title, body, url) {
            return must(client.rpc('post_announcement', { p_title: title, p_body: body, p_url: url || null }));
        },

        // ---- search ----
        async searchPosts(q) {
            const rows = await must(client.rpc('search_posts', { p_query: q, p_limit: 30 }));
            return rows.map(shapePost);
        },

        async unlink(provider) {
            const id = await userId();
            if (provider === 'discord') {
                const { data } = await client.auth.getUserIdentities();
                const identity = data && data.identities.find((i) => i.provider === 'discord');
                if (identity) await must(client.auth.unlinkIdentity(identity));
            }
            await must(client.from('connections').delete().eq('user_id', id).eq('provider', provider));
        }
    };
}
