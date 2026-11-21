-- =====================================================================
-- randhawa.vip database (Supabase project "zip-zcta")
-- Already applied to the live project; kept here as the record.
-- =====================================================================

-- 1. ZIP to ZCTA crosswalk (read-only reference data, public read)
--    Loaded from the UDS Mapper 2022 crosswalk (2020 Census ZCTAs):
--    github.com/chris-prener/uds-mapper @ e02f037, data/uds_crosswalk_2022.csv
create table public.zip_zcta (
  zip         text primary key check (zip ~ '^[0-9]{5}$'),
  zcta        text check (zcta ~ '^[0-9]{5}$'),
  city        text not null,
  state       text not null,
  zip_type    text not null,
  match_type  text not null
);
create index zip_zcta_zcta_idx on public.zip_zcta (zcta);
create index zip_zcta_state_idx on public.zip_zcta (state);
alter table public.zip_zcta enable row level security;
create policy "anyone can read zip_zcta" on public.zip_zcta for select to anon, authenticated using (true);
grant select on public.zip_zcta to anon, authenticated;
grant select, insert, update, delete on public.zip_zcta to service_role;

-- 2. Profiles: one per signed-up user, with their ZIP
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  zip          text check (zip ~ '^[0-9]{5}$') references public.zip_zcta (zip),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "user reads own profile" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "user updates own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
grant select on public.profiles to authenticated;
grant update (display_name, zip) on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Creates the profile at sign-up, using zip / display_name from the sign-up
-- form's user metadata (an unknown ZIP is left empty).
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_zip text := new.raw_user_meta_data ->> 'zip';
begin
  if v_zip is not null and not exists (select 1 from public.zip_zcta where zip = v_zip) then
    v_zip := null;
  end if;
  insert into public.profiles (id, display_name, zip)
  values (new.id, new.raw_user_meta_data ->> 'display_name', v_zip)
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = public
as $$ begin new.updated_at := now(); return new; end; $$;
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- 3. Local news cache (only the local-news Edge Function uses it)
create table public.local_news_cache (
  area_key    text primary key,          -- e.g. 'san francisco|CA'
  city        text not null,
  state       text not null,
  articles    jsonb not null default '[]',
  fetched_at  timestamptz not null default now()
);
alter table public.local_news_cache enable row level security;
grant select, insert, update, delete on public.local_news_cache to service_role;

create extension if not exists pg_net with schema extensions;
