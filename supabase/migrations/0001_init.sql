-- Driftle online schema. Safe to read publicly: it holds no secrets.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (name ~ '^[A-Za-z0-9_ -]{2,16}$'),
  created_at timestamptz not null default now()
);
create unique index profiles_name_lower_idx on public.profiles (lower(name));

-- One row per player per day: their best run. The ghost is the packed replay (~20 KB).
create table public.daily_bests (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  time_ms integer not null check (time_ms between 20000 and 900000),
  laps integer[] not null,
  ghost text not null check (length(ghost) < 150000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
create index daily_bests_day_time_idx on public.daily_bests (day, time_ms);

alter table public.profiles enable row level security;
alter table public.daily_bests enable row level security;

-- Everyone can read names and runs (leaderboards and ghosts are public).
create policy "profiles are public" on public.profiles for select using (true);
create policy "bests are public" on public.daily_bests for select using (true);
-- Players manage only their own profile row.
create policy "insert own profile" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- No insert/update/delete policy on daily_bests: runs can only be written by submit_run().

-- Submit a run. Checks the day and sanity of the time, keeps only the player's best.
create or replace function public.submit_run(p_day date, p_time_ms integer, p_laps integer[], p_ghost text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  utc_now timestamp := (now() at time zone 'utc');
  today date := utc_now::date;
  improved boolean := false;
  best integer;
  rnk integer;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.profiles where id = uid) then raise exception 'no profile'; end if;
  -- today only (the previous day is allowed for 10 minutes after the reset, for runs that straddle midnight)
  if not (p_day = today or (p_day = today - 1 and utc_now < today + interval '10 minutes')) then
    raise exception 'wrong day';
  end if;
  if p_time_ms < 20000 or p_time_ms > 900000 then raise exception 'bad time'; end if;
  if array_length(p_laps, 1) is distinct from 3 or length(p_ghost) >= 150000 then raise exception 'bad run'; end if;

  insert into public.daily_bests (user_id, day, time_ms, laps, ghost)
  values (uid, p_day, p_time_ms, p_laps, p_ghost)
  on conflict (user_id, day) do update
    set time_ms = excluded.time_ms, laps = excluded.laps, ghost = excluded.ghost, updated_at = now()
    where excluded.time_ms < public.daily_bests.time_ms
  returning true into improved;

  select time_ms into best from public.daily_bests where user_id = uid and day = p_day;
  select count(*) + 1 into rnk from public.daily_bests where day = p_day and time_ms < best;
  return jsonb_build_object('improved', coalesce(improved, false), 'best_ms', best, 'rank', rnk);
end;
$$;
revoke all on function public.submit_run(date, integer, integer[], text) from public, anon;
grant execute on function public.submit_run(date, integer, integer[], text) to authenticated;

-- Leaderboard without the heavy ghost data.
create or replace function public.get_leaderboard(p_day date, p_limit integer default 50)
returns table (rank bigint, user_id uuid, name text, time_ms integer)
language sql
stable
set search_path = ''
as $$
  select rank() over (order by b.time_ms), b.user_id, p.name, b.time_ms
  from public.daily_bests b join public.profiles p on p.id = b.user_id
  where b.day = p_day
  order by b.time_ms
  limit least(coalesce(p_limit, 50), 100);
$$;
grant execute on function public.get_leaderboard(date, integer) to anon, authenticated;
