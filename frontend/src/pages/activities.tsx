import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, RefreshCw, Pencil, Trash2 } from "lucide-react";
import { useActivities, useCreateActivity, useUpdateActivity, useDeleteActivity, useSyncActivities } from "../hooks/use-activities";
import type { Activity, ActivityCreate } from "../lib/types";
import { isoDate } from "../lib/format";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

const SPORTS = [
  "swimming", "water_polo", "running", "cycling", "gym_strength", "walking",
  "open_water_swimming", "triathlon", "rowing", "other",
];

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtDist(m: number | null | undefined): string {
  if (!m) return "";
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(0)} m`;
}

function sportColor(sport: string): string {
  if (sport.includes("swim")) return "text-cyan-400 bg-cyan-500/10";
  if (sport === "water_polo") return "text-blue-400 bg-blue-500/10";
  if (sport === "running") return "text-amber-400 bg-amber-500/10";
  if (sport === "cycling") return "text-lime-400 bg-lime-500/10";
  return "text-zinc-400 bg-zinc-700/40";
}

function ActivityModal({
  initial,
  onSubmit,
  onClose,
}: {
  initial?: Partial<ActivityCreate>;
  onSubmit: (data: ActivityCreate) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ActivityCreate>({
    sport: initial?.sport ?? "swimming",
    activity_date: initial?.activity_date ?? isoDate(),
    start_time: initial?.start_time ?? "",
    duration_minutes: initial?.duration_minutes ?? 60,
    distance_m: initial?.distance_m ?? null,
    rpe: initial?.rpe ?? null,
    perceived_intensity: initial?.perceived_intensity ?? null,
    notes: initial?.notes ?? "",
  });

  const set = <K extends keyof ActivityCreate>(k: K, v: ActivityCreate[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-zinc-100">Log Activity</h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Sport</label>
            <select
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
              value={form.sport}
              onChange={(e) => set("sport", e.target.value)}
            >
              {SPORTS.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Date</label>
              <input
                type="date"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
                value={form.activity_date}
                onChange={(e) => set("activity_date", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Duration (min)</label>
              <input
                type="number"
                min={1}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
                value={form.duration_minutes}
                onChange={(e) => set("duration_minutes", +e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Distance (m)</label>
              <input
                type="number"
                min={0}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
                value={form.distance_m ?? ""}
                onChange={(e) => set("distance_m", e.target.value ? +e.target.value : null)}
                placeholder="optional"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">RPE (1–10)</label>
              <input
                type="number"
                min={1}
                max={10}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500"
                value={form.rpe ?? ""}
                onChange={(e) => set("rpe", e.target.value ? +e.target.value : null)}
                placeholder="optional"
              />
            </div>
          </div>

          {form.rpe != null && form.duration_minutes && (
            <p className="text-xs text-zinc-500">
              Session load: {Math.round(form.duration_minutes * form.rpe)} AU
            </p>
          )}

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Notes</label>
            <textarea
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500 resize-none"
              rows={2}
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Optional notes…"
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(form)}
            className="px-3 py-1.5 rounded-lg text-xs bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const update = useUpdateActivity();
  const del = useDeleteActivity();

  return (
    <>
      {editing && (
        <ActivityModal
          initial={activity}
          onSubmit={(data) => update.mutate({ id: activity.id, data }, { onSuccess: () => setEditing(false) })}
          onClose={() => setEditing(false)}
        />
      )}
      <div
        className="flex items-center gap-3 py-2.5 px-1 rounded-xl hover:bg-zinc-800/50 cursor-pointer transition-colors"
        onClick={() => navigate(`/activities/${activity.id}`)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full capitalize ${sportColor(activity.sport)}`}>
              {activity.sport.replace(/_/g, " ")}
            </span>
            {activity.source === "manual" && (
              <span className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded-full">manual</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-zinc-400 flex-wrap">
            {activity.duration_seconds && <span>{fmtDuration(activity.duration_seconds)}</span>}
            {activity.distance_m && <span>{fmtDist(activity.distance_m)}</span>}
            {activity.training_load && <span>{activity.training_load.toFixed(0)} AU</span>}
            {activity.avg_swolf && <span>SWOLF {activity.avg_swolf.toFixed(0)}</span>}
            {activity.avg_pace_s_per_100m && (
              <span>
                {Math.floor(activity.avg_pace_s_per_100m / 60)}:{String(Math.round(activity.avg_pace_s_per_100m % 60)).padStart(2, "0")}/100m
              </span>
            )}
          </div>
        </div>
        {activity.source === "manual" && (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={() => del.mutate(activity.id)}
              className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-zinc-700 transition-colors"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export function Activities() {
  const [sport, setSport] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const end = isoDate();
  const start = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 56);
    return d.toISOString().slice(0, 10);
  }, []);

  const { data, isLoading } = useActivities({ start, end, sport: sport || undefined });
  const sync = useSyncActivities();
  const create = useCreateActivity();

  const grouped = useMemo(() => {
    const acts = data?.activities ?? [];
    const map = new Map<string, Activity[]>();
    for (const a of acts) {
      const key = a.activity_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  const sportChips = ["", "swimming", "water_polo", "running", "cycling", "gym_strength"];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
      {showCreate && (
        <ActivityModal
          onSubmit={(d) => create.mutate(d, { onSuccess: () => setShowCreate(false) })}
          onClose={() => setShowCreate(false)}
        />
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-zinc-100">Activities</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => sync.mutate(7)}
            disabled={sync.isPending}
            className="p-2 rounded-xl text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title="Sync from Garmin"
          >
            <RefreshCw size={15} className={sync.isPending ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors"
          >
            <Plus size={13} />
            Log
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {sportChips.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSport(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              sport === s
                ? "bg-cyan-500/20 text-cyan-400"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {s ? s.replace(/_/g, " ") : "All"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-zinc-500 text-sm">Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="text-center text-zinc-500 text-sm py-12">No activities found.</div>
      ) : (
        <div className="space-y-3">
          {grouped.map(([date, acts]) => (
            <Card key={date}>
              <p className="text-xs text-zinc-500 font-medium mb-2">
                {new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </p>
              <div className="divide-y divide-zinc-800">
                {acts.map((a) => <ActivityRow key={a.id} activity={a} />)}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
