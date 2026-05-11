import { useState } from "react";
import { useDashboardSummary } from "../hooks/use-dashboard";
import { useDateRange } from "../hooks/use-date-range";
import { TrendChart } from "../components/charts/trend-chart";
import { FIELD_META, ALL_FIELDS } from "../lib/types";
import type { SummaryField } from "../lib/types";

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

export function Trends() {
  const { start, end, setRange } = useDateRange(30);
  const { data: summary, isLoading } = useDashboardSummary(start, end);
  const [activeFields, setActiveFields] = useState<Set<SummaryField>>(
    new Set(["calories", "weight"] as SummaryField[])
  );

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
    const e = end;
    const eDate = new Date(e + "T00:00:00");
    const sDate = new Date(eDate);
    sDate.setDate(sDate.getDate() - (days - 1));
    setRange(sDate.toISOString().slice(0, 10), e);
  }

  const fields = ALL_FIELDS.filter((f) => activeFields.has(f));

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
          <span className="text-zinc-600 text-xs">→</span>
          <input
            type="date"
            value={end}
            min={start}
            onChange={(e) => setRange(start, e.target.value)}
            className="text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-zinc-300"
          />
        </div>
      </div>

      {/* Field toggles */}
      <div className="flex flex-wrap gap-2">
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

      {/* Main chart */}
      <Card>
        {isLoading ? (
          <div className="h-72 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          </div>
        ) : summaries.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-16">No data for this range.</p>
        ) : (
          <TrendChart data={summaries} fields={fields} height={320} showLegend />
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
                <TrendChart data={summaries} fields={[f]} height={140} />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
