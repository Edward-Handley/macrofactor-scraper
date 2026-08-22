"""Nutrition intelligence: classify training days, compare actual intake against
water-polo-specific macro targets, and generate alerts + meal suggestions.

All computation is lazy — performed on request, nothing persisted beyond the
nutrition_preferences table.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from macrofactor_scraper.config import Settings
from macrofactor_scraper.health_export import HealthAutoExportService
from macrofactor_scraper.service import MacroFactorReadService

ATHELETE_WEIGHT_KG = 91.0

SCENARIO_TARGETS: dict[str, dict[str, tuple[float, float]]] = {
    "double_wp": {
        "calories": (3900, 4800),
        "carbs_g": (640, 910),
        "protein_g": (164, 182),
        "fat_g": (87, 133),
    },
    "double_mixed": {
        "calories": (3400, 4000),
        "carbs_g": (545, 728),
        "protein_g": (146, 182),
        "fat_g": (76, 133),
    },
    "single": {
        "calories": (2800, 3400),
        "carbs_g": (455, 637),
        "protein_g": (146, 146),
        "fat_g": (62, 113),
    },
    "rest": {
        "calories": (2200, 2600),
        "carbs_g": (273, 364),
        "protein_g": (127, 146),
        "fat_g": (61, 101),
    },
}

SCENARIO_LABELS = {
    "double_wp": "Double Water Polo",
    "double_mixed": "Double Session (Mixed)",
    "single": "Single Training",
    "rest": "Rest / Recovery",
}

_WATER_POLO_KEYS = ("polo",)
_SWIM_KEYS = ("swim",)
_GYM_KEYS = ("strength", "gym", "weight", "resistance", "training")

_LONG_SESSION_SECONDS = 90 * 60  # 90 min


def _sport_kind(sport: str | None) -> str | None:
    if not sport:
        return None
    s = sport.lower()
    if any(k in s for k in _WATER_POLO_KEYS):
        return "water_polo"
    if any(k in s for k in _SWIM_KEYS):
        return "swim"
    if any(k in s for k in _GYM_KEYS):
        return "gym"
    return "other"


def classify_day(service: HealthAutoExportService, target_date: date) -> dict[str, Any]:
    """Classify a day into a training scenario from the activities table."""
    service._ensure_schema()
    with service._connect() as conn:
        rows = conn.execute(
            "SELECT sport, duration_seconds FROM activities WHERE activity_date = ?",
            (target_date.isoformat(),),
        ).fetchall()

    wp_sessions = 0
    other_sessions = 0
    total_seconds = 0.0
    sports: list[str] = []
    for row in rows:
        sport = str(row["sport"] or "")
        duration = float(row["duration_seconds"] or 0)
        kind = _sport_kind(sport)
        total_seconds += duration
        if sport and sport not in sports:
            sports.append(sport)
        if kind == "water_polo" and duration >= _LONG_SESSION_SECONDS:
            wp_sessions += 1
        elif kind is not None and duration > 0:
            other_sessions += 1

    session_count = wp_sessions + other_sessions
    if wp_sessions >= 2:
        intensity = "double_wp"
    elif session_count >= 2:
        intensity = "double_mixed"
    elif session_count == 1:
        intensity = "single"
    else:
        intensity = "rest"

    return {
        "intensity": intensity,
        "label": SCENARIO_LABELS[intensity],
        "hours": round(total_seconds / 3600.0, 2) if total_seconds else None,
        "sports": sports,
        "session_count": session_count,
    }


def _macros_from_food_log(raw: dict[str, Any]) -> dict[str, float | None]:
    """Aggregate macros from a MacroFactor food_log document (best-effort key scan)."""
    totals = {"calories": 0.0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0}
    found = False

    def walk(node: Any) -> None:
        nonlocal found
        if isinstance(node, dict):
            for key, value in node.items():
                lk = str(key).lower()
                if isinstance(value, (int, float)):
                    if lk in ("calories", "energy", "kcal", "caloriesconsumed"):
                        totals["calories"] += float(value)
                        found = True
                    elif lk in ("protein", "protein_g", "proteingrams"):
                        totals["protein_g"] += float(value)
                        found = True
                    elif lk in ("carbs", "carbohydrates", "carbs_g", "carbohydrates_g"):
                        totals["carbs_g"] += float(value)
                        found = True
                    elif lk in ("fat", "fat_g", "total_fat"):
                        totals["fat_g"] += float(value)
                        found = True
                    else:
                        walk(value)
                else:
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(raw)
    if not found:
        return {"calories": None, "protein_g": None, "carbs_g": None, "fat_g": None, "water_ml": None}
    return {**totals, "water_ml": None}


async def fetch_nutrition_data(
    read_service: MacroFactorReadService | None,
    service: HealthAutoExportService,
    target_date: date,
) -> dict[str, float | None]:
    """Fetch actual daily macros. Prefers the local Health Auto Export daily
    summary (already synced from MacroFactor), falling back to the MacroFactor
    food_log Firestore document."""
    items = service._daily_summary_items(target_date, target_date, include_hidden=True)
    if items:
        item = items[0]
        if any(v is not None for v in (item.calories, item.protein, item.carbohydrates, item.fat)):
            water_ml = item.water * 29.5735 if item.water is not None else None  # stored as fl oz
            return {
                "calories": item.calories,
                "protein_g": item.protein,
                "carbs_g": item.carbohydrates,
                "fat_g": item.fat,
                "water_ml": water_ml,
            }

    if read_service is not None:
        try:
            record = await read_service.dated_document("food_log", target_date)
        except Exception:
            record = None
        if record is not None:
            return _macros_from_food_log(record.raw)

    return {"calories": None, "protein_g": None, "carbs_g": None, "fat_g": None, "water_ml": None}


async def fetch_macrofactor_recommendation(read_service: MacroFactorReadService | None) -> float | None:
    """Pull MacroFactor's own daily calorie recommendation from the diet profile."""
    if read_service is None:
        return None
    record = None
    for dataset in ("diet_profile", "profile"):
        try:
            if dataset == "profile":
                record = await read_service.profile()
            else:
                record = await read_service.dated_document(dataset, date.today())
        except Exception:
            record = None
        if record is not None:
            break
    if record is None:
        return None
    raw = record.raw or {}

    def scan(node: Any) -> float | None:
        if isinstance(node, dict):
            for key, value in node.items():
                lk = str(key).lower()
                if isinstance(value, (int, float)) and any(
                    k in lk for k in ("caloriegoal", "calorietarget", "targetcalories", "dailycalories", "energytarget")
                ):
                    return float(value)
                found = scan(value)
                if found is not None:
                    return found
        elif isinstance(node, list):
            for item in node:
                found = scan(item)
                if found is not None:
                    return found
        return None

    return scan(raw)


