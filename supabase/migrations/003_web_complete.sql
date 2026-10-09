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
