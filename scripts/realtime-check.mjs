// End-to-end check of the live path, outside the browser: signs in as a Clerk
// test user, subscribes to Realtime exactly like lib/use-live-data.ts, and
// prints every event it receives.
//
//   node scripts/realtime-check.mjs <clerk_session_id> [seconds]
//
// Make a session for a test user with:
//   npx clerk api /sessions -d '{"user_id":"user_..."}'
//
// What to look for:
//   channel: SUBSCRIBED                  the Clerk token was accepted by Realtime
//   worker_runs INSERT every ~10 s       Cron -> worker -> database -> Realtime works
//   station_status UPDATE only for the   the in.(...) filter works, so a page only
//   20 watched ids                       receives the stations it follows
//   still receiving after 60 s           Clerk's 60 s token is being refreshed

import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const [SESSION, SECONDS = "60"] = process.argv.slice(2);
if (!SESSION) {
  console.error("usage: node scripts/realtime-check.mjs <clerk_session_id> [seconds]");
  process.exit(2);
}

let cached = null;
let cachedAt = 0;
function token() {
  if (!cached || Date.now() - cachedAt > 40_000) {
    const out = execSync(`npx -y clerk@latest api /sessions/${SESSION}/tokens -d '{}'`, {
      stdio: ["ignore", "pipe", "ignore"],
    });
    cached = JSON.parse(out).jwt;
    cachedAt = Date.now();
  }
  return cached;
}

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const sb = createClient(
  "https://yomqjvkhlwolbyhxdzzx.supabase.co",
  "sb_publishable_S-pdF2YZS6FDRqCn_WdREg_oTbbv78l", // public by design; RLS protects the data
  { accessToken: async () => token() },
);

const { sub, role } = JSON.parse(Buffer.from(token().split(".")[1], "base64url"));
log("signed in as", sub, "with role", role);

const { data: active, error } = await sb
  .from("station_status")
  .select("station_id")
  .order("changed_at", { ascending: false })
  .limit(20);
if (error) throw error;
const ids = active.map((s) => s.station_id);
log(`watching the 20 most recently changed stations for ${SECONDS} s`);

const runs = sb
  .channel(`check-runs-${Date.now()}`)
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "worker_runs" }, (p) =>
    log("worker_runs INSERT", { id: p.new.id, ok: p.new.ok, rows_changed: p.new.rows_changed }),
  )
  .subscribe((s) => log("runs channel:", s));

const stations = sb
  .channel(`check-stations-${Date.now()}`)
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "station_status", filter: `station_id=in.(${ids.join(",")})` },
    (p) => log("station_status", p.eventType, p.new.station_id, { bikes: p.new.bikes, docks: p.new.docks }),
  )
  .subscribe((s) => log("stations channel:", s));

setTimeout(async () => {
  await sb.removeChannel(runs);
  await sb.removeChannel(stations);
  log("done");
  process.exit(0);
}, Number(SECONDS) * 1000);
