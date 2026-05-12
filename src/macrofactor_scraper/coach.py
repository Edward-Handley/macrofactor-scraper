"""Coach prompt builder — assembles a daily check-in prompt from stored data."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any


@dataclass
class CoachData:
    checkin_date: str
    cut_phase: str | None = None
    week_number: int | None = None
    # Nutrition (yesterday)
    calories: float | None = None
    protein: float | None = None
    carbohydrates: float | None = None
    fat: float | None = None
    water_litres: float | None = None
    # Activity (yesterday)
    steps: float | None = None
    active_energy: float | None = None
    # Body
    weight_today: float | None = None
    weight_7d_avg: float | None = None
    weight_delta_7d: float | None = None
    # Sleep / recovery
    sleep_hours: float | None = None
    sleep_quality: int | None = None
    sleep_score: int | None = None
    rhr: int | None = None
    hrv_overnight: int | None = None
    # Subjective AM
    am_energy: int | None = None
    soreness: int | None = None
    # Training
    training_type: str | None = None
    gym_done: bool | None = None
    gym_minutes: int | None = None
    gym_rpe: float | None = None
    gym_notes: str | None = None
    cardio_type: str | None = None
    cardio_minutes: int | None = None
    cardio_avg_hr: int | None = None
    # General
    notes: str | None = None
    # Body measurements (if today is Monday or recent)
    recent_measurements: dict[str, float] = field(default_factory=dict)


def _fmt_opt(label: str, value: Any, unit: str = "", decimals: int = 0) -> str | None:
    if value is None:
        return None
    if isinstance(value, float):
        formatted = f"{value:.{decimals}f}"
    else:
        formatted = str(value)
    suffix = f" {unit}" if unit else ""
    return f"{label}: {formatted}{suffix}"


def _scale_label(value: int | None, low: str, mid: str, high: str) -> str:
    if value is None:
        return "—"
    if value <= 3:
        return f"{value}/10 ({low})"
    if value <= 7:
        return f"{value}/10 ({mid})"
    return f"{value}/10 ({high})"


def build_prompt(data: CoachData) -> str:
    lines: list[str] = []

    # Header
    phase_line = ""
    if data.cut_phase:
        phase_line = f" | {data.cut_phase}"
        if data.week_number:
            phase_line += f" Week {data.week_number}"
    lines.append(f"## Daily Check-In — {data.checkin_date}{phase_line}")
    lines.append("")

    # Body / weight
    lines.append("### Body")
    if data.weight_today is not None:
        weight_str = f"{data.weight_today:.2f} kg"
        if data.weight_delta_7d is not None:
            sign = "+" if data.weight_delta_7d >= 0 else ""
            weight_str += f"  (7d avg: {data.weight_7d_avg:.2f} kg, delta: {sign}{data.weight_delta_7d:.2f} kg)"
        lines.append(f"Weight: {weight_str}")
    else:
        lines.append("Weight: not logged")

    # Measurements
    if data.recent_measurements:
        meas_parts = []
        labels = {
            "waist_cm": "Waist", "chest_cm": "Chest",
            "l_arm_cm": "L Arm", "r_arm_cm": "R Arm",
            "l_thigh_cm": "L Thigh", "r_thigh_cm": "R Thigh",
            "hip_cm": "Hip",
        }
        for k, label in labels.items():
            if k in data.recent_measurements:
                meas_parts.append(f"{label}: {data.recent_measurements[k]:.1f} cm")
        if meas_parts:
            lines.append("Measurements: " + " | ".join(meas_parts))
    lines.append("")

    # Nutrition (yesterday)
    lines.append("### Nutrition (yesterday)")
    if data.calories is not None:
        lines.append(f"Calories: {data.calories:.0f} kcal")
    if data.protein is not None:
        lines.append(f"Protein: {data.protein:.0f} g")
    if data.carbohydrates is not None:
        lines.append(f"Carbs: {data.carbohydrates:.0f} g")
    if data.fat is not None:
        lines.append(f"Fat: {data.fat:.0f} g")
    if data.water_litres is not None:
        lines.append(f"Water: {data.water_litres:.1f} L")
    elif data.calories is None:
        lines.append("(no nutrition data logged)")
    lines.append("")

    # Activity (yesterday)
    lines.append("### Activity (yesterday)")
    parts = []
    if data.steps is not None:
        parts.append(f"Steps: {data.steps:.0f}")
    if data.active_energy is not None:
        parts.append(f"Active energy: {data.active_energy:.0f} kcal")
    lines.append(" | ".join(parts) if parts else "(no activity data)")
    lines.append("")

    # Sleep / recovery
    lines.append("### Sleep & Recovery (last night)")
    sleep_parts = []
    if data.sleep_hours is not None:
        sleep_parts.append(f"{data.sleep_hours:.1f} hrs")
    if data.sleep_score is not None:
        sleep_parts.append(f"score {data.sleep_score}/100")
    if data.sleep_quality is not None:
        sleep_parts.append(f"quality {_scale_label(data.sleep_quality, 'poor', 'ok', 'great')}")
    lines.append("Sleep: " + (" | ".join(sleep_parts) if sleep_parts else "not logged"))
    if data.rhr is not None:
        lines.append(f"RHR: {data.rhr} bpm")
    if data.hrv_overnight is not None:
        lines.append(f"HRV: {data.hrv_overnight} ms")
    lines.append("")

    # Subjective (this morning)
    lines.append("### Subjective (this morning)")
    lines.append(f"Energy: {_scale_label(data.am_energy, 'low', 'moderate', 'high')}")
    lines.append(f"Soreness: {_scale_label(data.soreness, 'none', 'moderate', 'high')}")
    lines.append("")

    # Training
    lines.append("### Training")
    if data.training_type:
        type_label = data.training_type.replace("_", " ").title()
        if data.training_type == "rest":
            lines.append("Rest day")
        else:
            train_parts = [type_label]
            if data.gym_done is not None:
                train_parts.append("✓ gym done" if data.gym_done else "✗ gym skipped")
            if data.gym_minutes is not None:
                train_parts.append(f"{data.gym_minutes} min")
            if data.gym_rpe is not None:
                train_parts.append(f"RPE {data.gym_rpe:.0f}/10")
            lines.append(" | ".join(train_parts))
            if data.gym_notes:
                lines.append(f"Notes: {data.gym_notes}")
            if data.cardio_type:
                cardio_parts = [data.cardio_type]
                if data.cardio_minutes is not None:
                    cardio_parts.append(f"{data.cardio_minutes} min")
                if data.cardio_avg_hr is not None:
                    cardio_parts.append(f"avg HR {data.cardio_avg_hr} bpm")
                lines.append("Cardio: " + " | ".join(cardio_parts))
    else:
        lines.append("(not yet logged)")
    lines.append("")

    # Notes
    if data.notes:
        lines.append("### Notes")
        lines.append(data.notes)
        lines.append("")

    # Footer prompt
    lines.append("---")
    lines.append(
        "Based on the above, please provide your daily coaching feedback: "
        "progress assessment, any concerns, macro/training adjustments if needed, "
        "and key focus for today."
    )

    return "\n".join(lines)


def _get_garmin_values(service: Any, record_date: date) -> dict[str, float]:
    """Query health_records for Garmin-sourced metrics for a single date."""
    try:
        with service._connect() as conn:
            rows = conn.execute(
                "SELECT metric_name, quantity FROM health_records WHERE record_date = ? AND source = 'Garmin'",
                (record_date.isoformat(),),
            ).fetchall()
        return {row["metric_name"]: float(row["quantity"]) for row in rows}
    except Exception:
        return {}


def build_coach_data(service: Any, checkin_date: date) -> CoachData:
    """Assemble CoachData from the service for a given date."""
    yesterday = checkin_date - timedelta(days=1)
    seven_ago = checkin_date - timedelta(days=7)

    # Yesterday's nutrition + activity via daily_summary
    summary_items = service.daily_summary(yesterday, yesterday).summaries
    yest = summary_items[0] if summary_items else None

    # Weight today + 7d avg
    weight_items = service.daily_summary(seven_ago, checkin_date).summaries
    weights = [s.weight for s in weight_items if s.weight is not None]
    weight_today_items = [s.weight for s in weight_items if s.date == checkin_date and s.weight is not None]
    weight_today = weight_today_items[0] if weight_today_items else (weights[-1] if weights else None)
    weight_7d_avg = sum(weights) / len(weights) if weights else None
    weight_delta_7d = (weight_today - weight_7d_avg) if (weight_today is not None and weight_7d_avg is not None) else None

    # Today's daily_log (training, subjective AM scores, cut phase)
    log = service.get_daily_log(checkin_date.isoformat())
    # Yesterday's daily_log (sleep data entered the previous evening or morning)
    yesterday_log = service.get_daily_log(yesterday.isoformat())

    # Garmin data for yesterday — authoritative for sleep, steps, RHR, HRV
    garmin = _get_garmin_values(service, yesterday)

    # Recent measurements (last entry)
    meas_rows = service.get_measurements(seven_ago, checkin_date)
    recent_meas: dict[str, float] = {}
    if meas_rows:
        latest = meas_rows[0]  # ordered DESC
        for k in ("waist_cm", "chest_cm", "l_arm_cm", "r_arm_cm", "l_thigh_cm", "r_thigh_cm", "hip_cm"):
            if latest.get(k) is not None:
                recent_meas[k] = float(latest[k])

    # Water: prefer daily_log override, fall back to Apple Health
    water_litres: float | None = None
    if log and log.get("water_litres") is not None:
        water_litres = float(log["water_litres"])
    elif yest and yest.water is not None:
        water_litres = round(yest.water / 1000, 2)  # mL → L

    # Steps: prefer Garmin (more accurate) over Apple Health
    steps: float | None = garmin.get("garmin_steps") or (yest.steps if yest else None)

    # Sleep: prefer Garmin (yesterday) → yesterday's manual log entry
    garmin_sleep_mins = garmin.get("sleep_minutes")
    sleep_hours: float | None = (
        round(garmin_sleep_mins / 60, 2) if garmin_sleep_mins is not None
        else (float(yesterday_log["sleep_hours"]) if yesterday_log and yesterday_log.get("sleep_hours") is not None else None)
    )
    sleep_score: int | None = (
        int(round(garmin.get("sleep_score"))) if garmin.get("sleep_score") is not None
        else (yesterday_log.get("sleep_score") if yesterday_log else None)
    )

    # RHR + HRV: prefer Garmin (yesterday) → yesterday's manual log entry
    rhr: int | None = (
        int(round(garmin.get("resting_heart_rate"))) if garmin.get("resting_heart_rate") is not None
        else (yesterday_log.get("rhr") if yesterday_log else None)
    )
    hrv_overnight: int | None = (
        int(round(garmin.get("hrv_overnight"))) if garmin.get("hrv_overnight") is not None
        else (yesterday_log.get("hrv_overnight") if yesterday_log else None)
    )

    # Active cut phase
    phase = service.get_active_cut_phase()

    data = CoachData(
        checkin_date=checkin_date.isoformat(),
        cut_phase=phase["name"] if phase else (log.get("cut_phase") if log else None),
        week_number=log.get("week_number") if log else None,
        calories=yest.calories if yest else None,
        protein=yest.protein if yest else None,
        carbohydrates=yest.carbohydrates if yest else None,
        fat=yest.fat if yest else None,
        water_litres=water_litres,
        steps=steps,
        active_energy=yest.active_energy if yest else None,
        weight_today=weight_today,
        weight_7d_avg=weight_7d_avg,
        weight_delta_7d=weight_delta_7d,
        sleep_hours=sleep_hours,
        sleep_quality=yesterday_log.get("sleep_quality") if yesterday_log else None,
        sleep_score=sleep_score,
        rhr=rhr,
        hrv_overnight=hrv_overnight,
        am_energy=log.get("am_energy") if log else None,
        soreness=log.get("soreness") if log else None,
        training_type=log.get("training_type") if log else None,
        gym_done=bool(log["gym_done"]) if log and log.get("gym_done") is not None else None,
        gym_minutes=log.get("gym_minutes") if log else None,
        gym_rpe=float(log["gym_rpe"]) if log and log.get("gym_rpe") is not None else None,
        gym_notes=log.get("gym_notes") if log else None,
        cardio_type=log.get("cardio_type") if log else None,
        cardio_minutes=log.get("cardio_minutes") if log else None,
        cardio_avg_hr=log.get("cardio_avg_hr") if log else None,
        notes=log.get("notes") if log else None,
        recent_measurements=recent_meas,
    )
    return data
