import { useState, useMemo } from "react";
import { Download } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { useDashboardSummary } from "../hooks/use-dashboard";
import { useCutPhases } from "../hooks/use-daily-log";
import { useDateRange } from "../hooks/use-date-range";
import { TrendChart } from "../components/charts/trend-chart";
import { FIELD_META, ALL_FIELDS } from "../lib/types";
import { fmt, formatShortDate, minutesToDecimalHours, isoDate, offsetDate } from "../lib/format";
import { api } from "../lib/api";
import type { SummaryField, DailySummary } from "../lib/types";
import { linearRegression, forecastTail } from "../lib/projections";

// ─── Types ────────────────────────────────────────────────────────────────────

type TrendsTab = "nutrition" | "garmin" | "correlations";
type ChartRow = Record<string, string | number | null>;

// ─── Garmin constants ────────────────────────────────────────────────────────

const GARMIN_COLORS: Record<string, string> = {
  sleep_minutes:              "#6366f1",
  sleep_score:                "#8b5cf6",
  resting_heart_rate:         "#ef4444",
  hrv_overnight:              "#f59e0b",
  body_battery_high:          "#10b981",
  body_battery_low:           "#34d399",
  body_battery_charged:       "#059669",
  body_battery_drained:       "#f87171",
  stress_avg:                 "#f97316",
  stress_max:                 "#fb923c",
  respiration_avg:            "#06b6d4",
  spo2_avg:                   "#22d3ee",
  spo2_lowest:                "#67e8f9",
  training_readiness_score:   "#a78bfa",
  vo2_max_running:            "#7c3aed",
  vo2_max_cycling:            "#4f46e5",
  intensity_minutes_moderate: "#84cc16",
  intensity_minutes_vigorous: "#16a34a",
  garmin_steps:               "#3b82f6",
  floors_ascended:            "#60a5fa",
  active_calories:            "#fbbf24",
  total_distance_m:           "#f59e0b",
};

interface GarminMetaEntry {
  label: string;
  unit: string;
  decimals: number;
  scale?: (v: number) => number;
}

const GARMIN_META: Record<string, GarminMetaEntry> = {
  sleep_minutes:              { label: "Sleep",            unit: "hrs",       decimals: 1, scale: minutesToDecimalHours },
  sleep_score:                { label: "Sleep Score",      unit: "/100",      decimals: 0 },
  resting_heart_rate:         { label: "RHR",              unit: "bpm",       decimals: 0 },
  hrv_overnight:              { label: "HRV",              unit: "ms",        decimals: 0 },
  body_battery_high:          { label: "BB High",          unit: "%",         decimals: 0 },
  body_battery_low:           { label: "BB Low",           unit: "%",         decimals: 0 },
  body_battery_charged:       { label: "BB Charged",       unit: "%",         decimals: 0 },
  body_battery_drained:       { label: "BB Drained",       unit: "%",         decimals: 0 },
  stress_avg:                 { label: "Stress Avg",       unit: "",          decimals: 0 },
  stress_max:                 { label: "Stress Max",       unit: "",          decimals: 0 },
  respiration_avg:            { label: "Respiration",      unit: "brpm",      decimals: 0 },
  spo2_avg:                   { label: "SpO₂ Avg",   unit: "%",         decimals: 1 },
  spo2_lowest:                { label: "SpO₂ Min",   unit: "%",         decimals: 1 },
  training_readiness_score:   { label: "Readiness",        unit: "/100",      decimals: 0 },
  vo2_max_running:            { label: "VO₂ Max Run", unit: "ml/kg/min", decimals: 1 },
  vo2_max_cycling:            { label: "VO₂ Max Bike",unit: "ml/kg/min", decimals: 1 },
  intensity_minutes_moderate: { label: "Mod. Intensity",   unit: "min",       decimals: 0 },
  intensity_minutes_vigorous: { label: "Vig. Intensity",   unit: "min",       decimals: 0 },
  garmin_steps:               { label: "Steps",            unit: "",          decimals: 0 },
  floors_ascended:            { label: "Floors",           unit: "",          decimals: 0 },
  active_calories:            { label: "Active Cal",       unit: "kcal",      decimals: 0 },
  total_distance_m:           { label: "Distance",         unit: "km",        decimals: 2, scale: (v) => Math.round(v / 10) / 100 },
};

