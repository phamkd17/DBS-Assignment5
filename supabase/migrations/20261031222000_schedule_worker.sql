-- Supabase Cron schedules. Re-running cron.schedule with the same name
-- replaces the job, so this is safe to apply again.

-- The worker: every 10 s is ~259k Edge Function calls a month (free plan: 500k).
select cron.schedule('divvy-sync', '10 seconds', $$ select private.invoke_divvy_sync(); $$);

-- Station names, locations, and capacity change rarely; refresh them hourly.
select cron.schedule('divvy-stations-hourly', '7 * * * *', $$ select private.invoke_divvy_sync(true); $$);

-- Housekeeping: worker_runs and Cron's own history each grow by 8,640 rows a day.
select cron.schedule('cleanup-nightly', '15 9 * * *', $$
  delete from public.worker_runs where ran_at < now() - interval '24 hours';
  delete from cron.job_run_details where end_time < now() - interval '24 hours';
$$);
