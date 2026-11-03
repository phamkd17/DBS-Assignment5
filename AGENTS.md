<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Divvy Live

Follow the Divvy bike stations you care about and watch bikes and docks change in real time, without refreshing.

Built for *Design, Build, Ship* (MPCS 51238), Assignment 5: Live Data System. Due Tue Nov 3, 2026, 5:30 PM.

## Stack

- Next.js (App Router) + Tailwind CSS, deployed on Vercel (Hobby)
- Clerk for sign-in (app "Divvy Live", development instance), connected to Supabase via third-party auth
- Supabase project `yomqjvkhlwolbyhxdzzx`: Postgres, Realtime, Edge Functions, Cron
- Divvy GBFS feed (no key). See `docs/data-source.md`
- Data flow chart: `docs/data-flow.md`

## Rules for the agent

- Never read, write, or print `.env` / `.env.*`. The user manages keys in `.env.local` and in Vercel.
- Secret keys (Clerk secret, Supabase secret / service role) never go in client code, `NEXT_PUBLIC_*` variables, or the repo. The worker gets its key from the Edge Function environment.
- Every table has RLS on. Never disable RLS to make something work.
- Schema changes are migrations in `supabase/migrations/`, applied through the Supabase MCP. Never hand-edit in the dashboard.
- The worker only writes rows that changed. Never compare `last_reported`; it ticks even when nothing changed.
- `supabase/` is Deno code and is excluded in `tsconfig.json` so `next build` doesn't type-check it.
- Commit and push after each step. Explain each change to the user before moving on. This is a learning project.

## Worker

`supabase/functions/divvy-sync/` is an Edge Function that Supabase Cron calls every 10 s.

- `index.ts`: HTTP handler. Fetches the feed, calls `sync_station_status()`, records the run.
- `parse.ts`: pure functions (feed JSON → rows). No Deno or npm imports, so Node can test it.
- `parse.test.ts` + `fixtures/`: `npm test` runs it on a saved Divvy response.

## Data model notes

- `follows.tags text[]`: up to 5 personal tags per followed station, 1-24 chars each, checked by `public.valid_tags()` in Postgres and `lib/tags.ts` in the page. The page may update only this column (`grant update (tags)`), only on its own rows (RLS).
- The page reads `stations` (2,078 rows) in pages of 1,000: PostgREST's row cap.
- Realtime uses two channels in `lib/use-live-data.ts`: `worker_runs` (stable, drives freshness) and `station_status` filtered to the person's follows (re-subscribed when follows change). Never subscribe to `station_status` unfiltered.

## Tests

- `npm test`: worker on saved fixtures, freshness rules, tag parsing (Node's built-in runner, type stripping).
- `supabase/tests/*.sql`: real upsert behavior and follows RLS, in rolled-back transactions. Run through the Supabase MCP `execute_sql`.
- `scripts/realtime-check.mjs <clerk_session_id>`: end-to-end Realtime check as a Clerk test user.
