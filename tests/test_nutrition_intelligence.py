"""Unit tests for nutrition intelligence: classifier, alert engine, suggestions."""

from __future__ import annotations

from datetime import date

import pytest

from macrofactor_scraper.health_export import HealthAutoExportService
from macrofactor_scraper.nutrition_intelligence import (
    ATHELETE_WEIGHT_KG,
    SCENARIO_TARGETS,
    classify_day,
    compute_deficits,
    generate_alerts,
    suggest_meals,
)


@pytest.fixture()
def service(tmp_path):
    svc = HealthAutoExportService(str(tmp_path / "health.sqlite3"))
    svc._ensure_schema()
    return svc


def _add_activity(service: HealthAutoExportService, sport: str, day: str, minutes: float) -> None:
    fp = f"test-{sport}-{day}-{minutes}-{sport}{minutes}"
    with service._connect() as conn:
        conn.execute(
            """
            INSERT INTO activities (source, sport, activity_date, duration_seconds, fingerprint)
            VALUES ('manual', ?, ?, ?, ?)
            """,
            (sport, day, minutes * 60, fp),
        )


def test_classify_rest_day(service):
    result = classify_day(service, date(2026, 8, 20))
    assert result["intensity"] == "rest"
    assert result["session_count"] == 0
    assert result["hours"] is None


def test_classify_single_training(service):
    _add_activity(service, "water_polo", "2026-08-20", 120)
    result = classify_day(service, date(2026, 8, 20))
    assert result["intensity"] == "single"
    assert result["sports"] == ["water_polo"]
    assert result["hours"] == pytest.approx(2.0)


def test_classify_double_water_polo(service):
    _add_activity(service, "water_polo", "2026-08-20", 120)
    _add_activity(service, "water_polo", "2026-08-20", 100)
    result = classify_day(service, date(2026, 8, 20))
    assert result["intensity"] == "double_wp"


def test_classify_double_mixed(service):
    _add_activity(service, "strength_training", "2026-08-20", 60)
    _add_activity(service, "water_polo", "2026-08-20", 120)
    result = classify_day(service, date(2026, 8, 20))
    assert result["intensity"] == "double_mixed"


def test_classify_ignores_other_dates(service):
    _add_activity(service, "water_polo", "2026-08-19", 120)
    result = classify_day(service, date(2026, 8, 20))
    assert result["intensity"] == "rest"


def test_alerts_low_protein_triggers_urgent_warning():
    alerts = generate_alerts(
        "double_wp",
        {"calories": 4000, "protein_g": 90, "carbs_g": 700, "fat_g": 100},
        SCENARIO_TARGETS["double_wp"],
    )
    protein_alerts = [a for a in alerts if a["category"] == "protein"]
    assert protein_alerts
    assert protein_alerts[0]["severity"] == "warning"
    assert "below" in protein_alerts[0]["title"].lower() or "minimum" in protein_alerts[0]["title"].lower()


def test_alerts_good_protein():
    alerts = generate_alerts(
        "single",
        {"calories": 3100, "protein_g": 146, "carbs_g": 550, "fat_g": 90},
        SCENARIO_TARGETS["single"],
    )
    protein_alerts = [a for a in alerts if a["category"] == "protein"]
    assert protein_alerts and protein_alerts[0]["severity"] == "good"


def test_alerts_underfueled_heavy_day():
    alerts = generate_alerts(
        "double_wp",
        {"calories": 4000, "protein_g": 170, "carbs_g": 400, "fat_g": 100},
        SCENARIO_TARGETS["double_wp"],
    )
    carb_alerts = [a for a in alerts if a["category"] == "carbs"]
    assert carb_alerts and carb_alerts[0]["severity"] == "warning"


def test_alerts_underfueled_single_day():
    alerts = generate_alerts(
        "single",
        {"calories": 3000, "protein_g": 150, "carbs_g": 300, "fat_g": 90},
        SCENARIO_TARGETS["single"],
    )
    carb_alerts = [a for a in alerts if a["category"] == "carbs"]
    assert carb_alerts and carb_alerts[0]["severity"] == "warning"


def test_alerts_rest_day_no_calorie_warning_for_low_intake():
    alerts = generate_alerts(
        "rest",
        {"calories": 1800, "protein_g": 140, "carbs_g": 300, "fat_g": 70},
        SCENARIO_TARGETS["rest"],
    )
    calorie_warnings = [a for a in alerts if a["category"] == "calories" and a["severity"] == "warning"]
    assert not calorie_warnings


def test_alerts_none_when_no_data():
    alerts = generate_alerts(
        "rest",
        {"calories": None, "protein_g": None, "carbs_g": None, "fat_g": None},
        SCENARIO_TARGETS["rest"],
    )
    assert alerts == []


def test_alerts_evening_protein_check():
    alerts = generate_alerts(
        "single",
        {"calories": 3000, "protein_g": 120, "carbs_g": 550, "fat_g": 90},
        SCENARIO_TARGETS["single"],
        now_hour=21,
    )
    timing = [a for a in alerts if a["category"] == "meal_timing"]
    assert timing


def test_compute_deficits():
    deficits = compute_deficits(
        {"calories": 3000, "protein_g": 100, "carbs_g": 500, "fat_g": 90},
        SCENARIO_TARGETS["double_wp"],
    )
    assert deficits["protein_g"] == pytest.approx(64)
    assert deficits["carbs_g"] == pytest.approx(140)
    assert deficits["calories"] == pytest.approx(900)
    assert deficits["fat_g"] == 0.0


def test_suggest_meals_prioritises_protein_gap():
    deficits = {"calories": 500, "carbs_g": 0, "protein_g": 60, "fat_g": 0}
    suggestions = suggest_meals(deficits)
    assert suggestions
    assert suggestions[0]["protein_g"] >= 25
    assert all("priority" in s for s in suggestions)
    assert len(suggestions) <= 4


def test_suggest_meals_carb_gap():
    deficits = {"calories": 1000, "carbs_g": 300, "protein_g": 0, "fat_g": 0}
    suggestions = suggest_meals(deficits)
    assert suggestions[0]["carbs_g"] >= 100


def test_scenario_targets_match_guidelines():
    assert SCENARIO_TARGETS["double_wp"]["carbs_g"] == (640, 910)
    assert SCENARIO_TARGETS["rest"]["protein_g"] == (127, 146)
    assert SCENARIO_TARGETS["single"]["calories"] == (2800, 3400)
    assert ATHELETE_WEIGHT_KG == 91.0
