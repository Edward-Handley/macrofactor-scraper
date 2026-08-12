import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useActivities } from "../hooks/use-activities";
import {
  useTrainingLoad, useFueling, useDailyRecommendation,
  usePerformanceReviews, useGenerateReview,
} from "../hooks/use-performance";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isoDate } from "../lib/format";
import { RefreshCw } from "lucide-react";
import type { Activity } from "../lib/types";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

function statusColor(status: string): string {
  if (status === "optimal") return "text-emerald-400";
  if (status === "caution") return "text-amber-400";
  if (status === "high_risk") return "text-red-400";
  return "text-zinc-500";
}

function statusLabel(status: string): string {
  if (status === "optimal") return "Optimal";
  if (status === "caution") return "Caution";
  if (status === "high_risk") return "High Risk";
  return "Detraining";
}

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function sportBadge(sport: string): string {
  if (sport.includes("swim")) return "text-cyan-400 bg-cyan-500/10";
  if (sport === "water_polo") return "text-blue-400 bg-blue-500/10";
  if (sport === "running") return "text-amber-400 bg-amber-500/10";
  if (sport === "cycling") return "text-lime-400 bg-lime-500/10";
  return "text-zinc-400 bg-zinc-700/40";
}

function AcwrGauge({ acwr, status }: { acwr: number | null | undefined; status: string }) {
  const pct = acwr != null ? Math.min(acwr / 2, 1) : 0;
  const color = status === "optimal" ? "#22c55e"
    : status === "caution" ? "#f59e0b"
    : status === "high_risk" ? "#ef4444"
    : "#52525b";

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-24 h-12 overflow-hidden">
        <div className="absolute inset-0 rounded-t-full border-4 border-zinc-800" />
        <div
          className="absolute inset-0 rounded-t-full border-4 transition-all"
          style={{
            borderColor: color,
            clipPath: `polygon(0 100%, ${pct * 100}% 100%, ${pct * 100}% 0, 0 0)`,
          }}
        />
      </div>
      <span className={`text-2xl font-bold ${statusColor(status)}`}>
        {acwr?.toFixed(2) ?? "—"}
      </span>
      <span className={`text-xs font-semibold ${statusColor(status)}`}>{statusLabel(status)}</span>
    </div>
  );
}

function ActivityItem({ a }: { a: Activity }) {
  const navigate = useNavigate();
  return (
    <div
      className="flex items-center gap-3 py-2 cursor-pointer hover:bg-zinc-800/50 rounded-xl px-1 transition-colors"
      onClick={() => navigate(`/activities/${a.id}`)}
    >
      <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full capitalize shrink-0 ${sportBadge(a.sport)}`}>
        {a.sport.replace(/_/g, " ")}
      </span>
      {a.duration_seconds != null && <span className="text-xs text-zinc-400 shrink-0">{fmtDuration(a.duration_seconds)}</span>}
      {a.training_load && (
        <span className="text-xs text-zinc-500 shrink-0">{a.training_load.toFixed(0)} AU</span>
      )}
      <span className="text-xs text-zinc-600 ml-auto shrink-0">{a.activity_date.slice(5)}</span>
    </div>
  );
}

export function Performance() {
  const today = isoDate();
  const start7 = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  }, []);
  const start28 = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 28);
    return d.toISOString().slice(0, 10);
  }, []);

  const { data: loadData } = useTrainingLoad(start28, today);
  const { data: activities } = useActivities({ start: start7, end: today });
  const { data: fueling } = useFueling(today);
  const { data: rec } = useDailyRecommendation(today);
  const { data: reviews } = usePerformanceReviews();
  const generateReview = useGenerateReview();

  const { data: readiness } = useQuery({
    queryKey: ["readiness", today],
    queryFn: () => api.insights.readiness(today),
    staleTime: 300_000,
  });

  const chartData = useMemo(() => {
    if (!loadData) return [];
    return loadData.series.slice(-14).map((p) => ({
      date: p.date.slice(5),
      load: p.load,
    }));
  }, [loadData]);

  const recentActivities = (activities?.activities ?? []).slice(0, 5);
  const latestReview = reviews?.reviews?.[0];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-zinc-100">Performance</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="flex flex-col gap-2">
          <p className="text-xs text-zinc-500 font-medium">Readiness</p>
          {readiness ? (
            <>
              <p className="text-3xl font-bold text-cyan-400">{readiness.score ?? "—"}</p>
              <p className="text-xs text-zinc-400 line-clamp-2">{readiness.summary ?? ""}</p>
            </>
          ) : (
            <p className="text-zinc-600 text-sm">—</p>
          )}
        </Card>

        <Card className="flex flex-col items-center justify-center">
          <p className="text-xs text-zinc-500 font-medium mb-2">ACWR</p>
          <AcwrGauge acwr={loadData?.current_acwr} status={loadData?.status ?? "detraining"} />
        </Card>

        <Card>
          <p className="text-xs text-zinc-500 font-medium mb-2">Fueling</p>
          {fueling ? (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-xs text-zinc-400">Calories</span>
                <span className="text-sm font-semibold text-zinc-100">
                  {fueling.calories?.toFixed(0) ?? "—"} kcal
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-zinc-400">Protein</span>
                <span className="text-sm font-semibold text-zinc-100">
                  {fueling.protein?.toFixed(0) ?? "—"}g
                </span>
              </div>
              {fueling.training_load != null && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-400">Yesterday load</span>
                  <span className="text-sm font-semibold text-zinc-100">{fueling.training_load.toFixed(0)} AU</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-zinc-600 text-sm">—</p>
          )}
        </Card>
      </div>

      {rec && (
        <Card>
          <p className="text-xs text-zinc-500 font-medium mb-2">Today's Recommendation</p>
          <p className="text-sm text-zinc-300 leading-relaxed">{rec.recommendation}</p>
        </Card>
      )}

      {chartData.length > 0 && (
        <Card>
          <p className="text-sm font-semibold text-zinc-200 mb-3">14-Day Load</p>
          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={chartData} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#71717a" }} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: "#71717a" }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8 }}
                labelStyle={{ color: "#a1a1aa", fontSize: 11 }}
                itemStyle={{ fontSize: 11 }}
              />
              <Bar dataKey="load" fill="#06b6d4" opacity={0.7} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {recentActivities.length > 0 && (
        <Card>
          <p className="text-sm font-semibold text-zinc-200 mb-2">Recent Activities</p>
          <div className="divide-y divide-zinc-800/50">
            {recentActivities.map((a) => <ActivityItem key={a.id} a={a} />)}
          </div>
        </Card>
      )}

      {latestReview ? (
        <Card>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-zinc-200">Weekly Review</p>
            <span className="text-xs text-zinc-600">{latestReview.week_start_date}</span>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed line-clamp-4">{latestReview.narrative}</p>
          {latestReview.highlights?.length > 0 && (
            <ul className="mt-2 space-y-1">
              {latestReview.highlights.map((h, i) => (
                <li key={i} className="text-xs text-zinc-500 flex gap-1.5">
                  <span className="text-cyan-400 shrink-0">·</span>
                  {h}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <Card className="flex items-center justify-between">
          <p className="text-sm text-zinc-500">No weekly review yet</p>
          <button
            type="button"
            onClick={() => generateReview.mutate(undefined)}
            disabled={generateReview.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition-colors"
          >
            <RefreshCw size={12} className={generateReview.isPending ? "animate-spin" : ""} />
            Generate
          </button>
        </Card>
      )}
    </div>
  );
}
