from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from macrofactor_scraper._aggregation import (
    REPLACEMENT_SUMMARY_KEYS,
    RUNNING_TOTAL_SUMMARY_KEYS,
    SOURCE_PRIORITY,
    SUMMARY_FIELDS,
    _collapse_additive_rows,
    _is_midnight_summary,
    _latest_metric_row,
    _metric_row_sort_key,
    _summary_aggregation,
    _summary_key,
    _summary_quantity,
)
from macrofactor_scraper._normalize import (
    NormalizedMetric,
    NormalizedWorkout,
    _find_metric_objects,
    _find_workout_objects,
    normalize_metrics,
    normalize_workouts,
)
from macrofactor_scraper._preferences import (
    _effective_hidden_fields,
    _normalize_preferences,
    _normalize_workout_preferences,
)
from macrofactor_scraper._rows import _metric_from_row, _workout_from_row
from macrofactor_scraper._stats import (
    _avg,
    _date_delta,
    _pearson,
    _training_rest_delta,
    _week_start,
)
from macrofactor_scraper._strong import (
    EXERCISE_TAXONOMY_RULES,
    STRONG_REQUIRED_COLUMNS,
    StrongParsedSet,
    _parse_strong_duration,
    _strong_estimated_1rm_from_row,
    _strong_session_fingerprint,
    _strong_session_from_row,
    _strong_set_fingerprint,
    _strong_set_from_row,
    _strong_volume_from_row,
    classify_strong_exercise,
    parse_strong_csv,
)
from macrofactor_scraper._utils import (
    _blank_to_none,
    _canonical_json,
    _fingerprint,
    _first_value,
    _float_or_none,
    _parse_date,
    _parse_datetime,
    _safe_headers,
    _str_or_none,
    _validate_range,
)
from macrofactor_scraper.models import (
    DailySummary,
    DailySummaryResponse,
    DashboardMetricCatalogItem,
    DashboardMetricCatalogResponse,
    DashboardPreferences,
    DashboardSummaryResponse,
    IngestStatusResponse,
    IngestResponse,
    MetricDateDiagnosticItem,
    MetricDateDiagnosticResponse,
    MetricListResponse,
    MetricRecord,
    MetricRecordsResponse,
    MetricSummary,
    StrongAnalyticsResponse,
    StrongAnalyticsTotals,
    StrongDailyLoad,
    StrongExerciseDetailResponse,
    StrongExercisePr,
    StrongExerciseProgressPoint,
    StrongExerciseSummary,
    StrongExerciseTaxonomy,
    StrongFilterOptions,
    StrongGroupBalance,
    StrongHighVolumeWeek,
    StrongImportListResponse,
    StrongImportRecord,
    StrongImportResponse,
    StrongLowProteinTrainingDay,
    StrongNutritionComparison,
    StrongNutritionCorrelation,
    StrongNutritionTrainingDay,
    StrongRecentPr,
    StrongRecoveryLoadMarkers,
    StrongSessionListResponse,
    StrongSessionRecord,
    StrongSetRecord,
    StrongSummaryResponse,
    StrongTrainingRestDelta,
    StrongWeeklyLoad,
    StrongWeeklyGroupLoad,
    StrongWeeklySummary,
    WorkoutListResponse,
    WorkoutRecord,
    WorkoutPreferences,
)


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

    def update_health_record(self, record_id: int, fields: dict[str, Any]) -> MetricRecord | None:
        self._ensure_schema()
        allowed = {"quantity", "units", "record_date", "timestamp", "source", "metric_name"}
        updates = {key: value for key, value in fields.items() if key in allowed}
        with self._connect() as conn:
            if updates:
                assignments = ", ".join(f"{key} = ?" for key in updates)
                conn.execute(
                    f"UPDATE health_records SET {assignments} WHERE id = ?",
                    [*updates.values(), record_id],
                )
            row = conn.execute("SELECT * FROM health_records WHERE id = ?", (record_id,)).fetchone()
        if row is None:
            return None
        return _metric_from_row(row)

    def delete_health_record(self, record_id: int) -> bool:
        self._ensure_schema()
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM health_records WHERE id = ?", (record_id,))
            return cursor.rowcount > 0

    def daily_summary(self, start: date | None = None, end: date | None = None) -> DailySummaryResponse:
        self._ensure_schema()
        _validate_range(start, end)
        items = self._daily_summary_items(start, end)
        return DailySummaryResponse(count=len(items), summaries=items)

    def excel_daily_log_rows(self, start: date | None = None, end: date | None = None) -> list[dict[str, float | str | None]]:
        self._ensure_schema()
        _validate_range(start, end)
        return [
            {
                "date": item.date.isoformat(),
                "calories": item.calories,
                "protein": item.protein,
                "carbohydrates": item.carbohydrates,
                "fat": item.fat,
                "water": item.water,
                "weight": item.weight,
                "steps": item.steps,
                "active_energy": item.active_energy,
            }
            for item in self._daily_summary_items(start, end, include_hidden=True)
        ]

    def excel_calories_weight_rows(self, start: date | None = None, end: date | None = None) -> list[dict[str, float | str | None]]:
        self._ensure_schema()
        _validate_range(start, end)
        rows = self._daily_summary_items(start, end, include_hidden=True)
        first_weight: float | None = None
        output: list[dict[str, float | str | None]] = []
        for index, item in enumerate(rows):
            if first_weight is None and item.weight is not None:
                first_weight = item.weight
            trailing = [row.calories for row in rows[max(0, index - 6) : index + 1] if row.calories is not None]
            output.append(
                {
                    "date": item.date.isoformat(),
                    "calories": item.calories,
                    "weight": item.weight,
                    "rolling_calories_7d": sum(trailing) / len(trailing) if trailing else None,
                    "weight_delta": item.weight - first_weight if item.weight is not None and first_weight is not None else None,
                }
            )
        return output

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
        return _normalize_preferences(DashboardPreferences.model_validate(data))

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

    def metric_date_diagnostics(self, target_date: date) -> MetricDateDiagnosticResponse:
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, metric_name, units, record_date, timestamp, quantity, source
                FROM health_records
                WHERE record_date = ? AND quantity IS NOT NULL
                ORDER BY metric_name, units, source, timestamp, id
                """,
                (target_date.isoformat(),),
            ).fetchall()

        groups: dict[tuple[str, str | None, str | None], list[sqlite3.Row]] = {}
        for row in rows:
            groups.setdefault((row["metric_name"], row["units"], row["source"]), []).append(row)

        diagnostics: list[MetricDateDiagnosticItem] = []
        for (metric_name, units, source), group_rows in sorted(groups.items(), key=lambda item: (item[0][0], item[0][1] or "", item[0][2] or "")):
            key = _summary_key(metric_name)
            aggregation = _summary_aggregation(key)
            values = [_summary_quantity(key, row["units"], float(row["quantity"])) if key else float(row["quantity"]) for row in group_rows]
            numeric_values = [value for value in values if value is not None]
            latest_row = _latest_metric_row(group_rows)
            replacement_value = (
                _summary_quantity(key, latest_row["units"], float(latest_row["quantity"])) if key and latest_row["quantity"] is not None else latest_row["quantity"]
            )
            summed_value = sum(numeric_values) if numeric_values else None
            collapsed_value: float | None = None
            if key is not None:
                if aggregation == "replacement":
                    collapsed_value = replacement_value
                else:
                    collapsed_value = _collapse_additive_rows(group_rows, key)
            suspicious = (
                (aggregation == "replacement" and len(group_rows) > 1 and summed_value != replacement_value)
                or (aggregation == "additive" and collapsed_value is not None and summed_value is not None and abs(collapsed_value - summed_value) > 0.01)
            )
            diagnostics.append(
                MetricDateDiagnosticItem(
                    metric_name=metric_name,
                    units=units,
                    source=source,
                    dashboard_field=key,
                    aggregation=aggregation,
                    row_count=len(group_rows),
                    summed_value=summed_value,
                    replacement_value=replacement_value,
                    collapsed_value=collapsed_value,
                    first_record_id=int(group_rows[0]["id"]),
                    latest_record_id=int(latest_row["id"]),
                    first_timestamp=_parse_datetime(group_rows[0]["timestamp"]),
                    latest_timestamp=_parse_datetime(latest_row["timestamp"]),
                    suspicious=suspicious,
                )
            )
        return MetricDateDiagnosticResponse(date=target_date, count=len(diagnostics), diagnostics=diagnostics)

    def import_strong_csv(self, filename: str, content: bytes) -> StrongImportResponse:
        self._ensure_schema()
        nutrition_start = self._nutrition_start_date()
        if nutrition_start is None:
            raise ValueError("Nutrition data must be imported before Strong workouts")

        payload_hash = hashlib.sha256(content).hexdigest()
        parsed_sets, rows_seen, ignored, errors = parse_strong_csv(content, nutrition_start)
        with self._connect() as conn:
            existing = conn.execute("SELECT id FROM strong_imports WHERE payload_hash = ?", (payload_hash,)).fetchone()
            if existing is None:
                cursor = conn.execute(
                    """
                    INSERT INTO strong_imports
                        (filename, payload_hash, nutrition_start_date, rows_seen, rows_imported,
                         rows_ignored_before_nutrition, sessions_inserted, sets_inserted, duplicate_sets, errors_json)
                    VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?)
                    """,
                    (
                        filename,
                        payload_hash,
                        nutrition_start.isoformat(),
                        rows_seen,
                        len(parsed_sets),
                        ignored,
                        _canonical_json(errors),
                    ),
                )
                import_id = int(cursor.lastrowid)
            else:
                import_id = int(existing["id"])

            sessions_inserted = 0
            sets_inserted = 0
            session_ids: dict[str, int] = {}
            for parsed in parsed_sets:
                session_fingerprint = _strong_session_fingerprint(parsed)
                session_id, inserted = self._upsert_strong_session(conn, import_id, parsed, session_fingerprint)
                session_ids[session_fingerprint] = session_id
                sessions_inserted += inserted
                set_inserted = self._insert_strong_set(conn, import_id, session_id, parsed)
                sets_inserted += set_inserted

            duplicate_sets = max(0, len(parsed_sets) - sets_inserted)
            conn.execute(
                """
                UPDATE strong_imports
                SET rows_seen = ?, rows_imported = ?, rows_ignored_before_nutrition = ?,
                    sessions_inserted = ?, sets_inserted = ?, duplicate_sets = ?, errors_json = ?
                WHERE id = ?
                """,
                (rows_seen, len(parsed_sets), ignored, sessions_inserted, sets_inserted, duplicate_sets, _canonical_json(errors), import_id),
            )
            row = conn.execute("SELECT * FROM strong_imports WHERE id = ?", (import_id,)).fetchone()
        return StrongImportResponse(
            import_id=import_id,
            filename=row["filename"],
            uploaded_at=_parse_datetime(row["uploaded_at"]),
            nutrition_start_date=nutrition_start,
            rows_seen=rows_seen,
            rows_imported=len(parsed_sets),
            rows_ignored_before_nutrition=ignored,
            sessions_inserted=sessions_inserted,
            sets_inserted=sets_inserted,
            duplicate_sets=duplicate_sets,
            errors=errors,
        )

    def strong_imports(self) -> StrongImportListResponse:
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM strong_imports ORDER BY uploaded_at DESC, id DESC LIMIT 25").fetchall()
        imports = [
            StrongImportRecord(
                id=int(row["id"]),
                filename=row["filename"],
                uploaded_at=_parse_datetime(row["uploaded_at"]),
                nutrition_start_date=_parse_date(row["nutrition_start_date"]),
                rows_seen=int(row["rows_seen"]),
                rows_imported=int(row["rows_imported"]),
                rows_ignored_before_nutrition=int(row["rows_ignored_before_nutrition"]),
                sessions_inserted=int(row["sessions_inserted"]),
                sets_inserted=int(row["sets_inserted"]),
                duplicate_sets=int(row["duplicate_sets"]),
            )
            for row in rows
        ]
        return StrongImportListResponse(count=len(imports), imports=imports)

    def strong_sessions(self, start: date | None = None, end: date | None = None, *, include_sets: bool = True) -> StrongSessionListResponse:
        self._ensure_schema()
        _validate_range(start, end)
        sessions = self._strong_session_records(start, end, include_sets=include_sets)
        return StrongSessionListResponse(count=len(sessions), sessions=sessions)

    def strong_session_detail(self, session_id: int) -> StrongSessionRecord | None:
        self._ensure_schema()
        sessions = self._strong_sessions_by_ids([session_id])
        return sessions[0] if sessions else None

    def strong_summary(self, start: date | None = None, end: date | None = None) -> StrongSummaryResponse:
        self._ensure_schema()
        _validate_range(start, end)
        sessions = self._strong_session_records(start, end, include_sets=False)
        set_rows = self._strong_set_rows(start, end)
        working_rows = [row for row in set_rows if not bool(row["is_warmup"])]
        session_dates = {session.workout_date for session in sessions}
        weekly = self._strong_weekly_summary(sessions, working_rows)
        exercises = self._strong_exercise_summaries(working_rows)
        return StrongSummaryResponse(
            start=start,
            end=end,
            nutrition_start_date=self._nutrition_start_date(),
            session_count=len(sessions),
            working_set_count=len(working_rows),
            total_volume=sum(_strong_volume_from_row(row) for row in working_rows),
            duration_seconds=sum(session.duration_seconds or 0 for session in sessions),
            exercise_count=len({row["exercise_name"] for row in working_rows}),
            weekly=weekly,
            exercises=exercises,
            nutrition=self._strong_nutrition_comparison(start, end, session_dates),
            recent_prs=self._strong_recent_prs(working_rows),
        )

    def strong_analytics(self, start: date | None = None, end: date | None = None) -> StrongAnalyticsResponse:
        self._ensure_schema()
        _validate_range(start, end)
        sessions = self._strong_session_records(start, end, include_sets=False)
        set_rows = self._strong_set_rows(start, end)
        working_rows = [row for row in set_rows if not bool(row["is_warmup"])]
        pr_rows = self._strong_pr_rows(working_rows)
        pr_count_by_week: dict[date, int] = {}
        for row in pr_rows:
            day = _parse_date(row["workout_date"])
            if day is not None:
                week = _week_start(day)
                pr_count_by_week[week] = pr_count_by_week.get(week, 0) + 1
        exercise_taxonomy = {
            exercise: classify_strong_exercise(exercise)
            for exercise in sorted({row["exercise_name"] for row in working_rows})
        }
        nutrition_days = self._daily_summary_items(start, end, include_hidden=True)
        nutrition_by_date = {item.date: item for item in nutrition_days}
        session_dates = {session.workout_date for session in sessions}
        nutrition_comparison = self._strong_nutrition_comparison(start, end, session_dates)
        weekly_load = self._strong_weekly_load(sessions, working_rows, pr_count_by_week, nutrition_by_date)
        nutrition_training_days = self._strong_nutrition_training_days(sessions, working_rows, pr_rows, nutrition_by_date)
        return StrongAnalyticsResponse(
            start=start,
            end=end,
            nutrition_start_date=self._nutrition_start_date(),
            totals=StrongAnalyticsTotals(
                sessions=len(sessions),
                working_sets=len(working_rows),
                total_volume=sum(_strong_volume_from_row(row) for row in working_rows),
                duration_seconds=sum(session.duration_seconds or 0 for session in sessions),
                exercises=len(exercise_taxonomy),
                pr_count=len(pr_rows),
            ),
            weekly_load=weekly_load,
            group_balance=self._strong_group_balance(working_rows, pr_rows),
            exercise_taxonomy=exercise_taxonomy,
            daily_load=self._strong_daily_load(sessions, working_rows, pr_rows),
            weekly_group_load=self._strong_weekly_group_load(working_rows),
            exercise_prs=self._strong_exercise_prs(pr_rows),
            filter_options=self._strong_filter_options(sessions, working_rows),
            nutrition_training_days=nutrition_training_days,
            nutrition_correlations=self._strong_nutrition_correlations(nutrition_training_days),
            recovery_load_markers=self._strong_recovery_load_markers(weekly_load, nutrition_training_days, nutrition_comparison),
        )

    def strong_exercise_detail(self, exercise_name: str, start: date | None = None, end: date | None = None) -> StrongExerciseDetailResponse:
        self._ensure_schema()
        _validate_range(start, end)
        set_rows = [row for row in self._strong_set_rows(start, end) if row["exercise_name"] == exercise_name]
        working_rows = [row for row in set_rows if not bool(row["is_warmup"])]
        by_date: dict[date, list[sqlite3.Row]] = {}
        for row in working_rows:
            day = _parse_date(row["workout_date"])
            if day is not None:
                by_date.setdefault(day, []).append(row)
        points = []
        for day, rows in sorted(by_date.items()):
            best_1rm = max((_strong_estimated_1rm_from_row(row) or 0 for row in rows), default=0)
            best_weight = max((float(row["weight"]) for row in rows if row["weight"] is not None), default=None)
            best_reps = max((float(row["reps"]) for row in rows if row["reps"] is not None), default=None)
            points.append(
                StrongExerciseProgressPoint(
                    date=day,
                    best_weight=best_weight,
                    best_reps=best_reps,
                    best_estimated_1rm=best_1rm or None,
                    total_volume=sum(_strong_volume_from_row(row) for row in rows),
                    working_sets=len(rows),
                )
            )

        session_ids = sorted({int(row["session_id"]) for row in set_rows})
        sessions = self._strong_sessions_by_ids(session_ids) if session_ids else []
        return StrongExerciseDetailResponse(exercise_name=exercise_name, points=points, sessions=sessions)

    def _daily_summary_items(
        self,
        start: date | None = None,
        end: date | None = None,
        *,
        preferences: DashboardPreferences | None = None,
        include_hidden: bool = True,
    ) -> list[DailySummary]:
        query = """
        SELECT id, metric_name, units, record_date, timestamp, quantity, source
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

        hidden_fields = set() if include_hidden else set(_effective_hidden_fields(preferences))
        untrusted_metric_names = set(preferences.untrusted_metric_names) if preferences is not None else set()
        trusted_metric_names = set(preferences.trusted_metric_names) if preferences is not None else set()
        source_filters = preferences.source_filters if preferences is not None else {}

        # Bucket rows by (date, summary_key, source) for collapse logic.
        # Replacement metrics (weight) go into a separate bucket for latest-wins.
        additive_buckets: dict[tuple[date, str, str | None], list[sqlite3.Row]] = {}
        replacement_rows: dict[tuple[date, str, str | None], sqlite3.Row] = {}
        # Dedup guard for exact-duplicate rows that share (metric, units, date, timestamp,
        # source, quantity) — handles legacy rows inserted with different fingerprints.
        seen_records: set[tuple[str, str | None, str | None, str | None, str | None, float]] = set()

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
            key = _summary_key(metric_name)
            if key is None or key in hidden_fields:
                continue

            source = row["source"]

            dedup_key = (metric_name, row["units"], row["record_date"], row["timestamp"], source, float(row["quantity"]))
            if dedup_key in seen_records:
                continue
            seen_records.add(dedup_key)

            if _summary_aggregation(key) == "replacement":
                bucket_key = (day, key, source)
                current = replacement_rows.get(bucket_key)
                if current is None or _metric_row_sort_key(row) > _metric_row_sort_key(current):
                    replacement_rows[bucket_key] = row
            else:
                additive_buckets.setdefault((day, key, source), []).append(row)

        # Collapse each additive bucket: latest midnight snapshot wins per source,
        # else sum intraday rows. Then accumulate across sources per (day, key).
        summaries: dict[date, dict[str, float]] = {}
        for (day, key, _source), bucket_rows in additive_buckets.items():
            value = _collapse_additive_rows(bucket_rows, key)
            day_totals = summaries.setdefault(day, {})
            day_totals[key] = day_totals.get(key, 0.0) + value

        # Collapse replacement metrics with source priority.
        # Group (day, key) -> {source: best_row_for_that_source}
        source_best: dict[tuple[date, str], dict[str, sqlite3.Row]] = {}
        for (day, key, source), row in replacement_rows.items():
            s = source or ""
            inner = source_best.setdefault((day, key), {})
            if s not in inner or _metric_row_sort_key(row) > _metric_row_sort_key(inner[s]):
                inner[s] = row

        for (day, key), by_source in source_best.items():
            priority = SOURCE_PRIORITY.get(key, ())
            chosen_row: sqlite3.Row | None = None
            for prio_source in priority:
                if prio_source in by_source:
                    chosen_row = by_source[prio_source]
                    break
            if chosen_row is None:
                chosen_row = max(by_source.values(), key=_metric_row_sort_key)
            quantity = _summary_quantity(key, chosen_row["units"], float(chosen_row["quantity"]))
            if quantity is not None:
                summaries.setdefault(day, {})[key] = quantity

        # Manual weight_kg logged in morning form overrides all other weight sources
        log_q = "SELECT log_date, weight_kg FROM daily_logs WHERE weight_kg IS NOT NULL"
        log_params: list[Any] = []
        if start is not None:
            log_q += " AND log_date >= ?"
            log_params.append(start.isoformat())
        if end is not None:
            log_q += " AND log_date <= ?"
            log_params.append(end.isoformat())
        with self._connect() as conn:
            for lr in conn.execute(log_q, log_params).fetchall():
                day = _parse_date(lr["log_date"])
                if day is not None:
                    summaries.setdefault(day, {})["weight"] = float(lr["weight_kg"])

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

    def repair_running_totals(
        self,
        start: date | None,
        end: date | None,
        *,
        dry_run: bool,
        backup_dir: Path | None = None,
    ) -> "RepairReport":
        from macrofactor_scraper.models import RepairDayDelta, RepairReport  # local import avoids circular

        self._ensure_schema()
        query = """
        SELECT id, metric_name, units, record_date, timestamp, quantity, source, raw_json, fingerprint, batch_id
        FROM health_records
        WHERE quantity IS NOT NULL
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

        # Only operate on metrics that map to RUNNING_TOTAL_SUMMARY_KEYS
        groups: dict[tuple[str, str | None], list[sqlite3.Row]] = {}
        for row in rows:
            key = _summary_key(row["metric_name"])
            if key not in RUNNING_TOTAL_SUMMARY_KEYS:
                continue
            group_key = (row["record_date"], row["metric_name"], row["source"])
            groups.setdefault(group_key, []).append(row)  # type: ignore[arg-type]

        to_delete: list[int] = []
        backup_rows: list[dict[str, Any]] = []
        deltas: list[RepairDayDelta] = []

        for (record_date, metric_name, source), group_rows in sorted(groups.items()):
            midnight = [r for r in group_rows if _is_midnight_summary(r["timestamp"])]
            intraday = [r for r in group_rows if not _is_midnight_summary(r["timestamp"])]

            if len(midnight) <= 1 and not (midnight and intraday):
                continue  # nothing to clean

            key = _summary_key(metric_name)
            before_ids = [int(r["id"]) for r in group_rows]
            before_total = sum(
                q for r in group_rows
                for q in [_summary_quantity(key, r["units"], float(r["quantity"])) if key else float(r["quantity"])]
                if q is not None
            )

            keep_ids: set[int] = set()
            if midnight:
                best = max(midnight, key=_metric_row_sort_key)
                keep_ids.add(int(best["id"]))
            else:
                for r in intraday:
                    keep_ids.add(int(r["id"]))

            remove_ids = [rid for rid in before_ids if rid not in keep_ids]
            if not remove_ids:
                continue

            kept_rows = [r for r in group_rows if int(r["id"]) in keep_ids]
            after_total = sum(
                q for r in kept_rows
                for q in [_summary_quantity(key, r["units"], float(r["quantity"])) if key else float(r["quantity"])]
                if q is not None
            )

            to_delete.extend(remove_ids)
            backup_rows.extend(
                {"id": int(r["id"]), "metric_name": r["metric_name"], "units": r["units"],
                 "record_date": r["record_date"], "timestamp": r["timestamp"],
                 "quantity": r["quantity"], "source": r["source"],
                 "raw_json": r["raw_json"], "fingerprint": r["fingerprint"], "batch_id": r["batch_id"]}
                for r in group_rows if int(r["id"]) in set(remove_ids)
            )
            day = _parse_date(record_date)
            if day is not None:
                deltas.append(RepairDayDelta(
                    date=day, metric_name=metric_name, source=source,
                    before_total=before_total, after_total=after_total, removed_row_ids=remove_ids,
                ))

        backup_path: str | None = None
        if not dry_run and to_delete:
            import datetime as _dt
            import json as _json

            if backup_dir is not None:
                backup_dir.mkdir(parents=True, exist_ok=True)
                ts = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
                backup_file = backup_dir / f"repair_backup_{ts}.json"
                backup_file.write_text(_json.dumps(backup_rows, default=str, indent=2))
                backup_path = str(backup_file)

            placeholders = ",".join("?" * len(to_delete))
            with self._connect() as conn:
                conn.execute(f"DELETE FROM health_records WHERE id IN ({placeholders})", to_delete)

        return RepairReport(
            dry_run=dry_run,
            groups_inspected=len(groups),
            rows_removed=len(to_delete) if not dry_run else 0,
            backup_path=backup_path,
            deltas=deltas,
        )

    def _nutrition_start_date(self) -> date | None:
        with self._connect() as conn:
            row = conn.execute("SELECT MIN(record_date) AS first_date FROM health_records WHERE record_date IS NOT NULL").fetchone()
        return _parse_date(row["first_date"]) if row else None

    def _upsert_strong_session(
        self,
        conn: sqlite3.Connection,
        import_id: int,
        parsed: StrongParsedSet,
        fingerprint: str,
    ) -> tuple[int, int]:
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO strong_workout_sessions
                (import_id, workout_date, started_at, workout_name, duration_seconds, workout_notes, fingerprint)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                import_id,
                parsed.workout_date.isoformat(),
                parsed.started_at.isoformat(),
                parsed.workout_name,
                parsed.duration_seconds,
                parsed.workout_notes,
                fingerprint,
            ),
        )
        row = conn.execute("SELECT id FROM strong_workout_sessions WHERE fingerprint = ?", (fingerprint,)).fetchone()
        return int(row["id"]), int(cursor.rowcount)

    def _insert_strong_set(self, conn: sqlite3.Connection, import_id: int, session_id: int, parsed: StrongParsedSet) -> int:
        fingerprint = _strong_set_fingerprint(parsed)
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO strong_workout_sets
                (import_id, session_id, workout_date, exercise_name, set_order, is_warmup,
                 weight, reps, distance, seconds, notes, rpe, raw_json, fingerprint)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                import_id,
                session_id,
                parsed.workout_date.isoformat(),
                parsed.exercise_name,
                parsed.set_order,
                1 if parsed.is_warmup else 0,
                parsed.weight,
                parsed.reps,
                parsed.distance,
                parsed.seconds,
                parsed.notes,
                parsed.rpe,
                _canonical_json(parsed.raw),
                fingerprint,
            ),
        )
        return int(cursor.rowcount)

    def _strong_session_records(self, start: date | None, end: date | None, *, include_sets: bool) -> list[StrongSessionRecord]:
        query = """
        SELECT
            s.*,
            COUNT(DISTINCT st.exercise_name) AS exercise_count,
            SUM(CASE WHEN st.is_warmup = 0 THEN 1 ELSE 0 END) AS working_set_count,
            SUM(CASE WHEN st.is_warmup = 0 AND st.weight IS NOT NULL AND st.reps IS NOT NULL THEN st.weight * st.reps ELSE 0 END) AS total_volume
        FROM strong_workout_sessions s
        LEFT JOIN strong_workout_sets st ON st.session_id = s.id
        WHERE 1 = 1
        """
        params: list[Any] = []
        if start is not None:
            query += " AND s.workout_date >= ?"
            params.append(start.isoformat())
        if end is not None:
            query += " AND s.workout_date <= ?"
            params.append(end.isoformat())
        query += " GROUP BY s.id ORDER BY s.started_at DESC, s.id DESC"
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
            set_map: dict[int, list[StrongSetRecord]] = {}
            if include_sets and rows:
                ids = [int(row["id"]) for row in rows]
                placeholders = ",".join("?" * len(ids))
                set_rows = conn.execute(
                    f"SELECT * FROM strong_workout_sets WHERE session_id IN ({placeholders}) ORDER BY session_id, exercise_name, is_warmup DESC, set_order, id",
                    ids,
                ).fetchall()
                for row in set_rows:
                    set_map.setdefault(int(row["session_id"]), []).append(_strong_set_from_row(row))
        return [_strong_session_from_row(row, set_map.get(int(row["id"]), [])) for row in rows]

    def _strong_sessions_by_ids(self, session_ids: list[int]) -> list[StrongSessionRecord]:
        if not session_ids:
            return []
        placeholders = ",".join("?" * len(session_ids))
        query = f"""
        SELECT
            s.*,
            COUNT(DISTINCT st.exercise_name) AS exercise_count,
            SUM(CASE WHEN st.is_warmup = 0 THEN 1 ELSE 0 END) AS working_set_count,
            SUM(CASE WHEN st.is_warmup = 0 AND st.weight IS NOT NULL AND st.reps IS NOT NULL THEN st.weight * st.reps ELSE 0 END) AS total_volume
        FROM strong_workout_sessions s
        LEFT JOIN strong_workout_sets st ON st.session_id = s.id
        WHERE s.id IN ({placeholders})
        GROUP BY s.id
        ORDER BY s.started_at DESC, s.id DESC
        """
        with self._connect() as conn:
            rows = conn.execute(query, session_ids).fetchall()
            set_rows = conn.execute(
                f"SELECT * FROM strong_workout_sets WHERE session_id IN ({placeholders}) ORDER BY session_id, exercise_name, is_warmup DESC, set_order, id",
                session_ids,
            ).fetchall()
        set_map: dict[int, list[StrongSetRecord]] = {}
        for row in set_rows:
            set_map.setdefault(int(row["session_id"]), []).append(_strong_set_from_row(row))
        return [_strong_session_from_row(row, set_map.get(int(row["id"]), [])) for row in rows]

    def _strong_set_rows(self, start: date | None, end: date | None) -> list[sqlite3.Row]:
        query = """
        SELECT st.*, s.started_at, s.workout_name, s.duration_seconds, s.workout_notes
        FROM strong_workout_sets st
        JOIN strong_workout_sessions s ON s.id = st.session_id
        WHERE 1 = 1
        """
        params: list[Any] = []
        if start is not None:
            query += " AND st.workout_date >= ?"
            params.append(start.isoformat())
        if end is not None:
            query += " AND st.workout_date <= ?"
            params.append(end.isoformat())
        query += " ORDER BY st.workout_date, st.session_id, st.exercise_name, st.id"
        with self._connect() as conn:
            return conn.execute(query, params).fetchall()

    def _strong_weekly_summary(self, sessions: list[StrongSessionRecord], working_rows: list[sqlite3.Row]) -> list[StrongWeeklySummary]:
        session_weeks: dict[date, list[StrongSessionRecord]] = {}
        for session in sessions:
            session_weeks.setdefault(_week_start(session.workout_date), []).append(session)
        rows_by_week: dict[date, list[sqlite3.Row]] = {}
        for row in working_rows:
            day = _parse_date(row["workout_date"])
            if day is not None:
                rows_by_week.setdefault(_week_start(day), []).append(row)
        nutrition_by_date = {item.date: item for item in self._daily_summary_items(include_hidden=True)}
        output: list[StrongWeeklySummary] = []
        for week in sorted(set(session_weeks) | set(rows_by_week)):
            week_sessions = session_weeks.get(week, [])
            week_rows = rows_by_week.get(week, [])
            days = [week + _date_delta(i) for i in range(7)]
            nutrition_days = [nutrition_by_date[day] for day in days if day in nutrition_by_date]
            output.append(
                StrongWeeklySummary(
                    week_start=week,
                    session_count=len(week_sessions),
                    working_set_count=len(week_rows),
                    total_volume=sum(_strong_volume_from_row(row) for row in week_rows),
                    duration_seconds=sum(session.duration_seconds or 0 for session in week_sessions),
                    exercise_count=len({row["exercise_name"] for row in week_rows}),
                    avg_calories=_avg([day.calories for day in nutrition_days]),
                    avg_protein=_avg([day.protein for day in nutrition_days]),
                )
            )
        return output

    def _strong_weekly_load(
        self,
        sessions: list[StrongSessionRecord],
        working_rows: list[sqlite3.Row],
        pr_count_by_week: dict[date, int],
        nutrition_by_date: dict[date, DailySummary],
    ) -> list[StrongWeeklyLoad]:
        session_weeks: dict[date, list[StrongSessionRecord]] = {}
        for session in sessions:
            session_weeks.setdefault(_week_start(session.workout_date), []).append(session)
        rows_by_week: dict[date, list[sqlite3.Row]] = {}
        for row in working_rows:
            day = _parse_date(row["workout_date"])
            if day is not None:
                rows_by_week.setdefault(_week_start(day), []).append(row)
        output: list[StrongWeeklyLoad] = []
        for week in sorted(set(session_weeks) | set(rows_by_week) | set(pr_count_by_week)):
            week_sessions = session_weeks.get(week, [])
            week_rows = rows_by_week.get(week, [])
            days = [week + _date_delta(i) for i in range(7)]
            nutrition_days = [nutrition_by_date[day] for day in days if day in nutrition_by_date]
            output.append(
                StrongWeeklyLoad(
                    week_start=week,
                    session_count=len(week_sessions),
                    working_set_count=len(week_rows),
                    total_volume=sum(_strong_volume_from_row(row) for row in week_rows),
                    duration_seconds=sum(session.duration_seconds or 0 for session in week_sessions),
                    exercise_count=len({row["exercise_name"] for row in week_rows}),
                    pr_count=pr_count_by_week.get(week, 0),
                    avg_calories=_avg([day.calories for day in nutrition_days]),
                    avg_protein=_avg([day.protein for day in nutrition_days]),
                    avg_carbohydrates=_avg([day.carbohydrates for day in nutrition_days]),
                    avg_fat=_avg([day.fat for day in nutrition_days]),
                )
            )
        return output

    def _strong_daily_load(
        self,
        sessions: list[StrongSessionRecord],
        working_rows: list[sqlite3.Row],
        pr_rows: list[sqlite3.Row],
    ) -> list[StrongDailyLoad]:
        sessions_by_date: dict[date, list[StrongSessionRecord]] = {}
        for session in sessions:
            sessions_by_date.setdefault(session.workout_date, []).append(session)
        rows_by_date: dict[date, list[sqlite3.Row]] = {}
        for row in working_rows:
            day = _parse_date(row["workout_date"])
            if day is not None:
                rows_by_date.setdefault(day, []).append(row)
        prs_by_date: dict[date, int] = {}
        for row in pr_rows:
            day = _parse_date(row["workout_date"])
            if day is not None:
                prs_by_date[day] = prs_by_date.get(day, 0) + 1

        output: list[StrongDailyLoad] = []
        for day in sorted(set(sessions_by_date) | set(rows_by_date) | set(prs_by_date)):
            day_sessions = sessions_by_date.get(day, [])
            day_rows = rows_by_date.get(day, [])
            groups = sorted({classify_strong_exercise(row["exercise_name"]).primary_group for row in day_rows})
            output.append(
                StrongDailyLoad(
                    date=day,
                    session_count=len(day_sessions),
                    total_volume=sum(_strong_volume_from_row(row) for row in day_rows),
                    working_sets=len(day_rows),
                    duration_seconds=sum(session.duration_seconds or 0 for session in day_sessions),
                    pr_count=prs_by_date.get(day, 0),
                    groups_trained=groups,
                )
            )
        return output

    def _strong_weekly_group_load(self, working_rows: list[sqlite3.Row]) -> list[StrongWeeklyGroupLoad]:
        grouped: dict[tuple[date, str], dict[str, Any]] = {}
        for row in working_rows:
            day = _parse_date(row["workout_date"])
            if day is None:
                continue
            group = classify_strong_exercise(row["exercise_name"]).primary_group
            bucket = grouped.setdefault((_week_start(day), group), {"volume": 0.0, "sets": 0, "sessions": set()})
            bucket["volume"] += _strong_volume_from_row(row)
            bucket["sets"] += 1
            bucket["sessions"].add(int(row["session_id"]))
        return [
            StrongWeeklyGroupLoad(
                week_start=week,
                group=group,
                total_volume=float(values["volume"]),
                working_sets=int(values["sets"]),
                session_count=len(values["sessions"]),
            )
            for (week, group), values in sorted(grouped.items(), key=lambda item: (item[0][0], item[0][1]))
        ]

    def _strong_exercise_prs(self, pr_rows: list[sqlite3.Row]) -> list[StrongExercisePr]:
        output: list[StrongExercisePr] = []
        for row in pr_rows:
            day = _parse_date(row["workout_date"])
            if day is None:
                continue
            output.append(
                StrongExercisePr(
                    exercise_name=row["exercise_name"],
                    date=day,
                    weight=row["weight"],
                    reps=row["reps"],
                    estimated_1rm=_strong_estimated_1rm_from_row(row),
                    session_id=int(row["session_id"]),
                )
            )
        return output

    def _strong_filter_options(self, sessions: list[StrongSessionRecord], working_rows: list[sqlite3.Row]) -> StrongFilterOptions:
        taxonomy = [classify_strong_exercise(row["exercise_name"]) for row in working_rows]
        session_dates = [session.workout_date for session in sessions]
        row_dates = [day for row in working_rows for day in [_parse_date(row["workout_date"])] if day is not None]
        dates = session_dates + row_dates
        return StrongFilterOptions(
            groups=sorted({item.primary_group for item in taxonomy}),
            movement_patterns=sorted({item.movement_pattern for item in taxonomy}),
            exercises=sorted({row["exercise_name"] for row in working_rows}),
            start_date=min(dates) if dates else None,
            end_date=max(dates) if dates else None,
        )

    def _strong_group_balance(self, working_rows: list[sqlite3.Row], pr_rows: list[sqlite3.Row]) -> list[StrongGroupBalance]:
        pr_ids = {int(row["id"]) for row in pr_rows}
        grouped: dict[tuple[str, str], dict[str, Any]] = {}
        for row in working_rows:
            taxonomy = classify_strong_exercise(row["exercise_name"])
            key = (taxonomy.primary_group, taxonomy.movement_pattern)
            bucket = grouped.setdefault(key, {"sessions": set(), "sets": 0, "volume": 0.0, "prs": 0})
            bucket["sessions"].add(int(row["session_id"]))
            bucket["sets"] += 1
            bucket["volume"] += _strong_volume_from_row(row)
            if int(row["id"]) in pr_ids:
                bucket["prs"] += 1
        return [
            StrongGroupBalance(
                group=group,
                movement_pattern=movement,
                sessions=len(values["sessions"]),
                working_sets=int(values["sets"]),
                total_volume=float(values["volume"]),
                estimated_1rm_prs=int(values["prs"]),
            )
            for (group, movement), values in sorted(grouped.items(), key=lambda item: item[1]["volume"], reverse=True)
        ]

    def _strong_nutrition_training_days(
        self,
        sessions: list[StrongSessionRecord],
        working_rows: list[sqlite3.Row],
        pr_rows: list[sqlite3.Row],
        nutrition_by_date: dict[date, DailySummary],
    ) -> list[StrongNutritionTrainingDay]:
        sessions_by_date: dict[date, list[StrongSessionRecord]] = {}
        for session in sessions:
            sessions_by_date.setdefault(session.workout_date, []).append(session)
        rows_by_date: dict[date, list[sqlite3.Row]] = {}
        for row in working_rows:
            day = _parse_date(row["workout_date"])
            if day is not None:
                rows_by_date.setdefault(day, []).append(row)
        prs_by_date: dict[date, int] = {}
        for row in pr_rows:
            day = _parse_date(row["workout_date"])
            if day is not None:
                prs_by_date[day] = prs_by_date.get(day, 0) + 1
        output: list[StrongNutritionTrainingDay] = []
        for day in sorted(sessions_by_date):
            nutrition = nutrition_by_date.get(day)
            prior = nutrition_by_date.get(day - _date_delta(1))
            day_rows = rows_by_date.get(day, [])
            day_sessions = sessions_by_date.get(day, [])
            output.append(
                StrongNutritionTrainingDay(
                    date=day,
                    session_volume=sum(_strong_volume_from_row(row) for row in day_rows),
                    working_sets=len(day_rows),
                    duration_seconds=sum(session.duration_seconds or 0 for session in day_sessions),
                    pr_count=prs_by_date.get(day, 0),
                    calories=nutrition.calories if nutrition else None,
                    protein=nutrition.protein if nutrition else None,
                    carbohydrates=nutrition.carbohydrates if nutrition else None,
                    fat=nutrition.fat if nutrition else None,
                    weight=nutrition.weight if nutrition else None,
                    active_energy=nutrition.active_energy if nutrition else None,
                    prior_calories=prior.calories if prior else None,
                    prior_protein=prior.protein if prior else None,
                    prior_carbohydrates=prior.carbohydrates if prior else None,
                    prior_fat=prior.fat if prior else None,
                    prior_weight=prior.weight if prior else None,
                    prior_active_energy=prior.active_energy if prior else None,
                )
            )
        return output

    def _strong_nutrition_correlations(self, days: list[StrongNutritionTrainingDay]) -> list[StrongNutritionCorrelation]:
        output: list[StrongNutritionCorrelation] = []
        nutrients = ("calories", "protein", "carbohydrates", "fat", "weight", "active_energy")
        drivers = ("session_volume", "working_sets", "duration_seconds")
        for nutrient in nutrients:
            for timing, attr in (("same_day", nutrient), ("prior_day", f"prior_{nutrient}")):
                values = [getattr(day, attr) for day in days]
                pr_values = [value for day, value in zip(days, values) if value is not None and day.pr_count > 0]
                non_pr_values = [value for day, value in zip(days, values) if value is not None and day.pr_count == 0]
                for driver in drivers:
                    pairs = [
                        (float(getattr(day, driver)), float(value))
                        for day, value in zip(days, values)
                        if value is not None and getattr(day, driver) is not None
                    ]
                    output.append(
                        StrongNutritionCorrelation(
                            nutrient=nutrient,
                            driver=driver,
                            timing=timing,
                            sample_count=len(pairs),
                            correlation=_pearson(pairs),
                            average_on_pr_days=_avg(pr_values),
                            average_on_non_pr_training_days=_avg(non_pr_values),
                        )
                    )
        return output

    def _strong_recovery_load_markers(
        self,
        weekly_load: list[StrongWeeklyLoad],
        training_days: list[StrongNutritionTrainingDay],
        nutrition: StrongNutritionComparison,
    ) -> StrongRecoveryLoadMarkers:
        volumes = [week.total_volume for week in weekly_load if week.total_volume > 0]
        avg_volume = sum(volumes) / len(volumes) if volumes else 0
        high_volume_weeks = [
            StrongHighVolumeWeek(
                week_start=week.week_start,
                total_volume=week.total_volume,
                session_count=week.session_count,
                working_set_count=week.working_set_count,
            )
            for week in weekly_load
            if avg_volume and week.total_volume >= avg_volume * 1.25
        ]
        protein_values = [day.protein for day in training_days if day.protein is not None]
        avg_training_protein = sum(protein_values) / len(protein_values) if protein_values else None
        low_protein_training_days = [
            StrongLowProteinTrainingDay(
                date=day.date,
                protein=day.protein,
                session_volume=day.session_volume,
                working_sets=day.working_sets,
            )
            for day in training_days
            if avg_training_protein is not None and day.protein is not None and day.protein < avg_training_protein * 0.8
        ]
        deltas = [
            _training_rest_delta("calories", nutrition.training_avg_calories, nutrition.rest_avg_calories),
            _training_rest_delta("protein", nutrition.training_avg_protein, nutrition.rest_avg_protein),
            _training_rest_delta("weight", nutrition.training_avg_weight, nutrition.rest_avg_weight),
            _training_rest_delta("active_energy", nutrition.training_avg_active_energy, nutrition.rest_avg_active_energy),
        ]
        return StrongRecoveryLoadMarkers(
            high_volume_weeks=high_volume_weeks,
            low_protein_training_days=low_protein_training_days,
            training_rest_deltas=deltas,
        )

    def _strong_exercise_summaries(self, working_rows: list[sqlite3.Row]) -> list[StrongExerciseSummary]:
        grouped: dict[str, list[sqlite3.Row]] = {}
        for row in working_rows:
            grouped.setdefault(row["exercise_name"], []).append(row)
        summaries: list[StrongExerciseSummary] = []
        for exercise, rows in grouped.items():
            ordered = sorted(rows, key=lambda row: (row["workout_date"], row["id"]))
            first_best = max((_strong_estimated_1rm_from_row(row) or 0 for row in ordered[: max(1, min(5, len(ordered)))]), default=0)
            recent_best = max((_strong_estimated_1rm_from_row(row) or 0 for row in ordered[-5:]), default=0)
            summaries.append(
                StrongExerciseSummary(
                    exercise_name=exercise,
                    sessions=len({int(row["session_id"]) for row in rows}),
                    working_sets=len(rows),
                    total_volume=sum(_strong_volume_from_row(row) for row in rows),
                    best_weight=max((float(row["weight"]) for row in rows if row["weight"] is not None), default=None),
                    best_reps=max((float(row["reps"]) for row in rows if row["reps"] is not None), default=None),
                    best_estimated_1rm=max((_strong_estimated_1rm_from_row(row) or 0 for row in rows), default=0) or None,
                    last_performed=max((_parse_date(row["workout_date"]) for row in rows if _parse_date(row["workout_date"]) is not None), default=None),
                    recent_estimated_1rm=recent_best or None,
                    estimated_1rm_delta=(recent_best - first_best) if recent_best and first_best else None,
                )
            )
        return sorted(summaries, key=lambda item: (item.last_performed or date.min, item.total_volume), reverse=True)

    def _strong_nutrition_comparison(self, start: date | None, end: date | None, session_dates: set[date]) -> StrongNutritionComparison:
        days = self._daily_summary_items(start, end, include_hidden=True)
        training_days = [day for day in days if day.date in session_dates]
        rest_days = [day for day in days if day.date not in session_dates]
        return StrongNutritionComparison(
            training_day_count=len(training_days),
            rest_day_count=len(rest_days),
            training_avg_calories=_avg([day.calories for day in training_days]),
            rest_avg_calories=_avg([day.calories for day in rest_days]),
            training_avg_protein=_avg([day.protein for day in training_days]),
            rest_avg_protein=_avg([day.protein for day in rest_days]),
            training_avg_weight=_avg([day.weight for day in training_days]),
            rest_avg_weight=_avg([day.weight for day in rest_days]),
            training_avg_active_energy=_avg([day.active_energy for day in training_days]),
            rest_avg_active_energy=_avg([day.active_energy for day in rest_days]),
        )

    def _strong_recent_prs(self, working_rows: list[sqlite3.Row]) -> list[StrongRecentPr]:
        pr_rows = self._strong_pr_rows(working_rows)
        return [
            StrongRecentPr(
                date=day,
                exercise_name=row["exercise_name"],
                weight=row["weight"],
                reps=row["reps"],
                estimated_1rm=_strong_estimated_1rm_from_row(row),
            )
            for row in pr_rows[-10:][::-1]
            for day in [_parse_date(row["workout_date"])]
            if day is not None
        ]

    def _strong_pr_rows(self, working_rows: list[sqlite3.Row]) -> list[sqlite3.Row]:
        best_by_exercise: dict[str, float] = {}
        prs: list[sqlite3.Row] = []
        for row in sorted(working_rows, key=lambda item: (item["workout_date"], item["id"])):
            estimate = _strong_estimated_1rm_from_row(row)
            if estimate is None:
                continue
            exercise = row["exercise_name"]
            previous = best_by_exercise.get(exercise)
            if previous is None or estimate > previous + 0.01:
                best_by_exercise[exercise] = estimate
                prs.append(row)
        return prs

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
                CREATE TABLE IF NOT EXISTS strong_imports (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT NOT NULL,
                    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    payload_hash TEXT NOT NULL UNIQUE,
                    nutrition_start_date TEXT,
                    rows_seen INTEGER NOT NULL DEFAULT 0,
                    rows_imported INTEGER NOT NULL DEFAULT 0,
                    rows_ignored_before_nutrition INTEGER NOT NULL DEFAULT 0,
                    sessions_inserted INTEGER NOT NULL DEFAULT 0,
                    sets_inserted INTEGER NOT NULL DEFAULT 0,
                    duplicate_sets INTEGER NOT NULL DEFAULT 0,
                    errors_json TEXT NOT NULL DEFAULT '[]'
                );
                CREATE TABLE IF NOT EXISTS strong_workout_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    import_id INTEGER NOT NULL REFERENCES strong_imports(id),
                    workout_date TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    workout_name TEXT NOT NULL,
                    duration_seconds INTEGER,
                    workout_notes TEXT,
                    fingerprint TEXT NOT NULL UNIQUE
                );
                CREATE TABLE IF NOT EXISTS strong_workout_sets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    import_id INTEGER NOT NULL REFERENCES strong_imports(id),
                    session_id INTEGER NOT NULL REFERENCES strong_workout_sessions(id),
                    workout_date TEXT NOT NULL,
                    exercise_name TEXT NOT NULL,
                    set_order TEXT NOT NULL,
                    is_warmup INTEGER NOT NULL DEFAULT 0,
                    weight REAL,
                    reps REAL,
                    distance REAL,
                    seconds REAL,
                    notes TEXT,
                    rpe REAL,
                    raw_json TEXT NOT NULL,
                    fingerprint TEXT NOT NULL UNIQUE
                );
                CREATE TABLE IF NOT EXISTS dashboard_preferences (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    preferences_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS cut_phases (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    start_date TEXT NOT NULL,
                    end_date TEXT,
                    target_weight_kg REAL,
                    target_calories INTEGER,
                    notes TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS daily_logs (
                    log_date TEXT PRIMARY KEY,
                    cut_phase TEXT,
                    week_number INTEGER,
                    training_type TEXT,
                    gym_done INTEGER,
                    gym_minutes INTEGER,
                    gym_rpe REAL,
                    gym_notes TEXT,
                    cardio_type TEXT,
                    cardio_minutes INTEGER,
                    cardio_avg_hr INTEGER,
                    vyvanse_taken INTEGER,
                    vyvanse_time TEXT,
                    dex_booster_taken INTEGER,
                    dex_time TEXT,
                    sleep_hours REAL,
                    sleep_quality INTEGER,
                    sleep_score INTEGER,
                    am_energy INTEGER,
                    pm_energy INTEGER,
                    motivation INTEGER,
                    hunger INTEGER,
                    mood INTEGER,
                    stress INTEGER,
                    soreness INTEGER,
                    digestion INTEGER,
                    rhr INTEGER,
                    hrv_overnight INTEGER,
                    water_litres REAL,
                    notes TEXT,
                    weight_kg REAL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    is_refeed INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS body_measurements (
                    measure_date TEXT PRIMARY KEY,
                    waist_cm REAL,
                    chest_cm REAL,
                    l_arm_cm REAL,
                    r_arm_cm REAL,
                    l_thigh_cm REAL,
                    r_thigh_cm REAL,
                    hip_cm REAL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS progress_photos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    photo_date TEXT NOT NULL,
                    pose TEXT NOT NULL CHECK (pose IN ('front', 'side')),
                    size_bytes INTEGER NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (photo_date, pose)
                );
                CREATE TABLE IF NOT EXISTS push_subscriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    endpoint TEXT NOT NULL UNIQUE,
                    p256dh TEXT NOT NULL,
                    auth TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS weekly_recaps (
                    week_start_date TEXT PRIMARY KEY,
                    narrative TEXT NOT NULL,
                    highlights_json TEXT NOT NULL DEFAULT '[]',
                    model TEXT NOT NULL,
                    tokens_used INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS coach_conversations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    title TEXT NOT NULL,
                    framing TEXT,
                    for_date TEXT,
                    archived INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS coach_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id INTEGER NOT NULL REFERENCES coach_conversations(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK(role IN ('system','user','assistant')),
                    content TEXT NOT NULL,
                    tokens_used INTEGER,
                    model TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_coach_msgs_conv ON coach_messages(conversation_id, id);
                CREATE INDEX IF NOT EXISTS idx_health_records_date_metric_source
                    ON health_records (record_date, metric_name, source);
                CREATE INDEX IF NOT EXISTS idx_strong_sessions_date
                    ON strong_workout_sessions (workout_date, started_at);
                CREATE INDEX IF NOT EXISTS idx_strong_sets_exercise_date
                    ON strong_workout_sets (exercise_name, workout_date);

                CREATE TABLE IF NOT EXISTS activities (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source TEXT NOT NULL CHECK (source IN ('garmin', 'manual')),
                    garmin_activity_id INTEGER UNIQUE,
                    sport TEXT NOT NULL,
                    activity_date TEXT NOT NULL,
                    start_time TEXT,
                    duration_seconds REAL,
                    distance_m REAL,
                    calories REAL,
                    avg_hr REAL,
                    max_hr REAL,
                    aerobic_te REAL,
                    anaerobic_te REAL,
                    training_load REAL,
                    load_source TEXT,
                    rpe REAL,
                    perceived_intensity TEXT,
                    pool_length_m REAL,
                    laps INTEGER,
                    total_strokes INTEGER,
                    avg_swolf REAL,
                    avg_pace_s_per_100m REAL,
                    stroke_type TEXT,
                    hr_zones_json TEXT,
                    laps_json TEXT,
                    notes TEXT,
                    raw_json TEXT NOT NULL DEFAULT '{}',
                    fingerprint TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_activities_date ON activities (activity_date, start_time);
                CREATE INDEX IF NOT EXISTS idx_activities_sport ON activities (sport, activity_date);

                CREATE TABLE IF NOT EXISTS performance_goals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    goal_type TEXT NOT NULL,
                    sport TEXT,
                    target_value REAL,
                    unit TEXT,
                    target_date TEXT,
                    active INTEGER NOT NULL DEFAULT 1,
                    notes TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS daily_training_recommendations (
                    rec_date TEXT PRIMARY KEY,
                    recommendation TEXT NOT NULL,
                    model TEXT NOT NULL,
                    tokens_used INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS performance_weekly_reviews (
                    week_start_date TEXT PRIMARY KEY,
                    narrative TEXT NOT NULL,
                    highlights_json TEXT NOT NULL DEFAULT '[]',
                    model TEXT NOT NULL,
                    tokens_used INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            # Migrations for existing DBs
            dl_cols = {c["name"] for c in conn.execute("PRAGMA table_info(daily_logs)").fetchall()}
            if "weight_kg" not in dl_cols:
                conn.execute("ALTER TABLE daily_logs ADD COLUMN weight_kg REAL")
            if "is_refeed" not in dl_cols:
                conn.execute("ALTER TABLE daily_logs ADD COLUMN is_refeed INTEGER NOT NULL DEFAULT 0")
            recap_cols = {c["name"] for c in conn.execute("PRAGMA table_info(weekly_recaps)").fetchall()}
            if not recap_cols:
                pass  # table created fresh above
            bm_cols = {c["name"] for c in conn.execute("PRAGMA table_info(body_measurements)").fetchall()}
            if "body_fat_percent" not in bm_cols:
                conn.execute("ALTER TABLE body_measurements ADD COLUMN body_fat_percent REAL")
        self._initialized = True

    # ─── Garmin metric upsert ────────────────────────────────────────────────

    def upsert_garmin_metric(self, metric_name: str, units: str, record_date: str, quantity: float) -> bool:
        """Insert or update a single Garmin-sourced metric for a date. Returns True if value changed."""
        self._ensure_schema()
        source = "Garmin"
        fingerprint = _fingerprint("garmin_v1", metric_name, record_date, source)
        with self._connect() as conn:
            existing = conn.execute(
                "SELECT id, quantity FROM health_records WHERE fingerprint = ?",
                (fingerprint,),
            ).fetchone()
            if existing:
                if abs(float(existing["quantity"]) - quantity) > 0.001:
                    conn.execute(
                        "UPDATE health_records SET quantity = ? WHERE fingerprint = ?",
                        (quantity, fingerprint),
                    )
                    return True
                return False
            # Need a synthetic batch — create or reuse a "garmin" batch keyed to the date
            batch_key = _fingerprint("garmin_batch", record_date)
            conn.execute(
                "INSERT OR IGNORE INTO ingest_batches (payload_hash, headers_json, payload_json) VALUES (?, '{}', ?)",
                (batch_key, f'{{"garmin_date":"{record_date}"}}'  ),
            )
            batch_row = conn.execute(
                "SELECT id FROM ingest_batches WHERE payload_hash = ?", (batch_key,)
            ).fetchone()
            batch_id = int(batch_row["id"])
            conn.execute(
                """
                INSERT INTO health_records
                    (batch_id, metric_name, units, record_date, quantity, source, raw_json, fingerprint)
                VALUES (?, ?, ?, ?, ?, ?, '{}', ?)
                """,
                (batch_id, metric_name, units, record_date, quantity, source, fingerprint),
            )
            return True

    # ─── Cut phases ──────────────────────────────────────────────────────────

    def get_cut_phases(self) -> list[dict]:
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM cut_phases ORDER BY start_date DESC"
            ).fetchall()
            return [dict(r) for r in rows]

    def get_active_cut_phase(self) -> dict | None:
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM cut_phases WHERE end_date IS NULL ORDER BY start_date DESC LIMIT 1"
            ).fetchone()
            return dict(row) if row else None

    def create_cut_phase(self, name: str, start_date: str, end_date: str | None,
                         target_weight_kg: float | None, target_calories: int | None, notes: str | None) -> dict:
        self._ensure_schema()
        with self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO cut_phases (name, start_date, end_date, target_weight_kg, target_calories, notes)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (name, start_date, end_date, target_weight_kg, target_calories, notes),
            )
            row = conn.execute("SELECT * FROM cut_phases WHERE id = ?", (cursor.lastrowid,)).fetchone()
            return dict(row)

    def update_cut_phase(self, phase_id: int, **kwargs: object) -> dict | None:
        self._ensure_schema()
        allowed = {"name", "start_date", "end_date", "target_weight_kg", "target_calories", "notes"}
        fields = {k: v for k, v in kwargs.items() if k in allowed}
        if not fields:
            with self._connect() as conn:
                row = conn.execute("SELECT * FROM cut_phases WHERE id = ?", (phase_id,)).fetchone()
                return dict(row) if row else None
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        with self._connect() as conn:
            conn.execute(
                f"UPDATE cut_phases SET {set_clause} WHERE id = ?",
                (*fields.values(), phase_id),
            )
            row = conn.execute("SELECT * FROM cut_phases WHERE id = ?", (phase_id,)).fetchone()
            return dict(row) if row else None

    def _derive_week_number(self, log_date: str) -> int | None:
        phase = self.get_active_cut_phase()
        if not phase:
            return None
        start = _parse_date(phase["start_date"])
        d = _parse_date(log_date)
        if not start or not d:
            return None
        delta = (d - start).days
        return max(1, delta // 7 + 1)

    # ─── Daily logs ──────────────────────────────────────────────────────────

    def get_daily_log(self, log_date: str) -> dict | None:
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM daily_logs WHERE log_date = ?", (log_date,)).fetchone()
            return dict(row) if row else None

    def get_daily_logs(self, start: date | None, end: date | None) -> list[dict]:
        self._ensure_schema()
        _validate_range(start, end)
        conditions: list[str] = []
        params: list[object] = []
        if start:
            conditions.append("log_date >= ?")
            params.append(start.isoformat())
        if end:
            conditions.append("log_date <= ?")
            params.append(end.isoformat())
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        with self._connect() as conn:
            rows = conn.execute(f"SELECT * FROM daily_logs {where} ORDER BY log_date DESC", params).fetchall()
            return [dict(r) for r in rows]

    def upsert_daily_log(self, log_date: str, fields: dict) -> dict:
        self._ensure_schema()
        allowed = {
            "cut_phase", "week_number", "training_type", "gym_done", "gym_minutes", "gym_rpe",
            "gym_notes", "cardio_type", "cardio_minutes", "cardio_avg_hr", "vyvanse_taken",
            "vyvanse_time", "dex_booster_taken", "dex_time", "sleep_hours", "sleep_quality",
            "sleep_score", "am_energy", "pm_energy", "motivation", "hunger", "mood", "stress",
            "soreness", "digestion", "rhr", "hrv_overnight", "water_litres", "notes", "weight_kg",
        }
        clean = {k: v for k, v in fields.items() if k in allowed}

        # Auto-derive cut_phase + week_number if not provided
        if "cut_phase" not in clean or "week_number" not in clean:
            phase = self.get_active_cut_phase()
            if phase:
                if "cut_phase" not in clean:
                    clean["cut_phase"] = phase["name"]
                if "week_number" not in clean:
                    week = self._derive_week_number(log_date)
                    if week is not None:
                        clean["week_number"] = week

        with self._connect() as conn:
            existing = conn.execute("SELECT * FROM daily_logs WHERE log_date = ?", (log_date,)).fetchone()
            if existing:
                # Merge: only update provided fields
                if clean:
                    set_clause = ", ".join(f"{k} = ?" for k in clean) + ", updated_at = CURRENT_TIMESTAMP"
                    conn.execute(
                        f"UPDATE daily_logs SET {set_clause} WHERE log_date = ?",
                        (*clean.values(), log_date),
                    )
            else:
                cols = ["log_date"] + list(clean.keys())
                placeholders = ", ".join("?" for _ in cols)
                conn.execute(
                    f"INSERT INTO daily_logs ({', '.join(cols)}) VALUES ({placeholders})",
                    (log_date, *clean.values()),
                )
            row = conn.execute("SELECT * FROM daily_logs WHERE log_date = ?", (log_date,)).fetchone()
            return dict(row)

    # ─── Body measurements ───────────────────────────────────────────────────

    def get_measurement(self, measure_date: str) -> dict | None:
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM body_measurements WHERE measure_date = ?", (measure_date,)).fetchone()
            return dict(row) if row else None

    def get_measurements(self, start: date | None, end: date | None) -> list[dict]:
        self._ensure_schema()
        _validate_range(start, end)
        conditions: list[str] = []
        params: list[object] = []
        if start:
            conditions.append("measure_date >= ?")
            params.append(start.isoformat())
        if end:
            conditions.append("measure_date <= ?")
            params.append(end.isoformat())
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        with self._connect() as conn:
            rows = conn.execute(f"SELECT * FROM body_measurements {where} ORDER BY measure_date DESC", params).fetchall()
            return [dict(r) for r in rows]

    def upsert_measurement(self, measure_date: str, fields: dict) -> dict:
        self._ensure_schema()
        allowed = {"waist_cm", "chest_cm", "l_arm_cm", "r_arm_cm", "l_thigh_cm", "r_thigh_cm", "hip_cm", "body_fat_percent"}
        clean = {k: v for k, v in fields.items() if k in allowed}
        with self._connect() as conn:
            existing = conn.execute("SELECT * FROM body_measurements WHERE measure_date = ?", (measure_date,)).fetchone()
            if existing:
                if clean:
                    set_clause = ", ".join(f"{k} = ?" for k in clean) + ", updated_at = CURRENT_TIMESTAMP"
                    conn.execute(
                        f"UPDATE body_measurements SET {set_clause} WHERE measure_date = ?",
                        (*clean.values(), measure_date),
                    )
            else:
                cols = ["measure_date"] + list(clean.keys())
                placeholders = ", ".join("?" for _ in cols)
                conn.execute(
                    f"INSERT INTO body_measurements ({', '.join(cols)}) VALUES ({placeholders})",
                    (measure_date, *clean.values()),
                )
            row = conn.execute("SELECT * FROM body_measurements WHERE measure_date = ?", (measure_date,)).fetchone()
            return dict(row)

    # ─── Coach conversations ──────────────────────────────────────────────────

    def create_coach_conversation(self, title: str, framing: str | None, for_date: str | None) -> dict:
        self._ensure_schema()
        import datetime as _dt
        now = _dt.datetime.utcnow().isoformat()
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO coach_conversations (created_at, updated_at, title, framing, for_date) VALUES (?, ?, ?, ?, ?)",
                (now, now, title, framing, for_date),
            )
            row = conn.execute("SELECT * FROM coach_conversations WHERE id = ?", (cur.lastrowid,)).fetchone()
            return dict(row)

    def list_coach_conversations(self) -> list[dict]:
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM coach_conversations WHERE archived = 0 ORDER BY updated_at DESC"
            ).fetchall()
            return [dict(r) for r in rows]

    def get_coach_conversation(self, conv_id: int) -> dict | None:
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM coach_conversations WHERE id = ?", (conv_id,)).fetchone()
            if not row:
                return None
            conv = dict(row)
            msgs = conn.execute(
                "SELECT * FROM coach_messages WHERE conversation_id = ? ORDER BY id",
                (conv_id,),
            ).fetchall()
            conv["messages"] = [dict(m) for m in msgs]
            return conv

    def archive_coach_conversation(self, conv_id: int) -> bool:
        self._ensure_schema()
        with self._connect() as conn:
            conn.execute("UPDATE coach_conversations SET archived = 1 WHERE id = ?", (conv_id,))
            return conn.execute("SELECT changes()").fetchone()[0] > 0

    def add_coach_message(
        self,
        conv_id: int,
        role: str,
        content: str,
        tokens_used: int | None = None,
        model: str | None = None,
    ) -> dict:
        self._ensure_schema()
        import datetime as _dt
        now = _dt.datetime.utcnow().isoformat()
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO coach_messages (conversation_id, role, content, tokens_used, model, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (conv_id, role, content, tokens_used, model, now),
            )
            conn.execute(
                "UPDATE coach_conversations SET updated_at = ? WHERE id = ?",
                (now, conv_id),
            )
            row = conn.execute("SELECT * FROM coach_messages WHERE id = ?", (cur.lastrowid,)).fetchone()
            return dict(row)

    def get_coach_messages(self, conv_id: int) -> list[dict]:
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM coach_messages WHERE conversation_id = ? ORDER BY id",
                (conv_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    # ─── Body composition ─────────────────────────────────────────────────────

    def get_body_composition(self, start: "date", end: "date") -> list[dict]:
        """Return per-day body composition data with interpolated BF% where missing."""
        from datetime import timedelta as _td
        self._ensure_schema()
        # Load weight data from daily_summary
        summaries = self.dashboard_summary(start, end).summaries
        weight_by_date: dict[str, float | None] = {s.date.isoformat(): s.weight for s in summaries}

        # Load BF% measurements
        meas_rows = self.get_measurements(start - _td(days=60), end + _td(days=60))
        bf_by_date: dict[str, float] = {
            r["measure_date"]: float(r["body_fat_percent"])
            for r in meas_rows
            if r.get("body_fat_percent") is not None
        }

        # Collect all dates in range
        result: list[dict] = []
        cur = start
        all_bf_dates = sorted(bf_by_date.keys())

        while cur <= end:
            d = cur.isoformat()
            weight = weight_by_date.get(d)
            bf_pct: float | None = None
            source = "none"

            if d in bf_by_date:
                bf_pct = bf_by_date[d]
                source = "measured"
            elif all_bf_dates:
                # Linear interpolation between nearest measurements
                prev_dates = [x for x in all_bf_dates if x <= d]
                next_dates = [x for x in all_bf_dates if x > d]
                if prev_dates and next_dates:
                    p, n = prev_dates[-1], next_dates[0]
                    from datetime import date as _date
                    p_date = _date.fromisoformat(p)
                    n_date = _date.fromisoformat(n)
                    span = (n_date - p_date).days
                    if span > 0:
                        frac = (cur - p_date).days / span
                        bf_pct = bf_by_date[p] + frac * (bf_by_date[n] - bf_by_date[p])
                        source = "interpolated"
                elif prev_dates:
                    bf_pct = bf_by_date[prev_dates[-1]]
                    source = "carried_forward"

            lean_kg: float | None = None
            fat_kg: float | None = None
            if weight is not None and bf_pct is not None:
                fat_kg = round(weight * bf_pct / 100, 2)
                lean_kg = round(weight - fat_kg, 2)

            result.append({
                "date": d,
                "weight_kg": weight,
                "body_fat_percent": round(bf_pct, 2) if bf_pct is not None else None,
                "lean_kg": lean_kg,
                "fat_kg": fat_kg,
                "source": source,
            })
            cur += _td(days=1)

        return result

    # ─── Progress photos ─────────────────────────────────────────────────────

    def record_photo(self, photo_date: str, pose: str, size_bytes: int) -> None:
        self._ensure_schema()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO progress_photos (photo_date, pose, size_bytes)
                VALUES (?, ?, ?)
                ON CONFLICT (photo_date, pose) DO UPDATE SET size_bytes = excluded.size_bytes, created_at = CURRENT_TIMESTAMP
                """,
                (photo_date, pose, size_bytes),
            )

    def list_photos(self) -> list[dict]:
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute(
                """SELECT p.photo_date, p.pose, p.size_bytes, p.created_at, d.weight_kg
                   FROM progress_photos p
                   LEFT JOIN daily_logs d ON d.log_date = p.photo_date
                   ORDER BY p.photo_date DESC, p.pose"""
            ).fetchall()
            return [dict(r) for r in rows]

    def delete_photo_record(self, photo_date: str, pose: str) -> bool:
        self._ensure_schema()
        with self._connect() as conn:
            cursor = conn.execute(
                "DELETE FROM progress_photos WHERE photo_date = ? AND pose = ?",
                (photo_date, pose),
            )
            return cursor.rowcount > 0

    # ─── Push subscriptions ──────────────────────────────────────────────────

    def upsert_push_subscription(self, endpoint: str, p256dh: str, auth: str) -> None:
        self._ensure_schema()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO push_subscriptions (endpoint, p256dh, auth)
                VALUES (?, ?, ?)
                ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
                """,
                (endpoint, p256dh, auth),
            )

    def delete_push_subscription(self, endpoint: str) -> bool:
        self._ensure_schema()
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
            return cursor.rowcount > 0

    def delete_push_subscription_by_id(self, sub_id: int) -> None:
        self._ensure_schema()
        with self._connect() as conn:
            conn.execute("DELETE FROM push_subscriptions WHERE id = ?", (sub_id,))

    def get_push_subscriptions(self) -> list[dict]:
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute("SELECT id, endpoint, p256dh, auth FROM push_subscriptions").fetchall()
            return [dict(r) for r in rows]

    # ─── Weekly recaps ───────────────────────────────────────────────────────

    def upsert_weekly_recap(self, week_start_date: str, narrative: str, highlights: list, model: str, tokens_used: int) -> None:
        self._ensure_schema()
        highlights_json = json.dumps(highlights)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO weekly_recaps (week_start_date, narrative, highlights_json, model, tokens_used, created_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(week_start_date) DO UPDATE SET
                    narrative = excluded.narrative,
                    highlights_json = excluded.highlights_json,
                    model = excluded.model,
                    tokens_used = excluded.tokens_used,
                    created_at = excluded.created_at
                """,
                (week_start_date, narrative, highlights_json, model, tokens_used),
            )

    def get_weekly_recap(self, week_start_date: str) -> dict | None:
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT week_start_date, narrative, highlights_json, model, tokens_used, created_at FROM weekly_recaps WHERE week_start_date = ?",
                (week_start_date,),
            ).fetchone()
            if not row:
                return None
            r = dict(row)
            r["highlights"] = json.loads(r.pop("highlights_json", "[]"))
            return r

    def list_weekly_recaps(self, limit: int = 52) -> list[dict]:
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT week_start_date, narrative, highlights_json, model, tokens_used, created_at FROM weekly_recaps ORDER BY week_start_date DESC LIMIT ?",
                (limit,),
            ).fetchall()
            result = []
            for row in rows:
                r = dict(row)
                r["highlights"] = json.loads(r.pop("highlights_json", "[]"))
                result.append(r)
            return result

    # ─── Activities ──────────────────────────────────────────────────────────

    def upsert_garmin_activity(self, payload: dict) -> bool:
        from macrofactor_scraper._activities import upsert_garmin_activity as _upsert
        self._ensure_schema()
        with self._connect() as conn:
            return _upsert(conn, payload)

    def get_activity_by_garmin_id(self, garmin_activity_id: int) -> dict | None:
        from macrofactor_scraper._activities import get_activity_by_garmin_id as _get
        self._ensure_schema()
        with self._connect() as conn:
            return _get(conn, garmin_activity_id)

    def list_activities(self, start: str, end: str, sport: str | None = None, limit: int = 200) -> list[dict]:
        from macrofactor_scraper._activities import list_activities as _list
        self._ensure_schema()
        with self._connect() as conn:
            return _list(conn, start, end, sport, limit)

    def get_activity(self, activity_id: int) -> dict | None:
        from macrofactor_scraper._activities import get_activity as _get
        self._ensure_schema()
        with self._connect() as conn:
            return _get(conn, activity_id)

    def create_manual_activity(self, payload: dict) -> dict:
        from macrofactor_scraper._activities import create_manual_activity as _create
        self._ensure_schema()
        with self._connect() as conn:
            return _create(conn, payload)

    def update_manual_activity(self, activity_id: int, payload: dict) -> dict | None:
        from macrofactor_scraper._activities import update_manual_activity as _update
        self._ensure_schema()
        with self._connect() as conn:
            return _update(conn, activity_id, payload)

    def delete_activity(self, activity_id: int, force: bool = False) -> bool:
        from macrofactor_scraper._activities import delete_activity as _delete
        self._ensure_schema()
        with self._connect() as conn:
            return _delete(conn, activity_id, force)

    # ─── Performance goals ────────────────────────────────────────────────────

    def list_goals(self, active_only: bool = True) -> list[dict]:
        from macrofactor_scraper._activities import list_goals as _list
        self._ensure_schema()
        with self._connect() as conn:
            return _list(conn, active_only)

    def create_goal(self, payload: dict) -> dict:
        from macrofactor_scraper._activities import create_goal as _create
        self._ensure_schema()
        with self._connect() as conn:
            return _create(conn, payload)

    def update_goal(self, goal_id: int, payload: dict) -> dict | None:
        from macrofactor_scraper._activities import update_goal as _update
        self._ensure_schema()
        with self._connect() as conn:
            return _update(conn, goal_id, payload)

    def delete_goal(self, goal_id: int) -> bool:
        from macrofactor_scraper._activities import delete_goal as _delete
        self._ensure_schema()
        with self._connect() as conn:
            return _delete(conn, goal_id)

    # ─── Training recommendations ─────────────────────────────────────────────

    def get_training_recommendation(self, rec_date: str) -> dict | None:
        from macrofactor_scraper._activities import get_training_recommendation as _get
        self._ensure_schema()
        with self._connect() as conn:
            return _get(conn, rec_date)

    def upsert_training_recommendation(self, rec_date: str, recommendation: str, model: str, tokens_used: int) -> None:
        from macrofactor_scraper._activities import upsert_training_recommendation as _upsert
        self._ensure_schema()
        with self._connect() as conn:
            _upsert(conn, rec_date, recommendation, model, tokens_used)

    # ─── Performance weekly reviews ───────────────────────────────────────────

    def get_performance_review(self, week_start_date: str) -> dict | None:
        from macrofactor_scraper._activities import get_performance_review as _get
        self._ensure_schema()
        with self._connect() as conn:
            return _get(conn, week_start_date)

    def upsert_performance_review(self, week_start_date: str, narrative: str, highlights: list, model: str, tokens_used: int) -> None:
        from macrofactor_scraper._activities import upsert_performance_review as _upsert
        self._ensure_schema()
        with self._connect() as conn:
            _upsert(conn, week_start_date, narrative, highlights, model, tokens_used)

    def list_performance_reviews(self, limit: int = 52) -> list[dict]:
        from macrofactor_scraper._activities import list_performance_reviews as _list
        self._ensure_schema()
        with self._connect() as conn:
            return _list(conn, limit)

    # ─── Internal helpers ────────────────────────────────────────────────────

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
            metric.units,
            metric.record_date.isoformat() if metric.record_date else None,
            metric.timestamp.isoformat() if metric.timestamp else None,
            metric.quantity,
            metric.source,
        )
        legacy_fingerprint = _fingerprint(
            "metric",
            metric.name,
            metric.record_date.isoformat() if metric.record_date else None,
            metric.timestamp.isoformat() if metric.timestamp else None,
            metric.quantity,
            metric.raw,
        )
        if conn.execute(
            "SELECT 1 FROM health_records WHERE fingerprint IN (?, ?) LIMIT 1",
            (fingerprint, legacy_fingerprint),
        ).fetchone():
            return 0
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


