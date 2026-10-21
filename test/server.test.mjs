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
check('comments + author + likes', await call(FUR, `/comments?select=${q(`id, body, created_at, user_id, boops_count, profiles!comments_user_id_fkey!inner(${PC})`)}&post_id=eq.${post.id}`), (r) => r.status === 200 && r.body[0].profiles.username === 'owner1' && r.body[0].boops_count === 0);
const firstComment = (await call(FUR, `/comments?select=id&post_id=eq.${post.id}`)).body[0];
check('like a comment', await call(FUR, '/comment_boops', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ comment_id: firstComment.id }) }));
check('my comment likes', await call(FUR, `/comment_boops?select=comment_id&user_id=eq.${FUR}&comment_id=in.(${firstComment.id})`), (r) => r.status === 200 && r.body.length === 1);
check('comment like counted', await call(FUR, `/comments?select=boops_count&id=eq.${firstComment.id}`), (r) => r.body[0].boops_count === 1);
check('unlike a comment', await call(FUR, `/comment_boops?comment_id=eq.${firstComment.id}&user_id=eq.${FUR}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }));
check('who I follow / who follows me', await call(FUR, `/follows?select=followee_id&follower_id=eq.${FUR}&followee_id=in.(${OWNER})`), (r) => r.status === 200);
check('count a view', await call(OWNER, '/rpc/record_view', { method: 'POST', body: JSON.stringify({ p_post: post.id }) }));
check('view counted once', (await call(OWNER, '/rpc/record_view', { method: 'POST', body: JSON.stringify({ p_post: post.id }) }), await call(OWNER, `/posts?select=views_count&id=eq.${post.id}`)), (r) => r.body[0].views_count === 1);
for (const sort of ['trending', 'popular', 'viewed', 'newest']) {
    check(`explore: ${sort}`, await call(OWNER, '/rpc/explore', { method: 'POST', body: JSON.stringify({ p_sort: sort, p_range: 'week', p_type: 'all', p_limit: 24, p_offset: 0 }) }), (r) => r.status === 200 && r.body.length === 1 && r.body[0].views_count === 1);
}
check('explore: pictures only', await call(OWNER, '/rpc/explore', { method: 'POST', body: JSON.stringify({ p_sort: 'trending', p_range: 'all', p_type: 'image', p_limit: 24, p_offset: 0 }) }), (r) => r.status === 200 && r.body.length === 0);
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

// ---- private accounts ----
const rpc = (who, name, args = {}) => call(who, '/rpc/' + name, { method: 'POST', body: JSON.stringify(args) });
check('go private', await call(FUR, `/profiles?id=eq.${FUR}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ is_private: true, dm_policy: 'following' }) }));
check('cannot follow a private account directly', await call(OWNER, '/follows', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ followee_id: FUR }) }), (r) => r.status >= 400);
check('ask to follow', await rpc(OWNER, 'request_follow', { target: FUR }), (r) => r.status === 200 && r.body === 'requested');
check('follow requests + who asked', await call(FUR, `/follow_requests?select=${q(`created_at, requester:profiles!follow_requests_requester_id_fkey(${PC})`)}&target_id=eq.${FUR}&order=created_at.desc`), (r) => r.status === 200 && r.body[0].requester.username === 'owner1');
check('follow request count', await call(FUR, `/follow_requests?select=requester_id&target_id=eq.${FUR}`, { method: 'HEAD', headers: { Prefer: 'count=exact' } }), (r) => r.status < 300);
check('my pending request', await call(OWNER, `/follow_requests?select=target_id&requester_id=eq.${OWNER}&target_id=eq.${FUR}`), (r) => r.status === 200 && r.body.length === 1);
check('approve it', await rpc(FUR, 'answer_follow_request', { requester: OWNER, accept: true }));
check('now following', await call(OWNER, `/follows?select=followee_id&follower_id=eq.${OWNER}&followee_id=eq.${FUR}`), (r) => r.status === 200 && r.body.length === 1);
check('nobody can change someone else\'s privacy', await call(OWNER, `/profiles?id=eq.${FUR}`, { method: 'PATCH', body: JSON.stringify({ is_private: false }) }), (r) => r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0));
check('go public again', await call(FUR, `/profiles?id=eq.${FUR}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ is_private: false, dm_policy: 'everyone' }) }));

// ---- direct messages ----
check('send a message', await rpc(OWNER, 'send_dm', { target: FUR, body: 'hi <b>there</b>' }), (r) => r.status === 200 && typeof r.body === 'string');
check('conversation list + who', await call(FUR, `/dm_threads?select=${q(`other_id, state, last_message_at, last_body, last_from_me, unread, other:profiles!dm_threads_other_id_fkey(${PC})`)}&user_id=eq.${FUR}&state=eq.open&order=last_message_at.desc&limit=100`), (r) => r.status === 200 && r.body[0].other.username === 'owner1' && r.body[0].unread === 1);
check('one conversation state', await call(FUR, `/dm_threads?select=state,unread&user_id=eq.${FUR}&other_id=eq.${OWNER}`), (r) => r.status === 200 && r.body[0].state === 'open');
check('message counts', await rpc(FUR, 'dm_counts'), (r) => r.status === 200 && Number(r.body[0].unread) === 1);
check('read the messages', await rpc(FUR, 'dm_messages', { other: OWNER, p_before: null, p_limit: 50 }), (r) => r.status === 200 && r.body[0].body === 'hi <b>there</b>');
check('mark read', await rpc(FUR, 'dm_mark_read', { other: OWNER }));
check('reply', await rpc(FUR, 'send_dm', { target: OWNER, body: 'hey!' }));
check('seen receipt', await rpc(OWNER, 'dm_messages', { other: FUR, p_before: null, p_limit: 50 }), (r) => r.status === 200 && r.body.find((m) => m.sender_id === OWNER).read_at);
check('archive', await rpc(FUR, 'dm_set_state', { other: OWNER, new_state: 'archived' }));
check('archived list', await call(FUR, `/dm_threads?select=other_id&user_id=eq.${FUR}&state=eq.archived`), (r) => r.status === 200 && r.body.length === 1);
check('nobody reads other people\'s messages', await call(FUR, '/messages?select=*'), (r) => r.status >= 400 || r.body.every((m) => m.sender_id === FUR || m.recipient_id === FUR));
check('messages can\'t be written directly', await call(FUR, '/messages', { method: 'POST', body: JSON.stringify({ recipient_id: OWNER, body: 'sneaky' }) }), (r) => r.status >= 400);

// ---- report labels ----
check('report a person', await call(OWNER, '/user_reports', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ target_id: FUR, reason: 'spam', details: '' }) }));
check('report labels lookup', await rpc(FUR, 'user_flags', { ids: [FUR, OWNER] }), (r) => r.status === 200 && r.body.length === 0);
check('staff: clear a label', await rpc(OWNER, 'staff_clear_flag', { target: FUR }));

// ---- the Lounge ----
const chatRow = await call(FUR, '/chat_messages?select=*', { method: 'POST', body: JSON.stringify({ body: 'hello lounge' }) });
check('chat in the Lounge', chatRow, (r) => r.status === 201 && r.body[0].source === 'furzone');
check('Lounge messages + who', await call(OWNER, `/chat_messages?select=${q(`id, source, body, created_at, user_id, discord_author, discord_avatar, user:profiles!chat_messages_user_id_fkey(${PC})`)}&order=created_at.desc&limit=60`), (r) => r.status === 200 && r.body[0].user.username === 'fur2');
check('can\'t pretend to be Discord', await call(FUR, '/chat_messages', { method: 'POST', body: JSON.stringify({ body: 'x', source: 'discord', discord_author: 'Admin' }) }), (r) => r.status >= 400);
check('only the server pulls Discord', await rpc(FUR, 'lounge_claim_sync', { min_gap_ms: 0 }), (r) => r.status >= 400);
check('delete own chat message', await call(FUR, `/chat_messages?id=eq.${chatRow.body[0].id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }));

// ---- news ----
check('post an announcement (owner)', await rpc(OWNER, 'post_announcement', { p_title: 'Hello', p_body: 'News!', p_url: null }));
check('news list', await call(FUR, '/announcements?select=*&order=published_at.desc&limit=40'), (r) => r.status === 200 && r.body[0].title === 'Hello');
check('normal people cannot announce', await rpc(FUR, 'post_announcement', { p_title: 'Fake', p_body: '', p_url: null }), (r) => r.status >= 400);
check('only the server fetches VRChat news', await rpc(FUR, 'news_claim_fetch'), (r) => r.status >= 400);

// ---- search ----
check('search posts', await rpc(OWNER, 'search_posts', { p_query: 'back', p_limit: 30 }), (r) => r.status === 200 && r.body.length === 1);
console.log(fails ? `${fails} FAILED` : 'all server queries work');
process.exit(fails ? 1 : 0);
