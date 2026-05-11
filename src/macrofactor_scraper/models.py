from __future__ import annotations

import datetime as dt
from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"


class DatasetRecord(BaseModel):
    id: str | None = None
    path: str | None = None
    date: dt.date | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class DatasetCollection(BaseModel):
    dataset: str
    count: int
    records: list[DatasetRecord]


class ProfileResponse(BaseModel):
    id: str | None = None
    path: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class RawDatasetResponse(BaseModel):
    dataset: str
    source_path: str
    kind: str
    data: dict[str, Any] | list[dict[str, Any]] | None


class CollectionIdsResponse(BaseModel):
    parent_path: str | None = None
    collection_ids: list[str]


class IngestResponse(BaseModel):
    batch_id: int
    payload_hash: str
    metrics_inserted: int
    workouts_inserted: int


class MetricSummary(BaseModel):
    name: str
    units: str | None = None
    count: int
    first_date: dt.date | None = None
    last_date: dt.date | None = None


class MetricRecord(BaseModel):
    id: int
    metric_name: str
    units: str | None = None
    date: dt.date | None = None
    timestamp: dt.datetime | None = None
    quantity: float | None = None
    source: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class MetricListResponse(BaseModel):
    count: int
    metrics: list[MetricSummary]


class MetricRecordsResponse(BaseModel):
    metric_name: str
    count: int
    records: list[MetricRecord]


class DailySummary(BaseModel):
    date: dt.date
    calories: float | None = None
    protein: float | None = None
    carbohydrates: float | None = None
    fat: float | None = None
    water: float | None = None
    weight: float | None = None
    steps: float | None = None
    active_energy: float | None = None


class DailySummaryResponse(BaseModel):
    count: int
    summaries: list[DailySummary]


SUMMARY_FIELDS = ("calories", "protein", "carbohydrates", "fat", "water", "weight", "steps", "active_energy")


class DashboardPreferences(BaseModel):
    visible_summary_cards: list[str] = Field(default_factory=lambda: list(SUMMARY_FIELDS))
    hidden_summary_fields: list[str] = Field(default_factory=list)
    preferred_range_days: int = 30
    trusted_metric_names: list[str] = Field(default_factory=list)
    untrusted_metric_names: list[str] = Field(default_factory=list)
    default_chart_set: list[str] = Field(default_factory=lambda: ["calories", "protein", "carbohydrates", "fat", "active_energy"])
    source_filters: dict[str, list[str]] = Field(default_factory=dict)


class DashboardSummaryResponse(BaseModel):
    count: int
    first_date: dt.date | None = None
    last_date: dt.date | None = None
    latest_date: dt.date | None = None
    summaries: list[DailySummary]
    hidden_fields: list[str] = Field(default_factory=list)


class DashboardMetricCatalogItem(BaseModel):
    name: str
    units: str | None = None
    count: int
    first_date: dt.date | None = None
    last_date: dt.date | None = None
    sources: list[str] = Field(default_factory=list)
    dashboard_field: str | None = None
    is_trusted: bool = True


class DashboardMetricCatalogResponse(BaseModel):
    count: int
    metrics: list[DashboardMetricCatalogItem]


class MetricDateDiagnosticItem(BaseModel):
    metric_name: str
    units: str | None = None
    source: str | None = None
    dashboard_field: str | None = None
    aggregation: str
    row_count: int
    summed_value: float | None = None
    replacement_value: float | None = None
    collapsed_value: float | None = None
    first_record_id: int
    latest_record_id: int
    first_timestamp: dt.datetime | None = None
    latest_timestamp: dt.datetime | None = None
    suspicious: bool = False


class MetricDateDiagnosticResponse(BaseModel):
    date: dt.date
    count: int
    diagnostics: list[MetricDateDiagnosticItem]


class IngestStatusResponse(BaseModel):
    latest_batch_at: dt.datetime | None = None
    batch_count: int
    metric_record_count: int
    workout_record_count: int
    first_date: dt.date | None = None
    last_date: dt.date | None = None


