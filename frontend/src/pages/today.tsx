import { useMemo } from "react";
import { useDashboardSummary, usePreferences } from "../hooks/use-dashboard";
import { CalorieRing } from "../components/charts/calorie-ring";
import { MacroStack } from "../components/charts/macro-stack";
import { Sparkline } from "../components/charts/sparkline";
import { CalendarHeatmap } from "../components/charts/calendar-heatmap";
import { fmt, isoDate, offsetDate, formatShortDate, deltaArrow } from "../lib/format";
import { FIELD_META } from "../lib/types";
import type { DailySummary } from "../lib/types";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

function StatCard({ label, value, unit, delta, sparkData, field }: {
  label: string; value: number | null; unit: string;
  delta?: number | null; sparkData: DailySummary[]; field: "weight" | "steps" | "active_energy" | "water";
}) {
  const meta = FIELD_META[field];
  const arrow = delta != null ? deltaArrow(delta) : null;
  const deltaClass = delta == null ? "" : delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-zinc-400";

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{label}</span>
        {arrow && (
          <span className={`text-xs font-bold ${deltaClass}`}>
            {arrow} {Math.abs(delta!).toFixed(field === "weight" ? 1 : 0)}
          </span>
        )}
      </div>
      <div className="flex items-end gap-1.5">
        <span className="text-2xl font-black text-zinc-50 tabular-nums leading-none">
          {fmt(value, meta.decimals)}
        </span>
        {unit && <span className="text-sm text-zinc-500 mb-0.5">{unit}</span>}
      </div>
      <Sparkline data={sparkData} field={field} color={meta.color} height={36} />
    </Card>
  );
}

export function Today() {
  const end = isoDate();
  const start = offsetDate(-89);
  const { data: summary, isLoading, error } = useDashboardSummary(start, end);
  const { data: prefs } = usePreferences();

  const summaries = summary?.summaries ?? [];
  const today = summaries.find((d) => d.date === isoDate()) ?? summaries.at(-1) ?? null;
  const recent7 = summaries.slice(-7);
  const recent30 = summaries.slice(-30);

  const weightDelta7d = useMemo(() => {
    const weights = summaries.filter((d) => d.weight != null).slice(-8);
    if (weights.length < 2) return null;
    return (weights.at(-1)!.weight! - weights[0].weight!);
  }, [summaries]);

  const stepsDelta7d = useMemo(() => {
    const avg7 = recent7.reduce((s, d) => s + (d.steps ?? 0), 0) / (recent7.length || 1);
    const prev7 = summaries.slice(-14, -7);
    const avgPrev = prev7.reduce((s, d) => s + (d.steps ?? 0), 0) / (prev7.length || 1);
    return avg7 - avgPrev;
  }, [summaries, recent7]);

  const rangeDays = prefs?.preferred_range_days ?? 30;
  const heatmapData = summaries.slice(-rangeDays);

  if (isLoading) return (
    <div className="p-6 flex items-center justify-center h-64">
      <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
    </div>
  );

  if (error) return (
    <div className="p-6 text-red-400 text-sm">Failed to load data.</div>
  );

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-zinc-50">Today</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          {today ? formatShortDate(today.date) : "No data yet"}
        </p>
      </div>

      {/* Hero — ring + macros */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="flex items-center justify-center py-6">
          <CalorieRing
            calories={today?.calories ?? null}
            protein={today?.protein ?? null}
            carbohydrates={today?.carbohydrates ?? null}
            fat={today?.fat ?? null}
          />
        </Card>

        <Card className="flex flex-col justify-center gap-6">
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
              Macros
            </p>
            <MacroStack today={today} recent={recent7} />
          </div>
          {today?.water != null && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">Water</p>
              <span className="text-xl font-black text-zinc-100">{fmt(today.water, 0)}</span>
              <span className="text-sm text-zinc-500 ml-1">mL</span>
            </div>
          )}
        </Card>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard
          label="Weight"
          value={today?.weight ?? null}
          unit="kg"
          delta={weightDelta7d}
          sparkData={recent30}
          field="weight"
        />
        <StatCard
          label="Steps"
          value={today?.steps ?? null}
          unit=""
          delta={stepsDelta7d}
          sparkData={recent30}
          field="steps"
        />
        <StatCard
          label="Active Energy"
          value={today?.active_energy ?? null}
          unit="kcal"
          sparkData={recent30}
          field="active_energy"
        />
      </div>

      {/* 30-day calorie heatmap */}
      <Card>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
          Calorie Consistency — {rangeDays} days
        </p>
        <CalendarHeatmap data={heatmapData} />
      </Card>

      {/* Recent table */}
      <Card>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Recent days</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500">
                <th className="text-left py-1 pr-3 font-semibold">Date</th>
                <th className="text-right py-1 px-2 font-semibold">Calories</th>
                <th className="text-right py-1 px-2 font-semibold">Protein</th>
                <th className="text-right py-1 px-2 font-semibold">Carbs</th>
                <th className="text-right py-1 px-2 font-semibold">Fat</th>
                <th className="text-right py-1 pl-2 font-semibold">Weight</th>
              </tr>
            </thead>
            <tbody>
              {[...recent7].reverse().map((d) => (
                <tr key={d.date} className="border-t border-zinc-800/60 hover:bg-zinc-800/30 transition-colors">
                  <td className="py-2 pr-3 text-zinc-400">{formatShortDate(d.date)}</td>
                  <td className="py-2 px-2 text-right font-semibold text-zinc-100 tabular-nums">{fmt(d.calories, 0)}</td>
                  <td className="py-2 px-2 text-right text-zinc-300 tabular-nums">{fmt(d.protein, 0)}g</td>
                  <td className="py-2 px-2 text-right text-zinc-300 tabular-nums">{fmt(d.carbohydrates, 0)}g</td>
                  <td className="py-2 px-2 text-right text-zinc-300 tabular-nums">{fmt(d.fat, 0)}g</td>
                  <td className="py-2 pl-2 text-right text-zinc-400 tabular-nums">{fmt(d.weight, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
