// Turns Divvy's GBFS JSON into the rows our database stores.
// Pure functions with no Deno or npm imports, so `npm test` can run them in Node.

export type StatusRow = {
  station_id: string;
  bikes: number; // classic + e-bikes
  ebikes: number;
  docks: number;
  in_service: boolean;
  last_reported: string | null; // ISO timestamp; stored, never compared
};

export type StationRow = {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number;
};

// Thrown when the feed doesn't look like GBFS anymore. The worker records a
// failed run instead of writing bad data, and the page shows "down".
export class FeedError extends Error {
  override name = "FeedError";
}

// A few odd stations are skipped; more than this means the format changed.
const MAX_INVALID_SHARE = 0.1;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isFlag = (v: unknown) => v === 1 || v === 0 || v === true || v === false;
const isCoord = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function stationsArray(json: unknown, feed: string): unknown[] {
  if (!isObj(json) || !isObj(json.data) || !Array.isArray(json.data.stations)) {
    throw new FeedError(`${feed}: expected { data: { stations: [...] } }`);
  }
  if (json.data.stations.length === 0) throw new FeedError(`${feed}: no stations`);
  return json.data.stations;
}

// Keeps the valid rows, drops duplicates, and fails if too many rows are bad.
function collect<T extends { station_id: string }>(
  raw: unknown[],
  feed: string,
  toRow: (s: Obj) => T | null,
): T[] {
  const rows = new Map<string, T>();
  let invalid = 0;
  for (const s of raw) {
    const row = isObj(s) ? toRow(s) : null;
    if (row) rows.set(row.station_id, row);
    else invalid++;
  }
  if (invalid / raw.length > MAX_INVALID_SHARE) {
    throw new FeedError(`${feed}: ${invalid} of ${raw.length} stations are malformed`);
  }
  return [...rows.values()];
}

export function parseStatusFeed(json: unknown): { feedUpdatedAt: string | null; rows: StatusRow[] } {
  const raw = stationsArray(json, "station_status");
  const rows = collect(raw, "station_status", (s) => {
    const ebikes = s.num_ebikes_available ?? 0;
    if (
      typeof s.station_id !== "string" ||
      !isCount(s.num_bikes_available) ||
      !isCount(ebikes) ||
      !isCount(s.num_docks_available) ||
      !isFlag(s.is_installed) || !isFlag(s.is_renting) || !isFlag(s.is_returning)
    ) return null;
    return {
      station_id: s.station_id,
      bikes: s.num_bikes_available,
      ebikes: Math.min(ebikes, s.num_bikes_available),
      docks: s.num_docks_available,
      in_service: Boolean(s.is_installed && s.is_renting && s.is_returning),
      last_reported: unixToIso(s.last_reported),
    };
  });
  return { feedUpdatedAt: unixToIso((json as Obj).last_updated), rows };
}

export function parseInfoFeed(json: unknown): StationRow[] {
  const raw = stationsArray(json, "station_information");
  return collect(raw, "station_information", (s) => {
    if (
      typeof s.station_id !== "string" ||
      typeof s.name !== "string" ||
      !isCoord(s.lat) || !isCoord(s.lon)
    ) return null;
    return {
      station_id: s.station_id,
      name: s.name.trim(),
      lat: s.lat,
      lon: s.lon,
      capacity: isCount(s.capacity) ? s.capacity : 0,
    };
  });
}

function unixToIso(v: unknown): string | null {
  return typeof v === "number" && v > 0 ? new Date(v * 1000).toISOString() : null;
}
