import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown, ChevronUp, Pencil, RefreshCw } from "lucide-react";
import { useDashboardSummary, usePreferences, useReadiness, useAnomalies } from "../hooks/use-dashboard";
import { useCutPhases, useDailyLogs } from "../hooks/use-daily-log";
import { useActiveDate } from "../hooks/use-active-date";
import { AnomalyStrip } from "../components/insights/anomaly-strip";
import { linearRegression, projectDaysToTarget, forecastTail, weightRatePerWeek } from "../lib/projections";
import { CalorieRing } from "../components/charts/calorie-ring";
import { MacroStack } from "../components/charts/macro-stack";
import { Sparkline } from "../components/charts/sparkline";
import { CalendarHeatmap } from "../components/charts/calendar-heatmap";
import { ReadinessCard } from "../components/charts/readiness-card";
import { api } from "../lib/api";
import { fmt, formatMinutesAsHoursMinutes, formatShortDate, formatDdMmYyyy, deltaArrow } from "../lib/format";
import { FIELD_META } from "../lib/types";
import type { DailySummary } from "../lib/types";

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const AI_TYPES = [
  { value: "quick_summary", label: "Quick Summary" },
  { value: "weight_trend",  label: "Weight Trend"  },
  { value: "nutrition",     label: "Nutrition"      },
  { value: "recovery",      label: "Recovery"       },
] as const;

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="text-sm text-zinc-300 leading-relaxed space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith("### ")) return <p key={i} className="font-bold text-zinc-100 mt-2">{line.slice(4)}</p>;
        if (line.startsWith("## ")) return <p key={i} className="font-bold text-zinc-100 mt-2">{line.slice(3)}</p>;
        if (line.startsWith("# ")) return <p key={i} className="font-bold text-zinc-100 mt-2">{line.slice(2)}</p>;
        if (line.startsWith("- ") || line.startsWith("• ")) return <p key={i} className="pl-3 before:content-['•'] before:mr-2 before:text-zinc-500">{line.slice(2)}</p>;
        if (line.startsWith("**") && line.endsWith("**")) return <p key={i} className="font-semibold text-zinc-100">{line.slice(2, -2)}</p>;
        if (line.trim() === "") return <div key={i} className="h-1" />;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

