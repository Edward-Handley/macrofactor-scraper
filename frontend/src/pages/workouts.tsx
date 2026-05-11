import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  FileUp,
  Loader2,
  Pin,
  Save,
  Settings2,
  SlidersHorizontal,
  Trophy,
  Upload,
  X,
} from "lucide-react";
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
  usePreferences,
  useStrongAnalytics,
  useStrongExercise,
  useStrongImports,
  useStrongSession,
  useStrongSessions,
  useStrongSummary,
  useUpdatePreferences,
} from "../hooks/use-dashboard";
import { fmt, formatShortDate, isoDate } from "../lib/format";
import type {
  Preferences,
  StrongAnalyticsResponse,
  StrongDailyLoad,
  StrongExerciseSummary,
  StrongExerciseTaxonomy,
  StrongSessionRecord,
  StrongWeeklyGroupLoad,
  WorkoutPreferences,
  WorkoutTab,
} from "../lib/types";

const TABS: WorkoutTab[] = ["Overview", "Sessions", "Exercises", "Nutrition", "Customize"];
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
const CARD_OPTIONS = [
  { id: "sessions", label: "Sessions" },
  { id: "volume", label: "Volume" },
  { id: "prs", label: "PRs" },
  { id: "protein", label: "Protein" },
  { id: "calorie_delta", label: "Calorie delta" },
  { id: "load_trend", label: "Load trend" },
];
const CHART_OPTIONS = [
  { id: "training_heatmap", label: "Training heatmap" },
  { id: "weekly_group_load", label: "Weekly group load" },
  { id: "nutrition_scatter", label: "Nutrition scatter" },
  { id: "group_balance", label: "Group balance" },
  { id: "exercise_progress", label: "Exercise progress" },
  { id: "session_timeline", label: "Session timeline" },
];
const GROUP_COLORS = ["#34d399", "#f59e0b", "#38bdf8", "#f472b6", "#a78bfa", "#fb7185", "#84cc16", "#22d3ee"];

type ExerciseSort = typeof SORT_OPTIONS[number]["value"];
type Detail =
  | { type: "session"; sessionId: number }
  | { type: "exercise"; exerciseName: string }
  | { type: "group"; group: string }
  | { type: "week"; weekStart: string }
  | null;

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

function panelClass(extra = "") {
  return `rounded-lg border border-zinc-800 bg-zinc-900/80 p-4 shadow-sm ${extra}`;
}

function hasPanel(prefs: WorkoutPreferences | undefined, id: string) {
  return !prefs || prefs.default_charts.includes(id);
}

