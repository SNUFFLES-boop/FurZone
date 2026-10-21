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

-- ---------------------------------------------------------------- privileges
-- Supabase grants everything on new tables to anon and authenticated by default; take it back and hand
-- out only what the app needs. Logged-out visitors (anon) get nothing.

revoke all on public.profiles, public.posts, public.boops, public.comments, public.follows, public.blocks,
  public.reports, public.notifications, public.connections from anon, authenticated;
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

-- ---------------------------------------------------------------- blocking helper

-- True when either person blocked the other. Security definer so it can see blocks you didn't make.
create or replace function public.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;
revoke all on function public.is_blocked(uuid, uuid) from public, anon;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;

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
  using (user_id = auth.uid() or (not hidden and not public.is_blocked(auth.uid(), user_id)));
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
  using (not public.is_blocked(auth.uid(), user_id));
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
  with check (follower_id = auth.uid() and not public.is_blocked(auth.uid(), followee_id));
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
   where not p.hidden
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
   where not p.hidden and p.created_at > now() - interval '7 days'
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

-- ---------------------------------------------------------------- media storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

-- Uploads only into your own folder: media/<your user id>/...
drop policy if exists media_insert_own on storage.objects;
create policy media_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists media_update_own on storage.objects;
create policy media_update_own on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists media_delete_own on storage.objects;
create policy media_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists media_list_own on storage.objects;
create policy media_list_own on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
