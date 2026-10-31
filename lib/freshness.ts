// How fresh is the data on screen? Decided from the worker_runs table.
//
//   loading  the first fetch hasn't finished
//   fresh    the last run worked, recently
//   stale    no successful run for STALE_AFTER_S (Cron stopped, or we lost the
//            connection), or Divvy itself hasn't published in FEED_STALE_AFTER_S
//   down     the worker's last run failed

import type { WorkerRun } from "./types";

export const RUN_EVERY_S = 10;
export const STALE_AFTER_S = 60; // 6 missed runs
export const FEED_STALE_AFTER_S = 10 * 60; // Divvy normally publishes every 1-2 min

export type HealthState = "loading" | "fresh" | "stale" | "down";

export type Health = {
  state: HealthState;
  headline: string; // short, for the pill
  detail: string; // one line under it
};

export function computeHealth(opts: {
  loaded: boolean;
  latestRun: WorkerRun | null;
  lastOkRun: WorkerRun | null;
  now: number;
}): Health {
  const { loaded, latestRun, lastOkRun, now } = opts;
  if (!loaded) return { state: "loading", headline: "Connecting…", detail: "Loading the latest numbers" };

  if (!latestRun) {
    return { state: "down", headline: "No data yet", detail: "The worker hasn't run yet" };
  }

  const okAgo = lastOkRun ? secondsSince(lastOkRun.ran_at, now) : null;
  const shownFrom = okAgo === null ? "No numbers saved yet" : `Showing numbers from ${formatAgo(okAgo)}`;

  if (!latestRun.ok) {
    return {
      state: "down",
      headline: "Divvy feed unavailable",
      detail: `Last check failed ${formatAgo(secondsSince(latestRun.ran_at, now))}. ${shownFrom}`,
    };
  }

  if (okAgo === null || okAgo > STALE_AFTER_S) {
    return {
      state: "stale",
      headline: "Not updating",
      detail: `Last successful check ${formatAgo(okAgo ?? Infinity)}`,
    };
  }

  const feedAgo = lastOkRun?.feed_updated_at ? secondsSince(lastOkRun.feed_updated_at, now) : null;
  if (feedAgo !== null && feedAgo > FEED_STALE_AFTER_S) {
    return {
      state: "stale",
      headline: "Divvy is behind",
      detail: `Divvy hasn't published new numbers since ${formatAgo(feedAgo)}`,
    };
  }

  return {
    state: "fresh",
    headline: "Live",
    detail: `Checked ${formatAgo(okAgo)}${feedAgo === null ? "" : ` · Divvy updated ${formatAgo(feedAgo)}`}`,
  };
}

export function secondsSince(iso: string, now: number): number {
  return Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
}

export function formatAgo(seconds: number): string {
  if (!Number.isFinite(seconds)) return "a long time ago";
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
