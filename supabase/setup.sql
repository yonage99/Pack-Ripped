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

-- p_events_seen: the last trade event this phone has applied. An older copy of the
-- collection is refused (TRADES_PENDING) so traded cards can't reappear.
drop function if exists public.push_data(jsonb, jsonb, jsonb);
create or replace function public.push_data(p_collection jsonb, p_decks jsonb, p_stats jsonb, p_events_seen bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from trade_events where user_id = auth.uid() and id > coalesce(p_events_seen, 0)) then
    raise exception 'TRADES_PENDING';
  end if;
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

-- ---------- Pack Wars ----------
-- Each player writes only their own half of the table: a public part (life, battlefield,
-- graveyard, card counts) that the opponent can see, and a private part (hand and library)
-- that only they can read.
create table if not exists public.pw_games (
  id uuid primary key default gen_random_uuid(),
  host uuid not null references public.profiles (id) on delete cascade,
  guest uuid not null references public.profiles (id) on delete cascade,
  set_info jsonb not null default '{}'::jsonb,
  status text not null default 'invited'
    check (status in ('invited', 'building', 'playing', 'done', 'declined', 'cancelled')),
  turn_player uuid,
  turn_number integer not null default 0,
  winner uuid,
  version bigint not null default 1,
  log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (host <> guest)
);

create table if not exists public.pw_players (
  game_id uuid not null references public.pw_games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  pub jsonb not null default '{}'::jsonb,
  priv jsonb not null default '{}'::jsonb,
  ready boolean not null default false,
  primary key (game_id, user_id)
);

alter table public.pw_games add column if not exists game_number integer not null default 1;
alter table public.pw_games add column if not exists host_wins integer not null default 0;
alter table public.pw_games add column if not exists guest_wins integer not null default 0;
alter table public.pw_games add column if not exists last_loser uuid;
alter table public.pw_games drop constraint if exists pw_games_status_check;
alter table public.pw_games add constraint pw_games_status_check
  check (status in ('invited', 'building', 'playing', 'between', 'done', 'declined', 'cancelled'));

alter table public.pw_games enable row level security;
alter table public.pw_players enable row level security;
revoke all on public.pw_games, public.pw_players from anon, authenticated;

create or replace function public.pw_log(g public.pw_games, who uuid, msg text) returns jsonb
language sql stable security definer set search_path = public as $$
  select (
    select coalesce(jsonb_agg(e), '[]'::jsonb) from (
      select e from jsonb_array_elements(g.log || jsonb_build_array(jsonb_build_object(
        't', extract(epoch from now())::bigint,
        'who', (select username from profiles where id = who),
        'msg', left(msg, 200)))) e
      offset greatest(jsonb_array_length(g.log) + 1 - 150, 0)
    ) x
  );
$$;

