import { useState, useEffect } from "react";
import { useCoachDraft } from "../hooks/use-daily-log";
import { useActiveDate } from "../hooks/use-active-date";
import { useAnomalies, useCoachConversations, useCreateCoachConversation, useArchiveCoachConversation, useCoachConversation } from "../hooks/use-dashboard";
import { ClipboardCopy, Check, RefreshCw, ExternalLink, ChevronDown, ChevronUp, History, X, MessageSquare, FileText, Plus, Bot } from "lucide-react";
import { saveCoachEntry, listCoachHistory, type CoachHistoryEntry } from "../lib/coach-history";
import { formatDdMmYyyy } from "../lib/format";
import { ChatThread } from "../components/coach/chat-thread";
import type { CoachConversation } from "../lib/types";

type CoachMode = "prompt" | "chat";

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

// ─── Prompt Builder mode ─────────────────────────────────────────────────────

function ContextPreview({ promptText }: { promptText: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">What Claude will see</span>
        {open ? <ChevronUp size={15} className="text-zinc-600" /> : <ChevronDown size={15} className="text-zinc-600" />}
      </button>
      {open && (
        <div className="px-4 pb-4">
          <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">{promptText}</pre>
        </div>
      )}
    </div>
  );
}

function HistorySidebar({ onSelect, onClose }: { onSelect: (entry: CoachHistoryEntry) => void; onClose: () => void }) {
  const [entries, setEntries] = useState<CoachHistoryEntry[]>([]);
  useEffect(() => { listCoachHistory().then(setEntries); }, []);
  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="w-80 bg-zinc-900 border-l border-zinc-800 h-full overflow-y-auto flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">Prompt history</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors"><X size={16} /></button>
        </div>
        {entries.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-8">No history yet — copy a prompt to save it.</p>
        ) : (
          <div className="flex flex-col">
            {entries.map((e) => (
              <button key={e.id} onClick={() => { onSelect(e); onClose(); }} className="px-4 py-3 text-left border-b border-zinc-800/60 hover:bg-zinc-800/40 transition-colors">
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

function PromptBuilder({ forDate, kind, setKind }: { forDate: string; kind: string; setKind: (k: string) => void }) {
  const { data, isLoading, error, refetch, isFetching } = useCoachDraft(forDate, kind);
  const { data: anomaliesData } = useAnomalies(forDate);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const kindLabel = FRAMING_OPTIONS.find(f => f.kind === kind)?.label ?? "Check-in";

  useEffect(() => {
    if (data?.prompt_text) {
      let prompt = data.prompt_text;
      const anomalies = anomaliesData?.anomalies ?? [];
      if (anomalies.length > 0) {
        prompt += "\n\n### Detected anomalies\n" + anomalies.map(a => `- ${a.label}: ${a.detail}`).join("\n");
      }
      setText(prompt);
    }
  }, [data?.prompt_text, anomaliesData]);

  async function copyToClipboard(openClaude = false) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      await saveCoachEntry({ date: forDate, kind, kindLabel, promptText: text });
    } catch {
      const el = document.getElementById("coach-textarea") as HTMLTextAreaElement | null;
      el?.select();
    }
    if (openClaude) window.open("https://claude.ai/new", "_blank", "noopener,noreferrer");
  }

  return (
    <>
      {showHistory && <HistorySidebar onSelect={(e) => setText(e.promptText)} onClose={() => setShowHistory(false)} />}

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-zinc-500">Build your check-in prompt — copy and paste into Claude.</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowHistory(true)} className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors" title="View history">
            <History size={16} />
          </button>
          <button onClick={() => refetch()} disabled={isFetching} className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-50" title="Refresh">
            <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FRAMING_OPTIONS.map((f) => {
          const active = kind === f.kind;
          const colors = FRAMING_COLORS[f.color];
          return (
            <button key={f.kind} onClick={() => setKind(f.kind)} className={["px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all", active ? colors.active : colors.base].join(" ")}>
              {f.label}
            </button>
          );
        })}
      </div>

      {anomaliesData?.anomalies && anomaliesData.anomalies.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-emerald-400/80">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
          {anomaliesData.anomalies.length} anomaly insight{anomaliesData.anomalies.length > 1 ? "s" : ""} auto-included in prompt
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={() => copyToClipboard(false)} disabled={!text} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 transition-colors">
          {copied ? <Check size={16} /> : <ClipboardCopy size={16} />}
          {copied ? "Copied!" : "Copy"}
        </button>
        <button onClick={() => copyToClipboard(true)} disabled={!text} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors">
          <ExternalLink size={16} />
          Copy + Open Claude
        </button>
      </div>

      {!isLoading && !error && text && <ContextPreview promptText={text} />}

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
          placeholder="No data available for this date yet."
        />
      )}
      <p className="text-xs text-zinc-600">You can edit before copying. Changes are local. History saves every copy.</p>
    </>
  );
}

// ─── Chat mode ────────────────────────────────────────────────────────────────

const FRAMING_COLOR_MAP: Record<string, string> = {
  check_in: "bg-violet-600",
  weekly: "bg-blue-600",
  plateau: "bg-amber-600",
  cut_reassess: "bg-emerald-600",
  free: "bg-zinc-600",
};

function ConversationSidebar({
  conversations,
  selectedId,
  onSelect,
  onNew,
  framing,
  forDate,
}: {
  conversations: CoachConversation[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  framing: string;
  forDate: string;
}) {
  return (
    <div className="w-64 shrink-0 border-r border-zinc-800 flex flex-col h-full overflow-hidden">
      <div className="p-3 border-b border-zinc-800">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
        >
          <Plus size={15} />
          New conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <p className="text-xs text-zinc-600 text-center py-6 px-3">No conversations yet. Start one with "+ New".</p>
        )}
        {conversations.map((conv) => {
          const colorDot = FRAMING_COLOR_MAP[conv.framing ?? "free"] ?? "bg-zinc-600";
          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={["w-full text-left px-3 py-3 border-b border-zinc-800/50 transition-colors", selectedId === conv.id ? "bg-zinc-800" : "hover:bg-zinc-800/50"].join(" ")}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${colorDot}`} />
                <p className="text-xs font-semibold text-zinc-200 truncate">{conv.title}</p>
              </div>
              <p className="text-[10px] text-zinc-500 pl-4">{conv.for_date}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChatMode({ forDate, kind }: { forDate: string; kind: string }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: convsData, isLoading: loadingConvs } = useCoachConversations();
  const { data: convData, isLoading: loadingConv } = useCoachConversation(selectedId);
  const createMutation = useCreateCoachConversation();

  const conversations = convsData?.conversations ?? [];

  // Auto-select first conversation when list loads
  useEffect(() => {
    if (!selectedId && conversations.length > 0) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations.length, selectedId]);

  const handleNew = async () => {
    const conv = await createMutation.mutateAsync({ framing: kind, forDate });
    setSelectedId(conv.id);
  };

  return (
    <div className="flex h-[calc(100vh-10rem)] border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900">
      {loadingConvs ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
        </div>
      ) : (
        <>
          <ConversationSidebar
            conversations={conversations}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNew={handleNew}
            framing={kind}
            forDate={forDate}
          />
          <div className="flex-1 overflow-hidden">
            {selectedId == null ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <Bot size={40} className="text-zinc-600" />
                <p className="text-zinc-500 text-sm">Select a conversation or start a new one</p>
                <button onClick={handleNew} disabled={createMutation.isPending} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                  <Plus size={14} />
                  New conversation
                </button>
              </div>
            ) : loadingConv ? (
              <div className="flex items-center justify-center h-full">
                <div className="w-8 h-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
              </div>
            ) : convData ? (
              <ChatThread
                conversation={convData}
                onDeleted={() => setSelectedId(conversations.find(c => c.id !== selectedId)?.id ?? null)}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function Coach() {
  const { date: forDate } = useActiveDate();
  const [kind, setKind] = useState<string>("check_in");
  const [mode, setMode] = useState<CoachMode>(() => {
    return (localStorage.getItem("coach-mode") as CoachMode) ?? "prompt";
  });

  const setModeAndSave = (m: CoachMode) => {
    setMode(m);
    localStorage.setItem("coach-mode", m);
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      {/* Header + mode toggle */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-zinc-50">Coach</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {mode === "prompt" ? "Build your check-in prompt for Claude" : "Chat with your AI coach powered by Claude"}
          </p>
        </div>
        <div className="flex items-center bg-zinc-800 rounded-xl p-1 gap-1">
          <button
            onClick={() => setModeAndSave("prompt")}
            className={["flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all", mode === "prompt" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"].join(" ")}
          >
            <FileText size={14} />
            Prompt Builder
          </button>
          <button
            onClick={() => setModeAndSave("chat")}
            className={["flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all", mode === "chat" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"].join(" ")}
          >
            <MessageSquare size={14} />
            In-App Chat
          </button>
        </div>
      </div>

      {/* Framing chips (shared between modes) */}
      <div className="flex flex-wrap gap-2">
        {FRAMING_OPTIONS.map((f) => {
          const active = kind === f.kind;
          const colors = FRAMING_COLORS[f.color];
          return (
            <button
              key={f.kind}
              onClick={() => setKind(f.kind)}
              className={["px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all", active ? colors.active : colors.base].join(" ")}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {mode === "prompt" ? (
        <PromptBuilder forDate={forDate} kind={kind} setKind={setKind} />
      ) : (
        <ChatMode forDate={forDate} kind={kind} />
      )}
    </div>
  );
}
