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
