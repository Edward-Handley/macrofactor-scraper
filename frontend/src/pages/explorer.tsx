import { useState, useEffect } from "react";
import { Download, RefreshCw } from "lucide-react";
import { fmt } from "../lib/format";

type DatasetId = "dashboard_summary" | "daily_summary" | "metric_catalog" | "metric_records" | "workouts" | "ingest_status";

const DATASETS: { id: DatasetId; label: string; description: string; needsMetric?: boolean }[] = [
  { id: "dashboard_summary", label: "Dashboard Summary", description: "Daily summaries with preferences applied" },
  { id: "daily_summary", label: "Daily Summary (raw)", description: "All fields, no preference filtering" },
  { id: "metric_catalog", label: "Metric Catalog", description: "All metrics with source/coverage info" },
  { id: "metric_records", label: "Metric Records", description: "Raw rows for a specific metric", needsMetric: true },
  { id: "workouts", label: "Workouts", description: "Workout sessions with duration/energy" },
  { id: "ingest_status", label: "Ingest Status", description: "Batch count, latest sync, date range" },
];

function buildUrl(dataset: DatasetId, start: string, end: string, metric: string): string {
  const q = `start=${start}&end=${end}`;
  switch (dataset) {
    case "dashboard_summary": return `/v1/dashboard/summary?${q}&include_hidden=true`;
    case "daily_summary": return `/v1/daily-summary?${q}`;
    case "metric_catalog": return "/v1/dashboard/metric-catalog";
    case "metric_records": return `/v1/metrics/${metric || "dietary_energy"}?${q}`;
    case "workouts": return `/v1/workouts?${q}`;
    case "ingest_status": return "/v1/ingest/status";
    default: return "/";
  }
}

function extractRows(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  for (const key of ["summaries", "records", "metrics", "workouts"]) {
    if (Array.isArray((data as Record<string, unknown>)[key])) {
      return (data as Record<string, unknown>)[key] as unknown[];
    }
  }
  return [data];
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

export function Explorer() {
  const [dataset, setDataset] = useState<DatasetId>("dashboard_summary");
  const [start, setStart] = useState("2026-01-01");
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [metric, setMetric] = useState("dietary_energy");
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = buildUrl(dataset, start, end, metric);
  const rows = extractRows(result);
  const keys = rows.length > 0 && typeof rows[0] === "object" ? Object.keys(rows[0] as object) : [];
  const needsMetric = DATASETS.find((d) => d.id === dataset)?.needsMetric;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (res.status === 401) { location.href = "/login"; return; }
      if (!res.ok) throw new Error(`${res.status}`);
      setResult(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [dataset, start, end, metric]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-zinc-50">Explorer</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Browse and inspect raw API data</p>
      </div>

      {/* Controls */}
      <Card>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500 font-semibold uppercase tracking-wide">Dataset</label>
            <select
              value={dataset}
              onChange={(e) => setDataset(e.target.value as DatasetId)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 min-w-[200px]"
            >
              {DATASETS.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>
          {needsMetric && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-500 font-semibold uppercase tracking-wide">Metric</label>
              <input
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                placeholder="dietary_energy"
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 w-40"
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500 font-semibold uppercase tracking-wide">From</label>
            <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500 font-semibold uppercase tracking-wide">To</label>
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200" />
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
            Load
          </button>
        </div>
        <p className="text-[10px] text-zinc-600 mt-2 font-mono break-all">{url}</p>
      </Card>

      {/* Stats */}
      {rows.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {[
            { label: "Rows", value: rows.length },
            { label: "Fields", value: keys.length },
          ].map(({ label, value }) => (
            <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2">
              <p className="text-xs text-zinc-500">{label}</p>
              <p className="text-lg font-bold text-zinc-100">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400">
          Error: {error}
        </div>
      )}

      {/* Table preview */}
      {rows.length > 0 && (
        <Card>
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Preview — first {Math.min(rows.length, 25)} of {rows.length} rows
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800">
                  {keys.map((k) => (
                    <th key={k} className="text-left py-2 px-2 font-semibold whitespace-nowrap">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 25).map((row, i) => (
                  <tr key={i} className="border-t border-zinc-800/60 hover:bg-zinc-800/20 transition-colors">
                    {keys.map((k) => {
                      const v = (row as Record<string, unknown>)[k];
                      return (
                        <td key={k} className="py-1.5 px-2 text-zinc-300 whitespace-nowrap">
                          {v == null ? <span className="text-zinc-600">—</span> :
                           typeof v === "number" ? <span className="tabular-nums">{fmt(v, 2)}</span> :
                           typeof v === "boolean" ? <span className={v ? "text-emerald-400" : "text-red-400"}>{String(v)}</span> :
                           String(v).slice(0, 60)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Raw JSON */}
      {result != null && (
        <Card>
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Raw response</p>
          <pre className="text-[10px] text-zinc-400 overflow-auto max-h-64 font-mono leading-relaxed">
            {JSON.stringify(result, null, 2).slice(0, 4000)}
          </pre>
        </Card>
      )}
    </div>
  );
}
