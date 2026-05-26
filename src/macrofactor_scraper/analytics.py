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


def evaluate_cut_drift(
    service: "HealthAutoExportService",
    phase_id: int,
    as_of: date | None = None,
) -> dict:
    """Analyse whether actual weight-loss rate matches the cut phase plan.

    Returns a dict with:
      actual_rate_kg_week  — measured weekly rate over last 14 days
      expected_rate_kg_week — implied by (target_weight - start_weight) / total_days * 7
      suggested_target_calories — adjusted kcal, or None if insufficient data
      confidence — 0-1 based on how many data points we have
      days_evaluated — number of weigh-in days used
      divergence_pct — how far off actual is from expected (absolute %)
    """
    service._ensure_schema()
    as_of = as_of or date.today()

    # Fetch the phase
    with service._connect() as conn:
        row = conn.execute("SELECT * FROM cut_phases WHERE id = ?", (phase_id,)).fetchone()
    if not row:
        return {"error": "Phase not found"}
    phase = dict(row)

    start_date = date.fromisoformat(phase["start_date"])
    end_date = date.fromisoformat(phase["end_date"]) if phase.get("end_date") else None
    target_kg = phase.get("target_weight_kg")
    target_kcal = phase.get("target_calories")
    days_since_start = (as_of - start_date).days

    if days_since_start < 7:
        return {
            "actual_rate_kg_week": None,
            "expected_rate_kg_week": None,
            "suggested_target_calories": None,
            "confidence": 0.0,
            "days_evaluated": 0,
            "divergence_pct": None,
            "message": "Need at least 7 days of data",
        }

    # Gather weight data for last 14 days (from daily_logs + Garmin)
    window_start = (as_of - timedelta(days=14)).isoformat()
    today_str = as_of.isoformat()

    with service._connect() as conn:
        log_weights = conn.execute(
            "SELECT log_date, weight_kg FROM daily_logs WHERE log_date >= ? AND log_date <= ? AND weight_kg IS NOT NULL ORDER BY log_date",
            (window_start, today_str),
        ).fetchall()
        garmin_weights = conn.execute(
            "SELECT record_date, quantity FROM health_records WHERE metric_name = 'weight_body_mass' AND source = 'Garmin' AND record_date >= ? AND record_date <= ? ORDER BY record_date",
            (window_start, today_str),
        ).fetchall()

    # Merge, prefer daily_log over Garmin for same date
    weight_by_date: dict[str, float] = {}
    for r in garmin_weights:
        weight_by_date[r["record_date"]] = float(r["quantity"])
    for r in log_weights:
        weight_by_date[r["log_date"]] = float(r["weight_kg"])

    if len(weight_by_date) < 3:
        return {
            "actual_rate_kg_week": None,
            "expected_rate_kg_week": None,
            "suggested_target_calories": None,
            "confidence": 0.0,
            "days_evaluated": len(weight_by_date),
            "divergence_pct": None,
            "message": "Too few weigh-ins in last 14 days (need 3+)",
        }

    sorted_dates = sorted(weight_by_date.keys())
    days_numeric = [(date.fromisoformat(d) - date.fromisoformat(sorted_dates[0])).days for d in sorted_dates]
    weights = [weight_by_date[d] for d in sorted_dates]

    # Linear regression → weekly rate
    n = len(days_numeric)
    x_mean = sum(days_numeric) / n
    y_mean = sum(weights) / n
    num = sum((x - x_mean) * (y - y) for x, y in zip(days_numeric, weights))  # noqa — intentional shadow
    den = sum((x - x_mean) ** 2 for x in days_numeric)
    actual_rate_kg_day = (sum((days_numeric[i] - x_mean) * (weights[i] - y_mean) for i in range(n)) /
                          (sum((days_numeric[i] - x_mean) ** 2 for i in range(n)) or 1))
    actual_rate_kg_week = round(actual_rate_kg_day * 7, 3)

    # Expected rate from plan
    expected_rate_kg_week = None
    if target_kg is not None:
        start_weight = weight_by_date.get(start_date.isoformat()) or weights[0]
        total_days = (end_date - start_date).days if end_date else 90
        if total_days > 0:
            expected_rate_kg_day = (target_kg - start_weight) / total_days
            expected_rate_kg_week = round(expected_rate_kg_day * 7, 3)

    # Divergence
    divergence_pct = None
    if expected_rate_kg_week is not None and abs(expected_rate_kg_week) > 1e-6:
        divergence_pct = round(abs(actual_rate_kg_week - expected_rate_kg_week) / abs(expected_rate_kg_week) * 100, 1)

    # Suggest kcal adjustment using 7700 kcal/kg
    suggested_target_calories = None
    if (
        divergence_pct is not None and divergence_pct > 30
        and expected_rate_kg_week is not None
        and target_kcal is not None
    ):
        rate_gap_kg_week = expected_rate_kg_week - actual_rate_kg_week
        kcal_delta = rate_gap_kg_week * 7700 / 7
        suggested_target_calories = int(round(target_kcal + kcal_delta, -50))

    confidence = round(min(n / 10.0, 1.0), 2)

    return {
        "actual_rate_kg_week": actual_rate_kg_week,
        "expected_rate_kg_week": expected_rate_kg_week,
        "suggested_target_calories": suggested_target_calories,
        "confidence": confidence,
        "days_evaluated": n,
        "divergence_pct": divergence_pct,
        "current_target_calories": target_kcal,
    }


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
