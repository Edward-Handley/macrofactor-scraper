import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LineChart, Line, ResponsiveContainer, Tooltip,
} from "recharts";
import { api } from "../lib/api";
import { isoDate } from "../lib/format";
import { useGarminCategories } from "../hooks/use-dashboard";
import type { GarminSeriesPoint } from "../lib/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

function formatValue(metric: string, val: number | undefined, units: Record<string, string>): string {
  if (val === undefined || val === null) return "—";
  if (metric === "sleep_minutes") {
    const h = Math.floor(val / 60);
    const m = Math.round(val % 60);
    return `${h}h ${m}m`;
  }
  if (metric === "total_distance_m") return `${(val / 1000).toFixed(2)} km`;
  const decimals = units[metric] === "ml/kg/min" ? 1 : 0;
  return val.toFixed(decimals);
}

function labelFor(metric: string): string {
  return metric
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace("Hrv", "HRV")
    .replace("Spo2", "SpO₂")
    .replace("Vo2", "VO₂");
}

// ─── Sparkline ───────────────────────────────────────────────────────────────

function Sparkline({ metric, days }: { metric: string; days: number }) {
  const { data } = useQuery({
    queryKey: ["garmin-series", metric, { days }],
    queryFn: () => api.garmin.series(metric, { days }),
    staleTime: 300_000,
  });

  const points = data?.points ?? [];
  if (points.length < 2) {
    return <div className="h-12 flex items-center justify-center text-[10px] text-zinc-600">no history</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={points}>
        <Line
          type="monotone"
          dataKey="value"
          stroke="#10b981"
          strokeWidth={1.5}
          dot={false}
          connectNulls
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const pt = payload[0].payload as GarminSeriesPoint;
            return (
              <div className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 shadow">
                {pt.date}: {pt.value}
              </div>
            );
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Metric card ─────────────────────────────────────────────────────────────

function MetricCard({
  metric,
  value,
  units,
  days,
}: {
  metric: string;
  value: number | undefined;
  units: Record<string, string>;
  days: number;
}) {
  const unit = metric === "sleep_minutes" || metric === "total_distance_m" ? "" : (units[metric] ?? "");
  const displayVal = formatValue(metric, value, units);

  return (
    <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3 flex flex-col gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{labelFor(metric)}</p>
      <p className="text-xl font-bold text-zinc-100 tabular-nums leading-none">
        {displayVal}
        {unit && displayVal !== "—" && (
          <span className="text-xs font-normal text-zinc-500 ml-1">{unit}</span>
        )}
      </p>
      <Sparkline metric={metric} days={days} />
    </div>
  );
}

// ─── Category section ─────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  recovery: "Recovery",
  wellness: "Wellness",
  training: "Training",
  activity: "Activity",
};

function CategorySection({
  category,
  metrics,
  values,
  units,
  days,
}: {
  category: string;
  metrics: string[];
  values: Record<string, number>;
  units: Record<string, string>;
  days: number;
}) {
  const hasAny = metrics.some((m) => values[m] !== undefined);
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
          {CATEGORY_LABELS[category] ?? category}
        </h2>
        {!hasAny && (
          <span className="text-[10px] text-zinc-600 bg-zinc-800 rounded px-1.5 py-0.5">no data yet</span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <MetricCard key={m} metric={m} value={values[m]} units={units} days={days} />
        ))}
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TODAY = isoDate();
const CATEGORY_ORDER = ["recovery", "wellness", "training", "activity"];

export function Health() {
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const qc = useQueryClient();

  const { data: categories } = useGarminCategories();
  const { data: garminStatus } = useQuery({
    queryKey: ["garmin-status"],
    queryFn: api.garmin.status,
    staleTime: 60_000,
  });
  const { data: values = {}, isLoading: valuesLoading } = useQuery({
    queryKey: ["garmin-values", selectedDate],
    queryFn: () => api.garmin.values(selectedDate),
    staleTime: 120_000,
  });

  const sync = useMutation({
    mutationFn: () => api.garmin.sync(selectedDate),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["garmin-values", selectedDate] });
      qc.invalidateQueries({ queryKey: ["garmin-series"] });
      qc.invalidateQueries({ queryKey: ["garmin-status"] });
    },
  });

  const cat = categories?.categories ?? {};
  const units = categories?.units ?? {};
  const orderedCategories = CATEGORY_ORDER.filter((c) => c in cat);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={selectedDate}
          max={TODAY}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <button
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors"
        >
          <RefreshCw size={12} className={sync.isPending ? "animate-spin" : ""} />
          Sync Garmin
        </button>

        {/* Status pill */}
        {garminStatus && (
          <span
            className={`text-[10px] font-medium px-2 py-1 rounded-full ${
              garminStatus.configured
                ? garminStatus.last_error
                  ? "bg-red-900/40 text-red-400 border border-red-800"
                  : "bg-emerald-900/40 text-emerald-400 border border-emerald-800"
                : "bg-zinc-800 text-zinc-500 border border-zinc-700"
            }`}
          >
            {garminStatus.configured
              ? garminStatus.last_error
                ? `Error: ${garminStatus.last_error.slice(0, 60)}`
                : garminStatus.last_sync_at
                  ? `Synced ${garminStatus.last_sync_at.slice(0, 16).replace("T", " ")}`
                  : "Configured — never synced"
              : "Garmin not configured"}
          </span>
        )}
      </div>

      {valuesLoading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <div className="w-3 h-3 rounded-full border border-zinc-500 border-t-transparent animate-spin" />
          Loading…
        </div>
      )}

      {sync.isSuccess && (
        <Card className="border-emerald-800/50 bg-emerald-900/10">
          <p className="text-xs text-emerald-400">Sync complete. New data available.</p>
        </Card>
      )}

      {orderedCategories.map((catKey) => (
        <CategorySection
          key={catKey}
          category={catKey}
          metrics={cat[catKey] ?? []}
          values={values}
          units={units}
          days={30}
        />
      ))}

      {orderedCategories.length === 0 && !valuesLoading && (
        <Card>
          <p className="text-sm text-zinc-500">No Garmin categories loaded. Check backend connection.</p>
        </Card>
      )}
    </div>
  );
}
