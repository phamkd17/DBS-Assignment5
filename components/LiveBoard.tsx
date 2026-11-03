"use client";

import { useEffect, useMemo, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { useSupabase } from "@/lib/supabase-browser";
import { useLiveData } from "@/lib/use-live-data";
import { computeHealth } from "@/lib/freshness";
import { AddStations } from "./AddStations";
import { HealthBanner, StatusPill } from "./StatusPill";
import { StationRow, StationRowsHeader, StationRowsSkeleton } from "./StationRows";

// The signed-in page: my stations, live, plus a way to add more.
export function LiveBoard() {
  const sb = useSupabase();
  const live = useLiveData(sb);
  const now = useNow(1000);

  const health = computeHealth({ loaded: live.loaded, latestRun: live.latestRun, lastOkRun: live.lastOkRun, now });
  const dim = health.state === "stale" || health.state === "down";
  const stationList = useMemo(() => (live.stations ? [...live.stations.values()] : []), [live.stations]);
  const followed = useMemo(() => new Set(live.follows), [live.follows]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-[1000] border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-4 py-3">
          <h1 className="shrink-0 text-lg font-semibold tracking-tight">
            Divvy <span className="text-sky-700">Live</span>
          </h1>
          <div className="flex min-w-0 items-center gap-3">
            <StatusPill health={health} />
            <UserButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 py-5">
        <HealthBanner health={health} />

        {live.loaded && live.connection === "reconnecting" && (
          <p role="status" className="text-sm text-slate-600">
            Reconnecting to live updates…
          </p>
        )}

        {live.error && (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            <span>{live.error}</span>
            <button type="button" onClick={live.dismissError} className="font-medium underline">
              Dismiss
            </button>
          </div>
        )}

        <section aria-labelledby="mine-heading" className="rounded-xl border border-slate-200 bg-white pt-3">
          <h2 id="mine-heading" className="px-4 pb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
            Your stations
          </h2>
          {!live.loaded ? (
            <StationRowsSkeleton />
          ) : live.follows.length === 0 ? (
            <div className="px-4 pb-5 pt-1 text-sm text-slate-600">
              <p className="font-medium text-slate-900">You&apos;re not following any stations yet.</p>
              <p className="mt-1">
                Add the stations by your home, class, or work below. Their bikes and docks will update here on their own.
              </p>
            </div>
          ) : (
            <>
              <StationRowsHeader />
              <ul aria-label="Stations you follow">
                {live.follows.map((id) => (
                  <StationRow
                    key={id}
                    stationId={id}
                    station={live.stations?.get(id)}
                    status={live.statuses[id]}
                    flash={live.flashes[id]}
                    tags={live.tags[id] ?? []}
                    now={now}
                    dim={dim}
                    onRemove={() => live.unfollow(id)}
                    onSaveTags={(text) => live.setTags(id, text)}
                  />
                ))}
              </ul>
            </>
          )}
        </section>

        {live.loaded && (
          <AddStations
            stations={stationList}
            followed={followed}
            tags={live.tags}
            onFollow={live.follow}
            onUnfollow={live.unfollow}
            peekStatus={live.peekStatus}
          />
        )}
      </main>

      <footer className="px-4 py-6 text-center text-xs text-slate-500">
        Data from Divvy&apos;s public GBFS feed. We check every 10 seconds; Divvy publishes new numbers every minute or two.
      </footer>
    </div>
  );
}

// The current time, updated every `ms`, so "12 s ago" labels count up.
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
