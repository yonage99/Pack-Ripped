-- Pack Ripped: friends, shared collections/decks and a steps leaderboard.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run again.
--
-- The app never touches tables directly. Every read and write goes through the
-- functions below, which check who is asking. Row Level Security is switched on
-- with no policies, so the tables are locked to everything except these functions.

-- ---------- tables ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.user_data (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  collection jsonb not null default '{}'::jsonb,
  decks jsonb not null default '[]'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.steps_log (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  steps integer not null check (steps between 0 and 100000),
  primary key (user_id, day)
);

create table if not exists public.friendships (
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);

alter table public.profiles enable row level security;
alter table public.user_data enable row level security;
alter table public.steps_log enable row level security;
alter table public.friendships enable row level security;

revoke all on public.profiles, public.user_data, public.steps_log, public.friendships from anon, authenticated;

-- ---------- sign-up: create the profile from the chosen username ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(new.raw_user_meta_data ->> 'username'));
  insert into public.user_data (user_id) values (new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- helpers ----------
create or replace function public.pr_uid_for(p_username text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from profiles where username = lower(trim(p_username));
$$;

create or replace function public.pr_are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships
    where status = 'accepted'
      and ((requester = a and addressee = b) or (requester = b and addressee = a))
  );
$$;

-- ---------- API used by the app ----------
create or replace function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = public as $$
  select lower(trim(p_username)) ~ '^[a-z0-9_]{3,20}$'
     and not exists (select 1 from profiles where username = lower(trim(p_username)));
$$;

create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('username', username) from profiles where id = auth.uid();
$$;

create or replace function public.push_data(p_collection jsonb, p_decks jsonb, p_stats jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if pg_column_size(p_collection) > 5000000 then raise exception 'collection too large'; end if;
  insert into user_data (user_id, collection, decks, stats, updated_at)
  values (auth.uid(), coalesce(p_collection, '{}'), coalesce(p_decks, '[]'), coalesce(p_stats, '{}'), now())
  on conflict (user_id) do update
    set collection = excluded.collection, decks = excluded.decks, stats = excluded.stats, updated_at = now();
end $$;

-- Steps only go up within a day, are capped at 100,000, and must be for
-- yesterday, today or tomorrow (to allow for time zones).
create or replace function public.log_steps(p_day date, p_steps integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_day not between current_date - 1 and current_date + 1 then raise exception 'bad day'; end if;
  insert into steps_log (user_id, day, steps)
  values (auth.uid(), p_day, least(greatest(p_steps, 0), 100000))
  on conflict (user_id, day) do update set steps = greatest(steps_log.steps, excluded.steps);
end $$;

create or replace function public.send_friend_request(p_username text) returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  them uuid := pr_uid_for(p_username);
begin
  if me is null then raise exception 'not signed in'; end if;
  if them is null then return 'not_found'; end if;
  if them = me then return 'self'; end if;
  if pr_are_friends(me, them) then return 'already'; end if;
  -- They already asked me: accept instead.
  if exists (select 1 from friendships where requester = them and addressee = me) then
    update friendships set status = 'accepted' where requester = them and addressee = me;
    return 'accepted';
  end if;
  insert into friendships (requester, addressee) values (me, them) on conflict do nothing;
  return 'sent';
end $$;

create or replace function public.respond_friend_request(p_username text, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare them uuid := pr_uid_for(p_username);
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_accept then
    update friendships set status = 'accepted'
    where requester = them and addressee = auth.uid() and status = 'pending';
  else
    delete from friendships where requester = them and addressee = auth.uid() and status = 'pending';
  end if;
end $$;

-- Unfriend, or cancel a request you sent.
create or replace function public.remove_friend(p_username text) returns void
language plpgsql security definer set search_path = public as $$
declare them uuid := pr_uid_for(p_username);
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from friendships
  where (requester = auth.uid() and addressee = them) or (requester = them and addressee = auth.uid());
end $$;

create or replace function public.friends_overview(p_day date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object(
        'username', p.username,
        'stats', d.stats,
        'updated_at', d.updated_at,
        'steps_today', coalesce((select steps from steps_log s where s.user_id = p.id and s.day = p_day), 0)
      ) order by p.username)
      from friendships f
      join profiles p on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
      left join user_data d on d.user_id = p.id
      where f.status = 'accepted' and auth.uid() in (f.requester, f.addressee)
    ), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(p.username order by f.created_at desc)
      from friendships f join profiles p on p.id = f.requester
      where f.addressee = auth.uid() and f.status = 'pending'
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(p.username order by f.created_at desc)
      from friendships f join profiles p on p.id = f.addressee
      where f.requester = auth.uid() and f.status = 'pending'
    ), '[]'::jsonb)
  );
$$;

-- A friend's collection and decks. Returns null unless you are friends.
create or replace function public.friend_data(p_username text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'username', p.username, 'collection', d.collection, 'decks', d.decks,
    'stats', d.stats, 'updated_at', d.updated_at)
  from profiles p join user_data d on d.user_id = p.id
  where p.username = lower(trim(p_username))
    and (p.id = auth.uid() or pr_are_friends(auth.uid(), p.id));
$$;

-- p_scope: 'friends' (you + your friends) or 'everyone'
-- p_period: 'today', 'week' (last 7 days) or 'all'
create or replace function public.leaderboard(p_scope text, p_period text, p_day date)
returns table (rank bigint, username text, steps bigint, me boolean)
language sql stable security definer set search_path = public as $$
  with people as (
    select p.id, p.username from profiles p
    where p_scope = 'everyone'
       or p.id = auth.uid()
       or pr_are_friends(auth.uid(), p.id)
  ), totals as (
    select pe.username, pe.id = auth.uid() as me,
      coalesce(sum(s.steps) filter (where
        case p_period
          when 'today' then s.day = p_day
          when 'week' then s.day between p_day - 6 and p_day
          else true end), 0)::bigint as steps
    from people pe left join steps_log s on s.user_id = pe.id
    group by pe.id, pe.username
  )
  select rank() over (order by steps desc), username, steps, me
  from totals
  where steps > 0 or me
  order by steps desc, username
  limit 100;
$$;

-- Only signed-in users can call the API (username_available is also open to sign-up).
revoke execute on all functions in schema public from public, anon;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function
  public.my_profile(), public.push_data(jsonb, jsonb, jsonb), public.log_steps(date, integer),
  public.send_friend_request(text), public.respond_friend_request(text, boolean),
  public.remove_friend(text), public.friends_overview(date), public.friend_data(text),
  public.leaderboard(text, text, date)
to authenticated;
