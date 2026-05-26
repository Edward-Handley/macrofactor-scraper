import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDashboardSummary, usePreferences } from "../hooks/use-dashboard";
import { useDailyLogs, useCutPhases } from "../hooks/use-daily-log";
import { isoDate } from "../lib/format";
import { api, type WeeklyRecap } from "../lib/api";
import { RefreshCw, Sparkles } from "lucide-react";

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function avg(vals: (number | null | undefined)[]): number | null {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
}

function grade(pct: number | null): { letter: string; color: string } {
  if (pct == null) return { letter: "—", color: "text-zinc-500" };
  if (pct >= 0.9) return { letter: "A", color: "text-emerald-400" };
  if (pct >= 0.75) return { letter: "B", color: "text-amber-400" };
  return { letter: "C", color: "text-red-400" };
}

function GradeCell({ pct }: { pct: number | null }) {
  const { letter, color } = grade(pct);
  return <span className={`font-black text-lg ${color}`}>{letter}</span>;
}

function DeltaCell({ value, unit = "", reversed = false, decimals = 1 }: {
  value: number | null; unit?: string; reversed?: boolean; decimals?: number;
}) {
  if (value == null) return <span className="text-zinc-600 text-sm">—</span>;
  const up = value > 0;
  const good = reversed ? !up : up;
  return (
    <span className={`text-sm font-semibold tabular-nums ${good ? "text-emerald-400" : "text-red-400"}`}>
      {up ? "+" : ""}{value.toFixed(decimals)}{unit}
    </span>
  );
}

