"""On-demand AI analysis using Claude Haiku."""
from __future__ import annotations

import asyncio
from collections import deque
from datetime import date, timedelta
from typing import TYPE_CHECKING

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
