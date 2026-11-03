"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { Station, StationStatus } from "@/lib/types";
import { CHICAGO, formatMiles, milesBetween } from "@/lib/geo";
import { MAX_FOLLOWS } from "@/lib/use-live-data";

const StationMap = dynamic(() => import("./StationMap"), {
  ssr: false,
  loading: () => <div className="h-80 w-full animate-pulse rounded-lg bg-slate-100 sm:h-96" />,
});

type Tab = "search" | "near" | "map";
type Locate =
  | { state: "idle" }
  | { state: "locating" }
  | { state: "found"; lat: number; lon: number }
  | { state: "error"; message: string };

export function AddStations(props: {
  stations: Station[];
  followed: Set<string>;
  tags: Record<string, string[]>;
  onFollow: (id: string) => void;
  onUnfollow: (id: string) => void;
  peekStatus: (id: string) => Promise<StationStatus | null>;
}) {
  const { stations, followed, tags, onFollow, onUnfollow, peekStatus } = props;
  const [tab, setTab] = useState<Tab>("search");
  const [query, setQuery] = useState("");
  const [locate, setLocate] = useState<Locate>({ state: "idle" });
  const [selected, setSelected] = useState<{ id: string; status: StationStatus | null | "loading" } | null>(null);
  const full = followed.size >= MAX_FOLLOWS;
  const here = locate.state === "found" ? locate : null;

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const words = q.split(/\s+/);
    return stations
      .filter((s) => words.every((w) => s.name.toLowerCase().includes(w)))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [stations, query]);

  const nearest = useMemo(() => {
    if (!here) return [];
    return stations
      .map((s) => ({ s, mi: milesBetween(here, s) }))
      .sort((a, b) => a.mi - b.mi)
      .slice(0, 10);
  }, [stations, here]);

  function findMe() {
    if (!("geolocation" in navigator)) {
      setLocate({ state: "error", message: "This browser can't share its location. Try search instead." });
      return;
    }
    setLocate({ state: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocate({ state: "found", lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) =>
        setLocate({
          state: "error",
          message:
            err.code === err.PERMISSION_DENIED
              ? "Location is blocked for this site. Allow it in your browser's address bar, or use search."
              : "Couldn't get your location. Try again, or use search.",
        }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  async function select(id: string) {
    setSelected({ id, status: "loading" });
    const status = await peekStatus(id);
    setSelected((cur) => (cur?.id === id ? { id, status } : cur));
  }

  const followButton = (id: string, name: string) => {
    const isFollowed = followed.has(id);
    return (
      <button
        type="button"
        onClick={() => (isFollowed ? onUnfollow(id) : onFollow(id))}
        disabled={!isFollowed && full}
        aria-label={isFollowed ? `Stop following ${name}` : `Follow ${name}`}
        className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-40 ${
          isFollowed ? "bg-sky-50 text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100" : "bg-sky-700 text-white hover:bg-sky-800"
        }`}
      >
        {isFollowed ? "Following ✓" : "Follow"}
      </button>
    );
  };

  const resultList = (items: { s: Station; mi?: number }[]) => (
    <ul className="divide-y divide-slate-100">
      {items.map(({ s, mi }) => (
        <li key={s.station_id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-2">
              {tags[s.station_id]?.map((t) => <Tag key={t} text={t} />)}
              <span className="truncate font-medium">{s.name}</span>
            </p>
            <p className="text-xs text-slate-500">
              {mi !== undefined ? `${formatMiles(mi)} away · ` : ""}
              {s.capacity} docks
            </p>
          </div>
          {followButton(s.station_id, s.name)}
        </li>
      ))}
    </ul>
  );

  const selectedStation = selected ? stations.find((s) => s.station_id === selected.id) : undefined;

  return (
    <section aria-labelledby="add-heading" className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <h2 id="add-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Add stations
        </h2>
        <div role="tablist" aria-label="How to find stations" className="flex rounded-lg bg-slate-100 p-0.5 text-sm">
          {(
            [
              ["search", "Search"],
              ["near", "Near me"],
              ["map", "Map"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`rounded-md px-3 py-1 font-medium focus-visible:outline-2 focus-visible:outline-sky-600 ${
                tab === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3" role="tabpanel">
        {full && (
          <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
            You&apos;re following {MAX_FOLLOWS} stations, the most we allow. Remove one to add another.
          </p>
        )}

        {tab === "search" && (
          <>
            <label htmlFor="station-search" className="sr-only">
              Search stations by street name
            </label>
            <input
              id="station-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by street, e.g. Ellis 60th"
              autoComplete="off"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base placeholder:text-slate-400 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
            {query.trim().length >= 2 && searchResults.length === 0 ? (
              <p className="py-4 text-sm text-slate-500">No stations match &ldquo;{query.trim()}&rdquo;.</p>
            ) : (
              resultList(searchResults.map((s) => ({ s, mi: here ? milesBetween(here, s) : undefined })))
            )}
          </>
        )}

        {tab === "near" && (
          <>
            {locate.state !== "found" && (
              <div className="py-2">
                <button
                  type="button"
                  onClick={findMe}
                  disabled={locate.state === "locating"}
                  className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:opacity-60"
                >
                  {locate.state === "locating" ? "Finding you…" : "Use my location"}
                </button>
                <p className="mt-2 text-xs text-slate-500">Your location stays in your browser. It&apos;s only used to sort stations.</p>
                {locate.state === "error" && <p className="mt-2 text-sm text-red-800">{locate.message}</p>}
              </div>
            )}
            {here && resultList(nearest)}
          </>
        )}

        {tab === "map" && (
          <div className="space-y-3">
            <StationMap
              stations={stations}
              followed={followed}
              selectedId={selected?.id ?? null}
              center={here ?? CHICAGO}
              onSelect={select}
            />
            {selectedStation ? (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex min-w-0 items-center gap-2">
                    {tags[selectedStation.station_id]?.map((t) => <Tag key={t} text={t} />)}
                    <span className="truncate font-medium">{selectedStation.name}</span>
                  </p>
                  <p className="text-xs text-slate-500 tabular-nums">
                    {selected?.status === "loading"
                      ? "Loading…"
                      : selected?.status
                        ? `${selected.status.bikes - selected.status.ebikes} classic · ${selected.status.ebikes} e-bike · ${selected.status.docks} docks`
                        : "No numbers yet"}
                  </p>
                </div>
                {followButton(selectedStation.station_id, selectedStation.name)}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Tap a dot to see a station. Blue dots are ones you follow.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Tag({ text }: { text: string }) {
  return <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-900">{text}</span>;
}