create or replace function public.pw_create(p_friend text, p_set jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  them uuid := pr_uid_for(p_friend);
  gid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if them is null or not pr_are_friends(auth.uid(), them) then raise exception 'You can only challenge friends.'; end if;
  insert into pw_games (host, guest, set_info) values (auth.uid(), them, p_set) returning id into gid;
  insert into pw_players (game_id, user_id) values (gid, auth.uid()), (gid, them);
  update pw_games set log = pw_log(pw_games, auth.uid(), 'started a Pack War') where id = gid;
  return gid;
end $$;

create or replace function public.pw_respond(p_game uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare g pw_games;
begin
  select * into g from pw_games where id = p_game and guest = auth.uid() and status = 'invited' for update;
  if not found then raise exception 'Invite not found.'; end if;
  update pw_games set status = case when p_accept then 'building' else 'declined' end,
    log = pw_log(g, auth.uid(), case when p_accept then 'accepted' else 'declined' end),
    version = version + 1, updated_at = now()
  where id = p_game;
  return case when p_accept then 'building' else 'declined' end;
end $$;

-- Lock in your deck. When both players are ready the game starts and a coin flip picks who goes first.
create or replace function public.pw_ready(p_game uuid, p_pub jsonb, p_priv jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  g pw_games;
  both_ready boolean;
begin
  select * into g from pw_games where id = p_game and auth.uid() in (host, guest) for update;
  if not found then raise exception 'Game not found.'; end if;
  if g.status not in ('invited', 'building', 'between') then raise exception 'This game already started.'; end if;
  update pw_players set pub = p_pub, priv = p_priv, ready = true where game_id = p_game and user_id = auth.uid();
  select bool_and(ready) into both_ready from pw_players where game_id = p_game;
  g.log := pw_log(g, auth.uid(), 'is ready');
  if both_ready and g.status = 'building' then
    g.turn_player := case when random() < 0.5 then g.host else g.guest end;
    g.log := pw_log(g, g.turn_player, 'won the coin flip and goes first');
    update pw_games set status = 'playing', turn_player = g.turn_player, turn_number = 1,
      log = g.log, version = version + 1, updated_at = now() where id = p_game;
    return 'playing';
  end if;
  if both_ready and g.status = 'between' then
    g.turn_player := coalesce(g.last_loser, g.host);
    g.game_number := g.game_number + 1;
    g.log := pw_log(g, g.turn_player, 'lost the last game, so they go first in game ' || g.game_number);
    update pw_games set status = 'playing', turn_player = g.turn_player, turn_number = 1, game_number = g.game_number,
      log = g.log, version = version + 1, updated_at = now() where id = p_game;
    return 'playing';
  end if;
  update pw_games set log = g.log, version = version + 1, updated_at = now() where id = p_game;
  return g.status;
end $$;

-- Returns null when nothing changed since p_version (so the app can poll cheaply).
create or replace function public.pw_get(p_game uuid, p_version bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when g.version = coalesce(p_version, -1) then null else jsonb_build_object(
    'id', g.id, 'status', g.status, 'set', g.set_info, 'version', g.version,
    'turn_number', g.turn_number, 'my_turn', g.turn_player = auth.uid(),
    'game_number', g.game_number,
    'my_wins', case when g.host = auth.uid() then g.host_wins else g.guest_wins end,
    'opp_wins', case when g.host = auth.uid() then g.guest_wins else g.host_wins end,
    'host', g.host = auth.uid(),
    'winner', case when g.winner is null then null when g.winner = auth.uid() then 'me' else 'opp' end,
    'log', g.log,
    'me', (select jsonb_build_object('pub', pub, 'priv', priv, 'ready', ready)
           from pw_players where game_id = g.id and user_id = auth.uid()),
    'opp', (select jsonb_build_object('username', pr.username, 'pub', pp.pub, 'ready', pp.ready)
            from pw_players pp join profiles pr on pr.id = pp.user_id
            where pp.game_id = g.id and pp.user_id <> auth.uid())
  ) end
  from pw_games g where g.id = p_game and auth.uid() in (g.host, g.guest);
$$;

create or replace function public.pw_update(p_game uuid, p_pub jsonb, p_priv jsonb, p_log text, p_pass boolean, p_lost boolean)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  g pw_games;
  opp uuid;
begin
  select * into g from pw_games where id = p_game and auth.uid() in (host, guest) for update;
  if not found then raise exception 'Game not found.'; end if;
  if g.status = 'between' then raise exception 'Waiting for the next game to start.'; end if;
  if g.status <> 'playing' then raise exception 'This match is over.'; end if;
  opp := case when g.host = auth.uid() then g.guest else g.host end;
  update pw_players set pub = coalesce(p_pub, pub), priv = coalesce(p_priv, priv)
  where game_id = p_game and user_id = auth.uid();
  if coalesce(p_log, '') <> '' then g.log := pw_log(g, auth.uid(), p_log); end if;
  if p_pass and g.turn_player = auth.uid() then
    g.turn_player := opp;
    g.turn_number := g.turn_number + 1;
  end if;
  if p_lost then
    if opp = g.host then g.host_wins := g.host_wins + 1; else g.guest_wins := g.guest_wins + 1; end if;
    g.last_loser := auth.uid();
    if greatest(g.host_wins, g.guest_wins) >= 2 then
      g.winner := opp;
      g.status := 'done';
      g.log := pw_log(g, opp, 'wins the match ' || greatest(g.host_wins, g.guest_wins) || '–' || least(g.host_wins, g.guest_wins) || '!');
    else
      g.status := 'between';
      g.log := pw_log(g, opp, 'wins game ' || g.game_number);
      update pw_players set ready = false where game_id = p_game;
    end if;
  end if;
  update pw_games set log = g.log, turn_player = g.turn_player, turn_number = g.turn_number,
    winner = g.winner, status = g.status, host_wins = g.host_wins, guest_wins = g.guest_wins,
    last_loser = g.last_loser, version = version + 1, updated_at = now()
  where id = p_game
  returning version into g.version;
  return g.version;
end $$;

-- Concede a game, or cancel/decline one that hasn't started.
create or replace function public.pw_leave(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g pw_games;
begin
  select * into g from pw_games where id = p_game and auth.uid() in (host, guest) for update;
  if not found then return; end if;
  if g.status in ('playing', 'between') then
    update pw_games set status = 'done', winner = case when g.host = auth.uid() then g.guest else g.host end,
      log = pw_log(g, auth.uid(), 'conceded the match'), version = version + 1, updated_at = now() where id = p_game;
  elsif g.status in ('invited', 'building') then
    update pw_games set status = 'cancelled', log = pw_log(g, auth.uid(), 'cancelled the game'),
      version = version + 1, updated_at = now() where id = p_game;
  end if;
end $$;

create or replace function public.pw_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'status', g.status, 'set', g.set_info, 'host', g.host = auth.uid(),
    'opponent', (select username from profiles where id = case when g.host = auth.uid() then g.guest else g.host end),
    'my_turn', g.turn_player = auth.uid(), 'turn_number', g.turn_number, 'game_number', g.game_number,
    'my_wins', case when g.host = auth.uid() then g.host_wins else g.guest_wins end,
    'opp_wins', case when g.host = auth.uid() then g.guest_wins else g.host_wins end,
    'winner', case when g.winner is null then null when g.winner = auth.uid() then 'me' else 'opp' end,
    'my_ready', (select ready from pw_players where game_id = g.id and user_id = auth.uid()),
    'updated_at', g.updated_at
  ) order by g.updated_at desc), '[]'::jsonb)
  from pw_games g
  where auth.uid() in (g.host, g.guest)
    and (g.status in ('invited', 'building', 'playing', 'between') or g.updated_at > now() - interval '30 days')
    and g.status not in ('declined', 'cancelled');
$$;

-- ---------- Trading ----------
-- A trade moves cards between two friends' collections. Each phone keeps its own
-- collection, so an accepted trade is recorded as one "event" per player. Each phone
-- applies its events on the next sync, and push_data refuses an old copy of the
-- collection until it has, so a traded card can't come back or be traded twice.
create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  give jsonb not null default '[]'::jsonb, -- cards from_user gives: [{ id, foil, qty, card }]
  get jsonb not null default '[]'::jsonb,  -- cards to_user gives
  message text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_user <> to_user)
);

