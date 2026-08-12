"""On-demand AI analysis using Claude Haiku."""
from __future__ import annotations

import asyncio
import json
from collections import deque
from datetime import date, timedelta
from typing import TYPE_CHECKING, AsyncIterator

if TYPE_CHECKING:
    from macrofactor_scraper.health_export import HealthAutoExportService

# Simple in-memory rate limiter: max 3 calls per 10 minutes
_RATE_LIMIT_MAX = 3
_RATE_LIMIT_WINDOW = 600  # seconds
_call_times: deque[float] = deque()

VALID_TYPES = {"quick_summary", "weight_trend", "nutrition", "recovery"}

_TYPE_FRAMING: dict[str, str] = {
    "quick_summary": (
        "In 4–5 concise bullet points, summarise where this person currently stands. "
        "Cover: weight trend direction, calorie/protein adherence, recovery quality, "
        "and one actionable focus for the next few days. Be specific with numbers."
    ),
    "weight_trend": (
        "Analyse the rate of weight change over the data period. "
        "Is the trajectory on track for a cut? Identify any stalls or anomalies "
        "(e.g. water retention spikes after high-carb days). "
        "Give a concrete rate-per-week estimate and state whether adjustments are needed."
    ),
    "nutrition": (
        "Evaluate macro consistency. Focus on: protein target adherence (hitting goal daily vs. averaging), "
        "calorie variance day-to-day, and any patterns of under/over-eating. "
        "Give 2–3 specific, numbered recommendations."
    ),
    "recovery": (
        "Assess recovery quality based on the HRV, RHR, sleep hours, and subjective scores. "
        "Identify trends (improving / declining / stable). Flag any days where training load "
        "didn't match recovery capacity. Give a recovery rating out of 10 and one key recommendation."
    ),
}


def check_rate_limit() -> None:
    import time
    now = time.time()
    cutoff = now - _RATE_LIMIT_WINDOW
    while _call_times and _call_times[0] < cutoff:
        _call_times.popleft()
    if len(_call_times) >= _RATE_LIMIT_MAX:
        raise RateLimitError("Too many AI analysis requests. Try again in a few minutes.")
    _call_times.append(now)


class RateLimitError(Exception):
    pass


def _build_snapshot(service: "HealthAutoExportService", up_to: date) -> str:
    start = up_to - timedelta(days=13)
    summaries = service.dashboard_summary(start, up_to).summaries
    logs = service.get_daily_logs(start, up_to)
    logs_by_date = {lg["log_date"]: lg for lg in logs}

    lines: list[str] = ["=== 14-Day Health Snapshot ===\n"]
    for s in sorted(summaries, key=lambda x: x.date):
        d = s.date.isoformat()
        lg = logs_by_date.get(d, {})
        parts: list[str] = [d]
        if s.weight is not None:
            parts.append(f"weight={s.weight:.1f}kg")
        if s.calories is not None:
            parts.append(f"cal={s.calories:.0f}")
        if s.protein is not None:
            parts.append(f"P={s.protein:.0f}g")
        if s.carbohydrates is not None:
            parts.append(f"C={s.carbohydrates:.0f}g")
        if s.fat is not None:
            parts.append(f"F={s.fat:.0f}g")
        if s.steps is not None:
            parts.append(f"steps={s.steps:.0f}")
        if s.active_energy is not None:
            parts.append(f"active={s.active_energy:.0f}kcal")
        if lg.get("hrv_overnight") is not None:
            parts.append(f"HRV={lg['hrv_overnight']}ms")
        if lg.get("rhr") is not None:
            parts.append(f"RHR={lg['rhr']}bpm")
        if lg.get("sleep_hours") is not None:
            parts.append(f"sleep={lg['sleep_hours']}h")
        if lg.get("am_energy") is not None:
            parts.append(f"AM_energy={lg['am_energy']}/10")
        if lg.get("pm_energy") is not None:
            parts.append(f"PM_energy={lg['pm_energy']}/10")
        if lg.get("soreness") is not None:
            parts.append(f"soreness={lg['soreness']}/10")
        if lg.get("training_type"):
            parts.append(f"training={lg['training_type']}")
        if lg.get("gym_rpe") is not None:
            parts.append(f"RPE={lg['gym_rpe']}")
        lines.append("  ".join(parts))

    return "\n".join(lines)


