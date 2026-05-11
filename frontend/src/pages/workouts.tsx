import { useMemo, useState } from "react";
import { Activity, Dumbbell, FileUp, Flame, Loader2, Scale, Trophy, TrendingUp, Upload, Utensils } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  useImportStrongCsv,
  useStrongAnalytics,
  useStrongExercise,
  useStrongImports,
  useStrongSessions,
  useStrongSummary,
} from "../hooks/use-dashboard";
import { fmt, formatShortDate, isoDate } from "../lib/format";
import type { StrongAnalyticsResponse, StrongExerciseSummary, StrongExerciseTaxonomy, StrongSessionRecord, StrongWeeklyLoad } from "../lib/types";

const RANGE_PRESETS = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "180d", days: 180 },
  { label: "All", days: 3650 },
];

const SORT_OPTIONS = [
  { value: "recent_pr", label: "Recent PR" },
  { value: "volume", label: "Volume" },
  { value: "last_performed", label: "Last done" },
  { value: "estimated_1rm_delta", label: "1RM delta" },
] as const;

type ExerciseSort = typeof SORT_OPTIONS[number]["value"];

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

function Stat({ label, value, unit, Icon }: {
  label: string;
  value: string;
  unit?: string;
  Icon: LucideIcon;
}) {
  return (
    <Card className="min-h-28">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{label}</span>
        <Icon size={16} className="text-emerald-400" />
      </div>
      <div className="mt-5 flex items-end gap-1.5">
        <span className="text-2xl font-black text-zinc-50 tabular-nums leading-none">{value}</span>
        {unit && <span className="text-sm text-zinc-500">{unit}</span>}
      </div>
    </Card>
  );
}

function offset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days + 1);
  return isoDate(d);
}

