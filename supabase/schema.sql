-- =====================================================================
-- localconnect.site database (Supabase project "zip-zcta")
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

-- 4. Nearby places: up to 5 extra places a user wants news about
create or replace function private.valid_places(p text[]) returns boolean
language sql immutable set search_path = public
as $$
  select cardinality(p) <= 5
     and not exists (select 1 from unnest(p) x where length(x) > 60 or length(trim(x)) = 0 or x ~ '[<>"]')
$$;
alter table public.profiles
  add column nearby_places text[] not null default '{}'
  constraint nearby_places_valid check (private.valid_places(nearby_places));
grant update (nearby_places) on public.profiles to authenticated;
-- The check runs as the signed-in user, so they need to reach this one function.
grant usage on schema private to authenticated;
revoke all on function private.valid_places(text[]) from public, anon;
grant execute on function private.valid_places(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- ZCTA centroids (Census 2020 Gazetteer, public domain) + nearby cities lookup
-- Loaded once from https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip
-- ---------------------------------------------------------------------------
create table if not exists public.zcta_centroids (
  zcta text primary key,
  lat  double precision not null,
  lon  double precision not null
);
alter table public.zcta_centroids enable row level security;
drop policy if exists "anyone can read zcta_centroids" on public.zcta_centroids;
create policy "anyone can read zcta_centroids" on public.zcta_centroids for select using (true);
grant select on public.zcta_centroids to anon, authenticated;

-- Closest other cities to a ZIP, by straight-line miles between ZCTA centroids.
create or replace function public.nearby_cities(p_zip text, p_limit integer default 12)
returns table(city text, state text, miles numeric)
language sql stable
set search_path to 'public'
as $function$
  with home as (
    select z.city, z.state, c.lat, c.lon
    from zip_zcta z join zcta_centroids c on c.zcta = z.zcta
    where z.zip = p_zip
  ),
  candidates as (
    select z.city, z.state, c.lat, c.lon
    from zip_zcta z join zcta_centroids c on c.zcta = z.zcta, home h
    where z.zip_type = 'ZIP Code Area'
      and abs(c.lat - h.lat) < 1.2 and abs(c.lon - h.lon) < 1.6          -- ~80 miles box, keeps it fast
      and not (lower(z.city) = lower(h.city) and z.state = h.state)
  ),
  distances as (
    select c.city, c.state,
           3958.8 * 2 * asin(sqrt(
             power(sin(radians(c.lat - h.lat) / 2), 2) +
             cos(radians(h.lat)) * cos(radians(c.lat)) * power(sin(radians(c.lon - h.lon) / 2), 2)
           )) as mi
    from candidates c, home h
  )
  select city, state, round(min(mi)::numeric, 1) as miles
  from distances
  group by city, state
  order by min(mi)
  limit least(greatest(coalesce(p_limit, 12), 1), 25);
$function$;
revoke execute on function public.nearby_cities(text, integer) from public, anon;
grant execute on function public.nearby_cities(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Local events (Google Events via SerpApi), used by the local-events edge function
-- ---------------------------------------------------------------------------
create table if not exists public.local_events_cache (
  area_key    text primary key,          -- e.g. 'novato|CA'
  city        text not null,
  state       text not null,
  events      jsonb not null default '[]',
  fetched_at  timestamptz not null default now()
);
alter table public.local_events_cache enable row level security;
grant select, insert, update, delete on public.local_events_cache to service_role;

-- SerpApi searches used per month, to stay inside the free plan
create table if not exists public.serpapi_usage (
  month     text primary key,             -- 'YYYY-MM' (UTC)
  searches  integer not null default 0
);
alter table public.serpapi_usage enable row level security;
grant select, insert, update on public.serpapi_usage to service_role;

-- Takes one search from this month's budget; false when the budget is used up.
create or replace function public.take_serpapi_search(p_limit integer)
returns boolean language plpgsql security invoker set search_path = public
as $$
declare
  m text := to_char(now() at time zone 'utc', 'YYYY-MM');
  used integer;
begin
  insert into serpapi_usage (month, searches) values (m, 1)
  on conflict (month) do update set searches = serpapi_usage.searches + 1
    where serpapi_usage.searches < p_limit
  returning searches into used;
  return used is not null;
end;
$$;
revoke execute on function public.take_serpapi_search(integer) from public, anon, authenticated;
grant execute on function public.take_serpapi_search(integer) to service_role;
