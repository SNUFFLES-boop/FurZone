-- FurZone database. Paste this whole file into Supabase → SQL Editor → Run. Safe to run again.
--
-- Security model
--   * Row Level Security on every table: nothing is readable without logging in, and every write is
--     checked against the logged-in user (auth.uid()).
--   * Column privileges: the app can only send the columns a person may choose. Counters, owners,
--     timestamps, tags and connection badges are set by the database, so they can't be faked.
--   * Rate limits in the database, so a script with a stolen login still can't flood anything.
--   * Blocking hides both people from each other and stops follows, boops and comments between them.
--   * "Connected" badges: Discord comes from Discord's own login (auth.identities, written only by
--     Supabase Auth); VRChat only from the vrchat-verify server function after it has seen the code in
--     the person's VRChat bio. The app itself can never write a connection.
--   * Media goes to the "media" bucket, only into the uploader's own folder, with size and type limits.
--   * Staff ranks (owner > admin > mod > staff) can review reports, hide or delete posts, limit features
--     and ban accounts, but only for people ranked below them. Everything they do is logged.

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------- tables

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null default '' check (char_length(display_name) <= 40),
  pronouns text not null default '' check (char_length(pronouns) <= 24),
  species text not null default '' check (char_length(species) <= 40),
  bio text not null default '' check (char_length(bio) <= 300),
  avatar_path text check (avatar_path is null or (avatar_path like id::text || '/%' and char_length(avatar_path) <= 200)),
  banner_path text check (banner_path is null or (banner_path like id::text || '/%' and char_length(banner_path) <= 200)),
  ref_path text check (ref_path is null or (ref_path like id::text || '/%' and char_length(ref_path) <= 200)),
  followers_count int not null default 0,
  following_count int not null default 0,
  posts_count int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_key on public.profiles (username);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  caption text not null default '' check (char_length(caption) <= 1000),
  credit text not null default '' check (char_length(credit) <= 80),
  tags text[] not null default '{}',
  media_path text check (media_path is null or (media_path like user_id::text || '/%' and char_length(media_path) <= 200)),
  media_type text check (media_type is null or media_type in ('image', 'video')),
  boops_count int not null default 0,
  comments_count int not null default 0,
  reports_count int not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  constraint posts_not_empty check (media_path is not null or char_length(btrim(caption)) > 0),
  constraint posts_media_typed check ((media_path is null) = (media_type is null))
);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_user_created_idx on public.posts (user_id, created_at desc);
create index if not exists posts_tags_idx on public.posts using gin (tags);

create table if not exists public.boops (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists boops_post_idx on public.boops (post_id);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments (post_id, created_at);
create index if not exists comments_user_created_idx on public.comments (user_id, created_at desc);

create table if not exists public.follows (
  follower_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows (followee_id);

create table if not exists public.blocks (
  blocker_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (reporter_id, post_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('boop', 'comment', 'follow')),
  post_id uuid references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- Linked accounts shown as badges. Written only by the database (Discord) or the vrchat-verify function.
create table if not exists public.connections (
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('discord', 'vrchat')),
  external_id text not null check (char_length(external_id) between 1 and 100),
  handle text not null default '' check (char_length(handle) <= 100),
  verified_at timestamptz not null default now(),
  primary key (user_id, provider),
  unique (provider, external_id)
);

-- A pending VRChat link: the code the person has to put in their VRChat bio.
create table if not exists private.vrchat_link_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  vrchat_user_id text not null check (vrchat_user_id ~ '^usr_[0-9a-f-]{36}$'),
  code text not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

-- The bot login the vrchat-verify function reuses, so it doesn't log in to VRChat on every check.
create table if not exists private.vrchat_session (
  id int primary key default 1 check (id = 1),
  cookie text not null,
  updated_at timestamptz not null default now()
);

-- Staff ranks: owner (4) > admin (3) > mod (2) > staff (1). Shown as badges, so everyone can read them.
create table if not exists public.staff (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'mod', 'staff')),
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now()
);

-- Limits a moderator put on an account: a full ban, or single features turned off. until null = no end date.
create table if not exists public.restrictions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  banned boolean not null default false,
  no_posting boolean not null default false,
  no_comments boolean not null default false,
  no_uploads boolean not null default false,
  no_profile_edits boolean not null default false,
  reason text not null default '' check (char_length(reason) <= 300),
  until timestamptz,
  set_by uuid references public.profiles (id) on delete set null,
  set_at timestamptz not null default now()
);

-- Everything staff do, for admins and the owner to look back on.
create table if not exists public.staff_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_user uuid references public.profiles (id) on delete set null,
  target_post uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists staff_log_created_idx on public.staff_log (created_at desc);

-- Privacy: a private account's posts are only for its approved followers. dm_policy: who may message you.
alter table public.profiles add column if not exists is_private boolean not null default false;
alter table public.profiles add column if not exists dm_policy text not null default 'everyone';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_dm_policy_check') then
    alter table public.profiles add constraint profiles_dm_policy_check check (dm_policy in ('everyone', 'following', 'nobody'));
  end if;
end $$;

-- "Can I follow you?" for private accounts. The person approves or declines.
create table if not exists public.follow_requests (
  requester_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (requester_id, target_id),
  constraint follow_requests_not_self check (requester_id <> target_id)
);
create index if not exists follow_requests_target_idx on public.follow_requests (target_id, created_at desc);

-- ---------------------------------------------------------------- privileges
-- Supabase grants everything on new tables to anon and authenticated by default; take it back and hand
-- out only what the app needs. Logged-out visitors (anon) get nothing.

revoke all on public.profiles, public.posts, public.boops, public.comments, public.follows, public.blocks,
  public.reports, public.notifications, public.connections, public.staff, public.restrictions,
  public.staff_log from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;

grant select on public.profiles, public.posts, public.boops, public.comments, public.follows,
  public.connections to authenticated;
grant update (username, display_name, pronouns, species, bio, avatar_path, banner_path, ref_path)
  on public.profiles to authenticated;
grant insert (caption, credit, media_path, media_type) on public.posts to authenticated;
grant update (caption, credit) on public.posts to authenticated;
grant delete on public.posts to authenticated;
grant insert (post_id) on public.boops to authenticated;
grant delete on public.boops to authenticated;
grant insert (post_id, body) on public.comments to authenticated;
grant delete on public.comments to authenticated;
grant insert (followee_id) on public.follows to authenticated;
grant delete on public.follows to authenticated;
grant select, delete on public.blocks to authenticated;
grant insert (blocked_id) on public.blocks to authenticated;
grant insert (post_id, reason) on public.reports to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant delete on public.connections to authenticated;
-- Staff tables are read-only from the app; every change goes through the staff_* functions below.
grant select on public.staff, public.restrictions, public.staff_log to authenticated;
grant update (is_private, dm_policy) on public.profiles to authenticated;
revoke all on public.follow_requests from anon, authenticated;
grant select, delete on public.follow_requests to authenticated;

-- ---------------------------------------------------------------- blocking helper

-- True when either person blocked the other. Security definer so it can see blocks you didn't make.
create or replace function public.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;
revoke all on function public.is_blocked(uuid, uuid) from public, anon;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;

-- 4 owner, 3 admin, 2 mod, 1 staff, 0 everyone else.
create or replace function public.staff_rank(uid uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select case s.role when 'owner' then 4 when 'admin' then 3 when 'mod' then 2 else 1 end
                     from staff s where s.user_id = uid), 0)
$$;
revoke all on function public.staff_rank(uuid) from public, anon;
grant execute on function public.staff_rank(uuid) to authenticated;

-- Banned right now? (Their posts and comments disappear for everyone but staff.)
create or replace function public.is_banned(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from restrictions r where r.user_id = uid and r.banned and (r.until is null or r.until > now()))
$$;
revoke all on function public.is_banned(uuid) from public, anon;
grant execute on function public.is_banned(uuid) to authenticated;

-- Is the logged-in person barred from this right now? what: post, comment, upload, profile (a ban bars all).
create or replace function public.my_restriction(what text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from restrictions r
                  where r.user_id = auth.uid() and (r.until is null or r.until > now())
                    and (r.banned or (what = 'post' and r.no_posting) or (what = 'comment' and r.no_comments)
                         or (what = 'upload' and r.no_uploads) or (what = 'profile' and r.no_profile_edits)))
$$;
revoke all on function public.my_restriction(text) from public, anon;
grant execute on function public.my_restriction(text) to authenticated;

create or replace function public.is_private_account(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_private from profiles where id = uid), false)
$$;
revoke all on function public.is_private_account(uuid) from public, anon;
grant execute on function public.is_private_account(uuid) to authenticated;

