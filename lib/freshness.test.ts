import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHealth, formatAgo } from "./freshness.ts";
import type { WorkerRun } from "./types.ts";

const NOW = Date.parse("2026-10-31T22:10:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

function run(secondsAgo: number, ok = true, feedSecondsAgo = 60): WorkerRun {
  return {
    id: 1, ran_at: ago(secondsAgo), ok, rows_changed: 0, stations_seen: 2078, duration_ms: 200,
    feed_updated_at: ago(feedSecondsAgo), error: ok ? null : "FeedError: no stations",
  };
}

test("loading until the first fetch finishes", () => {
  assert.equal(computeHealth({ loaded: false, latestRun: null, lastOkRun: null, now: NOW }).state, "loading");
});

test("fresh when the last run worked seconds ago", () => {
  const r = run(4);
  const h = computeHealth({ loaded: true, latestRun: r, lastOkRun: r, now: NOW });
  assert.equal(h.state, "fresh");
  assert.equal(h.detail, "Checked just now · Divvy updated 1 min ago");
});

test("stale after 6 missed runs (60 s without a successful run)", () => {
  const r = run(61);
  assert.equal(computeHealth({ loaded: true, latestRun: r, lastOkRun: r, now: NOW }).state, "stale");
  const r2 = run(59);
  assert.equal(computeHealth({ loaded: true, latestRun: r2, lastOkRun: r2, now: NOW }).state, "fresh");
});

test("stale when Divvy itself stops publishing, even if the worker is fine", () => {
  const r = run(3, true, 11 * 60);
  const h = computeHealth({ loaded: true, latestRun: r, lastOkRun: r, now: NOW });
  assert.equal(h.state, "stale");
  assert.equal(h.headline, "Divvy is behind");
});

test("down when the worker's last run failed, and says how old the numbers are", () => {
  const h = computeHealth({ loaded: true, latestRun: run(5, false), lastOkRun: run(125), now: NOW });
  assert.equal(h.state, "down");
  assert.equal(h.detail, "Last check failed 5 s ago. Showing numbers from 2 min ago");
});

test("formatAgo", () => {
  assert.deepEqual([0, 12, 60, 3599, 7200, 90000].map(formatAgo),
    ["just now", "12 s ago", "1 min ago", "59 min ago", "2 h ago", "1 d ago"]);
});
