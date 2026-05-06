import React, {useEffect, useMemo, useState} from "react";
import {createRoot} from "react-dom/client";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

type DailySummary = {
  date: string;
  calories: number | null;
  protein: number | null;
  carbohydrates: number | null;
  fat: number | null;
  water: number | null;
  weight: number | null;
  steps: number | null;
  active_energy: number | null;
};

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

const fieldMeta: Record<SummaryField, {label: string; unit: string; color: string; digits?: number}> = {
  calories: {label: "Calories", unit: "kcal", color: "#2563eb"},
  protein: {label: "Protein", unit: "g", color: "#16a34a"},
  carbohydrates: {label: "Carbs", unit: "g", color: "#d97706"},
  fat: {label: "Fat", unit: "g", color: "#9333ea"},
  water: {label: "Water", unit: "mL", color: "#0891b2"},
  weight: {label: "Weight", unit: "kg", color: "#dc2626", digits: 1},
  steps: {label: "Steps", unit: "", color: "#4f46e5"},
  active_energy: {label: "Active Energy", unit: "kcal", color: "#0f766e"}
};

const allFields = Object.keys(fieldMeta) as SummaryField[];
const tabs = ["Overview", "Nutrition", "Trends", "Metrics", "Data Quality", "Settings"] as const;

function isoDate(offsetDays: number): string {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function fmt(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "Missing";
  return Number(value).toLocaleString(undefined, {maximumFractionDigits: digits});
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
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("Overview");
  const [start, setStart] = useState(isoDate(-30));
  const [end, setEnd] = useState(isoDate(0));
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [catalog, setCatalog] = useState<MetricCatalogItem[]>([]);
  const [status, setStatus] = useState<IngestStatus | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const visibleFields = preferences?.visible_summary_cards.filter((field) => !preferences.hidden_summary_fields.includes(field)) || allFields;

  async function load(rangeDays?: number) {
    setError("");
    try {
      const prefs = await api<Preferences>("/v1/dashboard/preferences");
      const nextStart = rangeDays ? isoDate(-rangeDays) : preferences ? start : isoDate(-prefs.preferred_range_days);
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
    }
  }

  async function savePreferences(next: Preferences) {
    setPreferences(next);
    const saved = await api<Preferences>("/v1/dashboard/preferences", {method: "PUT", body: JSON.stringify(next)});
    setPreferences(saved);
    await load();
  }

  useEffect(() => {
    void load();
  }, []);

  const rows = summary?.summaries || [];
  const latest = rows[rows.length - 1];
  const filteredCatalog = catalog.filter((metric) => `${metric.name} ${metric.units || ""} ${metric.sources.join(" ")}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Health Export</h1>
          <p>{status ? `Latest ingest ${status.latest_batch_at || "never"} | ${fmt(status.metric_record_count)} metric rows` : "Loading data"}</p>
        </div>
        <div className="top-actions">
          <label>
            <span>Start</span>
            <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label>
            <span>End</span>
            <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
          <button type="button" onClick={() => void load()}>Refresh</button>
          <a className="button secondary" href={`/v1/export/daily-summary.csv?start=${start}&end=${end}`}>Export</a>
          <form method="post" action="/logout"><button className="secondary" type="submit">Logout</button></form>
        </div>
      </header>

      <main>
        <nav className="tabs" aria-label="Dashboard sections">
          {tabs.map((tab) => <button key={tab} className={tab === activeTab ? "active" : ""} type="button" onClick={() => setActiveTab(tab)}>{tab}</button>)}
        </nav>
        {error ? <p className="notice">{error}</p> : null}
        {activeTab === "Overview" && <Overview rows={rows} latest={latest} visibleFields={visibleFields} />}
        {activeTab === "Nutrition" && <Nutrition rows={rows} visibleFields={visibleFields} />}
        {activeTab === "Trends" && <Trends rows={rows} fields={preferences?.default_chart_set || visibleFields} />}
        {activeTab === "Metrics" && <Metrics metrics={filteredCatalog} search={search} setSearch={setSearch} preferences={preferences} savePreferences={savePreferences} />}
        {activeTab === "Data Quality" && <DataQuality rows={rows} metrics={catalog} preferences={preferences} />}
        {activeTab === "Settings" && preferences ? <Settings preferences={preferences} savePreferences={savePreferences} loadRange={load} /> : null}
      </main>
    </>
  );
}

function Overview({rows, latest, visibleFields}: {rows: DailySummary[]; latest?: DailySummary; visibleFields: SummaryField[]}) {
  return (
    <>
      <section className="card-grid">
        {visibleFields.map((field) => <SummaryCard key={field} field={field} value={latest?.[field] ?? null} rows={rows} />)}
      </section>
      <section className="panel">
        <h2>Recent Daily Summary</h2>
        <DailyTable rows={rows.slice(-14).reverse()} fields={visibleFields} />
      </section>
    </>
  );
}

function SummaryCard({field, value, rows}: {field: SummaryField; value: number | null; rows: DailySummary[]}) {
  const meta = fieldMeta[field];
  const last7 = average(rows.slice(-7), field);
  const last30 = average(rows.slice(-30), field);
  return (
    <article className="summary-card">
      <div className="card-label">{meta.label}</div>
      <div className={value === null ? "card-value missing" : "card-value"}>{fmt(value, meta.digits)} {value !== null ? meta.unit : ""}</div>
      <div className="card-sub">7d {fmt(last7, meta.digits)} | 30d {fmt(last30, meta.digits)}</div>
    </article>
  );
}

function Nutrition({rows, visibleFields}: {rows: DailySummary[]; visibleFields: SummaryField[]}) {
  const macroData = ["protein", "carbohydrates", "fat"].map((field) => ({name: fieldMeta[field as SummaryField].label, value: sum(rows.slice(-7), field as SummaryField)}));
  return (
    <div className="two-col">
      <section className="panel wide">
        <h2>Calories and Macros</h2>
        <Chart rows={rows} fields={["calories", "protein", "carbohydrates", "fat"].filter((field) => visibleFields.includes(field as SummaryField)) as SummaryField[]} />
      </section>
      <section className="panel">
        <h2>7 Day Macro Split</h2>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={macroData} dataKey="value" nameKey="name" outerRadius={92}>
              {macroData.map((entry, index) => <Cell key={entry.name} fill={["#16a34a", "#d97706", "#9333ea"][index]} />)}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </section>
      <section className="panel wide"><h2>Daily Nutrition</h2><DailyTable rows={rows.slice().reverse()} fields={visibleFields} /></section>
    </div>
  );
}

function Trends({rows, fields}: {rows: DailySummary[]; fields: SummaryField[]}) {
  return <section className="chart-grid">{fields.map((field) => <div className="panel" key={field}><h2>{fieldMeta[field].label}</h2><Chart rows={rows} fields={[field]} /></div>)}</section>;
}

function Metrics({metrics, search, setSearch, preferences, savePreferences}: {metrics: MetricCatalogItem[]; search: string; setSearch: (value: string) => void; preferences: Preferences | null; savePreferences: (value: Preferences) => Promise<void>}) {
  function toggleTrust(metric: MetricCatalogItem) {
    if (!preferences) return;
    const untrusted = new Set(preferences.untrusted_metric_names);
    if (untrusted.has(metric.name)) untrusted.delete(metric.name);
    else untrusted.add(metric.name);
    void savePreferences({...preferences, untrusted_metric_names: [...untrusted]});
  }
  return (
    <section className="panel">
      <div className="panel-head"><h2>Metric Catalog</h2><input type="search" placeholder="Search metrics" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <div className="table-wrap"><table><thead><tr><th>Metric</th><th>Units</th><th>Rows</th><th>Coverage</th><th>Sources</th><th>Field</th><th>Actions</th></tr></thead><tbody>{metrics.map((metric) => (
        <tr key={`${metric.name}:${metric.units || ""}`}>
          <td>{metric.name}</td><td>{metric.units || ""}</td><td>{fmt(metric.count)}</td><td>{metric.first_date || ""} to {metric.last_date || ""}</td><td>{metric.sources.join(", ") || "Unknown"}</td><td>{metric.dashboard_field || ""}</td>
          <td><button className="small" type="button" onClick={() => toggleTrust(metric)}>{preferences?.untrusted_metric_names.includes(metric.name) ? "Trust" : "Untrust"}</button> <a href={`/v1/export/metrics/${metric.name}.csv`}>CSV</a></td>
        </tr>
      ))}</tbody></table></div>
    </section>
  );
}

function DataQuality({rows, metrics, preferences}: {rows: DailySummary[]; metrics: MetricCatalogItem[]; preferences: Preferences | null}) {
  const stale = metrics.filter((metric) => metric.last_date && metric.last_date < isoDate(-14));
  const disabled = allFields.filter((field) => preferences?.hidden_summary_fields.includes(field) || !preferences?.visible_summary_cards.includes(field));
  return (
    <div className="quality-grid">
      <section className="panel"><h2>Missing Days</h2>{allFields.map((field) => <p key={field}><strong>{fieldMeta[field].label}</strong>: {rows.filter((row) => row[field] === null || row[field] === undefined).length} missing</p>)}</section>
      <section className="panel"><h2>Reliability</h2><p>Disabled fields: {disabled.length ? disabled.map((field) => fieldMeta[field].label).join(", ") : "None"}</p><p>Untrusted metrics: {preferences?.untrusted_metric_names.join(", ") || "None"}</p></section>
      <section className="panel"><h2>Stale Metrics</h2>{stale.length ? stale.slice(0, 8).map((metric) => <p key={metric.name}>{metric.name}: {metric.last_date}</p>) : <p>No stale metrics in the catalog.</p>}</section>
    </div>
  );
}

function Settings({preferences, savePreferences, loadRange}: {preferences: Preferences; savePreferences: (value: Preferences) => Promise<void>; loadRange: (rangeDays?: number) => Promise<void>}) {
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
  function setRange(days: number) {
    void savePreferences({...preferences, preferred_range_days: days}).then(() => loadRange(days));
  }
  return (
    <section className="panel settings">
      <h2>Settings</h2>
      <div className="setting-group">{allFields.map((field) => <label className="check" key={field}><input type="checkbox" checked={preferences.visible_summary_cards.includes(field) && !preferences.hidden_summary_fields.includes(field)} onChange={(event) => setField(field, event.target.checked)} />{fieldMeta[field].label}</label>)}</div>
      <div className="setting-group"><span>Default range</span>{[7, 14, 30, 90].map((days) => <button key={days} className={preferences.preferred_range_days === days ? "active" : "secondary"} type="button" onClick={() => setRange(days)}>{days} days</button>)}</div>
      <button type="button" onClick={() => void savePreferences({visible_summary_cards: allFields, hidden_summary_fields: [], preferred_range_days: 30, trusted_metric_names: [], untrusted_metric_names: [], default_chart_set: ["calories", "protein", "carbohydrates", "fat", "active_energy"], source_filters: {}})}>Reset defaults</button>
    </section>
  );
}

function DailyTable({rows, fields}: {rows: DailySummary[]; fields: SummaryField[]}) {
  return <div className="table-wrap"><table><thead><tr><th>Date</th>{fields.map((field) => <th key={field}>{fieldMeta[field].label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.date}><td>{row.date}</td>{fields.map((field) => <td key={field}>{fmt(row[field], fieldMeta[field].digits)}</td>)}</tr>)}</tbody></table></div>;
}

function Chart({rows, fields}: {rows: DailySummary[]; fields: SummaryField[]}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" minTickGap={26} />
        <YAxis />
        <Tooltip />
        <Legend />
        {fields.map((field) => <Line key={field} type="monotone" dataKey={field} name={fieldMeta[field].label} stroke={fieldMeta[field].color} dot={false} strokeWidth={2} connectNulls />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

function average(rows: DailySummary[], field: SummaryField): number | null {
  const values = rows.map((row) => row[field]).filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function sum(rows: DailySummary[], field: SummaryField): number {
  return rows.reduce((total, row) => total + (row[field] || 0), 0);
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
