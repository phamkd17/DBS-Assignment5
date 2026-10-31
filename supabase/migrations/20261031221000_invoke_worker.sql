-- How Cron calls the worker: pg_net sends an HTTP POST to the Edge Function,
-- with the URL and the secret key read from Vault at call time. The secret
-- key itself is added to Vault by hand (never in a migration or the repo):
--   select vault.create_secret('sb_secret_...', 'divvy_worker_key');

create extension if not exists pg_net;
create extension if not exists pg_cron;

select vault.create_secret('https://yomqjvkhlwolbyhxdzzx.supabase.co', 'project_url');

-- Not in "public", so the page's API (PostgREST) can't see or call it.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.invoke_divvy_sync(refresh_stations boolean default false)
returns bigint
language sql
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/divvy-sync'
           || case when refresh_stations then '?stations=1' else '' end,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'divvy_worker_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 9000
  );
$$;