def generate_alerts(
    scenario: str,
    actual_macros: dict[str, float | None],
    targets: dict[str, tuple[float, float]],
    now_hour: int | None = None,
) -> list[dict[str, Any]]:
    """Compare actual intake vs scenario targets and build alert list."""
    alerts: list[dict[str, Any]] = []
    protein = actual_macros.get("protein_g")
    carbs = actual_macros.get("carbs_g")
    calories = actual_macros.get("calories")

    protein_low, protein_high = targets["protein_g"]
    carbs_low, carbs_high = targets["carbs_g"]
    cal_low, cal_high = targets["calories"]

    if protein is not None:
        minimum = ATHELETE_WEIGHT_KG * 1.2  # ~109 g
        if protein < minimum:
            alerts.append({
                "severity": "warning",
                "category": "protein",
                "title": "Protein below minimum",
                "detail": f"Only {protein:.0f}g today — below the {minimum:.0f}g floor for muscle repair.",
                "action": "Add a protein source to your next meal (Greek yogurt, whey, chicken, eggs).",
                "metric": "protein_g",
                "actual": protein,
                "target_low": protein_low,
                "target_high": protein_high,
            })
        elif protein < protein_low:
            alerts.append({
                "severity": "warning",
                "category": "protein",
                "title": "Protein under target",
                "detail": f"{protein:.0f}g vs {protein_low:.0f}–{protein_high:.0f}g target for today.",
                "action": "Aim for 20–40g protein at each remaining eating occasion.",
                "metric": "protein_g",
                "actual": protein,
                "target_low": protein_low,
                "target_high": protein_high,
            })
        elif protein_low <= protein <= protein_high * 1.1:
            alerts.append({
                "severity": "good",
                "category": "protein",
                "title": "Protein on track",
                "detail": f"{protein:.0f}g is within the target range ({protein_low:.0f}–{protein_high:.0f}g).",
                "action": None,
                "metric": "protein_g",
                "actual": protein,
                "target_low": protein_low,
                "target_high": protein_high,
            })

    if carbs is not None:
        if scenario in ("double_wp", "double_mixed") and carbs < 5 * ATHELETE_WEIGHT_KG:
            alerts.append({
                "severity": "warning",
                "category": "carbs",
                "title": "Under-fueled for a heavy day",
                "detail": f"{carbs:.0f}g carbs is significantly below the heavy-day target. Refuel now.",
                "action": "Carb-heavy meal ASAP — rice, pasta, bagels, or a sports drink + banana.",
                "metric": "carbs_g",
                "actual": carbs,
                "target_low": carbs_low,
                "target_high": carbs_high,
            })
        elif scenario == "single" and carbs < 4 * ATHELETE_WEIGHT_KG:
            alerts.append({
                "severity": "warning",
                "category": "carbs",
                "title": "Carbs below single-session target",
                "detail": f"{carbs:.0f}g vs {carbs_low:.0f}–{carbs_high:.0f}g needed today.",
                "action": "Add a carb serving to your next meal.",
                "metric": "carbs_g",
                "actual": carbs,
                "target_low": carbs_low,
                "target_high": carbs_high,
            })
        elif carbs_low <= carbs <= carbs_high * 1.2:
            alerts.append({
                "severity": "good",
                "category": "carbs",
                "title": "Carbs matching demand",
                "detail": f"{carbs:.0f}g is within the scenario-appropriate range.",
                "action": None,
                "metric": "carbs_g",
                "actual": carbs,
                "target_low": carbs_low,
                "target_high": carbs_high,
            })
        elif carbs < carbs_low:
            alerts.append({
                "severity": "info",
                "category": "carbs",
                "title": "Carbs below target range",
                "detail": f"{carbs:.0f}g vs {carbs_low:.0f}–{carbs_high:.0f}g.",
                "action": "Consider a carb-rich snack.",
                "metric": "carbs_g",
                "actual": carbs,
                "target_low": carbs_low,
                "target_high": carbs_high,
            })

    if calories is not None:
        cal_mid = (cal_low + cal_high) / 2
        if scenario != "rest" and calories < cal_mid * 0.85:
            alerts.append({
                "severity": "warning",
                "category": "calories",
                "title": "Calories well below training-day needs",
                "detail": f"{calories:.0f} kcal is 15%+ under the ~{cal_mid:.0f} kcal midpoint for today.",
                "action": "Don't finish a training day in a big deficit — recovery will suffer.",
                "metric": "calories",
                "actual": calories,
                "target_low": cal_low,
                "target_high": cal_high,
            })
        elif calories > cal_high * 1.15:
            alerts.append({
                "severity": "info",
                "category": "calories",
                "title": "Calories above scenario target",
                "detail": f"{calories:.0f} kcal is 15%+ over the {cal_high:.0f} kcal upper bound.",
                "action": None,
                "metric": "calories",
                "actual": calories,
                "target_low": cal_low,
                "target_high": cal_high,
            })

    if now_hour is not None and now_hour >= 20 and scenario != "rest":
        if protein is not None and protein < protein_low:
            alerts.append({
                "severity": "info",
                "category": "meal_timing",
                "title": "Evening protein check",
                "detail": "It's late and protein is still under target — casein or Greek yogurt before bed aids overnight repair.",
                "action": "Greek yogurt or cottage cheese before sleep.",
                "metric": "protein_g",
                "actual": protein,
                "target_low": protein_low,
                "target_high": protein_high,
            })

    return alerts


