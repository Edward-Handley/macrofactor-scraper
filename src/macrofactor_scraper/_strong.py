"""Private Strong-CSV parsing helpers and dataclass — import via HealthAutoExportService."""
from __future__ import annotations

import csv
import io
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from macrofactor_scraper._utils import (
    _blank_to_none,
    _float_or_none,
    _fingerprint,
    _parse_date,
    _parse_datetime,
)
from macrofactor_scraper.models import (
    StrongExerciseTaxonomy,
    StrongSessionRecord,
    StrongSetRecord,
)

STRONG_REQUIRED_COLUMNS: frozenset[str] = frozenset({
    "Date",
    "Workout Name",
    "Duration",
    "Exercise Name",
    "Set Order",
    "Weight",
    "Reps",
    "Distance",
    "Seconds",
    "Notes",
    "Workout Notes",
    "RPE",
})

EXERCISE_TAXONOMY_RULES: tuple[tuple[tuple[str, ...], StrongExerciseTaxonomy], ...] = (
    (("bench press", "chest press", "push up", "dip"), StrongExerciseTaxonomy(movement_pattern="Horizontal Push", primary_group="Chest", secondary_groups=["Triceps", "Shoulders"])),
    (("overhead press", "shoulder press", "military press", "arnold press"), StrongExerciseTaxonomy(movement_pattern="Vertical Push", primary_group="Shoulders", secondary_groups=["Triceps"])),
    (("lat pulldown", "pull up", "chin up"), StrongExerciseTaxonomy(movement_pattern="Vertical Pull", primary_group="Back", secondary_groups=["Biceps"])),
    (("row", "face pull", "reverse fly"), StrongExerciseTaxonomy(movement_pattern="Horizontal Pull", primary_group="Back", secondary_groups=["Biceps", "Rear Delts"])),
    (("squat", "leg press", "lunge", "split squat", "leg extension"), StrongExerciseTaxonomy(movement_pattern="Squat", primary_group="Quads", secondary_groups=["Glutes"])),
    (("deadlift", "romanian deadlift", "good morning", "hip thrust", "glute bridge"), StrongExerciseTaxonomy(movement_pattern="Hinge", primary_group="Posterior Chain", secondary_groups=["Hamstrings", "Glutes", "Back"])),
    (("leg curl", "hamstring curl"), StrongExerciseTaxonomy(movement_pattern="Knee Flexion", primary_group="Hamstrings", secondary_groups=[])),
    (("curl",), StrongExerciseTaxonomy(movement_pattern="Arm Isolation", primary_group="Biceps", secondary_groups=[])),
    (("tricep", "triceps", "skullcrusher", "pushdown"), StrongExerciseTaxonomy(movement_pattern="Arm Isolation", primary_group="Triceps", secondary_groups=[])),
    (("calf raise",), StrongExerciseTaxonomy(movement_pattern="Lower Isolation", primary_group="Calves", secondary_groups=[])),
    (("crunch", "plank", "leg raise", "sit up", "ab wheel"), StrongExerciseTaxonomy(movement_pattern="Core", primary_group="Core", secondary_groups=[])),
)


@dataclass(frozen=True)
class StrongParsedSet:
    started_at: datetime
    workout_date: date
    workout_name: str
    duration_seconds: int | None
    exercise_name: str
    set_order: str
    is_warmup: bool
    weight: float | None
    reps: float | None
    distance: float | None
    seconds: float | None
    notes: str | None
    workout_notes: str | None
    rpe: float | None
    raw: dict[str, Any]


