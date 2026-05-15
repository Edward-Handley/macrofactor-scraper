"""Private row-to-model converters — import via HealthAutoExportService, not directly."""
from __future__ import annotations

import json
import sqlite3

from macrofactor_scraper._utils import _parse_date, _parse_datetime
from macrofactor_scraper.models import MetricRecord, WorkoutRecord


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
