-- Rainbow rewards are for the OFFICIAL top 3: standings when a day has closed, not a place held during the day.
-- A day is final once UTC midnight plus the 10-minute late-submit grace has passed.

create or replace function public.submit_run(p_day date, p_time_ms integer, p_laps integer[], p_ghost text, p_inputs text default '', p_boosts integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  utc_now timestamp := (now() at time zone 'utc');
  today date := utc_now::date;
  improved boolean;
  prev_best integer;
  best integer;
  rnk integer;
  st record;
  c_finish integer := 0;
  c_boost integer := 0;
  c_pb integer := 0;
  c_top integer := 0;
  total integer;
  wallet integer;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.profiles where id = uid) then raise exception 'no profile'; end if;
  if not (p_day = today or (p_day = today - 1 and utc_now < today + interval '10 minutes')) then
    raise exception 'wrong day';
  end if;
  if p_time_ms < 20000 or p_time_ms > 900000 then raise exception 'bad time'; end if;
  if array_length(p_laps, 1) is distinct from 3 or length(p_ghost) >= 150000 or length(coalesce(p_inputs, '')) >= 30000 then
    raise exception 'bad run';
  end if;

  select time_ms into prev_best from public.daily_bests where user_id = uid and day = p_day;

  insert into public.daily_bests (user_id, day, time_ms, laps, ghost, inputs)
  values (uid, p_day, p_time_ms, p_laps, p_ghost, coalesce(p_inputs, ''))
  on conflict (user_id, day) do update
    set time_ms = excluded.time_ms, laps = excluded.laps, ghost = excluded.ghost, inputs = excluded.inputs, updated_at = now()
    where excluded.time_ms < public.daily_bests.time_ms
  returning true into improved;
  improved := coalesce(improved, false);

  select time_ms into best from public.daily_bests where user_id = uid and day = p_day;
  select count(*) + 1 into rnk from public.daily_bests where day = p_day and time_ms < best;

  insert into public.daily_stats (user_id, day) values (uid, p_day) on conflict do nothing;
  select * into st from public.daily_stats where user_id = uid and day = p_day for update;
  if st.finishes < 10 then
    c_finish := 50;
    c_boost := least(greatest(coalesce(p_boosts, 0), 0), 20) * 2;
    update public.daily_stats set finishes = finishes + 1 where user_id = uid and day = p_day;
  end if;
  if improved then
    if prev_best is null then
      c_pb := 100;
    elsif st.improvements < 5 then
      c_pb := 30;
      update public.daily_stats set improvements = improvements + 1 where user_id = uid and day = p_day;
    end if;
    if rnk = 1 and not st.top_paid then
      c_top := 50;
      update public.daily_stats set top_paid = true where user_id = uid and day = p_day;
    end if;
  end if;
  total := c_finish + c_boost + c_pb + c_top;
  insert into public.wallets (user_id, coins, earned_total) values (uid, total, total)
  on conflict (user_id) do update set coins = public.wallets.coins + total, earned_total = public.wallets.earned_total + total
  returning coins into wallet;

  return jsonb_build_object(
    'improved', improved, 'best_ms', best, 'rank', rnk,
    'coins', jsonb_build_object('finish', c_finish, 'boosts', c_boost, 'pb', c_pb, 'top', c_top, 'total', total),
    'wallet', wallet);
end $$;

create or replace function public.claim_top3()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  utc_now timestamp := (now() at time zone 'utc');
  today date := utc_now::date;
  cutoff date;
  granted text[] := '{}';
begin
  if uid is null then return granted; end if;
  cutoff := case when utc_now < today + interval '10 minutes' then today - 1 else today end;
  if exists (
    select 1 from (
      select user_id, rank() over (partition by day order by time_ms) as rk
      from public.daily_bests where day < cutoff
    ) r where r.user_id = uid and r.rk <= 3
  ) then
    with ins as (
      insert into public.unlocks (user_id, item_id)
      select uid, id from public.shop_items where top3_only
      on conflict do nothing
      returning item_id
    )
    select coalesce(array_agg(item_id), '{}') into granted from ins;
  end if;
  return granted;
end $$;
revoke all on function public.claim_top3() from public, anon;
grant execute on function public.claim_top3() to authenticated;

-- Take back rewards given under the earlier "top 3 at any moment" rule, then re-give by the official rule.
delete from public.unlocks where item_id in (select id from public.shop_items where top3_only);
insert into public.unlocks (user_id, item_id)
select distinct r.user_id, s.id
from (
  select user_id, rank() over (partition by day order by time_ms) as rk
  from public.daily_bests
  where day < case when (now() at time zone 'utc') < ((now() at time zone 'utc')::date + interval '10 minutes')
                   then (now() at time zone 'utc')::date - 1 else (now() at time zone 'utc')::date end
) r
cross join public.shop_items s
where r.rk <= 3 and s.top3_only
on conflict do nothing;

-- Anyone wearing a reward item they no longer own goes back to the free default.
update public.loadouts l set flame = 'flame_orange'
where l.flame in (select id from public.shop_items where top3_only)
  and not exists (select 1 from public.unlocks u where u.user_id = l.user_id and u.item_id = l.flame);
update public.loadouts l set glow = 'glow_none'
where l.glow in (select id from public.shop_items where top3_only)
  and not exists (select 1 from public.unlocks u where u.user_id = l.user_id and u.item_id = l.glow);
