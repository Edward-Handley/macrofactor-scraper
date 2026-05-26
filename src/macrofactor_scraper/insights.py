"""Deterministic anomaly detection for Today page chips."""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from macrofactor_scraper.health_export import HealthAutoExportService

AnomalyKind = Literal["good", "warn", "bad", "info"]
TrainingCallKind = Literal["push", "maintain", "deload", "rest"]


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


def recommend_refeed(
    service: "HealthAutoExportService",
    for_date: date,
) -> dict:
    """Return a refeed recommendation if metabolic stress markers indicate it.

    Fires when ALL of:
    - Active cut_phase ≥21 days in
    - 7d avg RHR > 21d baseline by ≥3 bpm OR 7d avg HRV < 21d baseline by ≥10%
    - 7d avg motivation OR am_energy below user's median by ≥1 point
    - No refeed day in last 14 days
    """
    today_str = for_date.isoformat()
    window_21 = (for_date - timedelta(days=21)).isoformat()
    window_7 = (for_date - timedelta(days=7)).isoformat()
    window_14 = (for_date - timedelta(days=14)).isoformat()

    # Condition 1: active cut phase ≥21 days
    phase = service.get_active_cut_phase()
    if not phase:
        return {"should_refeed": False, "reasons": ["No active cut phase"], "suggested_kcal_bump": 0, "suggested_days": 0}
    start = date.fromisoformat(phase["start_date"])
    days_in_cut = (for_date - start).days
    if days_in_cut < 21:
        return {"should_refeed": False, "reasons": [f"Only {days_in_cut} days into cut (need 21+)"], "suggested_kcal_bump": 0, "suggested_days": 0}

    reasons: list[str] = []
    flags: list[bool] = []

    # Condition 2: Garmin HRV/RHR fatigue signal
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
            (window_21, today_str),
        ).fetchall()

    hrv_21d = [float(r["quantity"]) for r in garmin_rows if r["metric_name"] == "hrv_overnight" and r["record_date"] < window_7]
    hrv_7d = [float(r["quantity"]) for r in garmin_rows if r["metric_name"] == "hrv_overnight" and r["record_date"] >= window_7]
    rhr_21d = [float(r["quantity"]) for r in garmin_rows if r["metric_name"] == "resting_heart_rate" and r["record_date"] < window_7]
    rhr_7d = [float(r["quantity"]) for r in garmin_rows if r["metric_name"] == "resting_heart_rate" and r["record_date"] >= window_7]

    garmin_flag = False
    if hrv_21d and hrv_7d:
        baseline = _mean(hrv_21d)
        recent = _mean(hrv_7d)
        if recent < baseline * 0.90:
            garmin_flag = True
            reasons.append(f"HRV 10%+ below 3-week baseline ({recent:.0f} vs {baseline:.0f} ms avg)")
    if rhr_21d and rhr_7d:
        baseline = _mean(rhr_21d)
        recent = _mean(rhr_7d)
        if recent > baseline + 3:
            garmin_flag = True
            reasons.append(f"RHR elevated +{recent - baseline:.1f} bpm above 3-week baseline")

    # Condition 3: subjective fatigue (motivation or am_energy below median)
    logs_all = service.get_daily_logs(date.fromisoformat(window_21), for_date)
    logs_7d = [l for l in logs_all if l["log_date"] >= window_7]
    motivation_all = [float(l["motivation"]) for l in logs_all if l.get("motivation") is not None]
    energy_all = [float(l["am_energy"]) for l in logs_all if l.get("am_energy") is not None]
    motivation_7d = [float(l["motivation"]) for l in logs_7d if l.get("motivation") is not None]
    energy_7d = [float(l["am_energy"]) for l in logs_7d if l.get("am_energy") is not None]

    subjective_flag = False
    if motivation_all and motivation_7d:
        median_m = sorted(motivation_all)[len(motivation_all) // 2]
        avg_m_7d = _mean(motivation_7d)
        if avg_m_7d < median_m - 1:
            subjective_flag = True
            reasons.append(f"Motivation down {median_m - avg_m_7d:.1f} pts vs baseline (7d avg {avg_m_7d:.1f})")
    if energy_all and energy_7d:
        median_e = sorted(energy_all)[len(energy_all) // 2]
        avg_e_7d = _mean(energy_7d)
        if avg_e_7d < median_e - 1:
            subjective_flag = True
            reasons.append(f"Morning energy down {median_e - avg_e_7d:.1f} pts vs baseline")

    # Condition 4: no refeed in last 14 days
    recent_refeed = any(
        l.get("is_refeed") for l in logs_all if l["log_date"] >= window_14
    )
    if recent_refeed:
        return {"should_refeed": False, "reasons": ["Refeed in last 14 days"], "suggested_kcal_bump": 0, "suggested_days": 0}

    # Combine signals
    should_refeed = (garmin_flag or subjective_flag) and (garmin_flag or len(reasons) >= 2)

    if not reasons:
        reasons = ["All markers within normal range"]

    target_kcal = phase.get("target_calories") or 0
    # Standard refeed: +300-500 kcal above target, mostly carbs, 1-2 days
    suggested_kcal_bump = 400
    suggested_days = 2 if (garmin_flag and subjective_flag) else 1

    return {
        "should_refeed": should_refeed,
        "reasons": reasons[:4],
        "suggested_kcal_bump": suggested_kcal_bump if should_refeed else 0,
        "suggested_kcal_target": target_kcal + suggested_kcal_bump if should_refeed else None,
        "suggested_days": suggested_days if should_refeed else 0,
        "days_into_cut": days_in_cut,
    }


def recommend_training(
    service: "HealthAutoExportService",
    for_date: date,
) -> dict:
    """Return a training call (push/maintain/deload/rest) with supporting reasons.

    Inputs:
    - Readiness score from HRV+RHR z-scores (analytics.readiness_for)
    - Last 2 nights sleep_hours from daily_logs
    - 7d vs 28d Strong training tonnage ratio
    - 7d rolling gym_rpe average from daily_logs
    """
    from macrofactor_scraper.analytics import readiness_for

    today_str = for_date.isoformat()
    readiness = readiness_for(service, for_date)
    score = readiness.score  # 0-100, None if no Garmin data
    band = readiness.band    # "green"/"amber"/"red"/None

    # Recent sleep (last 2 days including today's log)
    window_start = (for_date - timedelta(days=28)).isoformat()
    logs_recent = service.get_daily_logs(date.fromisoformat(window_start), for_date)
    last2_logs = [l for l in logs_recent if l["log_date"] >= (for_date - timedelta(days=2)).isoformat()]
    sleep_vals = [float(l["sleep_hours"]) for l in last2_logs if l.get("sleep_hours") is not None]
    avg_sleep = _mean(sleep_vals) if sleep_vals else None
    consecutive_poor_sleep = sum(1 for s in sleep_vals if s < 6)

    # 7d RPE
    rpe_vals = [float(l["gym_rpe"]) for l in logs_recent
                if l.get("gym_rpe") is not None and l["log_date"] >= (for_date - timedelta(days=7)).isoformat()]
    avg_rpe_7d = _mean(rpe_vals) if rpe_vals else None

    # Strong tonnage: 7d vs 28d weekly average
    with service._connect() as conn:
        tonnage_7d_row = conn.execute(
            """
            SELECT COALESCE(SUM(weight_kg * reps), 0) AS tonnage
            FROM strong_workout_sets
            WHERE workout_date >= ? AND workout_date <= ?
            """,
            ((for_date - timedelta(days=7)).isoformat(), today_str),
        ).fetchone()
        tonnage_28d_row = conn.execute(
            """
            SELECT COALESCE(SUM(weight_kg * reps), 0) AS tonnage
            FROM strong_workout_sets
            WHERE workout_date >= ? AND workout_date <= ?
            """,
            ((for_date - timedelta(days=28)).isoformat(), today_str),
        ).fetchone()

    tonnage_7d = float(tonnage_7d_row["tonnage"]) if tonnage_7d_row else 0.0
    tonnage_28d_weekly_avg = float(tonnage_28d_row["tonnage"]) / 4.0 if tonnage_28d_row else 0.0
    tonnage_ratio = tonnage_7d / tonnage_28d_weekly_avg if tonnage_28d_weekly_avg > 0 else None

    reasons: list[str] = []
    score_points: float = 0.0
    total_weight: float = 0.0

    # --- Readiness signal (weight 40) ----------------------------------------
    if score is not None:
        total_weight += 40
        score_points += (score / 100) * 40
        if band == "green":
            reasons.append(f"Recovery green — readiness score {score:.0f}/100")
        elif band == "amber":
            reasons.append(f"Recovery amber — readiness score {score:.0f}/100")
        else:
            reasons.append(f"Recovery red — readiness score {score:.0f}/100, consider lighter load")

    # --- Sleep signal (weight 35) --------------------------------------------
    if avg_sleep is not None:
        total_weight += 35
        sleep_frac = min(avg_sleep / 8.0, 1.0)
        score_points += sleep_frac * 35
        if consecutive_poor_sleep >= 2:
            reasons.append(f"2+ nights <6h sleep ({avg_sleep:.1f}h avg) — high fatigue risk")
        elif avg_sleep < 6:
            reasons.append(f"Poor sleep last night ({avg_sleep:.1f}h)")
        elif avg_sleep >= 7.5:
            reasons.append(f"Good sleep ({avg_sleep:.1f}h avg)")
        else:
            reasons.append(f"Adequate sleep ({avg_sleep:.1f}h avg)")

    # --- Volume signal (weight 15) -------------------------------------------
    if tonnage_ratio is not None:
        total_weight += 15
        # Optimal load ratio is 0.8-1.2; penalise over-reaching (>1.4)
        if tonnage_ratio > 1.4:
            reasons.append(f"7d training volume {tonnage_ratio:.1f}x 4-week avg — high accumulation")
        elif tonnage_ratio < 0.5 and tonnage_28d_weekly_avg > 1000:
            reasons.append(f"Training volume below normal this week")
        else:
            score_points += min(tonnage_ratio / 1.2, 1.0) * 15
            if tonnage_ratio <= 1.0:
                reasons.append(f"Volume within normal range")

    # --- RPE signal (weight 10) ----------------------------------------------
    if avg_rpe_7d is not None:
        total_weight += 10
        # High RPE + low sleep/readiness = stack of fatigue
        if avg_rpe_7d >= 8.5:
            reasons.append(f"RPE high this week ({avg_rpe_7d:.1f} avg) — accumulated fatigue")
        else:
            score_points += (1 - (avg_rpe_7d - 5) / 5) * 10
            if avg_rpe_7d >= 7:
                reasons.append(f"Moderate RPE ({avg_rpe_7d:.1f} avg)")

    # --- Decide call ---------------------------------------------------------
    if total_weight == 0:
        # No data at all
        call: TrainingCallKind = "maintain"
        confidence = 0.0
        reasons = ["Insufficient data — log morning metrics for a personalised call"]
    else:
        pct = score_points / total_weight
        confidence = round(pct, 2)
        if consecutive_poor_sleep >= 2 or (band == "red" and (avg_sleep or 8) < 6):
            call = "rest"
        elif pct >= 0.72:
            call = "push"
        elif pct >= 0.50:
            call = "maintain"
        elif pct >= 0.30:
            call = "deload"
        else:
            call = "rest"

    return {
        "date": today_str,
        "call": call,
        "reasons": reasons[:4],
        "confidence": confidence,
    }
