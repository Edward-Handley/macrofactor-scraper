"""Tests for body composition endpoint and BF% interpolation logic."""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest

from macrofactor_scraper.config import Settings
from macrofactor_scraper.health_export import HealthAutoExportService


def _service(tmp_path: Path) -> HealthAutoExportService:
    settings = Settings(sqlite_path=str(tmp_path / "health.sqlite3"))
    svc = HealthAutoExportService(settings.sqlite_path)
    svc._ensure_schema()
    return svc


def _ingest_weight(svc: HealthAutoExportService, d: str, kg: float) -> None:
    """Insert a weight row into health_records via a synthetic batch."""
    import hashlib, json as _json
    ph = hashlib.md5(f"batch|weight|{d}|{kg}".encode()).hexdigest()
    fp = hashlib.md5(f"weight|{d}|{kg}".encode()).hexdigest()
    raw = _json.dumps({"qty": kg, "date": d})
    with svc._connect() as conn:
        batch_id = conn.execute(
            "INSERT OR IGNORE INTO ingest_batches (received_at, payload_hash, headers_json, payload_json)"
            " VALUES (CURRENT_TIMESTAMP, ?, '{}', '{}')",
            (ph,),
        ).lastrowid
        if not batch_id:
            batch_id = conn.execute("SELECT id FROM ingest_batches WHERE payload_hash = ?", (ph,)).fetchone()[0]
        conn.execute(
            "INSERT OR IGNORE INTO health_records (batch_id, metric_name, units, record_date, quantity, source, raw_json, fingerprint)"
            " VALUES (?, 'body_mass', 'kg', ?, ?, 'test', ?, ?)",
            (batch_id, d, kg, raw, fp),
        )


# ─── BF% upsert ───────────────────────────────────────────────────────────────

def test_upsert_body_fat_percent(tmp_path):
    svc = _service(tmp_path)
    row = svc.upsert_measurement("2026-05-20", {"body_fat_percent": 18.5})
    assert row["body_fat_percent"] == pytest.approx(18.5)


def test_upsert_body_fat_and_waist_together(tmp_path):
    svc = _service(tmp_path)
    row = svc.upsert_measurement("2026-05-20", {"waist_cm": 82.0, "body_fat_percent": 20.0})
    assert row["waist_cm"] == pytest.approx(82.0)
    assert row["body_fat_percent"] == pytest.approx(20.0)


def test_update_existing_bf(tmp_path):
    svc = _service(tmp_path)
    svc.upsert_measurement("2026-05-20", {"body_fat_percent": 18.0})
    svc.upsert_measurement("2026-05-20", {"body_fat_percent": 17.5})
    rows = svc.get_measurements(date(2026, 5, 20), date(2026, 5, 20))
    assert len(rows) == 1
    assert rows[0]["body_fat_percent"] == pytest.approx(17.5)


# ─── Interpolation logic ──────────────────────────────────────────────────────

def test_interpolation_between_two_measurements(tmp_path):
    """BF% should be linearly interpolated between two measured dates."""
    svc = _service(tmp_path)
    _ingest_weight(svc, "2026-05-01", 80.0)
    _ingest_weight(svc, "2026-05-11", 79.0)
    _ingest_weight(svc, "2026-05-21", 78.0)
    svc.upsert_measurement("2026-05-01", {"body_fat_percent": 20.0})
    svc.upsert_measurement("2026-05-21", {"body_fat_percent": 18.0})

    result = svc.get_body_composition(date(2026, 5, 1), date(2026, 5, 21))
    by_date = {r["date"]: r for r in result}

    # Midpoint (May 11) should be exactly 19.0%
    assert by_date["2026-05-11"]["body_fat_percent"] == pytest.approx(19.0, abs=0.1)
    assert by_date["2026-05-11"]["source"] == "interpolated"


def test_exact_measurement_date_uses_measured_source(tmp_path):
    svc = _service(tmp_path)
    _ingest_weight(svc, "2026-05-01", 80.0)
    svc.upsert_measurement("2026-05-01", {"body_fat_percent": 20.0})
    result = svc.get_body_composition(date(2026, 5, 1), date(2026, 5, 1))
    assert result[0]["source"] == "measured"
    assert result[0]["body_fat_percent"] == pytest.approx(20.0)


def test_carried_forward_after_last_measurement(tmp_path):
    """After last BF% measurement, value should be carried forward."""
    svc = _service(tmp_path)
    for i in range(10):
        _ingest_weight(svc, f"2026-05-{i+1:02d}", 80.0)
    svc.upsert_measurement("2026-05-01", {"body_fat_percent": 20.0})
    result = svc.get_body_composition(date(2026, 5, 1), date(2026, 5, 10))
    by_date = {r["date"]: r for r in result}
    assert by_date["2026-05-10"]["source"] == "carried_forward"
    assert by_date["2026-05-10"]["body_fat_percent"] == pytest.approx(20.0)


def test_no_bf_measurements_gives_none(tmp_path):
    """With no BF% data, body_fat_percent and lean/fat mass should be None."""
    svc = _service(tmp_path)
    _ingest_weight(svc, "2026-05-01", 80.0)
    result = svc.get_body_composition(date(2026, 5, 1), date(2026, 5, 1))
    assert result[0]["body_fat_percent"] is None
    assert result[0]["lean_kg"] is None
    assert result[0]["fat_kg"] is None


def test_lean_fat_derivation(tmp_path):
    """lean_kg + fat_kg should equal weight_kg when BF% available."""
    svc = _service(tmp_path)
    _ingest_weight(svc, "2026-05-01", 80.0)
    svc.upsert_measurement("2026-05-01", {"body_fat_percent": 20.0})
    result = svc.get_body_composition(date(2026, 5, 1), date(2026, 5, 1))
    r = result[0]
    assert r["fat_kg"] == pytest.approx(16.0, abs=0.05)
    assert r["lean_kg"] == pytest.approx(64.0, abs=0.05)
    assert abs(r["lean_kg"] + r["fat_kg"] - r["weight_kg"]) < 0.1


def test_empty_range_no_weight_data(tmp_path):
    """Date range with no weight data should return entries with weight=None."""
    svc = _service(tmp_path)
    result = svc.get_body_composition(date(2026, 5, 1), date(2026, 5, 3))
    assert len(result) == 3
    assert all(r["weight_kg"] is None for r in result)


def test_single_point_range(tmp_path):
    """Single-day range works correctly."""
    svc = _service(tmp_path)
    _ingest_weight(svc, "2026-05-15", 77.5)
    svc.upsert_measurement("2026-05-15", {"body_fat_percent": 15.0})
    result = svc.get_body_composition(date(2026, 5, 15), date(2026, 5, 15))
    assert len(result) == 1
    assert result[0]["lean_kg"] == pytest.approx(77.5 * 0.85, abs=0.1)


# ─── API endpoint ─────────────────────────────────────────────────────────────

def test_body_composition_endpoint(tmp_path):
    from fastapi.testclient import TestClient
    from macrofactor_scraper import api as api_module
    from macrofactor_scraper.api import app, get_health_export_service
    from macrofactor_scraper.config import get_settings

    settings = Settings(ingest_api_key="secret", sqlite_path=str(tmp_path / "health.sqlite3"))
    svc = _service(tmp_path)
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_health_export_service] = lambda: svc

    try:
        client = TestClient(app)
        resp = client.get("/v1/body-composition?start=2026-05-01&end=2026-05-10", headers={"X-API-Key": "secret"})
        assert resp.status_code == 200
        data = resp.json()
        assert "points" in data
        assert isinstance(data["points"], list)
    finally:
        app.dependency_overrides.clear()