const GARMIN_CATEGORIES: Record<string, string[]> = {
  recovery: ["sleep_minutes", "sleep_score", "resting_heart_rate", "hrv_overnight"],
  wellness: ["body_battery_high", "body_battery_low", "body_battery_charged", "body_battery_drained",
             "stress_avg", "stress_max", "respiration_avg", "spo2_avg", "spo2_lowest"],
  training: ["training_readiness_score", "vo2_max_running", "vo2_max_cycling",
             "intensity_minutes_moderate", "intensity_minutes_vigorous"],
  activity: ["garmin_steps", "floors_ascended", "active_calories", "total_distance_m"],
};

const CATEGORY_ORDER = ["recovery", "wellness", "training", "activity"];
const CATEGORY_LABELS: Record<string, string> = {
  recovery: "Recovery", wellness: "Wellness", training: "Training", activity: "Activity",
};

interface CorrelationPair { garmin: string; nutrition: SummaryField; title: string }
const CORRELATION_PAIRS: CorrelationPair[] = [
  { garmin: "sleep_score",       nutrition: "weight",        title: "Sleep Score × Weight" },
  { garmin: "hrv_overnight",     nutrition: "calories",      title: "HRV × Calories" },
  { garmin: "garmin_steps",      nutrition: "weight",        title: "Steps × Weight" },
  { garmin: "sleep_minutes",     nutrition: "calories",      title: "Sleep Duration × Calories" },
  { garmin: "body_battery_high", nutrition: "active_energy", title: "Body Battery × Active Energy" },
  { garmin: "stress_avg",        nutrition: "calories",      title: "Stress × Calories" },
];
const CORRELATION_GARMIN_METRICS = [...new Set(CORRELATION_PAIRS.map((p) => p.garmin))];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toChartVal(metric: string, raw: number): number {
  const scale = GARMIN_META[metric]?.scale;
  return scale ? scale(raw) : raw;
}

function fmtGarminVal(metric: string, chartVal: number): string {
  const meta = GARMIN_META[metric];
  if (!meta) return String(chartVal);
  const s = chartVal.toFixed(meta.decimals);
  return meta.unit ? `${s} ${meta.unit}` : s;
}

function pearsonR(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : Math.round((num / denom) * 100) / 100;
}

function correlationLabel(r: number): { text: string; cls: string } {
  const abs = Math.abs(r);
  const dir = r > 0 ? "positive" : "negative";
  if (abs >= 0.7) return { text: `r = ${r} (strong ${dir})`, cls: "text-emerald-400" };
  if (abs >= 0.4) return { text: `r = ${r} (moderate ${dir})`, cls: "text-amber-400" };
  return { text: `r = ${r} (weak)`, cls: "text-zinc-500" };
}

