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


class WorkoutPreferences(BaseModel):
    default_range_days: int = 90
    landing_tab: str = "Overview"
    visible_workout_cards: list[str] = Field(default_factory=lambda: ["sessions", "volume", "prs", "protein", "calorie_delta", "load_trend"])
    default_charts: list[str] = Field(default_factory=lambda: ["training_heatmap", "weekly_group_load", "nutrition_scatter", "group_balance"])
    pinned_exercises: list[str] = Field(default_factory=list)
    default_group_filter: str = "All"
    default_exercise_sort: str = "recent_pr"
    show_import_panel: bool = True


SUMMARY_FIELDS = ("calories", "protein", "carbohydrates", "fat", "water", "weight", "steps", "active_energy")


class DashboardPreferences(BaseModel):
    visible_summary_cards: list[str] = Field(default_factory=lambda: list(SUMMARY_FIELDS))
    hidden_summary_fields: list[str] = Field(default_factory=list)
    preferred_range_days: int = 30
    trusted_metric_names: list[str] = Field(default_factory=list)
    untrusted_metric_names: list[str] = Field(default_factory=list)
    default_chart_set: list[str] = Field(default_factory=lambda: ["calories", "protein", "carbohydrates", "fat", "active_energy"])
    source_filters: dict[str, list[str]] = Field(default_factory=dict)
    workout_preferences: WorkoutPreferences = Field(default_factory=WorkoutPreferences)
    protein_goal_g: int | None = None


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


class StrongExerciseTaxonomy(BaseModel):
    movement_pattern: str
    primary_group: str
    secondary_groups: list[str] = Field(default_factory=list)


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


class StrongAnalyticsTotals(BaseModel):
    sessions: int
    working_sets: int
    total_volume: float
    duration_seconds: int
    exercises: int
    pr_count: int


class StrongWeeklyLoad(BaseModel):
    week_start: dt.date
    session_count: int
    working_set_count: int
    total_volume: float
    duration_seconds: int
    exercise_count: int
    pr_count: int
    avg_calories: float | None = None
    avg_protein: float | None = None
    avg_carbohydrates: float | None = None
    avg_fat: float | None = None


class StrongGroupBalance(BaseModel):
    group: str
    movement_pattern: str
    sessions: int
    working_sets: int
    total_volume: float
    estimated_1rm_prs: int


class StrongNutritionTrainingDay(BaseModel):
    date: dt.date
    session_volume: float
    working_sets: int
    duration_seconds: int
    pr_count: int
    calories: float | None = None
    protein: float | None = None
    carbohydrates: float | None = None
    fat: float | None = None
    weight: float | None = None
    active_energy: float | None = None
    prior_calories: float | None = None
    prior_protein: float | None = None
    prior_carbohydrates: float | None = None
    prior_fat: float | None = None
    prior_weight: float | None = None
    prior_active_energy: float | None = None


class StrongDailyLoad(BaseModel):
    date: dt.date
    session_count: int
    total_volume: float
    working_sets: int
    duration_seconds: int
    pr_count: int
    groups_trained: list[str] = Field(default_factory=list)


class StrongWeeklyGroupLoad(BaseModel):
    week_start: dt.date
    group: str
    total_volume: float
    working_sets: int
    session_count: int


class StrongExercisePr(BaseModel):
    exercise_name: str
    date: dt.date
    weight: float | None = None
    reps: float | None = None
    estimated_1rm: float | None = None
    session_id: int


class StrongFilterOptions(BaseModel):
    groups: list[str] = Field(default_factory=list)
    movement_patterns: list[str] = Field(default_factory=list)
    exercises: list[str] = Field(default_factory=list)
    start_date: dt.date | None = None
    end_date: dt.date | None = None


class StrongNutritionCorrelation(BaseModel):
    nutrient: str
    driver: str
    timing: str
    sample_count: int
    correlation: float | None = None
    average_on_pr_days: float | None = None
    average_on_non_pr_training_days: float | None = None


class StrongTrainingRestDelta(BaseModel):
    metric: str
    training_average: float | None = None
    rest_average: float | None = None
    delta: float | None = None


class StrongHighVolumeWeek(BaseModel):
    week_start: dt.date
    total_volume: float
    session_count: int
    working_set_count: int


