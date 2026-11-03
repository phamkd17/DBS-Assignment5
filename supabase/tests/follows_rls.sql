-- Checks row-level security on follows (personal choices and tags) by acting
-- as two different signed-in users. Runs in a transaction that is rolled
-- back; raises an error if a check fails.
begin;

-- Two people each follow a station, as the worker-free test fixture.
insert into public.stations (station_id, name, lat, lon, capacity)
values ('rls-test-a', 'RLS Test A', 41.79, -87.60, 10), ('rls-test-b', 'RLS Test B', 41.79, -87.61, 10);
insert into public.follows (user_id, station_id, tags)
values ('user_alice', 'rls-test-a', '{JCL}'), ('user_bob', 'rls-test-b', '{Ryerson}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"user_alice","role":"authenticated"}';

do $$
declare n integer;
begin
  -- Alice sees only her own follow.
  select count(*) into n from public.follows where station_id like 'rls-test-%';
  assert n = 1, format('alice should see 1 follow, saw %s', n);

  -- Alice can't change Bob's tag (RLS hides his row, so 0 rows match).
  update public.follows set tags = '{HACKED}' where user_id = 'user_bob';
  get diagnostics n = row_count;
  assert n = 0, 'alice must not be able to edit bob''s tag';

  -- Alice can't delete Bob's follow.
  delete from public.follows where user_id = 'user_bob';
  get diagnostics n = row_count;
  assert n = 0, 'alice must not be able to delete bob''s follow';

  -- Alice can tag her own.
  update public.follows set tags = '{JCL,Volleyball}' where station_id = 'rls-test-a';
  get diagnostics n = row_count;
  assert n = 1, 'alice should be able to tag her own follow with two tags';

  -- A new follow is stamped with Alice's id from the token, not one she picks.
  insert into public.follows (station_id) values ('rls-test-b');
  assert (select user_id from public.follows where station_id = 'rls-test-b' and tags = '{}') = 'user_alice',
    'user_id should come from the JWT';

  -- Alice can't move a follow to someone else: only tags are updatable.
  begin
    update public.follows set user_id = 'user_bob' where station_id = 'rls-test-a';
    raise exception 'updating user_id should have been denied';
  exception when insufficient_privilege then null;
  end;

  raise notice 'follows RLS: all 6 checks passed';
end $$;

rollback;
