// Runs supabase/schema.sql on a real Postgres (PGlite) with stand-ins for Supabase's auth and storage
// schemas, then checks what a logged-in person can and can't do.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SUPABASE_STANDINS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade,
                                provider text, provider_id text, identity_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint,
                                allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage, public to anon, authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
  -- Supabase hands out everything on new tables by default; the schema has to take it back.
  alter default privileges in schema public grant all on tables to anon, authenticated;
`;

let db;
const users = {};
const VRC = (n) => `usr_${String(n).padStart(8, '0')}-1111-2222-3333-444455556666`;

async function as(name, sql, params) {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${name ? users[name] : ''}', false);`);
    await db.exec(`set role ${name ? 'authenticated' : 'anon'}`);
    try {
        return (await db.query(sql, params)).rows;
    } finally {
        await db.exec('reset role');
    }
}

async function admin(sql, params) {
    await db.exec('reset role');
    return (await db.query(sql, params)).rows;
}

async function signUp(name, meta) {
    const [{ id }] = await admin('select gen_random_uuid() as id');
    await admin('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [
        id,
        `${name}@example.com`,
        JSON.stringify(meta || { username: name })
    ]);
    users[name] = id;
    return id;
}

before(async () => {
    db = new PGlite();
    await db.exec(SUPABASE_STANDINS);
    const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
    await db.exec(schema);
    await db.exec(schema); // people re-run it after changes
    for (const n of ['fox', 'wolf', 'cat']) await signUp(n);
});

test('sign-up: email picks a username, Discord gets one made up', async () => {
    await assert.rejects(signUp('fox'), /taken/);
    await assert.rejects(signUp('bad name', { username: 'bad name' }), /username/);
    const id = await signUp('discord_person', {
        name: 'Ruby.Raccoon',
        full_name: 'Ruby.Raccoon',
        custom_claims: { global_name: 'Ruby 🦝' }
    });
    const [p] = await admin('select username, display_name from profiles where id = $1', [id]);
    assert.equal(p.username, 'rubyraccoon');
    assert.equal(p.display_name, 'Ruby 🦝');
    const id2 = await signUp('discord_twin', { name: 'ruby.raccoon' });
    const [p2] = await admin('select username from profiles where id = $1', [id2]);
    assert.match(p2.username, /^rubyraccoon\d{4}$/);
    assert.equal((await as(null, "select username_available('fox') as ok"))[0].ok, false);
    assert.equal((await as(null, "select username_available('new_fur') as ok"))[0].ok, true);
});

test('logged-out visitors can read nothing', async () => {
    for (const t of ['profiles', 'posts', 'connections', 'notifications']) {
        await assert.rejects(as(null, `select * from ${t}`), /permission denied/);
    }
    await assert.rejects(as(null, 'select * from feed()'), /permission denied/);
});

test('posts: owner, tags and counters come from the database', async () => {
    const [p] = await as('fox', `insert into posts (caption, credit) values (' New suit! #Fursuit #fursuit #VRChat ', 'Art by @wolf') returning *`);
    assert.equal(p.user_id, users.fox);
    assert.deepEqual(p.tags, ['fursuit', 'vrchat']);
    assert.equal(p.caption, 'New suit! #Fursuit #fursuit #VRChat');
    const [edited] = await as('fox', `update posts set caption = 'retagged #art' where id = $1 returning tags`, [p.id]);
    assert.deepEqual(edited.tags, ['art']);
    await as('fox', `update posts set caption = 'New suit! #fursuit #vrchat' where id = $1`, [p.id]);
    assert.equal((await as('fox', `select posts_count from profiles where username = 'fox'`))[0].posts_count, 1);
});

