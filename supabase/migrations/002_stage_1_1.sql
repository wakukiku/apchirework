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
