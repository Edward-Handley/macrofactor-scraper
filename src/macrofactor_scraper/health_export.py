from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

from macrofactor_scraper.models import (
    DailySummary,
    DailySummaryResponse,
    DashboardMetricCatalogItem,
    DashboardMetricCatalogResponse,
    DashboardPreferences,
    DashboardSummaryResponse,
    IngestStatusResponse,
    IngestResponse,
    MetricListResponse,
    MetricRecord,
    MetricRecordsResponse,
    MetricSummary,
    WorkoutListResponse,
    WorkoutRecord,
)


SUMMARY_FIELDS = ("calories", "protein", "carbohydrates", "fat", "water", "weight", "steps", "active_energy")


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


class HealthAutoExportService:
    def __init__(self, sqlite_path: str) -> None:
        self._path = Path(sqlite_path)
        self._initialized = False

    def ingest(self, payload: Any, headers: dict[str, str]) -> IngestResponse:
        self._ensure_schema()
        payload_json = _canonical_json(payload)
        payload_hash = hashlib.sha256(payload_json.encode("utf-8")).hexdigest()
        with self._connect() as conn:
            batch_id = self._insert_batch(conn, payload_hash, payload_json, headers)
            metrics_inserted = sum(self._insert_metric(conn, batch_id, metric) for metric in normalize_metrics(payload))
            workouts_inserted = sum(self._insert_workout(conn, batch_id, workout) for workout in normalize_workouts(payload))
            return IngestResponse(
                batch_id=batch_id,
                payload_hash=payload_hash,
                metrics_inserted=metrics_inserted,
                workouts_inserted=workouts_inserted,
            )

    def list_metrics(self) -> MetricListResponse:
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT metric_name, units, COUNT(*) AS count, MIN(record_date) AS first_date, MAX(record_date) AS last_date
                FROM health_records
                GROUP BY metric_name, units
                ORDER BY metric_name, units
                """
            ).fetchall()
        metrics = [
            MetricSummary(
                name=row["metric_name"],
                units=row["units"],
                count=row["count"],
                first_date=_parse_date(row["first_date"]),
                last_date=_parse_date(row["last_date"]),
            )
            for row in rows
        ]
        return MetricListResponse(count=len(metrics), metrics=metrics)

    def metric_records(self, metric_name: str, start: date | None = None, end: date | None = None) -> MetricRecordsResponse:
        self._ensure_schema()
        _validate_range(start, end)
        query = "SELECT * FROM health_records WHERE metric_name = ?"
        params: list[Any] = [metric_name]
        if start is not None:
            query += " AND record_date >= ?"
            params.append(start.isoformat())
        if end is not None:
            query += " AND record_date <= ?"
            params.append(end.isoformat())
        query += " ORDER BY record_date, timestamp, id"
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        records = [_metric_from_row(row) for row in rows]
        return MetricRecordsResponse(metric_name=metric_name, count=len(records), records=records)

    def daily_summary(self, start: date | None = None, end: date | None = None) -> DailySummaryResponse:
        self._ensure_schema()
        _validate_range(start, end)
        items = self._daily_summary_items(start, end)
        return DailySummaryResponse(count=len(items), summaries=items)

    def dashboard_summary(
        self,
        start: date | None = None,
        end: date | None = None,
        *,
        include_hidden: bool = False,
    ) -> DashboardSummaryResponse:
        self._ensure_schema()
        _validate_range(start, end)
        preferences = self.dashboard_preferences()
        items = self._daily_summary_items(start, end, preferences=preferences, include_hidden=include_hidden)
        dates = [item.date for item in items]
        hidden_fields = [] if include_hidden else _effective_hidden_fields(preferences)
        return DashboardSummaryResponse(
            count=len(items),
            first_date=min(dates) if dates else None,
            last_date=max(dates) if dates else None,
            latest_date=max(dates) if dates else None,
            summaries=items,
            hidden_fields=hidden_fields,
        )

    def dashboard_preferences(self) -> DashboardPreferences:
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute("SELECT preferences_json FROM dashboard_preferences WHERE id = 1").fetchone()
        if row is None:
            return DashboardPreferences()
        try:
            data = json.loads(row["preferences_json"])
        except json.JSONDecodeError:
            return DashboardPreferences()
        return DashboardPreferences.model_validate(data)

    def update_dashboard_preferences(self, preferences: DashboardPreferences) -> DashboardPreferences:
        self._ensure_schema()
        normalized = _normalize_preferences(preferences)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO dashboard_preferences (id, preferences_json, updated_at)
                VALUES (1, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    preferences_json = excluded.preferences_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (_canonical_json(normalized.model_dump()),),
            )
        return normalized

    def dashboard_metric_catalog(self) -> DashboardMetricCatalogResponse:
        self._ensure_schema()
        preferences = self.dashboard_preferences()
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    metric_name,
                    units,
                    COUNT(*) AS count,
                    MIN(record_date) AS first_date,
                    MAX(record_date) AS last_date,
                    GROUP_CONCAT(DISTINCT source) AS sources
                FROM health_records
                GROUP BY metric_name, units
                ORDER BY metric_name, units
                """
            ).fetchall()
        untrusted = set(preferences.untrusted_metric_names)
        trusted = set(preferences.trusted_metric_names)
        metrics = [
            DashboardMetricCatalogItem(
                name=row["metric_name"],
                units=row["units"],
                count=row["count"],
                first_date=_parse_date(row["first_date"]),
                last_date=_parse_date(row["last_date"]),
                sources=sorted(source for source in (row["sources"] or "").split(",") if source),
                dashboard_field=_summary_key(row["metric_name"]),
                is_trusted=row["metric_name"] not in untrusted if not trusted else row["metric_name"] in trusted,
            )
            for row in rows
        ]
        return DashboardMetricCatalogResponse(count=len(metrics), metrics=metrics)

    def _daily_summary_items(
        self,
        start: date | None = None,
        end: date | None = None,
        *,
        preferences: DashboardPreferences | None = None,
        include_hidden: bool = True,
    ) -> list[DailySummary]:
        query = """
        SELECT metric_name, units, record_date, quantity, source
        FROM health_records
        WHERE record_date IS NOT NULL AND quantity IS NOT NULL
        """
        params: list[Any] = []
        if start is not None:
            query += " AND record_date >= ?"
            params.append(start.isoformat())
        if end is not None:
            query += " AND record_date <= ?"
            params.append(end.isoformat())
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()

        summaries: dict[date, dict[str, float]] = {}
        latest_weight: dict[date, float] = {}
        hidden_fields = set() if include_hidden else set(_effective_hidden_fields(preferences))
        untrusted_metric_names = set(preferences.untrusted_metric_names) if preferences is not None else set()
        trusted_metric_names = set(preferences.trusted_metric_names) if preferences is not None else set()
        source_filters = preferences.source_filters if preferences is not None else {}
        for row in rows:
            day = _parse_date(row["record_date"])
            if day is None:
                continue
            metric_name = row["metric_name"]
            if metric_name in untrusted_metric_names:
                continue
            if trusted_metric_names and metric_name not in trusted_metric_names:
                continue
            allowed_sources = source_filters.get(metric_name)
            if allowed_sources and row["source"] not in allowed_sources:
                continue
            key = _summary_key(row["metric_name"])
            if key is None or key in hidden_fields:
                continue
            quantity = _summary_quantity(key, row["units"], float(row["quantity"]))
            if quantity is None:
                continue
            if key == "weight":
                latest_weight[day] = quantity
                continue
            summaries.setdefault(day, {})[key] = summaries.setdefault(day, {}).get(key, 0.0) + quantity

        for day, weight in latest_weight.items():
            summaries.setdefault(day, {})["weight"] = weight

        items = [DailySummary(date=day, **values) for day, values in sorted(summaries.items())]
        return items

    def workouts(self, start: date | None = None, end: date | None = None) -> WorkoutListResponse:
        self._ensure_schema()
        _validate_range(start, end)
        query = "SELECT * FROM workout_records WHERE 1 = 1"
        params: list[Any] = []
        if start is not None:
            query += " AND substr(start_date, 1, 10) >= ?"
            params.append(start.isoformat())
        if end is not None:
            query += " AND substr(start_date, 1, 10) <= ?"
            params.append(end.isoformat())
        query += " ORDER BY start_date, id"
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        records = [_workout_from_row(row) for row in rows]
        return WorkoutListResponse(count=len(records), workouts=records)

    def ingest_status(self) -> IngestStatusResponse:
        self._ensure_schema()
        with self._connect() as conn:
            batch = conn.execute(
                "SELECT COUNT(*) AS count, MAX(received_at) AS latest_batch_at FROM ingest_batches"
            ).fetchone()
            metrics = conn.execute(
                "SELECT COUNT(*) AS count, MIN(record_date) AS first_date, MAX(record_date) AS last_date FROM health_records"
            ).fetchone()
            workouts = conn.execute("SELECT COUNT(*) AS count FROM workout_records").fetchone()
        return IngestStatusResponse(
            latest_batch_at=_parse_datetime(batch["latest_batch_at"]),
            batch_count=int(batch["count"]),
            metric_record_count=int(metrics["count"]),
            workout_record_count=int(workouts["count"]),
            first_date=_parse_date(metrics["first_date"]),
            last_date=_parse_date(metrics["last_date"]),
        )

    def close(self) -> None:
        return None

    def _connect(self) -> sqlite3.Connection:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self._path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self) -> None:
        if self._initialized:
            return
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS ingest_batches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    payload_hash TEXT NOT NULL UNIQUE,
                    headers_json TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS health_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id INTEGER NOT NULL REFERENCES ingest_batches(id),
                    metric_name TEXT NOT NULL,
                    units TEXT,
                    record_date TEXT,
                    timestamp TEXT,
                    quantity REAL,
                    source TEXT,
                    raw_json TEXT NOT NULL,
                    fingerprint TEXT NOT NULL UNIQUE
                );
                CREATE TABLE IF NOT EXISTS workout_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id INTEGER NOT NULL REFERENCES ingest_batches(id),
                    workout_id TEXT,
                    name TEXT,
                    start_date TEXT,
                    end_date TEXT,
                    duration_seconds REAL,
                    energy REAL,
                    raw_json TEXT NOT NULL,
                    fingerprint TEXT NOT NULL UNIQUE
                );
                CREATE TABLE IF NOT EXISTS dashboard_preferences (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    preferences_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
        self._initialized = True

    def _insert_batch(self, conn: sqlite3.Connection, payload_hash: str, payload_json: str, headers: dict[str, str]) -> int:
        headers_json = _canonical_json(_safe_headers(headers))
        conn.execute(
            """
            INSERT OR IGNORE INTO ingest_batches (payload_hash, headers_json, payload_json)
            VALUES (?, ?, ?)
            """,
            (payload_hash, headers_json, payload_json),
        )
        row = conn.execute("SELECT id FROM ingest_batches WHERE payload_hash = ?", (payload_hash,)).fetchone()
        return int(row["id"])

    def _insert_metric(self, conn: sqlite3.Connection, batch_id: int, metric: NormalizedMetric) -> int:
        fingerprint = _fingerprint(
            "metric",
            metric.name,
            metric.record_date.isoformat() if metric.record_date else None,
            metric.timestamp.isoformat() if metric.timestamp else None,
            metric.quantity,
            metric.raw,
        )
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO health_records
                (batch_id, metric_name, units, record_date, timestamp, quantity, source, raw_json, fingerprint)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                batch_id,
                metric.name,
                metric.units,
                metric.record_date.isoformat() if metric.record_date else None,
                metric.timestamp.isoformat() if metric.timestamp else None,
                metric.quantity,
                metric.source,
                _canonical_json(metric.raw),
                fingerprint,
            ),
        )
        return cursor.rowcount

    def _insert_workout(self, conn: sqlite3.Connection, batch_id: int, workout: NormalizedWorkout) -> int:
        fingerprint = _fingerprint(
            "workout",
            workout.workout_id,
            workout.name,
            workout.start_date.isoformat() if workout.start_date else None,
            workout.raw,
        )
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO workout_records
                (batch_id, workout_id, name, start_date, end_date, duration_seconds, energy, raw_json, fingerprint)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                batch_id,
                workout.workout_id,
                workout.name,
                workout.start_date.isoformat() if workout.start_date else None,
                workout.end_date.isoformat() if workout.end_date else None,
                workout.duration_seconds,
                workout.energy,
                _canonical_json(workout.raw),
                fingerprint,
            ),
        )
        return cursor.rowcount


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


