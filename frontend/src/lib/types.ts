export interface DailySummary {
  date: string;
  calories: number | null;
  protein: number | null;
  carbohydrates: number | null;
  fat: number | null;
  water: number | null;
  weight: number | null;
  steps: number | null;
  active_energy: number | null;
}

export interface DashboardSummaryResponse {
  count: number;
  first_date: string | null;
  last_date: string | null;
  latest_date: string | null;
  summaries: DailySummary[];
  hidden_fields: string[];
}

export interface Preferences {
  visible_summary_cards: string[];
  hidden_summary_fields: string[];
  preferred_range_days: number;
  trusted_metric_names: string[];
  untrusted_metric_names: string[];
  default_chart_set: string[];
  source_filters: Record<string, string[]>;
}

export interface MetricCatalogItem {
  name: string;
  units: string | null;
  count: number;
  first_date: string | null;
  last_date: string | null;
  sources: string[];
  dashboard_field: string | null;
  is_trusted: boolean;
}

export interface MetricCatalogResponse {
  count: number;
  metrics: MetricCatalogItem[];
}

export interface DiagnosticItem {
  metric_name: string;
  units: string | null;
  source: string | null;
  dashboard_field: string | null;
  aggregation: string;
  row_count: number;
  summed_value: number | null;
  replacement_value: number | null;
  collapsed_value: number | null;
  first_record_id: number;
  latest_record_id: number;
  first_timestamp: string | null;
  latest_timestamp: string | null;
  suspicious: boolean;
}

export interface DiagnosticsResponse {
  date: string;
  count: number;
  diagnostics: DiagnosticItem[];
}

export interface RepairDayDelta {
  date: string;
  metric_name: string;
  source: string | null;
  before_total: number;
  after_total: number;
  removed_row_ids: number[];
}

export interface RepairReport {
  dry_run: boolean;
  groups_inspected: number;
  rows_removed: number;
  backup_path: string | null;
  deltas: RepairDayDelta[];
}

export interface IngestStatus {
  latest_batch_at: string | null;
  batch_count: number;
  metric_record_count: number;
  workout_record_count: number;
  first_date: string | null;
  last_date: string | null;
}

export type SummaryField = "calories" | "protein" | "carbohydrates" | "fat" | "water" | "weight" | "steps" | "active_energy";

export interface FieldMeta {
  label: string;
  unit: string;
  color: string;
  decimals: number;
}

export const FIELD_META: Record<SummaryField, FieldMeta> = {
  calories:      { label: "Calories",      unit: "kcal", color: "var(--color-calories)", decimals: 0 },
  protein:       { label: "Protein",       unit: "g",    color: "var(--color-protein)",  decimals: 1 },
  carbohydrates: { label: "Carbs",         unit: "g",    color: "var(--color-carbs)",    decimals: 1 },
  fat:           { label: "Fat",           unit: "g",    color: "var(--color-fat)",      decimals: 1 },
  water:         { label: "Water",         unit: "mL",   color: "var(--color-water)",    decimals: 0 },
  weight:        { label: "Weight",        unit: "kg",   color: "var(--color-weight)",   decimals: 1 },
  steps:         { label: "Steps",         unit: "",     color: "var(--color-steps)",    decimals: 0 },
  active_energy: { label: "Active Energy", unit: "kcal", color: "var(--color-active)",   decimals: 0 },
};

export const ALL_FIELDS: SummaryField[] = ["calories", "protein", "carbohydrates", "fat", "water", "weight", "steps", "active_energy"];
