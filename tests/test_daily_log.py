from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from macrofactor_scraper import api as api_module
from macrofactor_scraper.api import app, get_health_export_service
from macrofactor_scraper.config import Settings, get_settings
from macrofactor_scraper.health_export import HealthAutoExportService


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(ingest_api_key="secret", read_api_key="secret", sqlite_path=str(tmp_path / "health.sqlite3"))
    service = HealthAutoExportService(settings.sqlite_path)
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_health_export_service] = lambda: service
    return TestClient(app)


def _clear(client: TestClient) -> None:
    app.dependency_overrides.clear()
    api_module._LOGIN_FAILURES.clear()
    api_module._LOGIN_LOCKOUTS.clear()
    if hasattr(app.state, "health_export_service"):
        delattr(app.state, "health_export_service")


def _auth() -> dict[str, str]:
    return {"X-API-Key": "secret"}


# ─── Cut phase tests ──────────────────────────────────────────────────────────

def test_list_cut_phases_empty(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        resp = client.get("/v1/cut-phases", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 0
        assert data["phases"] == []
    finally:
        _clear(client)


def test_create_cut_phase(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        resp = client.post("/v1/cut-phases", headers=_auth(), json={
            "name": "Cut Phase 1",
            "start_date": "2026-01-01",
            "target_weight_kg": 80.0,
            "target_calories": 2200,
        })
        assert resp.status_code == 200
        phase = resp.json()
        assert phase["name"] == "Cut Phase 1"
        assert phase["start_date"] == "2026-01-01"
        assert phase["target_weight_kg"] == 80.0
        assert phase["target_calories"] == 2200
        assert phase["end_date"] is None
        assert "id" in phase
    finally:
        _clear(client)


def test_list_cut_phases_after_create(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        client.post("/v1/cut-phases", headers=_auth(), json={"name": "Phase A", "start_date": "2026-01-01"})
        client.post("/v1/cut-phases", headers=_auth(), json={"name": "Phase B", "start_date": "2026-04-01"})
        resp = client.get("/v1/cut-phases", headers=_auth())
        assert resp.status_code == 200
        assert resp.json()["count"] == 2
    finally:
        _clear(client)


def test_update_cut_phase(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        created = client.post("/v1/cut-phases", headers=_auth(), json={"name": "Phase 1", "start_date": "2026-01-01"}).json()
        phase_id = created["id"]
        resp = client.put(f"/v1/cut-phases/{phase_id}", headers=_auth(), json={"end_date": "2026-03-31", "notes": "Done"})
        assert resp.status_code == 200
        updated = resp.json()
        assert updated["end_date"] == "2026-03-31"
        assert updated["notes"] == "Done"
    finally:
        _clear(client)


def test_update_missing_cut_phase_returns_404(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        resp = client.put("/v1/cut-phases/9999", headers=_auth(), json={"notes": "x"})
        assert resp.status_code == 404
    finally:
        _clear(client)


def test_cut_phases_require_auth(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        assert client.get("/v1/cut-phases").status_code == 401
        assert client.post("/v1/cut-phases", json={"name": "x", "start_date": "2026-01-01"}).status_code == 401
    finally:
        _clear(client)


# ─── Daily log tests ──────────────────────────────────────────────────────────

def test_get_missing_daily_log_returns_404(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        resp = client.get("/v1/daily-log/2026-05-12", headers=_auth())
        assert resp.status_code == 404
    finally:
        _clear(client)


def test_upsert_and_get_daily_log(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        resp = client.put("/v1/daily-log/2026-05-12", headers=_auth(), json={
            "am_energy": 3,
            "soreness": 2,
            "gym_done": True,
            "training_type": "upper",
            "vyvanse_taken": True,
            "vyvanse_time": "07:30",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["log_date"] == "2026-05-12"
        assert data["am_energy"] == 3
        assert data["soreness"] == 2
        assert data["gym_done"] is True
        assert data["training_type"] == "upper"
        assert data["vyvanse_taken"] is True
        assert data["vyvanse_time"] == "07:30"

        get_resp = client.get("/v1/daily-log/2026-05-12", headers=_auth())
        assert get_resp.status_code == 200
        assert get_resp.json()["am_energy"] == 3
    finally:
        _clear(client)


def test_daily_log_partial_update_merges_fields(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        client.put("/v1/daily-log/2026-05-12", headers=_auth(), json={"am_energy": 4, "soreness": 1})
        client.put("/v1/daily-log/2026-05-12", headers=_auth(), json={"pm_energy": 3, "mood": 4})
        resp = client.get("/v1/daily-log/2026-05-12", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert data["am_energy"] == 4
        assert data["soreness"] == 1
        assert data["pm_energy"] == 3
        assert data["mood"] == 4
    finally:
        _clear(client)


def test_daily_log_range_query(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        client.put("/v1/daily-log/2026-05-10", headers=_auth(), json={"am_energy": 2})
        client.put("/v1/daily-log/2026-05-11", headers=_auth(), json={"am_energy": 3})
        client.put("/v1/daily-log/2026-05-12", headers=_auth(), json={"am_energy": 4})

        resp = client.get("/v1/daily-log?start=2026-05-10&end=2026-05-11", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 2
        dates = {item["log_date"] for item in data["logs"]}
        assert dates == {"2026-05-10", "2026-05-11"}
    finally:
        _clear(client)


def test_daily_log_week_number_auto_derived(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        # Create active cut phase starting 2026-05-01
        client.post("/v1/cut-phases", headers=_auth(), json={"name": "Cut 1", "start_date": "2026-05-01"})

        # Log on day 8 (second week)
        resp = client.put("/v1/daily-log/2026-05-08", headers=_auth(), json={"am_energy": 3})
        assert resp.status_code == 200
        data = resp.json()
        assert data["cut_phase"] == "Cut 1"
        assert data["week_number"] == 2
    finally:
        _clear(client)


def test_daily_log_invalid_range_returns_422(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        resp = client.get("/v1/daily-log?start=2026-05-15&end=2026-05-10", headers=_auth())
        assert resp.status_code == 422
    finally:
        _clear(client)


def test_daily_log_requires_auth(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        assert client.get("/v1/daily-log/2026-05-12").status_code == 401
        assert client.put("/v1/daily-log/2026-05-12", json={"am_energy": 3}).status_code == 401
        assert client.get("/v1/daily-log").status_code == 401
    finally:
        _clear(client)


def test_daily_log_full_fields(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        payload = {
            "training_type": "lower",
            "gym_done": True,
            "gym_minutes": 75,
            "gym_rpe": 8.0,
            "gym_notes": "Squats felt heavy",
            "cardio_type": "treadmill",
            "cardio_minutes": 30,
            "cardio_avg_hr": 142,
            "vyvanse_taken": True,
            "vyvanse_time": "07:15",
            "dex_booster_taken": True,
            "dex_time": "12:00",
            "sleep_hours": 7.5,
            "sleep_quality": 4,
            "sleep_score": 82,
            "am_energy": 4,
            "pm_energy": 3,
            "motivation": 4,
            "hunger": 3,
            "mood": 4,
            "stress": 2,
            "soreness": 3,
            "digestion": 4,
            "rhr": 52,
            "hrv_overnight": 68,
            "water_litres": 3.2,
            "notes": "Good training day",
        }
        resp = client.put("/v1/daily-log/2026-05-12", headers=_auth(), json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["gym_minutes"] == 75
        assert data["gym_rpe"] == 8.0
        assert data["cardio_avg_hr"] == 142
        assert data["sleep_score"] == 82
        assert data["hrv_overnight"] == 68
        assert data["water_litres"] == 3.2
        assert data["dex_booster_taken"] is True
    finally:
        _clear(client)


# ─── Body measurements tests ──────────────────────────────────────────────────

def test_get_missing_measurement_returns_404(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        resp = client.get("/v1/measurements/2026-05-12", headers=_auth())
        assert resp.status_code == 404
    finally:
        _clear(client)


def test_upsert_and_get_measurement(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        resp = client.put("/v1/measurements/2026-05-12", headers=_auth(), json={
            "waist_cm": 84.5,
            "chest_cm": 102.0,
            "l_arm_cm": 36.5,
            "r_arm_cm": 36.8,
            "l_thigh_cm": 58.0,
            "r_thigh_cm": 57.8,
            "hip_cm": 96.0,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["measure_date"] == "2026-05-12"
        assert data["waist_cm"] == 84.5
        assert data["hip_cm"] == 96.0

        get_resp = client.get("/v1/measurements/2026-05-12", headers=_auth())
        assert get_resp.status_code == 200
        assert get_resp.json()["waist_cm"] == 84.5
    finally:
        _clear(client)


def test_measurement_partial_update(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        client.put("/v1/measurements/2026-05-12", headers=_auth(), json={"waist_cm": 84.0, "chest_cm": 101.0})
        client.put("/v1/measurements/2026-05-12", headers=_auth(), json={"waist_cm": 83.5})
        resp = client.get("/v1/measurements/2026-05-12", headers=_auth())
        data = resp.json()
        assert data["waist_cm"] == 83.5
        assert data["chest_cm"] == 101.0
    finally:
        _clear(client)


def test_measurement_range_query(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        client.put("/v1/measurements/2026-05-05", headers=_auth(), json={"waist_cm": 85.0})
        client.put("/v1/measurements/2026-05-12", headers=_auth(), json={"waist_cm": 84.0})
        client.put("/v1/measurements/2026-05-19", headers=_auth(), json={"waist_cm": 83.0})

        resp = client.get("/v1/measurements?start=2026-05-05&end=2026-05-12", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 2
    finally:
        _clear(client)


def test_measurement_requires_auth(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        assert client.get("/v1/measurements/2026-05-12").status_code == 401
        assert client.put("/v1/measurements/2026-05-12", json={"waist_cm": 84.0}).status_code == 401
        assert client.get("/v1/measurements").status_code == 401
    finally:
        _clear(client)
