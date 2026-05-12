from macrofactor_scraper.garmin import _extract_hrv, _extract_sleep, summarize_garmin_payload


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
