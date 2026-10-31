// Row shapes from supabase/migrations/20261031220000_tables_rls_sync.sql.

export type Station = {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number;
};

export type StationStatus = {
  station_id: string;
  bikes: number; // classic + e-bikes
  ebikes: number;
  docks: number;
  in_service: boolean;
  last_reported: string | null;
  changed_at: string;
};

export type WorkerRun = {
  id: number;
  ran_at: string;
  ok: boolean;
  rows_changed: number;
  stations_seen: number;
  duration_ms: number;
  feed_updated_at: string | null;
  error: string | null;
};
