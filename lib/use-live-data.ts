"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Station, StationStatus, WorkerRun } from "./types";
import { parseTags } from "./tags";

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
  const [tags, setTagsState] = useState<Record<string, string[]>>({}); // my tags per station, e.g. ["JCL"]
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
          sb.from("follows").select("station_id,tags").order("created_at"),
          loadRuns(sb),
        ]);
        if (mine.error) throw mine.error;
        if (cancelled) return;
        const ids = mine.data.map((f) => f.station_id as string);
        await loadStatuses(sb, ids, false);
        setStations(new Map(all.map((s) => [s.station_id, s])));
        setTagsState(Object.fromEntries(mine.data.map((f) => [f.station_id, (f.tags as string[]) ?? []])));
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

  // 2a. Realtime: every new worker run, which drives the freshness pill. Its own
  // channel, so following a station doesn't interrupt it.
  const ready = follows !== null;
  useEffect(() => {
    if (!sb || !ready || !visible) return;
    const channel = sb
      .channel(`runs-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "worker_runs" }, (payload) => {
        const run = payload.new as WorkerRun;
        setLatestRun(run);
        if (run.ok) setLastOkRun(run);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnection("live");
          loadRuns(sb).catch(() => {}); // catch up on runs missed while away
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnection("reconnecting");
        }
      });
    return () => {
      sb.removeChannel(channel);
    };
  }, [sb, ready, visible, loadRuns]);

  // 2b. Realtime: changes to the stations I follow. Re-subscribes when my
  // follows change, because the filter lists their ids.
  const followKey = follows?.join(",") ?? "";
  useEffect(() => {
    // No follows: no subscription. Unfiltered would send every station's changes.
    if (!sb || !followKey || !visible) return;
    const ids = followKey.split(",");
    const channel = sb
      .channel(`stations-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "station_status", filter: `station_id=in.(${ids.join(",")})` },
        (payload) => {
          if (payload.eventType !== "DELETE") applyStatus(payload.new as StationStatus);
        },
      )
      .subscribe((status) => {
        // Catch up on anything that changed while we were connecting or away.
        if (status === "SUBSCRIBED") loadStatuses(sb, ids, true).catch(() => {});
      });
    return () => {
      sb.removeChannel(channel);
    };
  }, [sb, followKey, visible, applyStatus, loadStatuses]);

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
      const tagsBefore = tags;
      setFollows(follows.filter((x) => x !== id));
      // Tags live on the follows row, so they go with it.
      setTagsState((t) => {
        const next = { ...t };
        delete next[id];
        return next;
      });
      const { error } = await sb.from("follows").delete().eq("station_id", id);
      if (error) {
        setFollows(before);
        setTagsState(tagsBefore);
        setError(`Couldn't remove that station: ${error.message}`);
      }
    },
    [sb, follows, tags],
  );

  // My tags for a followed station, from the edit box ("JCL, Volleyball").
  // Empty text removes them all.
  const setTags = useCallback(
    async (id: string, text: string) => {
      if (!sb) return;
      const next = parseTags(text);
      const before = tags;
      setError(null);
      setTagsState((t) => ({ ...t, [id]: next }));
      const { error } = await sb.from("follows").update({ tags: next }).eq("station_id", id);
      if (error) {
        setTagsState(before);
        setError(`Couldn't save those tags: ${error.message}`);
      }
    },
    [sb, tags],
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
    tags,
    setTags,
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