def _build_prompt(snapshot: str, analysis_type: str, cut_context: str | None) -> str:
    framing = _TYPE_FRAMING.get(analysis_type, _TYPE_FRAMING["quick_summary"])
    header = "You are a concise, data-driven health coach. Analyse the following data and respond in plain markdown."
    if cut_context:
        header += f"\nContext: {cut_context}"
    return f"{header}\n\n{snapshot}\n\n---\n{framing}"


async def run_analysis(
    service: "HealthAutoExportService",
    analysis_date: date,
    analysis_type: str,
    api_key: str,
) -> dict:
    if analysis_type not in VALID_TYPES:
        analysis_type = "quick_summary"

    snapshot = await asyncio.to_thread(_build_snapshot, service, analysis_date)

    # Pull active cut phase context
    cut_context: str | None = None
    active_phase = service.get_active_cut_phase()
    if active_phase:
        cut_context = f"Active cut: {active_phase['name']}"
        if active_phase.get("target_calories"):
            cut_context += f", target {active_phase['target_calories']} kcal"
        if active_phase.get("target_weight_kg"):
            cut_context += f", target weight {active_phase['target_weight_kg']} kg"

    prompt = _build_prompt(snapshot, analysis_type, cut_context)

    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    response = await asyncio.to_thread(
        lambda: client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=700,
            messages=[{"role": "user", "content": prompt}],
        )
    )
    analysis_text = response.content[0].text if response.content else ""
    tokens_used = (response.usage.input_tokens or 0) + (response.usage.output_tokens or 0)

    return {
        "analysis": analysis_text,
        "model": "claude-haiku-4-5-20251001",
        "tokens_used": tokens_used,
    }


_CHAT_SYSTEM = (
    "You are a concise, data-driven health coach. "
    "The user's health data snapshot is embedded in the first message. "
    "Answer questions and give coaching advice based on the data. "
    "Be specific with numbers. Respond in plain markdown (no LaTeX)."
)

_FRAMING_INTRO: dict[str, str] = {
    "check_in": "You are reviewing today's check-in data. Provide daily coaching feedback.",
    "weekly": "You are doing a weekly review. Summarise progress vs targets and set next-week goals.",
    "plateau": "Weight progress has stalled. Diagnose causes and suggest concrete adjustments.",
    "cut_reassess": "Reassess the current cut phase: rate of loss, muscle retention, recovery quality.",
    "free": "Answer freely based on the data provided.",
    "performance_day": (
        "You are a performance coach reviewing today's training context. "
        "Based on the athlete's readiness, recent load (ACWR), and activities, "
        "recommend today's training: what to do, how hard, and why. Be concise and specific."
    ),
    "performance_week": (
        "You are a performance coach doing a weekly training review. "
        "Analyse load progression, swim volume and pace trends, recovery quality, and goal progress. "
        "Set 2-3 specific targets for next week."
    ),
}


