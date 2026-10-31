import type { Flash } from "@/lib/use-live-data";
import type { Station, StationStatus } from "@/lib/types";
import { formatAgo, secondsSince } from "@/lib/freshness";

const GRID = "grid grid-cols-[minmax(0,1fr)_3.25rem_3.25rem_3.25rem_2rem] items-center gap-x-1 sm:gap-x-2";
const FLASH_MS = 4000;

export function StationRowsHeader() {
  return (
    <div className={`${GRID} border-b border-slate-200 px-4 pb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500`}>
      <span>Station</span>
      <span className="text-right">Classic</span>
      <span className="text-right">E-bike</span>
      <span className="text-right">Docks</span>
      <span />
    </div>
  );
}

export function StationRow(props: {
  station: Station | undefined;
  stationId: string;
  status: StationStatus | undefined;
  flash: Flash | undefined;
  now: number;
  dim: boolean;
  onRemove: () => void;
}) {
  const { station, stationId, status, flash, now, dim, onRemove } = props;
  const name = station?.name ?? stationId;
  const recent = flash && now - flash.at < FLASH_MS ? flash : undefined;
  const classic = status ? status.bikes - status.ebikes : null;

  return (
    <li className="border-b border-slate-100 last:border-b-0">
      {/* A new key remounts the row, which restarts the flash animation. */}
      <div key={flash?.at ?? 0} className={`${GRID} px-4 py-2.5 ${flash ? "row-flash" : ""}`}>
        <div className="min-w-0">
          <p className="truncate font-medium">{name}</p>
          <p className="truncate text-xs text-slate-500">
            {!status ? (
              "No numbers yet"
            ) : !status.in_service ? (
              <span className="font-medium text-slate-700">Out of service</span>
            ) : (
              `changed ${formatAgo(secondsSince(status.changed_at, now))}`
            )}
          </p>
        </div>
        <Count value={classic} delta={recent?.classic} dim={dim || !status?.in_service} label="classic bikes" />
        <Count value={status?.ebikes ?? null} delta={recent?.ebikes} dim={dim || !status?.in_service} label="e-bikes" />
        <Count value={status?.docks ?? null} delta={recent?.docks} dim={dim || !status?.in_service} label="open docks" />
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Stop following ${name}`}
          className="ml-auto flex size-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-sky-600"
        >
          <span aria-hidden>✕</span>
        </button>
      </div>
    </li>
  );
}

function Count({ value, delta, dim, label }: { value: number | null; delta?: number; dim: boolean; label: string }) {
  return (
    <div className="relative text-right" aria-label={value === null ? `${label} unknown` : `${value} ${label}`}>
      <span
        className={`font-mono text-lg font-semibold tabular-nums ${
          value === 0 ? "text-red-700" : "text-slate-900"
        } ${dim ? "opacity-50" : ""}`}
      >
        {value ?? "–"}
      </span>
      {delta ? (
        <span
          aria-hidden
          className={`absolute -top-2 -right-1 rounded px-1 font-mono text-[10px] font-semibold ${
            delta > 0 ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
          }`}
        >
          {delta > 0 ? `+${delta}` : delta}
        </span>
      ) : null}
    </div>
  );
}

export function StationRowsSkeleton() {
  return (
    <ul aria-hidden>
      {[0, 1, 2].map((i) => (
        <li key={i} className={`${GRID} border-b border-slate-100 px-4 py-3`}>
          <div className="space-y-1.5">
            <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
            <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
          </div>
          {[0, 1, 2].map((j) => (
            <div key={j} className="ml-auto h-5 w-6 animate-pulse rounded bg-slate-200" />
          ))}
          <span />
        </li>
      ))}
    </ul>
  );
}