def _metric_from_row(row: sqlite3.Row) -> MetricRecord:
    return MetricRecord(
        id=row["id"],
        metric_name=row["metric_name"],
        units=row["units"],
        date=_parse_date(row["record_date"]),
        timestamp=_parse_datetime(row["timestamp"]),
        quantity=row["quantity"],
        source=row["source"],
        raw=json.loads(row["raw_json"]),
    )


def _workout_from_row(row: sqlite3.Row) -> WorkoutRecord:
    return WorkoutRecord(
        id=row["id"],
        workout_id=row["workout_id"],
        name=row["name"],
        start_date=_parse_datetime(row["start_date"]),
        end_date=_parse_datetime(row["end_date"]),
        duration_seconds=row["duration_seconds"],
        energy=row["energy"],
        raw=json.loads(row["raw_json"]),
    )


def _summary_key(metric_name: str) -> str | None:
    normalized = metric_name.lower().replace(" ", "_").replace("-", "_")
    aliases = {
        "dietary_energy": "calories",
        "energy_consumed": "calories",
        "protein": "protein",
        "dietary_protein": "protein",
        "carbohydrates": "carbohydrates",
        "dietary_carbohydrates": "carbohydrates",
        "total_fat": "fat",
        "dietary_fat_total": "fat",
        "dietary_water": "water",
        "water": "water",
        "body_mass": "weight",
        "body_weight": "weight",
        "weight": "weight",
        "step_count": "steps",
        "steps": "steps",
        "active_energy": "active_energy",
        "active_energy_burned": "active_energy",
    }
    return aliases.get(normalized)


