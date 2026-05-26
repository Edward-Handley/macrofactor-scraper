"""Smart insights engine — correlations, patterns, streaks, trends across health metrics."""
from __future__ import annotations

import hashlib
import math
from collections import defaultdict
from datetime import date, timedelta
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from macrofactor_scraper.health_export import HealthAutoExportService

from macrofactor_scraper.models import SmartInsight


def _mean(vals: list[float]) -> float:
    return sum(vals) / len(vals)


def _sd(vals: list[float]) -> float:
    if len(vals) < 2:
        return 0.0
    m = _mean(vals)
    return math.sqrt(sum((v - m) ** 2 for v in vals) / (len(vals) - 1))


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 5:
        return None
    mx, my = _mean(xs), _mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    denom = math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
    if denom < 1e-9:
        return None
    return num / denom


def _insight_id(*parts: str) -> str:
    return hashlib.md5("|".join(parts).encode()).hexdigest()[:12]


# ─── Data loader ──────────────────────────────────────────────────────────────

def _load_window(service: "HealthAutoExportService", up_to: date, days: int = 30) -> dict:
    """Load 30-day summary + log + Garmin data aligned by date string."""
    start = up_to - timedelta(days=days - 1)
    summaries = service.dashboard_summary(start, up_to).summaries
    logs = service.get_daily_logs(start, up_to)
    logs_by_date = {l["log_date"]: l for l in logs}

    garmin_metrics = [
        "hrv_overnight", "resting_heart_rate", "sleep_minutes", "sleep_score",
        "body_battery_low", "stress_avg", "steps", "active_minutes",
    ]
    garmin_by_date: dict[str, dict[str, float]] = defaultdict(dict)
    with service._connect() as conn:
        rows = conn.execute(
            """
            SELECT metric_name, quantity, record_date
            FROM health_records
            WHERE metric_name IN ({})
              AND source = 'Garmin'
              AND record_date >= ? AND record_date <= ?
            ORDER BY record_date
            """.format(",".join("?" * len(garmin_metrics))),
            (*garmin_metrics, start.isoformat(), up_to.isoformat()),
        ).fetchall()
    for r in rows:
        garmin_by_date[r["record_date"]][r["metric_name"]] = float(r["quantity"])

    aligned: dict[str, dict[str, float | None]] = {}
    for s in summaries:
        d = s.date.isoformat()
        lg = logs_by_date.get(d, {})
        gm = garmin_by_date.get(d, {})
        sleep_h = gm.get("sleep_minutes", None)
        if sleep_h is not None:
            sleep_h = sleep_h / 60.0
        elif lg.get("sleep_hours") is not None:
            sleep_h = float(lg["sleep_hours"])
        aligned[d] = {
            "calories": s.calories,
            "protein_g": s.protein,
            "carbohydrates_g": s.carbohydrates,
            "fat_g": s.fat,
            "weight_kg": s.weight,
            "steps": gm.get("steps") or s.steps,
            "active_energy": s.active_energy,
            "hrv_ms": gm.get("hrv_overnight") or (float(lg["hrv_overnight"]) if lg.get("hrv_overnight") else None),
            "rhr_bpm": gm.get("resting_heart_rate") or (float(lg["rhr"]) if lg.get("rhr") else None),
            "sleep_hours": sleep_h,
            "sleep_score": gm.get("sleep_score") or (float(lg["sleep_score"]) if lg.get("sleep_score") else None),
            "body_battery": gm.get("body_battery_low"),
            "stress": gm.get("stress_avg"),
            "gym_rpe": float(lg["gym_rpe"]) if lg.get("gym_rpe") is not None else None,
            "am_energy": float(lg["am_energy"]) if lg.get("am_energy") is not None else None,
            "weekday": date.fromisoformat(d).weekday(),  # 0=Mon
        }

    return {"dates": sorted(aligned.keys()), "data": aligned}


# ─── Analyzer: correlations ───────────────────────────────────────────────────

CORRELATION_PAIRS = [
    ("protein_g", "hrv_ms", "High protein → better HRV", "/trends"),
    ("calories", "weight_kg", "Calorie intake correlates with weight", "/trends"),
    ("steps", "sleep_hours", "Step count correlates with sleep duration", "/health"),
    ("body_battery", "hrv_ms", "Body battery mirrors HRV recovery", "/health"),
    ("gym_rpe", "sleep_hours", "Training intensity correlates with sleep", "/trends"),
    ("sleep_hours", "am_energy", "Sleep duration predicts morning energy", "/morning"),
]


