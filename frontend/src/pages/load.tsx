import { useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceArea, Legend,
} from "recharts";
import { useTrainingLoad } from "../hooks/use-performance";
import { isoDate } from "../lib/format";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    optimal: "bg-emerald-500/15 text-emerald-400",
    caution: "bg-amber-500/15 text-amber-400",
    high_risk: "bg-red-500/15 text-red-400",
    detraining: "bg-zinc-700/40 text-zinc-400",
  };
  const label: Record<string, string> = {
    optimal: "Optimal",
    caution: "Caution",
    high_risk: "High Risk",
    detraining: "Detraining",
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${map[status] ?? "bg-zinc-800 text-zinc-400"}`}>
      {label[status] ?? status}
    </span>
  );
}

export function Load() {
  const end = isoDate();
  const start = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 42);
    return d.toISOString().slice(0, 10);
  }, []);

  const { data, isLoading } = useTrainingLoad(start, end);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.series.map((p) => ({
      date: p.date.slice(5),
      load: p.load,
      atl: p.atl != null ? +p.atl.toFixed(1) : null,
      ctl: p.ctl != null ? +p.ctl.toFixed(1) : null,
      acwr: p.acwr != null ? +p.acwr.toFixed(2) : null,
    }));
  }, [data]);

  const lastPoint = data?.series.at(-1);
  const acwr = data?.current_acwr;
  const atl = lastPoint?.atl;
  const ctl = lastPoint?.ctl;
  const status = data?.status ?? "detraining";

  if (isLoading) {
    return (
      <div className="p-6 text-zinc-500 text-sm">Loading load data…</div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-zinc-100">Training Load</h1>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <p className="text-xs text-zinc-500 mb-1">ATL (7d)</p>
          <p className="text-2xl font-bold text-cyan-400">{atl?.toFixed(0) ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-xs text-zinc-500 mb-1">CTL (28d)</p>
          <p className="text-2xl font-bold text-violet-400">{ctl?.toFixed(0) ?? "—"}</p>
        </Card>
        <Card className="flex flex-col gap-1">
          <p className="text-xs text-zinc-500">ACWR</p>
          <p className="text-2xl font-bold text-zinc-100">{acwr?.toFixed(2) ?? "—"}</p>
          <StatusBadge status={status} />
        </Card>
      </div>

      <Card>
        <p className="text-sm font-semibold text-zinc-200 mb-3">Load + ATL / CTL (42 days)</p>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8 }}
              labelStyle={{ color: "#a1a1aa", fontSize: 11 }}
              itemStyle={{ fontSize: 11 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="load" name="Daily Load" fill="#06b6d4" opacity={0.6} radius={[2, 2, 0, 0]} />
            <Line dataKey="atl" name="ATL" stroke="#06b6d4" dot={false} strokeWidth={2} connectNulls />
            <Line dataKey="ctl" name="CTL" stroke="#8b5cf6" dot={false} strokeWidth={2} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <Card>
        <p className="text-sm font-semibold text-zinc-200 mb-3">ACWR with optimal band</p>
        <ResponsiveContainer width="100%" height={160}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} domain={[0, "auto"]} />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8 }}
              labelStyle={{ color: "#a1a1aa", fontSize: 11 }}
              itemStyle={{ fontSize: 11 }}
            />
            <ReferenceArea y1={0.8} y2={1.3} fill="#22c55e" fillOpacity={0.08} />
            <ReferenceLine y={1.5} stroke="#ef4444" strokeDasharray="4 2" strokeWidth={1} />
            <ReferenceLine y={0.8} stroke="#22c55e" strokeDasharray="4 2" strokeWidth={1} />
            <ReferenceLine y={1.3} stroke="#22c55e" strokeDasharray="4 2" strokeWidth={1} />
            <Line dataKey="acwr" name="ACWR" stroke="#f59e0b" dot={false} strokeWidth={2} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="mt-2 flex gap-4 text-[10px] text-zinc-500">
          <span><span className="text-emerald-400">■</span> Optimal 0.8–1.3</span>
          <span><span className="text-amber-400">■</span> Caution 1.3–1.5</span>
          <span><span className="text-red-400">■</span> High Risk &gt;1.5</span>
        </div>
      </Card>
    </div>
  );
}
