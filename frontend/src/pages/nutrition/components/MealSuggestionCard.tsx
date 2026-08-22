import { Utensils } from "lucide-react";
import { fmt } from "../../../lib/format";
import type { MealSuggestion } from "../../../lib/types";

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-emerald-500/15 text-emerald-400",
  medium: "bg-sky-500/15 text-sky-400",
  low: "bg-zinc-700/40 text-zinc-400",
};

export function MealSuggestionCard({ suggestion }: { suggestion: MealSuggestion }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Utensils size={14} className="text-orange-400 shrink-0" />
          <p className="text-sm font-semibold text-zinc-100 truncate">{suggestion.title}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_BADGE[suggestion.priority] ?? PRIORITY_BADGE.low}`}
        >
          {suggestion.priority}
        </span>
      </div>
      <p className="text-xs text-zinc-400 mt-1">{suggestion.description}</p>
      <p className="text-[11px] text-zinc-500 mt-1.5">
        +{fmt(suggestion.carbs_g)}g carbs · +{fmt(suggestion.protein_g)}g protein · +
        {fmt(suggestion.calories)} kcal
      </p>
    </div>
  );
}
