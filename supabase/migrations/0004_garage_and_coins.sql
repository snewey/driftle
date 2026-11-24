-- Drift Coins, the shop, unlocked items and each driver's saved car.
-- Coins are only ever paid out by submit_run() and spent by buy_item(); players cannot edit their balance.

create table public.shop_items (
  id text primary key,
  kind text not null check (kind in ('car','paint','flame','exhaust','spoiler','wheels','glow')),
  name text not null,
  cost integer not null check (cost >= 0)
);
alter table public.shop_items enable row level security;
create policy "shop is public" on public.shop_items for select using (true);

create table public.wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  coins integer not null default 0 check (coins >= 0),
  earned_total integer not null default 0
);
alter table public.wallets enable row level security;
create policy "see own wallet" on public.wallets for select to authenticated using (user_id = (select auth.uid()));

create table public.daily_stats (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  finishes integer not null default 0,
  improvements integer not null default 0,
  top_paid boolean not null default false,
  primary key (user_id, day)
);
alter table public.daily_stats enable row level security; -- no policies: only the functions below touch it

create table public.unlocks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.shop_items (id),
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index unlocks_item_idx on public.unlocks (item_id);
alter table public.unlocks enable row level security;
create policy "see own unlocks" on public.unlocks for select to authenticated using (user_id = (select auth.uid()));

create table public.loadouts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  car text not null default 'car_hatch' references public.shop_items (id),
  paint text not null default 'paint_pink' references public.shop_items (id),
  flame text not null default 'flame_orange' references public.shop_items (id),
  exhaust text not null default 'exh_stock' references public.shop_items (id),
  spoiler text not null default 'spo_stock' references public.shop_items (id),
  wheels text not null default 'whl_steel' references public.shop_items (id),
  glow text not null default 'glow_none' references public.shop_items (id),
  decal_side text not null default '' check (length(decal_side) < 90000),
  decal_top text not null default '' check (length(decal_top) < 90000),
  updated_at timestamptz not null default now()
);
alter table public.loadouts enable row level security;
-- Cars are public so you can see other drivers' cars on their ghosts and replays. Writes only via set_loadout().
create policy "cars are public" on public.loadouts for select using (true);
create index loadouts_car_idx on public.loadouts (car);
create index loadouts_paint_idx on public.loadouts (paint);
create index loadouts_flame_idx on public.loadouts (flame);
create index loadouts_exhaust_idx on public.loadouts (exhaust);
create index loadouts_spoiler_idx on public.loadouts (spoiler);
create index loadouts_wheels_idx on public.loadouts (wheels);
create index loadouts_glow_idx on public.loadouts (glow);

insert into public.shop_items (id, kind, name, cost) values
  ('car_hatch', 'car', 'Rally Hatch', 0),
  ('car_coupe', 'car', 'Street Coupe', 450),
  ('car_muscle', 'car', 'Muscle 69', 700),
  ('car_pickup', 'car', 'Mini Pickup', 600),
  ('car_wedge', 'car', 'Wedge GT', 1000),
  ('paint_pink', 'paint', 'Hot Pink', 0),
  ('paint_red', 'paint', 'Racing Red', 0),
  ('paint_orange', 'paint', 'Sunset Orange', 0),
  ('paint_yellow', 'paint', 'Lemon', 0),
  ('paint_green', 'paint', 'Lime', 0),
  ('paint_teal', 'paint', 'Teal', 0),
  ('paint_blue', 'paint', 'Royal Blue', 0),
  ('paint_white', 'paint', 'Snow', 0),
  ('paint_black', 'paint', 'Coal', 0),
  ('paint_candy', 'paint', 'Candy Purple', 200),
  ('paint_matte', 'paint', 'Matte Black', 200),
  ('paint_mint', 'paint', 'Matte Mint', 200),
  ('paint_pearl', 'paint', 'Pearl White', 250),
  ('paint_gold', 'paint', 'Gold Leaf', 250),
  ('paint_chrome', 'paint', 'Chrome', 350),
  ('paint_shift', 'paint', 'Colour Shift', 500),
  ('flame_orange', 'flame', 'Classic Orange', 0),
  ('flame_blue', 'flame', 'Blue Flame', 200),
  ('flame_purple', 'flame', 'Purple Flame', 250),
  ('flame_green', 'flame', 'Toxic Green', 250),
  ('flame_pink', 'flame', 'Hot Pink Flame', 250),
  ('flame_white', 'flame', 'White Hot', 350),
  ('flame_rainbow', 'flame', 'Rainbow', 600),
  ('exh_stock', 'exhaust', 'Stock Pipes', 0),
  ('exh_dual', 'exhaust', 'Chrome Duals', 150),
  ('exh_quad', 'exhaust', 'Quad Tips', 300),
  ('exh_mega', 'exhaust', 'Megaphone', 250),
  ('exh_side', 'exhaust', 'Side Pipes', 350),
  ('exh_stack', 'exhaust', 'Smoke Stacks', 300),
  ('spo_stock', 'spoiler', 'Stock Wing', 0),
  ('spo_none', 'spoiler', 'No Spoiler', 0),
  ('spo_duck', 'spoiler', 'Ducktail', 100),
  ('spo_tall', 'spoiler', 'Tall Wing', 200),
  ('spo_carbon', 'spoiler', 'Carbon GT Wing', 300),
  ('spo_double', 'spoiler', 'Double Decker', 400),
  ('whl_steel', 'wheels', 'Steelies', 0),
  ('whl_sport', 'wheels', 'Chrome Five-Spoke', 150),
  ('whl_gold', 'wheels', 'Gold Mesh', 250),
  ('whl_blue', 'wheels', 'Neon Blue', 300),
  ('whl_pink', 'wheels', 'Neon Pink', 300),
  ('glow_none', 'glow', 'No Underglow', 0),
  ('glow_white', 'glow', 'Ice White', 150),
  ('glow_blue', 'glow', 'Blue Glow', 200),
  ('glow_pink', 'glow', 'Pink Glow', 200),
  ('glow_purple', 'glow', 'Purple Glow', 200),
  ('glow_green', 'glow', 'Green Glow', 200),
  ('glow_red', 'glow', 'Red Glow', 200),
  ('glow_rainbow', 'glow', 'Rainbow Glow', 500)
