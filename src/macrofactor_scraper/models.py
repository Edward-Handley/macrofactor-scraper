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


class DashboardSummaryResponse(BaseModel):
    count: int
    first_date: dt.date | None = None
    last_date: dt.date | None = None
    latest_date: dt.date | None = None
    summaries: list[DailySummary]


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