def _summary_quantity(key: str, units: str | None, quantity: float) -> float | None:
    normalized_units = (units or "").strip().lower().replace("_", " ")
    if key in {"calories", "active_energy"}:
        if normalized_units in {"kj", "kilojoule", "kilojoules"}:
            return quantity / 4.184
        return quantity
    if key == "water":
        if normalized_units in {"l", "liter", "liters", "litre", "litres"}:
            return quantity * 1000
        if normalized_units in {"fl oz", "floz", "fluid ounce", "fluid ounces", "oz"}:
            return quantity * 29.5735295625
        return quantity
    return quantity


def _normalize_preferences(preferences: DashboardPreferences) -> DashboardPreferences:
    known_fields = set(SUMMARY_FIELDS)
    visible = [field for field in preferences.visible_summary_cards if field in known_fields]
    hidden = [field for field in preferences.hidden_summary_fields if field in known_fields]
    chart_set = [field for field in preferences.default_chart_set if field in known_fields]
    source_filters = {
        str(metric): [str(source) for source in sources if str(source)]
        for metric, sources in preferences.source_filters.items()
        if str(metric) and sources
    }
    return DashboardPreferences(
        visible_summary_cards=visible or list(SUMMARY_FIELDS),
        hidden_summary_fields=hidden,
        preferred_range_days=max(1, min(365, int(preferences.preferred_range_days))),
        trusted_metric_names=sorted({name for name in preferences.trusted_metric_names if name}),
        untrusted_metric_names=sorted({name for name in preferences.untrusted_metric_names if name}),
        default_chart_set=chart_set or ["calories", "protein", "carbohydrates", "fat", "active_energy"],
        source_filters=source_filters,
    )


def _effective_hidden_fields(preferences: DashboardPreferences | None) -> list[str]:
    if preferences is None:
        return []
    visible = set(preferences.visible_summary_cards)
    hidden = set(preferences.hidden_summary_fields)
    return [field for field in SUMMARY_FIELDS if field in hidden or field not in visible]


def _safe_headers(headers: dict[str, str]) -> dict[str, str]:
    return {key: ("<redacted>" if key.lower() in {"x-api-key", "authorization"} else value) for key, value in headers.items()}


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _fingerprint(*parts: Any) -> str:
    return hashlib.sha256(_canonical_json(parts).encode("utf-8")).hexdigest()


def _first_value(data: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in data:
            return data[key]
    return None


def _str_or_none(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def _float_or_none(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None
    candidate = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(candidate)
    except ValueError:
        try:
            return datetime.fromisoformat(candidate[:10])
        except ValueError:
            return None


def _parse_date(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _validate_range(start: date | None, end: date | None) -> None:
    if start is not None and end is not None and start > end:
        raise ValueError("start must be on or before end")