def parse_strong_csv(content: bytes, nutrition_start: date) -> tuple[list[StrongParsedSet], int, int, list[str]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("Strong CSV must be UTF-8 encoded") from exc
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise ValueError("Strong CSV is empty")
    missing = sorted(STRONG_REQUIRED_COLUMNS - set(reader.fieldnames))
    if missing:
        raise ValueError(f"Strong CSV is missing required columns: {', '.join(missing)}")

    parsed: list[StrongParsedSet] = []
    errors: list[str] = []
    rows_seen = 0
    ignored = 0
    for row_number, row in enumerate(reader, start=2):
        rows_seen += 1
        started_at = _parse_datetime(row.get("Date"))
        if started_at is None:
            errors.append(f"Row {row_number}: invalid Date")
            continue
        workout_date = started_at.date()
        if workout_date < nutrition_start:
            ignored += 1
            continue
        exercise_name = (row.get("Exercise Name") or "").strip()
        workout_name = (row.get("Workout Name") or "Workout").strip() or "Workout"
        set_order = (row.get("Set Order") or "").strip()
        if not exercise_name or not set_order:
            errors.append(f"Row {row_number}: missing exercise or set order")
            continue
        parsed.append(
            StrongParsedSet(
                started_at=started_at,
                workout_date=workout_date,
                workout_name=workout_name,
                duration_seconds=_parse_strong_duration(row.get("Duration")),
                exercise_name=exercise_name,
                set_order=set_order,
                is_warmup=set_order.upper() == "W",
                weight=_float_or_none(row.get("Weight")),
                reps=_float_or_none(row.get("Reps")),
                distance=_float_or_none(row.get("Distance")),
                seconds=_float_or_none(row.get("Seconds")),
                notes=_blank_to_none(row.get("Notes")),
                workout_notes=_blank_to_none(row.get("Workout Notes")),
                rpe=_float_or_none(row.get("RPE")),
                raw=dict(row),
            )
        )
    return parsed, rows_seen, ignored, errors


def _strong_session_fingerprint(parsed: StrongParsedSet) -> str:
    return _fingerprint("strong-session", parsed.started_at.isoformat(), parsed.workout_name, parsed.duration_seconds)


def _strong_set_fingerprint(parsed: StrongParsedSet) -> str:
    return _fingerprint(
        "strong-set",
        parsed.started_at.isoformat(),
        parsed.workout_name,
        parsed.exercise_name,
        parsed.set_order,
        parsed.weight,
        parsed.reps,
        parsed.distance,
        parsed.seconds,
    )


def _strong_set_from_row(row: sqlite3.Row) -> StrongSetRecord:
    volume = _strong_volume_from_row(row)
    estimate = _strong_estimated_1rm_from_row(row)
    return StrongSetRecord(
        id=int(row["id"]),
        exercise_name=row["exercise_name"],
        set_order=row["set_order"],
        is_warmup=bool(row["is_warmup"]),
        weight=row["weight"],
        reps=row["reps"],
        distance=row["distance"],
        seconds=row["seconds"],
        rpe=row["rpe"],
        volume=volume if not bool(row["is_warmup"]) else None,
        estimated_1rm=estimate if not bool(row["is_warmup"]) else None,
        notes=row["notes"],
    )


def _strong_session_from_row(row: sqlite3.Row, sets: list[StrongSetRecord]) -> StrongSessionRecord:
    started_at = _parse_datetime(row["started_at"])
    workout_date = _parse_date(row["workout_date"])
    return StrongSessionRecord(
        id=int(row["id"]),
        workout_date=workout_date or date.min,
        started_at=started_at or datetime.min,
        workout_name=row["workout_name"],
        duration_seconds=row["duration_seconds"],
        workout_notes=row["workout_notes"],
        exercise_count=int(row["exercise_count"] or 0),
        working_set_count=int(row["working_set_count"] or 0),
        total_volume=float(row["total_volume"] or 0),
        sets=sets,
    )


def _strong_volume_from_row(row: sqlite3.Row) -> float:
    if row["weight"] is None or row["reps"] is None:
        return 0.0
    return float(row["weight"]) * float(row["reps"])


def _strong_estimated_1rm_from_row(row: sqlite3.Row) -> float | None:
    if row["weight"] is None or row["reps"] is None:
        return None
    weight = float(row["weight"])
    reps = float(row["reps"])
    if weight <= 0 or reps <= 0:
        return None
    return weight * (1 + reps / 30)


def classify_strong_exercise(exercise_name: str) -> StrongExerciseTaxonomy:
    normalized = exercise_name.lower()
    for needles, taxonomy in EXERCISE_TAXONOMY_RULES:
        if any(needle in normalized for needle in needles):
            return taxonomy
    return StrongExerciseTaxonomy(movement_pattern="Other", primary_group="Other", secondary_groups=[])


def _parse_strong_duration(value: str | None) -> int | None:
    if not value:
        return None
    total = 0
    for part in value.strip().split():
        if part.endswith("h"):
            hours = _float_or_none(part[:-1])
            if hours is not None:
                total += int(hours * 3600)
        elif part.endswith("m"):
            minutes = _float_or_none(part[:-1])
            if minutes is not None:
                total += int(minutes * 60)
        elif part.endswith("s"):
            seconds = _float_or_none(part[:-1])
            if seconds is not None:
                total += int(seconds)
    return total or None