def _analyzer_correlations(window: dict) -> list[SmartInsight]:
    data = window["data"]
    insights: list[SmartInsight] = []

    for m1, m2, label_hint, link in CORRELATION_PAIRS:
        pairs = [(v[m1], v[m2]) for v in data.values() if v.get(m1) is not None and v.get(m2) is not None]
        if len(pairs) < 14:
            continue
        xs, ys = zip(*pairs)
        r = _pearson(list(xs), list(ys))
        if r is None or abs(r) < 0.35:
            continue

        direction = "positively" if r > 0 else "inversely"
        strength = "strongly" if abs(r) > 0.6 else "moderately"
        m1_label = m1.replace("_", " ").replace(" g", "").replace(" ms", "").replace(" bpm", "")
        m2_label = m2.replace("_", " ").replace(" g", "").replace(" ms", "").replace(" bpm", "")

        if r > 0:
            title = f"{m1_label.title()} & {m2_label} move together"
            detail = f"{strength.capitalize()} positive correlation (r={r:.2f}, n={len(pairs)}). Higher {m1_label} aligns with higher {m2_label}."
        else:
            title = f"Higher {m1_label} → lower {m2_label}"
            detail = f"{strength.capitalize()} inverse correlation (r={r:.2f}, n={len(pairs)})."

        severity = "good" if (r > 0 and m2 in ("hrv_ms", "sleep_hours", "am_energy", "body_battery")) else "info"

        insights.append(SmartInsight(
            id=_insight_id("corr", m1, m2, window["dates"][-1]),
            category="correlation",
            severity=severity,
            title=title,
            detail=detail,
            metric_primary=m1,
            metric_secondary=m2,
            supporting={"r": round(r, 3), "n": len(pairs)},
            action=f"Open {link} to explore",
        ))

    return insights


# ─── Analyzer: day-of-week patterns ──────────────────────────────────────────

DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

DOW_METRICS = [
    ("hrv_ms", False, "HRV"),
    ("sleep_hours", False, "Sleep"),
    ("am_energy", False, "Morning energy"),
    ("calories", False, "Calories"),
    ("steps", False, "Steps"),
]


def _analyzer_day_of_week(window: dict) -> list[SmartInsight]:
    data = window["data"]
    insights: list[SmartInsight] = []

    for metric, invert, label in DOW_METRICS:
        by_dow: dict[int, list[float]] = defaultdict(list)
        for v in data.values():
            if v.get(metric) is not None:
                by_dow[v["weekday"]].append(float(v[metric]))  # type: ignore[arg-type]

        if len(by_dow) < 4:
            continue
        all_vals = [val for vals in by_dow.values() for val in vals]
        if len(all_vals) < 10:
            continue

        grand_mean = _mean(all_vals)
        grand_sd = _sd(all_vals)
        if grand_sd < 1e-6:
            continue

        for dow, vals in by_dow.items():
            if len(vals) < 3:
                continue
            dow_mean = _mean(vals)
            z = (dow_mean - grand_mean) / grand_sd
            if abs(z) < 1.1:
                continue

            day_name = DOW_NAMES[dow]
            direction = "low" if (z < 0 and not invert) or (z > 0 and invert) else "high"
            severity = "warn" if direction == "low" and metric in ("hrv_ms", "sleep_hours", "am_energy") else "info"

            title = f"{label} tends to be {direction} on {day_name}s"
            detail = (
                f"{day_name} average {label.lower()} is "
                f"{'below' if z < 0 else 'above'} typical by {abs(z):.1f}σ "
                f"({dow_mean:.1f} vs {grand_mean:.1f} avg)."
            )
            insights.append(SmartInsight(
                id=_insight_id("dow", metric, str(dow), window["dates"][-1]),
                category="pattern",
                severity=severity,
                title=title,
                detail=detail,
                metric_primary=metric,
                supporting={"dow": dow, "dow_mean": round(dow_mean, 1), "grand_mean": round(grand_mean, 1), "z": round(z, 2)},
            ))

    return insights[:3]


# ─── Analyzer: conditional thresholds ────────────────────────────────────────