def compute_deficits(
    actual_macros: dict[str, float | None],
    targets: dict[str, tuple[float, float]],
) -> dict[str, float]:
    """How far below the *low end* of each target the actuals are (0 if met)."""
    deficits: dict[str, float] = {}
    for key, actual_key in (("calories", "calories"), ("carbs_g", "carbs_g"), ("protein_g", "protein_g"), ("fat_g", "fat_g")):
        low, _high = targets[key]
        actual = actual_macros.get(actual_key) or 0.0
        deficits[key] = max(0.0, low - actual)
    return deficits


_FOOD_DB: list[dict[str, Any]] = [
    {"title": "Chicken rice bowl", "description": "Chicken breast + white rice + sauce", "protein_g": 40, "carbs_g": 150, "fat_g": 8, "calories": 850},
    {"title": "Whey smoothie", "description": "Whey + banana + oats + milk", "protein_g": 30, "carbs_g": 65, "fat_g": 8, "calories": 500},
    {"title": "Greek yogurt parfait", "description": "Greek yogurt + granola + fruit", "protein_g": 25, "carbs_g": 50, "fat_g": 10, "calories": 420},
    {"title": "Bagels with honey & cream cheese", "description": "4 bagels, honey, light cream cheese", "protein_g": 12, "carbs_g": 200, "fat_g": 14, "calories": 980},
    {"title": "Tuna pasta", "description": "Tuna + pasta + olive oil + veggies", "protein_g": 35, "carbs_g": 100, "fat_g": 15, "calories": 680},
    {"title": "Egg & toast stack", "description": "4 eggs on sourdough + avocado", "protein_g": 28, "carbs_g": 60, "fat_g": 24, "calories": 570},
    {"title": "Sports drink + banana", "description": "Intra/post-session quick carbs", "protein_g": 1, "carbs_g": 55, "fat_g": 0, "calories": 230},
    {"title": "Lean beef & potatoes", "description": "Lean beef + roasted potatoes + salad", "protein_g": 38, "carbs_g": 70, "fat_g": 18, "calories": 600},
]


