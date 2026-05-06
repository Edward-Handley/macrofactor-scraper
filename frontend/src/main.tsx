import React, {useEffect, useMemo, useState} from "react";
import {createRoot} from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleGauge,
  Clipboard,
  Code2,
  Database,
  Download,
  Droplets,
  Dumbbell,
  Eye,
  EyeOff,
  Flame,
  Gauge,
  Home,
  LineChart as LineChartIcon,
  Loader2,
  LogOut,
  FileSpreadsheet,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Table2,
  TrendingDown,
  TrendingUp,
  Utensils,
  Weight
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import "./styles.css";

type SummaryField = "calories" | "protein" | "carbohydrates" | "fat" | "water" | "weight" | "steps" | "active_energy";
type TabId = "overview" | "nutrition" | "trends" | "calorie_weight" | "sources" | "metrics" | "api_explorer" | "quality" | "settings";
type ScaleMode = "auto" | "zero" | "tight" | "indexed";

type DailySummary = Record<SummaryField, number | null> & {date: string};

type DashboardSummary = {
  count: number;
  first_date: string | null;
  last_date: string | null;
  latest_date: string | null;
  hidden_fields: SummaryField[];
  summaries: DailySummary[];
};

type Preferences = {
  visible_summary_cards: SummaryField[];
  hidden_summary_fields: SummaryField[];
  preferred_range_days: number;
  trusted_metric_names: string[];
  untrusted_metric_names: string[];
  default_chart_set: SummaryField[];
  source_filters: Record<string, string[]>;
};

type MetricCatalogItem = {
  name: string;
  units: string | null;
  count: number;
  first_date: string | null;
  last_date: string | null;
  sources: string[];
  dashboard_field: SummaryField | null;
  is_trusted: boolean;
};

type IngestStatus = {
  latest_batch_at: string | null;
  batch_count: number;
  metric_record_count: number;
  workout_record_count: number;
  first_date: string | null;
  last_date: string | null;
};

type ExplorerDatasetId =
  | "dashboard_summary"
  | "daily_summary"
  | "metric_catalog"
  | "metric_records"
  | "workouts"
  | "ingest_status"
  | "preferences"
  | "csv_daily"
  | "csv_metric"
  | "excel_daily_log"
  | "excel_calories_weight"
  | "excel_metric";

const fieldMeta: Record<SummaryField, {label: string; short: string; unit: string; color: string; soft: string; icon: React.ElementType; digits?: number}> = {
  calories: {label: "Calories", short: "Cal", unit: "kcal", color: "#2563eb", soft: "#dbeafe", icon: Flame},
  protein: {label: "Protein", short: "Pro", unit: "g", color: "#16a34a", soft: "#dcfce7", icon: Utensils},
  carbohydrates: {label: "Carbohydrates", short: "Carbs", unit: "g", color: "#d97706", soft: "#fef3c7", icon: Sparkles},
  fat: {label: "Fat", short: "Fat", unit: "g", color: "#9333ea", soft: "#f3e8ff", icon: CircleGauge},
  water: {label: "Water", short: "Water", unit: "mL", color: "#0891b2", soft: "#cffafe", icon: Droplets},
  weight: {label: "Weight", short: "Weight", unit: "kg", color: "#dc2626", soft: "#fee2e2", icon: Weight, digits: 1},
  steps: {label: "Steps", short: "Steps", unit: "", color: "#4f46e5", soft: "#e0e7ff", icon: Activity},
  active_energy: {label: "Active Energy", short: "Active", unit: "kcal", color: "#0f766e", soft: "#ccfbf1", icon: Dumbbell}
};

const allFields = Object.keys(fieldMeta) as SummaryField[];
const rangeOptions = [7, 14, 30, 90];
const macroFields: SummaryField[] = ["protein", "carbohydrates", "fat"];
const nutritionFields: SummaryField[] = ["calories", "protein", "carbohydrates", "fat", "water"];

const tabs: Array<{id: TabId; label: string; icon: React.ElementType}> = [
  {id: "overview", label: "Overview", icon: Home},
  {id: "nutrition", label: "Nutrition", icon: Utensils},
  {id: "trends", label: "Trends", icon: LineChartIcon},
  {id: "calorie_weight", label: "Calories vs Weight", icon: Weight},
  {id: "sources", label: "Sources", icon: Database},
  {id: "metrics", label: "Metrics", icon: Database},
  {id: "api_explorer", label: "API Explorer", icon: Code2},
  {id: "quality", label: "Data Quality", icon: ShieldCheck},
  {id: "settings", label: "Settings", icon: SettingsIcon}
];

const explorerDatasets: Array<{id: ExplorerDatasetId; label: string; path: string; rowKey?: string; needsRange?: boolean; needsMetric?: boolean; isCsv?: boolean; excel?: boolean}> = [
  {id: "dashboard_summary", label: "Dashboard summary", path: "/v1/dashboard/summary", rowKey: "summaries", needsRange: true},
  {id: "daily_summary", label: "Daily summary", path: "/v1/daily-summary", rowKey: "summaries", needsRange: true},
  {id: "metric_catalog", label: "Metric catalog", path: "/v1/dashboard/metric-catalog", rowKey: "metrics"},
  {id: "metric_records", label: "Metric records", path: "/v1/metrics/{metric}", rowKey: "records", needsRange: true, needsMetric: true},
  {id: "workouts", label: "Workouts", path: "/v1/workouts", rowKey: "workouts", needsRange: true},
  {id: "ingest_status", label: "Ingest status", path: "/v1/ingest/status"},
  {id: "preferences", label: "Preferences", path: "/v1/dashboard/preferences"},
  {id: "csv_daily", label: "CSV export: daily summary", path: "/v1/export/daily-summary.csv", needsRange: true, isCsv: true},
  {id: "csv_metric", label: "CSV export: metric records", path: "/v1/export/metrics/{metric}.csv", needsRange: true, needsMetric: true, isCsv: true},
  {id: "excel_daily_log", label: "Excel feed: daily log", path: "/v1/excel/daily-log.csv", needsRange: true, isCsv: true, excel: true},
  {id: "excel_calories_weight", label: "Excel feed: calories vs weight", path: "/v1/excel/calories-weight.csv", needsRange: true, isCsv: true, excel: true},
  {id: "excel_metric", label: "Excel feed: raw metric", path: "/v1/excel/metrics/{metric}.csv", needsRange: true, needsMetric: true, isCsv: true, excel: true}
];

function isoDate(offsetDays: number): string {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function fmt(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "Missing";
  return Number(value).toLocaleString(undefined, {maximumFractionDigits: digits});
}

function compact(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Intl.NumberFormat(undefined, {notation: "compact", maximumFractionDigits: digits}).format(value);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {"Content-Type": "application/json", ...(init?.headers || {})}
  });
  if (response.status === 401) {
    location.href = "/login";
    throw new Error("Authentication required");
  }
  if (!response.ok) throw new Error("Request failed");
  return response.json() as Promise<T>;
}

