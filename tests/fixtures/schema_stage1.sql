

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
