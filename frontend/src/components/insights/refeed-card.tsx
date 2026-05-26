import { Flame } from "lucide-react";
import { Link } from "react-router-dom";

interface RefeedData {
  should_refeed: boolean;
  reasons: string[];
  suggested_kcal_bump: number;
  suggested_kcal_target: number | null;
  suggested_days: number;
  days_into_cut: number;
}

export function RefeedCard({ data }: { data: RefeedData }) {
  if (!data.should_refeed) return null;

  return (
    <div className="bg-orange-950/40 border border-orange-700/40 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Flame size={16} className="text-orange-400" />
        <p className="text-xs font-semibold text-orange-400 uppercase tracking-wide">Refeed suggested</p>
        <span className="ml-auto text-[10px] text-orange-600">Day {data.days_into_cut} of cut</span>
      </div>

      <p className="text-sm text-zinc-300 mb-2">
        Your body is showing signs of metabolic stress. A {data.suggested_days}-day refeed may help.
      </p>

      <ul className="space-y-1 mb-3">
        {data.reasons.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-zinc-400">
            <span className="mt-0.5 w-1 h-1 rounded-full bg-orange-600 shrink-0" />
            {r}
          </li>
        ))}
      </ul>

      {data.suggested_kcal_target != null && (
        <div className="flex items-center gap-3 p-3 bg-orange-500/10 rounded-xl mb-3">
          <div>
            <p className="text-[10px] text-orange-600 mb-0.5">Suggested refeed target</p>
            <p className="text-sm font-bold text-orange-300">{data.suggested_kcal_target} kcal / day</p>
            <p className="text-[10px] text-zinc-600">+{data.suggested_kcal_bump} kcal above cut target · {data.suggested_days} day{data.suggested_days > 1 ? "s" : ""}</p>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Link
          to="/morning"
          className="flex-1 text-center text-xs font-semibold py-2 px-3 rounded-lg bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors"
        >
          Log morning
        </Link>
        <Link
          to="/cut-phases"
          className="flex-1 text-center text-xs font-semibold py-2 px-3 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          Cut phases
        </Link>
      </div>
    </div>
  );
}