def _analyzer_conditional(window: dict, service: "HealthAutoExportService") -> list[SmartInsight]:
    data = window["data"]
    insights: list[SmartInsight] = []

    prefs = service.dashboard_preferences()
    protein_goal = getattr(prefs, "protein_goal_g", None)

    # Protein hit → next-day HRV
    if protein_goal and protein_goal > 0:
        dates = window["dates"]
        high_p_hrv, low_p_hrv = [], []
        for i, d in enumerate(dates[:-1]):
            p = data[d].get("protein_g")
            next_d = dates[i + 1]
            hrv = data[next_d].get("hrv_ms")
            if p is None or hrv is None:
                continue
            if p >= protein_goal * 0.9:
                high_p_hrv.append(hrv)
            else:
                low_p_hrv.append(hrv)

        if len(high_p_hrv) >= 5 and len(low_p_hrv) >= 5:
            diff = _mean(high_p_hrv) - _mean(low_p_hrv)
            if abs(diff) >= 4:
                direction = "higher" if diff > 0 else "lower"
                severity = "good" if diff > 0 else "warn"
                insights.append(SmartInsight(
                    id=_insight_id("cond", "protein_hrv", window["dates"][-1]),
                    category="conditional",
                    severity=severity,
                    title=f"HRV is {direction} the day after hitting protein goal",
                    detail=(
                        f"On days you hit ≥90% of protein goal ({protein_goal:.0f}g), "
                        f"next-day HRV averages {_mean(high_p_hrv):.0f} ms vs "
                        f"{_mean(low_p_hrv):.0f} ms on miss days (Δ{diff:+.0f} ms)."
                    ),
                    metric_primary="protein_g",
                    metric_secondary="hrv_ms",
                    supporting={"hit_hrv": round(_mean(high_p_hrv), 1), "miss_hrv": round(_mean(low_p_hrv), 1), "diff": round(diff, 1)},
                    action="Prioritise protein to protect HRV",
                ))

    # Sleep ≥7h → next-morning RHR
    dates = window["dates"]
    good_sleep_rhr, poor_sleep_rhr = [], []
    for i, d in enumerate(dates[:-1]):
        slp = data[d].get("sleep_hours")
        next_d = dates[i + 1]
        rhr = data[next_d].get("rhr_bpm")
        if slp is None or rhr is None:
            continue
        if slp >= 7.0:
            good_sleep_rhr.append(rhr)
        else:
            poor_sleep_rhr.append(rhr)

    if len(good_sleep_rhr) >= 5 and len(poor_sleep_rhr) >= 5:
        diff = _mean(poor_sleep_rhr) - _mean(good_sleep_rhr)
        if diff >= 2:
            insights.append(SmartInsight(
                id=_insight_id("cond", "sleep_rhr", window["dates"][-1]),
                category="conditional",
                severity="warn",
                title="RHR is higher after poor sleep (<7h)",
                detail=(
                    f"After <7h sleep, RHR averages {_mean(poor_sleep_rhr):.0f} bpm "
                    f"vs {_mean(good_sleep_rhr):.0f} bpm after ≥7h sleep (Δ+{diff:.0f} bpm)."
                ),
                metric_primary="sleep_hours",
                metric_secondary="rhr_bpm",
                supporting={"poor_rhr": round(_mean(poor_sleep_rhr), 1), "good_rhr": round(_mean(good_sleep_rhr), 1)},
                action="Prioritise 7+ hours to keep RHR low",
            ))

    return insights


# ─── Analyzer: streaks ────────────────────────────────────────────────────────

def _analyzer_streaks(window: dict, service: "HealthAutoExportService") -> list[SmartInsight]:
    data = window["data"]
    dates = window["dates"]
    insights: list[SmartInsight] = []

    prefs = service.dashboard_preferences()
    protein_goal = getattr(prefs, "protein_goal_g", None)

    def _streak(condition_fn: Any) -> int:
        count = 0
        for d in reversed(dates):
            if condition_fn(data[d]):
                count += 1
            else:
                break
        return count

    # High-deficit streak (>500 kcal under maintenance ~ >500 kcal under calories if no TDEE)
    active_phase = service.get_active_cut_phase()
    target_cal = active_phase.get("target_calories") if active_phase else None
    if target_cal:
        deficit_streak = _streak(lambda v: v.get("calories") is not None and float(v["calories"]) < target_cal - 300)
        if deficit_streak >= 5:
            insights.append(SmartInsight(
                id=_insight_id("streak", "deficit", dates[-1]),
                category="streak",
                severity="warn",
                title=f"{deficit_streak}-day aggressive deficit streak",
                detail=f"Calories have been ≥300 kcal below target for {deficit_streak} consecutive days. Recovery nutrition may be needed.",
                metric_primary="calories",
                supporting={"streak": deficit_streak},
                action="Consider a refeed or maintenance day",
            ))

    # Poor sleep streak
    poor_sleep_streak = _streak(lambda v: v.get("sleep_hours") is not None and float(v["sleep_hours"]) < 6.5)
    if poor_sleep_streak >= 3:
        insights.append(SmartInsight(
            id=_insight_id("streak", "sleep", dates[-1]),
            category="streak",
            severity="warn",
            title=f"{poor_sleep_streak}-day sleep debt streak",
            detail=f"Sleep has been under 6.5h for {poor_sleep_streak} consecutive nights. Accumulating fatigue.",
            metric_primary="sleep_hours",
            supporting={"streak": poor_sleep_streak},
            action="Prioritise sleep — consider an earlier bedtime",
        ))

    # Missed protein streak
    if protein_goal and protein_goal > 0:
        miss_streak = _streak(lambda v: v.get("protein_g") is not None and float(v["protein_g"]) < protein_goal * 0.85)
        if miss_streak >= 4:
            insights.append(SmartInsight(
                id=_insight_id("streak", "protein", dates[-1]),
                category="streak",
                severity="warn",
                title=f"{miss_streak}-day protein miss streak",
                detail=f"Protein has been >15% below goal ({protein_goal:.0f}g) for {miss_streak} consecutive days.",
                metric_primary="protein_g",
                supporting={"streak": miss_streak, "goal": protein_goal},
                action="Add a high-protein snack to close the gap",
            ))

    # Training streak (good)
    logs = service.get_daily_logs(date.fromisoformat(dates[0]), date.fromisoformat(dates[-1]))
    logs_by_date = {l["log_date"]: l for l in logs}
    train_streak = 0
    for d in reversed(dates):
        if logs_by_date.get(d, {}).get("gym_done"):
            train_streak += 1
        else:
            break
    if train_streak >= 4:
        insights.append(SmartInsight(
            id=_insight_id("streak", "training", dates[-1]),
            category="streak",
            severity="good",
            title=f"{train_streak}-day training streak",
            detail=f"{train_streak} consecutive gym sessions. Great consistency!",
            metric_primary="gym_done",
            supporting={"streak": train_streak},
        ))

    return insights


