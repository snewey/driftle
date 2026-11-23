alter table public.profiles add constraint profiles_name_has_alnum check (name ~ '[A-Za-z0-9]');

drop index if exists public.profiles_name_lower_idx;
-- Names clash ignoring case, spaces, hyphens and underscores ("Snew", "SNEW ", "S_N-E_W" are the same name).
create unique index profiles_name_norm_idx on public.profiles (lower(regexp_replace(name, '[ _-]', '', 'g')));

-- A driver name can never change once chosen, so nobody can free a name up for someone else.
create or replace function public.prevent_name_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.name is distinct from old.name then raise exception 'driver names cannot be changed'; end if;
  return new;
end $$;
create trigger profiles_name_locked before update on public.profiles
  for each row execute function public.prevent_name_change();

-- Lets the sign-up form check a name before creating the account.
create or replace function public.name_available(p_name text) returns boolean
language sql stable set search_path = '' as $$
  select not exists (
    select 1 from public.profiles
    where lower(regexp_replace(name, '[ _-]', '', 'g')) = lower(regexp_replace(p_name, '[ _-]', '', 'g'))
  );
$$;
grant execute on function public.name_available(text) to anon, authenticated;
