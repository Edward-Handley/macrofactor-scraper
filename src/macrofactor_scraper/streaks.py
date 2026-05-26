"""Computed streaks and static badge definitions.

Streaks are derived on every read — nothing is stored. Badges persist in the
`badges` table but earned_at is computed by checking streak/data thresholds.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from macrofactor_scraper.health_export import HealthAutoExportService


def _consecutive_back(dates: set[str], from_date: date) -> int:
    """Count consecutive days going back from from_date (exclusive of from_date)."""
    streak = 0
    d = from_date - timedelta(days=1)
    for _ in range(365):
        if d.isoformat() in dates:
            streak += 1
            d -= timedelta(days=1)
        else:
            break
    return streak


def _consecutive_back_inclusive(dates: set[str], from_date: date) -> int:
    """Like _consecutive_back but includes from_date itself."""
    streak = 0
    d = from_date
    for _ in range(365):
        if d.isoformat() in dates:
            streak += 1
            d -= timedelta(days=1)
        else:
            break
    return streak


MILESTONE_NEXT = [3, 7, 14, 30, 60, 90, 180, 365]


def _next_milestone(current: int) -> int:
    for m in MILESTONE_NEXT:
        if m > current:
            return m
    return current + 365


def compute_streaks(
    service: "HealthAutoExportService",
    as_of: date | None = None,
    protein_goal_g: float | None = None,
    kcal_goal: int | None = None,
    steps_goal: int | None = None,
) -> list[dict]:
    as_of = as_of or date.today()
    window_start = (as_of - timedelta(days=365)).isoformat()
    as_of_str = as_of.isoformat()

    logs = service.get_daily_logs(date.fromisoformat(window_start), as_of)
    log_dates = {l["log_date"] for l in logs}
    log_by_date = {l["log_date"]: l for l in logs}

    # Fetch daily summaries for calorie/protein/steps streaks
    summaries = service._daily_summary_items(date.fromisoformat(window_start), as_of, include_hidden=True)
    summary_by_date = {s.date: s for s in summaries}

    # Garmin weight-in dates
    with service._connect() as conn:
        garmin_weights = conn.execute(
            "SELECT DISTINCT record_date FROM health_records WHERE metric_name IN ('weight_body_mass') AND source = 'Garmin' AND record_date >= ? AND record_date <= ?",
            (window_start, as_of_str),
        ).fetchall()
    garmin_weight_dates = {r["record_date"] for r in garmin_weights}

    def log_filled(d: str) -> bool:
        return d in log_dates

    def weighed_in(d: str) -> bool:
        l = log_by_date.get(d)
        if l and l.get("weight_kg") is not None:
            return True
        return d in garmin_weight_dates

    def gym_done(d: str) -> bool:
        l = log_by_date.get(d)
        return bool(l and l.get("gym_done"))

    def sleep_ok(d: str) -> bool:
        l = log_by_date.get(d)
        return bool(l and l.get("sleep_hours") is not None and float(l["sleep_hours"]) >= 7)

    def protein_hit(d: str) -> bool:
        if not protein_goal_g:
            return False
        s = summary_by_date.get(d)
        return bool(s and s.protein is not None and s.protein >= protein_goal_g)

    def kcal_within(d: str) -> bool:
        if not kcal_goal:
            return False
        s = summary_by_date.get(d)
        if not s or s.calories is None:
            return False
        return abs(s.calories - kcal_goal) <= kcal_goal * 0.05

    def steps_hit(d: str) -> bool:
        if not steps_goal:
            return False
        s = summary_by_date.get(d)
        return bool(s and s.steps is not None and s.steps >= steps_goal)

    # Compute all streaks
    all_dates = {(as_of - timedelta(days=i)).isoformat() for i in range(365)}

    def streak_for(pred) -> tuple[int, int]:
        """(current, longest) streak."""
        current = 0
        d = as_of
        for _ in range(365):
            if pred(d.isoformat()):
                current += 1
                d -= timedelta(days=1)
            else:
                break
        # Longest in past year
        longest = current
        run = 0
        for dd in sorted(all_dates):
            if pred(dd):
                run += 1
                longest = max(longest, run)
            else:
                run = 0
        return current, longest

    streaks = []

    cur, lon = streak_for(log_filled)
    streaks.append({"key": "log_filled", "label": "Daily log streak", "current": cur, "longest": lon, "milestone_next": _next_milestone(cur)})

    cur, lon = streak_for(weighed_in)
    streaks.append({"key": "weighed_in", "label": "Weigh-in streak", "current": cur, "longest": lon, "milestone_next": _next_milestone(cur)})

    cur, lon = streak_for(gym_done)
    streaks.append({"key": "gym_done", "label": "Gym streak", "current": cur, "longest": lon, "milestone_next": _next_milestone(cur)})

    cur, lon = streak_for(sleep_ok)
    streaks.append({"key": "sleep_7h", "label": "7h+ sleep streak", "current": cur, "longest": lon, "milestone_next": _next_milestone(cur)})

    if protein_goal_g:
        cur, lon = streak_for(protein_hit)
        streaks.append({"key": "protein_target", "label": "Protein goal streak", "current": cur, "longest": lon, "milestone_next": _next_milestone(cur)})

    if kcal_goal:
        cur, lon = streak_for(kcal_within)
        streaks.append({"key": "kcal_target", "label": "Calorie target streak", "current": cur, "longest": lon, "milestone_next": _next_milestone(cur)})

    if steps_goal:
        cur, lon = streak_for(steps_hit)
        streaks.append({"key": "steps_target", "label": "Steps goal streak", "current": cur, "longest": lon, "milestone_next": _next_milestone(cur)})

    return streaks


# Static badge definitions — earned_at is computed dynamically

BADGE_DEFINITIONS = [
    # Logging
    {"key": "log_7", "label": "First Week", "description": "7-day daily log streak", "icon": "📋", "category": "logging"},
    {"key": "log_30", "label": "Month Warrior", "description": "30-day daily log streak", "icon": "🗓️", "category": "logging"},
    {"key": "log_60", "label": "Two Month Club", "description": "60-day daily log streak", "icon": "📆", "category": "logging"},
    # Sleep
    {"key": "sleep_7", "label": "Sleep Architect", "description": "7 nights of 7h+ sleep in a row", "icon": "😴", "category": "recovery"},
    {"key": "sleep_14", "label": "Deep Rest", "description": "14 nights of 7h+ sleep in a row", "icon": "🌙", "category": "recovery"},
    # Protein
    {"key": "protein_7", "label": "Protein Hero", "description": "7-day protein goal streak", "icon": "💪", "category": "nutrition"},
    {"key": "protein_14", "label": "Protein Legend", "description": "14-day protein goal streak", "icon": "🥩", "category": "nutrition"},
    {"key": "protein_30", "label": "Protein Deity", "description": "30-day protein goal streak", "icon": "⚡", "category": "nutrition"},
    # Weigh-in
    {"key": "weigh_14", "label": "Scale Habit", "description": "14-day weigh-in streak", "icon": "⚖️", "category": "tracking"},
    {"key": "weigh_30", "label": "Data Nerd", "description": "30-day weigh-in streak", "icon": "📊", "category": "tracking"},
    # Gym
    {"key": "gym_first", "label": "First Session", "description": "Log your first gym session", "icon": "🏋️", "category": "training"},
    {"key": "gym_7", "label": "Consistent", "description": "7 gym sessions logged", "icon": "💥", "category": "training"},
    {"key": "gym_30", "label": "Gym Rat", "description": "30 gym sessions logged", "icon": "🦍", "category": "training"},
    # Cut phases
    {"key": "cut_week1", "label": "Cut Starter", "description": "Complete Week 1 of a cut phase", "icon": "🎯", "category": "body"},
    {"key": "cut_month1", "label": "Cut Survivor", "description": "Complete 30 days of a cut phase", "icon": "🔥", "category": "body"},
    # Steps
    {"key": "steps_7", "label": "Mover", "description": "7-day steps goal streak", "icon": "👟", "category": "activity"},
    # Photos
    {"key": "photo_first", "label": "First Progress Photo", "description": "Upload your first progress photo", "icon": "📸", "category": "tracking"},
    {"key": "photo_month", "label": "Photo Consistent", "description": "Progress photos in 4 different weeks", "icon": "🖼️", "category": "tracking"},
]


def compute_badges(
    service: "HealthAutoExportService",
    as_of: date | None = None,
    protein_goal_g: float | None = None,
    steps_goal: int | None = None,
) -> list[dict]:
    """Evaluate which badges are earned as of today."""
    as_of = as_of or date.today()
    window_start = (as_of - timedelta(days=365)).isoformat()
    as_of_str = as_of.isoformat()

    logs = service.get_daily_logs(date.fromisoformat(window_start), as_of)
    log_by_date = {l["log_date"]: l for l in logs}

    summaries = service._daily_summary_items(date.fromisoformat(window_start), as_of, include_hidden=True)
    summary_by_date = {s.date: s for s in summaries}

    # Count gym sessions
    gym_total = sum(1 for l in logs if l.get("gym_done"))

    # Streak helpers (longest streak in past year)
    def longest_streak(pred) -> int:
        best = run = 0
        for s in sorted(log_by_date.keys()):
            if pred(s):
                run += 1
                best = max(best, run)
            else:
                run = 0
        return best

    log_dates = set(log_by_date.keys())
    longest_log = longest_streak(lambda d: d in log_dates)
    longest_sleep = longest_streak(lambda d: (
        log_by_date.get(d, {}).get("sleep_hours") is not None
        and float(log_by_date[d]["sleep_hours"]) >= 7
    ))
    longest_protein = longest_streak(lambda d: (
        protein_goal_g is not None
        and (s := summary_by_date.get(d)) is not None
        and s.protein is not None
        and s.protein >= protein_goal_g
    )) if protein_goal_g else 0

    # Weigh-in streak
    with service._connect() as conn:
        garmin_weights = conn.execute(
            "SELECT DISTINCT record_date FROM health_records WHERE metric_name = 'weight_body_mass' AND source = 'Garmin' AND record_date >= ?",
            (window_start,),
        ).fetchall()
    garmin_weight_dates = {r["record_date"] for r in garmin_weights}
    weigh_dates = log_dates | garmin_weight_dates
    longest_weigh = longest_streak(lambda d: d in weigh_dates)

    # Steps streak
    longest_steps = longest_streak(lambda d: (
        steps_goal is not None
        and (s := summary_by_date.get(d)) is not None
        and s.steps is not None
        and s.steps >= steps_goal
    )) if steps_goal else 0

    # Cut phase days
    phases = service.get_cut_phases()
    max_cut_days = 0
    for p in phases:
        start = date.fromisoformat(p["start_date"])
        end_d = date.fromisoformat(p["end_date"]) if p.get("end_date") else as_of
        max_cut_days = max(max_cut_days, (end_d - start).days)

    # Photos
    photos = service.list_photos()
    photo_count = len({p["photo_date"] for p in photos})
    photo_weeks = len({date.fromisoformat(p["photo_date"]).isocalendar()[:2] for p in photos})

    earned: set[str] = set()
    if longest_log >= 7: earned.add("log_7")
    if longest_log >= 30: earned.add("log_30")
    if longest_log >= 60: earned.add("log_60")
    if longest_sleep >= 7: earned.add("sleep_7")
    if longest_sleep >= 14: earned.add("sleep_14")
    if longest_protein >= 7: earned.add("protein_7")
    if longest_protein >= 14: earned.add("protein_14")
    if longest_protein >= 30: earned.add("protein_30")
    if longest_weigh >= 14: earned.add("weigh_14")
    if longest_weigh >= 30: earned.add("weigh_30")
    if gym_total >= 1: earned.add("gym_first")
    if gym_total >= 7: earned.add("gym_7")
    if gym_total >= 30: earned.add("gym_30")
    if max_cut_days >= 7: earned.add("cut_week1")
    if max_cut_days >= 30: earned.add("cut_month1")
    if longest_steps >= 7: earned.add("steps_7")
    if photo_count >= 1: earned.add("photo_first")
    if photo_weeks >= 4: earned.add("photo_month")

    return [
        {**b, "earned": b["key"] in earned}
        for b in BADGE_DEFINITIONS
    ]
