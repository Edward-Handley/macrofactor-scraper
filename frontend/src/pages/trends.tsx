import { useState, useMemo } from "react";
import { Download } from "lucide-react";
import { useDashboardSummary } from "../hooks/use-dashboard";
import { useDateRange } from "../hooks/use-date-range";
import { TrendChart } from "../components/charts/trend-chart";
import { FIELD_META, ALL_FIELDS } from "../lib/types";
import { fmt, isoDate } from "../lib/format";
import type { SummaryField, DailySummary } from "../lib/types";

const RANGE_PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

function fieldStats(data: DailySummary[], field: SummaryField) {
  const vals = data.map(d => d[field]).filter((v): v is number => v != null);
  if (!vals.length) return null;
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  // simple linear regression slope per day
  const n = vals.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  vals.forEach((v, i) => { sx += i; sy += v; sxy += i * v; sxx += i * i; });
  const slope = n > 1 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : 0;
  return { avg, min, max, slopePerWeek: slope * 7 };
}

function computeMA(data: DailySummary[], field: SummaryField, window: number): (number | null)[] {
  return data.map((_, i) => {
    const slice = data.slice(Math.max(0, i - window + 1), i + 1);
    const vals = slice.map(d => d[field]).filter((v): v is number => v != null);
    return vals.length >= Math.min(3, window) ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  });
}

export function Trends() {
  const { start, end, setRange } = useDateRange(30);
  const { data: summary, isLoading } = useDashboardSummary(start, end);
  const [activeFields, setActiveFields] = useState<Set<SummaryField>>(
    new Set(["calories", "weight"] as SummaryField[])
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

  const fields = ALL_FIELDS.filter((f) => activeFields.has(f));

  const maData = useMemo(() => {
    if (!showMA || !summaries.length) return null;
    return Object.fromEntries(
      fields.map(f => [f, computeMA(summaries, f, 7)])
    );
  }, [showMA, summaries, fields]);

  const chartData = useMemo(() => {
    return summaries.map((d, i) => {
      const row: Record<string, string | number | null> = { date: d.date };
      for (const f of fields) {
        row[f] = d[f];
        if (maData) row[`${f}_ma`] = maData[f][i];
      }
      return row;
    });
  }, [summaries, fields, maData]);

  function downloadCSV() {
    if (!summaries.length) return;
    const keys = ["date", ...ALL_FIELDS];
    const header = keys.join(",");
    const body = summaries.map(d =>
      keys.map(k => {
        const v = d[k as keyof DailySummary];
        return v == null ? "" : String(v);
      }).join(",")
    ).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trends-${start}-${end}.csv`;
    a.click();
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl mx-auto">
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
          <span className="text-zinc-600 text-xs">{"->"}</span>
          <input
            type="date"
            value={end}
            min={start}
            onChange={(e) => setRange(start, e.target.value)}
            className="text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-zinc-300"
          />
        </div>
      </div>

      {/* Field toggles + controls */}
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
            onClick={() => setShowMA(v => !v)}
            className={[
              "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors",
              showMA
                ? "bg-zinc-700 border-zinc-600 text-zinc-200"
                : "border-zinc-700 text-zinc-500 hover:text-zinc-300",
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

      {/* Stats summary */}
      {!isLoading && summaries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {fields.map(f => {
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
                  <span>down{fmt(stats.min, meta.decimals)}</span>
                  <span className={trendNeutral ? "text-zinc-500" : trendUp ? "text-emerald-400" : "text-red-400"}>
                    {trendNeutral ? "->" : trendUp ? "up" : "down"} {fmt(Math.abs(stats.slopePerWeek), meta.decimals)}/wk
                  </span>
                  <span>up{fmt(stats.max, meta.decimals)}</span>
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
        ) : summaries.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-16">No data for this range.</p>
        ) : (
          <TrendChart
            rawData={chartData}
            fields={fields}
            maFields={showMA ? fields : []}
            height={320}
            showLegend
          />
        )}
      </Card>

      {/* Per-field mini charts */}
      {!isLoading && fields.length > 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fields.map((f) => {
            const meta = FIELD_META[f];
            return (
              <Card key={f}>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                  {meta.label} <span className="normal-case font-normal text-zinc-600">{meta.unit}</span>
                </p>
                <TrendChart
                  rawData={chartData}
                  fields={[f]}
                  maFields={showMA ? [f] : []}
                  height={140}
                />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
