-- Colour Shift removed (nobody owned or wore it); ten new paints added instead.
delete from public.shop_items where id = 'paint_shift';
insert into public.shop_items (id, kind, name, cost) values
  ('paint_violet', 'paint', 'Violet', 0),
  ('paint_sky', 'paint', 'Sky Blue', 0),
  ('paint_maroon', 'paint', 'Maroon', 0),
  ('paint_forest', 'paint', 'Forest', 0),
  ('paint_lilac', 'paint', 'Lilac', 0),
  ('paint_rose', 'paint', 'Rose Gold', 200),
  ('paint_gunmetal', 'paint', 'Gunmetal', 200),
  ('paint_navy', 'paint', 'Matte Navy', 200),
  ('paint_bronze', 'paint', 'Bronze', 250),
  ('paint_neon', 'paint', 'Neon Lime', 250)
on conflict (id) do update set kind = excluded.kind, name = excluded.name, cost = excluded.cost;
