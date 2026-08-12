import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useActivity } from "../hooks/use-activities";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, Cell,
} from "recharts";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-sm font-semibold text-zinc-100">{value ?? "—"}</p>
    </div>
  );
}

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtPace(s: number | null | undefined): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}/100m`;
}

function fmtDist(m: number | null | undefined): string {
  if (!m) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(0)} m`;
}

const ZONE_COLORS = ["#6b7280", "#22c55e", "#eab308", "#f97316", "#ef4444"];
const ZONE_LABELS = ["Z1", "Z2", "Z3", "Z4", "Z5"];

export function ActivityDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: activity, isLoading } = useActivity(+(id ?? 0));

  if (isLoading) {
    return <div className="p-6 text-zinc-500 text-sm">Loading…</div>;
  }

  if (!activity) {
    return <div className="p-6 text-zinc-500 text-sm">Activity not found.</div>;
  }

  const hrZones = activity.hr_zones ?? [];
  const lapsData = activity.laps_data ?? [];

  const hrChartData = hrZones.map((z, i) => ({
    zone: ZONE_LABELS[i] ?? `Z${z.zone}`,
    secs: z.secs,
    mins: +(z.secs / 60).toFixed(1),
  }));

  const lapChartData = lapsData
    .filter((l) => l.pace_s_per_100m)
    .map((l) => ({
      lap: l.lap,
      pace: l.pace_s_per_100m,
    }));

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
      >
        <ArrowLeft size={14} />
        Back
      </button>

      <div>
        <h1 className="text-xl font-bold text-zinc-100 capitalize">
          {activity.sport.replace(/_/g, " ")}
        </h1>
        <p className="text-sm text-zinc-500">
          {new Date(activity.activity_date + "T12:00:00").toLocaleDateString(undefined, {
            weekday: "long", year: "numeric", month: "long", day: "numeric",
          })}
          {activity.start_time ? ` · ${activity.start_time.slice(0, 5)}` : ""}
        </p>
      </div>

      <Card>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Duration" value={activity.duration_seconds != null ? fmtDuration(activity.duration_seconds) : null} />
          <Stat label="Distance" value={fmtDist(activity.distance_m)} />
          <Stat label="Training Load" value={activity.training_load?.toFixed(0)} />
          <Stat label="Calories" value={activity.calories?.toFixed(0)} />
          <Stat label="Avg HR" value={activity.avg_hr ? `${activity.avg_hr.toFixed(0)} bpm` : null} />
          <Stat label="Max HR" value={activity.max_hr ? `${activity.max_hr.toFixed(0)} bpm` : null} />
          <Stat label="Aerobic TE" value={activity.aerobic_te?.toFixed(1)} />
          <Stat label="Anaerobic TE" value={activity.anaerobic_te?.toFixed(1)} />
        </div>
      </Card>

      {(activity.avg_swolf || activity.avg_pace_s_per_100m) && (
        <Card>
          <p className="text-sm font-semibold text-zinc-200 mb-3">Swim Stats</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Avg Pace" value={fmtPace(activity.avg_pace_s_per_100m)} />
            <Stat label="SWOLF" value={activity.avg_swolf?.toFixed(0)} />
            <Stat label="Laps" value={activity.laps} />
            <Stat label="Total Strokes" value={activity.total_strokes} />
            <Stat label="Pool Length" value={activity.pool_length_m ? `${activity.pool_length_m}m` : null} />
            <Stat label="Stroke" value={activity.stroke_type} />
          </div>
        </Card>
      )}

      {activity.rpe != null && (
        <Card>
          <p className="text-sm font-semibold text-zinc-200 mb-3">Effort</p>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="RPE" value={`${activity.rpe}/10`} />
            <Stat label="Load source" value={activity.load_source} />
          </div>
        </Card>
      )}

      {hrChartData.length > 0 && (
        <Card>
          <p className="text-sm font-semibold text-zinc-200 mb-3">HR Zones</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={hrChartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <XAxis dataKey="zone" tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: "#71717a" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${Math.round(v / 60)}m`}
              />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8 }}
                formatter={(v: number) => [`${(v / 60).toFixed(1)}m`, "Time"]}
                labelStyle={{ color: "#a1a1aa", fontSize: 11 }}
                itemStyle={{ fontSize: 11 }}
              />
              <Bar dataKey="secs" radius={[3, 3, 0, 0]}>
                {hrChartData.map((_, i) => (
                  <Cell key={i} fill={ZONE_COLORS[i] ?? "#6b7280"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {lapChartData.length > 1 && lapChartData.every((p) => p.pace != null) && (
        <Card>
          <p className="text-sm font-semibold text-zinc-200 mb-3">Pace per Lap</p>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={lapChartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <XAxis dataKey="lap" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: "#71717a" }}
                tickLine={false}
                axisLine={false}
                reversed
                tickFormatter={(v: number) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}`}
              />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8 }}
                formatter={(v: number) => [`${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}/100m`, "Pace"]}
                labelStyle={{ color: "#a1a1aa", fontSize: 11 }}
                itemStyle={{ fontSize: 11 }}
              />
              <Line dataKey="pace" stroke="#06b6d4" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {lapsData.length > 0 && (
        <Card>
          <p className="text-sm font-semibold text-zinc-200 mb-3">Lap Detail</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-zinc-400">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500">
                  <th className="text-left py-1.5 pr-3 font-medium">Lap</th>
                  <th className="text-right py-1.5 pr-3 font-medium">Dist</th>
                  <th className="text-right py-1.5 pr-3 font-medium">Pace</th>
                  <th className="text-right py-1.5 pr-3 font-medium">SWOLF</th>
                  <th className="text-right py-1.5 font-medium">Strokes</th>
                </tr>
              </thead>
              <tbody>
                {lapsData.map((l) => (
                  <tr key={l.lap} className="border-b border-zinc-800/50 last:border-0">
                    <td className="py-1.5 pr-3">{l.lap}</td>
                    <td className="text-right py-1.5 pr-3">
                      {l.distance_m ? `${l.distance_m.toFixed(0)}m` : "—"}
                    </td>
                    <td className="text-right py-1.5 pr-3">
                      {l.pace_s_per_100m
                        ? `${Math.floor(l.pace_s_per_100m / 60)}:${String(Math.round(l.pace_s_per_100m % 60)).padStart(2, "0")}`
                        : "—"}
                    </td>
                    <td className="text-right py-1.5 pr-3">{l.swolf?.toFixed(0) ?? "—"}</td>
                    <td className="text-right py-1.5">{l.strokes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activity.notes && (
        <Card>
          <p className="text-xs text-zinc-500 mb-1">Notes</p>
          <p className="text-sm text-zinc-300">{activity.notes}</p>
        </Card>
      )}
    </div>
  );
}
