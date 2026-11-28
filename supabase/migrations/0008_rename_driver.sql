-- Signed-in players can change their driver name, at most once every 7 days. Names stay unique
-- (ignoring case, spaces, - and _). The old name becomes free for anyone to take.
alter table public.profiles add column if not exists name_changed_at timestamptz;

-- Direct updates to the name are still refused; only rename_driver() (below) may change it.
create or replace function public.prevent_name_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.name is distinct from old.name and coalesce(current_setting('driftle.renaming', true), '') <> '1' then
    raise exception 'use the rename option to change your driver name';
  end if;
  return new;
end $$;

create or replace function public.rename_driver(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cur record;
  clean text := btrim(coalesce(p_name, ''));
  next_ok timestamptz;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into cur from public.profiles where id = uid for update;
  if not found then raise exception 'no profile'; end if;
  if clean !~ '^(?=.*[A-Za-z0-9])[A-Za-z0-9_ -]{2,16}$' then
    raise exception 'Driver name: 2-16 letters, numbers, spaces, - or _.';
  end if;
  if clean = cur.name then
    return jsonb_build_object('name', cur.name, 'changed', false);
  end if;
  next_ok := cur.name_changed_at + interval '7 days';
  if cur.name_changed_at is not null and now() < next_ok then
    raise exception 'You can change your name again on %.', to_char(next_ok at time zone 'utc', 'DD Mon YYYY HH24:MI "UTC"');
  end if;
  perform set_config('driftle.renaming', '1', true);
  begin
    update public.profiles set name = clean, name_changed_at = now() where id = uid;
  exception when unique_violation then
    raise exception 'That driver name is taken. Pick another.';
  end;
  perform set_config('driftle.renaming', '', true);
  return jsonb_build_object('name', clean, 'changed', true, 'next_change_at', now() + interval '7 days');
end $$;
revoke all on function public.rename_driver(text) from public, anon;
grant execute on function public.rename_driver(text) to authenticated;