-- May the logged-in person see this person's posts? Public accounts: yes. Private: only you and your followers.
create or replace function public.can_see_posts_of(owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select owner = auth.uid()
      or not coalesce((select is_private from profiles where id = owner), false)
      or exists (select 1 from follows where follower_id = auth.uid() and followee_id = owner)
$$;
revoke all on function public.can_see_posts_of(uuid) from public, anon;
grant execute on function public.can_see_posts_of(uuid) to authenticated;

-- ---------------------------------------------------------------- row level security

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.boops enable row level security;
alter table public.comments enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.notifications enable row level security;
alter table public.connections enable row level security;
alter table public.staff enable row level security;
alter table public.restrictions enable row level security;
alter table public.staff_log enable row level security;
alter table public.follow_requests enable row level security;
alter table private.vrchat_link_codes enable row level security;
alter table private.vrchat_session enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Posts: hidden ones only to their owner; nothing between people who blocked each other.
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select to authenticated
  using (user_id = auth.uid() or public.staff_rank(auth.uid()) >= 1
         or (not hidden and not public.is_blocked(auth.uid(), user_id) and not public.is_banned(user_id)
             and public.can_see_posts_of(user_id)));
drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists posts_update_own on public.posts;
create policy posts_update_own on public.posts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists posts_delete_own on public.posts;
create policy posts_delete_own on public.posts for delete to authenticated using (user_id = auth.uid());

drop policy if exists boops_read on public.boops;
create policy boops_read on public.boops for select to authenticated using (true);
drop policy if exists boops_insert_own on public.boops;
create policy boops_insert_own on public.boops for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.posts p where p.id = post_id and not public.is_blocked(auth.uid(), p.user_id))
);
drop policy if exists boops_delete_own on public.boops;
create policy boops_delete_own on public.boops for delete to authenticated using (user_id = auth.uid());

drop policy if exists comments_read on public.comments;
create policy comments_read on public.comments for select to authenticated
  using (user_id = auth.uid() or public.staff_rank(auth.uid()) >= 1
         or (not public.is_blocked(auth.uid(), user_id) and not public.is_banned(user_id)
             and exists (select 1 from public.posts p where p.id = post_id)));
drop policy if exists comments_insert_own on public.comments;
create policy comments_insert_own on public.comments for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.posts p where p.id = post_id and not public.is_blocked(auth.uid(), p.user_id))
);
-- Your own comments, or any comment on your own post.
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
);

drop policy if exists follows_read on public.follows;
create policy follows_read on public.follows for select to authenticated using (true);
drop policy if exists follows_insert_own on public.follows;
create policy follows_insert_own on public.follows for insert to authenticated
  with check (follower_id = auth.uid() and not public.is_blocked(auth.uid(), followee_id)
              and not public.is_private_account(followee_id));
drop policy if exists follow_requests_read on public.follow_requests;
create policy follow_requests_read on public.follow_requests for select to authenticated
  using (requester_id = auth.uid() or target_id = auth.uid());
drop policy if exists follow_requests_delete on public.follow_requests;
create policy follow_requests_delete on public.follow_requests for delete to authenticated
  using (requester_id = auth.uid() or target_id = auth.uid());
drop policy if exists follows_delete_own on public.follows;
create policy follows_delete_own on public.follows for delete to authenticated using (follower_id = auth.uid());

-- Your block list is yours alone.
drop policy if exists blocks_own on public.blocks;
create policy blocks_own on public.blocks for select to authenticated using (blocker_id = auth.uid());
drop policy if exists blocks_insert_own on public.blocks;
create policy blocks_insert_own on public.blocks for insert to authenticated with check (blocker_id = auth.uid());
drop policy if exists blocks_delete_own on public.blocks;
create policy blocks_delete_own on public.blocks for delete to authenticated using (blocker_id = auth.uid());

-- Reports can be filed but not read back from the app (moderators use the dashboard).
drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports for insert to authenticated with check (reporter_id = auth.uid());

drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications for delete to authenticated using (user_id = auth.uid());

drop policy if exists connections_read on public.connections;
create policy connections_read on public.connections for select to authenticated using (true);
-- Unlinking is always allowed; linking only happens on the server.
drop policy if exists connections_delete_own on public.connections;
create policy connections_delete_own on public.connections for delete to authenticated using (user_id = auth.uid());

-- Ranks are public (badges). Your own limits are yours to see; staff see everyone's. The log is for admins.
drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff for select to authenticated using (true);
drop policy if exists restrictions_read on public.restrictions;
create policy restrictions_read on public.restrictions for select to authenticated
  using (user_id = auth.uid() or public.staff_rank(auth.uid()) >= 1);
drop policy if exists staff_log_read on public.staff_log;
create policy staff_log_read on public.staff_log for select to authenticated using (public.staff_rank(auth.uid()) >= 3);

-- ---------------------------------------------------------------- rate limits

create or replace function public.enforce_rate_limit(recent int, max_allowed int, what text) returns void
language plpgsql as $$
begin
  if recent >= max_allowed then
    raise exception 'Slow down: too many % right now. Try again in a bit.', what using errcode = 'P0429';
  end if;
end $$;

create or replace function public.rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  case tg_table_name
    when 'posts' then
      perform enforce_rate_limit((select count(*)::int from posts
        where user_id = new.user_id and created_at > now() - interval '1 hour'), 20, 'posts');
    when 'comments' then
      perform enforce_rate_limit((select count(*)::int from comments
        where user_id = new.user_id and created_at > now() - interval '10 minutes'), 30, 'comments');
    when 'boops' then
      perform enforce_rate_limit((select count(*)::int from boops
        where user_id = new.user_id and created_at > now() - interval '10 minutes'), 300, 'boops');
    when 'follows' then
      perform enforce_rate_limit((select count(*)::int from follows
        where follower_id = new.follower_id and created_at > now() - interval '1 hour'), 100, 'follows');
    when 'blocks' then
      perform enforce_rate_limit((select count(*)::int from blocks
        where blocker_id = new.blocker_id and created_at > now() - interval '1 hour'), 100, 'blocks');
    when 'reports' then
      perform enforce_rate_limit((select count(*)::int from reports
        where reporter_id = new.reporter_id and created_at > now() - interval '1 day'), 20, 'reports');
    when 'comment_boops' then
      perform enforce_rate_limit((select count(*)::int from comment_boops
        where user_id = new.user_id and created_at > now() - interval '10 minutes'), 300, 'likes');
    when 'chat_messages' then
      perform enforce_rate_limit((select count(*)::int from chat_messages
        where user_id = new.user_id and created_at > now() - interval '1 minute'), 20, 'chat messages');
    when 'user_reports' then
      perform enforce_rate_limit((select count(*)::int from user_reports
        where reporter_id = new.reporter_id and created_at > now() - interval '1 day'), 20, 'reports');
    else
      null;
  end case;
  return new;
end $$;

drop trigger if exists rate_limit on public.posts;
create trigger rate_limit before insert on public.posts for each row execute function public.rate_limit();
drop trigger if exists rate_limit on public.comments;
create trigger rate_limit before insert on public.comments for each row execute function public.rate_limit();
drop trigger if exists rate_limit on public.boops;
create trigger rate_limit before insert on public.boops for each row execute function public.rate_limit();
drop trigger if exists rate_limit on public.follows;
create trigger rate_limit before insert on public.follows for each row execute function public.rate_limit();
drop trigger if exists rate_limit on public.blocks;
create trigger rate_limit before insert on public.blocks for each row execute function public.rate_limit();
drop trigger if exists rate_limit on public.reports;
create trigger rate_limit before insert on public.reports for each row execute function public.rate_limit();

-- ---------------------------------------------------------------- server-set values

-- Hashtags in a caption ("#fursuit #art"): lower-case, unique, at most 10.
create or replace function public.extract_tags(caption text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(tag order by first_pos), '{}')
    from (select lower(m[1]) as tag, min(ord) as first_pos
            from regexp_matches(coalesce(caption, ''), '#([A-Za-z0-9_]{1,30})', 'g') with ordinality as t(m, ord)
           group by lower(m[1])
           order by min(ord)
           limit 10) s
$$;

create or replace function public.posts_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.created_at := now();
    new.boops_count := 0;
    new.comments_count := 0;
    new.reports_count := 0;
    new.views_count := 0;
    new.hidden := false;
  end if;
  new.caption := btrim(coalesce(new.caption, ''));
  new.credit := btrim(coalesce(new.credit, ''));
  new.tags := extract_tags(new.caption);
  return new;
