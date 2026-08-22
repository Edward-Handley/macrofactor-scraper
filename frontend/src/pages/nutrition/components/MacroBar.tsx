import { fmt } from "../../../lib/format";

interface MacroBarProps {
  label: string;
  actual: number | null;
  low: number;
  high: number;
  unit: string;
}

export function MacroBar({ label, actual, low, high, unit }: MacroBarProps) {
  const scaleMax = Math.max(high * 1.25, actual ?? 0, 1);
  const actualPct = actual != null ? Math.min((actual / scaleMax) * 100, 100) : 0;
  const lowPct = (low / scaleMax) * 100;
  const bandPct = ((high - low) / scaleMax) * 100;

  const inRange = actual != null && actual >= low && actual <= high;
  const farBelow = actual != null && actual < low * 0.8;

  const fillClass =
    actual == null
      ? "bg-zinc-700"
      : inRange
        ? "bg-emerald-500"
        : farBelow
          ? "bg-red-500"
          : "bg-amber-500";

  const statusText =
    actual == null
      ? "no data"
      : inRange
        ? "on track"
        : actual < low
          ? "below minimum"
          : "above target";

  const statusClass =
    actual == null
      ? "text-zinc-500"
      : inRange
        ? "text-emerald-400"
        : actual < low
          ? "text-amber-400"
          : "text-zinc-400";

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
          {label}
        </span>
        <span className="text-sm font-semibold text-zinc-100">
          {actual != null ? `${fmt(actual)}${unit}` : "-"}
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-zinc-800 overflow-hidden">
        {/* target range band */}
        <div
          className="absolute top-0 bottom-0 bg-emerald-500/15 border-x border-emerald-500/30"
          style={{ left: `${lowPct}%`, width: `${bandPct}%` }}
        />
        {/* actual fill */}
        <div
          className={`absolute top-0 bottom-0 left-0 rounded-full transition-all ${fillClass}`}
          style={{ width: `${actualPct}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-zinc-500">
          Target: {fmt(low)}–{fmt(high)}
          {unit}
        </span>
        <span className={statusClass}>{statusText}</span>
      </div>
    </div>
  );
}