function WeeklyStoryCard({ weekStart }: { weekStart: string }) {
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const { data: recap, isLoading } = useQuery<WeeklyRecap | null>({
    queryKey: ["weekly-recap", weekStart],
    queryFn: async () => {
      try {
        return await api.weeklyRecap.get(weekStart);
      } catch {
        return null;
      }
    },
    staleTime: 600_000,
    retry: false,
  });

  const regenerate = useMutation({
    mutationFn: () => api.weeklyRecap.regenerate(weekStart),
    onMutate: () => setGenerating(true),
    onSettled: () => setGenerating(false),
    onSuccess: (data) => {
      qc.setQueryData(["weekly-recap", weekStart], data);
    },
  });

  if (isLoading) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-3">
        <Sparkles size={16} className="text-violet-400 shrink-0" />
        <span className="text-sm text-zinc-500">Loading weekly story…</span>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 border border-violet-800/40 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-violet-400" />
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Weekly Story</span>
        </div>
        <button
          onClick={() => regenerate.mutate()}
          disabled={generating}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={generating ? "animate-spin" : ""} />
          {recap ? "Regenerate" : "Generate"}
        </button>
      </div>

      {recap ? (
        <>
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{recap.narrative}</p>
          {recap.highlights.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {recap.highlights.map((h, i) => (
                <span key={i} className="text-[11px] bg-violet-500/10 text-violet-300 border border-violet-700/40 rounded-full px-2.5 py-0.5">
                  {h}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-zinc-500">
          No recap yet. Hit "Generate" to get an AI summary of this week.
        </p>
      )}
    </div>
  );
}

export function WeeklyScorecard() {
  const TODAY = isoDate();
  const thisWeekStart = addDays(TODAY, -6);
  const prevWeekStart = addDays(TODAY, -13);

  const { data: summary } = useDashboardSummary(prevWeekStart, TODAY);
  const { data: logsData } = useDailyLogs(prevWeekStart, TODAY);
  const { data: cutData } = useCutPhases();
  const { data: prefs } = usePreferences();

  const activePhase = cutData?.phases.find((p) => !p.end_date || p.end_date >= TODAY) ?? null;
  const targetCalories = activePhase?.target_calories ?? null;
  const targetProtein = prefs?.protein_goal_g ?? null;

  const { thisWeek, prevWeek } = useMemo(() => {
    const summaries = summary?.summaries ?? [];
    const thisWeek = summaries.filter(d => d.date >= thisWeekStart && d.date <= TODAY);
    const prevWeek = summaries.filter(d => d.date >= prevWeekStart && d.date < thisWeekStart);
    return { thisWeek, prevWeek };
  }, [summary, thisWeekStart, prevWeekStart, TODAY]);

  const { thisLogs, prevLogs } = useMemo(() => {
    const logs = logsData?.logs ?? [];
    const thisLogs = logs.filter(l => l.log_date >= thisWeekStart && l.log_date <= TODAY);
    const prevLogs = logs.filter(l => l.log_date >= prevWeekStart && l.log_date < thisWeekStart);
    return { thisLogs, prevLogs };
  }, [logsData, thisWeekStart, prevWeekStart, TODAY]);

  const thisAvgCal = avg(thisWeek.map(d => d.calories));
  const prevAvgCal = avg(prevWeek.map(d => d.calories));
  const calDelta = thisAvgCal != null && prevAvgCal != null ? thisAvgCal - prevAvgCal : null;
  const calCompliance = targetCalories && thisAvgCal ? Math.min(1, thisAvgCal / targetCalories) : null;

  const thisAvgProtein = avg(thisWeek.map(d => d.protein));
  const prevAvgProtein = avg(prevWeek.map(d => d.protein));
  const proteinDelta = thisAvgProtein != null && prevAvgProtein != null ? thisAvgProtein - prevAvgProtein : null;
  const proteinCompliance = targetProtein && thisAvgProtein ? Math.min(1, thisAvgProtein / targetProtein) : null;

  const thisSessions = thisLogs.filter(l => l.gym_done === true).length;
  const prevSessions = prevLogs.filter(l => l.gym_done === true).length;
  const sessionDelta = thisSessions - prevSessions;

  const thisAvgWeight = avg(thisWeek.filter(d => d.weight != null).map(d => d.weight));
  const prevAvgWeight = avg(prevWeek.filter(d => d.weight != null).map(d => d.weight));
  const weightDelta = thisAvgWeight != null && prevAvgWeight != null ? thisAvgWeight - prevAvgWeight : null;

  const thisAvgSleep = avg(thisLogs.map(l => l.sleep_hours));
  const prevAvgSleep = avg(prevLogs.map(l => l.sleep_hours));
  const sleepDelta = thisAvgSleep != null && prevAvgSleep != null ? thisAvgSleep - prevAvgSleep : null;
  const sleepCompliance = thisAvgSleep ? Math.min(1, thisAvgSleep / 8) : null;

  const rows: Array<{
    label: string;
    thisVal: string;
    delta: React.ReactNode;
    compliance: number | null;
    info?: boolean;
  }> = [
    {
      label: "Avg calories",
      thisVal: thisAvgCal != null ? `${thisAvgCal.toFixed(0)} kcal` : "—",
      delta: <DeltaCell value={calDelta} unit=" kcal" decimals={0} />,
      compliance: calCompliance,
    },
    {
      label: "Avg protein",
      thisVal: thisAvgProtein != null ? `${thisAvgProtein.toFixed(0)} g` : "—",
      delta: <DeltaCell value={proteinDelta} unit=" g" decimals={0} />,
      compliance: proteinCompliance,
    },
    {
      label: "Training sessions",
      thisVal: String(thisSessions),
      delta: <DeltaCell value={sessionDelta} unit="" decimals={0} />,
      compliance: thisSessions >= 3 ? 1 : thisSessions >= 2 ? 0.8 : 0.5,
    },
    {
      label: "Avg weight",
      thisVal: thisAvgWeight != null ? `${thisAvgWeight.toFixed(1)} kg` : "—",
      delta: <DeltaCell value={weightDelta} unit=" kg" reversed={true} />,
      compliance: null,
      info: true,
    },
    {
      label: "Avg sleep",
      thisVal: thisAvgSleep != null ? `${thisAvgSleep.toFixed(1)} h` : "—",
      delta: <DeltaCell value={sleepDelta} unit=" h" />,
      compliance: sleepCompliance,
    },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-zinc-50">Weekly Scorecard</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          {thisWeekStart} — {TODAY}
          {activePhase && <span className="ml-2 text-emerald-500">· {activePhase.name}</span>}
        </p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wide">
              <th className="text-left px-4 py-3 font-semibold">Metric</th>
              <th className="text-right px-4 py-3 font-semibold">This week</th>
              <th className="text-right px-4 py-3 font-semibold">vs last week</th>
              <th className="text-right px-4 py-3 font-semibold">Grade</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {rows.map(({ label, thisVal, delta, compliance, info }) => (
              <tr key={label} className="hover:bg-zinc-800/30 transition-colors">
                <td className="px-4 py-3 text-zinc-300 font-medium">{label}</td>
                <td className="px-4 py-3 text-right text-zinc-100 font-semibold tabular-nums">{thisVal}</td>
                <td className="px-4 py-3 text-right">{delta}</td>
                <td className="px-4 py-3 text-right">
                  {info ? <span className="text-zinc-600 text-sm">—</span> : <GradeCell pct={compliance} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Grading</p>
        <div className="flex gap-4 text-xs text-zinc-500">
          <span><span className="text-emerald-400 font-bold">A</span> ≥ 90% of target</span>
          <span><span className="text-amber-400 font-bold">B</span> 75–90%</span>
          <span><span className="text-red-400 font-bold">C</span> &lt; 75%</span>
          <span><span className="text-zinc-600 font-bold">—</span> informational</span>
        </div>
      </div>

      <WeeklyStoryCard weekStart={thisWeekStart} />
    </div>
  );
}