create table if not exists public.trade_events (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  trade_id uuid not null references public.trades (id) on delete cascade,
  removes jsonb not null default '[]'::jsonb,
  adds jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists trade_events_user on public.trade_events (user_id, id);

alter table public.trades enable row level security;
alter table public.trade_events enable row level security;
revoke all on public.trades, public.trade_events from anon, authenticated;
revoke all on sequence public.trade_events_id_seq from anon, authenticated;

-- Does collection c hold every item (summed by printing and foil)?
create or replace function public.pr_has(c jsonb, items jsonb) returns boolean
language sql immutable as $$
  select coalesce(bool_and(coalesce((c -> x.id ->> case when x.foil then 'f' else 'n' end)::int, 0) >= x.q), true)
  from (
    select i ->> 'id' as id, coalesce((i ->> 'foil')::boolean, false) as foil, sum(greatest(coalesce((i ->> 'qty')::int, 0), 0)) as q
    from jsonb_array_elements(coalesce(items, '[]'::jsonb)) i group by 1, 2
  ) x;
$$;

-- Add (or with a negative delta, remove) copies of one printing.
create or replace function public.pr_coll_add(c jsonb, p_id text, p_foil boolean, p_delta integer, p_card jsonb) returns jsonb
language plpgsql immutable as $$
declare
  e jsonb := coalesce(c -> p_id, jsonb_build_object('n', 0, 'f', 0, 'card', p_card, 'firstAt', (extract(epoch from now()) * 1000)::bigint));
  k text := case when p_foil then 'f' else 'n' end;
begin
  e := jsonb_set(e, array[k], to_jsonb(greatest(coalesce((e ->> k)::int, 0) + p_delta, 0)));
  if coalesce((e ->> 'n')::int, 0) + coalesce((e ->> 'f')::int, 0) = 0 then return coalesce(c, '{}'::jsonb) - p_id; end if;
  return jsonb_set(coalesce(c, '{}'::jsonb), array[p_id], e);
end $$;

-- Clean up requested items and attach the card details from the owner's collection.
create or replace function public.pr_items(c jsonb, items jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i ->> 'id', 'foil', coalesce((i ->> 'foil')::boolean, false),
    'qty', least(greatest((i ->> 'qty')::int, 1), 20), 'card', c -> (i ->> 'id') -> 'card')), '[]'::jsonb)
  from jsonb_array_elements(coalesce(items, '[]'::jsonb)) i
  where coalesce((i ->> 'qty')::int, 0) > 0 and c ? (i ->> 'id');
