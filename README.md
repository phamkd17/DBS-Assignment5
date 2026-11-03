# Divvy Live

Follow the Divvy bike stations you use (by home, class, the lakefront) and watch classic bikes, e-bikes, and open docks change in real time, without refreshing. Tag stations with your own words ("JCL", "Ryerson", "Volleyball"), and always see how fresh the numbers are.

Design, Build, Ship (MPCS 51238), Assignment 5: Live Data System.

- **Live app:** _added after the Vercel deploy_
- **Data flow chart** (drawn before any code): [docs/data-flow.md](docs/data-flow.md)
- **Data source notes** (fields, how often they change): [docs/data-source.md](docs/data-source.md)

## How it works

```
Divvy GBFS ──every 10 s──▶ Edge Function ──only changed rows──▶ Postgres ──Realtime──▶ Next.js page
(Lyft, no key)            divvy-sync (Deno)                    (Supabase)              (Vercel, Clerk sign-in)
                          called by Supabase Cron
```

1. **Supabase Cron** runs `private.invoke_divvy_sync()` every 10 seconds. It reads the project URL and the Supabase **secret key** from **Vault** and POSTs to the Edge Function with `pg_net`.
2. The **`divvy-sync` Edge Function** checks the caller's `apikey` (it's the only thing that may trigger a run), fetches `station_status.json` (~2,078 stations), validates it in `parse.ts`, and sends every station to the SQL function `sync_station_status()`.
3. **`sync_station_status()`** upserts with `WHERE (bikes, ebikes, docks, in_service) IS DISTINCT FROM …`, so **only rows that really changed are written**. `last_reported` is stored but never compared, because it ticks even when nothing changed. (In Step 1, 1,149 stations had a new `last_reported` in 4 minutes, but only 166 had new numbers.)
4. Each run adds one row to **`worker_runs`**: when it ran, whether it worked, how many rows changed, and how long it took.
5. **Supabase Realtime** pushes each change to open pages. Each page subscribes to `station_status` **filtered to the stations that person follows** (`station_id=in.(…)`), plus every `worker_runs` insert for the freshness clock.
6. The page (Next.js + Tailwind) signs people in with **Clerk**. Supabase trusts Clerk's token (third-party auth), so row-level security reads the person's Clerk ID as `auth.jwt() ->> 'sub'`.

### Tables

| table | written by | read by | RLS |
|---|---|---|---|
| `stations` | worker (secret key) | signed-in people | read-only for `authenticated` |
| `station_status` | worker, only changed rows | signed-in people, Realtime | read-only for `authenticated` |
| `worker_runs` | worker, one row per run | signed-in people, Realtime | read-only for `authenticated` |
| `follows` | each person | that person only | read / add / remove / edit-tags **own rows only**; `user_id` comes from the token |

`follows.tags` holds up to 5 personal tags per station (1–24 characters each), checked in Postgres by `valid_tags()` and in the page by `lib/tags.ts`.

## Freshness

The pill in the header answers "can I trust these numbers?" from the `worker_runs` table (`lib/freshness.ts`):

| state | when | what you see |
|---|---|---|
| **loading** | first fetch not done | gray "Connecting…", skeleton rows |
| **fresh** | last run worked < 60 s ago | ● Live · Checked 4 s ago · Divvy updated 1 min ago |
| **stale** | no successful run for 60 s (6 missed runs), or Divvy hasn't published for 10 min | ● Not updating, amber banner, faded numbers |
| **down** | the worker's last run failed | ● Divvy feed unavailable, red banner with how old the numbers are |

There are two clocks because there are two sources of delay: **we** check every 10 s, but **Divvy** only publishes every 1–2 minutes. Each row also shows "changed N min ago", and flashes with a `+1` / `−1` when Realtime updates it.

## Tests

| command / file | checks |
|---|---|
| `npm test` → `supabase/functions/divvy-sync/worker.test.ts` | Runs the worker on **saved Divvy responses** (30 real stations from two snapshots) with a fake database: the first run loads all 30; the next run saves **only the 10 that really changed** (not the 10 where only `last_reported` ticked); the same response twice writes nothing; a renamed field (GBFS v3 style) **fails the run instead of saving bad data**; Divvy being down is recorded as a failed run. |
| `npm test` → `lib/freshness.test.ts` | loading / fresh / stale / down rules and their thresholds |
| `npm test` → `lib/tags.test.ts` | tag parsing: commas, duplicates, the 5 × 24 limits |
| `supabase/tests/sync_station_status.sql` | the **real** SQL upsert: a `last_reported`-only change writes 0 rows, a real change writes 1, unknown stations are reported |
| `supabase/tests/follows_rls.sql` | acts as two users: you can't see, edit, or delete someone else's follows or tags; `user_id` comes from the JWT; only `tags` can be updated |
| `node scripts/realtime-check.mjs <clerk_session_id>` | end to end, outside the browser: a Clerk test user's token is accepted by Realtime, `worker_runs` inserts arrive every ~10 s, `station_status` events arrive only for watched ids, and the connection survives Clerk's 60 s token expiry |

The SQL tests run in a transaction that is rolled back; run them in the Supabase SQL editor or through the Supabase MCP.

## What the logs showed

- Each run logs `fetched status: 2078 stations, feed updated …`, then `sync: N changed, 0 unknown`, then `run ok: N rows changed in ~150–450 ms`.
- Most runs change **0 rows**. Divvy publishes every 1–2 minutes (despite `ttl: 60`), and the run right after a publish changes 50–90 rows. This is why the page has two clocks.
- While testing the page, the freshness clock once read 16 s. Realtime checks showed the server was fine. The bug was that following a station rebuilt the whole Realtime channel, including the `worker_runs` subscription. It's now two channels, and the runs channel never restarts.

## Free tier budget

- **Edge Function calls:** every 10 s ≈ 259k / month of the 500k free.
- **Realtime messages:** only changed rows are written, and each page only receives its own followed stations plus one run per 10 s. Pages unsubscribe while the tab is hidden.
- **Database growth:** a nightly Cron job deletes `worker_runs` and Cron history older than 24 h (each grows by 8,640 rows/day).
- **Egress:** the worker sends the snapshot *to* Postgres and lets SQL compare, instead of reading 2,078 rows back every 10 s (~1.7 GB/day).

## Run it locally

```bash
npm install
npx clerk env pull                     # Clerk keys -> .env.local
# add to .env.local:
#   NEXT_PUBLIC_SUPABASE_URL=https://yomqjvkhlwolbyhxdzzx.supabase.co
#   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
npm run dev                            # http://localhost:3000
npm test
```

The worker, schema, and schedule live in Supabase (`supabase/functions`, `supabase/migrations`) and were deployed through the Supabase MCP. The worker's secret key is stored only in Vault (`divvy_worker_key`) and in Supabase's own Edge Function environment, never in this repo.

## Stack

Next.js 16 (App Router, Cache Components) · Tailwind CSS 4 · Clerk · Supabase (Postgres, Realtime, Edge Functions, Cron, Vault) · Leaflet + OpenStreetMap · Vercel Hobby
