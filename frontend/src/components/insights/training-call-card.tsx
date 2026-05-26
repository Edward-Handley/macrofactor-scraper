import { useMutation } from "@tanstack/react-query";
import { Bot, ChevronDown, ChevronUp, Dumbbell, Zap, Minus, Moon } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";

type Call = "push" | "maintain" | "deload" | "rest";

const CALL_CONFIG: Record<Call, { icon: React.ReactNode; label: string; pill: string; score: string }> = {
  push: {
    icon: <Zap size={18} strokeWidth={2.5} />,
    label: "Push today",
    pill: "bg-emerald-500/20 text-emerald-400 border border-emerald-700/50",
    score: "text-emerald-400",
  },
  maintain: {
    icon: <Dumbbell size={18} strokeWidth={2} />,
    label: "Normal session",
    pill: "bg-blue-500/20 text-blue-400 border border-blue-700/50",
    score: "text-blue-400",
  },
  deload: {
    icon: <Minus size={18} strokeWidth={2} />,
    label: "Deload / accessories",
    pill: "bg-amber-500/20 text-amber-400 border border-amber-700/50",
    score: "text-amber-400",
  },
  rest: {
    icon: <Moon size={18} strokeWidth={2} />,
    label: "Rest day",
    pill: "bg-red-500/20 text-red-400 border border-red-700/50",
    score: "text-red-400",
  },
};

interface TrainingCallData {
  date: string;
  call: string;
  reasons: string[];
  confidence: number;
}

export function TrainingCallCard({ data, date }: { data: TrainingCallData; date: string }) {
  const [showAi, setShowAi] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);

  const aiMutation = useMutation({
    mutationFn: () => api.ai.analyse("recovery", date),
    onSuccess: (res) => setAiText(res.analysis),
  });

  const cfg = CALL_CONFIG[data.call as Call] ?? CALL_CONFIG.maintain;
  const confidencePct = Math.round(data.confidence * 100);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Training Call</p>
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${cfg.pill}`}>
          {cfg.label}
        </span>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className={`${cfg.score}`}>{cfg.icon}</div>
        <div className="flex-1">
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                data.call === "push" ? "bg-emerald-500" :
                data.call === "maintain" ? "bg-blue-500" :
                data.call === "deload" ? "bg-amber-500" : "bg-red-500"
              }`}
              style={{ width: `${confidencePct}%` }}
            />
          </div>
          <p className="text-[10px] text-zinc-600 mt-0.5">{confidencePct}% confidence</p>
        </div>
      </div>

      <ul className="space-y-1 mb-3">
        {data.reasons.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-zinc-400">
            <span className="mt-0.5 w-1 h-1 rounded-full bg-zinc-600 shrink-0" />
            {r}
          </li>
        ))}
      </ul>

      <button
        onClick={() => {
          setShowAi((v) => !v);
          if (!aiText && !aiMutation.isPending) aiMutation.mutate();
        }}
        className="flex items-center gap-1.5 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        <Bot size={12} />
        {showAi ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        AI rationale
      </button>

      {showAi && (
        <div className="mt-2 pt-2 border-t border-zinc-800 text-xs text-zinc-400 leading-relaxed">
          {aiMutation.isPending ? (
            <span className="text-zinc-600 animate-pulse">Generating…</span>
          ) : aiMutation.isError ? (
            <span className="text-red-400">AI unavailable</span>
          ) : (
            aiText
          )}
        </div>
      )}
    </div>
  );
}
