// divvy-sync: the Edge Function Supabase Cron calls every 10 seconds.
// This file only connects worker.ts to Deno and Supabase; the logic and the
// tests live next to it.

import { createClient } from "npm:@supabase/supabase-js@2";
import { runSync, type Db } from "./worker.ts";

// Supabase provides these on its servers. The secret key never appears in code.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEY: string = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;

const supabase = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const db: Db = {
  async syncStatus(rows) {
    const { data, error } = await supabase.rpc("sync_station_status", { payload: rows });
    if (error) throw new Error(`sync_station_status: ${error.message}`);
    return data;
  },
  async syncStations(rows) {
    const { data, error } = await supabase.rpc("sync_stations", { payload: rows });
    if (error) throw new Error(`sync_stations: ${error.message}`);
    return data;
  },
  async recordRun(run) {
    const { error } = await supabase.from("worker_runs").insert(run);
    if (error) console.error(`worker_runs insert failed: ${error.message}`);
  },
};

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return res.json();
}

Deno.serve(async (req) => {
  // verify_jwt is off (secret keys aren't JWTs), so check the caller here:
  // only Cron, which sends the secret key from Vault, may trigger a run.
  if (!SECRET_KEY || req.headers.get("apikey") !== SECRET_KEY) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const refreshStations = new URL(req.url).searchParams.get("stations") === "1";
  const run = await runSync({ db, fetchJson, log: (m) => console.log(m) }, { refreshStations });
  return Response.json(run, { status: run.ok ? 200 : 500 });
});