end $$;
drop trigger if exists posts_defaults on public.posts;
create trigger posts_defaults before insert or update on public.posts for each row execute function public.posts_before_write();

create or replace function public.posts_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update profiles set posts_count = posts_count + 1 where id = new.user_id;
  else
    update profiles set posts_count = greatest(posts_count - 1, 0) where id = old.user_id;
  end if;
  return null;
end $$;
drop trigger if exists posts_counts on public.posts;
create trigger posts_counts after insert or delete on public.posts for each row execute function public.posts_after_change();

-- Notifications are made here, never by the app. No notification to yourself.
create or replace function public.notify(recipient uuid, actor uuid, what text, post uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if recipient is not null and recipient <> actor then
    insert into notifications (user_id, actor_id, kind, post_id) values (recipient, actor, what, post);
  end if;
end $$;
revoke all on function public.notify(uuid, uuid, text, uuid) from public, anon, authenticated;

create or replace function public.boops_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update posts set boops_count = boops_count + 1 where id = new.post_id;
    perform notify((select user_id from posts where id = new.post_id), new.user_id, 'boop', new.post_id);
  else
    update posts set boops_count = greatest(boops_count - 1, 0) where id = old.post_id;
    delete from notifications where kind = 'boop' and actor_id = old.user_id and post_id = old.post_id;
  end if;
  return null;
end $$;
drop trigger if exists boops_counts on public.boops;
create trigger boops_counts after insert or delete on public.boops for each row execute function public.boops_after_change();

create or replace function public.comments_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update posts set comments_count = comments_count + 1 where id = new.post_id;
    perform notify((select user_id from posts where id = new.post_id), new.user_id, 'comment', new.post_id);
  else
    update posts set comments_count = greatest(comments_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end $$;
drop trigger if exists comments_counts on public.comments;
create trigger comments_counts after insert or delete on public.comments for each row execute function public.comments_after_change();

create or replace function public.follows_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update profiles set following_count = following_count + 1 where id = new.follower_id;
    update profiles set followers_count = followers_count + 1 where id = new.followee_id;
    perform notify(new.followee_id, new.follower_id, 'follow', null);
  else
    update profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
    update profiles set followers_count = greatest(followers_count - 1, 0) where id = old.followee_id;
    delete from notifications where kind = 'follow' and actor_id = old.follower_id and user_id = old.followee_id;
  end if;
  return null;
end $$;
drop trigger if exists follows_counts on public.follows;
create trigger follows_counts after insert or delete on public.follows for each row execute function public.follows_after_change();

-- Blocking someone also removes follows both ways.
create or replace function public.blocks_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from follows where (follower_id = new.blocker_id and followee_id = new.blocked_id)
                         or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  delete from notifications where (user_id = new.blocker_id and actor_id = new.blocked_id);
  delete from follow_requests where (requester_id = new.blocker_id and target_id = new.blocked_id)
                                 or (requester_id = new.blocked_id and target_id = new.blocker_id);
  return null;
end $$;
drop trigger if exists blocks_cleanup on public.blocks;
create trigger blocks_cleanup after insert on public.blocks for each row execute function public.blocks_after_insert();

-- Five different people reporting a post hides it until a moderator looks.
create or replace function public.reports_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update posts set reports_count = reports_count + 1, hidden = hidden or reports_count + 1 >= 5
   where id = new.post_id;
  return null;
end $$;
drop trigger if exists reports_count on public.reports;
create trigger reports_count after insert on public.reports for each row execute function public.reports_after_insert();

-- ---------------------------------------------------------------- sign-up

-- Every account gets a profile. Email sign-ups choose a username (and get an error if it's taken);
-- Discord sign-ups get one made from their Discord name, with a number added if needed.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  chosen text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  base text;
  candidate text;
  tries int := 0;
begin
  if chosen <> '' then
    if chosen !~ '^[a-z0-9_]{3,20}$' then
      raise exception 'Pick a username of 3-20 letters, numbers or _.' using errcode = '22023';
    end if;
    if exists (select 1 from profiles where username = chosen) then
      raise exception 'That username is taken.' using errcode = '23505';
    end if;
    candidate := chosen;
  else
    base := regexp_replace(lower(coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', '')),
                           '[^a-z0-9_]', '', 'g');
    base := left(base, 15);
    if char_length(base) < 3 then base := 'paw' || base; end if;
    candidate := base;
    while exists (select 1 from profiles where username = candidate) loop
      tries := tries + 1;
      candidate := base || (floor(random() * 9000) + 1000)::int::text;
      if tries > 20 then
        candidate := 'paw' || replace(left(new.id::text, 12), '-', '');
        exit;
      end if;
    end loop;
  end if;
  insert into profiles (id, username, display_name)
  values (new.id, candidate,
          left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name',
                              new.raw_user_meta_data #>> '{custom_claims,global_name}',
                              new.raw_user_meta_data ->> 'full_name', candidate)), 40));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Lets the sign-up screen say "taken" before submitting.
create or replace function public.username_available(name text) returns boolean
language sql stable security definer set search_path = public as $$
  select lower(name) ~ '^[a-z0-9_]{3,20}$' and not exists (select 1 from profiles where username = lower(name))
$$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- ---------------------------------------------------------------- Discord

-- When someone logs in with or links Discord, Supabase Auth writes auth.identities; that's the proof.
create or replace function public.sync_discord_connection() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.provider = 'discord' then
      delete from connections where user_id = old.user_id and provider = 'discord';
    end if;
    return null;
  end if;
  if new.provider = 'discord' and exists (select 1 from profiles where id = new.user_id) then
    insert into connections (user_id, provider, external_id, handle, verified_at)
    values (new.user_id, 'discord',
            coalesce(new.identity_data ->> 'provider_id', new.identity_data ->> 'sub', new.provider_id),
            left(coalesce(new.identity_data #>> '{custom_claims,global_name}', new.identity_data ->> 'full_name',
                          new.identity_data ->> 'name', ''), 100),
            now())
    on conflict (user_id, provider) do update set external_id = excluded.external_id, handle = excluded.handle;
  end if;
  return null;
end $$;
drop trigger if exists on_identity_change on auth.identities;
create trigger on_identity_change after insert or update or delete on auth.identities
  for each row execute function public.sync_discord_connection();

-- Profiles are created after the identity on a Discord sign-up, so pick the identity up then too.
create or replace function public.profiles_after_insert() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  insert into connections (user_id, provider, external_id, handle, verified_at)
  select i.user_id, 'discord',
         coalesce(i.identity_data ->> 'provider_id', i.identity_data ->> 'sub', i.provider_id),
         left(coalesce(i.identity_data #>> '{custom_claims,global_name}', i.identity_data ->> 'full_name',
                       i.identity_data ->> 'name', ''), 100),
         now()
    from auth.identities i
   where i.user_id = new.id and i.provider = 'discord'
  on conflict do nothing;
  return null;
end $$;
drop trigger if exists profiles_connections on public.profiles;
create trigger profiles_connections after insert on public.profiles for each row execute function public.profiles_after_insert();

-- ---------------------------------------------------------------- VRChat

-- Step 1 (app): ask for a code for your VRChat user id (usr_…). Put it in your VRChat bio, then step 2:
-- the vrchat-verify server function checks the bio and, if the code is there, adds the connection.
create or replace function public.start_vrchat_link(vrchat_user_id text) returns text
language plpgsql security definer set search_path = public, private as $$
declare
  vrc text := lower(btrim(vrchat_user_id));
  new_code text;
begin
  if auth.uid() is null then
    raise exception 'Not logged in.' using errcode = '42501';
  end if;
  if vrc !~ '^usr_[0-9a-f-]{36}$' then
    raise exception 'That doesn''t look like a VRChat user id (usr_…).' using errcode = '22023';
  end if;
  if exists (select 1 from connections where provider = 'vrchat' and external_id = vrc and user_id <> auth.uid()) then
    raise exception 'That VRChat account is already connected to someone else.' using errcode = '23505';
  end if;
  -- Easy to type, hard to guess: FURZONE- and 6 characters without look-alikes.
  new_code := 'FURZONE-' || (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '')
                             from (select decode(replace(gen_random_uuid()::text, '-', ''), 'hex') as b) r,
                                  generate_series(0, 5) as i);
  insert into vrchat_link_codes (user_id, vrchat_user_id, code, attempts, created_at)
  values (auth.uid(), vrc, new_code, 0, now())
  on conflict (user_id) do update set vrchat_user_id = excluded.vrchat_user_id, code = excluded.code,
                                      attempts = 0, created_at = now();
  return new_code;
end $$;
revoke all on function public.start_vrchat_link(text) from public, anon;
grant execute on function public.start_vrchat_link(text) to authenticated;

