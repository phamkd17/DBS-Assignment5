-- Divvy Live: tables, row-level security, Realtime, and the sync functions
-- the worker calls. See docs/data-flow.md.

-- ---------------------------------------------------------------------------
-- stations: one row per Divvy station (from station_information.json).
-- Changes rarely; refreshed hourly or when the worker sees an unknown id.
-- ---------------------------------------------------------------------------
create table public.stations (
  station_id text primary key,
  name       text not null,
  lat        double precision not null,
  lon        double precision not null,
  capacity   integer not null check (capacity >= 0),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- station_status: the live numbers (from station_status.json).
-- Only rows whose numbers changed are written, so every UPDATE here is a real
-- change, and Realtime pushes exactly those to the page.
-- ---------------------------------------------------------------------------
create table public.station_status (
  station_id    text primary key references public.stations on delete cascade,
  bikes         integer not null check (bikes >= 0),   -- classic + e-bikes
  ebikes        integer not null check (ebikes >= 0),
  docks         integer not null check (docks >= 0),
  in_service    boolean not null,                       -- installed, renting, and returning
  last_reported timestamptz,                            -- station check-in at the last change; never compared
  changed_at    timestamptz not null default now()      -- when our numbers last changed
);

-- ---------------------------------------------------------------------------
-- worker_runs: one row per worker run. The page's fresh / stale / down
-- states come from this table.
-- ---------------------------------------------------------------------------
create table public.worker_runs (
  id              bigint generated always as identity primary key,
  ran_at          timestamptz not null default now(),
  ok              boolean not null,
  rows_changed    integer not null default 0,
  stations_seen   integer not null default 0,
  duration_ms     integer not null,
  feed_updated_at timestamptz,   -- Divvy's own last_updated
  error           text
);
create index worker_runs_ran_at_idx on public.worker_runs (ran_at desc);

-- ---------------------------------------------------------------------------
-- follows: which stations each person follows. user_id is the Clerk user id
-- (the JWT "sub", text like user_2abc...), filled in from the token so the
-- client can't pick someone else's id.
-- ---------------------------------------------------------------------------
create table public.follows (
  user_id    text not null default (auth.jwt() ->> 'sub'),
  station_id text not null references public.stations on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, station_id)
);

-- Realtime's "in" filter accepts up to 100 values; keep each person well under.
create function public.enforce_follow_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.follows where user_id = new.user_id) >= 25 then
    raise exception 'You can follow up to 25 stations';
  end if;
  return new;
end;
$$;
create trigger follows_limit before insert on public.follows
  for each row execute function public.enforce_follow_limit();

-- ---------------------------------------------------------------------------
-- Access. Supabase grants everything to anon and authenticated by default;
-- take that back and grant only what the page needs. Writes to the live
-- tables come only from the worker, which uses the secret key (service_role).
-- ---------------------------------------------------------------------------
revoke all on public.stations, public.station_status, public.worker_runs, public.follows
  from anon, authenticated;

grant select on public.stations, public.station_status, public.worker_runs to authenticated;
grant select, insert, delete on public.follows to authenticated;

alter table public.stations       enable row level security;
alter table public.station_status enable row level security;
alter table public.worker_runs    enable row level security;
alter table public.follows        enable row level security;

-- Live data is public bike-share data: any signed-in person may read it.
create policy "signed-in can read stations" on public.stations
  for select to authenticated using (true);
create policy "signed-in can read station status" on public.station_status
  for select to authenticated using (true);
create policy "signed-in can read worker runs" on public.worker_runs
  for select to authenticated using (true);

-- Follows are personal: you see, add, and remove only your own.
create policy "read own follows" on public.follows
  for select to authenticated using (user_id = (select auth.jwt() ->> 'sub'));
create policy "add own follows" on public.follows
  for insert to authenticated with check (user_id = (select auth.jwt() ->> 'sub'));
create policy "remove own follows" on public.follows
  for delete to authenticated using (user_id = (select auth.jwt() ->> 'sub'));

-- ---------------------------------------------------------------------------
-- Realtime: broadcast changes to the live tables. Realtime still applies the
-- select grant and RLS above before sending a change to a page.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.station_status, public.worker_runs;

-- ---------------------------------------------------------------------------
-- sync_station_status(rows): the worker sends every station's numbers; only
-- rows whose numbers differ are written. Unchanged rows produce no write, no
-- WAL, and no Realtime message.
-- Returns {"changed": n, "unknown": n}; "unknown" counts station ids not yet
-- in stations, which tells the worker to refresh station_information.
-- ---------------------------------------------------------------------------
create function public.sync_station_status(payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_changed integer;
  v_unknown integer;
begin
  with incoming as (
    select *
    from jsonb_to_recordset(payload) as r(
      station_id text, bikes integer, ebikes integer, docks integer,
      in_service boolean, last_reported timestamptz
    )
  ),
  known as (
    select i.* from incoming i join public.stations s using (station_id)
  ),
  written as (
    insert into public.station_status as cur
      (station_id, bikes, ebikes, docks, in_service, last_reported, changed_at)
    select station_id, bikes, ebikes, docks, in_service, last_reported, now()
    from known
    on conflict (station_id) do update set
      bikes         = excluded.bikes,
      ebikes        = excluded.ebikes,
      docks         = excluded.docks,
      in_service    = excluded.in_service,
      last_reported = excluded.last_reported,
      changed_at    = now()
    where (cur.bikes, cur.ebikes, cur.docks, cur.in_service)
          is distinct from
          (excluded.bikes, excluded.ebikes, excluded.docks, excluded.in_service)
    returning 1
  )
  select (select count(*) from written),
         (select count(*) from incoming) - (select count(*) from known)
  into v_changed, v_unknown;

  return jsonb_build_object('changed', v_changed, 'unknown', v_unknown);
end;
$$;

-- sync_stations(rows): same idea for station_information.
create function public.sync_stations(payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_changed integer;
begin
  with written as (
    insert into public.stations as cur (station_id, name, lat, lon, capacity, updated_at)
    select station_id, name, lat, lon, capacity, now()
    from jsonb_to_recordset(payload) as r(
      station_id text, name text, lat double precision, lon double precision, capacity integer
    )
    on conflict (station_id) do update set
      name = excluded.name, lat = excluded.lat, lon = excluded.lon,
      capacity = excluded.capacity, updated_at = now()
    where (cur.name, cur.lat, cur.lon, cur.capacity)
          is distinct from
          (excluded.name, excluded.lat, excluded.lon, excluded.capacity)
    returning 1
  )
  select count(*) from written into v_changed;

  return jsonb_build_object('changed', v_changed);
end;
$$;

-- Only the worker (service_role) may call the sync functions.
revoke execute on function public.sync_station_status(jsonb), public.sync_stations(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_station_status(jsonb), public.sync_stations(jsonb)
  to service_role;