function AiInsightCard({ forDate }: { forDate: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("quick_summary");
  const [result, setResult] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAnalysis() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.ai.analyse(type, forDate);
      setResult(res.analysis);
      setLastRun(new Date());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("503")) {
        setError("AI analysis not configured — add ANTHROPIC_API_KEY to your .env");
      } else if (msg.includes("429")) {
        setError("Rate limit reached — try again in a few minutes");
      } else {
        setError(`Analysis failed: ${msg}`);
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-zinc-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Bot size={15} className="text-violet-400" />
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">AI Insight</span>
          {lastRun && (
            <span className="text-[10px] text-zinc-600">
              · last run {lastRun.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        {open ? <ChevronUp size={15} className="text-zinc-600" /> : <ChevronDown size={15} className="text-zinc-600" />}
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              {AI_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <button
              type="button"
              onClick={runAnalysis}
              disabled={running}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={13} className={running ? "animate-spin" : ""} />
              {running ? "Analysing…" : "Run Analysis"}
            </button>
            <span className="text-[10px] text-zinc-600">Powered by Claude Haiku</span>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 rounded-xl px-3 py-2">{error}</p>
          )}

          {result && (
            <div className="bg-zinc-800/60 rounded-xl px-4 py-3 max-h-80 overflow-y-auto">
              <SimpleMarkdown text={result} />
            </div>
          )}

          {!result && !error && !running && (
            <p className="text-xs text-zinc-600">Select an analysis type and click Run Analysis. Each run uses the Claude API.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

function avg(vals: (number | null)[]): number | null {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
}

function Delta({ value, reversed = false, decimals = 0, unit = "" }: {
  value: number | null; reversed?: boolean; decimals?: number; unit?: string;
}) {
  if (value == null || Math.abs(value) < 0.01) return <span className="text-zinc-600 text-xs"> - </span>;
  const up = value > 0;
  const good = reversed ? !up : up;
  return (
    <span className={`text-xs font-semibold ${good ? "text-emerald-400" : "text-red-400"}`}>
      {up ? "+" : ""}{value.toFixed(decimals)}{unit}
    </span>
  );
}

function StatCard({ label, value, unit, delta, deltaReversed = false, deltaDecimals = 0, sparkData, field, onEditSave }: {
  label: string; value: number | null; unit: string;
  delta?: number | null; deltaReversed?: boolean; deltaDecimals?: number;
  sparkData: DailySummary[]; field: "weight" | "steps" | "active_energy" | "water";
  onEditSave?: (v: number) => Promise<void>;
}) {
  const meta = FIELD_META[field];
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const n = parseFloat(editVal);
    if (isNaN(n) || n <= 0 || !onEditSave) return;
    setSaving(true);
    try { await onEditSave(n); } finally { setSaving(false); }
    setEditing(false);
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{label}</span>
        <div className="flex items-center gap-2">
          {onEditSave && !editing && (
            <button
              onClick={() => { setEditVal(value != null ? String(value) : ""); setEditing(true); }}
              className="text-zinc-600 hover:text-zinc-400 transition-colors"
              title="Override weight"
            >
              <Pencil size={11} />
            </button>
          )}
          {delta != null && !editing && <span className="text-xs text-zinc-500">vs prev 7d</span>}
        </div>
      </div>
      {editing ? (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="number" step="0.1" min="30" max="200"
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
            className="w-24 bg-zinc-800 border border-zinc-600 rounded-lg px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            autoFocus
          />
          <span className="text-xs text-zinc-500">{unit}</span>
          <button onClick={handleSave} disabled={saving}
            className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50 transition-colors">
            {saving ? "…" : "Save"}
          </button>
          <button onClick={() => setEditing(false)}
            className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs transition-colors">
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-1.5">
          <span className="text-2xl font-black text-zinc-50 tabular-nums leading-none">
            {fmt(value, meta.decimals)}
          </span>
          {unit && <span className="text-sm text-zinc-500 mb-0.5">{unit}</span>}
        </div>
      )}
      {!editing && (
        <div className="flex items-center justify-between">
          <Sparkline data={sparkData} field={field} color={meta.color} height={36} />
          {delta != null && (
            <Delta value={delta} reversed={deltaReversed} decimals={deltaDecimals} unit={unit ? ` ${unit}` : ""} />
          )}
        </div>
      )}
    </Card>
  );
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  const barColor = pct >= 100 ? "#34d399" : pct >= 75 ? "#fbbf24" : "#f87171";
  return (
    <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor || color }} />
    </div>
  );
}

function TargetBarsCard({
  calories, protein, targetCalories, proteinGoal,
}: { calories: number | null; protein: number | null; targetCalories: number | null; proteinGoal: number | null }) {
  const showCalories = targetCalories != null && targetCalories > 0;
  const showProtein = proteinGoal != null && proteinGoal > 0;
  if (!showCalories && !showProtein) return null;

  const cal = calories ?? 0;
  const prot = protein ?? 0;
  const calDiff = targetCalories ? cal - targetCalories : null;

  return (
    <Card>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Daily targets</p>
      <div className="flex flex-col gap-4">
        {showCalories && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400 font-medium">Calories</span>
              <span className="tabular-nums text-zinc-300">
                {cal.toFixed(0)} / {targetCalories} kcal
                {calDiff != null && (
                  <span className={`ml-2 font-semibold ${calDiff > 0 ? "text-red-400" : "text-emerald-400"}`}>
                    ({calDiff > 0 ? "+" : ""}{calDiff.toFixed(0)} kcal)
                  </span>
                )}
              </span>
            </div>
            <ProgressBar value={cal} max={targetCalories!} color="#34d399" />
          </div>
        )}
        {showProtein && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400 font-medium">Protein</span>
              <span className="tabular-nums text-zinc-300">
                {prot.toFixed(0)} / {proteinGoal} g
                <span className={`ml-2 font-semibold ${prot >= proteinGoal! ? "text-emerald-400" : "text-zinc-500"}`}>
                  ({prot >= proteinGoal! ? "goal met" : `${(proteinGoal! - prot).toFixed(0)}g remaining`})
                </span>
              </span>
            </div>
            <ProgressBar value={prot} max={proteinGoal!} color="#34d399" />
          </div>
        )}
      </div>
    </Card>
  );
}

function GarminMetricCard({ label, value, unit = "" }: { label: string; value: string; unit?: string }) {
  return (
    <Card className="flex flex-col gap-2 min-h-24">
      <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{label}</span>
      <div className="mt-auto flex items-end gap-1.5">
        <span className="text-2xl font-black text-zinc-50 tabular-nums leading-none">{value}</span>
        {unit && <span className="text-sm text-zinc-500 mb-0.5">{unit}</span>}
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Garmin</span>
    </Card>
  );
}

export function Today() {
  const { date: forDate, TODAY } = useActiveDate();
  const end = forDate;
  const start = addDays(forDate, -89);

  const qc = useQueryClient();
  const { data: summary, isLoading, error } = useDashboardSummary(start, end);
  const { data: prefs } = usePreferences();
  const { data: cutData } = useCutPhases();

  const saveWeight = useMutation({
    mutationFn: (weight_kg: number) => api.dailyLog.upsert(forDate, { weight_kg }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard-summary"] }),
  });
  const { data: garminToday } = useQuery({
    queryKey: ["garmin-values", forDate],
    queryFn: () => api.garmin.values(forDate),
    staleTime: 300_000,
  });
  const { data: readiness } = useReadiness(forDate);
  const { data: anomaliesData } = useAnomalies(forDate);
  const streakStart = addDays(forDate, -29);
  const { data: logsData } = useDailyLogs(streakStart, addDays(forDate, -1));
  const activePhase = cutData?.phases.find((p) => !p.end_date || p.end_date >= TODAY) ?? null;
  const cutBannerDay = activePhase
    ? Math.floor((new Date().getTime() - new Date(activePhase.start_date).getTime()) / 86_400_000) + 1
    : null;
  const cutBannerWeek = cutBannerDay !== null ? Math.floor(cutBannerDay / 7) + 1 : null;

  const summaries = summary?.summaries ?? [];
  const today = summaries.find((d) => d.date === forDate) ?? summaries.at(-1) ?? null;
  const yesterday = summaries.at(-2) ?? null;
  const recent7 = summaries.slice(-7);
  const prev7 = summaries.slice(-14, -7);
  const recent14 = summaries.slice(-14);
  const recent30 = summaries.slice(-30);

  const weightDelta7d = useMemo(() => {
    const weights = summaries.filter((d) => d.weight != null).slice(-8);
    if (weights.length < 2) return null;
    return (weights.at(-1)!.weight! - weights[0].weight!);
  }, [summaries]);

  const stepsDelta7d = useMemo(() => {
    const a = avg(recent7.map(d => d.steps));
    const b = avg(prev7.map(d => d.steps));
    return a != null && b != null ? a - b : null;
  }, [recent7, prev7]);

  const activeDelta7d = useMemo(() => {
    const a = avg(recent7.map(d => d.active_energy));
    const b = avg(prev7.map(d => d.active_energy));
    return a != null && b != null ? a - b : null;
  }, [recent7, prev7]);

  const calorieVsYesterday = today && yesterday
    ? (today.calories ?? 0) - (yesterday.calories ?? 0)
    : null;

  // 7d and 30d averages
  const avg7d = {
    calories: avg(recent7.map(d => d.calories)),
    protein: avg(recent7.map(d => d.protein)),
    carbohydrates: avg(recent7.map(d => d.carbohydrates)),
    fat: avg(recent7.map(d => d.fat)),
    weight: avg(recent7.filter(d => d.weight != null).map(d => d.weight)),
  };
  const avg30d = {
    calories: avg(recent30.map(d => d.calories)),
    protein: avg(recent30.map(d => d.protein)),
    carbohydrates: avg(recent30.map(d => d.carbohydrates)),
    fat: avg(recent30.map(d => d.fat)),
    weight: avg(recent30.filter(d => d.weight != null).map(d => d.weight)),
  };

  // Macro % of calories (9 kcal/g fat, 4 kcal/g protein+carbs)
  const macroKcal = today ? {
    protein: (today.protein ?? 0) * 4,
    carbs: (today.carbohydrates ?? 0) * 4,
    fat: (today.fat ?? 0) * 9,
  } : null;
  const totalMacroKcal = macroKcal ? macroKcal.protein + macroKcal.carbs + macroKcal.fat : 0;

  const logStreak = useMemo(() => {
    const logs = logsData?.logs ?? [];
    const logSet = new Set(logs.map(l => l.log_date));
    let streak = 0;
    let d = addDays(forDate, -1);
    for (let i = 0; i < 30; i++) {
      if (logSet.has(d)) { streak++; d = addDays(d, -1); }
      else break;
    }
    return streak;
  }, [logsData, forDate]);

  const rangeDays = prefs?.preferred_range_days ?? 30;
  const heatmapData = summaries.slice(-rangeDays);

  // Goal projection (weight, active phase with target_weight_kg)
  const goalProjection = useMemo(() => {
    if (!activePhase?.target_weight_kg) return null;
    const weightPoints = summaries
      .filter(d => d.weight != null)
      .slice(-14)
      .map((d, i) => ({ x: i, y: d.weight! }));
    if (weightPoints.length < 3) return null;
    const reg = linearRegression(weightPoints);
    if (!reg) return null;
    const lastIdx = weightPoints.length - 1;
    const daysToGoal = projectDaysToTarget(reg, lastIdx, activePhase.target_weight_kg);
    const ratePerWeek = weightRatePerWeek(reg);
    return { daysToGoal, ratePerWeek };
  }, [summaries, activePhase]);
  const hasGarminRecovery = Boolean(
    garminToday?.sleep_minutes != null ||
    garminToday?.sleep_score != null ||
    garminToday?.resting_heart_rate != null ||
    garminToday?.hrv_overnight != null
  );

  if (isLoading) return (
    <div className="p-6 flex items-center justify-center h-64">
      <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
    </div>
  );

  if (error) return (
    <div className="p-6 text-red-400 text-sm">Failed to load data.</div>
  );

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-zinc-50">
            {forDate === TODAY ? "Today" : formatDdMmYyyy(forDate)}
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {today ? formatShortDate(today.date) : "No data yet"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {logStreak >= 2 && (
            <span className="text-xs font-semibold text-amber-400 bg-amber-500/10 border border-amber-700/40 px-2.5 py-1 rounded-full">
              🔥 {logStreak}d streak
            </span>
          )}
          {calorieVsYesterday != null && (
            <div className="text-right">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wide">vs yesterday</p>
              <Delta value={calorieVsYesterday} decimals={0} unit=" kcal" reversed={false} />
            </div>
          )}
        </div>
      </div>

      {/* Anomaly chips */}
      {anomaliesData?.anomalies && anomaliesData.anomalies.length > 0 && (
        <AnomalyStrip anomalies={anomaliesData.anomalies as any} />
      )}

      {/* Cut phase banner */}
      {activePhase && cutBannerWeek !== null && cutBannerDay !== null && (
        <Link
          to="/cut-phases"
          className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-700/50 hover:bg-emerald-500/15 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-emerald-400">{activePhase.name}</span>
            <span className="text-xs text-zinc-400">
              Week {cutBannerWeek} - Day {cutBannerDay}
            </span>
          </div>
          {activePhase.target_calories && (
            <span className="text-xs text-zinc-500">
              Target {activePhase.target_calories} kcal
            </span>
          )}
        </Link>
      )}

      {/* Goal projection pill */}
      {goalProjection && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="font-semibold text-emerald-400">
            {goalProjection.daysToGoal != null
              ? `${goalProjection.daysToGoal}d to goal`
              : "Ahead of goal"}
          </span>
          <span className="text-zinc-600">at current pace</span>
          <span className={`font-medium tabular-nums ${goalProjection.ratePerWeek < 0 ? "text-emerald-400" : "text-zinc-500"}`}>
            ({goalProjection.ratePerWeek > 0 ? "+" : ""}{goalProjection.ratePerWeek.toFixed(2)} kg/wk)
          </span>
        </div>
      )}

      <TargetBarsCard
        calories={today?.calories ?? null}
        protein={today?.protein ?? null}
        targetCalories={activePhase?.target_calories ?? null}
        proteinGoal={prefs?.protein_goal_g ?? null}
      />

      {/* Hero  -  ring + macros */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="flex items-center justify-center py-6">
          <CalorieRing
            calories={today?.calories ?? null}
            protein={today?.protein ?? null}
            carbohydrates={today?.carbohydrates ?? null}
            fat={today?.fat ?? null}
          />
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-4 flex-1">
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Macros</p>
              <MacroStack today={today} recent={recent7} />
            </div>

            {/* Macro % breakdown */}
            {macroKcal && totalMacroKcal > 0 && (
              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Calorie split</p>
                <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
                  <div style={{ width: `${(macroKcal.protein / totalMacroKcal) * 100}%`, background: "#34d399" }} />
                  <div style={{ width: `${(macroKcal.carbs / totalMacroKcal) * 100}%`, background: "#60a5fa" }} />
                  <div style={{ width: `${(macroKcal.fat / totalMacroKcal) * 100}%`, background: "#c084fc" }} />
                </div>
                <div className="flex justify-between mt-1.5 text-[10px] text-zinc-500">
                  <span style={{ color: "#34d399" }}>P {Math.round((macroKcal.protein / totalMacroKcal) * 100)}%</span>
                  <span style={{ color: "#60a5fa" }}>C {Math.round((macroKcal.carbs / totalMacroKcal) * 100)}%</span>
                  <span style={{ color: "#c084fc" }}>F {Math.round((macroKcal.fat / totalMacroKcal) * 100)}%</span>
                </div>
              </div>
            )}

            {today?.water != null && (
              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Water</p>
                <span className="text-xl font-black text-zinc-100">{fmt(today.water, 0)}</span>
                <span className="text-sm text-zinc-500 ml-1">mL</span>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard
          label="Weight"
          value={today?.weight ?? null}
          unit="kg"
          delta={weightDelta7d}
          deltaReversed={true}
          deltaDecimals={1}
          sparkData={recent30}
          field="weight"
          onEditSave={(v) => saveWeight.mutateAsync(v).then(() => {})}
        />
        <StatCard
          label="Steps"
          value={today?.steps ?? null}
          unit=""
          delta={stepsDelta7d}
          sparkData={recent30}
          field="steps"
        />
        <StatCard
          label="Active Energy"
          value={today?.active_energy ?? null}
          unit="kcal"
          delta={activeDelta7d}
          sparkData={recent30}
          field="active_energy"
        />
      </div>

      {hasGarminRecovery && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <GarminMetricCard
            label="Sleep"
            value={formatMinutesAsHoursMinutes(garminToday?.sleep_minutes)}
          />
          <GarminMetricCard
            label="Sleep Score"
            value={fmt(garminToday?.sleep_score, 0)}
          />
          <GarminMetricCard
            label="Resting HR"
            value={fmt(garminToday?.resting_heart_rate, 0)}
            unit="bpm"
          />
          <GarminMetricCard
            label="Overnight HRV"
            value={fmt(garminToday?.hrv_overnight, 0)}
            unit="ms"
          />
        </div>
      )}

      {hasGarminRecovery && readiness && (
        <ReadinessCard report={readiness} />
      )}

      {/* Averages strip */}
      <Card>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Rolling averages</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(["calories", "protein", "carbohydrates", "fat"] as const).map(f => {
            const meta = FIELD_META[f];
            const d7 = avg7d[f as keyof typeof avg7d];
            const d30 = avg30d[f as keyof typeof avg30d];
            const delta = d7 != null && d30 != null ? d7 - d30 : null;
            return (
              <div key={f}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wide font-semibold">{meta.label}</span>
                </div>
                <p className="text-sm font-bold text-zinc-100 tabular-nums">
                  {fmt(d7, meta.decimals)}
                  <span className="text-zinc-600 font-normal text-xs ml-0.5">{meta.unit}</span>
                </p>
                <p className="text-[10px] text-zinc-600 mt-0.5">
                  30d: {fmt(d30, meta.decimals)}{meta.unit}
                  {delta != null && (
                    <span className={`ml-1 ${Math.abs(delta) < 0.5 ? "text-zinc-600" : delta > 0 ? "text-emerald-500" : "text-red-500"}`}>
                      ({delta > 0 ? "+" : ""}{fmt(delta, meta.decimals)})
                    </span>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* 30-day calorie heatmap */}
      <Card>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
          Calorie consistency  -  {rangeDays} days
        </p>
        <CalendarHeatmap data={heatmapData} />
      </Card>

      {/* Recent 14 days table */}
      <Card>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Recent 14 days</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-800">
                <th className="text-left py-2 pr-3 font-semibold">Date</th>
                <th className="text-right py-2 px-2 font-semibold">Calories</th>
                <th className="text-right py-2 px-2 font-semibold">Protein</th>
                <th className="text-right py-2 px-2 font-semibold">Carbs</th>
                <th className="text-right py-2 px-2 font-semibold">Fat</th>
                <th className="text-right py-2 pl-2 font-semibold">Weight</th>
              </tr>
            </thead>
            <tbody>
              {[...recent14].reverse().map((d) => {
                const isSelected = d.date === forDate;
                return (
                  <tr key={d.date} className={`border-t border-zinc-800/60 hover:bg-zinc-800/30 transition-colors ${isSelected ? "bg-zinc-800/20" : ""}`}>
                    <td className={`py-2 pr-3 ${isSelected ? "text-emerald-400 font-semibold" : "text-zinc-400"}`}>
                      {formatShortDate(d.date)}{isSelected ? " -" : ""}
                    </td>
                    <td className="py-2 px-2 text-right font-semibold text-zinc-100 tabular-nums">{fmt(d.calories, 0)}</td>
                    <td className="py-2 px-2 text-right text-zinc-300 tabular-nums">{fmt(d.protein, 0)}g</td>
                    <td className="py-2 px-2 text-right text-zinc-300 tabular-nums">{fmt(d.carbohydrates, 0)}g</td>
                    <td className="py-2 px-2 text-right text-zinc-300 tabular-nums">{fmt(d.fat, 0)}g</td>
                    <td className="py-2 pl-2 text-right text-zinc-400 tabular-nums">{fmt(d.weight, 1)}</td>
                  </tr>
                );
              })}
            </tbody>
            {/* 7d average footer */}
            <tfoot>
              <tr className="border-t-2 border-zinc-700 text-zinc-400 bg-zinc-800/30">
                <td className="py-2 pr-3 font-semibold text-zinc-500">7d avg</td>
                <td className="py-2 px-2 text-right font-semibold tabular-nums">{fmt(avg7d.calories, 0)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmt(avg7d.protein, 0)}g</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmt(avg7d.carbohydrates, 0)}g</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmt(avg7d.fat, 0)}g</td>
                <td className="py-2 pl-2 text-right tabular-nums">{fmt(avg7d.weight, 1)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <AiInsightCard forDate={forDate} />
    </div>
  );
}