class WorkoutRecord(BaseModel):
    id: int
    workout_id: str | None = None
    name: str | None = None
    start_date: dt.datetime | None = None
    end_date: dt.datetime | None = None
    duration_seconds: float | None = None
    energy: float | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class WorkoutListResponse(BaseModel):
    count: int
    workouts: list[WorkoutRecord]


class StrongImportResponse(BaseModel):
    import_id: int
    filename: str
    uploaded_at: dt.datetime | None = None
    nutrition_start_date: dt.date
    rows_seen: int
    rows_imported: int
    rows_ignored_before_nutrition: int
    sessions_inserted: int
    sets_inserted: int
    duplicate_sets: int
    errors: list[str] = Field(default_factory=list)


class StrongImportRecord(BaseModel):
    id: int
    filename: str
    uploaded_at: dt.datetime | None = None
    nutrition_start_date: dt.date | None = None
    rows_seen: int
    rows_imported: int
    rows_ignored_before_nutrition: int
    sessions_inserted: int
    sets_inserted: int
    duplicate_sets: int


class StrongImportListResponse(BaseModel):
    count: int
    imports: list[StrongImportRecord]


class StrongSetRecord(BaseModel):
    id: int
    exercise_name: str
    set_order: str
    is_warmup: bool
    weight: float | None = None
    reps: float | None = None
    distance: float | None = None
    seconds: float | None = None
    rpe: float | None = None
    volume: float | None = None
    estimated_1rm: float | None = None
    notes: str | None = None


class StrongSessionRecord(BaseModel):
    id: int
    workout_date: dt.date
    started_at: dt.datetime
    workout_name: str
    duration_seconds: int | None = None
    workout_notes: str | None = None
    exercise_count: int
    working_set_count: int
    total_volume: float
    sets: list[StrongSetRecord] = Field(default_factory=list)


class StrongSessionListResponse(BaseModel):
    count: int
    sessions: list[StrongSessionRecord]


class StrongWeeklySummary(BaseModel):
    week_start: dt.date
    session_count: int
    working_set_count: int
    total_volume: float
    duration_seconds: int
    exercise_count: int
    avg_calories: float | None = None
    avg_protein: float | None = None


class StrongExerciseSummary(BaseModel):
    exercise_name: str
    sessions: int
    working_sets: int
    total_volume: float
    best_weight: float | None = None
    best_reps: float | None = None
    best_estimated_1rm: float | None = None
    last_performed: dt.date | None = None
    recent_estimated_1rm: float | None = None
    estimated_1rm_delta: float | None = None


class StrongNutritionComparison(BaseModel):
    training_day_count: int
    rest_day_count: int
    training_avg_calories: float | None = None
    rest_avg_calories: float | None = None
    training_avg_protein: float | None = None
    rest_avg_protein: float | None = None
    training_avg_weight: float | None = None
    rest_avg_weight: float | None = None
    training_avg_active_energy: float | None = None
    rest_avg_active_energy: float | None = None


class StrongRecentPr(BaseModel):
    date: dt.date
    exercise_name: str
    weight: float | None = None
    reps: float | None = None
    estimated_1rm: float | None = None


class StrongSummaryResponse(BaseModel):
    start: dt.date | None = None
    end: dt.date | None = None
    nutrition_start_date: dt.date | None = None
    session_count: int
    working_set_count: int
    total_volume: float
    duration_seconds: int
    exercise_count: int
    weekly: list[StrongWeeklySummary]
    exercises: list[StrongExerciseSummary]
    nutrition: StrongNutritionComparison
    recent_prs: list[StrongRecentPr]


class StrongExerciseProgressPoint(BaseModel):
    date: dt.date
    best_weight: float | None = None
    best_reps: float | None = None
    best_estimated_1rm: float | None = None
    total_volume: float
    working_sets: int


class StrongExerciseDetailResponse(BaseModel):
    exercise_name: str
    points: list[StrongExerciseProgressPoint]
    sessions: list[StrongSessionRecord]


class RepairDayDelta(BaseModel):
    date: dt.date
    metric_name: str
    source: str | None = None
    before_total: float
    after_total: float
    removed_row_ids: list[int]


class RepairReport(BaseModel):
    dry_run: bool
    groups_inspected: int
    rows_removed: int
    backup_path: str | None = None
    deltas: list[RepairDayDelta]
