# Data flow

Drawn before any code was written. GitHub renders the chart below.

```mermaid
flowchart LR
  subgraph Lyft["Divvy GBFS (Lyft)"]
    INFO["station_information.json<br/>names, lat/lon, capacity<br/>rarely changes"]
    STATUS["station_status.json<br/>bikes, e-bikes, docks<br/>ttl 60 s"]
  end

  subgraph Supabase
    CRON["Supabase Cron<br/>every 10 s"]
    WORKER["Edge Function<br/>divvy-sync<br/>(Deno, secret key)"]
    SYNC["SQL function<br/>sync_station_status()<br/>upsert WHERE changed"]
    subgraph DB["Postgres"]
      STATIONS[("stations")]
      STATROWS[("station_status")]
      RUNS[("worker_runs")]
      FOLLOWS[("follows<br/>RLS: own rows")]
    end
    RT["Realtime<br/>postgres_changes"]
  end

  subgraph Vercel
    PAGE["Next.js page<br/>Clerk sign-in"]
  end

  CRON -- "HTTP POST" --> WORKER
  WORKER -- "GET every run" --> STATUS
  WORKER -- "GET hourly or on new id" --> INFO
  WORKER -- "all ~2,078 rows" --> SYNC
  SYNC -- "only changed rows" --> STATROWS
  WORKER -- "upsert" --> STATIONS
  WORKER -- "1 row per run:<br/>ok, rows_changed, ms" --> RUNS
  STATROWS -- "UPDATE events" --> RT
  RUNS -- "INSERT events" --> RT
  RT -- "websocket, filtered to<br/>followed station ids" --> PAGE
  PAGE -- "follow / unfollow<br/>(Clerk JWT)" --> FOLLOWS
  PAGE -- "initial load" --> DB
```

## What each part sends to the next

| from → to | sends | if it changed |
|---|---|---|
| Divvy → worker | JSON `{last_updated, ttl, data: {stations: [...]}}` | A renamed field (e.g. GBFS v3 `num_vehicles_available`) parses as `undefined`. The worker validates and records a failed run instead of writing nulls. |
| Cron → worker | an HTTP POST every 10 s | If Cron stops, no new runs appear. The page sees the last run getting old and shows **stale**. |
| worker → `sync_station_status` | every station's numbers | If the worker sent `last_reported` as a compared field, ~7x more rows would "change". |
| SQL → `station_status` | only rows whose bikes / e-bikes / docks / in-service changed | This is what keeps Realtime and egress inside the free tier. |
| worker → `worker_runs` | `ran_at, ok, rows_changed, duration_ms, error, feed_updated_at` | The page's fresh / stale / down states all read this table. |
| Realtime → page | one message per changed row, only for stations the person follows | Realtime silently sends nothing if the table isn't in the publication, the role lacks `select`, or RLS blocks it. |
| page → `follows` | `{station_id}`, `user_id` from the Clerk JWT `sub` | RLS ensures you only see and change your own follows. |

## Page states

| state | rule |
|---|---|
| loading | first fetch or Realtime subscribe hasn't finished |
| fresh | last run ok and < 60 s ago |
| stale | newest successful run is >= 60 s old (6 missed runs) |
| down | the most recent run failed |

## Free-tier budget

- Edge Function calls: every 10 s = ~259k / month of 500k.
- Realtime: only changed, followed rows reach a page, plus one `worker_runs` insert per run.
- `worker_runs` grows by 8,640 rows a day, so a daily Cron job deletes runs older than 24 h.
