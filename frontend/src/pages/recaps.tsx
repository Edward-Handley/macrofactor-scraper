import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type WeeklyRecap } from "../lib/api";
import { RefreshCw, Sparkles, ChevronDown, ChevronUp } from "lucide-react";

function RecapCard({ recap }: { recap: WeeklyRecap }) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const regenerate = useMutation({
    mutationFn: () => api.weeklyRecap.regenerate(recap.week_start_date),
    onMutate: () => setGenerating(true),
    onSettled: () => setGenerating(false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weekly-recaps-list"] });
    },
  });

  const weekEnd = new Date(recap.week_start_date);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-zinc-200">
            {recap.week_start_date} — {weekEndStr}
          </p>
          <p className="text-[10px] text-zinc-600 mt-0.5">
            {new Date(recap.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => regenerate.mutate()}
            disabled={generating}
            className="text-zinc-600 hover:text-zinc-300 transition-colors disabled:opacity-50"
            title="Regenerate"
          >
            <RefreshCw size={13} className={generating ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {recap.highlights.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {recap.highlights.map((h, i) => (
            <span key={i} className="text-[11px] bg-violet-500/10 text-violet-300 border border-violet-700/40 rounded-full px-2.5 py-0.5">
              {h}
            </span>
          ))}
        </div>
      )}

      {expanded && (
        <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap pt-1 border-t border-zinc-800">
          {recap.narrative}
        </p>
      )}
    </div>
  );
}

export function Recaps() {
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["weekly-recaps-list"],
    queryFn: () => api.weeklyRecap.list(),
    staleTime: 300_000,
  });

  const today = new Date().toISOString().slice(0, 10);
  const [y, m, d] = today.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisWeekStart = new Date(Date.UTC(y, m - 1, d - daysBack)).toISOString().slice(0, 10);

  const generateThis = useMutation({
    mutationFn: () => api.weeklyRecap.regenerate(thisWeekStart),
    onMutate: () => setGenerating(true),
    onSettled: () => setGenerating(false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weekly-recaps-list"] });
    },
  });

  const recaps = data?.recaps ?? [];
  const hasThisWeek = recaps.some(r => r.week_start_date === thisWeekStart);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-zinc-50">Weekly Recaps</h1>
          <p className="text-sm text-zinc-500 mt-0.5">AI-generated weekly narratives</p>
        </div>
        {!hasThisWeek && (
          <button
            onClick={() => generateThis.mutate()}
            disabled={generating}
            className="flex items-center gap-2 text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            <Sparkles size={14} />
            {generating ? "Generating…" : "Generate this week"}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-7 h-7 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
        </div>
      ) : recaps.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center space-y-3">
          <Sparkles size={28} className="text-violet-400 mx-auto" />
          <p className="text-zinc-400 text-sm">No recaps yet.</p>
          <p className="text-zinc-600 text-xs">
            Recaps generate automatically every Sunday at 19:00, or you can generate one on demand.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {recaps.map(r => (
            <RecapCard key={r.week_start_date} recap={r} />
          ))}
        </div>
      )}
    </div>
  );
}