function UploadPanel() {
  const imports = useStrongImports();
  const upload = useImportStrongCsv();
  const latest = imports.data?.imports[0];

  async function onFile(file: File | null) {
    if (file) await upload.mutateAsync(file);
  }

  return (
    <div className={panelClass()}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Strong CSV import</p>
          <p className="mt-1 text-sm text-zinc-400">Upload a full Strong export. Duplicate sets are ignored.</p>
          {latest ? (
            <p className="mt-2 text-xs text-zinc-600">
              Last import {formatShortDate(latest.uploaded_at?.slice(0, 10) ?? latest.nutrition_start_date ?? "")}:{" "}
              {latest.sets_inserted.toLocaleString()} new sets, {latest.duplicate_sets.toLocaleString()} duplicates
            </p>
          ) : null}
        </div>
        <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-zinc-950 transition-colors hover:bg-emerald-400">
          {upload.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          Import
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={upload.isPending}
            onChange={(event) => onFile(event.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      {upload.isSuccess ? (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          Imported {upload.data.sets_inserted.toLocaleString()} new sets across {upload.data.sessions_inserted.toLocaleString()} sessions.
        </div>
      ) : null}
      {upload.isError ? (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {(upload.error as Error).message}
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, unit, active = true }: { label: string; value: string; unit?: string; active?: boolean }) {
  if (!active) return null;
  return (
    <div className={panelClass("min-h-24")}>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <div className="mt-4 flex items-end gap-1.5">
        <span className="text-2xl font-black leading-none text-zinc-50 tabular-nums">{value}</span>
        {unit ? <span className="text-xs text-zinc-500">{unit}</span> : null}
      </div>
    </div>
  );
}

function FilterRail({
  analytics,
  groupFilter,
  movementFilter,
  exerciseFilter,
  prOnly,
  minVolume,
  sortBy,
  onGroup,
  onMovement,
  onExercise,
  onPrOnly,
  onMinVolume,
  onSort,
  onClear,
}: {
  analytics: StrongAnalyticsResponse | undefined;
  groupFilter: string;
  movementFilter: string;
  exerciseFilter: string;
  prOnly: boolean;
  minVolume: number;
  sortBy: ExerciseSort;
  onGroup: (value: string) => void;
  onMovement: (value: string) => void;
  onExercise: (value: string) => void;
  onPrOnly: (value: boolean) => void;
  onMinVolume: (value: number) => void;
  onSort: (value: ExerciseSort) => void;
  onClear: () => void;
}) {
  const options = analytics?.filter_options;
  return (
    <aside className={panelClass("h-fit lg:sticky lg:top-28")}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-zinc-100">
          <SlidersHorizontal size={16} className="text-emerald-400" />
          Filters
        </div>
        <button onClick={onClear} className="text-xs font-semibold text-zinc-500 hover:text-zinc-200">Reset</button>
      </div>
      <div className="space-y-3">
        <Select label="Group" value={groupFilter} options={["All", ...(options?.groups ?? [])]} onChange={onGroup} />
        <Select label="Movement" value={movementFilter} options={["All", ...(options?.movement_patterns ?? [])]} onChange={onMovement} />
        <Select label="Exercise" value={exerciseFilter} options={["All", ...(options?.exercises ?? [])]} onChange={onExercise} />
        <Select label="Sort" value={sortBy} options={SORT_OPTIONS.map((item) => item.value)} labels={Object.fromEntries(SORT_OPTIONS.map((item) => [item.value, item.label]))} onChange={(value) => onSort(value as ExerciseSort)} />
        <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-400">
          PR only
          <input type="checkbox" checked={prOnly} onChange={(event) => onPrOnly(event.target.checked)} className="h-4 w-4 accent-emerald-500" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-600">Min volume</span>
          <input
            type="number"
            min={0}
            step={500}
            value={minVolume}
            onChange={(event) => onMinVolume(Number(event.target.value) || 0)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-200"
          />
        </label>
      </div>
    </aside>
  );
}

function Select({ label, value, options, labels, onChange }: {
  label: string;
  value: string;
  options: string[];
  labels?: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-600">{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 pr-8 text-sm text-zinc-200"
        >
          {options.map((option) => <option key={option} value={option}>{labels?.[option] ?? option}</option>)}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500" />
      </span>
    </label>
  );
}

function TrainingHeatmap({ days, onDay }: { days: StrongDailyLoad[]; onDay: (day: StrongDailyLoad) => void }) {
  const maxVolume = Math.max(1, ...days.map((day) => day.total_volume));
  return (
    <div className={panelClass()}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Training heatmap</p>
        <CalendarDays size={16} className="text-zinc-600" />
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const intensity = Math.max(0.12, day.total_volume / maxVolume);
          return (
            <button
              key={day.date}
              onClick={() => onDay(day)}
              title={`${day.date}: ${fmt(day.total_volume, 0)} kg`}
              className="aspect-square rounded bg-emerald-500 transition-transform hover:scale-105"
              style={{ opacity: intensity }}
            />
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-zinc-600">
        <span>{days[0] ? formatShortDate(days[0].date) : "-"}</span>
        <span>{days.at(-1) ? formatShortDate(days.at(-1)!.date) : "-"}</span>
      </div>
    </div>
  );
}

function WeeklyGroupLoadChart({ data, onWeek, onGroup }: {
  data: StrongWeeklyGroupLoad[];
  onWeek: (weekStart: string) => void;
  onGroup: (group: string) => void;
}) {
  const groups = Array.from(new Set(data.map((row) => row.group))).slice(0, 8);
  const rows = Array.from(
    data.reduce((map, row) => {
      const current = map.get(row.week_start) ?? { week_start: row.week_start, week: formatShortDate(row.week_start) };
      current[row.group] = Math.round(row.total_volume);
      map.set(row.week_start, current);
      return map;
    }, new Map<string, Record<string, string | number>>()).values()
  );

  return (
    <div className={panelClass()}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Weekly load by group</p>
        <div className="flex flex-wrap justify-end gap-2">
          {groups.map((group, index) => (
            <button key={group} onClick={() => onGroup(group)} className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-500 hover:text-zinc-200">
              <span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLORS[index % GROUP_COLORS.length] }} />
              {group}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={(event) => {
          const payload = event?.activePayload?.[0]?.payload as Record<string, string | number> | undefined;
          if (payload && typeof payload.week_start === "string") onWeek(payload.week_start);
        }}>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="week" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} width={46} />
          <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, color: "#fafafa", fontSize: 12 }} />
          {groups.map((group, index) => (
            <Bar key={group} dataKey={group} stackId="group" fill={GROUP_COLORS[index % GROUP_COLORS.length]} radius={index === groups.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function GroupBalanceChart({ analytics, onGroup }: { analytics: StrongAnalyticsResponse; onGroup: (group: string) => void }) {
  const rows = analytics.group_balance.slice(0, 10).map((row) => ({
    name: row.group,
    volume: Math.round(row.total_volume),
    sets: row.working_sets,
    prs: row.estimated_1rm_prs,
  }));
  return (
    <div className={panelClass()}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Movement balance</p>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={rows} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} width={92} />
          <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, color: "#fafafa", fontSize: 12 }} />
          <Bar dataKey="volume" fill="var(--color-active)" fillOpacity={0.75} radius={[0, 3, 3, 0]} onClick={(row: { name?: string }) => row.name && onGroup(row.name)} />
          <Line type="monotone" dataKey="prs" stroke="var(--color-fat)" strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function NutritionScatter({ analytics, sessions, onSession }: {
  analytics: StrongAnalyticsResponse;
  sessions: StrongSessionRecord[];
  onSession: (sessionId: number) => void;
}) {
  const sessionIdByDate = new Map(sessions.map((session) => [session.workout_date, session.id]));
  const rows = analytics.nutrition_training_days
    .filter((day) => day.calories != null || day.protein != null)
    .map((day) => ({
      date: formatShortDate(day.date),
      rawDate: day.date,
      volume: Math.round(day.session_volume),
      protein: day.protein,
      calories: day.calories,
      prs: day.pr_count,
      sessionId: sessionIdByDate.get(day.date) ?? analytics.exercise_prs.find((pr) => pr.date === day.date)?.session_id ?? null,
    }));

  return (
    <div className={panelClass()}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Nutrition vs load</p>
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
          <XAxis dataKey="volume" name="Volume" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis dataKey="protein" name="Protein" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} width={38} />
          <Tooltip cursor={{ stroke: "#52525b", strokeDasharray: "3 3" }} contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, color: "#fafafa", fontSize: 12 }} />
          <Scatter dataKey="protein" name="Protein" onClick={(row: { rawDate?: string }) => {
            const hit = rows.find((item) => item.rawDate === row.rawDate);
            const sessionId = hit?.sessionId ?? undefined;
            if (sessionId) onSession(sessionId);
          }}>
            {rows.map((row) => <Cell key={row.rawDate} fill={row.prs > 0 ? "var(--color-fat)" : "var(--color-protein)"} />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function ExerciseListPanel({
  exercises,
  taxonomy,
  prExercises,
  groupFilter,
  movementFilter,
  exerciseFilter,
  prOnly,
  minVolume,
  sortBy,
  pinned,
  onSelect,
}: {
  exercises: StrongExerciseSummary[];
  taxonomy: Record<string, StrongExerciseTaxonomy>;
  prExercises: Set<string>;
  groupFilter: string;
  movementFilter: string;
  exerciseFilter: string;
  prOnly: boolean;
  minVolume: number;
  sortBy: ExerciseSort;
  pinned: string[];
  onSelect: (name: string) => void;
}) {
  const visible = useMemo(() => {
    const filtered = exercises.filter((exercise) => {
      const tax = taxonomy[exercise.exercise_name] ?? { primary_group: "Other", movement_pattern: "Other", secondary_groups: [] };
      return (groupFilter === "All" || tax.primary_group === groupFilter)
        && (movementFilter === "All" || tax.movement_pattern === movementFilter)
        && (exerciseFilter === "All" || exercise.exercise_name === exerciseFilter)
        && (!prOnly || prExercises.has(exercise.exercise_name))
        && exercise.total_volume >= minVolume;
    });
    return [...filtered].sort((a, b) => {
      const pinDelta = Number(pinned.includes(b.exercise_name)) - Number(pinned.includes(a.exercise_name));
      if (pinDelta) return pinDelta;
      if (sortBy === "volume") return b.total_volume - a.total_volume;
      if (sortBy === "last_performed") return String(b.last_performed ?? "").localeCompare(String(a.last_performed ?? ""));
      if (sortBy === "estimated_1rm_delta") return (b.estimated_1rm_delta ?? -Infinity) - (a.estimated_1rm_delta ?? -Infinity);
      return Number(prExercises.has(b.exercise_name)) - Number(prExercises.has(a.exercise_name))
        || String(b.last_performed ?? "").localeCompare(String(a.last_performed ?? ""));
    });
  }, [exerciseFilter, exercises, groupFilter, minVolume, movementFilter, pinned, prExercises, prOnly, sortBy, taxonomy]);

  return (
    <div className={panelClass()}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Exercises</p>
        <span className="text-xs text-zinc-600">{visible.length} / {exercises.length}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {visible.slice(0, 60).map((exercise) => {
          const tax = taxonomy[exercise.exercise_name] ?? { primary_group: "Other", movement_pattern: "Other", secondary_groups: [] };
          return (
            <button key={exercise.exercise_name} onClick={() => onSelect(exercise.exercise_name)} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-left transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{exercise.exercise_name}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {exercise.sessions} sessions / {exercise.working_sets} sets / {fmt(exercise.total_volume, 0)} kg
                  </p>
                </div>
                {pinned.includes(exercise.exercise_name) ? <Pin size={14} className="shrink-0 text-emerald-400" /> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">{tax.primary_group}</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">{tax.movement_pattern}</span>
                {prExercises.has(exercise.exercise_name) ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">PR</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SessionTimeline({ sessions, taxonomy, onSelect }: {
  sessions: StrongSessionRecord[];
  taxonomy: Record<string, StrongExerciseTaxonomy>;
  onSelect: (sessionId: number) => void;
}) {
  return (
    <div className={panelClass()}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Session timeline</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="py-2 pr-3 text-left font-semibold">Date</th>
              <th className="px-2 py-2 text-left font-semibold">Workout</th>
              <th className="px-2 py-2 text-left font-semibold">Groups</th>
              <th className="px-2 py-2 text-left font-semibold">Top sets</th>
              <th className="px-2 py-2 text-right font-semibold">Volume</th>
              <th className="py-2 pl-2 text-right font-semibold">Duration</th>
            </tr>
          </thead>
          <tbody>
            {sessions.slice(0, 50).map((session) => {
              const groups = Array.from(new Set(session.sets.map((set) => taxonomy[set.exercise_name]?.primary_group ?? "Other"))).slice(0, 4);
              const topSets = session.sets.filter((set) => !set.is_warmup).slice(0, 4);
              return (
                <tr key={session.id} onClick={() => onSelect(session.id)} className="cursor-pointer border-t border-zinc-800/60 transition-colors hover:bg-zinc-800/35">
                  <td className="py-2 pr-3 text-zinc-400">{formatShortDate(session.workout_date)}</td>
                  <td className="px-2 py-2">
                    <p className="font-semibold text-zinc-100">{session.workout_name}</p>
                    <p className="text-zinc-600">{session.exercise_count} exercises / {session.working_set_count} sets</p>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {groups.map((group) => <span key={group} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{group}</span>)}
                    </div>
                  </td>
                  <td className="max-w-sm px-2 py-2 text-zinc-500">
                    <div className="flex flex-wrap gap-1">
                      {topSets.map((set) => (
                        <span key={set.id} className="rounded bg-zinc-950 px-1.5 py-0.5">
                          {set.exercise_name} {fmt(set.weight, 0)}x{fmt(set.reps, 0)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right text-zinc-300 tabular-nums">{fmt(session.total_volume, 0)} kg</td>
                  <td className="py-2 pl-2 text-right text-zinc-400 tabular-nums">{duration(session.duration_seconds)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExerciseDetailChart({ exerciseName, start, end, metric }: { exerciseName: string | null; start: string; end: string; metric: string }) {
  const detail = useStrongExercise(exerciseName, start, end);
  const rows = detail.data?.points.map((point) => ({
    date: formatShortDate(point.date),
    est1rm: point.best_estimated_1rm,
    volume: point.total_volume,
    topWeight: point.best_weight,
    reps: point.best_reps,
    sets: point.working_sets,
  })) ?? [];
  const metricKey = metric === "volume" ? "volume" : metric === "top_weight" ? "topWeight" : metric === "reps" ? "reps" : metric === "sets" ? "sets" : "est1rm";

  if (!exerciseName) return <div className="flex h-64 items-center justify-center text-sm text-zinc-500">Select an exercise.</div>;
  if (detail.isLoading) return <div className="flex h-64 items-center justify-center"><Loader2 size={22} className="animate-spin text-emerald-400" /></div>;
  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} width={42} />
          <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, color: "#fafafa", fontSize: 12 }} />
          <Bar dataKey="volume" fill="var(--color-carbs)" fillOpacity={0.16} radius={[3, 3, 0, 0]} />
          <Line type="monotone" dataKey={metricKey} stroke="var(--color-protein)" strokeWidth={2} dot={{ r: 2 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {detail.data?.sessions.slice(0, 8).map((session) => (
          <div key={session.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-zinc-100">{formatShortDate(session.workout_date)}</p>
              <p className="text-xs text-zinc-500">{session.workout_name}</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {session.sets.filter((set) => set.exercise_name === exerciseName).map((set) => (
                <span key={set.id} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
                  {set.is_warmup ? "W " : ""}{fmt(set.weight, 1)} x {fmt(set.reps, 0)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailDrawer({
  detail,
  analytics,
  start,
  end,
  exerciseMetric,
  onMetric,
  onExercise,
  onClose,
}: {
  detail: Detail;
  analytics: StrongAnalyticsResponse | undefined;
  start: string;
  end: string;
  exerciseMetric: string;
  onMetric: (metric: string) => void;
  onExercise: (name: string) => void;
  onClose: () => void;
}) {
  const sessionDetail = useStrongSession(detail?.type === "session" ? detail.sessionId : null);
  if (!detail) return null;

  const title = detail.type === "session"
    ? sessionDetail.data?.workout_name ?? "Session"
    : detail.type === "exercise"
      ? detail.exerciseName
      : detail.type === "group"
        ? `${detail.group} group`
        : `Week of ${formatShortDate(detail.weekStart)}`;

  return (
    <div className="fixed inset-0 z-40 lg:pointer-events-none">
      <button className="absolute inset-0 bg-black/50 lg:hidden" onClick={onClose} aria-label="Close detail" />
      <aside className="pointer-events-auto absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-zinc-800 bg-zinc-950 p-4 shadow-2xl lg:w-[460px]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600">Drilldown</p>
            <h2 className="mt-1 text-lg font-black text-zinc-50">{title}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg border border-zinc-800 p-2 text-zinc-400 hover:text-zinc-100" aria-label="Close detail">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {detail.type === "session" ? (
            sessionDetail.isLoading ? <Loader2 size={22} className="mx-auto mt-20 animate-spin text-emerald-400" /> : <SessionDrawer session={sessionDetail.data} onExercise={onExercise} />
          ) : detail.type === "exercise" ? (
            <div>
              <div className="mb-3 flex flex-wrap gap-2">
                {[
                  ["estimated_1rm", "Est 1RM"],
                  ["volume", "Volume"],
                  ["top_weight", "Top weight"],
                  ["reps", "Reps"],
                  ["sets", "Sets"],
                ].map(([value, label]) => (
                  <button key={value} onClick={() => onMetric(value)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${exerciseMetric === value ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 text-zinc-500 hover:text-zinc-200"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <ExerciseDetailChart exerciseName={detail.exerciseName} start={start} end={end} metric={exerciseMetric} />
            </div>
          ) : detail.type === "group" ? (
            <GroupDrawer group={detail.group} analytics={analytics} />
          ) : (
            <WeekDrawer weekStart={detail.weekStart} analytics={analytics} />
          )}
        </div>
      </aside>
    </div>
  );
}

function SessionDrawer({ session, onExercise }: { session: StrongSessionRecord | undefined; onExercise: (name: string) => void }) {
  if (!session) return <div className="text-sm text-zinc-500">Session not found.</div>;
  const exercises = Array.from(new Set(session.sets.map((set) => set.exercise_name)));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <StatMini label="Volume" value={`${fmt(session.total_volume, 0)} kg`} />
        <StatMini label="Sets" value={String(session.working_set_count)} />
        <StatMini label="Duration" value={duration(session.duration_seconds)} />
      </div>
      {session.workout_notes ? <p className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-400">{session.workout_notes}</p> : null}
      {exercises.map((exercise) => (
        <div key={exercise} className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
          <button onClick={() => onExercise(exercise)} className="text-left text-sm font-bold text-zinc-100 hover:text-emerald-300">{exercise}</button>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {session.sets.filter((set) => set.exercise_name === exercise).map((set) => (
              <span key={set.id} className={`rounded px-2 py-1 text-xs ${set.is_warmup ? "bg-zinc-800 text-zinc-500" : "bg-emerald-500/10 text-emerald-300"}`}>
                {set.set_order}: {fmt(set.weight, 1)} x {fmt(set.reps, 0)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupDrawer({ group, analytics }: { group: string; analytics: StrongAnalyticsResponse | undefined }) {
  const rows = analytics?.weekly_group_load.filter((row) => row.group === group) ?? [];
  const prs = analytics?.exercise_prs.filter((pr) => analytics.exercise_taxonomy[pr.exercise_name]?.primary_group === group) ?? [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <StatMini label="Volume" value={`${fmt(rows.reduce((sum, row) => sum + row.total_volume, 0), 0)} kg`} />
        <StatMini label="Sets" value={String(rows.reduce((sum, row) => sum + row.working_sets, 0))} />
        <StatMini label="PRs" value={String(prs.length)} />
      </div>
      <div className="space-y-2">
        {prs.slice(-12).reverse().map((pr) => (
          <div key={`${pr.exercise_name}-${pr.date}-${pr.estimated_1rm}`} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm">
            <p className="font-semibold text-zinc-100">{pr.exercise_name}</p>
            <p className="mt-1 text-xs text-zinc-500">{formatShortDate(pr.date)} / {fmt(pr.weight, 1)} x {fmt(pr.reps, 0)} / est {fmt(pr.estimated_1rm, 1)} kg</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekDrawer({ weekStart, analytics }: { weekStart: string; analytics: StrongAnalyticsResponse | undefined }) {
  const groups = analytics?.weekly_group_load.filter((row) => row.week_start === weekStart) ?? [];
  const days = analytics?.daily_load.filter((day) => day.date >= weekStart && day.date <= isoDate(new Date(new Date(weekStart).getTime() + 6 * 86400000))) ?? [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <StatMini label="Volume" value={`${fmt(groups.reduce((sum, row) => sum + row.total_volume, 0), 0)} kg`} />
        <StatMini label="Sets" value={String(groups.reduce((sum, row) => sum + row.working_sets, 0))} />
        <StatMini label="Sessions" value={String(days.reduce((sum, day) => sum + day.session_count, 0))} />
      </div>
      {groups.map((row) => (
        <div key={row.group} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-zinc-100">{row.group}</p>
            <p className="text-sm text-zinc-300 tabular-nums">{fmt(row.total_volume, 0)} kg</p>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{row.working_sets} sets / {row.session_count} sessions</p>
        </div>
      ))}
    </div>
  );
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">{label}</p>
      <p className="mt-2 text-sm font-black text-zinc-100 tabular-nums">{value}</p>
    </div>
  );
}

function NutritionPanel({ summary, analytics }: { summary: ReturnType<typeof useStrongSummary>["data"]; analytics: StrongAnalyticsResponse | undefined }) {
  const rows = [
    ["Calories", summary?.nutrition.training_avg_calories, summary?.nutrition.rest_avg_calories, "kcal", 0],
    ["Protein", summary?.nutrition.training_avg_protein, summary?.nutrition.rest_avg_protein, "g", 0],
    ["Weight", summary?.nutrition.training_avg_weight, summary?.nutrition.rest_avg_weight, "kg", 1],
    ["Active energy", summary?.nutrition.training_avg_active_energy, summary?.nutrition.rest_avg_active_energy, "kcal", 0],
  ] as const;
  return (
    <div className={panelClass()}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Training day nutrition</p>
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map(([label, training, rest, unit, decimals]) => (
          <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm text-zinc-400">{label}</p>
              <p className="text-sm font-bold text-zinc-100 tabular-nums">{fmt(training, decimals)} {unit}</p>
            </div>
            <p className="mt-1 text-xs text-zinc-600">Rest day average {fmt(rest, decimals)} {unit}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        {(analytics?.recovery_load_markers.low_protein_training_days ?? []).slice(0, 5).map((day) => (
          <div key={day.date} className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs">
            <span className="text-amber-200">{formatShortDate(day.date)} low protein</span>
            <span className="text-zinc-400">{fmt(day.protein, 0)} g / {fmt(day.session_volume, 0)} kg</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomizePanel({
  preferences,
  exercises,
  onSave,
  saving,
}: {
  preferences: Preferences | undefined;
  exercises: StrongExerciseSummary[];
  onSave: (prefs: WorkoutPreferences) => void;
  saving: boolean;
}) {
  const current = preferences?.workout_preferences;
  const [draft, setDraft] = useState<WorkoutPreferences | null>(current ?? null);
  useEffect(() => {
    if (current) setDraft(current);
  }, [current]);

  if (!draft) return <div className={panelClass("text-sm text-zinc-500")}>Loading preferences.</div>;

  function toggleList(key: "visible_workout_cards" | "default_charts" | "pinned_exercises", value: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const set = new Set(prev[key]);
      if (set.has(value)) set.delete(value); else set.add(value);
      return { ...prev, [key]: Array.from(set) };
    });
  }

  return (
    <div className={panelClass("space-y-5")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Customize Workouts</p>
          <p className="mt-1 text-sm text-zinc-400">Saved through dashboard preferences.</p>
        </div>
        <button onClick={() => onSave(draft)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-zinc-950 hover:bg-emerald-400">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Save
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Select label="Landing tab" value={draft.landing_tab} options={TABS} onChange={(value) => setDraft({ ...draft, landing_tab: value as WorkoutTab })} />
        <Select label="Default sort" value={draft.default_exercise_sort} options={SORT_OPTIONS.map((item) => item.value)} labels={Object.fromEntries(SORT_OPTIONS.map((item) => [item.value, item.label]))} onChange={(value) => setDraft({ ...draft, default_exercise_sort: value })} />
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-600">Default range days</span>
          <input type="number" value={draft.default_range_days} onChange={(event) => setDraft({ ...draft, default_range_days: Number(event.target.value) || 90 })} className="w-full rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-200" />
        </label>
      </div>
      <ToggleGrid title="Cards" options={CARD_OPTIONS} selected={draft.visible_workout_cards} onToggle={(id) => toggleList("visible_workout_cards", id)} />
      <ToggleGrid title="Charts" options={CHART_OPTIONS} selected={draft.default_charts} onToggle={(id) => toggleList("default_charts", id)} />
      <ToggleGrid title="Pinned exercises" options={exercises.slice(0, 24).map((exercise) => ({ id: exercise.exercise_name, label: exercise.exercise_name }))} selected={draft.pinned_exercises} onToggle={(id) => toggleList("pinned_exercises", id)} />
      <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-300">
        Show import panel once data exists
        <input type="checkbox" checked={draft.show_import_panel} onChange={(event) => setDraft({ ...draft, show_import_panel: event.target.checked })} className="h-4 w-4 accent-emerald-500" />
      </label>
    </div>
  );
}

function ToggleGrid({ title, options, selected, onToggle }: {
  title: string;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-600">{title}</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-300">
            <input type="checkbox" checked={selected.includes(option.id)} onChange={() => onToggle(option.id)} className="h-4 w-4 accent-emerald-500" />
            <span className="truncate">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function Workouts() {
  const preferences = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const workoutPrefs = preferences.data?.workout_preferences;
  const [hydratedPrefs, setHydratedPrefs] = useState(false);
  const [start, setStart] = useState(offset(89));
  const [end, setEnd] = useState(isoDate());
  const [activeTab, setActiveTab] = useState<WorkoutTab>("Overview");
  const [groupFilter, setGroupFilter] = useState("All");
  const [movementFilter, setMovementFilter] = useState("All");
  const [exerciseFilter, setExerciseFilter] = useState("All");
  const [prOnly, setPrOnly] = useState(false);
  const [minVolume, setMinVolume] = useState(0);
  const [sortBy, setSortBy] = useState<ExerciseSort>("recent_pr");
  const [detail, setDetail] = useState<Detail>(null);
  const [exerciseMetric, setExerciseMetric] = useState("estimated_1rm");

  useEffect(() => {
    if (!workoutPrefs || hydratedPrefs) return;
    setStart(offset(workoutPrefs.default_range_days - 1));
    setActiveTab(workoutPrefs.landing_tab);
    setGroupFilter(workoutPrefs.default_group_filter || "All");
    setSortBy(workoutPrefs.default_exercise_sort as ExerciseSort);
    setHydratedPrefs(true);
  }, [hydratedPrefs, workoutPrefs]);

  const summary = useStrongSummary(start, end);
  const analytics = useStrongAnalytics(start, end);
  const sessions = useStrongSessions(start, end);

  const topExercises = summary.data?.exercises ?? [];
  const taxonomy = analytics.data?.exercise_taxonomy ?? {};
  const prExercises = useMemo(() => new Set((analytics.data?.exercise_prs ?? []).map((pr) => pr.exercise_name)), [analytics.data]);
  const pinned = workoutPrefs?.pinned_exercises ?? [];
  const strongestPr = summary.data?.recent_prs[0];
  const selectedExercise = detail?.type === "exercise" ? detail.exerciseName : pinned[0] ?? topExercises[0]?.exercise_name ?? null;

  const sessionsPerWeek = useMemo(() => {
    const weeks = summary.data?.weekly.length ?? 0;
    return weeks && summary.data ? (summary.data.session_count / weeks).toFixed(1) : "0.0";
  }, [summary.data]);

  const trainingRestCalorieDelta = analytics.data?.recovery_load_markers.training_rest_deltas.find((item) => item.metric === "calories")?.delta ?? null;
  const loadTrend = useMemo(() => {
    const weeks = analytics.data?.weekly_load ?? [];
    if (weeks.length < 2) return null;
    return weeks[weeks.length - 1].total_volume - weeks[weeks.length - 2].total_volume;
  }, [analytics.data]);

  function applyPreset(days: number) {
    setEnd(isoDate());
    setStart(days > 1000 && summary.data?.nutrition_start_date ? summary.data.nutrition_start_date : offset(days - 1));
  }

  function resetFilters() {
    setGroupFilter("All");
    setMovementFilter("All");
    setExerciseFilter("All");
    setPrOnly(false);
    setMinVolume(0);
    setSortBy(workoutPrefs?.default_exercise_sort as ExerciseSort || "recent_pr");
  }

  function saveWorkoutPrefs(next: WorkoutPreferences) {
    if (!preferences.data) return;
    updatePreferences.mutate({ ...preferences.data, workout_preferences: next });
  }

  const loading = summary.isLoading || analytics.isLoading;
  const empty = !loading && (!summary.data || summary.data.session_count === 0);

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="sticky top-0 z-30 border-b border-zinc-900 bg-zinc-950/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h1 className="text-2xl font-black text-zinc-50">Workouts</h1>
              <p className="mt-0.5 text-sm text-zinc-500">Strong drilldowns with nutrition context</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-300" defaultValue="default">
                <option value="default">Default view</option>
                <option value="strength">Strength focus</option>
                <option value="nutrition">Nutrition overlay</option>
              </select>
              {RANGE_PRESETS.map((preset) => (
                <button key={preset.label} onClick={() => applyPreset(preset.days)} className="rounded-lg border border-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100">
                  {preset.label}
                </button>
              ))}
              <input type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-xs text-zinc-300" />
              <input type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-xs text-zinc-300" />
              <button onClick={() => setActiveTab("Customize")} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-zinc-600">
                <Settings2 size={14} />
                Customize
              </button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto">
            {TABS.map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${activeTab === tab ? "bg-emerald-500 text-zinc-950" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"}`}>
                {tab}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1500px] gap-4 p-4 lg:grid-cols-[250px_minmax(0,1fr)] md:p-6">
        <FilterRail
          analytics={analytics.data}
          groupFilter={groupFilter}
          movementFilter={movementFilter}
          exerciseFilter={exerciseFilter}
          prOnly={prOnly}
          minVolume={minVolume}
          sortBy={sortBy}
          onGroup={setGroupFilter}
          onMovement={setMovementFilter}
          onExercise={setExerciseFilter}
          onPrOnly={setPrOnly}
          onMinVolume={setMinVolume}
          onSort={setSortBy}
          onClear={resetFilters}
        />

        <main className="min-w-0 space-y-4">
          {workoutPrefs?.show_import_panel || !summary.data?.session_count ? <UploadPanel /> : null}

          {loading ? (
            <div className="flex h-72 items-center justify-center">
              <Loader2 size={26} className="animate-spin text-emerald-400" />
            </div>
          ) : empty ? (
            <div className={panelClass()}>
              <div className="py-16 text-center">
                <FileUp size={28} className="mx-auto mb-3 text-zinc-600" />
                <p className="text-sm text-zinc-400">No Strong workouts in this range.</p>
              </div>
            </div>
          ) : (
            <>
              {activeTab !== "Customize" ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <StatCard label="Sessions / week" value={sessionsPerWeek} active={workoutPrefs?.visible_workout_cards.includes("sessions") ?? true} />
                  <StatCard label="Volume" value={fmt(analytics.data?.totals.total_volume ?? summary.data?.total_volume, 0)} unit="kg" active={workoutPrefs?.visible_workout_cards.includes("volume") ?? true} />
                  <StatCard label="PRs" value={fmt(analytics.data?.totals.pr_count, 0)} active={workoutPrefs?.visible_workout_cards.includes("prs") ?? true} />
                  <StatCard label="Protein" value={fmt(summary.data?.nutrition.training_avg_protein, 0)} unit="g/day" active={workoutPrefs?.visible_workout_cards.includes("protein") ?? true} />
                  <StatCard label="Calorie delta" value={trainingRestCalorieDelta == null ? "-" : `${trainingRestCalorieDelta > 0 ? "+" : ""}${fmt(trainingRestCalorieDelta, 0)}`} unit="vs rest" active={workoutPrefs?.visible_workout_cards.includes("calorie_delta") ?? true} />
                  <StatCard label="Load trend" value={loadTrend == null ? "-" : `${loadTrend > 0 ? "+" : ""}${fmt(loadTrend, 0)}`} unit="kg" active={workoutPrefs?.visible_workout_cards.includes("load_trend") ?? true} />
                </div>
              ) : null}

              {activeTab === "Overview" && analytics.data ? (
                <>
                  <div className="grid gap-4 xl:grid-cols-[0.8fr_1.4fr]">
                    {hasPanel(workoutPrefs, "training_heatmap") ? <TrainingHeatmap days={analytics.data.daily_load} onDay={(day) => setDetail({ type: "week", weekStart: day.date })} /> : null}
                    {hasPanel(workoutPrefs, "weekly_group_load") ? <WeeklyGroupLoadChart data={analytics.data.weekly_group_load} onWeek={(weekStart) => setDetail({ type: "week", weekStart })} onGroup={(group) => { setGroupFilter(group); setDetail({ type: "group", group }); }} /> : null}
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {hasPanel(workoutPrefs, "nutrition_scatter") ? <NutritionScatter analytics={analytics.data} sessions={sessions.data?.sessions ?? []} onSession={(sessionId) => setDetail({ type: "session", sessionId })} /> : null}
                    {hasPanel(workoutPrefs, "group_balance") ? <GroupBalanceChart analytics={analytics.data} onGroup={(group) => { setGroupFilter(group); setDetail({ type: "group", group }); }} /> : null}
                  </div>
                  {strongestPr ? (
                    <button onClick={() => setDetail({ type: "exercise", exerciseName: strongestPr.exercise_name })} className="flex w-full items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-left hover:bg-amber-500/10">
                      <span className="flex items-center gap-2 text-sm font-bold text-amber-200"><Trophy size={16} /> Recent PR: {strongestPr.exercise_name}</span>
                      <span className="text-sm text-zinc-300">{fmt(strongestPr.estimated_1rm, 1)} kg est 1RM</span>
                    </button>
                  ) : null}
                </>
              ) : null}

              {activeTab === "Sessions" && (
                <SessionTimeline sessions={sessions.data?.sessions ?? []} taxonomy={taxonomy} onSelect={(sessionId) => setDetail({ type: "session", sessionId })} />
              )}

              {activeTab === "Exercises" && (
                <div className="space-y-4">
                  <ExerciseListPanel
                    exercises={topExercises}
                    taxonomy={taxonomy}
                    prExercises={prExercises}
                    groupFilter={groupFilter}
                    movementFilter={movementFilter}
                    exerciseFilter={exerciseFilter}
                    prOnly={prOnly}
                    minVolume={minVolume}
                    sortBy={sortBy}
                    pinned={pinned}
                    onSelect={(exerciseName) => setDetail({ type: "exercise", exerciseName })}
                  />
                  {hasPanel(workoutPrefs, "exercise_progress") ? (
                    <div className={panelClass()}>
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{selectedExercise ?? "Exercise"} progression</p>
                        <button onClick={() => selectedExercise && setDetail({ type: "exercise", exerciseName: selectedExercise })} className="text-xs font-bold text-emerald-400 hover:text-emerald-300">Open detail</button>
                      </div>
                      <ExerciseDetailChart exerciseName={selectedExercise} start={start} end={end} metric={exerciseMetric} />
                    </div>
                  ) : null}
                </div>
              )}

              {activeTab === "Nutrition" && analytics.data ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  <NutritionPanel summary={summary.data} analytics={analytics.data} />
                  <NutritionScatter analytics={analytics.data} sessions={sessions.data?.sessions ?? []} onSession={(sessionId) => setDetail({ type: "session", sessionId })} />
                </div>
              ) : null}

              {activeTab === "Customize" ? (
                <CustomizePanel preferences={preferences.data} exercises={topExercises} onSave={saveWorkoutPrefs} saving={updatePreferences.isPending} />
              ) : null}
            </>
          )}
        </main>
      </div>

      <DetailDrawer
        detail={detail}
        analytics={analytics.data}
        start={start}
        end={end}
        exerciseMetric={exerciseMetric}
        onMetric={setExerciseMetric}
        onExercise={(exerciseName) => setDetail({ type: "exercise", exerciseName })}
        onClose={() => setDetail(null)}
      />
    </div>
  );
}
