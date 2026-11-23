-- Each best run also stores the keys pressed (run-length encoded, about 1 KB) so replays can show WASD / Space.
alter table public.daily_bests add column inputs text not null default '' check (length(inputs) < 30000);

drop function if exists public.submit_run(date, integer, integer[], text);

create or replace function public.submit_run(p_day date, p_time_ms integer, p_laps integer[], p_ghost text, p_inputs text default '')
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
  if not (p_day = today or (p_day = today - 1 and utc_now < today + interval '10 minutes')) then
    raise exception 'wrong day';
  end if;
  if p_time_ms < 20000 or p_time_ms > 900000 then raise exception 'bad time'; end if;
  if array_length(p_laps, 1) is distinct from 3 or length(p_ghost) >= 150000 or length(coalesce(p_inputs, '')) >= 30000 then
    raise exception 'bad run';
  end if;

  insert into public.daily_bests (user_id, day, time_ms, laps, ghost, inputs)
  values (uid, p_day, p_time_ms, p_laps, p_ghost, coalesce(p_inputs, ''))
  on conflict (user_id, day) do update
    set time_ms = excluded.time_ms, laps = excluded.laps, ghost = excluded.ghost, inputs = excluded.inputs, updated_at = now()
    where excluded.time_ms < public.daily_bests.time_ms
  returning true into improved;

  select time_ms into best from public.daily_bests where user_id = uid and day = p_day;
  select count(*) + 1 into rnk from public.daily_bests where day = p_day and time_ms < best;
  return jsonb_build_object('improved', coalesce(improved, false), 'best_ms', best, 'rank', rnk);
end;
$$;
revoke all on function public.submit_run(date, integer, integer[], text, text) from public, anon;
grant execute on function public.submit_run(date, integer, integer[], text, text) to authenticated;
