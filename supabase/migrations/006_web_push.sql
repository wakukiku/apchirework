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