-- Server side of the VRChat check, callable only with the service role key (the vrchat-verify function).
-- Codes last an hour and allow 10 checks, so nobody can hammer VRChat through us.
create or replace function public.vrchat_claim_attempt(p_user uuid)
returns table (vrchat_user_id text, code text)
language plpgsql security definer set search_path = public, private as $$
declare
  r private.vrchat_link_codes;
begin
  select * into r from private.vrchat_link_codes c where c.user_id = p_user for update;
  if not found then
    raise exception 'Start again: get a new code first.' using errcode = 'P0002';
  end if;
  if r.created_at < now() - interval '1 hour' then
    delete from private.vrchat_link_codes c where c.user_id = p_user;
    raise exception 'That code expired. Get a new one.' using errcode = 'P0002';
  end if;
  if r.attempts >= 10 then
    raise exception 'Slow down: too many checks. Get a new code in a bit.' using errcode = 'P0429';
  end if;
  update private.vrchat_link_codes c set attempts = c.attempts + 1 where c.user_id = p_user;
  return query select r.vrchat_user_id, r.code;
end $$;

create or replace function public.vrchat_complete(p_user uuid, p_vrchat_user_id text, p_handle text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if exists (select 1 from connections where provider = 'vrchat' and external_id = p_vrchat_user_id and user_id <> p_user) then
    raise exception 'That VRChat account is already connected to someone else.' using errcode = '23505';
  end if;
  insert into connections (user_id, provider, external_id, handle, verified_at)
  values (p_user, 'vrchat', p_vrchat_user_id, left(coalesce(p_handle, ''), 100), now())
  on conflict (user_id, provider) do update set external_id = excluded.external_id, handle = excluded.handle,
                                                verified_at = excluded.verified_at;
  delete from private.vrchat_link_codes where user_id = p_user;
end $$;

create or replace function public.vrchat_session_get() returns text
language sql stable security definer set search_path = private as $$
  select cookie from private.vrchat_session where id = 1
$$;

create or replace function public.vrchat_session_set(p_cookie text) returns void
language sql security definer set search_path = private as $$
  insert into private.vrchat_session (id, cookie, updated_at) values (1, p_cookie, now())
  on conflict (id) do update set cookie = excluded.cookie, updated_at = now()
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;
revoke all on function public.vrchat_claim_attempt(uuid) from public, anon, authenticated;
revoke all on function public.vrchat_complete(uuid, text, text) from public, anon, authenticated;
revoke all on function public.vrchat_session_get() from public, anon, authenticated;
revoke all on function public.vrchat_session_set(text) from public, anon, authenticated;
grant execute on function public.vrchat_claim_attempt(uuid) to service_role;
grant execute on function public.vrchat_complete(uuid, text, text) to service_role;
grant execute on function public.vrchat_session_get() to service_role;
grant execute on function public.vrchat_session_set(text) to service_role;

-- ---------------------------------------------------------------- reading

-- The feed: newest first; everyone, the people you follow, or one #tag. Never shows hidden posts or
-- people you blocked / who blocked you (posts_read already filters those).
create or replace function public.feed(p_scope text default 'all', p_before timestamptz default null,
                                       p_limit int default 10, p_tag text default null)
returns table (
  id uuid, user_id uuid, username text, display_name text, avatar_path text, species text, pronouns text,
  caption text, credit text, tags text[], media_path text, media_type text,
  boops_count int, comments_count int, created_at timestamptz, booped boolean, following boolean,
  connections text[]
)
language sql stable security invoker set search_path = public as $$
  select p.id, p.user_id, pr.username, pr.display_name, pr.avatar_path, pr.species, pr.pronouns,
         p.caption, p.credit, p.tags, p.media_path, p.media_type,
         p.boops_count, p.comments_count, p.created_at,
         exists (select 1 from boops b where b.post_id = p.id and b.user_id = auth.uid()),
         exists (select 1 from follows f where f.follower_id = auth.uid() and f.followee_id = p.user_id),
         array(select c.provider from connections c where c.user_id = p.user_id order by c.provider)
    from posts p join profiles pr on pr.id = p.user_id
   where not p.hidden and not public.is_banned(p.user_id)
     and (p_before is null or p.created_at < p_before)
     and (p_tag is null or p.tags @> array[lower(p_tag)])
     and (p_scope <> 'following' or p.user_id = auth.uid()
          or p.user_id in (select followee_id from follows where follower_id = auth.uid()))
   order by p.created_at desc
   limit least(greatest(p_limit, 1), 30)
$$;

-- Tags used most in the last week.
create or replace function public.trending_tags(p_limit int default 12)
returns table (tag text, uses bigint)
language sql stable security invoker set search_path = public as $$
  select t.tag, count(*) from posts p, unnest(p.tags) as t(tag)
   where not p.hidden and not public.is_banned(p.user_id) and p.created_at > now() - interval '7 days'
   group by t.tag order by count(*) desc, t.tag limit least(greatest(p_limit, 1), 50)
$$;

revoke all on function public.feed(text, timestamptz, int, text) from public, anon;
revoke all on function public.trending_tags(int) from public, anon;
grant execute on function public.feed(text, timestamptz, int, text) to authenticated;
grant execute on function public.trending_tags(int) to authenticated;

-- Delete your own account and everything in it.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then
    raise exception 'Not logged in.' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Internal helpers aren't callable from the app.
revoke all on function public.enforce_rate_limit(int, int, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- private accounts

-- Ask to follow a private account (public accounts are followed straight away by the app).
create or replace function public.request_follow(target uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not logged in.' using errcode = '42501';
  end if;
  if target is null or target = me or not exists (select 1 from profiles where id = target) then
    raise exception 'That account doesn''t exist.' using errcode = 'P0002';
  end if;
  if is_blocked(me, target) then
    raise exception 'You can''t follow them.' using errcode = '42501';
  end if;
  if exists (select 1 from follows where follower_id = me and followee_id = target) then
    return 'following';
  end if;
  if not is_private_account(target) then
    insert into follows (follower_id, followee_id) values (me, target) on conflict do nothing;
    return 'following';
  end if;
  perform enforce_rate_limit((select count(*)::int from follow_requests
    where requester_id = me and created_at > now() - interval '1 hour'), 50, 'follow requests');
  insert into follow_requests (requester_id, target_id) values (me, target) on conflict do nothing;
  return 'requested';
end $$;
revoke all on function public.request_follow(uuid) from public, anon;
grant execute on function public.request_follow(uuid) to authenticated;

-- Approve or decline someone who asked to follow you.
create or replace function public.answer_follow_request(requester uuid, accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if not exists (select 1 from follow_requests where requester_id = requester and target_id = me) then
    raise exception 'That request is gone.' using errcode = 'P0002';
  end if;
  delete from follow_requests where requester_id = requester and target_id = me;
  if accept and not is_blocked(me, requester) then
    insert into follows (follower_id, followee_id) values (requester, me) on conflict do nothing;
  end if;
end $$;
revoke all on function public.answer_follow_request(uuid, boolean) from public, anon;
grant execute on function public.answer_follow_request(uuid, boolean) to authenticated;

-- Switching back to public lets everyone who asked follow you.
create or replace function public.profiles_privacy_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.is_private and not new.is_private then
    insert into follows (follower_id, followee_id)
    select requester_id, target_id from follow_requests where target_id = new.id
    on conflict do nothing;
    delete from follow_requests where target_id = new.id;
  end if;
  return null;
end $$;
revoke all on function public.profiles_privacy_changed() from public, anon, authenticated;
create or replace trigger profiles_privacy after update of is_private on public.profiles
  for each row execute function public.profiles_privacy_changed();

-- ---------------------------------------------------------------- direct messages

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint messages_not_self check (sender_id <> recipient_id)
);
create index if not exists messages_pair_idx on public.messages (sender_id, recipient_id, created_at desc);
create index if not exists messages_recipient_idx on public.messages (recipient_id, created_at desc);

-- One row per person per conversation: their own inbox. state: open, request (from someone new), archived,
-- hidden (deleted on their side; it comes back if a new message arrives).
create table if not exists public.dm_threads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  other_id uuid not null references public.profiles (id) on delete cascade,
  state text not null default 'open' check (state in ('open', 'request', 'archived', 'hidden')),
  last_message_at timestamptz not null default now(),
  last_body text not null default '',
  last_from_me boolean not null default false,
  unread int not null default 0,
  cleared_at timestamptz,
  primary key (user_id, other_id)
);
create index if not exists dm_threads_user_idx on public.dm_threads (user_id, last_message_at desc);

revoke all on public.messages, public.dm_threads from anon, authenticated;
grant select on public.messages, public.dm_threads to authenticated;
alter table public.messages enable row level security;
alter table public.dm_threads enable row level security;
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists dm_threads_read on public.dm_threads;
create policy dm_threads_read on public.dm_threads for select to authenticated using (user_id = auth.uid());

-- Sends a message. Checks blocks, bans and limits, and the other person's "who can message me" setting.
-- Someone new lands in their Requests until they reply or accept.
create or replace function public.send_dm(target uuid, body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  msg text := btrim(coalesce(body, ''));
  their profiles;
  r restrictions;
  existing dm_threads;
  new_state text;
  new_id uuid;
begin
  if me is null then
    raise exception 'Not logged in.' using errcode = '42501';
  end if;
  select * into their from profiles where id = target;
  if not found or target = me then
    raise exception 'That account doesn''t exist.' using errcode = 'P0002';
  end if;
  if char_length(msg) < 1 or char_length(msg) > 2000 then
    raise exception 'Messages are 1-2000 characters.' using errcode = '22023';
  end if;
  if is_blocked(me, target) then
    raise exception 'You can''t message them.' using errcode = '42501';
  end if;
  select * into r from restrictions where user_id = me and (until is null or until > now());
  if found and (r.banned or r.no_comments) then
    raise exception 'A moderator turned off messaging for your account.' using errcode = 'P0403';
  end if;
  perform enforce_rate_limit((select count(*)::int from messages
    where sender_id = me and created_at > now() - interval '10 minutes'), 60, 'messages');
  select * into existing from dm_threads where user_id = target and other_id = me;
  if found and existing.state in ('open', 'archived') then
    new_state := existing.state;
  elsif exists (select 1 from follows where follower_id = target and followee_id = me)
        or exists (select 1 from messages where sender_id = target and recipient_id = me)
        or staff_rank(me) >= 1 then
    new_state := 'open';
  else
    if their.dm_policy = 'nobody' or (their.dm_policy = 'following' and staff_rank(me) < 1) then
      raise exception '@% isn''t taking messages from people they don''t follow.', their.username using errcode = '42501';
    end if;
    perform enforce_rate_limit((select count(*)::int from dm_threads t
      where t.other_id = me and t.state = 'request' and t.last_message_at > now() - interval '1 day'
        and not exists (select 1 from messages m where m.sender_id = t.user_id and m.recipient_id = me)), 15, 'new conversations');
    new_state := 'request';
  end if;
  if their.dm_policy = 'nobody' and new_state = 'request' then
    raise exception '@% isn''t taking messages.', their.username using errcode = '42501';
  end if;
  insert into messages (sender_id, recipient_id, body) values (me, target, msg) returning id into new_id;
  insert into dm_threads (user_id, other_id, state, last_message_at, last_body, last_from_me, unread)
  values (me, target, 'open', now(), left(msg, 140), true, 0)
  on conflict (user_id, other_id) do update set state = 'open', last_message_at = now(),
    last_body = excluded.last_body, last_from_me = true, unread = 0;
  insert into dm_threads (user_id, other_id, state, last_message_at, last_body, last_from_me, unread)
  values (target, me, new_state, now(), left(msg, 140), false, 1)
  on conflict (user_id, other_id) do update set
    state = case when dm_threads.state = 'hidden' then new_state else dm_threads.state end,
    last_message_at = now(), last_body = excluded.last_body, last_from_me = false, unread = dm_threads.unread + 1;
  return new_id;
end $$;

-- The messages in one conversation (newest first), after anything you cleared.
create or replace function public.dm_messages(other uuid, p_before timestamptz default null, p_limit int default 50)
returns table (id uuid, sender_id uuid, body text, created_at timestamptz, read_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.sender_id, m.body, m.created_at, m.read_at
    from messages m
   where ((m.sender_id = auth.uid() and m.recipient_id = other) or (m.sender_id = other and m.recipient_id = auth.uid()))
     and m.created_at > coalesce((select t.cleared_at from dm_threads t where t.user_id = auth.uid() and t.other_id = other), '-infinity')
     and (p_before is null or m.created_at < p_before)
   order by m.created_at desc
   limit least(greatest(p_limit, 1), 100)
$$;

create or replace function public.dm_mark_read(other uuid) returns void
language sql security definer set search_path = public as $$
  update messages set read_at = now() where sender_id = other and recipient_id = auth.uid() and read_at is null;
  update dm_threads set unread = 0 where user_id = auth.uid() and other_id = other;
$$;

-- Accept a request (open), archive, un-archive, or delete the conversation on your side (hidden).
create or replace function public.dm_set_state(other uuid, new_state text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if new_state not in ('open', 'archived', 'hidden') then
    raise exception 'Pick open, archived or hidden.' using errcode = '22023';
  end if;
  update dm_threads set state = new_state,
         cleared_at = case when new_state = 'hidden' then now() else cleared_at end,
         unread = case when new_state = 'hidden' then 0 else unread end
   where user_id = auth.uid() and other_id = other;
  if not found then
    raise exception 'That conversation is gone.' using errcode = 'P0002';
  end if;
end $$;

-- Unread counts for the badges.
create or replace function public.dm_counts() returns table (unread bigint, requests bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(unread) filter (where state in ('open', 'archived')), 0),
         count(*) filter (where state = 'request')
    from dm_threads where user_id = auth.uid()
$$;

do $$
declare
  f text;
begin
  foreach f in array array['send_dm(uuid, text)', 'dm_messages(uuid, timestamptz, int)', 'dm_mark_read(uuid)',
                           'dm_set_state(uuid, text)', 'dm_counts()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- reporting people, and public labels

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('spam', 'scam', 'nuisance', 'bad')),
  details text not null default '' check (char_length(details) <= 300),
  created_at timestamptz not null default now(),
  unique (reporter_id, target_id),
  constraint user_reports_not_self check (reporter_id <> target_id)
);
create index if not exists user_reports_target_idx on public.user_reports (target_id);

-- When staff decide a label is unfair, reports from before that moment stop counting.
create table if not exists public.flag_clears (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  cleared_at timestamptz not null default now(),
  cleared_by uuid references public.profiles (id) on delete set null
);

revoke all on public.user_reports, public.flag_clears from anon, authenticated;
grant insert (target_id, reason, details) on public.user_reports to authenticated;
alter table public.user_reports enable row level security;
alter table public.flag_clears enable row level security;
drop policy if exists user_reports_insert_own on public.user_reports;
create policy user_reports_insert_own on public.user_reports for insert to authenticated
  with check (reporter_id = auth.uid());

-- Labels for people reported by 3 or more different people in the last 90 days (reports on their posts count
-- too). The label is the most common reason. Who reported them is never shown. Staff are never labelled.
create or replace function public.user_flags(ids uuid[]) returns table (user_id uuid, label text, reporters bigint)
language sql stable security definer set search_path = public as $$
  with raw as (
    select ur.target_id as uid, ur.reporter_id, ur.reason, ur.created_at
      from user_reports ur where ur.target_id = any(ids)
    union all
    select p.user_id, rp.reporter_id,
           case when rp.reason ilike '%spam%' or rp.reason ilike '%scam%' then 'spam'
                when rp.reason ilike '%harass%' or rp.reason ilike '%hate%' then 'bad'
                else 'nuisance' end,
           rp.created_at
      from reports rp join posts p on p.id = rp.post_id where p.user_id = any(ids)
  ), live as (
    select raw.* from raw left join flag_clears fc on fc.user_id = raw.uid
     where raw.created_at > greatest(coalesce(fc.cleared_at, '-infinity'), now() - interval '90 days')
       and staff_rank(raw.uid) = 0
  )
  select l.uid,
         (select l2.reason from live l2 where l2.uid = l.uid group by l2.reason
           order by count(distinct l2.reporter_id) desc,
                    array_position(array['scam', 'bad', 'spam', 'nuisance'], l2.reason) limit 1),
         count(distinct l.reporter_id)
    from live l group by l.uid having count(distinct l.reporter_id) >= 3
$$;
revoke all on function public.user_flags(uuid[]) from public, anon;
grant execute on function public.user_flags(uuid[]) to authenticated;

-- ---------------------------------------------------------------- the Lounge (chat, shared with Discord)

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references public.profiles (id) on delete cascade,
  source text not null default 'furzone' check (source in ('furzone', 'discord')),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  discord_id text unique,
  discord_author text check (discord_author is null or char_length(discord_author) <= 100),
  discord_avatar text check (discord_avatar is null or (discord_avatar ~ '^https://cdn\.discordapp\.com/' and char_length(discord_avatar) <= 300)),
  created_at timestamptz not null default now(),
  constraint chat_messages_author check ((source = 'furzone') = (user_id is not null))
);
create index if not exists chat_messages_created_idx on public.chat_messages (created_at desc);

-- The bridge's bookmark in the Discord channel (only the server function touches it).
create table if not exists private.lounge_state (
  id int primary key default 1 check (id = 1),
  last_discord_id text,
  last_sync_at timestamptz not null default '-infinity'
);

revoke all on public.chat_messages from anon, authenticated;
grant select, delete on public.chat_messages to authenticated;
grant insert (body) on public.chat_messages to authenticated;
alter table public.chat_messages enable row level security;
alter table private.lounge_state enable row level security;
drop policy if exists chat_read on public.chat_messages;
create policy chat_read on public.chat_messages for select to authenticated
  using (user_id is null or user_id = auth.uid() or public.staff_rank(auth.uid()) >= 1
         or (not public.is_blocked(auth.uid(), user_id) and not public.is_banned(user_id)));
drop policy if exists chat_insert_own on public.chat_messages;
create policy chat_insert_own on public.chat_messages for insert to authenticated
  with check (user_id = auth.uid() and source = 'furzone');
drop policy if exists chat_delete on public.chat_messages;
create policy chat_delete on public.chat_messages for delete to authenticated
  using (user_id = auth.uid() or public.staff_rank(auth.uid()) >= 2);

-- Server function only: may it fetch from Discord now? (at most every few seconds, for everyone together)
create or replace function public.lounge_claim_sync(min_gap_ms int) returns table (ok boolean, last_discord_id text)
language plpgsql security definer set search_path = public, private as $$
begin
  insert into private.lounge_state (id) values (1) on conflict do nothing;
  return query
    update private.lounge_state s set last_sync_at = now()
     where s.id = 1 and s.last_sync_at < now() - make_interval(secs => min_gap_ms / 1000.0)
    returning true, s.last_discord_id;
end $$;

-- Server function only: adds messages read from Discord and moves the bookmark.
create or replace function public.lounge_ingest(p_rows jsonb, p_last_id text) returns int
language plpgsql security definer set search_path = public, private as $$
declare
  added int;
begin
  insert into chat_messages (user_id, source, body, discord_id, discord_author, discord_avatar, created_at)
  select null, 'discord', left(btrim(x ->> 'body'), 1000), x ->> 'discord_id', left(x ->> 'author', 100),
         nullif(x ->> 'avatar', ''), coalesce((x ->> 'created_at')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_rows, '[]')) x
   where char_length(btrim(coalesce(x ->> 'body', ''))) > 0
  on conflict (discord_id) do nothing;
  get diagnostics added = row_count;
  if p_last_id is not null then
    update private.lounge_state set last_discord_id = p_last_id where id = 1;
  end if;
  return added;
end $$;

-- Server function only: remembers which Discord message a FurZone message became.
create or replace function public.lounge_mark_relayed(p_id bigint, p_discord_id text) returns void
language sql security definer set search_path = public as $$
  update chat_messages set discord_id = p_discord_id where id = p_id and source = 'furzone' and discord_id is null
$$;

-- ---------------------------------------------------------------- announcements (VRChat updates and FurZone news)

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('vrchat', 'furzone')),
  external_id text unique,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null default '' check (char_length(body) <= 4000),
  url text check (url is null or (url ~ '^https://' and char_length(url) <= 500)),
  published_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);
