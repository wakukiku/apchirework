-- Apchi public-release schema for a new Supabase project.
-- Existing projects must apply only the missing numbered migrations; see README.


-- ===== tests/fixtures/schema_stage1.sql =====
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  bio text not null default '',
  city text,
  status_text text not null default '',
  interests text[] not null default '{}',
  avatar_color text not null default '#ca8f73',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'light' check (theme in ('light','dark')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct' check (kind in ('direct')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  archived_at timestamptz,
  pinned_at timestamptz,
  muted boolean not null default false,
  hidden_at timestamptz,
  last_read_at timestamptz,
  dialog_theme text not null default 'system'
    check (dialog_theme in ('system','cream','twilight','sage','cherry','moon')),
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists messages_conversation_created_idx
  on public.messages(conversation_id, created_at);

create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'note'
    check (kind in ('note','checklist','link','voice','quote')),
  title text not null default '',
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists drafts_user_updated_idx
  on public.drafts(user_id, updated_at desc);

create table if not exists public.blocked_users (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  wanted_username text;
  safe_username text;
  wanted_name text;
begin
  wanted_name := coalesce(
    nullif(new.raw_user_meta_data->>'display_name', ''),
    split_part(coalesce(new.email, 'apchi'), '@', 1)
  );

  wanted_username := lower(coalesce(
    nullif(new.raw_user_meta_data->>'username', ''),
    split_part(coalesce(new.email, 'apchi'), '@', 1)
  ));

  safe_username := regexp_replace(wanted_username, '[^a-z0-9_]+', '', 'g');

  if length(safe_username) < 3 then
    safe_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;

  while exists (select 1 from public.profiles where username = safe_username) loop
    safe_username := safe_username || '_' || substr(md5(random()::text), 1, 4);
  end loop;

  insert into public.profiles(id, username, display_name)
  values(new.id, safe_username, wanted_name);

  insert into public.user_preferences(user_id)
  values(new.id)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at
before update on public.profiles
for each row execute procedure public.touch_updated_at();

drop trigger if exists touch_drafts_updated_at on public.drafts;
create trigger touch_drafts_updated_at
before update on public.drafts
for each row execute procedure public.touch_updated_at();

create or replace function public.touch_conversation_from_message()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.conversations
  set updated_at = now()
  where id = new.conversation_id;

  update public.conversation_members
  set hidden_at = null
  where conversation_id = new.conversation_id
    and user_id <> new.sender_id;

  return new;
end;
$$;

drop trigger if exists on_message_created on public.messages;
create trigger on_message_created
after insert on public.messages
for each row execute procedure public.touch_conversation_from_message();

create or replace function public.discover_people(limit_count integer default 10)
returns table (
  id uuid,
  username text,
  display_name text,
  bio text,
  city text,
  status_text text,
  interests text[],
  avatar_color text,
  last_seen_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.username,
    p.display_name,
    p.bio,
    p.city,
    p.status_text,
    p.interests,
    p.avatar_color,
    p.last_seen_at,
    p.created_at
  from public.profiles p
  where p.id <> auth.uid()
    and not exists (
      select 1
      from public.blocked_users b
      where
        (b.blocker_id = auth.uid() and b.blocked_id = p.id)
        or
        (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
  order by random()
  limit greatest(1, least(limit_count, 10));
$$;

create or replace function public.get_or_create_direct_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing_id uuid;
  new_id uuid;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  if other_user_id = me then
    raise exception 'Cannot create direct conversation with self';
  end if;

  if exists (
    select 1
    from public.blocked_users
    where
      (blocker_id = me and blocked_id = other_user_id)
      or
      (blocker_id = other_user_id and blocked_id = me)
  ) then
    raise exception 'Conversation is unavailable';
  end if;

  select c.id into existing_id
  from public.conversations c
  where c.kind = 'direct'
    and exists (
      select 1
      from public.conversation_members cm
      where cm.conversation_id = c.id and cm.user_id = me
    )
    and exists (
      select 1
      from public.conversation_members cm
      where cm.conversation_id = c.id and cm.user_id = other_user_id
    )
    and (
      select count(*)
      from public.conversation_members cm
      where cm.conversation_id = c.id
    ) = 2
  limit 1;

  if existing_id is not null then
    update public.conversation_members
      set hidden_at = null
    where conversation_id = existing_id and user_id = me;

    return existing_id;
  end if;

  insert into public.conversations(kind)
  values('direct')
  returning id into new_id;

  insert into public.conversation_members(conversation_id, user_id)
  values
    (new_id, me),
    (new_id, other_user_id);

  return new_id;
end;
$$;

create or replace function public.list_my_direct_chats(include_archived boolean default false)
returns table (
  conversation_id uuid,
  other_user_id uuid,
  display_name text,
  username text,
  bio text,
  avatar_color text,
  last_seen_at timestamptz,
  last_message text,
  last_message_at timestamptz,
  archived boolean,
  pinned boolean,
  muted boolean,
  dialog_theme text,
  unread_count bigint
)
language sql
security definer
set search_path = public
as $$
  with mine as (
    select
      cm.conversation_id,
      cm.archived_at,
      cm.pinned_at,
      cm.muted,
      cm.hidden_at,
      cm.last_read_at,
      cm.dialog_theme
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    where cm.user_id = auth.uid()
      and c.kind = 'direct'
      and cm.hidden_at is null
      and (include_archived or cm.archived_at is null)
  ),
  other_member as (
    select
      m.conversation_id,
      cm.user_id
    from mine m
    join public.conversation_members cm
      on cm.conversation_id = m.conversation_id
     and cm.user_id <> auth.uid()
  )
  select
    m.conversation_id,
    p.id as other_user_id,
    p.display_name,
    p.username,
    p.bio,
    p.avatar_color,
    p.last_seen_at,
    lm.body as last_message,
    lm.created_at as last_message_at,
    m.archived_at is not null as archived,
    m.pinned_at is not null as pinned,
    m.muted,
    m.dialog_theme,
    (
      select count(*)
      from public.messages msg
      where msg.conversation_id = m.conversation_id
        and msg.sender_id <> auth.uid()
        and msg.deleted_at is null
        and msg.created_at > coalesce(m.last_read_at, '1970-01-01'::timestamptz)
    ) as unread_count
  from mine m
  join other_member om on om.conversation_id = m.conversation_id
  join public.profiles p on p.id = om.user_id
  left join lateral (
    select msg.body, msg.created_at
    from public.messages msg
    where msg.conversation_id = m.conversation_id
      and msg.deleted_at is null
    order by msg.created_at desc
    limit 1
  ) lm on true
  order by
    (m.pinned_at is not null) desc,
    m.pinned_at desc nulls last,
    coalesce(lm.created_at, now()) desc;
$$;

alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.drafts enable row level security;
alter table public.blocked_users enable row level security;

drop policy if exists "profiles readable by signed users" on public.profiles;
create policy "profiles readable by signed users"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "own preferences" on public.user_preferences;
create policy "own preferences"
on public.user_preferences for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "members read conversations" on public.conversations;
create policy "members read conversations"
on public.conversations for select
to authenticated
using (
  exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = id and cm.user_id = auth.uid()
  )
);

drop policy if exists "members read memberships" on public.conversation_members;
create policy "members read memberships"
on public.conversation_members for select
to authenticated
using (
  exists (
    select 1 from public.conversation_members mine
    where mine.conversation_id = conversation_members.conversation_id
      and mine.user_id = auth.uid()
  )
);

drop policy if exists "user updates own membership settings" on public.conversation_members;
create policy "user updates own membership settings"
on public.conversation_members for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "members read messages" on public.messages;
create policy "members read messages"
on public.messages for select
to authenticated
using (
  exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.user_id = auth.uid()
  )
);

drop policy if exists "members send messages" on public.messages;
create policy "members send messages"
on public.messages for insert
to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.user_id = auth.uid()
  )
  and not exists (
    select 1
    from public.conversation_members other_cm
    join public.blocked_users b
      on (
        (b.blocker_id = auth.uid() and b.blocked_id = other_cm.user_id)
        or
        (b.blocker_id = other_cm.user_id and b.blocked_id = auth.uid())
      )
    where other_cm.conversation_id = messages.conversation_id
      and other_cm.user_id <> auth.uid()
  )
);

drop policy if exists "own drafts" on public.drafts;
create policy "own drafts"
on public.drafts for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "own block list" on public.blocked_users;
create policy "own block list"
on public.blocked_users for all
to authenticated
using (blocker_id = auth.uid())
with check (blocker_id = auth.uid());

grant execute on function public.discover_people(integer) to authenticated;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;
grant execute on function public.list_my_direct_chats(boolean) to authenticated;

alter publication supabase_realtime add table public.messages;


-- ===== supabase/migrations/002_stage_1_1.sql =====
alter table public.profiles
  add column if not exists avatar_url text;

create table if not exists public.profile_avatars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  public_url text not null,
  created_at timestamptz not null default now()
);

