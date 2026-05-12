import { useState, useEffect } from "react";
import { useCoachDraft } from "../hooks/use-daily-log";
import { isoDate } from "../lib/format";
import { ClipboardCopy, Check, RefreshCw } from "lucide-react";

const TODAY = isoDate();

export function Coach() {
  const [forDate, setForDate] = useState(TODAY);
  const { data, isLoading, refetch, isFetching } = useCoachDraft(forDate);

  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (data?.prompt_text) setText(data.prompt_text);
  }, [data?.prompt_text]);

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select all in textarea
      const el = document.getElementById("coach-textarea") as HTMLTextAreaElement | null;
      el?.select();
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-zinc-50">Coach Prompt</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Build your daily check-in for AI coaching  -  copy and paste.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="date"
            value={forDate}
            onChange={(e) => setForDate(e.target.value || TODAY)}
            className="bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
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

      {/* Copy button */}
      <div className="flex justify-end">
        <button
          onClick={copyToClipboard}
          disabled={!text}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors"
        >
          {copied ? <Check size={16} /> : <ClipboardCopy size={16} />}
          {copied ? "Copied!" : "Copy to clipboard"}
        </button>
      </div>

      {/* Prompt textarea */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
        </div>
      ) : (
        <textarea
          id="coach-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={28}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-sm text-zinc-200 font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
          placeholder="No data available for this date yet  -  fill in your morning and evening logs first."
        />
      )}

      <p className="text-xs text-zinc-600">
        You can edit the prompt before copying. Changes are local only.
      </p>
    </div>
  );
}
