"""Private normalization helpers and payload dataclasses — import via HealthAutoExportService."""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from macrofactor_scraper._utils import (
    _first_value,
    _float_or_none,
    _parse_date,
    _parse_datetime,
    _str_or_none,
)


@dataclass(frozen=True)
class NormalizedMetric:
    name: str
    units: str | None
    record_date: date | None
    timestamp: datetime | None
    quantity: float | None
    source: str | None
    raw: dict[str, Any]


@dataclass(frozen=True)
class NormalizedWorkout:
    workout_id: str | None
    name: str | None
    start_date: datetime | None
    end_date: datetime | None
    duration_seconds: float | None
    energy: float | None
    raw: dict[str, Any]


def normalize_metrics(payload: Any) -> list[NormalizedMetric]:
    metrics: list[NormalizedMetric] = []
    for metric in _find_metric_objects(payload):
        name = str(metric["name"])
        units = _str_or_none(metric.get("units") or metric.get("unit"))
        data = metric.get("data")
        if not isinstance(data, list):
            continue
        for item in data:
            if not isinstance(item, dict):
                continue
            timestamp = _parse_datetime(_first_value(item, "date", "timestamp", "startDate", "start_date", "day"))
            metrics.append(
                NormalizedMetric(
                    name=name,
                    units=units,
                    record_date=timestamp.date() if timestamp else _parse_date(_first_value(item, "date", "day")),
                    timestamp=timestamp,
                    quantity=_float_or_none(_first_value(item, "qty", "value", "quantity")),
                    source=_str_or_none(_first_value(item, "source", "sourceName")),
                    raw=item,
                )
            )
    return metrics


def normalize_workouts(payload: Any) -> list[NormalizedWorkout]:
    workouts: list[NormalizedWorkout] = []
    for item in _find_workout_objects(payload):
        start = _parse_datetime(_first_value(item, "start", "startDate", "start_date", "date"))
        end = _parse_datetime(_first_value(item, "end", "endDate", "end_date"))
        workouts.append(
            NormalizedWorkout(
                workout_id=_str_or_none(_first_value(item, "id", "uuid", "workout_id")),
                name=_str_or_none(_first_value(item, "name", "activityName", "workoutActivityType")),
                start_date=start,
                end_date=end,
                duration_seconds=_float_or_none(_first_value(item, "duration", "duration_seconds", "durationSeconds")),
                energy=_float_or_none(_first_value(item, "activeEnergy", "active_energy", "energy")),
                raw=item,
            )
        )
    return workouts


def _find_metric_objects(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        if isinstance(value.get("name"), str) and isinstance(value.get("data"), list):
            yield value
        for child in value.values():
            yield from _find_metric_objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from _find_metric_objects(child)


def _find_workout_objects(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        for key in ("workouts", "workoutData", "workout_data"):
            children = value.get(key)
            if isinstance(children, list):
                for child in children:
                    if isinstance(child, dict):
                        yield child
        for child in value.values():
            if isinstance(child, (dict, list)):
                yield from _find_workout_objects(child)
    elif isinstance(value, list):
        for child in value:
            if isinstance(child, dict) and any(k in child for k in ("workoutActivityType", "activityName", "duration")):
                yield child
            yield from _find_workout_objects(child)