async def stream_chat(
    messages: list[dict],
    api_key: str,
) -> AsyncIterator[str]:
    """Stream a chat response from Claude. Yields JSON strings: {"delta":"..."} or {"done":true,"tokens":N}."""
    import anthropic

    check_rate_limit()
    client = anthropic.AsyncAnthropic(api_key=api_key)

    async with client.messages.stream(
        model="claude-haiku-4-5-20251001",
        max_tokens=1200,
        system=_CHAT_SYSTEM,
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            yield json.dumps({"delta": text})
        final = await stream.get_final_message()
        tokens = (final.usage.input_tokens or 0) + (final.usage.output_tokens or 0)
        yield json.dumps({"done": True, "tokens": tokens})


def build_chat_system_message(snapshot: str, framing: str | None) -> str:
    """Build the system-level context block injected as the first user turn."""
    intro = _FRAMING_INTRO.get(framing or "free", _FRAMING_INTRO["free"])
    return f"{intro}\n\n{snapshot}"


def _build_weekly_snapshot(service: "HealthAutoExportService", week_start: date) -> str:
    week_end = week_start + timedelta(days=6)
    summaries = service.dashboard_summary(week_start, week_end).summaries
    logs = service.get_daily_logs(week_start, week_end)
    logs_by_date = {lg["log_date"]: lg for lg in logs}

    lines: list[str] = [f"=== Weekly Snapshot ({week_start.isoformat()} – {week_end.isoformat()}) ===\n"]
    weights, cals, proteins, sleeps, hrvs = [], [], [], [], []
    gym_days = 0
    for s in sorted(summaries, key=lambda x: x.date):
        d = s.date.isoformat()
        lg = logs_by_date.get(d, {})
        parts: list[str] = [d]
        if s.weight is not None:
            parts.append(f"weight={s.weight:.1f}kg")
            weights.append(s.weight)
        if s.calories is not None:
            parts.append(f"cal={s.calories:.0f}")
            cals.append(s.calories)
        if s.protein is not None:
            parts.append(f"P={s.protein:.0f}g")
            proteins.append(s.protein)
        if s.steps is not None:
            parts.append(f"steps={s.steps:.0f}")
        if lg.get("hrv_overnight") is not None:
            parts.append(f"HRV={lg['hrv_overnight']}ms")
            hrvs.append(float(lg["hrv_overnight"]))
        if lg.get("rhr") is not None:
            parts.append(f"RHR={lg['rhr']}bpm")
        if lg.get("sleep_hours") is not None:
            parts.append(f"sleep={lg['sleep_hours']}h")
            sleeps.append(float(lg["sleep_hours"]))
        if lg.get("am_energy") is not None:
            parts.append(f"AM_energy={lg['am_energy']}/10")
        if lg.get("gym_done"):
            gym_days += 1
            if lg.get("gym_rpe") is not None:
                parts.append(f"RPE={lg['gym_rpe']}")
        if lg.get("training_type"):
            parts.append(f"training={lg['training_type']}")
        lines.append("  ".join(parts))

    lines.append("")
    lines.append("=== Week Averages ===")
    if weights:
        lines.append(f"Avg weight: {sum(weights)/len(weights):.1f} kg")
    if cals:
        lines.append(f"Avg calories: {sum(cals)/len(cals):.0f} kcal")
    if proteins:
        lines.append(f"Avg protein: {sum(proteins)/len(proteins):.0f} g")
    if sleeps:
        lines.append(f"Avg sleep: {sum(sleeps)/len(sleeps):.1f} h")
    if hrvs:
        lines.append(f"Avg HRV: {sum(hrvs)/len(hrvs):.0f} ms")
    lines.append(f"Training sessions: {gym_days}")

    return "\n".join(lines)


async def generate_weekly_recap(
    service: "HealthAutoExportService",
    week_start: date,
    api_key: str,
) -> dict:
    snapshot = await asyncio.to_thread(_build_weekly_snapshot, service, week_start)
    week_end = week_start + timedelta(days=6)

    cut_context: str | None = None
    active_phase = service.get_active_cut_phase()
    if active_phase:
        cut_context = f"Active cut phase: {active_phase['name']}"
        if active_phase.get("target_calories"):
            cut_context += f", target {active_phase['target_calories']} kcal/day"

    prompt = (
        "You are a concise, data-driven health coach writing a weekly recap journal entry. "
        "Respond in plain markdown with NO headers — just flowing prose paragraphs. "
        "Keep it under 200 words. Be specific with numbers. Be encouraging but honest.\n"
    )
    if cut_context:
        prompt += f"Context: {cut_context}\n"
    prompt += f"\n{snapshot}\n\n---\n"
    prompt += (
        "Write a 3–4 sentence weekly narrative covering: overall progress this week, "
        "standout wins or concerns, and one concrete focus for next week. "
        "Then on a new line output a JSON array of 3–5 short highlight strings "
        "(e.g. [\"Hit protein 6/7 days\", \"Best HRV all month\"]). "
        "Format: narrative text THEN a line starting with ```json followed by the array."
    )

    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    response = await asyncio.to_thread(
        lambda: client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
        )
    )
    raw = response.content[0].text if response.content else ""
    tokens_used = (response.usage.input_tokens or 0) + (response.usage.output_tokens or 0)

    # Split narrative from highlights JSON block
    narrative = raw
    highlights: list[str] = []
    if "```json" in raw:
        parts = raw.split("```json", 1)
        narrative = parts[0].strip()
        json_block = parts[1].split("```")[0].strip()
        try:
            import json
            parsed = json.loads(json_block)
            if isinstance(parsed, list):
                highlights = [str(h) for h in parsed]
        except Exception:
            pass

    return {
        "week_start_date": week_start.isoformat(),
        "week_end_date": week_end.isoformat(),
        "narrative": narrative,
        "highlights": highlights,
        "model": "claude-haiku-4-5-20251001",
        "tokens_used": tokens_used,
    }