create index if not exists announcements_published_idx on public.announcements (published_at desc);

create table if not exists private.news_state (
  id int primary key default 1 check (id = 1),
  last_fetch_at timestamptz not null default '-infinity'
);

revoke all on public.announcements from anon, authenticated;
grant select on public.announcements to authenticated;
alter table public.announcements enable row level security;
alter table private.news_state enable row level security;
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements for select to authenticated using (true);

-- Admins and the owner post FurZone news.
create or replace function public.post_announcement(p_title text, p_body text, p_url text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  perform staff_require(3);
  insert into announcements (source, title, body, url, created_by)
  values ('furzone', btrim(p_title), btrim(coalesce(p_body, '')), nullif(btrim(coalesce(p_url, '')), ''), auth.uid())
  returning id into new_id;
  perform staff_note('announce', null, null, jsonb_build_object('title', left(p_title, 200)));
  return new_id;
end $$;
revoke all on function public.post_announcement(text, text, text) from public, anon;
grant execute on function public.post_announcement(text, text, text) to authenticated;

-- Server function only: time to check VRChat's news again? (at most every 30 minutes)
create or replace function public.news_claim_fetch() returns boolean
language plpgsql security definer set search_path = public, private as $$
begin
  insert into private.news_state (id) values (1) on conflict do nothing;
  update private.news_state set last_fetch_at = now() where id = 1 and last_fetch_at < now() - interval '30 minutes';
  return found;
end $$;

-- Server function only: stores VRChat news; returns the ones that are new (so they can go to Discord too).
create or replace function public.news_ingest(p_items jsonb)
returns table (id uuid, title text, body text, url text, published_at timestamptz)
language sql security definer set search_path = public as $$
  insert into announcements (source, external_id, title, body, url, published_at)
  select 'vrchat', x ->> 'external_id', left(btrim(x ->> 'title'), 200), left(coalesce(x ->> 'body', ''), 4000),
         case when x ->> 'url' ~ '^https://' then left(x ->> 'url', 500) end,
         coalesce((x ->> 'published_at')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_items, '[]')) x
   where char_length(btrim(coalesce(x ->> 'title', ''))) > 0 and coalesce(x ->> 'external_id', '') <> ''
  on conflict (external_id) do nothing
  returning id, title, body, url, published_at