function garminStats(points: { value: number }[], metric: string) {
  if (!points.length) return null;
  const vals = points.map((p) => toChartVal(metric, p.value));
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const n = vals.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  vals.forEach((v, i) => { sx += i; sy += v; sxy += i * v; sxx += i * i; });
  const slope = n > 1 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : 0;
  return { avg, min: Math.min(...vals), max: Math.max(...vals), slopePerWeek: slope * 7 };
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

const RANGE_PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

function GarminXTick({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  if (!payload?.value) return null;
  return (
    <text x={x} y={y + 12} textAnchor="middle" fill="#52525b" fontSize={10}>
      {formatShortDate(payload.value)}
    </text>
  );
}

// ─── Nutrition tab ────────────────────────────────────────────────────────────

function fieldStats(data: DailySummary[], field: SummaryField) {
  const vals = data.map((d) => d[field]).filter((v): v is number => v != null);
  if (!vals.length) return null;
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const n = vals.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  vals.forEach((v, i) => { sx += i; sy += v; sxy += i * v; sxx += i * i; });
  const slope = n > 1 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : 0;
  return { avg, min: Math.min(...vals), max: Math.max(...vals), slopePerWeek: slope * 7 };
}

function computeMA(data: DailySummary[], field: SummaryField, window: number): (number | null)[] {
  return data.map((_, i) => {
    const slice = data.slice(Math.max(0, i - window + 1), i + 1);
    const vals = slice.map((d) => d[field]).filter((v): v is number => v != null);
    return vals.length >= Math.min(3, window) ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  });
}

function NutritionTab({
  summaries, isLoading, activeFields, toggleField, showMA, setShowMA, downloadCSV,
}: {
  summaries: DailySummary[];
  isLoading: boolean;
  activeFields: Set<SummaryField>;
  toggleField: (f: SummaryField) => void;
  showMA: boolean;
  setShowMA: (v: boolean | ((p: boolean) => boolean)) => void;
  downloadCSV: () => void;
}) {
  const fields = ALL_FIELDS.filter((f) => activeFields.has(f));
  const showingWeight = activeFields.has("weight");

  // Cut phases + forecast (only when weight is visible)
  const { data: cutData } = useCutPhases();
  const cutPhases = showingWeight ? (cutData?.phases ?? []) : [];
  const TODAY = isoDate();
  const activePhase = cutPhases.find((p) => !p.end_date || p.end_date >= TODAY) ?? null;
  const targetWeight = activePhase?.target_weight_kg ?? null;

  const forecastPoints = useMemo(() => {
    if (!showingWeight || !summaries.length) return undefined;
    const weightPts = summaries
      .filter(d => d.weight != null)
      .slice(-14)
      .map((d, i) => ({ x: i, y: d.weight! }));
    if (weightPts.length < 3) return undefined;
    const reg = linearRegression(weightPts);
    if (!reg) return undefined;
    const lastIdx = weightPts.length - 1;
    const lastDate = summaries.filter(d => d.weight != null).slice(-1)[0]?.date;
    if (!lastDate) return undefined;
    const tail = forecastTail(reg, lastIdx, Math.min(30, 60));
    return tail.slice(1).map((pt, i) => ({
      date: offsetDate(i + 1, new Date(lastDate + "T00:00:00Z")),
      weight_forecast: Math.round(pt.y * 10) / 10,
    }));
  }, [showingWeight, summaries]);

  const maData = useMemo(() => {
    if (!showMA || !summaries.length) return null;
    return Object.fromEntries(fields.map((f) => [f, computeMA(summaries, f, 7)]));
  }, [showMA, summaries, fields]);

  const chartData = useMemo(() => {
    return summaries.map((d, i) => {
      const row: ChartRow = { date: d.date };
      for (const f of fields) {
        row[f] = d[f];
        if (maData) row[`${f}_ma`] = maData[f][i];
      }
      return row;
    });
  }, [summaries, fields, maData]);

  return (
    <>
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex flex-wrap gap-2 flex-1">
          {ALL_FIELDS.map((f) => {
            const meta = FIELD_META[f];
            const active = activeFields.has(f);
            return (
              <button
                key={f}
                onClick={() => toggleField(f)}
                className={[
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                  active
                    ? "text-zinc-900 border-transparent"
                    : "bg-transparent border-zinc-700 text-zinc-500 hover:text-zinc-300",
                ].join(" ")}
                style={active ? { background: meta.color, borderColor: meta.color } : {}}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowMA((v) => !v)}
            className={[
              "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors",
              showMA ? "bg-zinc-700 border-zinc-600 text-zinc-200" : "border-zinc-700 text-zinc-500 hover:text-zinc-300",
            ].join(" ")}
          >
            7d avg
          </button>
          <button
            onClick={downloadCSV}
            disabled={!summaries.length}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-zinc-700 text-zinc-500 hover:text-zinc-200 disabled:opacity-40 rounded-lg text-xs font-semibold transition-colors"
          >
            <Download size={12} /> CSV
          </button>
        </div>
      </div>

      {!isLoading && summaries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {fields.map((f) => {
            const meta = FIELD_META[f];
            const stats = fieldStats(summaries, f);
            if (!stats) return null;
            const trendUp = stats.slopePerWeek > 0;
            const trendNeutral = Math.abs(stats.slopePerWeek) < 0.01;
            return (
              <div key={f} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.color }} />
                  <span className="text-xs font-semibold text-zinc-400">{meta.label}</span>
                </div>
                <p className="text-base font-black text-zinc-100 tabular-nums">
                  {fmt(stats.avg, meta.decimals)}
                  <span className="text-xs text-zinc-500 font-normal ml-1">{meta.unit} avg</span>
                </p>
                <div className="flex items-center justify-between mt-1.5 text-[10px] text-zinc-600">
                  <span>{fmt(stats.min, meta.decimals)}</span>
                  <span className={trendNeutral ? "text-zinc-500" : trendUp ? "text-emerald-400" : "text-red-400"}>
                    {trendNeutral ? "—" : trendUp ? "↑" : "↓"}{" "}
                    {fmt(Math.abs(stats.slopePerWeek), meta.decimals)}/wk
                  </span>
                  <span>{fmt(stats.max, meta.decimals)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Card>
        {isLoading ? (
          <div className="h-72 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          </div>
        ) : summaries.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-16">No data for this range.</p>
        ) : (
          <TrendChart
            rawData={chartData}
            fields={fields}
            maFields={showMA ? fields : []}
            height={320}
            showLegend
            cutPhases={cutPhases}
            forecastPoints={forecastPoints}
            targetWeight={targetWeight}
          />
        )}
      </Card>

      {!isLoading && fields.length > 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fields.map((f) => {
            const meta = FIELD_META[f];
            return (
              <Card key={f}>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                  {meta.label} <span className="normal-case font-normal text-zinc-600">{meta.unit}</span>
                </p>
                <TrendChart rawData={chartData} fields={[f]} maFields={showMA ? [f] : []} height={140} />
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── Garmin tab ───────────────────────────────────────────────────────────────

function GarminTab({ start, end }: { start: string; end: string }) {
  const [activeCat, setActiveCat] = useState("recovery");
  const [activeMetrics, setActiveMetrics] = useState<Set<string>>(
    () => new Set(GARMIN_CATEGORIES.recovery),
  );

  function selectCategory(cat: string) {
    setActiveCat(cat);
    setActiveMetrics(new Set(GARMIN_CATEGORIES[cat] ?? []));
  }

  function toggleMetric(m: string) {
    setActiveMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(m)) { if (next.size > 1) next.delete(m); }
      else next.add(m);
      return next;
    });
  }

  const metricList = GARMIN_CATEGORIES[activeCat] ?? [];
  const activeList = metricList.filter((m) => activeMetrics.has(m));
  const [primary, ...secondary] = activeList;

  const seriesResults = useQueries({
    queries: metricList.map((m) => ({
      queryKey: ["garmin-series", m, start, end],
      queryFn: () => api.garmin.series(m, { start, end }),
      staleTime: 300_000,
      enabled: activeMetrics.has(m),
    })),
  });

  const seriesByMetric = useMemo(() => {
    const map: Record<string, { date: string; value: number }[]> = {};
    metricList.forEach((m, i) => {
      if (!seriesResults[i]?.data) return;
      map[m] = seriesResults[i].data!.points;
    });
    return map;
  }, [seriesResults, metricList]);

  const chartData = useMemo(() => {
    const dateIndex: Record<string, ChartRow> = {};
    activeList.forEach((m) => {
      (seriesByMetric[m] ?? []).forEach((p) => {
        if (!dateIndex[p.date]) dateIndex[p.date] = { date: p.date };
        dateIndex[p.date][m] = toChartVal(m, p.value);
      });
    });
    return Object.values(dateIndex).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [seriesByMetric, activeList]);

  const isLoading = seriesResults.some((r) => r.isFetching);
  const hasData = chartData.length > 0;

  return (
    <>
      {/* Category selector */}
      <div className="flex gap-2 flex-wrap">
        {CATEGORY_ORDER.map((cat) => (
          <button
            key={cat}
            onClick={() => selectCategory(cat)}
            className={[
              "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors",
              activeCat === cat
                ? "bg-zinc-700 border-zinc-600 text-zinc-100"
                : "border-zinc-700 text-zinc-500 hover:text-zinc-300",
            ].join(" ")}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Metric toggles */}
      <div className="flex flex-wrap gap-2">
        {metricList.map((m) => {
          const active = activeMetrics.has(m);
          const color = GARMIN_COLORS[m] ?? "#6366f1";
          return (
            <button
              key={m}
              onClick={() => toggleMetric(m)}
              className={[
                "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                active
                  ? "text-zinc-900 border-transparent"
                  : "bg-transparent border-zinc-700 text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
              style={active ? { background: color, borderColor: color } : {}}
            >
              {GARMIN_META[m]?.label ?? m}
            </button>
          );
        })}
      </div>

      {/* Stats grid */}
      {!isLoading && activeList.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {activeList.map((m) => {
            const pts = seriesByMetric[m] ?? [];
            const stats = garminStats(pts, m);
            if (!stats) return null;
            const meta = GARMIN_META[m];
            const color = GARMIN_COLORS[m] ?? "#6366f1";
            const trendUp = stats.slopePerWeek > 0;
            const trendNeutral = Math.abs(stats.slopePerWeek) < 0.001;
            return (
              <div key={m} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-xs font-semibold text-zinc-400">{meta?.label ?? m}</span>
                </div>
                <p className="text-base font-black text-zinc-100 tabular-nums">
                  {stats.avg.toFixed(meta?.decimals ?? 0)}
                  <span className="text-xs text-zinc-500 font-normal ml-1">{meta?.unit} avg</span>
                </p>
                <div className="flex items-center justify-between mt-1.5 text-[10px] text-zinc-600">
                  <span>{stats.min.toFixed(meta?.decimals ?? 0)}</span>
                  <span className={trendNeutral ? "text-zinc-500" : trendUp ? "text-emerald-400" : "text-red-400"}>
                    {trendNeutral ? "—" : trendUp ? "↑" : "↓"}{" "}
                    {Math.abs(stats.slopePerWeek).toFixed(meta?.decimals ?? 0)}/wk
                  </span>
                  <span>{stats.max.toFixed(meta?.decimals ?? 0)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Main chart */}
      <Card>
        {isLoading ? (
          <div className="h-72 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          </div>
        ) : !hasData ? (
          <p className="text-zinc-500 text-sm text-center py-16">No Garmin data for this range. Try syncing on the Health tab.</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={<GarminXTick />} axisLine={false} tickLine={false} minTickGap={40} />
              <YAxis
                yAxisId="left"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#52525b", fontSize: 10 }}
                width={36}
              />
              {secondary.length > 0 && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#52525b", fontSize: 10 }}
                  width={36}
                />
              )}
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs shadow-xl space-y-1">
                      <p className="text-zinc-400">{label ? formatShortDate(label as string) : ""}</p>
                      {payload.map((entry) => {
                        const m = String(entry.dataKey);
                        return (
                          <div key={m} className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: entry.color }} />
                            <span className="text-zinc-300">{GARMIN_META[m]?.label ?? m}:</span>
                            <span className="font-semibold text-zinc-100 tabular-nums">
                              {fmtGarminVal(m, entry.value as number)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                }}
              />
              {primary && (
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey={primary}
                  stroke={GARMIN_COLORS[primary] ?? "#6366f1"}
                  fill={GARMIN_COLORS[primary] ?? "#6366f1"}
                  fillOpacity={0.12}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              )}
              {secondary.map((m) => (
                <Line
                  key={m}
                  yAxisId="right"
                  type="monotone"
                  dataKey={m}
                  stroke={GARMIN_COLORS[m] ?? "#6366f1"}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Per-metric mini charts */}
      {!isLoading && hasData && activeList.length > 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {activeList.map((m) => {
            const pts = seriesByMetric[m] ?? [];
            if (!pts.length) return null;
            const color = GARMIN_COLORS[m] ?? "#6366f1";
            const meta = GARMIN_META[m];
            const miniData = pts.map((p) => ({ date: p.date, value: toChartVal(m, p.value) }));
            return (
              <Card key={m}>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                  {meta?.label ?? m}{" "}
                  <span className="normal-case font-normal text-zinc-600">{meta?.unit}</span>
                </p>
                <ResponsiveContainer width="100%" height={120}>
                  <ComposedChart data={miniData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={<GarminXTick />} axisLine={false} tickLine={false} minTickGap={50} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#52525b", fontSize: 10 }} width={32} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 shadow">
                            {label ? formatShortDate(label as string) : ""}:{" "}
                            {fmtGarminVal(m, payload[0]?.value as number)}
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={color}
                      fill={color}
                      fillOpacity={0.1}
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── Correlations tab ─────────────────────────────────────────────────────────

function CorrelationsTab({ summaries, start, end }: { summaries: DailySummary[]; start: string; end: string }) {
  const garminResults = useQueries({
    queries: CORRELATION_GARMIN_METRICS.map((m) => ({
      queryKey: ["garmin-series", m, start, end],
      queryFn: () => api.garmin.series(m, { start, end }),
      staleTime: 300_000,
    })),
  });

  const garminByDate = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    CORRELATION_GARMIN_METRICS.forEach((m, i) => {
      const r = garminResults[i];
      if (!r.data) return;
      result[m] = {};
      r.data.points.forEach((pt) => {
        result[m][pt.date] = toChartVal(m, pt.value);
      });
    });
    return result;
  }, [garminResults]);

  const isLoading = garminResults.some((r) => r.isFetching);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-500 py-8">
        <div className="w-4 h-4 rounded-full border border-zinc-500 border-t-transparent animate-spin" />
        Loading correlation data…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {CORRELATION_PAIRS.map(({ garmin, nutrition, title }) => {
        const gByDate = garminByDate[garmin] ?? {};
        const nMeta = FIELD_META[nutrition];
        const gMeta = GARMIN_META[garmin];
        const gColor = GARMIN_COLORS[garmin] ?? "#6366f1";

        const pairs = summaries
          .map((d) => ({ date: d.date, g: gByDate[d.date] ?? null, n: d[nutrition] }))
          .filter((d): d is { date: string; g: number; n: number } => d.g != null && d.n != null);

        const r = pairs.length >= 5 ? pearsonR(pairs.map((d) => d.g), pairs.map((d) => d.n)) : null;
        const rLabel = r != null ? correlationLabel(r) : null;
        const chartData = pairs.map((d) => ({ date: d.date, garmin: d.g, nutrition: d.n }));

        return (
          <Card key={title}>
            <div className="flex items-start justify-between mb-3 gap-2">
              <p className="text-xs font-semibold text-zinc-300">{title}</p>
              {rLabel && (
                <span className={`text-[10px] font-medium shrink-0 ${rLabel.cls}`}>{rLabel.text}</span>
              )}
            </div>
            {pairs.length < 5 ? (
              <p className="text-xs text-zinc-600 py-8 text-center">Not enough overlapping data.</p>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-2 text-[10px]">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ background: gColor }} />
                    <span className="text-zinc-500">{gMeta?.label ?? garmin} (L)</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ background: nMeta.color }} />
                    <span className="text-zinc-500">{nMeta.label} (R)</span>
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={<GarminXTick />} axisLine={false} tickLine={false} minTickGap={50} />
                    <YAxis
                      yAxisId="g"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: gColor, fontSize: 9 }}
                      width={28}
                    />
                    <YAxis
                      yAxisId="n"
                      orientation="right"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: nMeta.color, fontSize: 9 }}
                      width={28}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-[10px] shadow-xl space-y-1">
                            <p className="text-zinc-400">{label ? formatShortDate(label as string) : ""}</p>
                            {payload.map((entry) => (
                              <div key={String(entry.dataKey)} className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: entry.color }} />
                                <span className="text-zinc-300">
                                  {entry.dataKey === "garmin"
                                    ? `${gMeta?.label ?? garmin}: ${fmtGarminVal(garmin, entry.value as number)}`
                                    : `${nMeta.label}: ${fmt(entry.value as number, nMeta.decimals)} ${nMeta.unit}`}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                    <Area
                      yAxisId="g"
                      type="monotone"
                      dataKey="garmin"
                      stroke={gColor}
                      fill={gColor}
                      fillOpacity={0.1}
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                    />
                    <Line
                      yAxisId="n"
                      type="monotone"
                      dataKey="nutrition"
                      stroke={nMeta.color}
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function Trends() {
  const [tab, setTab] = useState<TrendsTab>("nutrition");
  const { start, end, setRange } = useDateRange(30);
  const { data: summary, isLoading } = useDashboardSummary(start, end);
  const [activeFields, setActiveFields] = useState<Set<SummaryField>>(
    new Set(["calories", "weight"] as SummaryField[]),
  );
  const [showMA, setShowMA] = useState(false);
  const summaries = summary?.summaries ?? [];

  function toggleField(f: SummaryField) {
    setActiveFields((prev) => {
      const next = new Set(prev);
      if (next.has(f)) { if (next.size > 1) next.delete(f); }
      else next.add(f);
      return next;
    });
  }

  function applyPreset(days: number) {
    const eDate = new Date(end + "T00:00:00");
    const sDate = new Date(eDate);
    sDate.setDate(sDate.getDate() - (days - 1));
    setRange(sDate.toISOString().slice(0, 10), end);
  }

  function downloadCSV() {
    if (!summaries.length) return;
    const keys = ["date", ...ALL_FIELDS];
    const header = keys.join(",");
    const body = summaries
      .map((d) =>
        keys
          .map((k) => {
            const v = d[k as keyof DailySummary];
            return v == null ? "" : String(v);
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trends-${start}-${end}.csv`;
    a.click();
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-black text-zinc-50">Trends</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {RANGE_PRESETS.map(({ label, days }) => (
            <button
              key={label}
              onClick={() => applyPreset(days)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 transition-colors"
            >
              {label}
            </button>
          ))}
          <input
            type="date"
            value={start}
            max={end}
            onChange={(e) => setRange(e.target.value, end)}
            className="text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-zinc-300"
          />
          <span className="text-zinc-600 text-xs">{"→"}</span>
          <input
            type="date"
            value={end}
            min={start}
            onChange={(e) => setRange(start, e.target.value)}
            className="text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-zinc-300"
          />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-zinc-800">
        {(["nutrition", "garmin", "correlations"] as TrendsTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              "px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px capitalize",
              tab === t
                ? "border-emerald-500 text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-300",
            ].join(" ")}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "nutrition" && (
        <NutritionTab
          summaries={summaries}
          isLoading={isLoading}
          activeFields={activeFields}
          toggleField={toggleField}
          showMA={showMA}
          setShowMA={setShowMA}
          downloadCSV={downloadCSV}
        />
      )}
      {tab === "garmin" && <GarminTab start={start} end={end} />}
      {tab === "correlations" && (
        <CorrelationsTab summaries={summaries} start={start} end={end} />
      )}
    </div>
  );
}
