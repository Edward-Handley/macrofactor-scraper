import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, Legend,
} from "recharts";
import type { DailySummary, DailyLog } from "../../lib/types";

interface RadarProfileProps {
  currentWeekSummaries: DailySummary[];
  priorWeekSummaries: DailySummary[];
  currentWeekLogs: DailyLog[];
  priorWeekLogs: DailyLog[];
  proteinGoalG?: number | null;
}

function clamp(v: number, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }

function avg(vals: (number | null | undefined)[]): number | null {
  const clean = vals.filter((v): v is number => v != null && isFinite(v));
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
}

function scoreAxis(value: number | null, target: number, invert = false): number {
  if (value == null || target <= 0) return 0;
  const ratio = value / target;
  const raw = invert ? (1 - Math.min(ratio, 2)) : Math.min(ratio, 1);
  return clamp(Math.round(raw * 100));
}

function buildRadarData(
  summaries: DailySummary[],
  logs: DailyLog[],
  targets: Record<string, number>,
): { axis: string; score: number }[] {
  // Sleep: target 8h
  const sleepVals = logs.map((l) => l.sleep_hours).filter((v): v is number => v != null);
  const sleepScore = scoreAxis(avg(sleepVals), targets.sleep);

  // Protein: goal g
  const protVals = summaries.map((s) => s.protein).filter((v): v is number => v != null);
  const protScore = scoreAxis(avg(protVals), targets.protein);

  // Steps: target 8000
  const stepVals = summaries.map((s) => s.steps).filter((v): v is number => v != null);
  const stepScore = scoreAxis(avg(stepVals), targets.steps);

  // HRV: baseline (P60 of all values used as 100%)
  const hrvVals = logs.map((l) => l.hrv_overnight).filter((v): v is number => v != null);
  const hrvScore = scoreAxis(avg(hrvVals), targets.hrv);

  // Training sessions (gym_done): target 4/week
  const gymDays = logs.filter((l) => l.gym_done).length;
  const gymScore = clamp(Math.round((gymDays / targets.gymDays) * 100));

  // Recovery proxy: AM energy 1-10 → score
  const energyVals = logs.map((l) => l.am_energy).filter((v): v is number => v != null);
  const energyScore = scoreAxis(avg(energyVals), targets.energy);

  return [
    { axis: "Sleep",    score: sleepScore   },
    { axis: "Protein",  score: protScore    },
    { axis: "Steps",    score: stepScore    },
    { axis: "HRV",      score: hrvScore     },
    { axis: "Training", score: gymScore     },
    { axis: "Energy",   score: energyScore  },
  ];
}

function deriveTargets(
  priorLogs: DailyLog[],
  priorSummaries: DailySummary[],
  proteinGoalG: number | null | undefined,
): Record<string, number> {
  const sleepVals = priorLogs.map((l) => l.sleep_hours).filter((v): v is number => v != null).sort((a, b) => a - b);
  const p75Sleep = sleepVals.length ? sleepVals[Math.floor(sleepVals.length * 0.75)] : 7.5;

  const hrvVals = priorLogs.map((l) => l.hrv_overnight).filter((v): v is number => v != null).sort((a, b) => a - b);
  const p75HRV = hrvVals.length ? hrvVals[Math.floor(hrvVals.length * 0.75)] : 50;

  const stepVals = priorSummaries.map((s) => s.steps).filter((v): v is number => v != null).sort((a, b) => a - b);
  const p75Steps = stepVals.length ? stepVals[Math.floor(stepVals.length * 0.75)] : 8000;

  return {
    sleep: p75Sleep || 7.5,
    protein: proteinGoalG || 150,
    steps: p75Steps || 8000,
    hrv: p75HRV || 50,
    gymDays: 4,
    energy: 7,
  };
}

export function RadarProfile({
  currentWeekSummaries,
  priorWeekSummaries,
  currentWeekLogs,
  priorWeekLogs,
  proteinGoalG,
}: RadarProfileProps) {
  const targets = deriveTargets(priorWeekLogs, priorWeekSummaries, proteinGoalG);
  const currentData = buildRadarData(currentWeekSummaries, currentWeekLogs, targets);
  const priorData = buildRadarData(priorWeekSummaries, priorWeekLogs, targets);

  const chartData = currentData.map((d, i) => ({
    axis: d.axis,
    "This week": d.score,
    "Prior week": priorData[i]?.score ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={chartData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
        <PolarGrid stroke="#27272a" />
        <PolarAngleAxis
          dataKey="axis"
          tick={{ fill: "#71717a", fontSize: 11 }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tick={{ fill: "#52525b", fontSize: 9 }}
          tickCount={4}
        />
        <Radar
          name="This week"
          dataKey="This week"
          stroke="#10b981"
          fill="#10b981"
          fillOpacity={0.2}
          strokeWidth={2}
        />
        <Radar
          name="Prior week"
          dataKey="Prior week"
          stroke="#6366f1"
          fill="#6366f1"
          fillOpacity={0.1}
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
        <Legend wrapperStyle={{ fontSize: 11, color: "#71717a" }} />
        <Tooltip
          contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#a1a1aa" }}
          itemStyle={{ color: "#e4e4e7" }}
          formatter={(value) => [`${value}/100`, undefined]}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