alter table public.profile_avatars enable row level security;

drop policy if exists "users read own avatar history" on public.profile_avatars;
create policy "users read own avatar history"
on public.profile_avatars for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "users insert own avatar history" on public.profile_avatars;
create policy "users insert own avatar history"
on public.profile_avatars for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "users delete own avatar history" on public.profile_avatars;
create policy "users delete own avatar history"
on public.profile_avatars for delete
to authenticated
using (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public avatar reads" on storage.objects;
create policy "public avatar reads"
on storage.objects for select
to public
using (bucket_id = 'avatars');

drop policy if exists "users upload own avatars" on storage.objects;
create policy "users upload own avatars"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "users delete own avatars" on storage.objects;
create policy "users delete own avatars"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Security-definer helpers avoid recursive RLS on conversation_members.
create or replace function public.is_conversation_member(
  target_conversation_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = target_conversation_id
      and cm.user_id = target_user_id
  );
$$;

create or replace function public.users_blocked_between(
  first_user uuid,
  second_user uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.blocked_users b
    where
      (b.blocker_id = first_user and b.blocked_id = second_user)
      or
      (b.blocker_id = second_user and b.blocked_id = first_user)
  );
$$;

create or replace function public.other_conversation_user(
  target_conversation_id uuid,
  current_user_id uuid default auth.uid()
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cm.user_id
  from public.conversation_members cm
  where cm.conversation_id = target_conversation_id
    and cm.user_id <> current_user_id
  limit 1;
$$;

drop policy if exists "members read conversations" on public.conversations;
create policy "members read conversations"
on public.conversations for select
to authenticated
using (public.is_conversation_member(id, auth.uid()));

drop policy if exists "members read memberships" on public.conversation_members;
create policy "members read memberships"
on public.conversation_members for select
to authenticated
using (public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists "members read messages" on public.messages;
create policy "members read messages"
on public.messages for select
to authenticated
using (public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists "members send messages" on public.messages;
create policy "members send messages"
on public.messages for insert
to authenticated
with check (
  sender_id = auth.uid()
  and public.is_conversation_member(conversation_id, auth.uid())
  and not public.users_blocked_between(
    auth.uid(),
    public.other_conversation_user(conversation_id, auth.uid())
  )
);

-- Replace discovery: only people with whom the current user does NOT already
-- have a direct conversation.
drop function if exists public.discover_people(integer);
create or replace function public.discover_people(limit_count integer default 10)
returns table (
  id uuid,
  username text,
  display_name text,
  bio text,
  city text,
  status_text text,
  interests text[],
  avatar_color text,
  avatar_url text,
  last_seen_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.username,
    p.display_name,
    p.bio,
    p.city,
    p.status_text,
    p.interests,
    p.avatar_color,
    p.avatar_url,
    p.last_seen_at,
    p.created_at
  from public.profiles p
  where p.id <> auth.uid()
    and not public.users_blocked_between(auth.uid(), p.id)
    and not exists (
      select 1
      from public.conversations c
      where c.kind = 'direct'
        and public.is_conversation_member(c.id, auth.uid())
        and public.is_conversation_member(c.id, p.id)
    )
  order by random()
  limit greatest(1, least(limit_count, 10));
$$;

-- Existing contacts/friends: only users with whom at least one message exists.
create or replace function public.list_my_friends()
returns table (
  conversation_id uuid,
  user_id uuid,
  username text,
  display_name text,
  bio text,
  interests text[],
  avatar_color text,
  avatar_url text,
  last_seen_at timestamptz,
  last_message text,
  last_message_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    c.id as conversation_id,
    p.id as user_id,
    p.username,
    p.display_name,
    p.bio,
    p.interests,
    p.avatar_color,
    p.avatar_url,
    p.last_seen_at,
    lm.body as last_message,
    lm.created_at as last_message_at
  from public.conversations c
  join public.conversation_members mine
    on mine.conversation_id = c.id
   and mine.user_id = auth.uid()
  join public.conversation_members other_cm
    on other_cm.conversation_id = c.id
   and other_cm.user_id <> auth.uid()
  join public.profiles p on p.id = other_cm.user_id
  join lateral (
    select msg.body, msg.created_at
    from public.messages msg
    where msg.conversation_id = c.id
      and msg.deleted_at is null
    order by msg.created_at desc
    limit 1
  ) lm on true
  where c.kind = 'direct'
    and mine.hidden_at is null
    and not public.users_blocked_between(auth.uid(), p.id)
  order by lm.created_at desc;
$$;

-- Replace chat listing to include avatars and last_read_at.
drop function if exists public.list_my_direct_chats(boolean);

create function public.list_my_direct_chats(include_archived boolean default false)
returns table (
  conversation_id uuid,
  other_user_id uuid,
  display_name text,
  username text,
  bio text,
  avatar_color text,
  avatar_url text,
  last_seen_at timestamptz,
  last_message text,
  last_message_at timestamptz,
  last_read_at timestamptz,
  archived boolean,
  pinned boolean,
  muted boolean,
  dialog_theme text,
  unread_count bigint
)
language sql
security definer
set search_path = public
as $$
  with mine as (
    select
      cm.conversation_id,
      cm.archived_at,
      cm.pinned_at,
      cm.muted,
      cm.hidden_at,
      cm.last_read_at,
      cm.dialog_theme
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    where cm.user_id = auth.uid()
      and c.kind = 'direct'
      and cm.hidden_at is null
      and (include_archived or cm.archived_at is null)
  ),
  other_member as (
    select
      m.conversation_id,
      cm.user_id
    from mine m
    join public.conversation_members cm
      on cm.conversation_id = m.conversation_id
     and cm.user_id <> auth.uid()
  )
  select
    m.conversation_id,
    p.id as other_user_id,
    p.display_name,
    p.username,
    p.bio,
    p.avatar_color,
    p.avatar_url,
    p.last_seen_at,
    lm.body as last_message,
    lm.created_at as last_message_at,
    m.last_read_at,
    m.archived_at is not null as archived,
    m.pinned_at is not null as pinned,
    m.muted,
    m.dialog_theme,
    (
      select count(*)
      from public.messages msg
      where msg.conversation_id = m.conversation_id
        and msg.sender_id <> auth.uid()
        and msg.deleted_at is null
        and msg.created_at > coalesce(m.last_read_at, '1970-01-01'::timestamptz)
    ) as unread_count
  from mine m
  join other_member om on om.conversation_id = m.conversation_id
  join public.profiles p on p.id = om.user_id
  left join lateral (
    select msg.body, msg.created_at
    from public.messages msg
    where msg.conversation_id = m.conversation_id
      and msg.deleted_at is null
    order by msg.created_at desc
    limit 1
  ) lm on true
  order by
    (m.pinned_at is not null) desc,
    m.pinned_at desc nulls last,
    coalesce(lm.created_at, cURRENT_TIMESTAMP) desc;
$$;

grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;
grant execute on function public.users_blocked_between(uuid, uuid) to authenticated;
grant execute on function public.other_conversation_user(uuid, uuid) to authenticated;
grant execute on function public.discover_people(integer) to authenticated;
grant execute on function public.list_my_friends() to authenticated;
grant execute on function public.list_my_direct_chats(boolean) to authenticated;


-- ===== supabase/migrations/003_web_complete.sql =====
-- Apply once AFTER schema.sql and 002_stage_1_1.sql. Existing data is preserved.
begin;
create schema if not exists apchi_private;
revoke all on schema apchi_private from public, anon;
grant usage on schema apchi_private to authenticated;

alter table public.conversation_members add column if not exists deleted_before timestamptz;
alter table public.messages add column if not exists attachment_path text;
alter table public.messages add column if not exists attachment_name text;
alter table public.messages add column if not exists attachment_type text;
alter table public.messages add column if not exists attachment_size bigint;
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_content_check check (
  char_length(body) <= 10000 and (char_length(trim(body)) > 0 or attachment_path is not null or deleted_at is not null)
);
create unique index if not exists messages_attachment_unique on public.messages(attachment_path) where attachment_path is not null;
create index if not exists members_user_idx on public.conversation_members(user_id, conversation_id);
create index if not exists blocks_target_idx on public.blocked_users(blocked_id, blocker_id);

create or replace function apchi_private.member(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.conversation_members where conversation_id = cid and user_id = auth.uid());
$$;
create or replace function apchi_private.blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() in (a,b) and exists(select 1 from public.blocked_users where (blocker_id=a and blocked_id=b) or (blocker_id=b and blocked_id=a));
$$;
create or replace function apchi_private.can_send(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select apchi_private.member(cid) and not exists (
  select 1 from public.conversation_members where conversation_id=cid and user_id<>auth.uid() and apchi_private.blocked(auth.uid(),user_id));
$$;
create or replace function apchi_private.can_read_message(cid uuid, sent timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.conversation_members where conversation_id=cid and user_id=auth.uid() and (deleted_before is null or sent>deleted_before));
$$;

-- Legacy exposed helper RPCs must never answer questions about arbitrary users.
create or replace function public.is_conversation_member(target_conversation_id uuid, target_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = '' as $$
 select apchi_private.member(target_conversation_id) and exists(select 1 from public.conversation_members where conversation_id=target_conversation_id and user_id=target_user_id);
$$;
create or replace function public.users_blocked_between(first_user uuid, second_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() in (first_user,second_user) and apchi_private.blocked(first_user,second_user);
$$;
create or replace function public.other_conversation_user(target_conversation_id uuid, current_user_id uuid default auth.uid()) returns uuid
language sql stable security definer set search_path = '' as $$
 select user_id from public.conversation_members where conversation_id=target_conversation_id and user_id<>auth.uid()
 and current_user_id=auth.uid() and apchi_private.member(target_conversation_id) limit 1;
$$;

drop policy if exists "members read memberships" on public.conversation_members;
create policy "members read memberships" on public.conversation_members for select to authenticated using(user_id=auth.uid());
drop policy if exists "members read conversations" on public.conversations;
create policy "members read conversations" on public.conversations for select to authenticated using(apchi_private.member(id));
drop policy if exists "members read messages" on public.messages;
create policy "members read messages" on public.messages for select to authenticated using(apchi_private.can_read_message(conversation_id,created_at));
drop policy if exists "members send messages" on public.messages;
create policy "members send messages" on public.messages for insert to authenticated with check(sender_id=auth.uid() and apchi_private.can_send(conversation_id));
drop policy if exists "profiles readable by signed users" on public.profiles;
create policy "profiles readable by signed users" on public.profiles for select to authenticated using(id=auth.uid() or not apchi_private.blocked(auth.uid(),id));

-- Mutations of membership IDs, timestamps, senders and conversation IDs are forbidden.
revoke all on public.conversation_members, public.conversations, public.messages, public.profiles, public.profile_avatars from anon;
revoke insert, update, delete on public.conversation_members, public.conversations from authenticated;
revoke insert, update, delete on public.messages from authenticated;
grant insert(id,conversation_id,sender_id,body,attachment_path,attachment_name,attachment_type,attachment_size) on public.messages to authenticated;
revoke update on public.profiles from authenticated;
grant update(display_name,username,bio,city,status_text,interests,last_seen_at) on public.profiles to authenticated;
revoke insert, update, delete on public.profile_avatars from authenticated;

create or replace function public.get_or_create_direct_conversation(other_user_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); cid uuid;
begin
 if me is null or other_user_id is null or other_user_id=me then raise exception 'Недоступный собеседник'; end if;
 -- A pair lock serializes concurrent creation from both devices.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(me::text,other_user_id::text)||greatest(me::text,other_user_id::text),0));
 if not exists(select 1 from public.profiles where id=other_user_id) or apchi_private.blocked(me,other_user_id) then raise exception 'Диалог недоступен'; end if;
 select a.conversation_id into cid from public.conversation_members a join public.conversation_members b using(conversation_id)
 where a.user_id=me and b.user_id=other_user_id order by a.created_at limit 1;
 if cid is null then
  insert into public.conversations default values returning id into cid;
  insert into public.conversation_members(conversation_id,user_id) values(cid,me),(cid,other_user_id);
 else
  update public.conversation_members set hidden_at=null where conversation_id=cid and user_id=me;
 end if;
 return cid;
end; $$;

create or replace function public.set_chat_setting(cid uuid, setting text, enabled boolean default true, theme text default 'system') returns void
language plpgsql security definer set search_path = '' as $$
begin
 if not apchi_private.member(cid) then raise exception 'Нет доступа'; end if;
 if setting='pin' then update public.conversation_members set pinned_at=case when enabled then now() else null end where conversation_id=cid and user_id=auth.uid();
 elsif setting='archive' then update public.conversation_members set archived_at=case when enabled then now() else null end where conversation_id=cid and user_id=auth.uid();
 elsif setting='mute' then update public.conversation_members set muted=enabled where conversation_id=cid and user_id=auth.uid();
 elsif setting='delete' then update public.conversation_members set hidden_at=now(),deleted_before=now(),last_read_at=now(),pinned_at=null where conversation_id=cid and user_id=auth.uid();
 elsif setting='theme' and theme in ('system','cream','twilight','sage','cherry','moon') then update public.conversation_members set dialog_theme=theme where conversation_id=cid and user_id=auth.uid();
 else raise exception 'Неверная настройка'; end if;
end; $$;

create or replace function public.mark_chat_read(cid uuid, message_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare stamp timestamptz;
begin
 if not apchi_private.member(cid) then raise exception 'Нет доступа'; end if;
 select created_at into stamp from public.messages where id=message_id and conversation_id=cid;
 if stamp is not null then update public.conversation_members set last_read_at=greatest(last_read_at,stamp) where conversation_id=cid and user_id=auth.uid(); end if;
end; $$;

create or replace function public.delete_my_message(message_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 update public.messages set body='',deleted_at=now(),attachment_name=null,attachment_type=null,attachment_size=null
 where id=message_id and sender_id=auth.uid();
 if not found then raise exception 'Нет доступа'; end if;
end; $$;

drop function public.list_my_direct_chats(boolean);
create function public.list_my_direct_chats(include_archived boolean default false)
returns table(conversation_id uuid,other_user_id uuid,display_name text,username text,bio text,avatar_color text,avatar_url text,last_seen_at timestamptz,last_message text,last_message_at timestamptz,last_read_at timestamptz,archived boolean,pinned boolean,muted boolean,dialog_theme text,unread_count bigint,blocked_by_me boolean,unavailable boolean)
language sql stable security definer set search_path = '' as $$
 select mine.conversation_id,p.id,p.display_name,p.username,
 case when apchi_private.blocked(auth.uid(),p.id) then '' else p.bio end,p.avatar_color,
 case when apchi_private.blocked(auth.uid(),p.id) then null else p.avatar_url end,
 case when apchi_private.blocked(auth.uid(),p.id) then null else p.last_seen_at end,
 lm.body,lm.created_at,mine.last_read_at,mine.archived_at is not null,mine.pinned_at is not null,mine.muted,mine.dialog_theme,
 (select count(*) from public.messages m where m.conversation_id=mine.conversation_id and m.sender_id<>auth.uid() and m.deleted_at is null and m.created_at>coalesce(mine.last_read_at,'epoch') and m.created_at>coalesce(mine.deleted_before,'epoch')),
 exists(select 1 from public.blocked_users where blocker_id=auth.uid() and blocked_id=p.id),apchi_private.blocked(auth.uid(),p.id)
 from public.conversation_members mine
 join public.conversation_members other on other.conversation_id=mine.conversation_id and other.user_id<>auth.uid()
 join public.profiles p on p.id=other.user_id
 left join lateral (select coalesce(nullif(m.body,''),m.attachment_name,'Файл') body,m.created_at from public.messages m where m.conversation_id=mine.conversation_id and m.deleted_at is null and m.created_at>coalesce(mine.deleted_before,'epoch') order by m.created_at desc,m.id desc limit 1) lm on true
 where mine.user_id=auth.uid() and mine.hidden_at is null and (include_archived or mine.archived_at is null)
 order by mine.pinned_at desc nulls last,coalesce(lm.created_at,mine.created_at) desc;
$$;

drop function public.discover_people(integer);
create function public.discover_people(limit_count integer default 10) returns setof public.profiles
language sql security definer set search_path = '' as $$
 select p.* from public.profiles p where auth.uid() is not null and p.id<>auth.uid() and not apchi_private.blocked(auth.uid(),p.id)
 and not exists(select 1 from public.conversation_members a join public.conversation_members b using(conversation_id) join public.messages m on m.conversation_id=a.conversation_id where a.user_id=auth.uid() and b.user_id=p.id)
 order by random() limit greatest(1,least(limit_count,10));
$$;

create or replace function public.list_my_friends()
returns table(conversation_id uuid,user_id uuid,username text,display_name text,bio text,interests text[],avatar_color text,avatar_url text,last_seen_at timestamptz,last_message text,last_message_at timestamptz)
language sql stable security definer set search_path = '' as $$
 select distinct on (p.id) mine.conversation_id,p.id,p.username,p.display_name,p.bio,p.interests,p.avatar_color,p.avatar_url,p.last_seen_at,
 case when lm.created_at>coalesce(mine.deleted_before,'epoch') then lm.body else null end,lm.created_at
 from public.conversation_members mine join public.conversation_members other on other.conversation_id=mine.conversation_id and other.user_id<>auth.uid()
 join public.profiles p on p.id=other.user_id
 join lateral(select case when m.deleted_at is null then m.body else null end body,m.created_at from public.messages m where m.conversation_id=mine.conversation_id order by m.created_at desc limit 1) lm on true
 where mine.user_id=auth.uid() and not apchi_private.blocked(auth.uid(),p.id) order by p.id,lm.created_at desc;
$$;

create or replace function public.list_blocked_profiles() returns table(id uuid,username text,display_name text)
language sql stable security definer set search_path = '' as $$
 select p.id,p.username,p.display_name from public.blocked_users b join public.profiles p on p.id=b.blocked_id where b.blocker_id=auth.uid() order by b.created_at desc;
$$;
create or replace function public.get_visible_profile(target uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles; blocked boolean;
begin
 if auth.uid() is null then raise exception 'Нет доступа'; end if;
 select * into p from public.profiles where id=target;
 if p.id is null then raise exception 'Профиль не найден'; end if;
 blocked := apchi_private.blocked(auth.uid(),target);
 if blocked then p.bio:='';p.city:=null;p.status_text:='';p.interests:='{}';p.avatar_url:=null;p.last_seen_at:=null;end if;
 return to_jsonb(p)||jsonb_build_object('unavailable',blocked,'blocked_by_me',exists(select 1 from public.blocked_users where blocker_id=auth.uid() and blocked_id=target));
end; $$;

-- Private storage: avatar history is owner-only; only the selected image can be read by other unblocked accounts.
update storage.buckets set public=false where id='avatars';
drop policy if exists "public avatar reads" on storage.objects;
create or replace function apchi_private.avatar_read(path text) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and (split_part(path,'/',1)=auth.uid()::text or exists(
 select 1 from public.profile_avatars a join public.profiles p on p.id=a.user_id and p.avatar_url=a.public_url
 where a.storage_path=path and not apchi_private.blocked(auth.uid(),p.id)));
$$;
create policy "selected or own avatars" on storage.objects for select to authenticated using(bucket_id='avatars' and apchi_private.avatar_read(name));

create or replace function public.register_avatar(path text, canonical_url text) returns public.profile_avatars
language plpgsql security definer set search_path = '' as $$
declare result public.profile_avatars;
begin
 if auth.uid() is null or split_part(path,'/',1)<>auth.uid()::text or not exists(select 1 from storage.objects where bucket_id='avatars' and name=path) then raise exception 'Нет доступа'; end if;
 if canonical_url not like '%/storage/v1/object/public/avatars/'||path then raise exception 'Неверный адрес'; end if;
 insert into public.profile_avatars(user_id,storage_path,public_url) values(auth.uid(),path,canonical_url) returning * into result;
 update public.profiles set avatar_url=canonical_url where id=auth.uid(); return result;
end; $$;
create or replace function public.select_avatar(avatar_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare url text;
begin
 if auth.uid() is null then raise exception 'Нет доступа'; end if;
 if avatar_id is not null then select public_url into url from public.profile_avatars where id=avatar_id and user_id=auth.uid(); if not found then raise exception 'Нет доступа'; end if; end if;
 update public.profiles set avatar_url=url where id=auth.uid();
end; $$;
create or replace function public.remove_avatar(avatar_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare url text;
begin
 delete from public.profile_avatars where id=avatar_id and user_id=auth.uid() returning public_url into url;
 if not found then raise exception 'Нет доступа'; end if;
 update public.profiles set avatar_url=null where id=auth.uid() and avatar_url=url;
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('attachments','attachments',false,20971520,array['image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain','text/csv','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create or replace function apchi_private.attachment_upload(path text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
 return split_part(path,'/',1)=auth.uid()::text and apchi_private.can_send(split_part(path,'/',2)::uuid);
exception when invalid_text_representation then return false;
end; $$;
create or replace function apchi_private.attachment_read(path text) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.messages m where attachment_path=path and deleted_at is null and apchi_private.can_read_message(m.conversation_id,m.created_at) and apchi_private.can_send(m.conversation_id));
$$;
create policy "upload attachments" on storage.objects for insert to authenticated with check(bucket_id='attachments' and apchi_private.attachment_upload(name));
create policy "read conversation attachments" on storage.objects for select to authenticated using(bucket_id='attachments' and apchi_private.attachment_read(name));
create policy "remove own attachments" on storage.objects for delete to authenticated using(bucket_id='attachments' and split_part(name,'/',1)=auth.uid()::text);

create or replace function apchi_private.validate_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare obj storage.objects;
begin
 if not apchi_private.can_send(new.conversation_id) or new.sender_id<>auth.uid() then raise exception 'Диалог недоступен'; end if;
 new.created_at:=clock_timestamp();new.deleted_at:=null;new.edited_at:=null;
 if new.attachment_path is not null then
  if split_part(new.attachment_path,'/',1)<>auth.uid()::text or split_part(new.attachment_path,'/',2)<>new.conversation_id::text then raise exception 'Нет доступа к файлу';end if;
  select * into obj from storage.objects where bucket_id='attachments' and name=new.attachment_path;
  if obj.id is null then raise exception 'Сначала загрузите файл';end if;
  new.attachment_size:=(obj.metadata->>'size')::bigint;
  new.attachment_type:=obj.metadata->>'mimetype';
  if new.attachment_size is null or new.attachment_size>20971520 or new.attachment_size<=0 then raise exception 'Неверный размер файла';end if;
  new.attachment_name:=left(coalesce(nullif(new.attachment_name,''),'Файл'),255);
 else new.attachment_name:=null;new.attachment_type:=null;new.attachment_size:=null;
 end if;
 return new;
end; $$;
create trigger validate_message before insert on public.messages for each row execute function apchi_private.validate_message();

create or replace function apchi_private.validate_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
 if new.display_name is distinct from old.display_name and (length(trim(new.display_name))<1 or length(new.display_name)>60) then raise exception 'Имя: от 1 до 60 символов';end if;
 if new.username is distinct from old.username then new.username:=lower(new.username);if new.username !~ '^[a-z0-9_]{3,24}$' then raise exception 'Ник: 3–24 латинских буквы, цифры или подчёркивания';end if;end if;
 if length(new.bio)>2000 or length(new.status_text)>160 or length(new.city)>100 or cardinality(new.interests)>15 or exists(select 1 from unnest(new.interests) i where length(i)>40) then raise exception 'Слишком длинные данные профиля';end if;
 if new.last_seen_at is distinct from old.last_seen_at then new.last_seen_at:=case when new.last_seen_at is null then null else now() end;end if;
 return new;
end; $$;
create trigger validate_profile before update on public.profiles for each row execute function apchi_private.validate_profile();

-- Explicit function ACLs: PostgreSQL grants EXECUTE to PUBLIC by default.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('is_conversation_member','users_blocked_between','other_conversation_user','get_or_create_direct_conversation','list_my_direct_chats','discover_people','list_my_friends','set_chat_setting','mark_chat_read','delete_my_message','list_blocked_profiles','get_visible_profile','register_avatar','select_avatar','remove_avatar','handle_new_user','touch_updated_at','touch_conversation_from_message') loop
 execute format('revoke all on function %s from public, anon',f.signature);
 if f.signature::text not like '%handle_new_user%' and f.signature::text not like '%touch_%' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
revoke all on all functions in schema apchi_private from public, anon;
grant execute on all functions in schema apchi_private to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='conversation_members') then alter publication supabase_realtime add table public.conversation_members;end if;
 -- Block-list deletes must not be published: Realtime DELETE bypasses RLS.
end $$;
commit;


-- ===== supabase/migrations/004_gallery_colors_backgrounds.sql =====
-- Apply once after 003_web_complete.sql. Existing messages and profiles are preserved.
begin;
alter table public.profiles add column interest_colors jsonb not null default '{}'::jsonb;
grant update(interest_colors) on public.profiles to authenticated;
create function apchi_private.validate_interest_colors() returns trigger
language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(new.interest_colors)<>'object' or pg_column_size(new.interest_colors)>4096 then raise exception 'Неверные цвета интересов'; end if;
 if exists(select 1 from jsonb_each_text(new.interest_colors) e where not(e.key=any(new.interests)) or e.value not in ('green','peach','blue','purple','rose','sand') or e.value is null) then raise exception 'Неверный цвет интереса';end if;
 return new;
end; $$;
create trigger validate_interest_colors before insert or update on public.profiles for each row execute function apchi_private.validate_interest_colors();

drop policy "users read own avatar history" on public.profile_avatars;
create policy "visible avatar galleries" on public.profile_avatars for select to authenticated
 using(user_id=auth.uid() or not apchi_private.blocked(auth.uid(),user_id));
create or replace function apchi_private.avatar_read(path text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (split_part(path,'/',1)=auth.uid()::text or exists(
 select 1 from public.profile_avatars a where a.storage_path=path and not apchi_private.blocked(auth.uid(),a.user_id)));
$$;
create or replace function public.get_visible_profile(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; blocked boolean;
begin
 if auth.uid() is null then raise exception 'Нет доступа';end if;
 select * into p from public.profiles where id=target;
 if p.id is null then raise exception 'Профиль не найден';end if;
 blocked:=apchi_private.blocked(auth.uid(),target);
 if blocked then p.bio:='';p.city:=null;p.status_text:='';p.interests:='{}';p.interest_colors:='{}';p.avatar_url:=null;p.last_seen_at:=null;end if;
 return to_jsonb(p)||jsonb_build_object('unavailable',blocked,'blocked_by_me',exists(select 1 from public.blocked_users where blocker_id=auth.uid() and blocked_id=target));
end; $$;
drop function public.list_my_friends();
create function public.list_my_friends()
returns table(conversation_id uuid,user_id uuid,username text,display_name text,bio text,interests text[],avatar_color text,avatar_url text,last_seen_at timestamptz,last_message text,last_message_at timestamptz,interest_colors jsonb)
language sql stable security definer set search_path='' as $$
 select distinct on(p.id) mine.conversation_id,p.id,p.username,p.display_name,p.bio,p.interests,p.avatar_color,p.avatar_url,p.last_seen_at,
 case when lm.created_at>coalesce(mine.deleted_before,'epoch') then lm.body else null end,lm.created_at,p.interest_colors
 from public.conversation_members mine join public.conversation_members other on other.conversation_id=mine.conversation_id and other.user_id<>auth.uid()
 join public.profiles p on p.id=other.user_id
 join lateral(select case when m.deleted_at is null then m.body else null end body,m.created_at from public.messages m where m.conversation_id=mine.conversation_id order by m.created_at desc,m.id desc limit 1) lm on true
 where mine.user_id=auth.uid() and not apchi_private.blocked(auth.uid(),p.id) order by p.id,lm.created_at desc;
$$;
revoke all on function public.list_my_friends() from public,anon;
grant execute on function public.list_my_friends() to authenticated;

-- A background is a private preference of the current member, never shared with the peer.
create table public.dialog_backgrounds(
 user_id uuid not null references public.profiles(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 storage_path text not null unique,
 primary key(user_id,conversation_id),
 foreign key(conversation_id,user_id) references public.conversation_members(conversation_id,user_id) on delete cascade
);
alter table public.dialog_backgrounds enable row level security;
revoke all on public.dialog_backgrounds from anon,authenticated;
grant select on public.dialog_backgrounds to authenticated;
create policy "own dialog backgrounds" on public.dialog_backgrounds for select to authenticated using(user_id=auth.uid());
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('dialog-backgrounds','dialog-backgrounds',false,8388608,array['image/jpeg','image/png','image/webp']);
create policy "own background reads" on storage.objects for select to authenticated using(bucket_id='dialog-backgrounds' and split_part(name,'/',1)=auth.uid()::text);
create policy "own background uploads" on storage.objects for insert to authenticated with check(bucket_id='dialog-backgrounds' and split_part(name,'/',1)=auth.uid()::text);
create policy "own background deletes" on storage.objects for delete to authenticated using(bucket_id='dialog-backgrounds' and split_part(name,'/',1)=auth.uid()::text);
create function public.set_dialog_background(cid uuid,path text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not apchi_private.member(cid) then raise exception 'Нет доступа';end if;
 if path is null then delete from public.dialog_backgrounds where user_id=auth.uid() and conversation_id=cid;return;end if;
 if split_part(path,'/',1)<>auth.uid()::text or split_part(path,'/',2)<>cid::text or not exists(select 1 from storage.objects where bucket_id='dialog-backgrounds' and name=path) then raise exception 'Недопустимый фон';end if;
 insert into public.dialog_backgrounds(user_id,conversation_id,storage_path) values(auth.uid(),cid,path)
 on conflict(user_id,conversation_id) do update set storage_path=excluded.storage_path;
end; $$;
revoke all on function public.set_dialog_background(uuid,text) from public,anon;
grant execute on function public.set_dialog_background(uuid,text) to authenticated;
revoke all on function apchi_private.validate_interest_colors() from public,anon;
commit;


-- ===== supabase/migrations/005_public_release.sql =====
-- Public web release. Apply once after 004_gallery_colors_backgrounds.sql.
begin;

-- Avatar history is private again. Other accounts can read only the selected avatar object.
drop policy if exists "visible avatar galleries" on public.profile_avatars;
drop policy if exists "users read own avatar history" on public.profile_avatars;
create policy "users read own avatar history" on public.profile_avatars for select to authenticated using(user_id=auth.uid());
create or replace function apchi_private.avatar_read(path text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (split_part(path,'/',1)=auth.uid()::text or exists(
  select 1 from public.profile_avatars a join public.profiles p on p.id=a.user_id and p.avatar_url=a.public_url
  where a.storage_path=path and not apchi_private.blocked(auth.uid(),a.user_id)));
$$;

-- Deleting the active avatar automatically selects the newest remaining one.
create or replace function public.remove_avatar(avatar_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare removed_url text; next_url text;
begin
 delete from public.profile_avatars where id=avatar_id and user_id=auth.uid() returning public_url into removed_url;
 if not found then raise exception 'Нет доступа';end if;
 if exists(select 1 from public.profiles where id=auth.uid() and avatar_url=removed_url) then
  select public_url into next_url from public.profile_avatars where user_id=auth.uid() order by created_at desc,id desc limit 1;
  update public.profiles set avatar_url=next_url where id=auth.uid();
 end if;
end; $$;

create table public.reports(
 id uuid primary key default gen_random_uuid(),
 reporter_id uuid not null references auth.users(id) on delete cascade,
 reported_user_id uuid not null references auth.users(id) on delete cascade,
 message_id uuid references public.messages(id) on delete set null,
 reason text not null check(length(trim(reason)) between 10 and 500),
 status text not null default 'open' check(status in('open','reviewing','resolved','dismissed')),
 created_at timestamptz not null default now(),
 check(reporter_id<>reported_user_id)
);
create index reports_reporter_created_idx on public.reports(reporter_id,created_at desc);
create index reports_status_created_idx on public.reports(status,created_at);
alter table public.reports enable row level security;
revoke all on public.reports from anon,authenticated;

create function public.submit_report(reported_user uuid,message_id uuid default null,reason text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null or reported_user is null or reported_user=auth.uid() or not exists(select 1 from public.profiles where id=reported_user) then raise exception 'Недопустимая жалоба';end if;
 if length(trim(reason)) not between 10 and 500 then raise exception 'Причина: от 10 до 500 символов';end if;
 if (select count(*) from public.reports where reporter_id=auth.uid() and created_at>now()-interval '1 hour')>=5 then raise exception 'Слишком много жалоб. Попробуйте позже';end if;
 if message_id is not null and not exists(select 1 from public.messages m where m.id=message_id and m.sender_id=reported_user and apchi_private.member(m.conversation_id)) then raise exception 'Сообщение недоступно';end if;
 insert into public.reports(reporter_id,reported_user_id,message_id,reason) values(auth.uid(),reported_user,message_id,trim(reason)) returning id into result;
 return result;
end; $$;
revoke all on function public.submit_report(uuid,uuid,text) from public,anon;
grant execute on function public.submit_report(uuid,uuid,text) to authenticated;

-- Basic server-side abuse limits. They cannot be bypassed by direct REST requests.
create function apchi_private.limit_message_rate() returns trigger language plpgsql set search_path='' as $$
begin
 if (select count(*) from public.messages where sender_id=auth.uid() and created_at>now()-interval '1 minute')>=30 then raise exception 'Слишком много сообщений. Подождите минуту';end if;
 return new;
end; $$;
create trigger limit_message_rate before insert on public.messages for each row execute function apchi_private.limit_message_rate();
create function apchi_private.limit_avatar_rate() returns trigger language plpgsql set search_path='' as $$
begin
 if (select count(*) from public.profile_avatars where user_id=auth.uid() and created_at>now()-interval '1 hour')>=10 then raise exception 'Слишком много загрузок. Попробуйте позже';end if;
 return new;
end; $$;
create trigger limit_avatar_rate before insert on public.profile_avatars for each row execute function apchi_private.limit_avatar_rate();

-- Storage policies also limit raw uploads, so a client cannot create unlimited orphan files.
create or replace function apchi_private.attachment_upload(path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 return split_part(path,'/',1)=auth.uid()::text and apchi_private.can_send(split_part(path,'/',2)::uuid)
 and (select count(*) from storage.objects where bucket_id='attachments' and name like auth.uid()::text||'/%' and created_at>now()-interval '1 hour')<20;
exception when invalid_text_representation then return false;
end; $$;
create function apchi_private.avatar_upload(path text) returns boolean language sql stable security definer set search_path='' as $$
 select split_part(path,'/',1)=auth.uid()::text and (select count(*) from storage.objects where bucket_id='avatars' and name like auth.uid()::text||'/%' and created_at>now()-interval '1 hour')<15;
$$;
create function apchi_private.background_upload(path text) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 return split_part(path,'/',1)=auth.uid()::text and apchi_private.member(split_part(path,'/',2)::uuid)
 and (select count(*) from storage.objects where bucket_id='dialog-backgrounds' and name like auth.uid()::text||'/%' and created_at>now()-interval '1 hour')<10;
exception when invalid_text_representation then return false;
end; $$;
drop policy if exists "users upload own avatars" on storage.objects;
create policy "users upload own avatars" on storage.objects for insert to authenticated with check(bucket_id='avatars' and apchi_private.avatar_upload(name));
drop policy if exists "own background uploads" on storage.objects;
create policy "own background uploads" on storage.objects for insert to authenticated with check(bucket_id='dialog-backgrounds' and apchi_private.background_upload(name));
create function apchi_private.remove_incomplete_direct_conversation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.conversations where id=old.conversation_id) and (select count(*) from public.conversation_members where conversation_id=old.conversation_id)<2 then delete from public.conversations where id=old.conversation_id;end if;
 return old;
end; $$;
create trigger remove_incomplete_direct_conversation after delete on public.conversation_members for each row execute function apchi_private.remove_incomplete_direct_conversation();
revoke all on function apchi_private.limit_message_rate(),apchi_private.limit_avatar_rate(),apchi_private.avatar_upload(text),apchi_private.background_upload(text),apchi_private.remove_incomplete_direct_conversation() from public,anon;
grant execute on function apchi_private.avatar_upload(text),apchi_private.background_upload(text) to authenticated;
commit;
begin;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(endpoint) between 20 and 4096),
  check (char_length(p256dh) between 20 and 512),
  check (char_length(auth_key) between 8 and 256)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create or replace function public.register_push_subscription(
  push_endpoint text,
  p256dh_key text,
  auth_secret text,
  client_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Нет активной сессии';
  end if;
  if push_endpoint is null
    or push_endpoint !~ '^https://'
    or char_length(push_endpoint) not between 20 and 4096
    or char_length(coalesce(p256dh_key, '')) not between 20 and 512
    or char_length(coalesce(auth_secret, '')) not between 8 and 256 then
    raise exception 'Некорректная push-подписка';
  end if;

  insert into public.push_subscriptions(
    user_id, endpoint, p256dh, auth_key, user_agent, updated_at
  ) values (
    me,
    push_endpoint,
    p256dh_key,
    auth_secret,
    left(client_user_agent, 1000),
    now()
  )
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth_key = excluded.auth_key,
        user_agent = excluded.user_agent,
        updated_at = now();
end;
$$;

create or replace function public.unregister_push_subscription(
  push_endpoint text
) returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions
  where endpoint = push_endpoint
    and user_id = auth.uid();
$$;

revoke all on function public.register_push_subscription(text,text,text,text) from public, anon;
revoke all on function public.unregister_push_subscription(text) from public, anon;
grant execute on function public.register_push_subscription(text,text,text,text) to authenticated;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- Server-only idempotency guard: one push attempt per message/recipient.
create table if not exists public.push_delivery_claims (
  message_id uuid not null references public.messages(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, recipient_id)
);

create index if not exists push_delivery_claims_created_idx
  on public.push_delivery_claims(created_at);

alter table public.push_delivery_claims enable row level security;
revoke all on public.push_delivery_claims from anon, authenticated;

commit;


-- ===== supabase/migrations/007_chat_experience.sql =====
-- Direct-chat experience: replies, shared appearance, receipts and per-user deletion.
-- Apply once after 006_web_push.sql. Existing messages and files are preserved.
begin;

alter table public.messages
  add column if not exists reply_to_message_id uuid;
alter table public.messages
  drop constraint if exists messages_reply_to_message_id_fkey;
alter table public.messages
  add constraint messages_reply_to_message_id_fkey
  foreign key (reply_to_message_id) references public.messages(id) on delete set null;
create index if not exists messages_reply_to_idx
  on public.messages(reply_to_message_id)
  where reply_to_message_id is not null;

create table public.message_hidden_users (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key(message_id, user_id)
);
create index message_hidden_users_user_idx
  on public.message_hidden_users(user_id, message_id);

create table public.conversation_read_receipts (
  conversation_id uuid not null,
  user_id uuid not null,
  last_read_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(conversation_id, user_id),
  foreign key(conversation_id, user_id)
    references public.conversation_members(conversation_id, user_id)
    on delete cascade
);
insert into public.conversation_read_receipts(
  conversation_id, user_id, last_read_at
)
select conversation_id, user_id, last_read_at
from public.conversation_members
on conflict(conversation_id, user_id) do update
set last_read_at=excluded.last_read_at,
    updated_at=now();

create table public.conversation_appearance (
  conversation_id uuid primary key
    references public.conversations(id) on delete cascade,
  dialog_theme text not null default 'system'
    check(dialog_theme in ('system','cream','twilight','sage','cherry','moon')),
  background_path text unique,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- A direct chat can only keep one of the former member-specific values.
-- Prefer a non-default theme and preserve one existing background deterministically.
insert into public.conversation_appearance(
  conversation_id, dialog_theme, background_path, updated_by
)
select
  c.id,
  coalesce((
    select cm.dialog_theme
    from public.conversation_members cm
    where cm.conversation_id=c.id
    order by (cm.dialog_theme='system'), cm.created_at desc, cm.user_id
    limit 1
  ), 'system'),
  (
    select db.storage_path
    from public.dialog_backgrounds db
    where db.conversation_id=c.id
    order by db.user_id
    limit 1
  ),
  (
    select cm.user_id
    from public.conversation_members cm
    where cm.conversation_id=c.id
    order by cm.created_at, cm.user_id
    limit 1
  )
from public.conversations c
on conflict(conversation_id) do nothing;

drop function if exists public.list_my_direct_chats(boolean);
drop function if exists public.set_dialog_background(uuid,text);
drop table public.dialog_backgrounds;

create or replace function public.set_chat_setting(
  cid uuid,
  setting text,
  enabled boolean default true,
  theme text default 'system'
) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if not apchi_private.member(cid) then raise exception 'Нет доступа'; end if;
 if setting='pin' then
  update public.conversation_members set pinned_at=case when enabled then now() else null end
  where conversation_id=cid and user_id=auth.uid();
 elsif setting='archive' then
  update public.conversation_members set archived_at=case when enabled then now() else null end
  where conversation_id=cid and user_id=auth.uid();
 elsif setting='mute' then
  update public.conversation_members set muted=enabled
  where conversation_id=cid and user_id=auth.uid();
 elsif setting='delete' then
  update public.conversation_members
  set hidden_at=now(),deleted_before=now(),last_read_at=now(),pinned_at=null
  where conversation_id=cid and user_id=auth.uid();
 elsif setting='theme' and theme in ('system','cream','twilight','sage','cherry','moon') then
  insert into public.conversation_appearance(conversation_id,dialog_theme,updated_by,updated_at)
  values(cid,theme,auth.uid(),now())
  on conflict(conversation_id) do update
  set dialog_theme=excluded.dialog_theme,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at;
 else
  raise exception 'Неверная настройка';
 end if;
end; $$;

alter table public.conversation_members drop column dialog_theme;

alter table public.message_hidden_users enable row level security;
alter table public.conversation_read_receipts enable row level security;
alter table public.conversation_appearance enable row level security;
revoke all on public.message_hidden_users,
  public.conversation_read_receipts,
  public.conversation_appearance from anon, authenticated;
grant select on public.conversation_read_receipts,
  public.conversation_appearance to authenticated;

create policy "members read receipts"
on public.conversation_read_receipts for select to authenticated
using(apchi_private.member(conversation_id));
create policy "members read conversation appearance"
on public.conversation_appearance for select to authenticated
using(apchi_private.member(conversation_id));

create or replace function apchi_private.message_visible_to_me(
  mid uuid,
  cid uuid,
  sent timestamptz
) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(
  select 1
  from public.conversation_members cm
  where cm.conversation_id=cid
    and cm.user_id=auth.uid()
    and (cm.deleted_before is null or sent>cm.deleted_before)
 ) and not exists(
  select 1
  from public.message_hidden_users hidden
  where hidden.message_id=mid and hidden.user_id=auth.uid()
 );
$$;

drop policy if exists "members read messages" on public.messages;
create policy "members read messages"
on public.messages for select to authenticated
using(apchi_private.message_visible_to_me(id,conversation_id,created_at));

create or replace function apchi_private.attachment_read(path text) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(
  select 1
  from public.messages m
  where m.attachment_path=path
    and m.deleted_at is null
    and apchi_private.message_visible_to_me(m.id,m.conversation_id,m.created_at)
    and apchi_private.can_send(m.conversation_id)
 );
$$;

create or replace function apchi_private.background_read(path text) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(
  select 1
  from public.conversation_appearance appearance
  where appearance.background_path=path
    and apchi_private.member(appearance.conversation_id)
 );
$$;
drop policy if exists "own background reads" on storage.objects;
create policy "members read shared backgrounds"
on storage.objects for select to authenticated
using(bucket_id='dialog-backgrounds' and apchi_private.background_read(name));

revoke insert on public.messages from authenticated;
grant insert(
  id,conversation_id,sender_id,body,reply_to_message_id,
  attachment_path,attachment_name,attachment_type,attachment_size
) on public.messages to authenticated;

create or replace function apchi_private.validate_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare obj storage.objects;
begin
 if not apchi_private.can_send(new.conversation_id) or new.sender_id<>auth.uid() then
  raise exception 'Диалог недоступен';
 end if;
 new.created_at:=clock_timestamp();
 new.deleted_at:=null;
 new.edited_at:=null;
 if new.reply_to_message_id is not null and not exists(
  select 1
  from public.messages original
  where original.id=new.reply_to_message_id
    and original.conversation_id=new.conversation_id
    and original.deleted_at is null
    and apchi_private.message_visible_to_me(
      original.id,original.conversation_id,original.created_at
    )
 ) then
  raise exception 'Исходное сообщение недоступно';
 end if;
 if new.attachment_path is not null then
  if split_part(new.attachment_path,'/',1)<>auth.uid()::text
    or split_part(new.attachment_path,'/',2)<>new.conversation_id::text then
   raise exception 'Нет доступа к файлу';
  end if;
  select * into obj
  from storage.objects
  where bucket_id='attachments' and name=new.attachment_path;
  if obj.id is null then raise exception 'Сначала загрузите файл';end if;
  new.attachment_size:=(obj.metadata->>'size')::bigint;
  new.attachment_type:=obj.metadata->>'mimetype';
  if new.attachment_size is null or new.attachment_size>20971520
    or new.attachment_size<=0 then raise exception 'Неверный размер файла';end if;
  new.attachment_name:=left(coalesce(nullif(new.attachment_name,''),'Файл'),255);
 else
  new.attachment_name:=null;
  new.attachment_type:=null;
  new.attachment_size:=null;
 end if;
 return new;
end; $$;

create or replace function public.mark_chat_read(cid uuid, message_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare stamp timestamptz;
begin
 if not apchi_private.member(cid) then raise exception 'Нет доступа'; end if;
 select created_at into stamp
 from public.messages
 where id=message_id and conversation_id=cid;
 if stamp is not null then
  update public.conversation_members
  set last_read_at=greatest(last_read_at,stamp)
  where conversation_id=cid and user_id=auth.uid();
  insert into public.conversation_read_receipts(
    conversation_id,user_id,last_read_at,updated_at
  ) values(cid,auth.uid(),stamp,now())
  on conflict(conversation_id,user_id) do update
  set last_read_at=greatest(
        public.conversation_read_receipts.last_read_at,
        excluded.last_read_at
      ),
      updated_at=now();
 end if;
end; $$;

create function public.delete_message_for_me(message_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 insert into public.message_hidden_users(message_id,user_id,hidden_at)
 select m.id,auth.uid(),now()
 from public.messages m
 where m.id=delete_message_for_me.message_id
   and m.deleted_at is null
   and apchi_private.member(m.conversation_id)
 on conflict on constraint message_hidden_users_pkey
 do update set hidden_at=excluded.hidden_at;
 if not found then raise exception 'Сообщение недоступно';end if;
end; $$;

create function public.delete_message_for_everyone(message_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare path text;
begin
 select attachment_path into path
 from public.messages
 where id=message_id and sender_id=auth.uid() and deleted_at is null;
 if not found then raise exception 'Нет доступа';end if;
 update public.messages
 set body='',
     deleted_at=now(),
     edited_at=null,
     attachment_path=null,
     attachment_name=null,
     attachment_type=null,
     attachment_size=null
 where id=message_id and sender_id=auth.uid() and deleted_at is null;
 return path;
end; $$;

create or replace function public.delete_my_message(message_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 perform public.delete_message_for_everyone(message_id);
end; $$;

create function public.set_dialog_background(cid uuid,path text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not apchi_private.member(cid) then
  raise exception 'Нет доступа';
 end if;
 if path is not null and (
  split_part(path,'/',1)<>auth.uid()::text
  or split_part(path,'/',2)<>cid::text
  or not exists(
    select 1 from storage.objects
    where bucket_id='dialog-backgrounds' and name=path
  )
 ) then
  raise exception 'Недопустимый фон';
 end if;
 insert into public.conversation_appearance(
  conversation_id,background_path,updated_by,updated_at
 ) values(cid,path,auth.uid(),now())
 on conflict(conversation_id) do update
 set background_path=excluded.background_path,
     updated_by=excluded.updated_by,
     updated_at=excluded.updated_at;
end; $$;

create function public.list_my_direct_chats(include_archived boolean default false)
returns table(
 conversation_id uuid,other_user_id uuid,display_name text,username text,
 bio text,avatar_color text,avatar_url text,last_seen_at timestamptz,
 last_message text,last_message_at timestamptz,last_read_at timestamptz,
 peer_last_read_at timestamptz,archived boolean,pinned boolean,muted boolean,
 dialog_theme text,unread_count bigint,blocked_by_me boolean,unavailable boolean
)
language sql stable security definer set search_path = '' as $$
 select mine.conversation_id,p.id,p.display_name,p.username,
 case when apchi_private.blocked(auth.uid(),p.id) then '' else p.bio end,
 p.avatar_color,
 case when apchi_private.blocked(auth.uid(),p.id) then null else p.avatar_url end,
 case when apchi_private.blocked(auth.uid(),p.id) then null else p.last_seen_at end,
 lm.body,lm.created_at,mine.last_read_at,receipt.last_read_at,
 mine.archived_at is not null,mine.pinned_at is not null,mine.muted,
 coalesce(appearance.dialog_theme,'system'),
 (
  select count(*)
  from public.messages m
  where m.conversation_id=mine.conversation_id
    and m.sender_id<>auth.uid()
    and m.deleted_at is null
    and m.created_at>coalesce(mine.last_read_at,'epoch')
    and m.created_at>coalesce(mine.deleted_before,'epoch')
    and not exists(
      select 1 from public.message_hidden_users hidden
      where hidden.message_id=m.id and hidden.user_id=auth.uid()
    )
 ),
 exists(
  select 1 from public.blocked_users
  where blocker_id=auth.uid() and blocked_id=p.id
 ),
 apchi_private.blocked(auth.uid(),p.id)
 from public.conversation_members mine
 join public.conversation_members other
   on other.conversation_id=mine.conversation_id and other.user_id<>auth.uid()
 join public.profiles p on p.id=other.user_id
 left join public.conversation_appearance appearance
   on appearance.conversation_id=mine.conversation_id
 left join public.conversation_read_receipts receipt
   on receipt.conversation_id=mine.conversation_id
  and receipt.user_id=other.user_id
 left join lateral(
  select coalesce(nullif(m.body,''),m.attachment_name,'Файл') body,m.created_at
  from public.messages m
  where m.conversation_id=mine.conversation_id
    and m.deleted_at is null
    and m.created_at>coalesce(mine.deleted_before,'epoch')
    and not exists(
      select 1 from public.message_hidden_users hidden
      where hidden.message_id=m.id and hidden.user_id=auth.uid()
    )
  order by m.created_at desc,m.id desc limit 1
 ) lm on true
 where mine.user_id=auth.uid()
   and mine.hidden_at is null
   and (include_archived or mine.archived_at is null)
 order by mine.pinned_at desc nulls last,
   coalesce(lm.created_at,mine.created_at) desc;
$$;

create function apchi_private.create_read_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 insert into public.conversation_read_receipts(
  conversation_id,user_id,last_read_at
 ) values(new.conversation_id,new.user_id,new.last_read_at)
 on conflict(conversation_id,user_id) do nothing;
 return new;
end; $$;
create trigger create_conversation_read_receipt
after insert on public.conversation_members
for each row execute function apchi_private.create_read_receipt();

revoke all on function public.delete_message_for_me(uuid),
  public.delete_message_for_everyone(uuid),
  public.set_dialog_background(uuid,text),
  public.list_my_direct_chats(boolean) from public,anon;
grant execute on function public.delete_message_for_me(uuid),
  public.delete_message_for_everyone(uuid),
  public.set_dialog_background(uuid,text),
  public.list_my_direct_chats(boolean) to authenticated;
revoke all on function apchi_private.message_visible_to_me(uuid,uuid,timestamptz),
  apchi_private.background_read(text),
  apchi_private.create_read_receipt() from public,anon;
grant execute on function apchi_private.message_visible_to_me(uuid,uuid,timestamptz),
  apchi_private.background_read(text) to authenticated;

do $$ begin
 if not exists(
  select 1 from pg_publication_tables
  where pubname='supabase_realtime' and schemaname='public'
    and tablename='conversation_appearance'
 ) then
  alter publication supabase_realtime add table public.conversation_appearance;
 end if;
 if not exists(
  select 1 from pg_publication_tables
  where pubname='supabase_realtime' and schemaname='public'
    and tablename='conversation_read_receipts'
 ) then
  alter publication supabase_realtime add table public.conversation_read_receipts;
 end if;
end $$;

commit;