def _build_performance_snapshot(service: "HealthAutoExportService", up_to: date) -> str:
    """Build a 14-day performance snapshot: activities, load/ACWR, recovery, goals."""
    start = up_to - timedelta(days=13)
    from macrofactor_scraper.performance import daily_load_series, compute_acwr, swim_analytics
    from macrofactor_scraper._activities import list_activities as _list_acts

    # Daily load + ACWR
    # Need 28d window for CTL
    load_start = up_to - timedelta(days=27)
    all_series = daily_load_series(service, load_start, up_to)
    acwr_data = compute_acwr(all_series)
    series_14d = acwr_data["series"][-14:]

    # Activities for period
    with service._connect() as conn:
        act_rows = conn.execute(
            """
            SELECT sport, activity_date, duration_seconds, distance_m,
                   training_load, load_source, avg_pace_s_per_100m, avg_hr, avg_swolf
            FROM activities
            WHERE activity_date BETWEEN ? AND ?
            ORDER BY activity_date ASC
            """,
            (start.isoformat(), up_to.isoformat()),
        ).fetchall()
    acts_by_date: dict[str, list] = {}
    for r in act_rows:
        acts_by_date.setdefault(r["activity_date"], []).append(dict(r))

    # Garmin health metrics
    with service._connect() as conn:
        health_rows = conn.execute(
            """
            SELECT metric_name, quantity, record_date FROM health_records
            WHERE source = 'Garmin'
              AND metric_name IN ('hrv_overnight', 'resting_heart_rate', 'sleep_minutes',
                                   'training_readiness_score', 'body_battery_high')
              AND record_date BETWEEN ? AND ?
            ORDER BY record_date ASC
            """,
            (start.isoformat(), up_to.isoformat()),
        ).fetchall()
    health_by_date: dict[str, dict] = {}
    for r in health_rows:
        health_by_date.setdefault(r["record_date"], {})[r["metric_name"]] = float(r["quantity"])

    # Active goals
    with service._connect() as conn:
        goal_rows = conn.execute(
            "SELECT name, goal_type, target_value, unit, target_date FROM performance_goals WHERE active = 1"
        ).fetchall()
    goals = [dict(r) for r in goal_rows]

    lines: list[str] = [f"=== 14-Day Performance Snapshot (up to {up_to.isoformat()}) ===\n"]

    for entry in series_14d:
        d = entry["date"]
        parts: list[str] = [d]
        if entry["load"] > 0:
            parts.append(f"load={entry['load']:.0f}")
        if entry["atl"] > 0:
            parts.append(f"ATL={entry['atl']:.0f}")
        if entry["acwr"] is not None:
            parts.append(f"ACWR={entry['acwr']:.2f}")
        # Activities
        for act in acts_by_date.get(d, []):
            sport = act["sport"]
            dur_min = round(act["duration_seconds"] / 60, 0) if act.get("duration_seconds") else None
            act_parts = [sport]
            if dur_min:
                act_parts.append(f"{dur_min:.0f}min")
            if act.get("distance_m"):
                act_parts.append(f"{act['distance_m']:.0f}m")
            if act.get("avg_pace_s_per_100m"):
                m = int(act["avg_pace_s_per_100m"] // 60)
                s = int(act["avg_pace_s_per_100m"] % 60)
                act_parts.append(f"{m}:{s:02d}/100m")
            if act.get("avg_swolf"):
                act_parts.append(f"SWOLF={act['avg_swolf']:.0f}")
            parts.append("[" + " ".join(act_parts) + "]")
        # Recovery
        health = health_by_date.get(d, {})
        if health.get("hrv_overnight"):
            parts.append(f"HRV={health['hrv_overnight']:.0f}ms")
        if health.get("resting_heart_rate"):
            parts.append(f"RHR={health['resting_heart_rate']:.0f}bpm")
        if health.get("sleep_minutes"):
            parts.append(f"sleep={health['sleep_minutes']/60:.1f}h")
        if health.get("training_readiness_score"):
            parts.append(f"readiness={health['training_readiness_score']:.0f}")
        lines.append("  ".join(parts))

    # ACWR status
    lines.append(f"\nCurrent ACWR: {acwr_data['current_acwr']:.2f} ({acwr_data['status']})" if acwr_data["current_acwr"] else "\nACWR: insufficient data")

    # Goals
    if goals:
        lines.append("\n=== Active Goals ===")
        for g in goals:
            goal_str = g["name"]
            if g.get("target_value") and g.get("unit"):
                goal_str += f" — target {g['target_value']} {g['unit']}"
            if g.get("target_date"):
                goal_str += f" by {g['target_date']}"
            lines.append(goal_str)

    return "\n".join(lines)


async def generate_daily_recommendation(
    service: "HealthAutoExportService",
    for_date: date,
    api_key: str,
) -> dict:
    """Generate a short daily training recommendation for performance mode."""
    snapshot = await asyncio.to_thread(_build_performance_snapshot, service, for_date)

    prompt = (
        "You are a performance coach. Based on the athlete's 14-day data below, "
        "write a concise daily training recommendation (under 150 words). "
        "Cover: train or rest, intensity/effort level, suggested session type or specific set, "
        "and the main reason. Be direct and specific.\n\n"
        f"{snapshot}"
    )

    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    response = await asyncio.to_thread(
        lambda: client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
    )
    text = response.content[0].text if response.content else ""
    tokens_used = (response.usage.input_tokens or 0) + (response.usage.output_tokens or 0)

    return {
        "recommendation": text,
        "model": "claude-haiku-4-5-20251001",
        "tokens_used": tokens_used,
    }


async def generate_performance_review(
    service: "HealthAutoExportService",
    week_start: date,
    api_key: str,
) -> dict:
    """Generate a weekly performance review (parallel to generate_weekly_recap)."""
    week_end = week_start + timedelta(days=6)
    snapshot = await asyncio.to_thread(_build_performance_snapshot, service, week_end)

    prompt = (
        "You are a performance coach writing a weekly training review. "
        "Respond in plain markdown with NO headers — flowing prose paragraphs, under 200 words. "
        "Be specific with numbers. Then output a JSON array of 3–5 short highlight strings.\n\n"
        f"{snapshot}\n\n---\n"
        "Write a 3–4 sentence weekly training narrative: load progression, swim volume/pace, "
        "recovery quality, key win or concern, and one concrete focus for next week. "
        "Then output a line starting with ```json followed by the highlights array."
    )

    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    response = await asyncio.to_thread(
        lambda: client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
        )
    )
    raw = response.content[0].text if response.content else ""
    tokens_used = (response.usage.input_tokens or 0) + (response.usage.output_tokens or 0)

    narrative = raw
    highlights: list[str] = []
    if "```json" in raw:
        parts = raw.split("```json", 1)
        narrative = parts[0].strip()
        json_block = parts[1].split("```")[0].strip()
        try:
            parsed = json.loads(json_block)
            if isinstance(parsed, list):
                highlights = [str(h) for h in parsed]
        except Exception:
            pass

    return {
        "week_start_date": week_start.isoformat(),
        "narrative": narrative,
        "highlights": highlights,
        "model": "claude-haiku-4-5-20251001",
        "tokens_used": tokens_used,
    }
