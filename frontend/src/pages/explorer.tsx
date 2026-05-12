import { useState, useEffect, useMemo, useRef } from "react";
import { Download, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Columns } from "lucide-react";
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

const PAGE_SIZE = 50;

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

function cellValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return String(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

interface ColStat { min: number; max: number; avg: number; }

export function Explorer() {
  const [dataset, setDataset] = useState<DatasetId>("dashboard_summary");
  const [start, setStart] = useState("2026-01-01");
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [metric, setMetric] = useState("dietary_energy");
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterText, setFilterText] = useState("");
  const [page, setPage] = useState(0);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);

  const url = buildUrl(dataset, start, end, metric);
  const needsMetric = DATASETS.find((d) => d.id === dataset)?.needsMetric;
  const allRows = extractRows(result);
  const allKeys = allRows.length > 0 && typeof allRows[0] === "object"
    ? Object.keys(allRows[0] as object) : [];
  const visibleKeys = allKeys.filter(k => !hiddenCols.has(k));

  const filteredRows = useMemo(() => {
    if (!filterText.trim()) return allRows;
    const q = filterText.trim().toLowerCase();
    return allRows.filter(row =>
      allKeys.some(k => String((row as Record<string, unknown>)[k] ?? "").toLowerCase().includes(q))
    );
  }, [allRows, allKeys, filterText]);

  const sortedRows = useMemo(() => {
    if (!sortCol) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const va = (a as Record<string, unknown>)[sortCol];
      const vb = (b as Record<string, unknown>)[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      let cmp = 0;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filteredRows, sortCol, sortDir]);

  const totalPages = Math.ceil(sortedRows.length / PAGE_SIZE);
  const pageRows = sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const colStats = useMemo<Record<string, ColStat | null>>(() => {
    return Object.fromEntries(allKeys.map(k => {
      const vals = allRows
        .map(r => (r as Record<string, unknown>)[k])
        .filter(v => typeof v === "number") as number[];
      if (!vals.length) return [k, null];
      const sum = vals.reduce((s, v) => s + v, 0);
      return [k, { min: Math.min(...vals), max: Math.max(...vals), avg: sum / vals.length }];
    }));
  }, [allRows, allKeys]);

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
    setPage(0);
  }

  function downloadCSV() {
    const header = visibleKeys.join(",");
    const body = sortedRows.map(row =>
      visibleKeys.map(k => {
        const v = (row as Record<string, unknown>)[k];
        if (v == null) return "";
        const s = String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(",")
    ).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  async function load() {
    setLoading(true);
    setError(null);
    setPage(0);
    setSortCol(null);
    setFilterText("");
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

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setShowColPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => { setPage(0); }, [filterText]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-zinc-50">Explorer</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Browse, filter, and export raw API data</p>
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
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 w-44"
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
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Reload
          </button>
        </div>
        <p className="text-[10px] text-zinc-600 mt-2 font-mono break-all">{url}</p>
      </Card>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400">
          Error: {error}
        </div>
      )}

      {allRows.length > 0 && (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="relative flex-1 max-w-xs">
                <input
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="Filter rows..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-3 pr-8 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
                />
                {filterText && (
                  <button
                    onClick={() => setFilterText("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs"
                  >x</button>
                )}
              </div>
              <span className="text-xs text-zinc-500 shrink-0">
                {filteredRows.length !== allRows.length
                  ? `${filteredRows.length} / ${allRows.length} rows`
                  : `${allRows.length} rows`}
                {" - "}{visibleKeys.length} cols
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Column picker */}
              <div className="relative" ref={colPickerRef}>
                <button
                  onClick={() => setShowColPicker(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  <Columns size={13} /> Columns
                  {hiddenCols.size > 0 && (
                    <span className="ml-0.5 bg-emerald-500 text-zinc-900 rounded-full w-4 h-4 flex items-center justify-center font-bold text-[9px]">
                      {allKeys.length - hiddenCols.size}
                    </span>
                  )}
                </button>
                {showColPicker && (
                  <div className="absolute right-0 mt-1 z-20 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl p-3 min-w-[180px] max-h-64 overflow-y-auto">
                    <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wide mb-2">Show / hide columns</p>
                    {allKeys.map(k => (
                      <label key={k} className="flex items-center gap-2 py-1 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={!hiddenCols.has(k)}
                          onChange={() => setHiddenCols(prev => {
                            const next = new Set(prev);
                            next.has(k) ? next.delete(k) : next.add(k);
                            return next;
                          })}
                          className="accent-emerald-500"
                        />
                        <span className="text-xs text-zinc-300 group-hover:text-zinc-100 font-mono">{k}</span>
                      </label>
                    ))}
                    {hiddenCols.size > 0 && (
                      <button
                        onClick={() => setHiddenCols(new Set())}
                        className="mt-2 text-xs text-emerald-400 hover:text-emerald-300"
                      >
                        Show all
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* CSV export */}
              <button
                onClick={downloadCSV}
                className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <Download size={13} /> CSV
              </button>
            </div>
          </div>

          {/* Table */}
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-zinc-500 border-b border-zinc-800">
                    {visibleKeys.map((k) => {
                      const stat = colStats[k];
                      const isSort = sortCol === k;
                      return (
                        <th key={k} className="text-left py-0 font-semibold whitespace-nowrap">
                          <button
                            onClick={() => toggleSort(k)}
                            className="flex items-center gap-1 px-3 py-2.5 w-full hover:bg-zinc-800/50 hover:text-zinc-300 transition-colors"
                          >
                            {k}
                            {isSort
                              ? (sortDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)
                              : <ArrowUpDown size={10} className="opacity-30" />}
                          </button>
                          {stat && (
                            <div className="px-3 pb-1.5 text-[9px] text-zinc-600 font-normal whitespace-nowrap">
                              {fmt(stat.min, 1)} / {fmt(stat.avg, 1)} / {fmt(stat.max, 1)}
                            </div>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, i) => (
                    <tr key={i} className="border-t border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
                      {visibleKeys.map((k) => {
                        const v = (row as Record<string, unknown>)[k];
                        return (
                          <td key={k} className="py-1.5 px-3 text-zinc-300 whitespace-nowrap max-w-[200px] truncate">
                            {v == null
                              ? <span className="text-zinc-700"> - </span>
                              : typeof v === "number"
                                ? <span className="tabular-nums">{fmt(v, 2)}</span>
                                : typeof v === "boolean"
                                  ? <span className={v ? "text-emerald-400" : "text-red-400"}>{String(v)}</span>
                                  : <span title={String(v)}>{String(v).slice(0, 60)}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={visibleKeys.length} className="py-8 text-center text-zinc-600">
                        No rows match the filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800 bg-zinc-900/50">
                <span className="text-xs text-zinc-500">
                  {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, sortedRows.length)} of {sortedRows.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(0)}
                    disabled={page === 0}
                    className="px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-100 disabled:opacity-30 transition-colors"
                  >{"<<"}</button>
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="flex items-center gap-0.5 px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-100 disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft size={12} /> Prev
                  </button>
                  <span className="px-3 text-xs text-zinc-400">
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="flex items-center gap-0.5 px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-100 disabled:opacity-30 transition-colors"
                  >
                    Next <ChevronRight size={12} />
                  </button>
                  <button
                    onClick={() => setPage(totalPages - 1)}
                    disabled={page >= totalPages - 1}
                    className="px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-100 disabled:opacity-30 transition-colors"
                  >{">>"}</button>
                </div>
              </div>
            )}
          </Card>

          {/* Raw JSON */}
          <Card>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Raw response</p>
            <pre className="text-[10px] text-zinc-400 overflow-auto max-h-64 font-mono leading-relaxed">
              {JSON.stringify(result, null, 2).slice(0, 6000)}
            </pre>
          </Card>
        </>
      )}
    </div>
  );
}
