"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Station, StationStatus, WorkerRun } from "./types";

export const MAX_FOLLOWS = 25; // matches the follows_limit trigger

export type Connection = "connecting" | "live" | "reconnecting" | "paused";

// A Realtime change we just received, so the row can flash and show "+1".
export type Flash = { at: number; classic: number; ebikes: number; docks: number };

const STATION_COLUMNS = "station_id,name,lat,lon,capacity";
const PAGE = 1000; // PostgREST returns at most 1,000 rows per request

async function fetchAllStations(sb: SupabaseClient): Promise<Station[]> {
  const all: Station[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("stations")
      .select(STATION_COLUMNS)
      .order("station_id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < PAGE) return all;
  }
}

export function useLiveData(sb: SupabaseClient | null) {
  const [stations, setStations] = useState<Map<string, Station> | null>(null);
  const [follows, setFollows] = useState<string[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, StationStatus>>({});
  const [latestRun, setLatestRun] = useState<WorkerRun | null>(null);
  const [lastOkRun, setLastOkRun] = useState<WorkerRun | null>(null);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [flashes, setFlashes] = useState<Record<string, Flash>>({});
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);

  // The latest statuses, readable inside Realtime callbacks without re-subscribing.
  const statusesRef = useRef(statuses);

  // Save a status row. If it differs from what's on screen, flash the row.
  const applyStatus = useCallback((row: StationStatus, flash = true) => {
    const old = statusesRef.current[row.station_id];
    statusesRef.current = { ...statusesRef.current, [row.station_id]: row };
    setStatuses(statusesRef.current);
    const differs = old && (old.bikes !== row.bikes || old.ebikes !== row.ebikes || old.docks !== row.docks);
    if (flash && differs) {
      setFlashes((f) => ({
        ...f,
        [row.station_id]: {
          at: Date.now(),
          classic: row.bikes - row.ebikes - (old.bikes - old.ebikes),
          ebikes: row.ebikes - old.ebikes,
          docks: row.docks - old.docks,
        },
      }));
    }
  }, []);

  const loadStatuses = useCallback(
    async (client: SupabaseClient, ids: string[], flash: boolean) => {
      if (ids.length === 0) return;
      const { data, error } = await client.from("station_status").select("*").in("station_id", ids);
      if (error) throw error;
      for (const row of data as StationStatus[]) applyStatus(row, flash);
    },
    [applyStatus],
  );

  const loadRuns = useCallback(async (client: SupabaseClient) => {
    const { data, error } = await client.from("worker_runs").select("*").order("ran_at", { ascending: false }).limit(1);
    if (error) throw error;
    const latest = (data[0] as WorkerRun | undefined) ?? null;
    let lastOk = latest?.ok ? latest : null;
    if (latest && !latest.ok) {
      const ok = await client.from("worker_runs").select("*").eq("ok", true).order("ran_at", { ascending: false }).limit(1);
      if (ok.error) throw ok.error;
      lastOk = (ok.data[0] as WorkerRun | undefined) ?? null;
    }
    setLatestRun(latest);
    setLastOkRun(lastOk);
    setRunsLoaded(true);
  }, []);

  // 1. First load: station names, my follows, their numbers, the latest run.
  useEffect(() => {
    if (!sb) return;
    let cancelled = false;
    (async () => {
      try {
        const [all, mine] = await Promise.all([
          fetchAllStations(sb),
          sb.from("follows").select("station_id").order("created_at"),
          loadRuns(sb),
        ]);
        if (mine.error) throw mine.error;
        if (cancelled) return;
        const ids = mine.data.map((f) => f.station_id as string);
        await loadStatuses(sb, ids, false);
        setStations(new Map(all.map((s) => [s.station_id, s])));
        setFollows(ids);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load stations");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sb, loadRuns, loadStatuses]);

  // Pause Realtime while the tab is hidden: no messages used, nothing to show.
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  // 2. Realtime: changes to the stations I follow, and every new worker run.
  const followKey = follows?.join(",") ?? null;
  useEffect(() => {
    if (!sb || followKey === null || !visible) return;
    const ids = followKey ? followKey.split(",") : [];

    const channel = sb.channel(`live-${crypto.randomUUID()}`);
    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "worker_runs" }, (payload) => {
      const run = payload.new as WorkerRun;
      setLatestRun(run);
      if (run.ok) setLastOkRun(run);
    });
    // Only subscribe with a filter. Unfiltered would send every station's changes.
    if (ids.length > 0) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "station_status", filter: `station_id=in.(${ids.join(",")})` },
        (payload) => {
          if (payload.eventType !== "DELETE") applyStatus(payload.new as StationStatus);
        },
      );
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setConnection("live");
        // Catch up on anything that changed while we were connecting or away.
        Promise.all([loadStatuses(sb, ids, true), loadRuns(sb)]).catch(() => {});
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setConnection("reconnecting");
      }
    });

    return () => {
      sb.removeChannel(channel);
    };
  }, [sb, followKey, visible, applyStatus, loadStatuses, loadRuns]);

  const follow = useCallback(
    async (id: string) => {
      if (!sb || !follows || follows.includes(id)) return;
      setError(null);
      setFollows([...follows, id]);
      const { error } = await sb.from("follows").insert({ station_id: id });
      if (error) {
        setFollows((f) => f?.filter((x) => x !== id) ?? f);
        setError(error.message.includes("up to") ? error.message : `Couldn't follow that station: ${error.message}`);
        return;
      }
      await loadStatuses(sb, [id], false).catch(() => {});
    },
    [sb, follows, loadStatuses],
  );

  const unfollow = useCallback(
    async (id: string) => {
      if (!sb || !follows) return;
      setError(null);
      const before = follows;
      setFollows(follows.filter((x) => x !== id));
      const { error } = await sb.from("follows").delete().eq("station_id", id);
      if (error) {
        setFollows(before);
        setError(`Couldn't remove that station: ${error.message}`);
      }
    },
    [sb, follows],
  );

  // For the map: one station's current numbers, fetched once (not live).
  const peekStatus = useCallback(
    async (id: string): Promise<StationStatus | null> => {
      if (!sb) return null;
      const { data } = await sb.from("station_status").select("*").eq("station_id", id).maybeSingle();
      return (data as StationStatus | null) ?? null;
    },
    [sb],
  );

  return {
    loaded: stations !== null && follows !== null && runsLoaded,
    stations,
    follows: follows ?? [],
    statuses,
    latestRun,
    lastOkRun,
    connection: visible ? connection : ("paused" as Connection),
    flashes,
    error,
    dismissError: () => setError(null),
    follow,
    unfollow,
    peekStatus,
  };
}