$$;

do $$
declare
  f text;
begin
  foreach f in array array['lounge_claim_sync(int)', 'lounge_ingest(jsonb, text)', 'lounge_mark_relayed(bigint, text)',
                           'news_claim_fetch()', 'news_ingest(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Live updates for the Lounge and messages (Supabase Realtime still applies the read rules above).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_messages') then
      alter publication supabase_realtime add table public.chat_messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
      alter publication supabase_realtime add table public.messages;
    end if;
  end if;
end $$;


-- ---------------------------------------------------------------- comment likes, views and explore

alter table public.comments add column if not exists boops_count int not null default 0;
alter table public.posts add column if not exists views_count int not null default 0;

-- Hearts on comments.
create table if not exists public.comment_boops (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  comment_id uuid not null references public.comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, comment_id)
);
create index if not exists comment_boops_comment_idx on public.comment_boops (comment_id);

-- Who has seen which post, so each person counts once. Only written by record_view().
create table if not exists public.post_views (
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists post_views_post_idx on public.post_views (post_id);

revoke all on public.comment_boops, public.post_views from anon, authenticated;
grant select, delete on public.comment_boops to authenticated;
grant insert (comment_id) on public.comment_boops to authenticated;
alter table public.comment_boops enable row level security;
alter table public.post_views enable row level security;

drop policy if exists comment_boops_read on public.comment_boops;
create policy comment_boops_read on public.comment_boops for select to authenticated using (true);
drop policy if exists comment_boops_insert_own on public.comment_boops;
create policy comment_boops_insert_own on public.comment_boops for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.comments c join public.posts p on p.id = c.post_id
               where c.id = comment_id and not public.is_blocked(auth.uid(), c.user_id)
                 and not public.is_blocked(auth.uid(), p.user_id))
);
drop policy if exists comment_boops_delete_own on public.comment_boops;
create policy comment_boops_delete_own on public.comment_boops for delete to authenticated using (user_id = auth.uid());

create or replace function public.comment_boops_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update comments set boops_count = boops_count + 1 where id = new.comment_id;
  else
    update comments set boops_count = greatest(boops_count - 1, 0) where id = old.comment_id;
  end if;
  return null;
end $$;
revoke all on function public.comment_boops_after_change() from public, anon, authenticated;
create or replace trigger comment_boops_counts after insert or delete on public.comment_boops
  for each row execute function public.comment_boops_after_change();
create or replace trigger rate_limit before insert on public.comment_boops for each row execute function public.rate_limit();

