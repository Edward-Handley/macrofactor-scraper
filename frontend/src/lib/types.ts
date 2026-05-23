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
  workout_preferences: WorkoutPreferences;
  protein_goal_g?: number | null;
}

export interface WorkoutPreferences {
  default_range_days: number;
  landing_tab: WorkoutTab;
  visible_workout_cards: string[];
  default_charts: string[];
  pinned_exercises: string[];
  default_group_filter: string;
  default_exercise_sort: string;
  show_import_panel: boolean;
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

export interface WorkoutRecord {
  id: number;
  workout_id: string | null;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_seconds: number | null;
  energy: number | null;
  raw: Record<string, unknown>;
}

export interface WorkoutListResponse {
  count: number;
  workouts: WorkoutRecord[];
}

export interface StrongImportResponse {
  import_id: number;
  filename: string;
  uploaded_at: string | null;
  nutrition_start_date: string;
  rows_seen: number;
  rows_imported: number;
  rows_ignored_before_nutrition: number;
  sessions_inserted: number;
  sets_inserted: number;
  duplicate_sets: number;
  errors: string[];
}

export interface StrongImportRecord {
  id: number;
  filename: string;
  uploaded_at: string | null;
  nutrition_start_date: string | null;
  rows_seen: number;
  rows_imported: number;
  rows_ignored_before_nutrition: number;
  sessions_inserted: number;
  sets_inserted: number;
  duplicate_sets: number;
}

export interface StrongImportListResponse {
  count: number;
  imports: StrongImportRecord[];
}

export interface StrongSetRecord {
  id: number;
  exercise_name: string;
  set_order: string;
  is_warmup: boolean;
  weight: number | null;
  reps: number | null;
  distance: number | null;
  seconds: number | null;
  rpe: number | null;
  volume: number | null;
  estimated_1rm: number | null;
  notes: string | null;
}

export interface StrongSessionRecord {
  id: number;
  workout_date: string;
  started_at: string;
  workout_name: string;
  duration_seconds: number | null;
  workout_notes: string | null;
  exercise_count: number;
  working_set_count: number;
  total_volume: number;
  sets: StrongSetRecord[];
}

export interface StrongSessionListResponse {
  count: number;
  sessions: StrongSessionRecord[];
}

export interface StrongWeeklySummary {
  week_start: string;
  session_count: number;
  working_set_count: number;
  total_volume: number;
  duration_seconds: number;
  exercise_count: number;
  avg_calories: number | null;
  avg_protein: number | null;
}

export interface StrongExerciseSummary {
  exercise_name: string;
  sessions: number;
  working_sets: number;
  total_volume: number;
  best_weight: number | null;
  best_reps: number | null;
  best_estimated_1rm: number | null;
  last_performed: string | null;
  recent_estimated_1rm: number | null;
  estimated_1rm_delta: number | null;
}

export interface StrongNutritionComparison {
  training_day_count: number;
  rest_day_count: number;
  training_avg_calories: number | null;
  rest_avg_calories: number | null;
  training_avg_protein: number | null;
  rest_avg_protein: number | null;
  training_avg_weight: number | null;
  rest_avg_weight: number | null;
  training_avg_active_energy: number | null;
  rest_avg_active_energy: number | null;
}

export interface StrongRecentPr {
  date: string;
  exercise_name: string;
  weight: number | null;
  reps: number | null;
  estimated_1rm: number | null;
}

export interface StrongSummaryResponse {
  start: string | null;
  end: string | null;
  nutrition_start_date: string | null;
  session_count: number;
  working_set_count: number;
  total_volume: number;
  duration_seconds: number;
  exercise_count: number;
  weekly: StrongWeeklySummary[];
  exercises: StrongExerciseSummary[];
  nutrition: StrongNutritionComparison;
  recent_prs: StrongRecentPr[];
}

export interface StrongExerciseProgressPoint {
  date: string;
  best_weight: number | null;
  best_reps: number | null;
  best_estimated_1rm: number | null;
  total_volume: number;
  working_sets: number;
}

export interface StrongExerciseDetailResponse {
  exercise_name: string;
  points: StrongExerciseProgressPoint[];
  sessions: StrongSessionRecord[];
}

export interface StrongExerciseTaxonomy {
  movement_pattern: string;
  primary_group: string;
  secondary_groups: string[];
}

export interface StrongAnalyticsTotals {
  sessions: number;
  working_sets: number;
  total_volume: number;
  duration_seconds: number;
  exercises: number;
  pr_count: number;
}

export interface StrongWeeklyLoad {
  week_start: string;
  session_count: number;
  working_set_count: number;
  total_volume: number;
  duration_seconds: number;
  exercise_count: number;
  pr_count: number;
  avg_calories: number | null;
  avg_protein: number | null;
  avg_carbohydrates: number | null;
  avg_fat: number | null;
}

export interface StrongGroupBalance {
  group: string;
  movement_pattern: string;
  sessions: number;
  working_sets: number;
  total_volume: number;
  estimated_1rm_prs: number;
}

export interface StrongNutritionTrainingDay {
  date: string;
  session_volume: number;
  working_sets: number;
  duration_seconds: number;
  pr_count: number;
  calories: number | null;
  protein: number | null;
  carbohydrates: number | null;
  fat: number | null;
  weight: number | null;
  active_energy: number | null;
  prior_calories: number | null;
  prior_protein: number | null;
  prior_carbohydrates: number | null;
  prior_fat: number | null;
  prior_weight: number | null;
  prior_active_energy: number | null;
}

export interface StrongDailyLoad {
  date: string;
  session_count: number;
  total_volume: number;
  working_sets: number;
  duration_seconds: number;
  pr_count: number;
  groups_trained: string[];
}

export interface StrongWeeklyGroupLoad {
  week_start: string;
  group: string;
  total_volume: number;
  working_sets: number;
  session_count: number;
}

export interface StrongExercisePr {
  exercise_name: string;
  date: string;
  weight: number | null;
  reps: number | null;
  estimated_1rm: number | null;
  session_id: number;
}

export interface StrongFilterOptions {
  groups: string[];
  movement_patterns: string[];
  exercises: string[];
  start_date: string | null;
  end_date: string | null;
}

export interface StrongNutritionCorrelation {
  nutrient: string;
  driver: string;
  timing: string;
  sample_count: number;
  correlation: number | null;
  average_on_pr_days: number | null;
  average_on_non_pr_training_days: number | null;
}

export interface StrongTrainingRestDelta {
  metric: string;
  training_average: number | null;
  rest_average: number | null;
  delta: number | null;
}

export interface StrongRecoveryLoadMarkers {
  high_volume_weeks: Array<{
    week_start: string;
    total_volume: number;
    session_count: number;
    working_set_count: number;
  }>;
  low_protein_training_days: Array<{
    date: string;
    protein: number | null;
    session_volume: number;
    working_sets: number;
  }>;
  training_rest_deltas: StrongTrainingRestDelta[];
}

export interface StrongAnalyticsResponse {
  start: string | null;
  end: string | null;
  nutrition_start_date: string | null;
  totals: StrongAnalyticsTotals;
  weekly_load: StrongWeeklyLoad[];
  group_balance: StrongGroupBalance[];
  exercise_taxonomy: Record<string, StrongExerciseTaxonomy>;
  daily_load: StrongDailyLoad[];
  weekly_group_load: StrongWeeklyGroupLoad[];
  exercise_prs: StrongExercisePr[];
  filter_options: StrongFilterOptions;
  nutrition_training_days: StrongNutritionTrainingDay[];
  nutrition_correlations: StrongNutritionCorrelation[];
  recovery_load_markers: StrongRecoveryLoadMarkers;
}

export type WorkoutTab = "Overview" | "Sessions" | "Exercises" | "Nutrition" | "Customize";

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

// - Daily log -

export interface DailyLog {
  log_date: string;
  cut_phase: string | null;
  week_number: number | null;
  training_type: string | null;
  gym_done: boolean | null;
  gym_minutes: number | null;
  gym_rpe: number | null;
  gym_notes: string | null;
  cardio_type: string | null;
  cardio_minutes: number | null;
  cardio_avg_hr: number | null;
  vyvanse_taken: boolean | null;
  vyvanse_time: string | null;
  dex_booster_taken: boolean | null;
  dex_time: string | null;
  sleep_hours: number | null;
  sleep_quality: number | null;
  sleep_score: number | null;
  am_energy: number | null;
  pm_energy: number | null;
  motivation: number | null;
  hunger: number | null;
  mood: number | null;
  stress: number | null;
  soreness: number | null;
  digestion: number | null;
  rhr: number | null;
  hrv_overnight: number | null;
  water_litres: number | null;
  notes: string | null;
  weight_kg: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export type DailyLogUpsert = Partial<Omit<DailyLog, "log_date" | "created_at" | "updated_at">>;

export interface DailyLogListResponse {
  count: number;
  logs: DailyLog[];
}

// - Body measurements -

export interface BodyMeasurement {
  measure_date: string;
  waist_cm: number | null;
  chest_cm: number | null;
  l_arm_cm: number | null;
  r_arm_cm: number | null;
  l_thigh_cm: number | null;
  r_thigh_cm: number | null;
  hip_cm: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export type BodyMeasurementUpsert = Partial<Omit<BodyMeasurement, "measure_date" | "created_at" | "updated_at">>;

export interface BodyMeasurementListResponse {
  count: number;
  measurements: BodyMeasurement[];
}

// - Cut phases -

export interface CutPhase {
  id: number;
  name: string;
  start_date: string;
  end_date: string | null;
  target_weight_kg: number | null;
  target_calories: number | null;
  notes: string | null;
  created_at: string | null;
}

export interface CutPhaseCreate {
  name: string;
  start_date: string;
  end_date?: string | null;
  target_weight_kg?: number | null;
  target_calories?: number | null;
  notes?: string | null;
}

export interface CutPhaseListResponse {
  count: number;
  phases: CutPhase[];
}

// - Coach draft -

export interface CoachDraftResponse {
  date: string;
  prompt_text: string;
}

// - Garmin Health tab -

export interface GarminSeriesPoint {
  date: string;
  value: number;
}

export interface GarminSeriesResponse {
  metric: string;
  units: string;
  points: GarminSeriesPoint[];
}

export interface GarminCategoriesResponse {
  categories: Record<string, string[]>;
  units: Record<string, string>;
}

// - Readiness (HRV + RHR baseline) -

export interface ReadinessReport {
  date: string;
  hrv_today: number | null;
  hrv_baseline_mean: number | null;
  hrv_baseline_sd: number | null;
  hrv_z: number | null;
  rhr_today: number | null;
  rhr_baseline_mean: number | null;
  rhr_baseline_sd: number | null;
  rhr_z: number | null;
  score: number | null;
  band: "green" | "amber" | "red" | null;
  summary: string;
}

// - Progress photos -

export interface PhotoDateEntry {
  date: string;
  poses: string[];
  weight_kg: number | null;
}

export interface PhotoListResponse {
  count: number;
  dates: PhotoDateEntry[];
}

// - AI analysis -

export interface AiAnalyseResponse {
  analysis: string;
  model: string;
  tokens_used: number;
}
