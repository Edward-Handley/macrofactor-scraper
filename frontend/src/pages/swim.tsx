import { useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { useSwimAnalytics } from "../hooks/use-performance";
import { isoDate } from "../lib/format";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

function fmtPace(s: number | null | undefined): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}/100m`;
}

function fmtDist(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${m.toFixed(0)} m`;
}

export function Swim() {
  const end = isoDate();
  const start = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 84);
    return d.toISOString().slice(0, 10);
  }, []);

  const { data, isLoading } = useSwimAnalytics(start, end);

  if (isLoading) {
    return <div className="p-6 text-zinc-500 text-sm">Loading swim data…</div>;
  }

  const volData = (data?.weekly_volume ?? []).map((w) => ({
    week: w.week.slice(5),
    dist: w.volume_m,
    sessions: w.sessions,
  }));

  const paceData = (data?.pace_series ?? []).map((p) => ({
    date: p.date.slice(5),
    pace: p.pace_s_per_100m,
  }));

  const swolfData = (data?.swolf_series ?? []).map((p) => ({
    date: p.date.slice(5),
    swolf: p.swolf,
  }));

  const strokeEntries = data?.stroke_mix ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-zinc-100">Swim Analytics</h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card>
          <p className="text-xs text-zinc-500 mb-1">Best Pace</p>
          <p className="text-lg font-bold text-cyan-400">{fmtPace(data?.best_pace_s_per_100m)}</p>
        </Card>
        <Card>
          <p className="text-xs text-zinc-500 mb-1">Total Distance</p>
          <p className="text-lg font-bold text-zinc-100">
            {data?.total_volume_m != null ? fmtDist(data.total_volume_m) : "—"}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-zinc-500 mb-1">Total Sessions</p>
          <p className="text-lg font-bold text-zinc-100">
            {data?.total_sessions ?? "—"}
          </p>
        </Card>
      </div>

      <Card>
        <p className="text-sm font-semibold text-zinc-200 mb-3">Weekly Volume</p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={volData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} />
            <YAxis
              tick={{ fontSize: 10, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8 }}
              formatter={(v: number) => [fmtDist(v), "Distance"]}
              labelStyle={{ color: "#a1a1aa", fontSize: 11 }}
              itemStyle={{ fontSize: 11 }}
            />
            <Bar dataKey="dist" fill="#06b6d4" opacity={0.7} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {paceData.length > 0 && (
        <Card>
          <p className="text-sm font-semibold text-zinc-200 mb-3">Pace / 100m</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={paceData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: "#71717a" }}
                tickLine={false}
                axisLine={false}
                reversed
                tickFormatter={(v) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}`}
              />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8 }}
                formatter={(v: number) => [fmtPace(v), "Pace"]}
                labelStyle={{ color: "#a1a1aa", fontSize: 11 }}
                itemStyle={{ fontSize: 11 }}
              />
              {data?.best_pace_s_per_100m && (
                <ReferenceLine y={data.best_pace_s_per_100m} stroke="#f59e0b" strokeDasharray="4 2" strokeWidth={1} />
              )}
              <Line dataKey="pace" stroke="#06b6d4" dot={false} strokeWidth={2} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {swolfData.length > 0 && (
        <Card>
          <p className="text-sm font-semibold text-zinc-200 mb-1">SWOLF Trend</p>
          <p className="text-xs text-zinc-500 mb-3">Lower = more efficient</p>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={swolfData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} reversed />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8 }}
                labelStyle={{ color: "#a1a1aa", fontSize: 11 }}
                itemStyle={{ fontSize: 11 }}
              />
              <Line dataKey="swolf" name="SWOLF" stroke="#8b5cf6" dot={false} strokeWidth={2} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {strokeEntries.length > 0 && (
        <Card>
          <p className="text-sm font-semibold text-zinc-200 mb-3">Stroke Mix</p>
          <div className="flex flex-col gap-2">
            {[...strokeEntries].sort((a, b) => b.count - a.count).map((e) => {
              const total = strokeEntries.reduce((s, x) => s + x.count, 0);
              const pct = total ? Math.round((e.count / total) * 100) : 0;
              return (
                <div key={e.stroke} className="flex items-center gap-3">
                  <span className="text-xs text-zinc-400 w-24 capitalize">{e.stroke.replace(/_/g, " ")}</span>
                  <div className="flex-1 bg-zinc-800 rounded-full h-2">
                    <div className="bg-cyan-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-zinc-500 w-8 text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
