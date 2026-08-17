from pathlib import Path

from fastapi.testclient import TestClient

from macrofactor_scraper import api as api_module
from macrofactor_scraper.api import app, get_health_export_service
from macrofactor_scraper.config import Settings, get_settings
from macrofactor_scraper.health_export import HealthAutoExportService


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(ingest_api_key="secret", sqlite_path=str(tmp_path / "health.sqlite3"))
    service = HealthAutoExportService(settings.sqlite_path)
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_health_export_service] = lambda: service
    return TestClient(app)


def _clear_overrides() -> None:
    app.dependency_overrides.clear()
    api_module._LOGIN_FAILURES.clear()
    api_module._LOGIN_LOCKOUTS.clear()
    if hasattr(app.state, "health_export_service"):
        delattr(app.state, "health_export_service")


def _auth() -> dict[str, str]:
    return {"X-API-Key": "secret"}


def _payload() -> dict:
    return {
        "data": {
            "metrics": [
                {
                    "name": "dietary_energy",
                    "units": "kcal",
                    "data": [
                        {"qty": 2200, "date": "2026-05-01", "source": "MacroFactor"},
                        {"qty": 500, "date": "2026-05-02", "source": "MacroFactor"},
                    ],
                },
            ],
            "workouts": [],
        }
    }


def _ingest_and_get_record_id(client: TestClient) -> int:
    response = client.post("/v1/ingest/health-auto-export", json=_payload(), headers=_auth())
    assert response.status_code == 200
    records = client.get("/v1/metrics/dietary_energy", headers=_auth())
    assert records.status_code == 200
    items = records.json()["records"]
    assert len(items) == 2
    return items[0]["id"]


def test_update_health_record_applies_changes(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        record_id = _ingest_and_get_record_id(client)

        response = client.patch(
            f"/v1/health-records/{record_id}",
            json={"quantity": 2350.5, "units": "kJ"},
            headers=_auth(),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == record_id
        assert body["quantity"] == 2350.5
        assert body["units"] == "kJ"
        assert body["metric_name"] == "dietary_energy"
        assert body["date"] == "2026-05-01"

        records = client.get("/v1/metrics/dietary_energy", headers=_auth()).json()["records"]
        updated = next(r for r in records if r["id"] == record_id)
        assert updated["quantity"] == 2350.5
        assert updated["units"] == "kJ"
    finally:
        _clear_overrides()


def test_update_health_record_date_and_source(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        record_id = _ingest_and_get_record_id(client)

        response = client.patch(
            f"/v1/health-records/{record_id}",
            json={"record_date": "2026-05-03", "source": "Manual"},
            headers=_auth(),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["date"] == "2026-05-03"
        assert body["source"] == "Manual"
    finally:
        _clear_overrides()


def test_update_health_record_not_found(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        _ingest_and_get_record_id(client)
        response = client.patch(
            "/v1/health-records/99999",
            json={"quantity": 100},
            headers=_auth(),
        )
        assert response.status_code == 404
    finally:
        _clear_overrides()


def test_update_health_record_invalid_quantity(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        record_id = _ingest_and_get_record_id(client)
        response = client.patch(
            f"/v1/health-records/{record_id}",
            json={"quantity": "not-a-number"},
            headers=_auth(),
        )
        assert response.status_code == 422
    finally:
        _clear_overrides()


def test_update_health_record_invalid_timestamp(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        record_id = _ingest_and_get_record_id(client)
        response = client.patch(
            f"/v1/health-records/{record_id}",
            json={"timestamp": "not a timestamp"},
            headers=_auth(),
        )
        assert response.status_code == 422
    finally:
        _clear_overrides()


def test_update_health_record_requires_auth(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        record_id = _ingest_and_get_record_id(client)
        response = client.patch(f"/v1/health-records/{record_id}", json={"quantity": 100})
        assert response.status_code == 401
    finally:
        _clear_overrides()


def test_delete_health_record_removes_it(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        record_id = _ingest_and_get_record_id(client)

        response = client.delete(f"/v1/health-records/{record_id}", headers=_auth())
        assert response.status_code == 200
        assert response.json() == {"deleted": True}

        records = client.get("/v1/metrics/dietary_energy", headers=_auth()).json()["records"]
        assert all(r["id"] != record_id for r in records)
        assert len(records) == 1
    finally:
        _clear_overrides()


def test_delete_health_record_not_found(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        _ingest_and_get_record_id(client)
        response = client.delete("/v1/health-records/99999", headers=_auth())
        assert response.status_code == 404
    finally:
        _clear_overrides()


def test_delete_health_record_requires_auth(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        record_id = _ingest_and_get_record_id(client)
        response = client.delete(f"/v1/health-records/{record_id}")
        assert response.status_code == 401
    finally:
        _clear_overrides()