test('posts: forged columns, other people and bad values are refused', async () => {
    await assert.rejects(as('fox', `insert into posts (caption, boops_count) values ('x', 999)`), /permission denied/);
    await assert.rejects(as('fox', `insert into posts (caption, tags) values ('x', '{hacked}')`), /permission denied/);
    await assert.rejects(as('fox', `insert into posts (user_id, caption) values ($1, 'hi')`, [users.wolf]), /permission denied/);
    await assert.rejects(as('fox', `insert into posts (caption) values ('   ')`), /posts_not_empty/);
    await assert.rejects(as('fox', `insert into posts (caption) values (repeat('x', 1001))`), /check constraint/);
    await assert.rejects(
        as('fox', `insert into posts (caption, media_path, media_type) values ('x', $1, 'image')`, [`${users.wolf}/a.png`]),
        /check constraint/
    );
    await assert.rejects(
        as('fox', `insert into posts (media_path, media_type) values ($1, 'audio')`, [`${users.fox}/a.mp3`]),
        /check constraint/
    );
    const [post] = await as('fox', `select id from posts where caption like 'New suit%'`);
    assert.equal((await as('wolf', `update posts set caption = 'pwned' where id = $1 returning id`, [post.id])).length, 0);
    assert.equal((await as('wolf', `delete from posts where id = $1 returning id`, [post.id])).length, 0);
    await assert.rejects(as('fox', `update posts set boops_count = 1000 where id = $1`, [post.id]), /permission denied/);
    await assert.rejects(as('fox', `update posts set hidden = false where id = $1`, [post.id]), /permission denied/);
});

test('profiles: only your own, only the editable fields', async () => {
    assert.equal((await as('wolf', `update profiles set bio = 'pwned' where username = 'fox' returning id`)).length, 0);
    await assert.rejects(as('fox', `update profiles set followers_count = 1e6 where username = 'fox'`), /permission denied/);
    await assert.rejects(as('fox', `update profiles set bio = repeat('x', 301) where username = 'fox'`), /check constraint/);
    await assert.rejects(as('fox', `update profiles set avatar_path = $1 where username = 'fox'`, [`${users.wolf}/a.jpg`]), /check constraint/);
    const [me] = await as('fox', `update profiles set species = 'Red fox', pronouns = 'he/him' where username = 'fox' returning species`);
    assert.equal(me.species, 'Red fox');
});

test('boops, comments and follows: counts, notifications, and only yours', async () => {
    const [post] = await as('fox', `select id from posts where caption like 'New suit%'`);
    await as('wolf', 'insert into boops (post_id) values ($1)', [post.id]);
    await as('cat', 'insert into boops (post_id) values ($1)', [post.id]);
    await assert.rejects(as('wolf', 'insert into boops (post_id) values ($1)', [post.id]), /duplicate key/);
    await assert.rejects(as('wolf', 'insert into boops (user_id, post_id) values ($1, $2)', [users.cat, post.id]), /permission denied/);
    assert.equal((await as('fox', 'select boops_count from posts where id = $1', [post.id]))[0].boops_count, 2);
    await as('wolf', `insert into comments (post_id, body) values ($1, 'So fluffy!')`, [post.id]);
    await as('wolf', 'insert into follows (followee_id) values ($1)', [users.fox]);
    const notes = await as('fox', 'select kind, actor_id from notifications order by created_at');
    assert.deepEqual(notes.map((n) => n.kind).sort(), ['boop', 'boop', 'comment', 'follow']);
    // Others can't read Fox's notifications, nobody can create them, and only read_at can change.
    assert.equal((await as('wolf', 'select id from notifications where user_id = $1', [users.fox])).length, 0);
    await assert.rejects(
        as('wolf', `insert into notifications (user_id, actor_id, kind) values ($1, $2, 'follow')`, [users.fox, users.wolf]),
        /permission denied/
    );
    await assert.rejects(as('fox', `update notifications set kind = 'boop'`), /permission denied/);
    await as('fox', 'update notifications set read_at = now()');
    // Un-booping removes its notification.
    await as('cat', 'delete from boops where post_id = $1', [post.id]);
    assert.equal((await as('fox', `select id from notifications where kind = 'boop'`)).length, 1);
    assert.equal((await as('wolf', 'delete from boops where user_id = $1 returning post_id', [users.cat])).length, 0);
});

