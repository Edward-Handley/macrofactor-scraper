import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Flame } from "lucide-react";

interface Streak {
  key: string;
  label: string;
  current: number;
  longest: number;
  milestone_next: number;
}

interface Badge {
  key: string;
  label: string;
  description: string;
  icon: string;
  category: string;
  earned: boolean;
}

function StreakBar({ streak }: { streak: Streak }) {
  const pct = streak.milestone_next > 0
    ? Math.min((streak.current / streak.milestone_next) * 100, 100)
    : 100;
  const isActive = streak.current > 0;

  return (
    <div className={`bg-zinc-900 border rounded-2xl p-4 ${isActive ? "border-emerald-800" : "border-zinc-800"}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-zinc-200">{streak.label}</p>
        <div className="flex items-center gap-1.5">
          {isActive && <Flame size={14} className="text-orange-400" />}
          <span className={`text-xl font-black tabular-nums ${isActive ? "text-emerald-400" : "text-zinc-600"}`}>
            {streak.current}
          </span>
          <span className="text-xs text-zinc-600">days</span>
        </div>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-1">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-zinc-600">
        <span>Best: {streak.longest}d</span>
        <span>Next: {streak.milestone_next}d</span>
      </div>
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  logging: "Logging",
  recovery: "Recovery",
  nutrition: "Nutrition",
  tracking: "Tracking",
  training: "Training",
  body: "Body Composition",
  activity: "Activity",
};

export function Achievements() {
  const { data: streaksData, isLoading: streaksLoading } = useQuery({
    queryKey: ["streaks"],
    queryFn: () => api.streaks.list(),
    staleTime: 300_000,
  });

  const { data: badgesData, isLoading: badgesLoading } = useQuery({
    queryKey: ["badges"],
    queryFn: () => api.badges.list(),
    staleTime: 300_000,
  });

  const isLoading = streaksLoading || badgesLoading;

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  const streaks = streaksData?.streaks ?? [];
  const badges = badgesData?.badges ?? [];
  const earnedCount = badgesData?.earned_count ?? 0;
  const total = badgesData?.total ?? 0;

  // Group badges by category
  const byCategory = badges.reduce<Record<string, Badge[]>>((acc, b) => {
    (acc[b.category] = acc[b.category] ?? []).push(b);
    return acc;
  }, {});

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-zinc-50">Achievements</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          {earnedCount} / {total} badges earned
        </p>
      </div>

      {/* Streaks */}
      <div>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Active Streaks</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {streaks.map((s) => (
            <StreakBar key={s.key} streak={s} />
          ))}
        </div>
      </div>

      {/* Badges by category */}
      {Object.entries(byCategory).map(([cat, catBadges]) => (
        <div key={cat}>
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            {CATEGORY_LABELS[cat] ?? cat}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {catBadges.map((b) => (
              <div
                key={b.key}
                className={`rounded-2xl p-3 border flex flex-col gap-1 transition-all ${
                  b.earned
                    ? "bg-zinc-900 border-emerald-700/50"
                    : "bg-zinc-950 border-zinc-800 opacity-50"
                }`}
              >
                <span className="text-2xl">{b.icon}</span>
                <p className={`text-xs font-bold ${b.earned ? "text-zinc-100" : "text-zinc-600"}`}>
                  {b.label}
                </p>
                <p className="text-[10px] text-zinc-600 leading-tight">{b.description}</p>
                {b.earned && (
                  <span className="self-start mt-1 text-[9px] font-bold uppercase tracking-wide text-emerald-500">
                    Earned
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
