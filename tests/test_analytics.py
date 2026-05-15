"""Unit tests for analytics.readiness_from_series()."""
from __future__ import annotations

from datetime import date

import pytest

from macrofactor_scraper.analytics import readiness_from_series


def _make(
    *,
    today_hrv: float | None = None,
    hrv_history: list[float] | None = None,
    today_rhr: float | None = None,
    rhr_history: list[float] | None = None,
):
    return readiness_from_series(
        record_date=date(2026, 5, 15),
        today_hrv=today_hrv,
        hrv_history=hrv_history or [],
        today_rhr=today_rhr,
        rhr_history=rhr_history or [],
    )


def test_insufficient_history_no_today():
    report = _make()
    assert report.band is None
    assert report.score is None
    assert "Insufficient" in report.summary


def test_insufficient_history_short_baseline():
    report = _make(today_hrv=50.0, hrv_history=[48.0, 52.0])  # only 2 days
    assert report.band is None
    assert "Insufficient" in report.summary


def test_good_recovery_hrv_up_rhr_down():
    # HRV well above baseline, RHR well below baseline → green
    hrv_history = [45.0, 47.0, 46.0, 44.0, 48.0, 45.0, 46.0]
    rhr_history = [58.0, 57.0, 59.0, 58.0, 57.0, 59.0, 58.0]
    report = _make(
        today_hrv=62.0,  # ~2σ above
        hrv_history=hrv_history,
        today_rhr=50.0,  # well below
        rhr_history=rhr_history,
    )
    assert report.band == "green"
    assert report.score is not None
    assert report.score > 67
    assert report.hrv_z is not None and report.hrv_z > 0
    assert report.rhr_z is not None and report.rhr_z < 0


def test_poor_recovery_hrv_down_rhr_up():
    hrv_history = [50.0, 52.0, 51.0, 50.0, 53.0, 51.0, 50.0]
    rhr_history = [55.0, 56.0, 55.0, 54.0, 56.0, 55.0, 55.0]
    report = _make(
        today_hrv=35.0,  # well below baseline
        hrv_history=hrv_history,
        today_rhr=70.0,  # well above baseline
        rhr_history=rhr_history,
    )
    assert report.band == "red"
    assert report.score is not None
    assert report.score < 33
    assert "Low recovery" in report.summary


def test_hrv_only_no_rhr():
    hrv_history = [45.0, 47.0, 46.0, 44.0, 48.0, 45.0, 46.0]
    report = _make(today_hrv=52.0, hrv_history=hrv_history)
    assert report.hrv_today == 52.0
    assert report.hrv_z is not None
    assert report.rhr_today is None
    assert report.rhr_z is None
    assert report.score is not None
    assert report.band is not None


def test_rhr_only_no_hrv():
    rhr_history = [58.0, 57.0, 59.0, 58.0, 57.0, 59.0, 58.0]
    report = _make(today_rhr=55.0, rhr_history=rhr_history)
    assert report.rhr_today == 55.0
    assert report.rhr_z is not None
    assert report.hrv_today is None
    assert report.hrv_z is None
    assert report.band is not None


def test_score_clamped_0_100():
    hrv_history = [50.0] * 7
    report = _make(today_hrv=50.0, hrv_history=hrv_history)
    if report.score is not None:
        assert 0.0 <= report.score <= 100.0


def test_date_preserved_in_report():
    report = readiness_from_series(
        record_date=date(2025, 1, 20),
        today_hrv=None,
        hrv_history=[],
        today_rhr=None,
        rhr_history=[],
    )
    assert report.date == "2025-01-20"
