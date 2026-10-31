import type { Health, HealthState } from "@/lib/freshness";

const DOT: Record<HealthState, string> = {
  loading: "bg-slate-400 animate-pulse",
  fresh: "bg-emerald-500",
  stale: "bg-amber-500",
  down: "bg-red-600",
};

const TEXT: Record<HealthState, string> = {
  loading: "text-slate-600",
  fresh: "text-emerald-800",
  stale: "text-amber-800",
  down: "text-red-800",
};

// The freshness indicator in the header: a colored dot plus words, so color
// is never the only signal.
export function StatusPill({ health }: { health: Health }) {
  return (
    <div className="min-w-0 text-right">
      <p className={`flex items-center justify-end gap-2 text-sm font-semibold ${TEXT[health.state]}`}>
        <span className="relative flex size-2.5 shrink-0">
          {health.state === "fresh" && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" />
          )}
          <span className={`relative inline-flex size-2.5 rounded-full ${DOT[health.state]}`} />
        </span>
        {/* Announce state changes (Live → Not updating) to screen readers, not every tick. */}
        <span aria-live="polite">{health.headline}</span>
      </p>
      <p className="truncate text-xs text-slate-500 tabular-nums">{health.detail}</p>
    </div>
  );
}

// Shown above the list when the numbers can't be trusted.
export function HealthBanner({ health }: { health: Health }) {
  if (health.state !== "stale" && health.state !== "down") return null;
  const down = health.state === "down";
  return (
    <div
      role="status"
      className={`rounded-lg border px-4 py-3 text-sm ${
        down ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      <p className="font-semibold">
        {down ? "We can't reach Divvy right now." : "These numbers have stopped updating."}
      </p>
      <p className="mt-0.5">
        {health.detail}.{" "}
        {down ? "We'll keep trying every 10 seconds." : "The numbers may be out of date, so check before you walk over."}
      </p>
    </div>
  );
}