on conflict (id) do update set kind = excluded.kind, name = excluded.name, cost = excluded.cost;

-- Raises unless the item exists, is the right kind, and the player owns it (free items are owned by everyone).
create or replace function public.require_owned(p_user uuid, p_item text, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare it record;
begin
  select * into it from public.shop_items where id = p_item;
  if not found or it.kind <> p_kind then raise exception 'unknown item %', p_item; end if;
  if it.cost > 0 and not exists (select 1 from public.unlocks where user_id = p_user and item_id = p_item) then
    raise exception 'you do not own %', it.name;
  end if;
end $$;
revoke all on function public.require_owned(uuid, text, text) from public, anon, authenticated;

create or replace function public.buy_item(p_item text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  it record;
  have integer;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.profiles where id = uid) then raise exception 'no profile'; end if;
  select * into it from public.shop_items where id = p_item;
  if not found then raise exception 'unknown item'; end if;
  insert into public.wallets (user_id) values (uid) on conflict do nothing;
  select coins into have from public.wallets where user_id = uid for update;
  if it.cost = 0 or exists (select 1 from public.unlocks where user_id = uid and item_id = p_item) then
    return jsonb_build_object('coins', have, 'item', p_item, 'already_owned', true);
  end if;
  if have < it.cost then raise exception 'not enough Drift Coins'; end if;
  update public.wallets set coins = coins - it.cost where user_id = uid;
  insert into public.unlocks (user_id, item_id) values (uid, p_item);
  return jsonb_build_object('coins', have - it.cost, 'item', p_item, 'already_owned', false);
end $$;
revoke all on function public.buy_item(text) from public, anon;
grant execute on function public.buy_item(text) to authenticated;

create or replace function public.set_loadout(p_car text, p_paint text, p_flame text, p_exhaust text, p_spoiler text, p_wheels text, p_glow text, p_side text, p_top text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.profiles where id = uid) then raise exception 'no profile'; end if;
  perform public.require_owned(uid, p_car, 'car');
  perform public.require_owned(uid, p_paint, 'paint');
  perform public.require_owned(uid, p_flame, 'flame');
  perform public.require_owned(uid, p_exhaust, 'exhaust');
  perform public.require_owned(uid, p_spoiler, 'spoiler');
  perform public.require_owned(uid, p_wheels, 'wheels');
  perform public.require_owned(uid, p_glow, 'glow');
  p_side := coalesce(p_side, '');
  p_top := coalesce(p_top, '');
  if (p_side <> '' and p_side not like 'data:image/png;base64,%') or (p_top <> '' and p_top not like 'data:image/png;base64,%') then
    raise exception 'bad drawing';
  end if;
  if length(p_side) >= 90000 or length(p_top) >= 90000 then raise exception 'drawing too big'; end if;
  insert into public.loadouts (user_id, car, paint, flame, exhaust, spoiler, wheels, glow, decal_side, decal_top, updated_at)
  values (uid, p_car, p_paint, p_flame, p_exhaust, p_spoiler, p_wheels, p_glow, p_side, p_top, now())
  on conflict (user_id) do update set car = excluded.car, paint = excluded.paint, flame = excluded.flame,
    exhaust = excluded.exhaust, spoiler = excluded.spoiler, wheels = excluded.wheels, glow = excluded.glow,
    decal_side = excluded.decal_side, decal_top = excluded.decal_top, updated_at = now();
end $$;
revoke all on function public.set_loadout(text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.set_loadout(text, text, text, text, text, text, text, text, text) to authenticated;

-- submit_run now also pays Drift Coins. Caps stop farming: 10 paid finishes, 5 paid improvements and one top-spot bonus per day.
drop function if exists public.submit_run(date, integer, integer[], text, text);

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
revoke all on function public.submit_run(date, integer, integer[], text, text, integer) from public, anon;
grant execute on function public.submit_run(date, integer, integer[], text, text, integer) to authenticated;
