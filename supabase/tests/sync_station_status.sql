-- Checks the real sync_station_status() in Postgres: it writes a row only when
-- the numbers change, never when only last_reported ticks. Runs inside a
-- transaction that is rolled back, with a made-up station, so it leaves nothing
-- behind and sends no Realtime messages. Run it through the Supabase MCP
-- (execute_sql) or the SQL editor; it raises an error if a check fails.
begin;

insert into public.stations (station_id, name, lat, lon, capacity)
values ('test-station', 'Test St & Example Ave', 41.79, -87.60, 15);

do $$
declare
  r jsonb;
  t1 timestamptz;
  t2 timestamptz;
begin
  -- 1. new station: written
  r := public.sync_station_status('[{"station_id":"test-station","bikes":5,"ebikes":2,"docks":10,"in_service":true,"last_reported":"2026-10-31T20:00:00Z"}]');
  assert (r->>'changed')::int = 1, format('first sync should write 1 row, got %s', r);
  select changed_at into t1 from public.station_status where station_id = 'test-station';

  -- 2. only last_reported moved: not written
  r := public.sync_station_status('[{"station_id":"test-station","bikes":5,"ebikes":2,"docks":10,"in_service":true,"last_reported":"2026-10-31T20:05:00Z"}]');
  assert (r->>'changed')::int = 0, format('last_reported-only change should write 0 rows, got %s', r);
  assert (select last_reported from public.station_status where station_id = 'test-station') = '2026-10-31T20:00:00Z',
    'an unchanged row must not be rewritten';

  -- 3. a bike was taken: written
  r := public.sync_station_status('[{"station_id":"test-station","bikes":4,"ebikes":2,"docks":11,"in_service":true,"last_reported":"2026-10-31T20:06:00Z"}]');
  assert (r->>'changed')::int = 1, format('a real change should write 1 row, got %s', r);
  assert (select bikes from public.station_status where station_id = 'test-station') = 4, 'bikes should now be 4';

  -- 4. unknown station: counted, not written
  r := public.sync_station_status('[{"station_id":"no-such-station","bikes":1,"ebikes":0,"docks":1,"in_service":true,"last_reported":null}]');
  assert (r->>'unknown')::int = 1 and (r->>'changed')::int = 0, format('unknown station should be reported, got %s', r);

  raise notice 'sync_station_status: all 4 checks passed';
end $$;

rollback;
