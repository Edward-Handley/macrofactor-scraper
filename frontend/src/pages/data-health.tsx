import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle, RefreshCw, Wrench } from "lucide-react";
import { useDashboardSummary, useDiagnostics, useRepair, useMetricCatalog, usePreferences, useUpdatePreferences } from "../hooks/use-dashboard";
import { fmt, isoDate, offsetDate } from "../lib/format";
import type { DailySummary } from "../lib/types";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

function SuspiciousDay({ summary, onRepairSuccess }: { summary: DailySummary; onRepairSuccess: () => void }) {
  const [params, setParams] = useSearchParams();
  const isSelected = params.get("date") === summary.date;
  const { data: diag, isLoading: diagLoading } = useDiagnostics(isSelected ? summary.date : null);
  const repair = useRepair();

  const suspicious = diag?.diagnostics.filter((d) => d.suspicious) ?? [];

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${isSelected ? "border-amber-500/50" : "border-zinc-800"}`}>
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors text-left"
        onClick={() => setParams((p) => { const n = new URLSearchParams(p); isSelected ? n.delete("date") : n.set("date", summary.date); return n; })}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle size={15} className="text-amber-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-zinc-100">{summary.date}</p>
            <p className="text-xs text-zinc-500">
              {fmt(summary.calories, 0)} kcal logged
            </p>
          </div>
        </div>
        <span className="text-zinc-500 text-xs">{isSelected ? "▲" : "▼"}</span>
      </button>

      {isSelected && (
        <div className="border-t border-zinc-800 px-4 py-3 space-y-3">
          {diagLoading && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <div className="w-3 h-3 rounded-full border border-zinc-500 border-t-transparent animate-spin" />
              Loading diagnostics…
            </div>
          )}
          {suspicious.map((item) => (
            <div key={`${item.metric_name}-${item.source}`} className="bg-zinc-800/60 rounded-lg p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-400">{item.metric_name}</span>
                <span className="text-xs text-zinc-500">{item.source}</span>
              </div>
              <div className="flex gap-4 text-xs text-zinc-400">
                <span>Raw sum: <strong className="text-red-400">{fmt(item.summed_value, 1)}</strong></span>
                <span>Correct: <strong className="text-emerald-400">{fmt(item.collapsed_value, 1)}</strong></span>
                <span>{item.row_count} rows</span>
              </div>
            </div>
          ))}
          {!diagLoading && suspicious.length === 0 && diag && (
            <p className="text-xs text-emerald-400 flex items-center gap-1.5">
              <CheckCircle size={12} /> No suspicious entries found.
            </p>
          )}
          {suspicious.length > 0 && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={async () => {
                  await repair.mutateAsync({ date: summary.date, dryRun: false });
                  onRepairSuccess();
                }}
                disabled={repair.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                {repair.isPending ? <RefreshCw size={12} className="animate-spin" /> : <Wrench size={12} />}
                Repair this day
              </button>
              {repair.isSuccess && (
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <CheckCircle size={12} /> {repair.data?.rows_removed} rows removed
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DataHealth() {
  const [repairCount, setRepairCount] = useState(0);
  const end = isoDate();
  const start = offsetDate(-89);
  const { data: summary, refetch } = useDashboardSummary(start, end);
  const { data: catalog } = useMetricCatalog();
  const { data: prefs } = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const [params] = useSearchParams();
  const initialDate = params.get("date");

  const summaries = summary?.summaries ?? [];

  // Flag days that look suspicious: calories > 5000 (rough upper bound)
  const suspiciousDays = summaries.filter((d) => (d.calories ?? 0) > 5000);

  function handleRepairSuccess() {
    setRepairCount((c) => c + 1);
    refetch();
  }

  function toggleTrust(name: string, trusted: boolean) {
    if (!prefs) return;
    const untrusted = new Set(prefs.untrusted_metric_names);
    trusted ? untrusted.delete(name) : untrusted.add(name);
    updatePrefs.mutate({ ...prefs, untrusted_metric_names: [...untrusted] });
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-zinc-50">Data Health</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Suspicious days, sources, and metric catalog</p>
      </div>

      {/* Suspicious days */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
            Flagged days (last 90d)
          </p>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${suspiciousDays.length > 0 ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"}`}>
            {suspiciousDays.length} flagged
          </span>
        </div>
        {suspiciousDays.length === 0 ? (
          <p className="text-sm text-emerald-400 flex items-center gap-2 py-2">
            <CheckCircle size={16} /> All days look clean.
          </p>
        ) : (
          <div className="space-y-2">
            {suspiciousDays.map((d) => (
              <SuspiciousDay key={d.date} summary={d} onRepairSuccess={handleRepairSuccess} />
            ))}
          </div>
        )}
      </Card>

      {/* Metric catalog */}
      <Card>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
          Metric catalog — {catalog?.count ?? 0} metrics
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-800">
                <th className="text-left py-2 pr-3 font-semibold">Metric</th>
                <th className="text-left py-2 px-2 font-semibold">Units</th>
                <th className="text-right py-2 px-2 font-semibold">Rows</th>
                <th className="text-left py-2 px-2 font-semibold">Sources</th>
                <th className="text-right py-2 pl-2 font-semibold">Trusted</th>
              </tr>
            </thead>
            <tbody>
              {catalog?.metrics.map((m) => (
                <tr key={`${m.name}-${m.units}`} className="border-t border-zinc-800/60 hover:bg-zinc-800/20 transition-colors">
                  <td className="py-2 pr-3 text-zinc-200 font-medium">{m.name}</td>
                  <td className="py-2 px-2 text-zinc-500">{m.units ?? "—"}</td>
                  <td className="py-2 px-2 text-right text-zinc-400 tabular-nums">{m.count.toLocaleString()}</td>
                  <td className="py-2 px-2">
                    <div className="flex flex-wrap gap-1">
                      {m.sources.map((s) => (
                        <span key={s} className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400 text-[10px]">{s}</span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <button
                      onClick={() => toggleTrust(m.name, !m.is_trusted)}
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full transition-colors ${
                        m.is_trusted
                          ? "bg-emerald-500/20 text-emerald-400 hover:bg-red-500/20 hover:text-red-400"
                          : "bg-red-500/20 text-red-400 hover:bg-emerald-500/20 hover:text-emerald-400"
                      }`}
                    >
                      {m.is_trusted ? "trusted" : "untrusted"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