test('blocking hides people from each other and stops interactions', async () => {
    const [post] = await as('fox', `select id from posts where caption like 'New suit%'`);
    assert.equal((await as('cat', 'select id from posts where id = $1', [post.id])).length, 1);
    await as('cat', 'insert into follows (followee_id) values ($1)', [users.fox]);
    await as('fox', 'insert into blocks (blocked_id) values ($1)', [users.cat]);
    // Cat no longer sees Fox's posts, can't boop, comment or follow; the follow was removed.
    assert.equal((await as('cat', 'select id from posts where id = $1', [post.id])).length, 0);
    assert.equal((await as('cat', 'select id from feed() where user_id = $1', [users.fox])).length, 0);
    await assert.rejects(as('cat', 'insert into boops (post_id) values ($1)', [post.id]), /row-level security/);
    await assert.rejects(as('cat', `insert into comments (post_id, body) values ($1, 'hi')`, [post.id]), /row-level security/);
    await assert.rejects(as('cat', 'insert into follows (followee_id) values ($1)', [users.fox]), /row-level security/);
    assert.equal((await as('cat', 'select * from follows where follower_id = $1 and followee_id = $2', [users.cat, users.fox])).length, 0);
    // Block lists are private.
    assert.equal((await as('cat', 'select * from blocks')).length, 0);
    await assert.rejects(as('cat', `insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [users.fox, users.wolf]), /permission denied/);
    await as('fox', 'delete from blocks where blocked_id = $1', [users.cat]);
    assert.equal((await as('cat', 'select id from posts where id = $1', [post.id])).length, 1);
});

test('connections can never be written by the app', async () => {
    await assert.rejects(
        as('fox', `insert into connections (user_id, provider, external_id) values ($1, 'vrchat', $2)`, [users.fox, VRC(1)]),
        /permission denied/
    );
    await assert.rejects(as('fox', `update connections set handle = 'x'`), /permission denied/);
    await assert.rejects(as('fox', 'select * from private.vrchat_link_codes'), /permission denied/);
    await assert.rejects(as('fox', 'select * from private.vrchat_session'), /permission denied/);
});

test('Discord: a linked identity shows up as a connection, and goes when unlinked', async () => {
    await admin(
        `insert into auth.identities (user_id, provider, provider_id, identity_data) values ($1, 'discord', '1234567890', $2)`,
        [users.wolf, JSON.stringify({ provider_id: '1234567890', full_name: 'wolfy', custom_claims: { global_name: 'Wolfy' } })]
    );
    const [c] = await as('fox', `select provider, external_id, handle from connections where user_id = $1`, [users.wolf]);
    assert.deepEqual(c, { provider: 'discord', external_id: '1234567890', handle: 'Wolfy' });
    // A Discord sign-up (identity written before the profile exists) gets its badge too.
    const id = await signUp('discord_new', { name: 'newpup' });
    await admin(`delete from connections where user_id = $1`, [id]);
    await admin(`insert into auth.identities (user_id, provider, provider_id, identity_data) values ($1, 'discord', '555', '{"provider_id":"555","name":"newpup"}')`, [id]);
    assert.equal((await admin(`select 1 from connections where user_id = $1 and provider = 'discord'`, [id])).length, 1);
    await admin(`delete from auth.identities where user_id = $1`, [users.wolf]);
    assert.equal((await as('fox', `select * from connections where user_id = $1`, [users.wolf])).length, 0);
});

test('VRChat: a code is issued for a valid id, never for someone else\'s account', async () => {
    const [{ start_vrchat_link: code }] = await as('fox', 'select start_vrchat_link($1)', [VRC(1).toUpperCase()]);
    assert.match(code, /^PAWST-[A-HJ-NP-Z2-9]{6}$/);
    const [{ start_vrchat_link: again }] = await as('fox', 'select start_vrchat_link($1)', [VRC(1)]);
    assert.notEqual(again, code);
    const [row] = await admin('select vrchat_user_id, code from private.vrchat_link_codes where user_id = $1', [users.fox]);
    assert.deepEqual(row, { vrchat_user_id: VRC(1), code: again });
    await assert.rejects(as('fox', 'select start_vrchat_link($1)', ['not-an-id']), /VRChat user id/);
    await assert.rejects(as(null, 'select start_vrchat_link($1)', [VRC(1)]), /permission denied/);
    // Once VRChat account 1 belongs to Fox (the server function did it), Wolf can't claim it.
    await admin(`insert into connections (user_id, provider, external_id, handle) values ($1, 'vrchat', $2, 'Foxy')`, [users.fox, VRC(1)]);
    await assert.rejects(as('wolf', 'select start_vrchat_link($1)', [VRC(1)]), /already connected/);
    // Unlinking your own is allowed.
    assert.equal((await as('fox', `delete from connections where provider = 'vrchat' returning user_id`)).length, 1);
});

test('feed and tags: following, #tag filter, trending, and connection badges', async () => {
    await admin(`insert into connections (user_id, provider, external_id, handle) values ($1, 'vrchat', $2, 'Foxy')`, [users.fox, VRC(2)]);
    await as('wolf', `insert into posts (caption) values ('Howl at the moon #art')`);
    const all = await as('cat', 'select username, connections from feed()');
    assert.ok(all.length >= 2);
    assert.deepEqual(all.find((r) => r.username === 'fox').connections, ['vrchat']);
    const tagged = await as('cat', `select username from feed('all', null, 10, 'Fursuit')`);
    assert.deepEqual(tagged.map((r) => r.username), ['fox']);
    const following = await as('wolf', `select distinct username from feed('following')`);
    assert.deepEqual(following.map((r) => r.username).sort(), ['fox', 'wolf']);
    const trending = await as('cat', 'select tag, uses from trending_tags()');
    assert.ok(trending.some((t) => t.tag === 'fursuit'));
});

test('rate limits stop floods', async () => {
    await signUp('spammer');
    for (let i = 0; i < 20; i++) await as('spammer', `insert into posts (caption) values ($1)`, [`spam ${i}`]);
    await assert.rejects(as('spammer', `insert into posts (caption) values ('one more')`), /Slow down/);
    const [post] = await as('fox', `select id from posts where caption like 'New suit%'`);
    for (let i = 0; i < 30; i++) await as('spammer', `insert into comments (post_id, body) values ($1, 'x')`, [post.id]);
    await assert.rejects(as('spammer', `insert into comments (post_id, body) values ($1, 'x')`, [post.id]), /Slow down/);
    await assert.rejects(as('spammer', 'select enforce_rate_limit(0, 1, $1)', ['x']), /permission denied/);
    await assert.rejects(as('spammer', `select notify($1, $1, 'follow', null)`, [users.fox]), /permission denied/);
});

test('five reports hide a post from everyone but its owner', async () => {
    const [p] = await as('spammer', `select id from posts where caption = 'spam 0'`);
    for (const name of ['fox', 'wolf', 'cat', 'rep4', 'rep5']) {
        if (!users[name]) await signUp(name);
        await as(name, `insert into reports (post_id, reason) values ($1, 'spam')`, [p.id]);
    }
    assert.equal((await as('fox', 'select id from posts where id = $1', [p.id])).length, 0);
    assert.equal((await as('spammer', 'select id from posts where id = $1', [p.id])).length, 1);
    await assert.rejects(as('fox', 'select * from reports'), /permission denied/);
});

test('media uploads only into your own folder', async () => {
    await as('fox', `insert into storage.objects (bucket_id, name) values ('media', $1)`, [`${users.fox}/a.jpg`]);
    await assert.rejects(
        as('fox', `insert into storage.objects (bucket_id, name) values ('media', $1)`, [`${users.wolf}/a.jpg`]),
        /row-level security/
    );
    assert.equal((await as('wolf', `select name from storage.objects`)).length, 0);
    const [bucket] = await admin(`select * from storage.buckets where id = 'media'`);
    assert.equal(Number(bucket.file_size_limit), 52428800);
    assert.ok(!bucket.allowed_mime_types.some((m) => /html|svg|javascript/.test(m)));
});

test('deleting your account removes everything you made', async () => {
    await signUp('leaver');
    await as('leaver', `insert into posts (caption) values ('bye')`);
    await as('leaver', 'select delete_my_account()');
    assert.equal((await admin('select id from auth.users where id = $1', [users.leaver])).length, 0);
    assert.equal((await admin('select id from posts where user_id = $1', [users.leaver])).length, 0);
    await assert.rejects(as(null, 'select delete_my_account()'), /permission denied/);
});
