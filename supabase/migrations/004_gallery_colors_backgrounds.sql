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
