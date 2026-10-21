// The real backend: Supabase (Postgres + Auth + Storage + one Edge Function). Every rule that matters for
// security lives in the database (supabase/schema.sql); this file only shapes requests and answers.
import { createClient } from '@supabase/supabase-js';
import { normalizePost, normalizeProfile, mediaPath } from './shape.js';

const BUCKET = 'media';

export function createSupabaseBackend(url, anonKey) {
    const client = createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
        global: { headers: { 'x-client-info': 'pawst-app' } }
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
            const row = await must(client.from('profiles').select('*').eq('id', id).single());
            const conns = await connectionsOf([id]);
            return shapeProfile({ ...row, connections: conns.get(id) || [] });
        },
        async profileByUsername(username) {
            const row = await must(client.from('profiles').select('*').eq('username', String(username).toLowerCase()).maybeSingle());
            if (!row) return null;
            const conns = await connectionsOf([row.id]);
            return shapeProfile({ ...row, connections: conns.get(row.id) || [] });
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
            return rows.map((r) => shapeProfile({ ...r, connections: conns.get(r.id) || [] }));
        },
        async trendingTags() {
            return must(client.rpc('trending_tags', { p_limit: 12 }));
        },

        async feed({ scope = 'all', before = null, limit = 8, tag = null } = {}) {
            const rows = await must(client.rpc('feed', { p_scope: scope, p_before: before, p_limit: limit, p_tag: tag }));
            return rows.map(shapePost);
        },
        async post(id) {
            const row = await must(client.from('posts').select(`*, profiles!inner(${PROFILE_COLS})`).eq('id', id).maybeSingle());
            if (!row) return null;
            const me = await userId();
            const [booped, following, conns] = await Promise.all([
                client.from('boops').select('post_id').eq('post_id', id).eq('user_id', me).maybeSingle(),
                client.from('follows').select('followee_id').eq('follower_id', me).eq('followee_id', row.user_id).maybeSingle(),
                connectionsOf([row.user_id])
            ]);
            return shapePost({
                ...row,
                ...row.profiles,
                id: row.id,
                booped: !!booped.data,
                following: !!following.data,
                connections: conns.get(row.user_id) || []
            });
        },
        async userPosts(userIdArg, before = null) {
            let q = client
                .from('posts')
                .select(`*, profiles!inner(${PROFILE_COLS})`)
                .eq('user_id', userIdArg)
                .order('created_at', { ascending: false })
                .limit(30);
            if (before) q = q.lt('created_at', before);
            const rows = await must(q);
            return rows.map((r) => shapePost({ ...r, ...r.profiles, id: r.id }));
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
                    .select(`id, body, created_at, user_id, profiles!inner(${PROFILE_COLS})`)
                    .eq('post_id', postId)
                    .order('created_at', { ascending: true })
                    .limit(300)
            );
            return rows.map((r) => ({ id: r.id, body: r.body, created_at: r.created_at, user: shapeProfile(r.profiles) }));
        },
        async addComment(postId, body) {
            const row = await must(client.from('comments').insert({ post_id: postId, body }).select('id, body, created_at').single());
            return { ...row, user: await this.me() };
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
            return rows.map((r) => ({
                id: r.id,
                kind: r.kind,
                created_at: r.created_at,
                read: !!r.read_at,
                post_id: r.post_id,
                actor: shapeProfile(r.actor),
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
