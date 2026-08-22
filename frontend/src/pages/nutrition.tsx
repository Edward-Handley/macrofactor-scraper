import { useQuery } from "@tanstack/react-query";
import { Flame, Waves } from "lucide-react";
import { api } from "../lib/api";
import { fmt, formatShortDate } from "../lib/format";
import { useActiveDate } from "../hooks/use-active-date";
import { MacroBar } from "./nutrition/components/MacroBar";
import { AlertCard } from "./nutrition/components/AlertCard";
import { MealSuggestionCard } from "./nutrition/components/MealSuggestionCard";

const SCENARIO_META: Record<string, { label: string; className: string }> = {
  double_wp: { label: "Double Water Polo", className: "text-orange-400" },
  double_mixed: { label: "Double Session (Mixed)", className: "text-cyan-400" },
  single: { label: "Single Training", className: "text-emerald-400" },
  rest: { label: "Rest / Recovery", className: "text-zinc-400" },
};

export function Nutrition() {
  const { date: activeDate, prev, next, isToday } = useActiveDate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["nutrition-intelligence", activeDate],
    queryFn: () => api.nutrition.intelligence(activeDate),
    staleTime: 120_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const scenario = data ? SCENARIO_META[data.classification_intensity] : null;
  const errorMessage = error instanceof Error ? error.message : null;
  const notConfigured = errorMessage?.includes("503");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Flame size={18} className="text-orange-400" />
            Nutrition Intelligence
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2">
            <button type="button" onClick={prev} className="text-zinc-400 hover:text-zinc-200 px-1">‹</button>
            {formatShortDate(activeDate)}
            {!isToday && (
              <button type="button" onClick={next} className="text-zinc-400 hover:text-zinc-200 px-1">›</button>
            )}
          </p>
        </div>
        {data && scenario && (
          <div className="text-right">
            <p className={`text-xs font-semibold flex items-center gap-1 justify-end ${scenario.className}`}>
              <Waves size={13} />
              {scenario.label}
            </p>
            {data.estimated_training_hours != null && (
              <p className="text-[11px] text-zinc-500">
                ~{fmt(data.estimated_training_hours, 1)} hrs
              </p>
            )}
          </div>
        )}
      </div>

      {notConfigured && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4">
          <p className="text-sm text-zinc-300 font-semibold">MacroFactor not configured</p>
          <p className="text-xs text-zinc-500 mt-1">
            Set MACROFACTOR_USERNAME, MACROFACTOR_PASSWORD, and FIREBASE_WEB_API_KEY to enable
            nutrition intelligence.
          </p>
        </div>
      )}

      {isLoading && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-6 text-center">
          <p className="text-sm text-zinc-400">Loading nutrition data…</p>
        </div>
      )}

      {data && (
        <>
          {/* Macros vs targets */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 space-y-4">
            <h2 className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
              Macros — vs Athletic Targets
            </h2>
            <MacroBar
              label="Carbs"
              actual={data.actual_macros.carbs_g}
              low={data.target_macros.carbs_low}
              high={data.target_macros.carbs_high}
              unit="g"
            />
            <MacroBar
              label="Protein"
              actual={data.actual_macros.protein_g}
              low={data.target_macros.protein_low}
              high={data.target_macros.protein_high}
              unit="g"
            />
            <MacroBar
              label="Fat"
              actual={data.actual_macros.fat_g}
              low={data.target_macros.fat_low}
              high={data.target_macros.fat_high}
              unit="g"
            />
            <MacroBar
              label="Calories"
              actual={data.actual_macros.calories}
              low={data.target_macros.calories_low}
              high={data.target_macros.calories_high}
              unit=" kcal"
            />
          </section>

          {/* Alerts */}
          {data.alerts.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase px-1">
                Alerts
              </h2>
              {data.alerts.map((alert, i) => (
                <AlertCard key={`${alert.category}-${i}`} alert={alert} />
              ))}
            </section>
          )}

          {/* Meal suggestions */}
          {data.meal_suggestions.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase px-1">
                Meal Suggestions
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.meal_suggestions.map((s) => (
                  <MealSuggestionCard key={s.title} suggestion={s} />
                ))}
              </div>
            </section>
          )}

          {/* MacroFactor comparison */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 space-y-2">
            <h2 className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
              MacroFactor vs Athletic Needs
            </h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[11px] text-zinc-500">MacroFactor recommends</p>
                <p className="font-semibold text-zinc-100">
                  {data.macrofactor_vs_goals.macrofactor_daily_calories != null
                    ? `${fmt(data.macrofactor_vs_goals.macrofactor_daily_calories)} kcal/day`
                    : "unavailable"}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-zinc-500">Your athletic needs</p>
                <p className="font-semibold text-emerald-400">
                  {fmt(data.macrofactor_vs_goals.athletic_low)}–
                  {fmt(data.macrofactor_vs_goals.athletic_high)} kcal/day
                </p>
              </div>
            </div>
            {data.macrofactor_vs_goals.gap != null && (
              <p className="text-xs text-zinc-400">
                Gap:{" "}
                <span className="font-semibold text-zinc-200">
                  {fmt(data.macrofactor_vs_goals.gap)} kcal/day
                </span>{" "}
                {data.macrofactor_vs_goals.gap < 0 ? "(significant deficit vs athletic needs)" : ""}
              </p>
            )}
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              MacroFactor auto-adjusts from intake and weight trend — it doesn't factor in
              competitive water polo demands. Use this tab as the guide on training days.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