function duration(seconds: number | null | undefined): string {
  if (!seconds) return "-";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function UploadPanel() {
  const imports = useStrongImports();
  const upload = useImportStrongCsv();
  const latest = imports.data?.imports[0];

  async function onFile(file: File | null) {
    if (!file) return;
    await upload.mutateAsync(file);
  }

  return (
    <Card>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Strong CSV import</p>
          <p className="text-sm text-zinc-400">
            Upload the full Strong export. Rows before nutrition history are ignored and repeated exports dedupe automatically.
          </p>
          {latest && (
            <p className="text-xs text-zinc-600 mt-2">
              Last import {formatShortDate(latest.uploaded_at?.slice(0, 10) ?? latest.nutrition_start_date ?? "")}:{" "}
              {latest.sets_inserted.toLocaleString()} new sets, {latest.duplicate_sets.toLocaleString()} duplicates
            </p>
          )}
        </div>
        <label className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-zinc-950 text-sm font-bold hover:bg-emerald-400 cursor-pointer transition-colors">
          {upload.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          Upload CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => onFile(event.target.files?.[0] ?? null)}
            disabled={upload.isPending}
          />
        </label>
      </div>
      {upload.isSuccess && (
        <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          Imported {upload.data.sets_inserted.toLocaleString()} new sets across {upload.data.sessions_inserted.toLocaleString()} sessions.
          {upload.data.rows_ignored_before_nutrition > 0 && ` Ignored ${upload.data.rows_ignored_before_nutrition.toLocaleString()} older rows.`}
        </div>
      )}
      {upload.isError && (
        <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {(upload.error as Error).message}
        </div>
      )}
    </Card>
  );
}

function WeeklyChart({ data }: { data: StrongWeeklyLoad[] }) {
  const rows = data.map((row) => ({
    week: formatShortDate(row.week_start),
    volume: Math.round(row.total_volume),
    sessions: row.session_count,
    prs: row.pr_count,
    protein: row.avg_protein == null ? null : Math.round(row.avg_protein),
  }));
  return (
    <ResponsiveContainer width="100%" height={230}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="week" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={28} />
        <YAxis yAxisId="left" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
        <YAxis yAxisId="right" orientation="right" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
        <Tooltip
          contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, color: "#fafafa", fontSize: 12 }}
          labelStyle={{ color: "#a1a1aa" }}
        />
        <Bar yAxisId="left" dataKey="volume" fill="var(--color-protein)" radius={[3, 3, 0, 0]} fillOpacity={0.75} />
        <Line yAxisId="right" type="monotone" dataKey="sessions" stroke="var(--color-calories)" strokeWidth={2} dot={false} />
        <Line yAxisId="right" type="monotone" dataKey="prs" stroke="var(--color-fat)" strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function GroupBalanceChart({ analytics }: { analytics: StrongAnalyticsResponse }) {
  const rows = analytics.group_balance.slice(0, 8).map((row) => ({
    name: row.group,
    volume: Math.round(row.total_volume),
    sets: row.working_sets,
    prs: row.estimated_1rm_prs,
  }));
  return (
    <ResponsiveContainer width="100%" height={230}>
      <ComposedChart data={rows} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="#27272a" strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} width={88} />
        <Tooltip
          contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, color: "#fafafa", fontSize: 12 }}
          labelStyle={{ color: "#a1a1aa" }}
        />
        <Bar dataKey="volume" fill="var(--color-active)" radius={[0, 3, 3, 0]} fillOpacity={0.75} />
        <Line type="monotone" dataKey="prs" stroke="var(--color-fat)" strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function NutritionScatter({ analytics }: { analytics: StrongAnalyticsResponse }) {
  const rows = analytics.nutrition_training_days
    .filter((day) => day.calories != null || day.protein != null)
    .map((day) => ({
      date: formatShortDate(day.date),
      volume: Math.round(day.session_volume),
      calories: day.calories,
      protein: day.protein,
      prs: day.pr_count,
    }));
  const proteinVolume = analytics.nutrition_correlations.find(
    (item) => item.nutrient === "protein" && item.driver === "session_volume" && item.timing === "same_day"
  );
  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={230}>
        <ScatterChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
          <XAxis dataKey="volume" name="Volume" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis dataKey="protein" name="Protein" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
          <Tooltip
            cursor={{ stroke: "#52525b", strokeDasharray: "3 3" }}
            contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, color: "#fafafa", fontSize: 12 }}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""}
          />
          <Scatter dataKey="protein" name="Protein">
            {rows.map((row) => (
              <Cell key={row.date} fill={row.prs > 0 ? "var(--color-fat)" : "var(--color-protein)"} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-zinc-500">Protein vs volume correlation</span>
        <span className="font-bold text-zinc-100 tabular-nums">{fmt(proteinVolume?.correlation, 2)}</span>
      </div>
    </div>
  );
}

function ExerciseList({
  exercises,
  selected,
  onSelect,
}: {
  exercises: StrongExerciseSummary[];
  selected: string | null;
  onSelect: (exercise: string) => void;
}) {
  return (
    <Card className="min-h-[420px]">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Exercise progress</p>
        <span className="text-xs text-zinc-600">{exercises.length} exercises</span>
      </div>
      <div className="space-y-2 max-h-[580px] overflow-y-auto pr-1">
        {exercises.slice(0, 40).map((exercise) => {
          const active = selected === exercise.exercise_name;
          return (
            <button
              key={exercise.exercise_name}
              onClick={() => onSelect(exercise.exercise_name)}
              className={`w-full text-left rounded-xl border p-3 transition-colors ${
                active ? "border-emerald-500/60 bg-emerald-500/10" : "border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/30"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{exercise.exercise_name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {exercise.sessions} sessions · {exercise.working_sets} sets · {fmt(exercise.total_volume, 0)} kg volume
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-zinc-100 tabular-nums">{fmt(exercise.best_estimated_1rm, 1)}</p>
                  <p className="text-[10px] text-zinc-600">est 1RM</p>
                </div>
              </div>
              {exercise.estimated_1rm_delta != null && Math.abs(exercise.estimated_1rm_delta) > 0.1 && (
                <p className={`text-xs font-semibold mt-2 ${exercise.estimated_1rm_delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {exercise.estimated_1rm_delta > 0 ? "+" : ""}{fmt(exercise.estimated_1rm_delta, 1)} kg recent change
                </p>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function AdvancedExerciseList({
  exercises,
  taxonomy,
  groupFilter,
  sortBy,
  onGroupFilter,
  onSort,
  selected,
  onSelect,
}: {
  exercises: StrongExerciseSummary[];
  taxonomy: Record<string, StrongExerciseTaxonomy>;
  groupFilter: string;
  sortBy: ExerciseSort;
  onGroupFilter: (group: string) => void;
  onSort: (sort: ExerciseSort) => void;
  selected: string | null;
  onSelect: (exercise: string) => void;
}) {
  const groups = useMemo(
    () => ["All", ...Array.from(new Set(exercises.map((exercise) => taxonomy[exercise.exercise_name]?.primary_group ?? "Other"))).sort()],
    [exercises, taxonomy]
  );
  const visibleExercises = useMemo(() => {
    const filtered = groupFilter === "All"
      ? exercises
      : exercises.filter((exercise) => (taxonomy[exercise.exercise_name]?.primary_group ?? "Other") === groupFilter);
    return [...filtered].sort((a, b) => {
      if (sortBy === "volume") return b.total_volume - a.total_volume;
      if (sortBy === "last_performed") return String(b.last_performed ?? "").localeCompare(String(a.last_performed ?? ""));
      if (sortBy === "estimated_1rm_delta") return (b.estimated_1rm_delta ?? -Infinity) - (a.estimated_1rm_delta ?? -Infinity);
      return Number((b.estimated_1rm_delta ?? 0) > 0) - Number((a.estimated_1rm_delta ?? 0) > 0)
        || String(b.last_performed ?? "").localeCompare(String(a.last_performed ?? ""));
    });
  }, [exercises, groupFilter, sortBy, taxonomy]);

  return (
    <Card className="min-h-[420px]">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Exercise progress</p>
          <span className="text-xs text-zinc-600">{visibleExercises.length} / {exercises.length} exercises</span>
        </div>
        <div className="flex gap-2">
          <select
            value={groupFilter}
            onChange={(event) => onGroupFilter(event.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300"
          >
            {groups.map((group) => <option key={group} value={group}>{group}</option>)}
          </select>
          <select
            value={sortBy}
            onChange={(event) => onSort(event.target.value as ExerciseSort)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300"
          >
            {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>
      <div className="space-y-2 max-h-[580px] overflow-y-auto pr-1">
        {visibleExercises.slice(0, 50).map((exercise) => {
          const active = selected === exercise.exercise_name;
          const exerciseTaxonomy = taxonomy[exercise.exercise_name] ?? { primary_group: "Other", movement_pattern: "Other", secondary_groups: [] };
          return (
            <button
              key={exercise.exercise_name}
              onClick={() => onSelect(exercise.exercise_name)}
              className={`w-full text-left rounded-xl border p-3 transition-colors ${
                active ? "border-emerald-500/60 bg-emerald-500/10" : "border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/30"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{exercise.exercise_name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {exercise.sessions} sessions / {exercise.working_sets} sets / {fmt(exercise.total_volume, 0)} kg volume
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
                      {exerciseTaxonomy.primary_group}
                    </span>
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
                      {exerciseTaxonomy.movement_pattern}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-zinc-100 tabular-nums">{fmt(exercise.best_estimated_1rm, 1)}</p>
                  <p className="text-[10px] text-zinc-600">est 1RM</p>
                </div>
              </div>
              {exercise.estimated_1rm_delta != null && Math.abs(exercise.estimated_1rm_delta) > 0.1 && (
                <p className={`text-xs font-semibold mt-2 ${exercise.estimated_1rm_delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {exercise.estimated_1rm_delta > 0 ? "+" : ""}{fmt(exercise.estimated_1rm_delta, 1)} kg recent change
                </p>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function ExerciseDetail({ exerciseName, start, end }: { exerciseName: string | null; start: string; end: string }) {
  const detail = useStrongExercise(exerciseName, start, end);
  const points = detail.data?.points.map((point) => ({
    date: formatShortDate(point.date),
    est1rm: point.best_estimated_1rm,
    volume: point.total_volume,
  })) ?? [];

  return (
    <Card className="min-h-[420px]">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
        {exerciseName ?? "Exercise detail"}
      </p>
      {!exerciseName ? (
        <div className="h-72 flex items-center justify-center text-sm text-zinc-500">Select an exercise.</div>
      ) : detail.isLoading ? (
        <div className="h-72 flex items-center justify-center">
          <Loader2 size={22} className="animate-spin text-emerald-400" />
        </div>
      ) : (
        <div className="space-y-4">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={28} />
              <YAxis tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} width={38} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, color: "#fafafa", fontSize: 12 }}
                labelStyle={{ color: "#a1a1aa" }}
              />
              <Bar dataKey="volume" fill="var(--color-carbs)" fillOpacity={0.2} radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="est1rm" stroke="var(--color-protein)" strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {detail.data?.sessions.slice(0, 8).map((session) => (
              <div key={session.id} className="rounded-xl border border-zinc-800 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-zinc-100">{formatShortDate(session.workout_date)}</p>
                  <p className="text-xs text-zinc-500">{session.working_set_count} working sets</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {session.sets.filter((set) => set.exercise_name === exerciseName).map((set) => (
                    <span key={set.id} className="rounded-lg bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
                      {set.is_warmup ? "W " : ""}{fmt(set.weight, 1)} x {fmt(set.reps, 0)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function SessionTable({ sessions }: { sessions: StrongSessionRecord[] }) {
  return (
    <Card>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Recent sessions</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="text-left py-2 pr-3 font-semibold">Date</th>
              <th className="text-left py-2 px-2 font-semibold">Workout</th>
              <th className="text-right py-2 px-2 font-semibold">Sets</th>
              <th className="text-right py-2 px-2 font-semibold">Volume</th>
              <th className="text-right py-2 pl-2 font-semibold">Duration</th>
            </tr>
          </thead>
          <tbody>
            {sessions.slice(0, 20).map((session) => (
              <tr key={session.id} className="border-t border-zinc-800/60 hover:bg-zinc-800/30 transition-colors">
                <td className="py-2 pr-3 text-zinc-400">{formatShortDate(session.workout_date)}</td>
                <td className="py-2 px-2">
                  <p className="font-semibold text-zinc-100">{session.workout_name}</p>
                  <p className="text-zinc-600">{session.exercise_count} exercises</p>
                </td>
                <td className="py-2 px-2 text-right text-zinc-300 tabular-nums">{session.working_set_count}</td>
                <td className="py-2 px-2 text-right text-zinc-300 tabular-nums">{fmt(session.total_volume, 0)} kg</td>
                <td className="py-2 pl-2 text-right text-zinc-400 tabular-nums">{duration(session.duration_seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AdvancedSessionTable({
  sessions,
  taxonomy,
  prCountByDate,
}: {
  sessions: StrongSessionRecord[];
  taxonomy: Record<string, StrongExerciseTaxonomy>;
  prCountByDate: Map<string, number>;
}) {
  return (
    <Card>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Recent sessions</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="text-left py-2 pr-3 font-semibold">Date</th>
              <th className="text-left py-2 px-2 font-semibold">Workout</th>
              <th className="text-left py-2 px-2 font-semibold">Groups</th>
              <th className="text-left py-2 px-2 font-semibold">Preview</th>
              <th className="text-right py-2 px-2 font-semibold">Sets</th>
              <th className="text-right py-2 px-2 font-semibold">Volume</th>
              <th className="text-right py-2 pl-2 font-semibold">Duration</th>
            </tr>
          </thead>
          <tbody>
            {sessions.slice(0, 20).map((session) => {
              const groups = Array.from(new Set(session.sets.map((set) => taxonomy[set.exercise_name]?.primary_group ?? "Other"))).slice(0, 3);
              const preview = session.sets.filter((set) => !set.is_warmup).slice(0, 3);
              const prCount = prCountByDate.get(session.workout_date) ?? 0;
              return (
                <tr key={session.id} className="border-t border-zinc-800/60 hover:bg-zinc-800/30 transition-colors">
                  <td className="py-2 pr-3 text-zinc-400">{formatShortDate(session.workout_date)}</td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-zinc-100">{session.workout_name}</p>
                      {prCount > 0 && <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">{prCount} PR</span>}
                    </div>
                    <p className="text-zinc-600">{session.exercise_count} exercises</p>
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex flex-wrap gap-1">
                      {groups.map((group) => <span key={group} className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{group}</span>)}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-zinc-500">
                    {preview.map((set) => `${set.exercise_name} ${fmt(set.weight, 0)}x${fmt(set.reps, 0)}`).join(" / ")}
                  </td>
                  <td className="py-2 px-2 text-right text-zinc-300 tabular-nums">{session.working_set_count}</td>
                  <td className="py-2 px-2 text-right text-zinc-300 tabular-nums">{fmt(session.total_volume, 0)} kg</td>
                  <td className="py-2 pl-2 text-right text-zinc-400 tabular-nums">{duration(session.duration_seconds)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function Workouts() {
  const [start, setStart] = useState(offset(89));
  const [end, setEnd] = useState(isoDate());
  const summary = useStrongSummary(start, end);
  const analytics = useStrongAnalytics(start, end);
  const sessions = useStrongSessions(start, end);
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState("All");
  const [sortBy, setSortBy] = useState<ExerciseSort>("recent_pr");

  const topExercises = summary.data?.exercises ?? [];
  const taxonomy = analytics.data?.exercise_taxonomy ?? {};
  const effectiveSelected = selectedExercise ?? topExercises[0]?.exercise_name ?? null;
  const strongestPr = summary.data?.recent_prs[0];

  const sessionsPerWeek = useMemo(() => {
    const weeks = summary.data?.weekly.length ?? 0;
    return weeks ? (summary.data!.session_count / weeks).toFixed(1) : "0.0";
  }, [summary.data]);

  const trainingRestCalorieDelta = useMemo(() => {
    const delta = analytics.data?.recovery_load_markers.training_rest_deltas.find((item) => item.metric === "calories");
    return delta?.delta ?? null;
  }, [analytics.data]);

  const loadTrend = useMemo(() => {
    const weeks = analytics.data?.weekly_load ?? [];
    if (weeks.length < 2) return null;
    const previous = weeks[weeks.length - 2].total_volume;
    const current = weeks[weeks.length - 1].total_volume;
    return current - previous;
  }, [analytics.data]);

  const prCountByDate = useMemo(() => new Map(
    (analytics.data?.nutrition_training_days ?? []).map((day) => [day.date, day.pr_count])
  ), [analytics.data]);

  function applyPreset(days: number) {
    setEnd(isoDate());
    setStart(days > 1000 && summary.data?.nutrition_start_date ? summary.data.nutrition_start_date : offset(days - 1));
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-zinc-50">Workouts</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Strong training progress with nutrition context</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset.days)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 transition-colors"
            >
              {preset.label}
            </button>
          ))}
          <input
            type="date"
            value={start}
            max={end}
            onChange={(event) => setStart(event.target.value)}
            className="text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-zinc-300"
          />
          <input
            type="date"
            value={end}
            min={start}
            onChange={(event) => setEnd(event.target.value)}
            className="text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-zinc-300"
          />
        </div>
      </div>

      <UploadPanel />

      {summary.isLoading || analytics.isLoading ? (
        <div className="h-72 flex items-center justify-center">
          <Loader2 size={26} className="animate-spin text-emerald-400" />
        </div>
      ) : !summary.data || summary.data.session_count === 0 ? (
        <Card>
          <div className="py-16 text-center">
            <FileUp size={28} className="mx-auto text-zinc-600 mb-3" />
            <p className="text-sm text-zinc-400">No Strong workouts in this range.</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Stat label="Sessions / week" value={sessionsPerWeek} Icon={Dumbbell} />
            <Stat label="Volume" value={fmt(analytics.data?.totals.total_volume ?? summary.data.total_volume, 0)} unit="kg" Icon={Trophy} />
            <Stat
              label="PRs"
              value={fmt(analytics.data?.totals.pr_count, 0)}
              Icon={Flame}
            />
            <Stat
              label="Training protein"
              value={fmt(summary.data.nutrition.training_avg_protein, 0)}
              unit="g/day"
              Icon={Utensils}
            />
            <Stat
              label="Calorie delta"
              value={trainingRestCalorieDelta == null ? "—" : `${trainingRestCalorieDelta > 0 ? "+" : ""}${fmt(trainingRestCalorieDelta, 0)}`}
              unit="vs rest"
              Icon={Scale}
            />
            <Stat
              label="Load trend"
              value={loadTrend == null ? "—" : `${loadTrend > 0 ? "+" : ""}${fmt(loadTrend, 0)}`}
              unit="kg"
              Icon={TrendingUp}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
            <Card>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Weekly load</p>
                {strongestPr && (
                  <span className="text-xs text-emerald-400 font-semibold">
                    Recent PR: {strongestPr.exercise_name} {fmt(strongestPr.estimated_1rm, 1)} kg
                  </span>
                )}
              </div>
              <WeeklyChart data={analytics.data?.weekly_load ?? []} />
            </Card>

            <Card>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Nutrition context</p>
              <div className="space-y-3">
                {[
                  ["Calories", summary.data.nutrition.training_avg_calories, summary.data.nutrition.rest_avg_calories, "kcal"],
                  ["Protein", summary.data.nutrition.training_avg_protein, summary.data.nutrition.rest_avg_protein, "g"],
                  ["Weight", summary.data.nutrition.training_avg_weight, summary.data.nutrition.rest_avg_weight, "kg"],
                  ["Active energy", summary.data.nutrition.training_avg_active_energy, summary.data.nutrition.rest_avg_active_energy, "kcal"],
                ].map(([label, training, rest, unit]) => (
                  <div key={String(label)} className="grid grid-cols-[1fr_auto_auto] gap-3 items-baseline">
                    <span className="text-sm text-zinc-400">{label}</span>
                    <span className="text-sm font-bold text-zinc-100 tabular-nums">{fmt(training as number | null, unit === "kg" ? 1 : 0)} {unit}</span>
                    <span className="text-xs text-zinc-600 tabular-nums">rest {fmt(rest as number | null, unit === "kg" ? 1 : 0)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {analytics.data && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Nutrition vs training load</p>
                <NutritionScatter analytics={analytics.data} />
              </Card>
              <Card>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Movement balance</p>
                <GroupBalanceChart analytics={analytics.data} />
              </Card>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AdvancedExerciseList
              exercises={topExercises}
              taxonomy={taxonomy}
              groupFilter={groupFilter}
              sortBy={sortBy}
              onGroupFilter={setGroupFilter}
              onSort={setSortBy}
              selected={effectiveSelected}
              onSelect={setSelectedExercise}
            />
            <ExerciseDetail exerciseName={effectiveSelected} start={start} end={end} />
          </div>

          <AdvancedSessionTable sessions={sessions.data?.sessions ?? []} taxonomy={taxonomy} prCountByDate={prCountByDate} />
        </>
      )}
    </div>
  );
}
