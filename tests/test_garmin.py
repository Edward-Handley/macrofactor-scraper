from macrofactor_scraper.garmin import (
    _extract_hrv,
    _extract_sleep,
    _extract_user_summary,
    _extract_body_battery,
    _extract_stress,
    _extract_respiration,
    _extract_spo2,
    _extract_training_readiness,
    _extract_training_status,
    _extract_max_metrics,
    summarize_garmin_payload,
)


def test_extract_sleep_score_from_sleep_scores_overall_value() -> None:
    data = {
        "dailySleepDTO": {
            "sleepTimeSeconds": 28_440,
            "sleepScores": {"overall": {"value": 82}},
        }
    }

    assert _extract_sleep(data) == {"sleep_minutes": 474.0, "sleep_score": 82.0}


def test_extract_sleep_score_from_existing_paths() -> None:
    data = {"dailySleepDTO": {"sleepTimeSeconds": 25_200}, "overallSleepScore": {"value": 77}}

    assert _extract_sleep(data)["sleep_score"] == 77.0


def test_extract_hrv_from_last_night_average() -> None:
    assert _extract_hrv({"hrvSummary": {"lastNightAvg": 48}}) == 48.0


def test_extract_hrv_does_not_label_weekly_average_as_overnight() -> None:
    assert _extract_hrv({"hrvSummary": {"weeklyAverage": 52}}) is None


def test_summarize_garmin_payload_reports_matching_numeric_paths() -> None:
    summary = summarize_garmin_payload(
        {"dailySleepDTO": {"sleepScores": {"overall": {"value": 82}}, "other": "hidden"}},
        ("sleep", "score"),
    )

    assert summary["top_level_keys"] == ["dailySleepDTO"]
    assert {"path": "dailySleepDTO.sleepScores.overall.value", "value": 82.0} in summary["numeric_matches"]


# ─── _extract_user_summary ────────────────────────────────────────────────────

def test_extract_user_summary_happy_path() -> None:
    data = {
        "floorsAscended": 12,
        "activeKilocalories": 650,
        "totalDistanceMeters": 8300,
        "moderateIntensityMinutes": 25,
        "vigorousIntensityMinutes": 10,
    }
    result = _extract_user_summary(data)
    assert result["floors_ascended"] == 12.0
    assert result["active_calories"] == 650.0
    assert result["total_distance_m"] == 8300.0
    assert result["intensity_minutes_moderate"] == 25.0
    assert result["intensity_minutes_vigorous"] == 10.0


def test_extract_user_summary_missing_fields() -> None:
    result = _extract_user_summary({})
    assert all(v is None for v in result.values())


# ─── _extract_body_battery ────────────────────────────────────────────────────

def test_extract_body_battery_happy_path() -> None:
    data = [{"charged": 82, "used": 40, "bodyBatteryStatList": [{"bodyBatteryHigh": 95, "bodyBatteryLow": 28}]}]
    result = _extract_body_battery(data)
    assert result["body_battery_charged"] == 82.0
    assert result["body_battery_drained"] == 40.0
    assert result["body_battery_high"] == 95.0
    assert result["body_battery_low"] == 28.0


def test_extract_body_battery_empty() -> None:
    result = _extract_body_battery([])
    assert all(v is None for v in result.values())


# ─── _extract_stress ──────────────────────────────────────────────────────────

def test_extract_stress_happy_path() -> None:
    data = {"avgStressLevel": 32, "maxStressLevel": 71}
    result = _extract_stress(data)
    assert result["stress_avg"] == 32.0
    assert result["stress_max"] == 71.0


def test_extract_stress_filters_negative_sentinel() -> None:
    data = {"avgStressLevel": -1, "maxStressLevel": -2}
    result = _extract_stress(data)
    assert result["stress_avg"] is None
    assert result["stress_max"] is None


# ─── _extract_respiration ─────────────────────────────────────────────────────

def test_extract_respiration_happy_path() -> None:
    data = {"avgWakingRespirationValue": 14.5}
    result = _extract_respiration(data)
    assert result["respiration_avg"] == 14.5


def test_extract_respiration_fallback_key() -> None:
    data = {"averageRespirationValue": 13.0}
    result = _extract_respiration(data)
    assert result["respiration_avg"] == 13.0


# ─── _extract_spo2 ───────────────────────────────────────────────────────────

def test_extract_spo2_happy_path() -> None:
    data = {"averageSpO2": 97.0, "lowestSpO2": 93.0}
    result = _extract_spo2(data)
    assert result["spo2_avg"] == 97.0
    assert result["spo2_lowest"] == 93.0


def test_extract_spo2_zero_filtered() -> None:
    data = {"averageSpO2": 0, "lowestSpO2": 0}
    result = _extract_spo2(data)
    assert result["spo2_avg"] is None
    assert result["spo2_lowest"] is None


# ─── _extract_training_readiness ─────────────────────────────────────────────

def test_extract_training_readiness_list_wakeup_context() -> None:
    data = [
        {"inputContext": "MID_DAY", "score": 55},
        {"inputContext": "AFTER_WAKEUP_RESET", "score": 72},
    ]
    result = _extract_training_readiness(data)
    assert result["training_readiness_score"] == 72.0


def test_extract_training_readiness_list_fallback_first() -> None:
    data = [{"score": 65}, {"score": 70}]
    result = _extract_training_readiness(data)
    assert result["training_readiness_score"] == 65.0


def test_extract_training_readiness_dict() -> None:
    result = _extract_training_readiness({"score": 80})
    assert result["training_readiness_score"] == 80.0


# ─── _extract_training_status ────────────────────────────────────────────────

def test_extract_training_status_happy_path() -> None:
    data = {"latestVo2MaxRunning": 52.3, "latestVo2MaxCycling": 48.1}
    result = _extract_training_status(data)
    assert result["vo2_max_running"] == 52.3
    assert result["vo2_max_cycling"] == 48.1


def test_extract_training_status_missing() -> None:
    result = _extract_training_status({})
    assert result["vo2_max_running"] is None
    assert result["vo2_max_cycling"] is None


# ─── _extract_max_metrics ────────────────────────────────────────────────────

def test_extract_max_metrics_happy_path() -> None:
    data = [
        {
            "allMetrics": {
                "metricsMap": {
                    "VO2MAXVALUE": [{"value": 50.5}],
                    "VO2MAXVALUE_CYCLING": [{"value": 45.2}],
                }
            }
        }
    ]
    result = _extract_max_metrics(data)
    assert result["vo2_max_running"] == 50.5
    assert result["vo2_max_cycling"] == 45.2


def test_extract_max_metrics_empty() -> None:
    result = _extract_max_metrics([])
    assert result["vo2_max_running"] is None
    assert result["vo2_max_cycling"] is None
