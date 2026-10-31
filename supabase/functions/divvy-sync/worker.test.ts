// Runs the worker on saved copies of Divvy's responses (fixtures/) with a
// fake database, and checks what it saves. `npm test` runs this in Node.
//
// The fixtures are 30 real stations from two snapshots taken 4 minutes apart:
//   10 whose bikes / docks changed between snapshots,
//   10 where only last_reported ticked (no real change),
//   10 identical in both.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStatusFeed } from "./parse.ts";
import { runSync, type Db, type RunRecord } from "./worker.ts";
import type { StationRow, StatusRow } from "./parse.ts";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const INFO = fixture("station_information.json");
const STATUS_1 = fixture("station_status_1.json");
const STATUS_2 = fixture("station_status_2.json");

// A fake database that follows the same rule as sync_station_status() in SQL:
// a row is written only if bikes, ebikes, docks, or in_service differ.
function fakeDb() {
  const stations = new Map<string, StationRow>();
  const status = new Map<string, StatusRow>();
  const runs: RunRecord[] = [];
  const writes: StatusRow[] = []; // every status row actually written
  let syncStatusCalls = 0;

  const db: Db = {
    async syncStations(rows) {
      for (const r of rows) stations.set(r.station_id, r);
      return { changed: rows.length };
    },
    async syncStatus(rows) {
      syncStatusCalls++;
      let changed = 0;
      let unknown = 0;
      for (const r of rows) {
        if (!stations.has(r.station_id)) { unknown++; continue; }
        const cur = status.get(r.station_id);
        const differs = !cur || cur.bikes !== r.bikes || cur.ebikes !== r.ebikes ||
          cur.docks !== r.docks || cur.in_service !== r.in_service;
        if (differs) { status.set(r.station_id, r); writes.push(r); changed++; }
      }
      return { changed, unknown };
    },
    async recordRun(run) { runs.push(run); },
  };
  return { db, stations, status, runs, writes, calls: () => syncStatusCalls };
}

// Serves the saved fixtures instead of calling Divvy.
function fakeFeed(status: unknown) {
  return async (url: string) => {
    if (url.endsWith("/station_information.json")) return INFO;
    if (url.endsWith("/station_status.json")) return status;
    throw new Error(`unexpected url ${url}`);
  };
}

test("parses a station's numbers from the saved response", () => {
  const { feedUpdatedAt, rows } = parseStatusFeed(STATUS_1);
  assert.equal(rows.length, 30);
  assert.equal(feedUpdatedAt, new Date(1793481781 * 1000).toISOString());

  const westernWalton = rows.find((r) => r.station_id === "a3ac9d43-a135-11e9-9cda-0a87ae2ba916");
  assert.deepEqual(westernWalton, {
    station_id: "a3ac9d43-a135-11e9-9cda-0a87ae2ba916",
    bikes: 11,
    ebikes: 0,
    docks: 8,
    in_service: true,
    last_reported: new Date(1793481651 * 1000).toISOString(),
  });

  // Stations that are not renting are saved as out of service.
  assert.equal(rows.filter((r) => !r.in_service).length, 4);
});

test("first run on an empty database loads stations, then saves all 30", async () => {
  const f = fakeDb();
  const run = await runSync({ db: f.db, fetchJson: fakeFeed(STATUS_1) });

  assert.equal(f.stations.size, 30, "station names were loaded because ids were unknown");
  assert.equal(f.status.size, 30);
  assert.deepEqual(
    { ok: run.ok, rows_changed: run.rows_changed, stations_seen: run.stations_seen, error: run.error },
    { ok: true, rows_changed: 30, stations_seen: 30, error: null },
  );
  assert.equal(f.runs.length, 1, "exactly one row in worker_runs");
});

test("next run saves only the 10 stations that really changed", async () => {
  const f = fakeDb();
  await runSync({ db: f.db, fetchJson: fakeFeed(STATUS_1) });
  f.writes.length = 0;

  const run = await runSync({ db: f.db, fetchJson: fakeFeed(STATUS_2) });

  // 20 stations had a new last_reported, but only 10 changed numbers.
  assert.equal(run.rows_changed, 10);
  assert.equal(f.writes.length, 10);
  assert.equal(f.runs.at(-1)?.ok, true);
});

test("the same response twice writes nothing", async () => {
  const f = fakeDb();
  await runSync({ db: f.db, fetchJson: fakeFeed(STATUS_1) });
  f.writes.length = 0;

  const run = await runSync({ db: f.db, fetchJson: fakeFeed(STATUS_1) });

  assert.equal(run.rows_changed, 0);
  assert.equal(f.writes.length, 0);
});

test("a renamed field fails the run instead of saving bad data", async () => {
  const f = fakeDb();
  await runSync({ db: f.db, fetchJson: fakeFeed(STATUS_1) });
  const before = structuredClone([...f.status.values()]);
  const callsBefore = f.calls();

  // What GBFS v3 does: num_bikes_available becomes num_vehicles_available.
  const renamed = structuredClone(STATUS_2);
  for (const s of renamed.data.stations) {
    s.num_vehicles_available = s.num_bikes_available;
    delete s.num_bikes_available;
  }
  const run = await runSync({ db: f.db, fetchJson: fakeFeed(renamed) });

  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /FeedError: station_status: 30 of 30 stations are malformed/);
  assert.equal(f.calls(), callsBefore, "the database was not asked to save anything");
  assert.deepEqual([...f.status.values()], before, "saved data is untouched");
  assert.equal(f.runs.at(-1)?.ok, false, "the failure is recorded, so the page can show down");
});

test("Divvy being unreachable is recorded as a failed run", async () => {
  const f = fakeDb();
  const run = await runSync({
    db: f.db,
    fetchJson: async () => { throw new Error("GET station_status.json: HTTP 503"); },
  });

  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /HTTP 503/);
  assert.equal(f.runs.length, 1);
});
