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
