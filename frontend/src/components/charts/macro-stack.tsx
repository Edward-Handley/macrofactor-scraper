import { fmt } from "../../lib/format";
import type { DailySummary } from "../../lib/types";

interface MacroStackProps {
  today: DailySummary | null;
  recent: DailySummary[];
}

const MACROS = [
  { key: "protein" as const, label: "Protein", unit: "g", color: "#34d399" },
  { key: "carbohydrates" as const, label: "Carbs", unit: "g", color: "#60a5fa" },
  { key: "fat" as const, label: "Fat", unit: "g", color: "#c084fc" },
];

export function MacroStack({ today, recent }: MacroStackProps) {
  function maxFor(key: "protein" | "carbohydrates" | "fat"): number {
    const vals = recent.map((d) => d[key] ?? 0);
    return Math.max(...vals, 1);
  }

  return (
    <div className="flex flex-col gap-3">
      {MACROS.map(({ key, label, unit, color }) => {
        const value = today?.[key] ?? null;
        const max = maxFor(key);
        const pct = value != null ? Math.min(100, (value / max) * 100) : 0;
        return (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">{label}</span>
              <span className="text-sm font-bold text-zinc-100 tabular-nums">
                {fmt(value, 1)}{value != null ? ` ${unit}` : ""}
              </span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