# ─── Analyzer: trend shifts ───────────────────────────────────────────────────

SHIFT_METRICS = [
    ("weight_kg", False, "Weight"),
    ("rhr_bpm", True, "Resting HR"),
    ("hrv_ms", False, "HRV"),
    ("body_battery", False, "Body battery"),
]


def _analyzer_trend_shifts(window: dict) -> list[SmartInsight]:
    data = window["data"]
    dates = window["dates"]
    insights: list[SmartInsight] = []

    if len(dates) < 14:
        return insights

    last7 = dates[-7:]
    prior21 = dates[:-7]

    for metric, higher_is_bad, label in SHIFT_METRICS:
        recent = [float(data[d][metric]) for d in last7 if data[d].get(metric) is not None]
        prior = [float(data[d][metric]) for d in prior21 if data[d].get(metric) is not None]
        if len(recent) < 3 or len(prior) < 7:
            continue

        recent_mean = _mean(recent)
        prior_mean = _mean(prior)
        if prior_mean < 1e-6:
            continue

        shift_pct = (recent_mean - prior_mean) / prior_mean * 100
        prior_sd = _sd(prior)
        z = abs(recent_mean - prior_mean) / prior_sd if prior_sd > 1e-6 else 0

        if abs(shift_pct) < 4 and z < 0.8:
            continue

        worsening = (shift_pct > 0 and higher_is_bad) or (shift_pct < 0 and not higher_is_bad)
        severity = "warn" if worsening else "good"
        direction = "↑" if shift_pct > 0 else "↓"

        insights.append(SmartInsight(
            id=_insight_id("trend", metric, dates[-1]),
            category="trend",
            severity=severity,
            title=f"{label} {direction} {abs(shift_pct):.1f}% vs prior 3 weeks",
            detail=(
                f"Last 7 days average: {recent_mean:.1f}. "
                f"Prior 21 days average: {prior_mean:.1f}. "
                f"{'Trending in the wrong direction.' if worsening else 'Trending in the right direction.'}"
            ),
            metric_primary=metric,
            supporting={
                "recent_mean": round(recent_mean, 2),
                "prior_mean": round(prior_mean, 2),
                "shift_pct": round(shift_pct, 1),
            },
        ))

    return insights


# ─── Entry point ──────────────────────────────────────────────────────────────

def compute_smart_insights(
    service: "HealthAutoExportService",
    up_to: date,
    days: int = 30,
) -> list[SmartInsight]:
    window = _load_window(service, up_to, days)
    if len(window["dates"]) < 7:
        return []

    raw: list[SmartInsight] = []
    raw.extend(_analyzer_correlations(window))
    raw.extend(_analyzer_day_of_week(window))
    raw.extend(_analyzer_conditional(window, service))
    raw.extend(_analyzer_streaks(window, service))
    raw.extend(_analyzer_trend_shifts(window))

    severity_order = {"warn": 0, "good": 1, "info": 2}
    raw.sort(key=lambda x: severity_order.get(x.severity, 3))

    seen: set[str] = set()
    result: list[SmartInsight] = []
    for ins in raw:
        if ins.id not in seen:
            seen.add(ins.id)
            result.append(ins)

    return result