-- Counts a view once per person, never your own, only for posts you can see.
create or replace function public.record_view(p_post uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (
    select 1 from posts p where p.id = p_post and p.user_id <> auth.uid() and not p.hidden
       and not is_blocked(auth.uid(), p.user_id)) then
    return;
  end if;
  insert into post_views (user_id, post_id) values (auth.uid(), p_post) on conflict do nothing;
  if found then
    update posts set views_count = views_count + 1 where id = p_post;
  end if;
end $$;
revoke all on function public.record_view(uuid) from public, anon;
grant execute on function public.record_view(uuid) to authenticated;

-- Explore: sort by trending, popular, viewed or new; within a time range; pictures, videos or text.
-- Trending weighs boops, comments and views, and fades as a post gets older.
create or replace function public.explore(p_sort text default 'trending', p_range text default 'week',
                                          p_type text default 'all', p_limit int default 30, p_offset int default 0)
returns table (
  id uuid, user_id uuid, username text, display_name text, avatar_path text, caption text, tags text[],
  media_path text, media_type text, boops_count int, comments_count int, views_count int, created_at timestamptz
)
language sql stable security invoker set search_path = public as $$
  select p.id, p.user_id, pr.username, pr.display_name, pr.avatar_path, p.caption, p.tags, p.media_path, p.media_type,
         p.boops_count, p.comments_count, p.views_count, p.created_at
    from posts p join profiles pr on pr.id = p.user_id
   where not p.hidden and not public.is_banned(p.user_id)
     and p.created_at > now() - case p_range when 'day' then interval '1 day' when 'week' then interval '7 days'
                                             when 'month' then interval '30 days' else interval '100 years' end
     and (p_type = 'all' or (p_type = 'text' and p.media_type is null) or p.media_type = p_type)
   order by
     case when p_sort = 'trending' then (p.boops_count * 3 + p.comments_count * 4 + p.views_count)::float8
                                        / power(extract(epoch from now() - p.created_at) / 3600 + 2, 1.3) end desc nulls last,
     case when p_sort = 'popular' then p.boops_count end desc nulls last,
     case when p_sort = 'viewed' then p.views_count end desc nulls last,
     p.created_at desc
   limit least(greatest(p_limit, 1), 60) offset greatest(p_offset, 0)
$$;
revoke all on function public.explore(text, text, text, int, int) from public, anon;
grant execute on function public.explore(text, text, text, int, int) to authenticated;

-- Search posts by words in the caption or a #tag.
create or replace function public.search_posts(p_query text, p_limit int default 30)
returns table (
  id uuid, user_id uuid, username text, display_name text, avatar_path text, caption text, tags text[],
  media_path text, media_type text, boops_count int, comments_count int, views_count int, created_at timestamptz
)
language sql stable security invoker set search_path = public as $$
  with q as (select btrim(coalesce(p_query, '')) as raw)
  select p.id, p.user_id, pr.username, pr.display_name, pr.avatar_path, p.caption, p.tags, p.media_path, p.media_type,
         p.boops_count, p.comments_count, p.views_count, p.created_at
    from posts p join profiles pr on pr.id = p.user_id, q
   where char_length(q.raw) between 2 and 60
     and not p.hidden and not public.is_banned(p.user_id)
     and (p.tags @> array[lower(ltrim(q.raw, '#'))]
          or p.caption ilike '%' || replace(replace(replace(q.raw, '\', '\\'), '%', '\%'), '_', '\_') || '%')
   order by p.boops_count desc, p.created_at desc
   limit least(greatest(p_limit, 1), 60)
$$;
revoke all on function public.search_posts(text, int) from public, anon;
grant execute on function public.search_posts(text, int) to authenticated;

-- ---------------------------------------------------------------- staff and moderation
--
-- Who can do what (you can only ever act on people ranked BELOW you, never on yourself):
--   staff  see reports, hide or un-hide posts, dismiss reports
--   mod    + delete any post or comment, turn off posting / comments / uploads / profile edits, bans up to 30 days
--   admin  + bans of any length, make or remove mods and staff, read the staff log
--   owner  + make or remove admins
-- Owners are only made in the Supabase SQL editor (see SETUP.md), never from the app.

-- Stops limited or banned people at the database, with a message the app can show as-is.
create or replace function public.enforce_restrictions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who uuid := auth.uid();
  r restrictions;
  ending text;
begin
  if who is null then
    return new;
  end if;
  -- Counters and other server-side updates aren't the person's own edits.
  if tg_table_name = 'profiles' then
    if new.id <> who or (new.username, new.display_name, new.pronouns, new.species, new.bio, new.avatar_path,
                         new.banner_path, new.ref_path)
                        is not distinct from (old.username, old.display_name, old.pronouns, old.species, old.bio,
                                              old.avatar_path, old.banner_path, old.ref_path) then
      return new;
    end if;
  elsif tg_table_name = 'posts' and tg_op = 'UPDATE' then
    if new.user_id <> who or (new.caption, new.credit) is not distinct from (old.caption, old.credit) then
      return new;
    end if;
  end if;
  select * into r from restrictions where user_id = who and (until is null or until > now());
  if not found then
    return new;
  end if;
  ending := coalesce(' until ' || to_char(r.until, 'FMMon FMDD, YYYY'), '');
  if r.banned then
    raise exception 'Your account is banned%.', ending using errcode = 'P0403';
  end if;
  if tg_table_name = 'posts' then
    if r.no_posting then
      raise exception 'A moderator turned off posting for your account%.', ending using errcode = 'P0403';
    end if;
    if tg_op = 'INSERT' and r.no_uploads and (to_jsonb(new) ->> 'media_path') is not null then
      raise exception 'A moderator turned off picture and video uploads for your account%.', ending using errcode = 'P0403';
    end if;
  elsif tg_table_name = 'chat_messages' and r.no_comments then
    raise exception 'A moderator turned off chat for your account%.', ending using errcode = 'P0403';
  elsif tg_table_name = 'comments' and r.no_comments then
    raise exception 'A moderator turned off commenting for your account%.', ending using errcode = 'P0403';
  elsif tg_table_name = 'profiles' and r.no_profile_edits then
    raise exception 'A moderator turned off profile changes for your account%.', ending using errcode = 'P0403';
  end if;
  return new;
end $$;
revoke all on function public.enforce_restrictions() from public, anon, authenticated;

create or replace trigger restrictions before insert or update on public.posts for each row execute function public.enforce_restrictions();
create or replace trigger restrictions before insert on public.comments for each row execute function public.enforce_restrictions();
create or replace trigger restrictions before update on public.profiles for each row execute function public.enforce_restrictions();
create or replace trigger restrictions before insert on public.boops for each row execute function public.enforce_restrictions();
create or replace trigger restrictions before insert on public.follows for each row execute function public.enforce_restrictions();
create or replace trigger restrictions before insert on public.reports for each row execute function public.enforce_restrictions();
create or replace trigger restrictions before insert on public.comment_boops for each row execute function public.enforce_restrictions();
create or replace trigger restrictions before insert on public.chat_messages for each row execute function public.enforce_restrictions();
create or replace trigger restrictions before insert on public.user_reports for each row execute function public.enforce_restrictions();
create or replace trigger rate_limit before insert on public.chat_messages for each row execute function public.rate_limit();
create or replace trigger rate_limit before insert on public.user_reports for each row execute function public.rate_limit();

-- Staff can clear a public label they think is unfair.
create or replace function public.staff_clear_flag(target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  mine int := staff_require(2);
begin
  perform staff_check_target(mine, target);
  insert into flag_clears (user_id, cleared_at, cleared_by) values (target, now(), auth.uid())
  on conflict (user_id) do update set cleared_at = now(), cleared_by = auth.uid();
  perform staff_note('clear_flag', target, null, null);
end $$;
revoke all on function public.staff_clear_flag(uuid) from public, anon;
grant execute on function public.staff_clear_flag(uuid) to authenticated;

-- The caller's rank, or an error if it's below what the action needs.
create or replace function public.staff_require(min_rank int) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  mine int := staff_rank(auth.uid());
begin
  if mine < min_rank then
    raise exception '%', case min_rank when 1 then 'Only staff can do that.' when 2 then 'Only mods and above can do that.'
                                       when 3 then 'Only admins and the owner can do that.' else 'Only the owner can do that.' end
      using errcode = '42501';
  end if;
  return mine;
end $$;

-- Staff may act on someone only when they outrank them (and never on themselves).
create or replace function public.staff_check_target(mine int, target uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if target is null or not exists (select 1 from profiles where id = target) then
    raise exception 'That account doesn''t exist.' using errcode = 'P0002';
  end if;
  if target = auth.uid() then
    raise exception 'You can''t do that to your own account.' using errcode = '42501';
  end if;
  if staff_rank(target) >= mine then
    raise exception 'You can only act on people ranked below you.' using errcode = '42501';
  end if;
end $$;

create or replace function public.staff_note(what text, target_user uuid, target_post uuid, details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into staff_log (actor_id, action, target_user, target_post, details) values (auth.uid(), what, target_user, target_post, coalesce(details, '{}'))
$$;

-- Give someone a rank (staff, mod, admin) or take it away (null).
create or replace function public.staff_set_role(target uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
declare
  mine int := staff_require(3);
  want int := case when new_role is null then 0 when new_role = 'admin' then 3 when new_role = 'mod' then 2
                   when new_role = 'staff' then 1 else -1 end;
begin
  if want < 0 then
    raise exception 'Pick staff, mod or admin.' using errcode = '22023';
  end if;
  perform staff_check_target(mine, target);
  if want >= mine then
    raise exception 'You can only hand out ranks below your own.' using errcode = '42501';
  end if;
  if new_role is null then
    delete from staff where user_id = target;
  else
    insert into staff (user_id, role, granted_by, granted_at) values (target, new_role, auth.uid(), now())
    on conflict (user_id) do update set role = excluded.role, granted_by = excluded.granted_by, granted_at = now();
  end if;
  perform staff_note('set_role', target, null, jsonb_build_object('role', new_role));
end $$;

-- Ban or limit an account. All false = lift everything. days null = no end date.
create or replace function public.staff_restrict(target uuid, p_banned boolean, p_no_posting boolean, p_no_comments boolean,
                                                 p_no_uploads boolean, p_no_profile_edits boolean, p_days int,
                                                 p_reason text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  mine int := staff_require(2);
  old restrictions;
  ends timestamptz;
  lifting boolean := not (coalesce(p_banned, false) or coalesce(p_no_posting, false) or coalesce(p_no_comments, false)
                          or coalesce(p_no_uploads, false) or coalesce(p_no_profile_edits, false));
begin
  perform staff_check_target(mine, target);
  if p_days is not null and (p_days < 1 or p_days > 3650) then
    raise exception 'Pick between 1 day and 10 years, or no end date.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_reason, '')) > 300 then
    raise exception 'Keep the reason under 300 characters.' using errcode = '22023';
  end if;
  select * into old from restrictions where user_id = target;
  if mine < 3 and found and old.banned and old.until is null then
    raise exception 'Only admins and the owner can change a permanent ban.' using errcode = '42501';
  end if;
  if mine < 3 and coalesce(p_banned, false) and (p_days is null or p_days > 30) then
    raise exception 'Mods can ban for up to 30 days. Ask an admin for longer.' using errcode = '42501';
  end if;
  ends := case when p_days is null then null else now() + make_interval(days => p_days) end;
  if lifting then
    delete from restrictions where user_id = target;
  else
    insert into restrictions (user_id, banned, no_posting, no_comments, no_uploads, no_profile_edits, reason, until, set_by, set_at)
    values (target, coalesce(p_banned, false), coalesce(p_no_posting, false), coalesce(p_no_comments, false),
            coalesce(p_no_uploads, false), coalesce(p_no_profile_edits, false), btrim(coalesce(p_reason, '')), ends, auth.uid(), now())
    on conflict (user_id) do update set banned = excluded.banned, no_posting = excluded.no_posting,
      no_comments = excluded.no_comments, no_uploads = excluded.no_uploads, no_profile_edits = excluded.no_profile_edits,
      reason = excluded.reason, until = excluded.until, set_by = excluded.set_by, set_at = now();
  end if;
  -- Also stop (or allow) logging in, so a ban takes effect on every device.
  begin
    update auth.users set banned_until = case when coalesce(p_banned, false) then coalesce(ends, now() + interval '100 years') end
     where id = target;
  exception when undefined_column then
    null;
  end;
  perform staff_note(case when lifting then 'lift' when p_banned then 'ban' else 'limit' end, target, null,
                     jsonb_build_object('no_posting', p_no_posting, 'no_comments', p_no_comments, 'no_uploads', p_no_uploads,
                                        'no_profile_edits', p_no_profile_edits, 'days', p_days, 'reason', p_reason));
end $$;

create or replace function public.staff_set_post_hidden(p_post uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  mine int := staff_require(1);
  author uuid;
begin
  select user_id into author from posts where id = p_post;
  if not found then
    raise exception 'That post is gone.' using errcode = 'P0002';
  end if;
  perform staff_check_target(mine, author);
  update posts set hidden = coalesce(p_hidden, true) where id = p_post;
  perform staff_note(case when p_hidden then 'hide_post' else 'unhide_post' end, author, p_post, null);
end $$;

-- Returns the post's file path so the app can remove the file too.
create or replace function public.staff_delete_post(p_post uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  mine int := staff_require(2);
  p posts;
begin
  select * into p from posts where id = p_post;
  if not found then
    raise exception 'That post is gone.' using errcode = 'P0002';
  end if;
  perform staff_check_target(mine, p.user_id);
  delete from posts where id = p_post;
  perform staff_note('delete_post', p.user_id, p_post, jsonb_build_object('caption', left(p.caption, 200)));
  return p.media_path;
end $$;

create or replace function public.staff_delete_comment(p_comment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  mine int := staff_require(2);
  c comments;
begin
  select * into c from comments where id = p_comment;
  if not found then
    return;
  end if;
  perform staff_check_target(mine, c.user_id);
  delete from comments where id = p_comment;
  perform staff_note('delete_comment', c.user_id, c.post_id, jsonb_build_object('body', left(c.body, 200)));
end $$;

-- "Looks fine": clear a post's reports and show it again.
create or replace function public.staff_dismiss_reports(p_post uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  mine int := staff_require(1);
  author uuid;
begin
  select user_id into author from posts where id = p_post;
  if not found then
    raise exception 'That post is gone.' using errcode = 'P0002';
  end if;
  perform staff_check_target(mine, author);
  delete from reports where post_id = p_post;
  update posts set reports_count = 0, hidden = false where id = p_post;
  perform staff_note('dismiss_reports', author, p_post, null);
end $$;

-- Reported posts, most recently reported first.
create or replace function public.staff_reports()
returns table (post_id uuid, reports bigint, reasons text[], last_report timestamptz, hidden boolean, caption text,
               media_path text, media_type text, user_id uuid, username text, display_name text, avatar_path text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform staff_require(1);
  return query
    select p.id, count(r.*), array_agg(distinct r.reason), max(r.created_at), p.hidden, p.caption, p.media_path,
           p.media_type, p.user_id, pr.username, pr.display_name, pr.avatar_path
      from reports r join posts p on p.id = r.post_id join profiles pr on pr.id = p.user_id
     group by p.id, pr.id
     order by max(r.created_at) desc
     limit 100;
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['staff_set_role(uuid, text)',
                           'staff_restrict(uuid, boolean, boolean, boolean, boolean, boolean, int, text)',
                           'staff_set_post_hidden(uuid, boolean)', 'staff_delete_post(uuid)', 'staff_delete_comment(uuid)',
                           'staff_dismiss_reports(uuid)', 'staff_reports()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['staff_require(int)', 'staff_check_target(int, uuid)', 'staff_note(text, uuid, uuid, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- media storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

-- Uploads only into your own folder: media/<your user id>/...
drop policy if exists media_insert_own on storage.objects;
create policy media_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text
              and not public.my_restriction('upload'));
drop policy if exists media_update_own on storage.objects;
create policy media_update_own on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists media_delete_own on storage.objects;
create policy media_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'media' and ((storage.foldername(name))[1] = auth.uid()::text
                                  or public.staff_rank(auth.uid()) >= 2));
drop policy if exists media_list_own on storage.objects;
create policy media_list_own on storage.objects for select to authenticated
  using (bucket_id = 'media' and ((storage.foldername(name))[1] = auth.uid()::text
                                  or public.staff_rank(auth.uid()) >= 2));

-- ---------------------------------------------------------------- hardening (Supabase security advisor)

-- Fixed search path on the two plain helper functions.
alter function public.enforce_rate_limit(int, int, text) set search_path = public;
alter function public.extract_tags(text) set search_path = public;

-- Trigger functions run only from their triggers; nobody may call them through the API.
revoke all on function public.rate_limit() from public, anon, authenticated;
revoke all on function public.posts_before_write() from public, anon, authenticated;
revoke all on function public.posts_after_change() from public, anon, authenticated;
revoke all on function public.boops_after_change() from public, anon, authenticated;
revoke all on function public.comments_after_change() from public, anon, authenticated;
revoke all on function public.follows_after_change() from public, anon, authenticated;
revoke all on function public.blocks_after_insert() from public, anon, authenticated;
revoke all on function public.reports_after_insert() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.sync_discord_connection() from public, anon, authenticated;
revoke all on function public.profiles_after_insert() from public, anon, authenticated;

-- is_blocked only answers about yourself, so nobody can probe who blocked whom between other people.
-- (Every policy calls it with auth.uid() as one side, so this changes nothing for the app.)
create or replace function public.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and auth.uid() in (a, b)
     and exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;
