"""Private aggregation constants and helpers — import via HealthAutoExportService."""
from __future__ import annotations

import sqlite3
from datetime import time

from macrofactor_scraper._utils import _parse_datetime

SUMMARY_FIELDS = ("calories", "protein", "carbohydrates", "fat", "water", "weight", "steps", "active_energy")
REPLACEMENT_SUMMARY_KEYS: frozenset[str] = frozenset({"weight", "steps"})
RUNNING_TOTAL_SUMMARY_KEYS: frozenset[str] = frozenset({"calories", "protein", "carbohydrates", "fat", "water", "active_energy"})
SOURCE_PRIORITY: dict[str, tuple[str, ...]] = {
    "weight": ("MacroFactor",),
    "steps": ("Garmin",),
}


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
        "weight_body_mass": "weight",
        "weight": "weight",
        "step_count": "steps",
        "steps": "steps",
        "garmin_steps": "steps",
        "active_energy": "active_energy",
        "active_energy_burned": "active_energy",
    }
    return aliases.get(normalized)


def _summary_aggregation(key: str | None) -> str:
    if key in REPLACEMENT_SUMMARY_KEYS:
        return "replacement"
    return "additive"


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


def _metric_row_sort_key(row: sqlite3.Row) -> tuple[str, int]:
    return (row["timestamp"] or "", int(row["id"]))


def _latest_metric_row(rows: list[sqlite3.Row]) -> sqlite3.Row:
    return max(rows, key=_metric_row_sort_key)


def _is_midnight_summary(timestamp_text: str | None) -> bool:
    """Return True when the stored timestamp represents an explicit midnight in a known TZ.

    HAE emits daily-summary rows at midnight with a full TZ offset (e.g. "2026-05-06T00:00:00+08:00").
    Records parsed from bare date strings (e.g. "2026-05-06") store as "2026-05-06T00:00:00" with
    no tzinfo — we treat those as intraday so they're still summed across batches.
    """
    if not timestamp_text:
        return False
    ts = _parse_datetime(timestamp_text)
    if ts is None or ts.tzinfo is None:
        return False
    return ts.time() == time(0, 0, 0)


def _collapse_additive_rows(rows: list[sqlite3.Row], key: str) -> float:
    """Collapse a (date, key, source) group into a single value.

    If midnight snapshot rows exist (daily running-total from MacroFactor/HAE),
    return the LATEST snapshot's quantity only — using max(timestamp, id) so
    a corrected lower value wins over a stale higher one.
    Otherwise sum all intraday quantities.
    """
    midnight = [r for r in rows if _is_midnight_summary(r["timestamp"])]
    intraday = [r for r in rows if not _is_midnight_summary(r["timestamp"])]

    if midnight:
        best = max(midnight, key=_metric_row_sort_key)
        q = _summary_quantity(key, best["units"], float(best["quantity"]))
        return q if q is not None else 0.0
    return sum(
        q
        for r in intraday
        for q in [_summary_quantity(key, r["units"], float(r["quantity"]))]
        if q is not None
    )
