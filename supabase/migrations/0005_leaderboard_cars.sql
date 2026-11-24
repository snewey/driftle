-- Leaderboard rows now include each driver's car parts (not the big drawings) so the board can show a car picture.
drop function if exists public.get_leaderboard(date, integer);
create function public.get_leaderboard(p_day date, p_limit integer default 50)
returns table (rank bigint, user_id uuid, name text, time_ms integer,
               car text, paint text, flame text, exhaust text, spoiler text, wheels text, glow text)
language sql
stable
set search_path = ''
as $$
  select rank() over (order by b.time_ms), b.user_id, p.name, b.time_ms,
         l.car, l.paint, l.flame, l.exhaust, l.spoiler, l.wheels, l.glow
  from public.daily_bests b
  join public.profiles p on p.id = b.user_id
  left join public.loadouts l on l.user_id = b.user_id
  where b.day = p_day
  order by b.time_ms
  limit least(coalesce(p_limit, 50), 100);
$$;
grant execute on function public.get_leaderboard(date, integer) to anon, authenticated;
