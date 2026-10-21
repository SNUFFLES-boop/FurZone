// Runs the app's real server queries against PostgREST (the API Supabase uses) on a local Postgres loaded with
// supabase/schema.sql. Catches queries the database tests can't, like ambiguous joins. Set up by
// scripts/server-test.sh, which starts Postgres and PostgREST first.
import crypto from 'node:crypto';
const SECRET = process.env.PGRST_JWT_SECRET || 'a-local-test-secret-that-is-at-least-32-chars';
const API = process.env.PGRST_URL || 'http://localhost:3999';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(sub) {
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64({ role: 'authenticated', sub, exp: Math.floor(Date.now() / 1000) + 3600 });
    const sig = crypto.createHmac('sha256', SECRET).update(head + '.' + body).digest('base64url');
    return `${head}.${body}.${sig}`;
}
const OWNER = '11111111-1111-4111-8111-111111111111', FUR = '22222222-2222-4222-8222-222222222222';
const PC = 'id, username, display_name, avatar_path, species, pronouns';
async function call(who, path, opts = {}) {
    const res = await fetch(API + path, {
        ...opts,
        headers: { Authorization: 'Bearer ' + jwt(who), 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) }
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}
const q = (s) => encodeURIComponent(s.replace(/\s+/g, ' '));
let fails = 0;
function check(name, r, ok = (r) => r.status < 300) {
    const good = ok(r);
    if (!good) fails++;
    console.log((good ? 'ok   ' : 'FAIL ') + name + (good ? '' : ' -> ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200)));
}
const post = (await call(FUR, '/posts', { method: 'POST', body: JSON.stringify({ caption: 'hello #test' }) })).body[0];
await call(OWNER, '/boops', { method: 'POST', body: JSON.stringify({ post_id: post.id }) });
await call(OWNER, '/comments', { method: 'POST', body: JSON.stringify({ post_id: post.id, body: 'nice' }) });
check('file a report (like the app: no read-back)', await call(OWNER, '/reports', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ post_id: post.id, reason: 'Spam' }) }));

check('OLD posts embed (expected to fail, the bug)', await call(OWNER, `/posts?select=${q(`*, profiles!inner(${PC})`)}&id=eq.${post.id}`), (r) => r.status === 300 || /more than one relationship/.test(JSON.stringify(r.body)));
check('post page: posts + author', await call(OWNER, `/posts?select=${q(`*, profiles!posts_user_id_fkey!inner(${PC})`)}&id=eq.${post.id}`), (r) => r.status === 200 && r.body[0].profiles.username === 'fur2');
check('profile grid: user posts', await call(OWNER, `/posts?select=${q(`*, profiles!posts_user_id_fkey!inner(${PC})`)}&user_id=eq.${FUR}&order=created_at.desc&limit=30`), (r) => r.status === 200 && r.body.length === 1);
check('comments + author', await call(FUR, `/comments?select=${q(`id, body, created_at, user_id, profiles!comments_user_id_fkey!inner(${PC})`)}&post_id=eq.${post.id}`), (r) => r.status === 200 && r.body[0].profiles.username === 'owner1');
check('inbox notifications', await call(FUR, `/notifications?select=${q(`id, kind, created_at, read_at, post_id, actor:profiles!notifications_actor_id_fkey(${PC}), post:posts(media_path, media_type, caption)`)}&order=created_at.desc`), (r) => r.status === 200 && r.body.length >= 1 && r.body[0].actor.username === 'owner1');
check('feed rpc', await call(OWNER, '/rpc/feed', { method: 'POST', body: JSON.stringify({ p_scope: 'all', p_before: null, p_limit: 8, p_tag: null }) }), (r) => r.status === 200 && r.body.length === 1);
check('staff roles lookup', await call(FUR, `/staff?select=user_id,role&user_id=in.(${OWNER},${FUR})`), (r) => r.status === 200 && r.body[0].role === 'owner');
check('own restrictions', await call(FUR, `/restrictions?select=*&user_id=eq.${FUR}`));
check('staff: reports list', await call(OWNER, '/rpc/staff_reports', { method: 'POST', body: '{}' }), (r) => r.status === 200 && r.body[0].username === 'fur2');
check('staff: limit someone', await call(OWNER, '/rpc/staff_restrict', { method: 'POST', body: JSON.stringify({ target: FUR, p_banned: true, p_no_posting: false, p_no_comments: false, p_no_uploads: false, p_no_profile_edits: false, p_days: 7, p_reason: 'test' }) }));
check('staff: Bans list', await call(OWNER, `/restrictions?select=${q(`*, user:profiles!restrictions_user_id_fkey(${PC})`)}&order=set_at.desc&limit=200`), (r) => r.status === 200 && r.body[0].user.username === 'fur2' && r.body[0].banned);
check('banned person cannot post', await call(FUR, '/posts', { method: 'POST', body: JSON.stringify({ caption: 'nope' }) }), (r) => r.status >= 400 && /banned/.test(r.body.message));
check('staff: unban', await call(OWNER, '/rpc/staff_restrict', { method: 'POST', body: JSON.stringify({ target: FUR, p_banned: false, p_no_posting: false, p_no_comments: false, p_no_uploads: false, p_no_profile_edits: false, p_days: null, p_reason: '' }) }));
check('unbanned person can post again', await call(FUR, '/posts', { method: 'POST', body: JSON.stringify({ caption: 'back' }) }));
check('staff: team', await call(OWNER, `/staff?select=${q(`role, granted_at, user:profiles!staff_user_id_fkey(${PC})`)}&order=granted_at.asc`), (r) => r.status === 200 && r.body[0].user.username === 'owner1');
check('staff: log', await call(OWNER, `/staff_log?select=${q(`id, action, target_post, details, created_at, actor:profiles!staff_log_actor_id_fkey(${PC}), target:profiles!staff_log_target_user_fkey(${PC})`)}&order=created_at.desc&limit=200`), (r) => r.status === 200 && r.body.length === 2 && r.body[0].actor.username === 'owner1');
check('staff: hide post', await call(OWNER, '/rpc/staff_set_post_hidden', { method: 'POST', body: JSON.stringify({ p_post: post.id, p_hidden: true }) }));
check('staff: Looks fine', await call(OWNER, '/rpc/staff_dismiss_reports', { method: 'POST', body: JSON.stringify({ p_post: post.id }) }));
const cm = (await call(FUR, '/comments', { method: 'POST', body: JSON.stringify({ post_id: post.id, body: 'mean' }) })).body[0];
check('staff: delete comment', await call(OWNER, '/rpc/staff_delete_comment', { method: 'POST', body: JSON.stringify({ p_comment: cm.id }) }));
check('staff: delete post', await call(OWNER, '/rpc/staff_delete_post', { method: 'POST', body: JSON.stringify({ p_post: post.id }) }));
check('normal person cannot use staff tools', await call(FUR, '/rpc/staff_reports', { method: 'POST', body: '{}' }), (r) => r.status >= 400 && /Only staff/.test(r.body.message));
console.log(fails ? `${fails} FAILED` : 'all server queries work');
process.exit(fails ? 1 : 0);
