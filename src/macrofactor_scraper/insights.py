"""Deterministic anomaly detection for Today page chips."""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from macrofactor_scraper.health_export import HealthAutoExportService

AnomalyKind = Literal["good", "warn", "bad", "info"]


class Anomaly:
    def __init__(
        self,
        kind: AnomalyKind,
        label: str,
        detail: str = "",
        link_to: str | None = None,
    ) -> None:
        self.kind = kind
        self.label = label
        self.detail = detail
        self.link_to = link_to

    def to_dict(self) -> dict:
        d = {"kind": self.kind, "label": self.label, "detail": self.detail}
        if self.link_to:
            d["link_to"] = self.link_to
        return d


def _mean(vals: list[float]) -> float:
    return sum(vals) / len(vals)


def _sd(vals: list[float], mean: float) -> float:
    if len(vals) < 2:
        return 0.0
    return math.sqrt(sum((v - mean) ** 2 for v in vals) / (len(vals) - 1))


def _z(value: float, mean: float, sd: float) -> float | None:
    if sd < 1e-9:
        return None
    return (value - mean) / sd


def compute_anomalies(
    service: "HealthAutoExportService",
    for_date: date,
    protein_goal_g: float | None = None,
) -> list[Anomaly]:
    """Return up to 4 anomaly chips for the given date."""
    service._ensure_schema()
    today_str = for_date.isoformat()
    window_start = (for_date - timedelta(days=30)).isoformat()
    baseline_start = (for_date - timedelta(days=14)).isoformat()

    # ── Fetch daily summaries (30d including today) ──────────────────────────
    summaries = service._daily_summary_items(
        date.fromisoformat(window_start), for_date, include_hidden=True
    )
    today_summary = next((s for s in summaries if s.date == today_str), None)
    history = [s for s in summaries if s.date < today_str]

    # ── Fetch Garmin metrics (HRV + RHR, 14d baseline) ───────────────────────
    garmin_rows: list = []
    with service._connect() as conn:
        garmin_rows = conn.execute(
            """
            SELECT metric_name, quantity, record_date
            FROM health_records
            WHERE metric_name IN ('hrv_overnight', 'resting_heart_rate')
              AND source = 'Garmin'
              AND record_date >= ? AND record_date <= ?
            ORDER BY record_date
            """,
            (baseline_start, today_str),
        ).fetchall()

    hrv_hist = [float(r["quantity"]) for r in garmin_rows
                if r["metric_name"] == "hrv_overnight" and r["record_date"] < today_str]
    rhr_hist = [float(r["quantity"]) for r in garmin_rows
                if r["metric_name"] == "resting_heart_rate" and r["record_date"] < today_str]
    today_hrv = next((float(r["quantity"]) for r in garmin_rows
                      if r["metric_name"] == "hrv_overnight" and r["record_date"] == today_str), None)
    today_rhr = next((float(r["quantity"]) for r in garmin_rows
                      if r["metric_name"] == "resting_heart_rate" and r["record_date"] == today_str), None)

    # ── Fetch daily log (streak + sleep) ─────────────────────────────────────
    logs = service.get_daily_logs(date.fromisoformat(window_start), for_date)
    log_dates = {l["log_date"] for l in logs}
    today_log = service.get_daily_log(today_str)

    # ── Fetch Strong PRs for today ────────────────────────────────────────────
    strong_sessions_today: list = []
    with service._connect() as conn:
        strong_sessions_today = conn.execute(
            "SELECT * FROM strong_sets WHERE session_date = ?", (today_str,)
        ).fetchall()

    anomalies: list[Anomaly] = []

    # ── Rule: HRV z-score ────────────────────────────────────────────────────
    if today_hrv is not None and len(hrv_hist) >= 3:
        m = _mean(hrv_hist)
        sd = _sd(hrv_hist, m)
        z = _z(today_hrv, m, sd)
        if z is not None:
            if z <= -1.5:
                anomalies.append(Anomaly(
                    kind="bad",
                    label=f"HRV {abs(z):.1f}σ low",
                    detail=f"{today_hrv:.0f} ms vs {m:.0f} ms baseline",
                    link_to="/health",
                ))
            elif z >= 1.5:
                anomalies.append(Anomaly(
                    kind="good",
                    label=f"HRV {z:.1f}σ high",
                    detail=f"{today_hrv:.0f} ms vs {m:.0f} ms baseline",
                    link_to="/health",
                ))

    # ── Rule: RHR z-score ────────────────────────────────────────────────────
    if today_rhr is not None and len(rhr_hist) >= 3:
        m = _mean(rhr_hist)
        sd = _sd(rhr_hist, m)
        z = _z(today_rhr, m, sd)
        if z is not None:
            if z >= 1.5:
                anomalies.append(Anomaly(
                    kind="bad",
                    label=f"RHR {z:.1f}σ high",
                    detail=f"{today_rhr:.0f} bpm vs {m:.0f} bpm baseline",
                    link_to="/health",
                ))
            elif z <= -1.5:
                anomalies.append(Anomaly(
                    kind="good",
                    label=f"RHR {abs(z):.1f}σ low",
                    detail=f"{today_rhr:.0f} bpm vs {m:.0f} bpm baseline",
                    link_to="/health",
                ))

    # ── Rule: Steps percentile (bottom/top decile vs 30d) ───────────────────
    if today_summary and today_summary.steps is not None and len(history) >= 7:
        step_hist = sorted([s.steps for s in history if s.steps is not None])
        if step_hist:
            rank = sum(1 for v in step_hist if v <= today_summary.steps)
            pct = rank / len(step_hist)
            if pct <= 0.10:
                anomalies.append(Anomaly(
                    kind="warn",
                    label=f"Steps bottom 10%",
                    detail=f"{int(today_summary.steps):,} vs {int(_mean(step_hist)):,} avg",
                    link_to="/trends",
                ))
            elif pct >= 0.90:
                anomalies.append(Anomaly(
                    kind="good",
                    label=f"Steps top 10%",
                    detail=f"{int(today_summary.steps):,} today",
                    link_to="/trends",
                ))

    # ── Rule: Protein gap vs goal ─────────────────────────────────────────────
    if (
        protein_goal_g and protein_goal_g > 0
        and today_summary and today_summary.protein is not None
    ):
        gap = protein_goal_g - today_summary.protein
        if gap > 30:
            anomalies.append(Anomaly(
                kind="warn",
                label=f"Protein {gap:.0f}g under",
                detail=f"{today_summary.protein:.0f}g vs {protein_goal_g:.0f}g goal",
            ))

    # ── Rule: Log streak milestone ───────────────────────────────────────────
    streak = 0
    check = for_date - timedelta(days=1)
    for _ in range(60):
        if check.isoformat() in log_dates:
            streak += 1
            check -= timedelta(days=1)
        else:
            break
    for milestone in (7, 14, 30, 60):
        if streak == milestone:
            anomalies.append(Anomaly(
                kind="good",
                label=f"{milestone}d streak",
                detail="Keep it up",
            ))
            break

    # ── Rule: Weight retention spike (>1kg over 3d while kcal flat) ─────────
    if today_summary and today_summary.weight is not None and len(history) >= 3:
        recent3_weights = [s.weight for s in history[-3:] if s.weight is not None]
        recent3_kcal = [s.calories for s in history[-3:] if s.calories is not None]
        if recent3_weights:
            weight_delta = today_summary.weight - recent3_weights[0]
            avg_kcal_3d = _mean(recent3_kcal) if recent3_kcal else None
            avg_kcal_30d = _mean([s.calories for s in history if s.calories is not None]) if history else None
            kcal_flat = (
                avg_kcal_3d is not None
                and avg_kcal_30d is not None
                and abs(avg_kcal_3d - avg_kcal_30d) < avg_kcal_30d * 0.10
            )
            if weight_delta > 1.0 and kcal_flat:
                anomalies.append(Anomaly(
                    kind="info",
                    label=f"+{weight_delta:.1f}kg in 3d (likely water)",
                    detail="Calories flat — likely water retention",
                    link_to="/trends",
                ))

    # ── Rule: PR on today's Strong session ───────────────────────────────────
    if strong_sessions_today:
        with service._connect() as conn:
            # Check if any set today is a lifetime PR (est 1RM)
            pr_exercises: list[str] = []
            exercise_names = list({r["exercise_name"] for r in strong_sessions_today})
            for ex in exercise_names:
                rows_all = conn.execute(
                    """
                    SELECT weight_kg, reps FROM strong_sets
                    WHERE exercise_name = ? AND session_date < ?
                    ORDER BY session_date DESC
                    """,
                    (ex, today_str),
                ).fetchall()
                today_sets = [r for r in strong_sessions_today if r["exercise_name"] == ex]
                if not rows_all:
                    continue

                def _e1rm(w: float | None, r: float | None) -> float | None:
                    if w and r and r > 0:
                        return float(w) * (1 + float(r) / 30)
                    return None

                past_best = max(
                    (_e1rm(float(r["weight_kg"]), float(r["reps"])) or 0 for r in rows_all),
                    default=0,
                )
                today_best = max(
                    (_e1rm(
                        float(r["weight_kg"]) if r["weight_kg"] else None,
                        float(r["reps"]) if r["reps"] else None,
                    ) or 0 for r in today_sets),
                    default=0,
                )
                if today_best > past_best > 0:
                    pr_exercises.append(ex)

            if pr_exercises:
                # Note if sleep was poor
                sleep_note = ""
                if today_log and today_log.get("sleep_hours") is not None:
                    sh = float(today_log["sleep_hours"])
                    if sh < 6:
                        sleep_note = f" on {sh:.1f}h sleep"
                label = f"PR: {pr_exercises[0]}" + (f" + {len(pr_exercises)-1} more" if len(pr_exercises) > 1 else "")
                anomalies.append(Anomaly(
                    kind="good",
                    label=label + sleep_note,
                    detail=", ".join(pr_exercises[:3]),
                    link_to="/workouts",
                ))

    return anomalies[:5]