function App() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [start, setStart] = useState(isoDate(-30));
  const [end, setEnd] = useState(isoDate(0));
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [catalog, setCatalog] = useState<MetricCatalogItem[]>([]);
  const [status, setStatus] = useState<IngestStatus | null>(null);
  const [search, setSearch] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<"all" | "dashboard" | "untrusted" | "stale">("all");
  const [selectedSource, setSelectedSource] = useState("");
  const [chartScales, setChartScales] = useState<Record<SummaryField, ScaleMode>>({
    calories: "auto",
    protein: "auto",
    carbohydrates: "auto",
    fat: "auto",
    water: "auto",
    weight: "tight",
    steps: "auto",
    active_energy: "auto"
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const visibleFields = useMemo(
    () => preferences?.visible_summary_cards.filter((field) => !preferences.hidden_summary_fields.includes(field)) || allFields,
    [preferences]
  );
  const rows = summary?.summaries || [];
  const latest = rows[rows.length - 1];
  const currentRangeDays = daysBetween(start, end) + 1;
  const dataHealth = useMemo(() => qualitySnapshot(rows, catalog, preferences), [rows, catalog, preferences]);
  const filteredCatalog = useMemo(
    () => filterCatalog(catalog, search, catalogFilter),
    [catalog, search, catalogFilter]
  );
  const sourceOptions = useMemo(() => Array.from(new Set(catalog.flatMap((metric) => metric.sources.length ? metric.sources : ["Unknown"]))).sort(), [catalog]);
  const activeSource = selectedSource || sourceOptions[0] || "Unknown";

  async function load(rangeDays?: number) {
    setError("");
    setLoading(true);
    try {
      const prefs = await api<Preferences>("/v1/dashboard/preferences");
      const nextStart = rangeDays ? isoDate(-rangeDays + 1) : preferences ? start : isoDate(-prefs.preferred_range_days + 1);
      if (rangeDays || !preferences) setStart(nextStart);
      const [nextSummary, nextCatalog, nextStatus] = await Promise.all([
        api<DashboardSummary>(`/v1/dashboard/summary?start=${nextStart}&end=${end}`),
        api<{count: number; metrics: MetricCatalogItem[]}>("/v1/dashboard/metric-catalog"),
        api<IngestStatus>("/v1/ingest/status")
      ]);
      setPreferences(prefs);
      setSummary(nextSummary);
      setCatalog(nextCatalog.metrics);
      setStatus(nextStatus);
    } catch {
      setError("Could not load dashboard data.");
    } finally {
      setLoading(false);
    }
  }

  async function savePreferences(next: Preferences) {
    setSaving(true);
    setPreferences(next);
    try {
      const saved = await api<Preferences>("/v1/dashboard/preferences", {method: "PUT", body: JSON.stringify(next)});
      setPreferences(saved);
      await load();
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Gauge size={22} /></div>
          <div>
            <strong>Health Export</strong>
            <span>Nutrition console</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Dashboard sections">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} className={tab.id === activeTab ? "nav-item active" : "nav-item"} type="button" onClick={() => setActiveTab(tab.id)}>
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-card">
          <span className="eyebrow">Data coverage</span>
          <strong>{summary?.first_date || "No data"} to {summary?.last_date || ""}</strong>
          <div className="meter"><span style={{width: `${dataHealth.score}%`}} /></div>
          <small>{dataHealth.score}% quality score</small>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="title-stack">
            <span className="eyebrow">{activeTabLabel(activeTab)}</span>
            <h1>{headline(activeTab)}</h1>
            <p>{subhead(activeTab, currentRangeDays, rows.length)}</p>
          </div>
          <div className="top-actions">
            <DateField label="Start" value={start} setValue={setStart} />
            <DateField label="End" value={end} setValue={setEnd} />
            <div className="segmented">
              {rangeOptions.map((days) => (
                <button key={days} className={currentRangeDays === days ? "active" : ""} type="button" onClick={() => void load(days)}>
                  {days}d
                </button>
              ))}
            </div>
            <IconButton label="Refresh" onClick={() => void load()}><RefreshCw size={17} /></IconButton>
            <a className="icon-button secondary" href={`/v1/export/daily-summary.csv?start=${start}&end=${end}`} title="Export daily summary">
              <Download size={17} />
            </a>
            <form method="post" action="/logout">
              <button className="icon-button secondary" type="submit" title="Logout"><LogOut size={17} /></button>
            </form>
          </div>
        </header>

        <main>
          <StatusStrip status={status} dataHealth={dataHealth} saving={saving} />
          {error ? <div className="notice"><AlertTriangle size={18} />{error}</div> : null}
          {loading ? <LoadingState /> : null}
          {!loading && activeTab === "overview" && <Overview rows={rows} latest={latest} visibleFields={visibleFields} preferences={preferences} savePreferences={savePreferences} dataHealth={dataHealth} />}
          {!loading && activeTab === "nutrition" && <Nutrition rows={rows} visibleFields={visibleFields} />}
          {!loading && activeTab === "trends" && <Trends rows={rows} preferences={preferences} savePreferences={savePreferences} chartScales={chartScales} setChartScales={setChartScales} />}
          {!loading && activeTab === "calorie_weight" && <CalorieWeight rows={rows} />}
          {!loading && activeTab === "sources" && <SourceExplorer metrics={catalog} selectedSource={activeSource} setSelectedSource={setSelectedSource} sourceOptions={sourceOptions} preferences={preferences} savePreferences={savePreferences} />}
          {!loading && activeTab === "metrics" && <Metrics metrics={filteredCatalog} catalog={catalog} search={search} setSearch={setSearch} filter={catalogFilter} setFilter={setCatalogFilter} preferences={preferences} savePreferences={savePreferences} />}
          {!loading && activeTab === "api_explorer" && <ApiExplorer catalog={catalog} start={start} end={end} setStart={setStart} setEnd={setEnd} />}
          {!loading && activeTab === "quality" && <DataQuality rows={rows} metrics={catalog} preferences={preferences} savePreferences={savePreferences} snapshot={dataHealth} />}
          {!loading && activeTab === "settings" && preferences ? <Settings preferences={preferences} savePreferences={savePreferences} loadRange={load} metrics={catalog} /> : null}
        </main>
      </div>
    </div>
  );
}

function StatusStrip({status, dataHealth, saving}: {status: IngestStatus | null; dataHealth: ReturnType<typeof qualitySnapshot>; saving: boolean}) {
  return (
    <section className="status-strip">
      <StatusPill icon={Database} label="Metric rows" value={compact(status?.metric_record_count)} />
      <StatusPill icon={CalendarDays} label="Latest ingest" value={formatDateTime(status?.latest_batch_at)} />
      <StatusPill icon={CheckCircle2} label="Quality" value={`${dataHealth.score}%`} tone={dataHealth.score >= 85 ? "good" : dataHealth.score >= 60 ? "warn" : "bad"} />
      <StatusPill icon={ShieldCheck} label="Reliability" value={`${dataHealth.disabledFields.length} hidden / ${dataHealth.untrustedMetrics.length} untrusted`} />
      {saving ? <StatusPill icon={Loader2} label="Saving" value="Preferences" tone="active" spin /> : null}
    </section>
  );
}

function Overview({rows, latest, visibleFields, preferences, savePreferences, dataHealth}: {rows: DailySummary[]; latest?: DailySummary; visibleFields: SummaryField[]; preferences: Preferences | null; savePreferences: (value: Preferences) => Promise<void>; dataHealth: ReturnType<typeof qualitySnapshot>}) {
  const insights = buildInsights(rows, dataHealth);
  return (
    <>
      <section className="hero-grid">
        <div className="hero-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Today snapshot</span>
              <h2>{latest?.date || "Waiting for data"}</h2>
            </div>
            <span className={dataHealth.score >= 85 ? "badge good" : dataHealth.score >= 60 ? "badge warn" : "badge bad"}>{dataHealth.score}% quality</span>
          </div>
          <div className="hero-kpis">
            {visibleFields.slice(0, 4).map((field) => <SummaryCard key={field} field={field} value={latest?.[field] ?? null} rows={rows} preferences={preferences} savePreferences={savePreferences} />)}
          </div>
        </div>
        <div className="panel insight-panel">
          <div className="panel-head"><h2>Signals</h2><Sparkles size={18} /></div>
          {insights.map((item) => (
            <div className="insight" key={item.title}>
              <item.icon size={18} />
              <div><strong>{item.title}</strong><span>{item.detail}</span></div>
            </div>
          ))}
        </div>
      </section>

      <section className="card-grid">
        {visibleFields.slice(4).map((field) => <SummaryCard key={field} field={field} value={latest?.[field] ?? null} rows={rows} preferences={preferences} savePreferences={savePreferences} />)}
      </section>

      <section className="dashboard-grid">
        <div className="panel span-8">
          <div className="panel-head"><h2>Nutrition Trend</h2><span className="muted">Calories, macros, and activity</span></div>
          <MultiMetricChart rows={rows} fields={visibleFields.filter((field) => ["calories", "protein", "carbohydrates", "fat", "active_energy"].includes(field))} />
        </div>
        <div className="panel span-4">
          <div className="panel-head"><h2>Current vs Previous</h2><BarChart3 size={18} /></div>
          <ComparisonBars rows={rows} fields={visibleFields.slice(0, 5)} />
        </div>
        <div className="panel span-12">
          <div className="panel-head"><h2>Recent Daily Summary</h2><span className="muted">{rows.length} days loaded</span></div>
          <DailyTable rows={rows.slice(-14).reverse()} fields={visibleFields} dense />
        </div>
      </section>
    </>
  );
}

function SummaryCard({field, value, rows, preferences, savePreferences}: {field: SummaryField; value: number | null; rows: DailySummary[]; preferences: Preferences | null; savePreferences: (value: Preferences) => Promise<void>}) {
  const meta = fieldMeta[field];
  const Icon = meta.icon;
  const last7 = average(rows.slice(-7), field);
  const last30 = average(rows.slice(-30), field);
  const trend = deltaPercent(rows, field);
  function hideField() {
    if (!preferences) return;
    void savePreferences({
      ...preferences,
      visible_summary_cards: preferences.visible_summary_cards.filter((item) => item !== field),
      hidden_summary_fields: Array.from(new Set([...preferences.hidden_summary_fields, field]))
    });
  }
  return (
    <article className="summary-card" style={{"--accent": meta.color, "--accent-soft": meta.soft} as React.CSSProperties}>
      <div className="summary-top">
        <span className="metric-icon"><Icon size={18} /></span>
        <button className="ghost-icon" type="button" title={`Hide ${meta.label}`} onClick={hideField}><EyeOff size={15} /></button>
      </div>
      <div className="card-label">{meta.label}</div>
      <div className={value === null ? "card-value missing" : "card-value"}>{fmt(value, meta.digits)} {value !== null ? meta.unit : ""}</div>
      <div className="card-sub">
        <span>7d {fmt(last7, meta.digits)}</span>
        <span>30d {fmt(last30, meta.digits)}</span>
      </div>
      <div className={trend >= 0 ? "trend up" : "trend down"}>
        {trend >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
        {Math.abs(trend).toFixed(1)}% vs prior
      </div>
    </article>
  );
}

function Nutrition({rows, visibleFields}: {rows: DailySummary[]; visibleFields: SummaryField[]}) {
  const macroData = macroFields.map((field) => ({name: fieldMeta[field].label, value: sum(rows.slice(-7), field), color: fieldMeta[field].color}));
  return (
    <section className="dashboard-grid">
      <div className="panel span-8">
        <div className="panel-head"><h2>Calorie and Macro Timeline</h2><span className="muted">Daily totals over selected range</span></div>
        <MultiMetricChart rows={rows} fields={nutritionFields.filter((field) => visibleFields.includes(field))} />
      </div>
      <div className="panel span-4">
        <div className="panel-head"><h2>7 Day Macro Split</h2><Utensils size={18} /></div>
        <ResponsiveContainer width="100%" height={290}>
          <PieChart>
            <Pie data={macroData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={96} paddingAngle={4}>
              {macroData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
            </Pie>
            <Tooltip formatter={(value) => `${fmt(Number(value))} g`} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="panel span-5">
        <div className="panel-head"><h2>Macro Consistency</h2><CircleGauge size={18} /></div>
        <ConsistencyList rows={rows} fields={macroFields} />
      </div>
      <div className="panel span-7">
        <div className="panel-head"><h2>Daily Nutrition Log</h2><Table2 size={18} /></div>
        <DailyTable rows={rows.slice().reverse()} fields={nutritionFields.filter((field) => visibleFields.includes(field))} />
      </div>
    </section>
  );
}

function Trends({rows, preferences, savePreferences, chartScales, setChartScales}: {rows: DailySummary[]; preferences: Preferences | null; savePreferences: (value: Preferences) => Promise<void>; chartScales: Record<SummaryField, ScaleMode>; setChartScales: React.Dispatch<React.SetStateAction<Record<SummaryField, ScaleMode>>>}) {
  const fields = preferences?.default_chart_set.length ? preferences.default_chart_set : allFields;
  function toggleChart(field: SummaryField) {
    if (!preferences) return;
    const next = preferences.default_chart_set.includes(field)
      ? preferences.default_chart_set.filter((item) => item !== field)
      : [...preferences.default_chart_set, field];
    void savePreferences({...preferences, default_chart_set: next});
  }
  function setScale(field: SummaryField, mode: ScaleMode) {
    setChartScales((current) => ({...current, [field]: mode}));
  }
  return (
    <>
      <section className="control-panel">
        <div>
          <span className="eyebrow">Chart builder</span>
          <h2>Choose the metrics that deserve attention</h2>
        </div>
        <div className="chip-row">
          {allFields.map((field) => (
            <button key={field} className={fields.includes(field) ? "chip active" : "chip"} type="button" onClick={() => toggleChart(field)}>
              {fieldMeta[field].label}
            </button>
          ))}
        </div>
      </section>
      <section className="chart-grid">
        {fields.map((field) => (
          <div className="panel chart-panel" key={field}>
            <div className="panel-head">
              <div>
                <h2>{fieldMeta[field].label}</h2>
                <span className="muted">{scaleDescription(field, chartScales[field])}</span>
              </div>
              <div className="scale-control">
                {(["auto", "zero", "tight", "indexed"] as ScaleMode[]).map((mode) => (
                  <button key={mode} className={chartScales[field] === mode ? "active" : ""} type="button" onClick={() => setScale(field, mode)}>{mode}</button>
                ))}
              </div>
            </div>
            <SingleMetricChart rows={rows} field={field} scaleMode={chartScales[field]} />
          </div>
        ))}
      </section>
    </>
  );
}

function Metrics({metrics, catalog, search, setSearch, filter, setFilter, preferences, savePreferences}: {metrics: MetricCatalogItem[]; catalog: MetricCatalogItem[]; search: string; setSearch: (value: string) => void; filter: "all" | "dashboard" | "untrusted" | "stale"; setFilter: (value: "all" | "dashboard" | "untrusted" | "stale") => void; preferences: Preferences | null; savePreferences: (value: Preferences) => Promise<void>}) {
  const sourceOptions = Array.from(new Set(catalog.flatMap((metric) => metric.sources))).sort();
  function toggleTrust(metric: MetricCatalogItem) {
    if (!preferences) return;
    const untrusted = new Set(preferences.untrusted_metric_names);
    if (untrusted.has(metric.name)) untrusted.delete(metric.name);
    else untrusted.add(metric.name);
    void savePreferences({...preferences, untrusted_metric_names: [...untrusted]});
  }
  function toggleDashboardField(field: SummaryField) {
    if (!preferences) return;
    const visible = new Set(preferences.visible_summary_cards);
    const hidden = new Set(preferences.hidden_summary_fields);
    if (visible.has(field) && !hidden.has(field)) {
      visible.delete(field);
      hidden.add(field);
    } else {
      visible.add(field);
      hidden.delete(field);
    }
    void savePreferences({...preferences, visible_summary_cards: [...visible], hidden_summary_fields: [...hidden]});
  }
  function toggleSource(metric: MetricCatalogItem, source: string) {
    if (!preferences) return;
    const existing = new Set(preferences.source_filters[metric.name] || []);
    if (existing.has(source)) existing.delete(source);
    else existing.add(source);
    const source_filters = {...preferences.source_filters};
    if (existing.size) source_filters[metric.name] = [...existing];
    else delete source_filters[metric.name];
    void savePreferences({...preferences, source_filters});
  }
  return (
    <section className="panel">
      <div className="catalog-toolbar">
        <div className="search-box"><Search size={17} /><input type="search" placeholder="Search metric, unit, or source" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <div className="segmented">
          {(["all", "dashboard", "untrusted", "stale"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} type="button" onClick={() => setFilter(item)}>{item}</button>)}
        </div>
      </div>
      <div className="source-strip">
        <span className="muted">Sources</span>
        {sourceOptions.slice(0, 8).map((source) => <span className="source-pill" key={source}>{source}</span>)}
      </div>
      <div className="table-wrap catalog-table">
        <table>
          <thead><tr><th>Metric</th><th>Status</th><th>Rows</th><th>Coverage</th><th>Sources</th><th>Dashboard</th><th>Actions</th></tr></thead>
          <tbody>{metrics.map((metric) => {
            const disabled = preferences?.untrusted_metric_names.includes(metric.name);
            const visibleField = metric.dashboard_field ? preferences?.visible_summary_cards.includes(metric.dashboard_field) && !preferences?.hidden_summary_fields.includes(metric.dashboard_field) : false;
            return (
              <tr key={`${metric.name}:${metric.units || ""}`}>
                <td><strong>{metric.name}</strong><small>{metric.units || "unitless"}</small></td>
                <td><span className={disabled ? "badge bad" : "badge good"}>{disabled ? "Untrusted" : "Trusted"}</span></td>
                <td>{fmt(metric.count)}</td>
                <td>{metric.first_date || ""}<span className="muted"> to </span>{metric.last_date || ""}</td>
                <td>
                  <div className="source-list">
                    {(metric.sources.length ? metric.sources : ["Unknown"]).map((source) => {
                      const selected = preferences?.source_filters[metric.name]?.includes(source);
                      return <button key={source} className={selected ? "source-pill active" : "source-pill"} type="button" onClick={() => toggleSource(metric, source)}>{source}</button>;
                    })}
                  </div>
                </td>
                <td>{metric.dashboard_field ? <button className={visibleField ? "small active" : "small"} type="button" onClick={() => toggleDashboardField(metric.dashboard_field!)}>{visibleField ? <Eye size={14} /> : <EyeOff size={14} />}{fieldMeta[metric.dashboard_field].short}</button> : <span className="muted">Raw only</span>}</td>
                <td><button className="small" type="button" onClick={() => toggleTrust(metric)}>{disabled ? "Trust" : "Untrust"}</button><a className="small-link" href={`/v1/export/metrics/${metric.name}.csv`}>CSV</a></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </section>
  );
}

function CalorieWeight({rows}: {rows: DailySummary[]}) {
  const data = useMemo(() => calorieWeightRows(rows), [rows]);
  const calorieAvg = average(rows, "calories");
  const weightValues = rows.map((row) => row.weight).filter((value): value is number => typeof value === "number");
  const weightChange = weightValues.length >= 2 ? weightValues[weightValues.length - 1] - weightValues[0] : null;
  const correlation = correlationFor(rows, "calories", "weight");
  const weightDomain = tightDomain(rows, "weight");
  return (
    <section className="dashboard-grid">
      <div className="panel span-4 score-panel">
        <span className="eyebrow">Calorie average</span>
        <strong>{fmt(calorieAvg)}</strong>
        <p>Average daily intake across this selected range.</p>
      </div>
      <div className="panel span-4 score-panel">
        <span className="eyebrow">Weight change</span>
        <strong>{weightChange === null ? "Missing" : `${weightChange > 0 ? "+" : ""}${weightChange.toFixed(1)} kg`}</strong>
        <p>First available weight to latest available weight.</p>
      </div>
      <div className="panel span-4 score-panel">
        <span className="eyebrow">Correlation</span>
        <strong>{correlation === null ? "Missing" : correlation.toFixed(2)}</strong>
        <p>Same-day calorie and weight relationship. Use trend direction, not causation.</p>
      </div>
      <div className="panel span-8">
        <div className="panel-head">
          <div><h2>Calories In vs Weight</h2><span className="muted">Calories use bars. Weight uses a tight right-axis scale.</span></div>
          <span className="badge good">tight weight scale</span>
        </div>
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7edf3" />
            <XAxis dataKey="date" minTickGap={28} tickLine={false} />
            <YAxis yAxisId="left" tickLine={false} axisLine={false} />
            <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} domain={weightDomain as [number, number]} />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            <Bar yAxisId="left" dataKey="calories" name="Calories" fill={fieldMeta.calories.color} radius={[4, 4, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="weight" name="Weight" stroke={fieldMeta.weight.color} strokeWidth={3} dot={false} connectNulls />
            <Line yAxisId="left" type="monotone" dataKey="calories7" name="7d calorie avg" stroke="#17202a" strokeWidth={2} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="panel span-4">
        <div className="panel-head"><h2>Weight Response Notes</h2><Weight size={18} /></div>
        <List
          items={calorieWeightInsights(rows, calorieAvg, weightChange, correlation)}
          empty="Not enough overlapping calorie and weight data yet."
        />
      </div>
      <div className="panel span-12">
        <div className="panel-head"><h2>Comparison Table</h2><Table2 size={18} /></div>
        <div className="table-wrap">
          <table className="dense">
            <thead><tr><th>Date</th><th>Calories</th><th>7d Calories</th><th>Weight</th><th>Weight Change</th></tr></thead>
            <tbody>{data.slice().reverse().map((row) => <tr key={row.date}><td>{row.date}</td><td>{fmt(row.calories)}</td><td>{fmt(row.calories7)}</td><td>{fmt(row.weight, 1)}</td><td>{row.weight_delta === null ? "Missing" : `${row.weight_delta > 0 ? "+" : ""}${row.weight_delta.toFixed(1)} kg`}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function SourceExplorer({metrics, selectedSource, setSelectedSource, sourceOptions, preferences, savePreferences}: {metrics: MetricCatalogItem[]; selectedSource: string; setSelectedSource: (value: string) => void; sourceOptions: string[]; preferences: Preferences | null; savePreferences: (value: Preferences) => Promise<void>}) {
  const sourceMetrics = metrics.filter((metric) => (metric.sources.length ? metric.sources : ["Unknown"]).includes(selectedSource));
  const dashboardMetrics = sourceMetrics.filter((metric) => metric.dashboard_field);
  const stale = sourceMetrics.filter((metric) => metric.last_date && metric.last_date < isoDate(-14));
  const trusted = sourceMetrics.filter((metric) => !preferences?.untrusted_metric_names.includes(metric.name));
  const topMetrics = sourceMetrics.slice().sort((a, b) => b.count - a.count).slice(0, 10).map((metric) => ({name: metric.name, count: metric.count}));
  const coverageData = [
    {name: "Dashboard", value: dashboardMetrics.length, color: "#0f766e"},
    {name: "Raw only", value: Math.max(0, sourceMetrics.length - dashboardMetrics.length), color: "#64748b"}
  ];
  function toggleTrust(metric: MetricCatalogItem) {
    if (!preferences) return;
    const untrusted = new Set(preferences.untrusted_metric_names);
    if (untrusted.has(metric.name)) untrusted.delete(metric.name);
    else untrusted.add(metric.name);
    void savePreferences({...preferences, untrusted_metric_names: [...untrusted]});
  }
  return (
    <section className="dashboard-grid">
      <div className="control-panel span-12">
        <div>
          <span className="eyebrow">Source explorer</span>
          <h2>Inspect records by source before trusting them on the dashboard</h2>
        </div>
        <label className="select-field">
          <span>Data source</span>
          <select value={selectedSource} onChange={(event) => setSelectedSource(event.target.value)}>
            {sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
        </label>
      </div>
      <div className="panel span-3 source-stat"><span className="eyebrow">Metrics</span><strong>{sourceMetrics.length}</strong><small>Total metric definitions</small></div>
      <div className="panel span-3 source-stat"><span className="eyebrow">Rows</span><strong>{compact(sourceMetrics.reduce((total, metric) => total + metric.count, 0))}</strong><small>Cataloged records</small></div>
      <div className="panel span-3 source-stat"><span className="eyebrow">Trusted</span><strong>{trusted.length}</strong><small>Not marked untrusted</small></div>
      <div className="panel span-3 source-stat"><span className="eyebrow">Stale</span><strong>{stale.length}</strong><small>Last seen over 14 days ago</small></div>
      <div className="panel span-8">
        <div className="panel-head"><h2>Top Metrics from {selectedSource}</h2><BarChart3 size={18} /></div>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={topMetrics} layout="vertical" margin={{left: 120}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7edf3" />
            <XAxis type="number" tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={140} />
            <Tooltip />
            <Bar dataKey="count" fill="#0f766e" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="panel span-4">
        <div className="panel-head"><h2>Dashboard Mapping</h2><Database size={18} /></div>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={coverageData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={96} paddingAngle={4}>
              {coverageData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="panel span-12">
        <div className="panel-head"><h2>{selectedSource} Metric Detail</h2><span className="muted">{sourceMetrics.length} metrics</span></div>
        <div className="table-wrap">
          <table className="dense">
            <thead><tr><th>Metric</th><th>Rows</th><th>Coverage</th><th>Dashboard Field</th><th>Trust</th><th>Export</th></tr></thead>
            <tbody>{sourceMetrics.map((metric) => {
              const untrusted = preferences?.untrusted_metric_names.includes(metric.name);
              return <tr key={`${metric.name}:${metric.units || ""}`}><td><strong>{metric.name}</strong><small>{metric.units || "unitless"}</small></td><td>{fmt(metric.count)}</td><td>{metric.first_date || ""}<span className="muted"> to </span>{metric.last_date || ""}</td><td>{metric.dashboard_field ? fieldMeta[metric.dashboard_field].label : <span className="muted">Raw only</span>}</td><td><button className={untrusted ? "small" : "small active"} type="button" onClick={() => toggleTrust(metric)}>{untrusted ? "Trust" : "Trusted"}</button></td><td><a className="small-link" href={`/v1/export/metrics/${metric.name}.csv`}>CSV</a></td></tr>;
            })}</tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function DataQuality({rows, metrics, preferences, savePreferences, snapshot}: {rows: DailySummary[]; metrics: MetricCatalogItem[]; preferences: Preferences | null; savePreferences: (value: Preferences) => Promise<void>; snapshot: ReturnType<typeof qualitySnapshot>}) {
  const stale = metrics.filter((metric) => metric.last_date && metric.last_date < isoDate(-14));
  const suspicious = suspiciousValues(rows);
  function hideField(field: SummaryField) {
    if (!preferences) return;
    void savePreferences({
      ...preferences,
      visible_summary_cards: preferences.visible_summary_cards.filter((item) => item !== field),
      hidden_summary_fields: Array.from(new Set([...preferences.hidden_summary_fields, field]))
    });
  }
  return (
    <section className="dashboard-grid">
      <div className="panel span-4 score-panel">
        <span className="eyebrow">Quality score</span>
        <strong>{snapshot.score}%</strong>
        <div className="meter large"><span style={{width: `${snapshot.score}%`}} /></div>
        <p>{snapshot.missingTotal} missing field-days across {rows.length} loaded days.</p>
      </div>
      <div className="panel span-4">
        <div className="panel-head"><h2>Missing Days</h2><AlertTriangle size={18} /></div>
        {allFields.map((field) => (
          <div className="quality-row" key={field}>
            <span>{fieldMeta[field].label}</span>
            <strong>{rows.filter((row) => row[field] === null || row[field] === undefined).length}</strong>
            <button className="ghost-icon" type="button" title={`Hide ${fieldMeta[field].label}`} onClick={() => hideField(field)}><EyeOff size={15} /></button>
          </div>
        ))}
      </div>
      <div className="panel span-4">
        <div className="panel-head"><h2>Reliability Controls</h2><SlidersHorizontal size={18} /></div>
        <p className="quality-copy">Hidden fields: {snapshot.disabledFields.length ? snapshot.disabledFields.map((field) => fieldMeta[field].label).join(", ") : "None"}</p>
        <p className="quality-copy">Untrusted metrics: {snapshot.untrustedMetrics.length ? snapshot.untrustedMetrics.join(", ") : "None"}</p>
        <p className="quality-copy">Source filters: {preferences ? Object.keys(preferences.source_filters).length : 0}</p>
      </div>
      <div className="panel span-6">
        <div className="panel-head"><h2>Stale Metrics</h2><ChevronDown size={18} /></div>
        <List items={stale.slice(0, 10).map((metric) => `${metric.name}: last seen ${metric.last_date}`)} empty="No stale metrics in the selected catalog." />
      </div>
      <div className="panel span-6">
        <div className="panel-head"><h2>Suspicious Values</h2><AlertTriangle size={18} /></div>
        <List items={suspicious.slice(0, 10)} empty="No suspicious dashboard values found." />
      </div>
    </section>
  );
}

function ApiExplorer({catalog, start, end, setStart, setEnd}: {catalog: MetricCatalogItem[]; start: string; end: string; setStart: (value: string) => void; setEnd: (value: string) => void}) {
  const defaultMetric = catalog[0]?.name || "dietary_energy";
  const [datasetId, setDatasetId] = useState<ExplorerDatasetId>("excel_daily_log");
  const [metric, setMetric] = useState(defaultMetric);
  const [preview, setPreview] = useState<unknown>(null);
  const [csvText, setCsvText] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [message, setMessage] = useState("");
  const dataset = explorerDatasets.find((item) => item.id === datasetId) || explorerDatasets[0];
  const url = buildExplorerUrl(dataset, start, end, metric);
  const absoluteUrl = `${window.location.origin}${url}`;
  const rows = useMemo(() => explorerRows(preview, csvText, dataset), [preview, csvText, dataset]);
  const fields = useMemo(() => explorerFields(rows, preview), [rows, preview]);
  const missing = useMemo(() => missingCounts(rows, fields), [rows, fields]);
  const chartField = fields.find((field) => field !== "date" && rows.some((row) => typeof row[field] === "number"));

  useEffect(() => {
    if (!metric && defaultMetric) setMetric(defaultMetric);
  }, [defaultMetric, metric]);

  async function loadPreview() {
    setLoadingPreview(true);
    setMessage("");
    try {
      if (dataset.isCsv) {
        const response = await fetch(url);
        if (response.status === 401) {
          location.href = "/login";
          return;
        }
        if (!response.ok) throw new Error("Request failed");
        const text = await response.text();
        setCsvText(text);
        setPreview(null);
      } else {
        setCsvText("");
        setPreview(await api<unknown>(url));
      }
    } catch {
      setMessage("Could not load this dataset.");
    } finally {
      setLoadingPreview(false);
    }
  }

  useEffect(() => {
    void loadPreview();
  }, [datasetId, metric, start, end]);

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setMessage("Copied.");
  }

  return (
    <section className="dashboard-grid api-explorer">
      <div className="panel span-12">
        <div className="panel-head">
          <div>
            <h2>API Explorer</h2>
            <span className="muted">Browse private datasets, inspect fields, and build refreshable Excel Power Query feeds.</span>
          </div>
          <button className="small" type="button" onClick={loadPreview}>{loadingPreview ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />} Load</button>
        </div>
        <div className="explorer-controls">
          <label className="select-field"><span>Dataset</span><select value={datasetId} onChange={(event) => setDatasetId(event.target.value as ExplorerDatasetId)}>{explorerDatasets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          {dataset.needsMetric ? <label className="select-field"><span>Metric</span><select value={metric} onChange={(event) => setMetric(event.target.value)}>{catalog.map((item) => <option key={`${item.name}-${item.units || ""}`} value={item.name}>{item.name}{item.units ? ` (${item.units})` : ""}</option>)}</select></label> : null}
          {dataset.needsRange ? <DateField label="Start" value={start} setValue={setStart} /> : null}
          {dataset.needsRange ? <DateField label="End" value={end} setValue={setEnd} /> : null}
          <a className="button explorer-download" href={url}><Download size={16} /> {dataset.isCsv ? "CSV" : "Open"}</a>
        </div>
        {message ? <div className="notice compact"><CheckCircle2 size={18} />{message}</div> : null}
      </div>

      <div className="panel span-3 source-stat"><span className="eyebrow">Rows</span><strong>{rows.length}</strong><small>{dataset.isCsv ? "CSV preview rows" : "JSON records"}</small></div>
      <div className="panel span-3 source-stat"><span className="eyebrow">Fields</span><strong>{fields.length}</strong><small>{fields.slice(0, 4).join(", ") || "No fields yet"}</small></div>
      <div className="panel span-3 source-stat"><span className="eyebrow">Missing cells</span><strong>{Object.values(missing).reduce((total, value) => total + value, 0)}</strong><small>Blank, null, or undefined values</small></div>
      <div className="panel span-3 source-stat"><span className="eyebrow">Format</span><strong>{dataset.isCsv ? "CSV" : "JSON"}</strong><small>{dataset.excel ? "Excel-ready feed" : "Dashboard API"}</small></div>

      <div className="panel span-8">
        <div className="panel-head"><h2>Preview</h2><Table2 size={18} /></div>
        {rows.length ? <GenericTable rows={rows.slice(0, 25)} fields={fields.slice(0, 10)} /> : <p className="quality-copy">No rows returned for the selected dataset and range.</p>}
      </div>
      <div className="panel span-4">
        <div className="panel-head"><h2>Fields</h2><Database size={18} /></div>
        <div className="field-list">{fields.map((field) => <div key={field}><strong>{field}</strong><span>{missing[field] || 0} missing</span></div>)}</div>
      </div>
      <div className="panel span-6">
        <div className="panel-head"><h2>Chart Preview</h2><LineChartIcon size={18} /></div>
        {chartField ? <ExplorerChart rows={rows} field={chartField} /> : <p className="quality-copy">No numeric field is available to chart.</p>}
      </div>
      <div className="panel span-6">
        <div className="panel-head"><h2>Excel Power Query</h2><FileSpreadsheet size={18} /></div>
        <div className="copy-stack">
          <label><span>URL</span><input readOnly value={absoluteUrl} /></label>
          <button className="small" type="button" onClick={() => copy(absoluteUrl)}><Clipboard size={15} /> Copy URL</button>
          <label><span>Header</span><input readOnly value="X-API-Key: <HEALTH_EXPORT_READ_API_KEY>" /></label>
          <button className="small" type="button" onClick={() => copy("X-API-Key: <HEALTH_EXPORT_READ_API_KEY>")}><Clipboard size={15} /> Copy header</button>
        </div>
        <p className="quality-copy">In Excel, use Data from Web, choose Advanced, paste the URL, and add an `X-API-Key` request header with the read token.</p>
      </div>
      <div className="panel span-12">
        <div className="panel-head"><h2>Raw Response</h2><Code2 size={18} /></div>
        <pre className="raw-panel">{dataset.isCsv ? csvText : JSON.stringify(preview, null, 2)}</pre>
      </div>
    </section>
  );
}

function Settings({preferences, savePreferences, loadRange, metrics}: {preferences: Preferences; savePreferences: (value: Preferences) => Promise<void>; loadRange: (rangeDays?: number) => Promise<void>; metrics: MetricCatalogItem[]}) {
  function setField(field: SummaryField, enabled: boolean) {
    const visible = new Set(preferences.visible_summary_cards);
    const hidden = new Set(preferences.hidden_summary_fields);
    if (enabled) {
      visible.add(field);
      hidden.delete(field);
    } else {
      visible.delete(field);
      hidden.add(field);
    }
    void savePreferences({...preferences, visible_summary_cards: [...visible], hidden_summary_fields: [...hidden]});
  }
  function setChart(field: SummaryField, enabled: boolean) {
    const set = new Set(preferences.default_chart_set);
    if (enabled) set.add(field);
    else set.delete(field);
    void savePreferences({...preferences, default_chart_set: [...set]});
  }
  function setRange(days: number) {
    void savePreferences({...preferences, preferred_range_days: days}).then(() => loadRange(days));
  }
  return (
    <section className="settings-grid">
      <div className="panel">
        <div className="panel-head"><h2>Summary Visibility</h2><Eye size={18} /></div>
        <div className="toggle-list">{allFields.map((field) => <Switch key={field} label={fieldMeta[field].label} checked={preferences.visible_summary_cards.includes(field) && !preferences.hidden_summary_fields.includes(field)} onChange={(checked) => setField(field, checked)} />)}</div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Default Charts</h2><LineChartIcon size={18} /></div>
        <div className="toggle-list">{allFields.map((field) => <Switch key={field} label={fieldMeta[field].label} checked={preferences.default_chart_set.includes(field)} onChange={(checked) => setChart(field, checked)} />)}</div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Default Range</h2><CalendarDays size={18} /></div>
        <div className="range-grid">{rangeOptions.map((days) => <button key={days} className={preferences.preferred_range_days === days ? "range-card active" : "range-card"} type="button" onClick={() => setRange(days)}><strong>{days}</strong><span>days</span></button>)}</div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Reset and Coverage</h2><SettingsIcon size={18} /></div>
        <p className="quality-copy">{metrics.length} metric definitions are available. {Object.keys(preferences.source_filters).length} metric source filters are active.</p>
        <button type="button" onClick={() => void savePreferences({visible_summary_cards: allFields, hidden_summary_fields: [], preferred_range_days: 30, trusted_metric_names: [], untrusted_metric_names: [], default_chart_set: ["calories", "protein", "carbohydrates", "fat", "active_energy"], source_filters: {}})}>Reset defaults</button>
      </div>
    </section>
  );
}

function MultiMetricChart({rows, fields}: {rows: DailySummary[]; fields: SummaryField[]}) {
  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e7edf3" />
        <XAxis dataKey="date" minTickGap={28} tickLine={false} />
        <YAxis tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltip />} />
        <Legend />
        {fields.map((field, index) => {
          const meta = fieldMeta[field];
          return index === 0
            ? <Area key={field} type="monotone" dataKey={field} name={meta.label} stroke={meta.color} fill={meta.soft} strokeWidth={2} connectNulls />
            : <Line key={field} type="monotone" dataKey={field} name={meta.label} stroke={meta.color} dot={false} strokeWidth={2} connectNulls />;
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function SingleMetricChart({rows, field, scaleMode}: {rows: DailySummary[]; field: SummaryField; scaleMode: ScaleMode}) {
  const meta = fieldMeta[field];
  const data = scaleMode === "indexed" ? indexedRows(rows, field) : rows;
  const dataKey = scaleMode === "indexed" ? `${field}_indexed` : field;
  const domain = scaleMode === "zero" ? [0, "auto"] : scaleMode === "tight" ? tightDomain(rows, field) : ["auto", "auto"];
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id={`fill-${field}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor={meta.color} stopOpacity={0.28} />
            <stop offset="95%" stopColor={meta.color} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e7edf3" />
        <XAxis dataKey="date" minTickGap={30} tickLine={false} />
        <YAxis tickLine={false} axisLine={false} domain={domain as [number | string, number | string]} />
        <Tooltip content={<ChartTooltip />} />
        <Area type="monotone" dataKey={dataKey} name={scaleMode === "indexed" ? `${meta.label} index` : meta.label} stroke={meta.color} fill={`url(#fill-${field})`} strokeWidth={2} connectNulls />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ComparisonBars({rows, fields}: {rows: DailySummary[]; fields: SummaryField[]}) {
  const data = fields.map((field) => ({name: fieldMeta[field].short, current: average(secondHalf(rows), field), previous: average(firstHalf(rows), field), fill: fieldMeta[field].color}));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e7edf3" />
        <XAxis dataKey="name" tickLine={false} />
        <YAxis tickLine={false} axisLine={false} />
        <Tooltip />
        <Legend />
        <Bar dataKey="previous" fill="#cbd5e1" name="Previous" radius={[4, 4, 0, 0]} />
        <Bar dataKey="current" name="Current" radius={[4, 4, 0, 0]}>
          {data.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ConsistencyList({rows, fields}: {rows: DailySummary[]; fields: SummaryField[]}) {
  return <div className="consistency-list">{fields.map((field) => {
    const values = rows.map((row) => row[field]).filter((value): value is number => typeof value === "number");
    const avg = average(rows, field);
    const variance = avg ? Math.min(100, Math.round((standardDeviation(values) / avg) * 100)) : 0;
    return <div className="consistency-item" key={field}><span>{fieldMeta[field].label}</span><strong>{variance}% variation</strong><div className="meter"><span style={{width: `${Math.max(4, 100 - variance)}%`, background: fieldMeta[field].color}} /></div></div>;
  })}</div>;
}

function DailyTable({rows, fields, dense = false}: {rows: DailySummary[]; fields: SummaryField[]; dense?: boolean}) {
  return <div className="table-wrap"><table className={dense ? "dense" : ""}><thead><tr><th>Date</th>{fields.map((field) => <th key={field}>{fieldMeta[field].short}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.date}><td>{row.date}</td>{fields.map((field) => <td key={field}>{fmt(row[field], fieldMeta[field].digits)}</td>)}</tr>)}</tbody></table></div>;
}

function DateField({label, value, setValue}: {label: string; value: string; setValue: (value: string) => void}) {
  return <label className="date-field"><span>{label}</span><input type="date" value={value} onChange={(event) => setValue(event.target.value)} /></label>;
}

function IconButton({label, onClick, children}: {label: string; onClick: () => void; children: React.ReactNode}) {
  return <button className="icon-button" type="button" title={label} onClick={onClick}>{children}</button>;
}

function StatusPill({icon: Icon, label, value, tone, spin}: {icon: React.ElementType; label: string; value: string; tone?: "good" | "warn" | "bad" | "active"; spin?: boolean}) {
  return <div className={tone ? `status-pill ${tone}` : "status-pill"}><Icon className={spin ? "spin" : ""} size={17} /><span>{label}</span><strong>{value}</strong></div>;
}

function Switch({label, checked, onChange}: {label: string; checked: boolean; onChange: (checked: boolean) => void}) {
  return <label className="switch-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}

function List({items, empty}: {items: string[]; empty: string}) {
  return items.length ? <div className="issue-list">{items.map((item) => <p key={item}>{item}</p>)}</div> : <p className="quality-copy">{empty}</p>;
}

function LoadingState() {
  return <section className="loading-grid">{Array.from({length: 8}).map((_, index) => <div className="skeleton" key={index} />)}</section>;
}

function ChartTooltip({active, payload, label}: {active?: boolean; payload?: Array<{name: string; value: number; color: string}>; label?: string}) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.map((item) => <span key={item.name} style={{color: item.color}}>{item.name}: {fmt(item.value)}</span>)}</div>;
}

function GenericTable({rows, fields}: {rows: Array<Record<string, unknown>>; fields: string[]}) {
  return <div className="table-wrap"><table className="dense"><thead><tr>{fields.map((field) => <th key={field}>{field}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{fields.map((field) => <td key={field}>{formatCell(row[field])}</td>)}</tr>)}</tbody></table></div>;
}

function ExplorerChart({rows, field}: {rows: Array<Record<string, unknown>>; field: string}) {
  const data = rows.filter((row) => typeof row[field] === "number").map((row, index) => ({date: String(row.date || row.timestamp || index + 1), value: row[field] as number}));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e7edf3" />
        <XAxis dataKey="date" minTickGap={30} tickLine={false} />
        <YAxis tickLine={false} axisLine={false} />
        <Tooltip />
        <Area type="monotone" dataKey="value" name={field} stroke="#0f766e" fill="#d9f6f2" strokeWidth={2} connectNulls />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function buildExplorerUrl(dataset: (typeof explorerDatasets)[number], start: string, end: string, metric: string) {
  const path = dataset.path.replace("{metric}", encodeURIComponent(metric || "dietary_energy"));
  const params = new URLSearchParams();
  if (dataset.needsRange) {
    if (start) params.set("start", start);
    if (end) params.set("end", end);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function explorerRows(preview: unknown, csvText: string, dataset: (typeof explorerDatasets)[number]): Array<Record<string, unknown>> {
  if (dataset.isCsv) return parseCsvPreview(csvText);
  if (Array.isArray(preview)) return preview.filter(isRecord);
  if (isRecord(preview)) {
    const keyed = dataset.rowKey ? preview[dataset.rowKey] : null;
    if (Array.isArray(keyed)) return keyed.filter(isRecord);
    return [preview];
  }
  return [];
}

function explorerFields(rows: Array<Record<string, unknown>>, preview: unknown) {
  const fields = new Set<string>();
  rows.slice(0, 50).forEach((row) => Object.keys(row).forEach((field) => fields.add(field)));
  if (!fields.size && isRecord(preview)) Object.keys(preview).forEach((field) => fields.add(field));
  return [...fields];
}

function missingCounts(rows: Array<Record<string, unknown>>, fields: string[]) {
  return Object.fromEntries(fields.map((field) => [field, rows.filter((row) => row[field] === null || row[field] === undefined || row[field] === "").length]));
}

function parseCsvPreview(text: string): Array<Record<string, unknown>> {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  if (!headerLine) return [];
  const headers = splitCsvLine(headerLine);
  return lines.slice(0, 100).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, coerceCsvValue(values[index] ?? "")]));
  });
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function coerceCsvValue(value: string): string | number | null {
  if (value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && value.trim() !== "" ? numeric : value;
}

function formatCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return fmt(value, Number.isInteger(value) ? 0 : 2);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function activeTabLabel(tab: TabId): string {
  return tabs.find((item) => item.id === tab)?.label || "Dashboard";
}

function headline(tab: TabId): string {
  const labels: Record<TabId, string> = {
    overview: "Daily nutrition and activity control room",
    nutrition: "Macro adherence and calorie flow",
    trends: "Configurable metric trend board",
    calorie_weight: "Calories in versus weight change",
    sources: "Source-level data explorer",
    metrics: "Metric catalog and source controls",
    api_explorer: "API Explorer and Excel feeds",
    quality: "Data reliability and freshness",
    settings: "Dashboard preferences"
  };
  return labels[tab];
}

function subhead(tab: TabId, rangeDays: number, loadedDays: number): string {
  if (tab === "metrics") return "Search, trust, filter, export, and map raw Health Auto Export metrics.";
  if (tab === "api_explorer") return "Preview private API datasets and generate Excel Power Query URL/header pairs.";
  if (tab === "quality") return "Find stale, missing, suspicious, or hidden fields before they affect decisions.";
  if (tab === "sources") return "Choose an Apple Health or MacroFactor source and inspect coverage, trust, freshness, and exports.";
  if (tab === "calorie_weight") return "Compare calorie intake with weight movement using a tight weight axis and rolling calorie averages.";
  return `${loadedDays} loaded days across the selected ${rangeDays} day window.`;
}

function filterCatalog(metrics: MetricCatalogItem[], search: string, filter: "all" | "dashboard" | "untrusted" | "stale") {
  const query = search.toLowerCase();
  return metrics.filter((metric) => {
    const matches = `${metric.name} ${metric.units || ""} ${metric.sources.join(" ")} ${metric.dashboard_field || ""}`.toLowerCase().includes(query);
    if (!matches) return false;
    if (filter === "dashboard") return Boolean(metric.dashboard_field);
    if (filter === "untrusted") return !metric.is_trusted;
    if (filter === "stale") return Boolean(metric.last_date && metric.last_date < isoDate(-14));
    return true;
  });
}

function qualitySnapshot(rows: DailySummary[], metrics: MetricCatalogItem[], preferences: Preferences | null) {
  const missingTotal = rows.reduce((total, row) => total + allFields.filter((field) => row[field] === null || row[field] === undefined).length, 0);
  const totalSlots = Math.max(1, rows.length * allFields.length);
  const staleCount = metrics.filter((metric) => metric.last_date && metric.last_date < isoDate(-14)).length;
  const disabledFields = allFields.filter((field) => preferences?.hidden_summary_fields.includes(field) || !preferences?.visible_summary_cards.includes(field));
  const untrustedMetrics = preferences?.untrusted_metric_names || [];
  const score = Math.max(0, Math.round(100 - (missingTotal / totalSlots) * 70 - staleCount * 1.5 - untrustedMetrics.length * 2));
  return {score, missingTotal, staleCount, disabledFields, untrustedMetrics};
}

function buildInsights(rows: DailySummary[], dataHealth: ReturnType<typeof qualitySnapshot>) {
  const calorieTrend = deltaPercent(rows, "calories");
  const proteinAvg = average(rows.slice(-7), "protein");
  const missing = dataHealth.missingTotal;
  return [
    {title: calorieTrend >= 0 ? "Calories trending up" : "Calories trending down", detail: `${Math.abs(calorieTrend).toFixed(1)}% versus the previous comparable window.`, icon: calorieTrend >= 0 ? TrendingUp : TrendingDown},
    {title: "Protein 7 day average", detail: proteinAvg === null ? "No usable protein entries in range." : `${fmt(proteinAvg)} g per day.`, icon: Utensils},
    {title: missing ? "Missing data needs review" : "No missing dashboard fields", detail: missing ? `${missing} field-days are missing in this range.` : "Visible dashboard fields are complete.", icon: missing ? AlertTriangle : CheckCircle2}
  ];
}

function suspiciousValues(rows: DailySummary[]) {
  const issues: string[] = [];
  rows.forEach((row) => {
    if ((row.calories || 0) > 6000) issues.push(`${row.date}: calories above 6,000 kcal`);
    if ((row.water || 0) > 10000) issues.push(`${row.date}: water above 10,000 mL`);
    if ((row.steps || 0) > 70000) issues.push(`${row.date}: steps above 70,000`);
    if ((row.weight || 0) > 250) issues.push(`${row.date}: weight above 250 kg`);
  });
  return issues;
}

function scaleDescription(field: SummaryField, mode: ScaleMode) {
  if (mode === "tight") return `Tight scale around the observed ${fieldMeta[field].unit || "value"} range.`;
  if (mode === "zero") return "Zero baseline for absolute magnitude.";
  if (mode === "indexed") return "Indexed to first visible value so small changes stand out.";
  return "Automatic chart scale.";
}

function tightDomain(rows: DailySummary[], field: SummaryField): [number, number] {
  const values = rows.map((row) => row[field]).filter((value): value is number => typeof value === "number");
  if (!values.length) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const padding = Math.max(1, Math.abs(min) * 0.02);
    return [roundDomain(min - padding), roundDomain(max + padding)];
  }
  const padding = (max - min) * 0.18;
  return [roundDomain(min - padding), roundDomain(max + padding)];
}

function roundDomain(value: number) {
  return Math.round(value * 10) / 10;
}

function indexedRows(rows: DailySummary[], field: SummaryField) {
  const first = rows.find((row) => typeof row[field] === "number")?.[field];
  return rows.map((row) => ({
    ...row,
    [`${field}_indexed`]: typeof row[field] === "number" && typeof first === "number" && first !== 0 ? ((row[field] as number) / first) * 100 : null
  }));
}

function calorieWeightRows(rows: DailySummary[]) {
  let firstWeight: number | null = null;
  return rows.map((row, index) => {
    if (firstWeight === null && typeof row.weight === "number") firstWeight = row.weight;
    const trailing = rows.slice(Math.max(0, index - 6), index + 1);
    return {
      date: row.date,
      calories: row.calories,
      calories7: average(trailing, "calories"),
      weight: row.weight,
      weight_delta: typeof row.weight === "number" && firstWeight !== null ? row.weight - firstWeight : null
    };
  });
}

function calorieWeightInsights(rows: DailySummary[], calorieAvg: number | null, weightChange: number | null, correlation: number | null) {
  const items: string[] = [];
  if (calorieAvg !== null) items.push(`Average intake is ${fmt(calorieAvg)} kcal/day in this range.`);
  if (weightChange !== null) items.push(`Weight moved ${weightChange > 0 ? "up" : weightChange < 0 ? "down" : "flat"} by ${Math.abs(weightChange).toFixed(1)} kg.`);
  if (correlation !== null) items.push(`Same-day calorie/weight correlation is ${correlation.toFixed(2)}. Expect lag, water, sodium, and gut-content noise.`);
  const missingWeight = rows.filter((row) => row.weight === null || row.weight === undefined).length;
  if (missingWeight) items.push(`${missingWeight} selected days have no dashboard weight value.`);
  return items;
}

function correlationFor(rows: DailySummary[], a: SummaryField, b: SummaryField): number | null {
  const pairs = rows
    .filter((row) => typeof row[a] === "number" && typeof row[b] === "number")
    .map((row) => [row[a] as number, row[b] as number]);
  if (pairs.length < 3) return null;
  const avgA = pairs.reduce((total, pair) => total + pair[0], 0) / pairs.length;
  const avgB = pairs.reduce((total, pair) => total + pair[1], 0) / pairs.length;
  const numerator = pairs.reduce((total, pair) => total + (pair[0] - avgA) * (pair[1] - avgB), 0);
  const denomA = Math.sqrt(pairs.reduce((total, pair) => total + (pair[0] - avgA) ** 2, 0));
  const denomB = Math.sqrt(pairs.reduce((total, pair) => total + (pair[1] - avgB) ** 2, 0));
  if (!denomA || !denomB) return null;
  return numerator / (denomA * denomB);
}

function average(rows: DailySummary[], field: SummaryField): number | null {
  const values = rows.map((row) => row[field]).filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function sum(rows: DailySummary[], field: SummaryField): number {
  return rows.reduce((total, row) => total + (row[field] || 0), 0);
}

function standardDeviation(values: number[]) {
  if (!values.length) return 0;
  const avg = values.reduce((total, value) => total + value, 0) / values.length;
  return Math.sqrt(values.reduce((total, value) => total + (value - avg) ** 2, 0) / values.length);
}

function firstHalf(rows: DailySummary[]) {
  return rows.slice(0, Math.floor(rows.length / 2));
}

function secondHalf(rows: DailySummary[]) {
  return rows.slice(Math.floor(rows.length / 2));
}

function deltaPercent(rows: DailySummary[], field: SummaryField) {
  const previous = average(firstHalf(rows), field);
  const current = average(secondHalf(rows), field);
  if (!previous || current === null) return 0;
  return ((current - previous) / previous) * 100;
}

function daysBetween(start: string, end: string) {
  const from = new Date(`${start}T00:00:00Z`).getTime();
  const to = new Date(`${end}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"});
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