class StrongLowProteinTrainingDay(BaseModel):
    date: dt.date
    protein: float | None = None
    session_volume: float
    working_sets: int


class StrongRecoveryLoadMarkers(BaseModel):
    high_volume_weeks: list[StrongHighVolumeWeek]
    low_protein_training_days: list[StrongLowProteinTrainingDay]
    training_rest_deltas: list[StrongTrainingRestDelta]


class StrongAnalyticsResponse(BaseModel):
    start: dt.date | None = None
    end: dt.date | None = None
    nutrition_start_date: dt.date | None = None
    totals: StrongAnalyticsTotals
    weekly_load: list[StrongWeeklyLoad]
    group_balance: list[StrongGroupBalance]
    exercise_taxonomy: dict[str, StrongExerciseTaxonomy]
    daily_load: list[StrongDailyLoad] = Field(default_factory=list)
    weekly_group_load: list[StrongWeeklyGroupLoad] = Field(default_factory=list)
    exercise_prs: list[StrongExercisePr] = Field(default_factory=list)
    filter_options: StrongFilterOptions = Field(default_factory=StrongFilterOptions)
    nutrition_training_days: list[StrongNutritionTrainingDay]
    nutrition_correlations: list[StrongNutritionCorrelation]
    recovery_load_markers: StrongRecoveryLoadMarkers


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


# ─── Cut phases ───────────────────────────────────────────────────────────────

class CutPhase(BaseModel):
    id: int
    name: str
    start_date: dt.date
    end_date: dt.date | None = None
    target_weight_kg: float | None = None
    target_calories: int | None = None
    notes: str | None = None
    created_at: dt.datetime | None = None


class CutPhaseCreate(BaseModel):
    name: str
    start_date: dt.date
    end_date: dt.date | None = None
    target_weight_kg: float | None = None
    target_calories: int | None = None
    notes: str | None = None


class CutPhaseUpdate(BaseModel):
    name: str | None = None
    start_date: dt.date | None = None
    end_date: dt.date | None = None
    target_weight_kg: float | None = None
    target_calories: int | None = None
    notes: str | None = None


class CutPhaseListResponse(BaseModel):
    count: int
    phases: list[CutPhase]


# ─── Daily log ────────────────────────────────────────────────────────────────

class DailyLog(BaseModel):
    log_date: dt.date
    cut_phase: str | None = None
    week_number: int | None = None
    training_type: str | None = None
    gym_done: bool | None = None
    gym_minutes: int | None = None
    gym_rpe: float | None = None
    gym_notes: str | None = None
    cardio_type: str | None = None
    cardio_minutes: int | None = None
    cardio_avg_hr: int | None = None
    vyvanse_taken: bool | None = None
    vyvanse_time: str | None = None
    dex_booster_taken: bool | None = None
    dex_time: str | None = None
    sleep_hours: float | None = None
    sleep_quality: int | None = None
    sleep_score: int | None = None
    am_energy: int | None = None
    pm_energy: int | None = None
    motivation: int | None = None
    hunger: int | None = None
    mood: int | None = None
    stress: int | None = None
    soreness: int | None = None
    digestion: int | None = None
    rhr: int | None = None
    hrv_overnight: int | None = None
    water_litres: float | None = None
    notes: str | None = None
    weight_kg: float | None = None
    created_at: dt.datetime | None = None
    updated_at: dt.datetime | None = None


class DailyLogUpsert(BaseModel):
    cut_phase: str | None = None
    week_number: int | None = None
    training_type: str | None = None
    gym_done: bool | None = None
    gym_minutes: int | None = None
    gym_rpe: float | None = None
    gym_notes: str | None = None
    cardio_type: str | None = None
    cardio_minutes: int | None = None
    cardio_avg_hr: int | None = None
    vyvanse_taken: bool | None = None
    vyvanse_time: str | None = None
    dex_booster_taken: bool | None = None
    dex_time: str | None = None
    sleep_hours: float | None = None
    sleep_quality: int | None = None
    sleep_score: int | None = None
    am_energy: int | None = None
    pm_energy: int | None = None
    motivation: int | None = None
    hunger: int | None = None
    mood: int | None = None
    stress: int | None = None
    soreness: int | None = None
    digestion: int | None = None
    rhr: int | None = None
    hrv_overnight: int | None = None
    water_litres: float | None = None
    notes: str | None = None
    weight_kg: float | None = None


