"""Derived health analytics — readiness score and related helpers.

All public functions are pure (no DB access). Service-level wiring lives at the
bottom of this module via `readiness_for(service, record_date)`.
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import TYPE_CHECKING

from macrofactor_scraper.models import ReadinessReport

if TYPE_CHECKING:
    from macrofactor_scraper.health_export import HealthAutoExportService

_MIN_HISTORY_DAYS = 3
_BASELINE_DAYS = 7


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _stdev(values: list[float], mean: float) -> float:
    if len(values) < 2:
        return 0.0
    variance = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(variance)


def _z_score(value: float, mean: float, sd: float) -> float | None:
    if sd < 1e-9:
        return None
    return (value - mean) / sd


def _band_from_score(score: float) -> str:
    if score >= 67:
        return "green"
    if score >= 33:
        return "amber"
    return "red"


def _score_from_z(hrv_z: float | None, rhr_z: float | None) -> float | None:
    """Composite 0–100 score.

    HRV: higher is better → positive z is good.
    RHR: lower is better → negative z is good.
    We invert RHR z so both point in the "good" direction, then average and
    map ±2σ → 0–100 (clamped).
    """
    components: list[float] = []
    if hrv_z is not None:
        components.append(hrv_z)
    if rhr_z is not None:
        components.append(-rhr_z)
    if not components:
        return None
    avg_z = sum(components) / len(components)
    # Map [-2, +2] → [0, 100]
    raw = (avg_z + 2.0) / 4.0 * 100.0
    return max(0.0, min(100.0, raw))


def readiness_from_series(
    *,
    record_date: date,
    today_hrv: float | None,
    hrv_history: list[float],
    today_rhr: float | None,
    rhr_history: list[float],
) -> ReadinessReport:
    """Compute a readiness report from raw series data.

    hrv_history and rhr_history are the preceding _BASELINE_DAYS values (today excluded).
    Any list with fewer than _MIN_HISTORY_DAYS entries is treated as insufficient.
    """
    date_str = record_date.isoformat()

    has_hrv_baseline = len(hrv_history) >= _MIN_HISTORY_DAYS
    has_rhr_baseline = len(rhr_history) >= _MIN_HISTORY_DAYS
    has_any_today = today_hrv is not None or today_rhr is not None

    if not has_any_today or (not has_hrv_baseline and not has_rhr_baseline):
        return ReadinessReport(
            date=date_str,
            summary="Insufficient Garmin data (need 3+ days of baseline)",
        )

    hrv_mean = hrv_sd = hrv_z = None
    if has_hrv_baseline and today_hrv is not None:
        hrv_mean = _mean(hrv_history)
        hrv_sd = _stdev(hrv_history, hrv_mean)
        hrv_z = _z_score(today_hrv, hrv_mean, hrv_sd)

    rhr_mean = rhr_sd = rhr_z = None
    if has_rhr_baseline and today_rhr is not None:
        rhr_mean = _mean(rhr_history)
        rhr_sd = _stdev(rhr_history, rhr_mean)
        rhr_z = _z_score(today_rhr, rhr_mean, rhr_sd)

    score = _score_from_z(hrv_z, rhr_z)
    band = _band_from_score(score) if score is not None else None

    parts: list[str] = []
    if hrv_z is not None and hrv_mean is not None:
        direction = "above" if hrv_z >= 0 else "below"
        parts.append(f"HRV {today_hrv:.0f} ms ({abs(hrv_z):.1f}σ {direction} baseline {hrv_mean:.0f} ms)")
    if rhr_z is not None and rhr_mean is not None:
        direction = "below" if rhr_z <= 0 else "above"
        parts.append(f"RHR {today_rhr:.0f} bpm ({abs(rhr_z):.1f}σ {direction} baseline {rhr_mean:.0f} bpm)")

    if band == "green":
        headline = "Well recovered"
    elif band == "amber":
        headline = "Moderate recovery"
    elif band == "red":
        headline = "Low recovery — consider lighter session"
    else:
        headline = "Partial data"

    summary = headline + (". " + " | ".join(parts) if parts else "")

    return ReadinessReport(
        date=date_str,
        hrv_today=round(today_hrv, 1) if today_hrv is not None else None,
        hrv_baseline_mean=round(hrv_mean, 1) if hrv_mean is not None else None,
        hrv_baseline_sd=round(hrv_sd, 1) if hrv_sd is not None else None,
        hrv_z=round(hrv_z, 2) if hrv_z is not None else None,
        rhr_today=round(today_rhr, 1) if today_rhr is not None else None,
        rhr_baseline_mean=round(rhr_mean, 1) if rhr_mean is not None else None,
        rhr_baseline_sd=round(rhr_sd, 1) if rhr_sd is not None else None,
        rhr_z=round(rhr_z, 2) if rhr_z is not None else None,
        score=round(score, 1) if score is not None else None,
        band=band,
        summary=summary,
    )


def readiness_for(service: "HealthAutoExportService", record_date: date) -> ReadinessReport:
    """Query the DB for HRV + RHR series and return a ReadinessReport."""
    service._ensure_schema()
    start = (record_date - timedelta(days=_BASELINE_DAYS)).isoformat()
    end_excl = record_date.isoformat()
    today = record_date.isoformat()

    with service._connect() as conn:
        rows = conn.execute(
            """
            SELECT metric_name, quantity, record_date
            FROM health_records
            WHERE metric_name IN ('hrv_overnight', 'resting_heart_rate')
              AND source = 'Garmin'
              AND record_date >= ?
              AND record_date <= ?
            ORDER BY record_date
            """,
            (start, today),
        ).fetchall()

    hrv_history: list[float] = []
    rhr_history: list[float] = []
    today_hrv: float | None = None
    today_rhr: float | None = None

    for row in rows:
        name = row["metric_name"]
        qty = float(row["quantity"])
        d = row["record_date"]
        if d == today:
            if name == "hrv_overnight":
                today_hrv = qty
            elif name == "resting_heart_rate":
                today_rhr = qty
        elif d >= start and d < end_excl:
            if name == "hrv_overnight":
                hrv_history.append(qty)
            elif name == "resting_heart_rate":
                rhr_history.append(qty)

    return readiness_from_series(
        record_date=record_date,
        today_hrv=today_hrv,
        hrv_history=hrv_history,
        today_rhr=today_rhr,
        rhr_history=rhr_history,
    )
