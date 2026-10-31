// One worker run: fetch the feed, save only what changed, record the run.
// The database and fetch are passed in, so the test can run this on a saved
// copy of Divvy's response with a fake database.

import { parseInfoFeed, parseStatusFeed, type StationRow, type StatusRow } from "./parse.ts";

export const FEED_BASE = "https://gbfs.lyft.com/gbfs/2.3/chi/en";

export type RunRecord = {
  ok: boolean;
  rows_changed: number;
  stations_seen: number;
  duration_ms: number;
  feed_updated_at: string | null;
  error: string | null;
};

export interface Db {
  // Calls sync_station_status(): writes only rows whose numbers changed.
  syncStatus(rows: StatusRow[]): Promise<{ changed: number; unknown: number }>;
  // Calls sync_stations(): same idea for names, locations, capacity.
  syncStations(rows: StationRow[]): Promise<{ changed: number }>;
  recordRun(run: RunRecord): Promise<void>;
}

export type Deps = {
  db: Db;
  fetchJson: (url: string) => Promise<unknown>;
  log?: (msg: string) => void;
  now?: () => number;
};

export async function runSync(
  { db, fetchJson, log = () => {}, now = Date.now }: Deps,
  opts: { refreshStations?: boolean } = {},
): Promise<RunRecord> {
  const started = now();
  let feedUpdatedAt: string | null = null;
  let seen = 0;

  try {
    if (opts.refreshStations) await refreshStations(db, fetchJson, log);

    const status = parseStatusFeed(await fetchJson(`${FEED_BASE}/station_status.json`));
    feedUpdatedAt = status.feedUpdatedAt;
    seen = status.rows.length;
    log(`fetched status: ${seen} stations, feed updated ${feedUpdatedAt}`);

    let result = await db.syncStatus(status.rows);
    log(`sync: ${result.changed} changed, ${result.unknown} unknown`);

    // A station we haven't seen before: load its name and location, then
    // save its numbers. Rows we already saved compare equal and are skipped.
    if (result.unknown > 0) {
      await refreshStations(db, fetchJson, log);
      const retry = await db.syncStatus(status.rows);
      log(`sync after station refresh: ${retry.changed} changed, ${retry.unknown} unknown`);
      result = { changed: result.changed + retry.changed, unknown: retry.unknown };
    }

    const run: RunRecord = {
      ok: true,
      rows_changed: result.changed,
      stations_seen: seen,
      duration_ms: now() - started,
      feed_updated_at: feedUpdatedAt,
      error: null,
    };
    await db.recordRun(run);
    log(`run ok: ${run.rows_changed} rows changed in ${run.duration_ms} ms`);
    return run;
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const run: RunRecord = {
      ok: false,
      rows_changed: 0,
      stations_seen: seen,
      duration_ms: now() - started,
      feed_updated_at: feedUpdatedAt,
      error: message,
    };
    log(`run failed: ${message}`);
    await db.recordRun(run);
    return run;
  }
}

async function refreshStations(db: Db, fetchJson: Deps["fetchJson"], log: (m: string) => void) {
  const stations = parseInfoFeed(await fetchJson(`${FEED_BASE}/station_information.json`));
  const { changed } = await db.syncStations(stations);
  log(`stations: ${stations.length} in feed, ${changed} new or changed`);
}