$$;

create or replace function public.trade_offer(p_friend text, p_give jsonb, p_get jsonb, p_message text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  them uuid := pr_uid_for(p_friend);
  mc jsonb; tc jsonb; g jsonb; r jsonb; tid uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if them is null or not pr_are_friends(me, them) then raise exception 'You can only trade with friends.'; end if;
  select collection into mc from user_data where user_id = me;
  select collection into tc from user_data where user_id = them;
  g := pr_items(mc, p_give);
  r := pr_items(tc, p_get);
  if jsonb_array_length(g) + jsonb_array_length(r) = 0 then raise exception 'Add at least one card to the trade.'; end if;
  if jsonb_array_length(g) + jsonb_array_length(r) > 40 then raise exception 'That trade has too many cards.'; end if;
  if not pr_has(mc, g) then raise exception 'You don''t have all of those cards anymore. Sync and try again.'; end if;
  if not pr_has(tc, r) then raise exception 'They don''t have all of those cards anymore.'; end if;
  insert into trades (from_user, to_user, give, get, message)
  values (me, them, g, r, left(nullif(trim(p_message), ''), 200)) returning id into tid;
  return tid;
end $$;

-- Accept or decline a trade sent to you. Accepting swaps the cards in one step.
create or replace function public.trade_respond(p_trade uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare
  t trades; fc jsonb; tc jsonb; i jsonb;
begin
  select * into t from trades where id = p_trade and to_user = auth.uid() and status = 'pending' for update;
  if not found then raise exception 'That trade is no longer open.'; end if;
  if not p_accept then
    update trades set status = 'declined', updated_at = now() where id = p_trade;
    return 'declined';
  end if;
  select collection into fc from user_data where user_id = t.from_user for update;
  select collection into tc from user_data where user_id = t.to_user for update;
  if not pr_has(fc, t.give) or not pr_has(tc, t.get) then return 'unavailable'; end if;
  for i in select * from jsonb_array_elements(t.give) loop
    fc := pr_coll_add(fc, i ->> 'id', (i ->> 'foil')::boolean, -(i ->> 'qty')::int, null);
    tc := pr_coll_add(tc, i ->> 'id', (i ->> 'foil')::boolean, (i ->> 'qty')::int, i -> 'card');
  end loop;
  for i in select * from jsonb_array_elements(t.get) loop
    tc := pr_coll_add(tc, i ->> 'id', (i ->> 'foil')::boolean, -(i ->> 'qty')::int, null);
    fc := pr_coll_add(fc, i ->> 'id', (i ->> 'foil')::boolean, (i ->> 'qty')::int, i -> 'card');
  end loop;
  update user_data set collection = fc, updated_at = now() where user_id = t.from_user;
  update user_data set collection = tc, updated_at = now() where user_id = t.to_user;
  insert into trade_events (user_id, trade_id, removes, adds) values
    (t.from_user, t.id, t.give, t.get),
    (t.to_user, t.id, t.get, t.give);
  update trades set status = 'accepted', updated_at = now() where id = p_trade;
  return 'accepted';
end $$;

create or replace function public.trade_cancel(p_trade uuid) returns void
language sql security definer set search_path = public as $$
  update trades set status = 'cancelled', updated_at = now()
  where id = p_trade and from_user = auth.uid() and status = 'pending';
$$;

create or replace function public.trades_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'incoming', coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
      select jsonb_build_object('id', t.id, 'other', p.username, 'i_give', t.get, 'i_get', t.give, 'message', t.message, 'created_at', t.created_at) x
      from trades t join profiles p on p.id = t.from_user where t.to_user = auth.uid() and t.status = 'pending') s), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
      select jsonb_build_object('id', t.id, 'other', p.username, 'i_give', t.give, 'i_get', t.get, 'message', t.message, 'created_at', t.created_at) x
      from trades t join profiles p on p.id = t.to_user where t.from_user = auth.uid() and t.status = 'pending') s), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x order by x ->> 'updated_at' desc) from (
      select jsonb_build_object('id', t.id, 'status', t.status, 'mine', t.from_user = auth.uid(),
        'other', (select username from profiles where id = case when t.from_user = auth.uid() then t.to_user else t.from_user end),
        'i_give', case when t.from_user = auth.uid() then t.give else t.get end,
        'i_get', case when t.from_user = auth.uid() then t.get else t.give end, 'updated_at', t.updated_at) x
      from trades t where auth.uid() in (t.from_user, t.to_user) and t.status <> 'pending'
        and t.updated_at > now() - interval '30 days' order by t.updated_at desc limit 20) s), '[]'::jsonb)
  );