def suggest_meals(deficits: dict[str, float], current_time: str | None = None) -> list[dict[str, Any]]:
    """Rank practical food combos against the biggest deficits."""
    suggestions = []
    for food in _FOOD_DB:
        score = 0.0
        if deficits.get("protein_g", 0) > 0:
            score += min(food["protein_g"] / max(deficits["protein_g"], 1), 1.0) * 3
        if deficits.get("carbs_g", 0) > 0:
            score += min(food["carbs_g"] / max(deficits["carbs_g"], 1), 1.0) * 3
        if deficits.get("calories", 0) > 0:
            score += min(food["calories"] / max(deficits["calories"], 1), 1.0)
        priority = "high" if score >= 4 else "medium" if score >= 2 else "low"
        suggestions.append({**food, "priority": priority, "_score": score})
    suggestions.sort(key=lambda item: item["_score"], reverse=True)
    for item in suggestions:
        item.pop("_score", None)
    return suggestions[:4]


async def compute_intelligence(
    service: HealthAutoExportService,
    settings: Settings,
    read_service: MacroFactorReadService | None,
    target_date: date,
) -> dict[str, Any]:
    """Main orchestrator — full intelligence report for one date."""
    classification = classify_day(service, target_date)
    scenario = classification["intensity"]
    targets = SCENARIO_TARGETS[scenario]
    actual = await fetch_nutrition_data(read_service, service, target_date)
    now_hour = datetime.now().hour if target_date == date.today() else None
    alerts = generate_alerts(scenario, actual, targets, now_hour)
    deficits = compute_deficits(actual, targets)
    suggestions = suggest_meals(deficits, None)
    mf_calories = await fetch_macrofactor_recommendation(read_service)

    cal_low, cal_high = targets["calories"]
    macrofactor_vs_goals: dict[str, Any] = {
        "macrofactor_daily_calories": mf_calories,
        "athletic_low": cal_low,
        "athletic_high": cal_high,
        "gap": (mf_calories - cal_low) if mf_calories is not None else None,
    }

    return {
        "date": target_date.isoformat(),
        "classification_intensity": scenario,
        "estimated_training_hours": classification["hours"],
        "sports": classification["sports"],
        "actual_macros": actual,
        "target_macros": {
            "calories_low": cal_low,
            "calories_high": cal_high,
            "carbs_low": targets["carbs_g"][0],
            "carbs_high": targets["carbs_g"][1],
            "protein_low": targets["protein_g"][0],
            "protein_high": targets["protein_g"][1],
            "fat_low": targets["fat_g"][0],
            "fat_high": targets["fat_g"][1],
        },
        "alerts": alerts,
        "meal_suggestions": suggestions,
        "macrofactor_vs_goals": macrofactor_vs_goals,
    }
