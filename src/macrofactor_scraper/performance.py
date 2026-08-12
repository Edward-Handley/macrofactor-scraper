"""Performance analytics: training load, ACWR, swim analytics, fueling summary."""
from __future__ import annotations

from datetime import date, timedelta
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from macrofactor_scraper.health_export import HealthAutoExportService


def _date_range(start: date, end: date) -> list[date]:
    result = []
    current = start
    while current <= end:
        result.append(current)
        current += timedelta(days=1)
    return result


def daily_load_series(service: "HealthAutoExportService", start: date, end: date) -> list[dict]:
    """Sum training_load per day across all activities (Garmin + manual). Returns list of {date, load, sources}."""
    with service._connect() as conn:
        rows = conn.execute(
            """
            SELECT activity_date, SUM(training_load) AS total_load,
                   GROUP_CONCAT(DISTINCT load_source) AS sources
            FROM activities
            WHERE activity_date BETWEEN ? AND ?
              AND training_load IS NOT NULL
            GROUP BY activity_date
            ORDER BY activity_date ASC
            """,
            (start.isoformat(), end.isoformat()),
        ).fetchall()
    by_date: dict[str, dict] = {row["activity_date"]: {"load": float(row["total_load"]), "sources": row["sources"] or ""} for row in rows}

    result = []
    for d in _date_range(start, end):
        ds = d.isoformat()
        entry = by_date.get(ds)
        result.append({
            "date": ds,
            "load": entry["load"] if entry else 0.0,
            "sources": entry["sources"].split(",") if (entry and entry["sources"]) else [],
        })
    return result


def compute_acwr(daily_series: list[dict]) -> dict:
    """Compute ATL (7d), CTL (28d), ACWR from a daily_load_series list.

    Returns dict with series entries augmented with atl/ctl/acwr + overall status.
    """
    loads = [entry["load"] for entry in daily_series]
    n = len(loads)
    augmented = []
    for i, entry in enumerate(daily_series):
        # ATL: 7-day simple moving average
        window7 = loads[max(0, i - 6) : i + 1]
        atl = sum(window7) / len(window7)
        # CTL: 28-day simple moving average
        window28 = loads[max(0, i - 27) : i + 1]
        ctl = sum(window28) / len(window28)
        acwr = round(atl / ctl, 2) if ctl > 0 else None
        augmented.append({
            **entry,
            "atl": round(atl, 1),
            "ctl": round(ctl, 1),
            "acwr": acwr,
        })

    # Current status based on most recent ACWR
    status = "unknown"
    current_acwr: float | None = None
    for entry in reversed(augmented):
        if entry["acwr"] is not None:
            current_acwr = entry["acwr"]
            if current_acwr < 0.8:
                status = "detraining"
            elif current_acwr <= 1.3:
                status = "optimal"
            elif current_acwr <= 1.5:
                status = "caution"
            else:
                status = "high_risk"
            break

    return {
        "series": augmented,
        "current_acwr": current_acwr,
        "status": status,
    }


def swim_analytics(service: "HealthAutoExportService", start: date, end: date) -> dict:
    """Weekly swim volume, pace/100m progression, SWOLF trend, stroke mix."""
    with service._connect() as conn:
        rows = conn.execute(
            """
            SELECT activity_date, duration_seconds, distance_m, avg_pace_s_per_100m,
                   avg_swolf, stroke_type, laps
            FROM activities
            WHERE activity_date BETWEEN ? AND ?
              AND sport LIKE '%swim%'
            ORDER BY activity_date ASC
            """,
            (start.isoformat(), end.isoformat()),
        ).fetchall()

    sessions: list[dict] = [dict(r) for r in rows]

    # Weekly volume
    weekly: dict[str, dict] = {}
    for s in sessions:
        d = date.fromisoformat(s["activity_date"])
        week_start = (d - timedelta(days=d.weekday())).isoformat()
        if week_start not in weekly:
            weekly[week_start] = {"week": week_start, "volume_m": 0.0, "sessions": 0}
        weekly[week_start]["volume_m"] += s["distance_m"] or 0.0
        weekly[week_start]["sessions"] += 1
    weekly_volume = sorted(weekly.values(), key=lambda x: x["week"])

    # Pace progression (per session)
    pace_series = [
        {"date": s["activity_date"], "pace_s_per_100m": s["avg_pace_s_per_100m"]}
        for s in sessions if s.get("avg_pace_s_per_100m") is not None
    ]

    # SWOLF trend
    swolf_series = [
        {"date": s["activity_date"], "swolf": s["avg_swolf"]}
        for s in sessions if s.get("avg_swolf") is not None
    ]

    # Stroke mix
    stroke_counts: dict[str, int] = {}
    for s in sessions:
        st = s.get("stroke_type") or "unknown"
        stroke_counts[st] = stroke_counts.get(st, 0) + 1

    # Best pace
    best_pace = min((s["avg_pace_s_per_100m"] for s in sessions if s.get("avg_pace_s_per_100m")), default=None)

    return {
        "weekly_volume": weekly_volume,
        "pace_series": pace_series,
        "swolf_series": swolf_series,
        "stroke_mix": [{"stroke": k, "count": v} for k, v in stroke_counts.items()],
        "best_pace_s_per_100m": best_pace,
        "total_sessions": len(sessions),
        "total_volume_m": sum(s.get("distance_m") or 0.0 for s in sessions),
    }


def fueling_summary(service: "HealthAutoExportService", for_date: date) -> dict:
    """Yesterday's calories/protein vs yesterday's training load."""
    yesterday = for_date - timedelta(days=1)
    yest_str = yesterday.isoformat()

    # Nutrition
    items = service.daily_summary(yesterday, yesterday).summaries
    yest = items[0] if items else None

    # Load
    with service._connect() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(training_load), 0) AS load FROM activities WHERE activity_date = ?",
            (yest_str,),
        ).fetchone()
    load = float(row["load"]) if row else 0.0

    return {
        "date": yest_str,
        "calories": yest.calories if yest else None,
        "protein": yest.protein if yest else None,
        "training_load": load,
    }
