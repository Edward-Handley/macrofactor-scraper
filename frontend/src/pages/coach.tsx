import { useState, useEffect } from "react";
import { useCoachDraft } from "../hooks/use-daily-log";
import { useActiveDate } from "../hooks/use-active-date";
import { useAnomalies } from "../hooks/use-dashboard";
import { ClipboardCopy, Check, RefreshCw, ExternalLink, ChevronDown, ChevronUp, History, X } from "lucide-react";
import { saveCoachEntry, listCoachHistory, type CoachHistoryEntry } from "../lib/coach-history";
import { formatDdMmYyyy } from "../lib/format";

const FRAMING_OPTIONS = [
  { kind: "check_in",    label: "Daily check-in",    color: "violet" },
  { kind: "weekly",      label: "Weekly review",      color: "blue"   },
  { kind: "plateau",     label: "Plateau debug",      color: "amber"  },
  { kind: "cut_reassess",label: "Cut reassess",       color: "emerald"},
] as const;

const FRAMING_COLORS: Record<string, { active: string; base: string }> = {
  violet:  { active: "bg-violet-600 border-violet-600 text-white", base: "border-zinc-700 text-zinc-500 hover:text-zinc-300" },
  blue:    { active: "bg-blue-600 border-blue-600 text-white",     base: "border-zinc-700 text-zinc-500 hover:text-zinc-300" },
  amber:   { active: "bg-amber-600 border-amber-600 text-white",   base: "border-zinc-700 text-zinc-500 hover:text-zinc-300" },
  emerald: { active: "bg-emerald-600 border-emerald-600 text-white", base: "border-zinc-700 text-zinc-500 hover:text-zinc-300" },
};

function ContextPreview({ promptText }: { promptText: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">What Claude will see</span>
        {open ? <ChevronUp size={15} className="text-zinc-600" /> : <ChevronDown size={15} className="text-zinc-600" />}
      </button>
      {open && (
        <div className="px-4 pb-4">
          <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
            {promptText}
          </pre>
        </div>
      )}
    </div>
  );
}

function HistorySidebar({ onSelect, onClose }: {
  onSelect: (entry: CoachHistoryEntry) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<CoachHistoryEntry[]>([]);

  useEffect(() => {
    listCoachHistory().then(setEntries);
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div
        className="w-80 bg-zinc-900 border-l border-zinc-800 h-full overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">Prompt history</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X size={16} />
          </button>
        </div>
        {entries.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-8">No history yet — copy a prompt to save it.</p>
        ) : (
          <div className="flex flex-col">
            {entries.map((e) => (
              <button
                key={e.id}
                onClick={() => { onSelect(e); onClose(); }}
                className="px-4 py-3 text-left border-b border-zinc-800/60 hover:bg-zinc-800/40 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-zinc-300">{formatDdMmYyyy(e.date)}</span>
                  <span className="text-[10px] text-zinc-600 uppercase tracking-wide">{e.kindLabel}</span>
                </div>
                <p className="text-xs text-zinc-500 truncate">{e.preview}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Coach() {
  const { date: forDate } = useActiveDate();
  const [kind, setKind] = useState<string>("check_in");
  const { data, isLoading, error, refetch, isFetching } = useCoachDraft(forDate, kind);
  const { data: anomaliesData } = useAnomalies(forDate);

  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (data?.prompt_text) {
      // Append anomaly context if any
      let prompt = data.prompt_text;
      const anomalies = anomaliesData?.anomalies ?? [];
      if (anomalies.length > 0) {
        const anomalyBlock = "\n\n### Detected anomalies\n" + anomalies.map(a => `- ${a.label}: ${a.detail}`).join("\n");
        prompt = prompt + anomalyBlock;
      }
      setText(prompt);
    }
  }, [data?.prompt_text, anomaliesData]);

  const kindLabel = FRAMING_OPTIONS.find(f => f.kind === kind)?.label ?? "Check-in";

  async function copyToClipboard(openClaude = false) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      // Save to history
      await saveCoachEntry({ date: forDate, kind, kindLabel, promptText: text });
    } catch {
      const el = document.getElementById("coach-textarea") as HTMLTextAreaElement | null;
      el?.select();
    }
    if (openClaude) {
      window.open("https://claude.ai/new", "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
      {showHistory && (
        <HistorySidebar
          onSelect={(e) => setText(e.promptText)}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-zinc-50">Coach Prompt</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Build your check-in for AI coaching — copy and paste into Claude.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowHistory(true)}
            className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors"
            title="View history"
          >
            <History size={16} />
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Framing chips */}
      <div className="flex flex-wrap gap-2">
        {FRAMING_OPTIONS.map((f) => {
          const active = kind === f.kind;
          const colors = FRAMING_COLORS[f.color];
          return (
            <button
              key={f.kind}
              onClick={() => setKind(f.kind)}
              className={[
                "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                active ? colors.active : colors.base,
              ].join(" ")}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Anomaly context note */}
      {anomaliesData?.anomalies && anomaliesData.anomalies.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-emerald-400/80">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
          {anomaliesData.anomalies.length} anomaly insight{anomaliesData.anomalies.length > 1 ? "s" : ""} auto-included in prompt
        </div>
      )}

      {/* Copy buttons */}
      <div className="flex justify-end gap-2">
        <button
          onClick={() => copyToClipboard(false)}
          disabled={!text}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 transition-colors"
        >
          {copied ? <Check size={16} /> : <ClipboardCopy size={16} />}
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          onClick={() => copyToClipboard(true)}
          disabled={!text}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors"
        >
          <ExternalLink size={16} />
          Copy + Open Claude
        </button>
      </div>

      {/* Context preview accordion */}
      {!isLoading && !error && text && <ContextPreview promptText={text} />}

      {/* Prompt textarea */}
      {error ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-900/30 border border-red-800/50 text-red-300 text-sm">
          Failed to load coach data — {(error as Error).message ?? "check connection"}
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
        </div>
      ) : (
        <textarea
          id="coach-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={24}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-sm text-zinc-200 font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
          placeholder="No data available for this date yet — fill in your morning and evening logs first."
        />
      )}

      <p className="text-xs text-zinc-600">
        You can edit before copying. Changes are local. History sidebar saves every copy.
      </p>
    </div>
  );
}
