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