class DailyLogListResponse(BaseModel):
    count: int
    logs: list[DailyLog]


# ─── Body measurements ────────────────────────────────────────────────────────

class BodyMeasurement(BaseModel):
    measure_date: dt.date
    waist_cm: float | None = None
    chest_cm: float | None = None
    l_arm_cm: float | None = None
    r_arm_cm: float | None = None
    l_thigh_cm: float | None = None
    r_thigh_cm: float | None = None
    hip_cm: float | None = None
    body_fat_percent: float | None = None
    created_at: dt.datetime | None = None
    updated_at: dt.datetime | None = None


class BodyMeasurementUpsert(BaseModel):
    waist_cm: float | None = None
    chest_cm: float | None = None
    l_arm_cm: float | None = None
    r_arm_cm: float | None = None
    l_thigh_cm: float | None = None
    r_thigh_cm: float | None = None
    hip_cm: float | None = None
    body_fat_percent: float | None = None


class BodyMeasurementListResponse(BaseModel):
    count: int
    measurements: list[BodyMeasurement]


def _row_to_daily_log(row: dict) -> DailyLog:
    return DailyLog(
        log_date=row["log_date"],
        cut_phase=row.get("cut_phase"),
        week_number=row.get("week_number"),
        training_type=row.get("training_type"),
        gym_done=bool(row["gym_done"]) if row.get("gym_done") is not None else None,
        gym_minutes=row.get("gym_minutes"),
        gym_rpe=row.get("gym_rpe"),
        gym_notes=row.get("gym_notes"),
        cardio_type=row.get("cardio_type"),
        cardio_minutes=row.get("cardio_minutes"),
        cardio_avg_hr=row.get("cardio_avg_hr"),
        vyvanse_taken=bool(row["vyvanse_taken"]) if row.get("vyvanse_taken") is not None else None,
        vyvanse_time=row.get("vyvanse_time"),
        dex_booster_taken=bool(row["dex_booster_taken"]) if row.get("dex_booster_taken") is not None else None,
        dex_time=row.get("dex_time"),
        sleep_hours=row.get("sleep_hours"),
        sleep_quality=row.get("sleep_quality"),
        sleep_score=row.get("sleep_score"),
        am_energy=row.get("am_energy"),
        pm_energy=row.get("pm_energy"),
        motivation=row.get("motivation"),
        hunger=row.get("hunger"),
        mood=row.get("mood"),
        stress=row.get("stress"),
        soreness=row.get("soreness"),
        digestion=row.get("digestion"),
        rhr=row.get("rhr"),
        hrv_overnight=row.get("hrv_overnight"),
        water_litres=row.get("water_litres"),
        notes=row.get("notes"),
        weight_kg=row.get("weight_kg"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _row_to_measurement(row: dict) -> BodyMeasurement:
    return BodyMeasurement(
        measure_date=row["measure_date"],
        waist_cm=row.get("waist_cm"),
        chest_cm=row.get("chest_cm"),
        l_arm_cm=row.get("l_arm_cm"),
        r_arm_cm=row.get("r_arm_cm"),
        l_thigh_cm=row.get("l_thigh_cm"),
        r_thigh_cm=row.get("r_thigh_cm"),
        hip_cm=row.get("hip_cm"),
        body_fat_percent=row.get("body_fat_percent"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _row_to_cut_phase(row: dict) -> CutPhase:
    return CutPhase(
        id=row["id"],
        name=row["name"],
        start_date=row["start_date"],
        end_date=row.get("end_date"),
        target_weight_kg=row.get("target_weight_kg"),
        target_calories=row.get("target_calories"),
        notes=row.get("notes"),
        created_at=row.get("created_at"),
    )


# ─── Coach draft ──────────────────────────────────────────────────────────────

class CoachDraftResponse(BaseModel):
    date: str
    prompt_text: str


# ─── Readiness (HRV + RHR baseline) ──────────────────────────────────────────

class ReadinessReport(BaseModel):
    date: str
    hrv_today: float | None = None
    hrv_baseline_mean: float | None = None
    hrv_baseline_sd: float | None = None
    hrv_z: float | None = None
    rhr_today: float | None = None
    rhr_baseline_mean: float | None = None
    rhr_baseline_sd: float | None = None
    rhr_z: float | None = None
    score: float | None = None
    band: str | None = None
    summary: str


# ─── Progress photos ──────────────────────────────────────────────────────────

class PhotoDateEntry(BaseModel):
    date: str
    poses: list[str]
    weight_kg: float | None = None


class PhotoListResponse(BaseModel):
    count: int
    dates: list[PhotoDateEntry]


# ─── Training readiness call ──────────────────────────────────────────────────

class TrainingCall(BaseModel):
    date: str
    call: str  # "push" | "maintain" | "deload" | "rest"
    reasons: list[str]
    confidence: float


# ─── AI analysis ─────────────────────────────────────────────────────────────

class AiAnalyseRequest(BaseModel):
    type: str = "quick_summary"
    date: str | None = None


class AiAnalyseResponse(BaseModel):
    analysis: str
    model: str
    tokens_used: int


# ─── Coach chat ───────────────────────────────────────────────────────────────

class CoachMessage(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    tokens_used: int | None = None
    model: str | None = None
    created_at: str


class CoachConversation(BaseModel):
    id: int
    created_at: str
    updated_at: str
    title: str
    framing: str | None = None
    for_date: str | None = None
    archived: int = 0


class CoachConversationWithMessages(CoachConversation):
    messages: list[CoachMessage] = Field(default_factory=list)


class CoachConversationCreate(BaseModel):
    title: str | None = None
    framing: str | None = None
    for_date: str | None = None


class CoachChatRequest(BaseModel):
    message: str


# ─── Smart insights ───────────────────────────────────────────────────────────

class SmartInsight(BaseModel):
    id: str
    category: str
    severity: str
    title: str
    detail: str
    metric_primary: str | None = None
    metric_secondary: str | None = None
    supporting: dict[str, Any] = Field(default_factory=dict)
    action: str | None = None


class SmartInsightsResponse(BaseModel):
    date: str
    insights: list[SmartInsight]


# ─── Body composition ─────────────────────────────────────────────────────────

class BodyCompositionPoint(BaseModel):
    date: str
    weight_kg: float | None = None
    body_fat_percent: float | None = None
    lean_kg: float | None = None
    fat_kg: float | None = None
    source: str = "none"


class BodyCompositionResponse(BaseModel):
    count: int
    points: list[BodyCompositionPoint]


# ─── Activities ───────────────────────────────────────────────────────────────

class Activity(BaseModel):
    id: int
    source: str
    garmin_activity_id: int | None = None
    sport: str
    activity_date: dt.date
    start_time: str | None = None
    duration_seconds: float | None = None
    distance_m: float | None = None
    calories: float | None = None
    avg_hr: float | None = None
    max_hr: float | None = None
    aerobic_te: float | None = None
    anaerobic_te: float | None = None
    training_load: float | None = None
    load_source: str | None = None
    rpe: float | None = None
    perceived_intensity: str | None = None
    pool_length_m: float | None = None
    laps: int | None = None
    total_strokes: int | None = None
    avg_swolf: float | None = None
    avg_pace_s_per_100m: float | None = None
    stroke_type: str | None = None
    hr_zones: list[dict] | None = None
    laps_data: list[dict] | None = None
    notes: str | None = None
    created_at: dt.datetime | None = None
    updated_at: dt.datetime | None = None


class ActivityCreate(BaseModel):
    sport: str
    activity_date: dt.date
    start_time: str | None = None
    duration_minutes: float
    distance_m: float | None = None
    calories: float | None = None
    rpe: float | None = None
    perceived_intensity: str | None = None
    notes: str | None = None


class ActivityUpdate(BaseModel):
    sport: str | None = None
    activity_date: dt.date | None = None
    start_time: str | None = None
    duration_minutes: float | None = None
    distance_m: float | None = None
    calories: float | None = None
    rpe: float | None = None
    perceived_intensity: str | None = None
    notes: str | None = None


class ActivityListResponse(BaseModel):
    count: int
    activities: list[Activity]


# ─── Training load / ACWR ─────────────────────────────────────────────────────

class TrainingLoadPoint(BaseModel):
    date: str
    load: float
    atl: float
    ctl: float
    acwr: float | None = None
    sources: list[str] = Field(default_factory=list)


class TrainingLoadResponse(BaseModel):
    series: list[TrainingLoadPoint]
    current_acwr: float | None = None
    status: str = "unknown"


# ─── Swim analytics ───────────────────────────────────────────────────────────

class SwimWeeklyVolume(BaseModel):
    week: str
    volume_m: float
    sessions: int


class SwimPacePoint(BaseModel):
    date: str
    pace_s_per_100m: float


class SwimSwolfPoint(BaseModel):
    date: str
    swolf: float


class SwimStrokeMix(BaseModel):
    stroke: str
    count: int


class SwimAnalyticsResponse(BaseModel):
    weekly_volume: list[SwimWeeklyVolume]
    pace_series: list[SwimPacePoint]
    swolf_series: list[SwimSwolfPoint]
    stroke_mix: list[SwimStrokeMix]
    best_pace_s_per_100m: float | None = None
    total_sessions: int
    total_volume_m: float


# ─── Performance goals ────────────────────────────────────────────────────────

class PerformanceGoal(BaseModel):
    id: int
    name: str
    goal_type: str
    sport: str | None = None
    target_value: float | None = None
    unit: str | None = None
    target_date: dt.date | None = None
    active: bool = True
    notes: str | None = None
    created_at: dt.datetime | None = None


class PerformanceGoalCreate(BaseModel):
    name: str
    goal_type: str
    sport: str | None = None
    target_value: float | None = None
    unit: str | None = None
    target_date: dt.date | None = None
    notes: str | None = None


class PerformanceGoalUpdate(BaseModel):
    name: str | None = None
    goal_type: str | None = None
    sport: str | None = None
    target_value: float | None = None
    unit: str | None = None
    target_date: dt.date | None = None
    active: bool | None = None
    notes: str | None = None


class PerformanceGoalListResponse(BaseModel):
    count: int
    goals: list[PerformanceGoal]


# ─── Daily training recommendation ───────────────────────────────────────────

class DailyRecommendationResponse(BaseModel):
    date: str
    recommendation: str
    model: str
    tokens_used: int
    created_at: str | None = None


# ─── Performance weekly review ────────────────────────────────────────────────

class PerformanceReviewResponse(BaseModel):
    week_start_date: str
    narrative: str
    highlights: list[str]
    model: str
    tokens_used: int
    created_at: str | None = None


class PerformanceReviewListResponse(BaseModel):
    count: int
    reviews: list[PerformanceReviewResponse]


# ─── Fueling summary ─────────────────────────────────────────────────────────

class FuelingSummaryResponse(BaseModel):
    date: str
    calories: float | None = None
    protein: float | None = None
    training_load: float


# ─── Activity converters ──────────────────────────────────────────────────────

def _row_to_activity(row: dict) -> "Activity":
    return Activity(
        id=row["id"],
        source=row["source"],
        garmin_activity_id=row.get("garmin_activity_id"),
        sport=row["sport"],
        activity_date=row["activity_date"],
        start_time=row.get("start_time"),
        duration_seconds=row.get("duration_seconds"),
        distance_m=row.get("distance_m"),
        calories=row.get("calories"),
        avg_hr=row.get("avg_hr"),
        max_hr=row.get("max_hr"),
        aerobic_te=row.get("aerobic_te"),
        anaerobic_te=row.get("anaerobic_te"),
        training_load=row.get("training_load"),
        load_source=row.get("load_source"),
        rpe=row.get("rpe"),
        perceived_intensity=row.get("perceived_intensity"),
        pool_length_m=row.get("pool_length_m"),
        laps=row.get("laps"),
        total_strokes=row.get("total_strokes"),
        avg_swolf=row.get("avg_swolf"),
        avg_pace_s_per_100m=row.get("avg_pace_s_per_100m"),
        stroke_type=row.get("stroke_type"),
        hr_zones=row.get("hr_zones"),
        laps_data=row.get("laps_data"),
        notes=row.get("notes"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _row_to_goal(row: dict) -> "PerformanceGoal":
    return PerformanceGoal(
        id=row["id"],
        name=row["name"],
        goal_type=row["goal_type"],
        sport=row.get("sport"),
        target_value=row.get("target_value"),
        unit=row.get("unit"),
        target_date=row.get("target_date"),
        active=bool(row.get("active", 1)),
        notes=row.get("notes"),
        created_at=row.get("created_at"),
    )