$$;

-- Completed trades your phone still needs to apply.
create or replace function public.trade_events_since(p_after bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'removes', e.removes, 'adds', e.adds,
    'other', (select username from profiles where id = case when t.from_user = auth.uid() then t.to_user else t.from_user end))
    order by e.id), '[]'::jsonb)
  from trade_events e join trades t on t.id = e.trade_id
  where e.user_id = auth.uid() and e.id > coalesce(p_after, 0);
$$;

-- Only signed-in users can call the API (username_available is also open to sign-up).
revoke execute on all functions in schema public from public, anon;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function
  public.my_profile(), public.push_data(jsonb, jsonb, jsonb, bigint), public.log_steps(date, integer),
  public.send_friend_request(text), public.respond_friend_request(text, boolean),
  public.remove_friend(text), public.friends_overview(date), public.friend_data(text),
  public.leaderboard(text, text, date),
  public.pw_create(text, jsonb), public.pw_respond(uuid, boolean), public.pw_ready(uuid, jsonb, jsonb),
  public.pw_get(uuid, bigint), public.pw_update(uuid, jsonb, jsonb, text, boolean, boolean),
  public.pw_leave(uuid), public.pw_list(),
  public.trade_offer(text, jsonb, jsonb, text), public.trade_respond(uuid, boolean), public.trade_cancel(uuid),
  public.trades_list(), public.trade_events_since(bigint)
to authenticated;
