from pathlib import Path

from fastapi.testclient import TestClient

from macrofactor_scraper.api import app, get_health_export_service
from macrofactor_scraper.config import Settings, get_settings
from macrofactor_scraper.health_export import HealthAutoExportService


def _client(tmp_path: Path, *, read_api_key: str | None = None) -> TestClient:
    settings = Settings(ingest_api_key="secret", read_api_key=read_api_key, sqlite_path=str(tmp_path / "health.sqlite3"))
    service = HealthAutoExportService(settings.sqlite_path)
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_health_export_service] = lambda: service
    return TestClient(app)


def _clear_overrides() -> None:
    app.dependency_overrides.clear()
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
                {"name": "protein", "units": "g", "data": [{"qty": 180, "date": "2026-05-01"}]},
                {"name": "carbohydrates", "units": "g", "data": [{"qty": 240, "date": "2026-05-01"}]},
                {"name": "total_fat", "units": "g", "data": [{"qty": 70, "date": "2026-05-01"}]},
                {"name": "dietary_water", "units": "fl oz", "data": [{"qty": 70, "date": "2026-05-01"}]},
                {"name": "body_mass", "units": "kg", "data": [{"qty": 80.5, "date": "2026-05-01"}]},
                {"name": "weight_body_mass", "units": "kg", "data": [{"qty": 81.2, "date": "2026-05-02", "source": "MacroFactor"}]},
                {"name": "step_count", "units": "count", "data": [{"qty": 7500, "date": "2026-05-01"}]},
                {"name": "active_energy", "units": "kJ", "data": [{"qty": 1882.8, "date": "2026-05-01"}]},
                {
                    "name": "blood_pressure",
                    "units": "mmHg",
                    "data": [{"date": "2026-05-01T08:00:00Z", "systolic": 120, "diastolic": 80}],
                },
            ],
            "workouts": [
                {
                    "id": "workout-1",
                    "activityName": "Strength Training",
                    "startDate": "2026-05-01T10:00:00Z",
                    "endDate": "2026-05-01T11:00:00Z",
                    "duration": 3600,
                    "activeEnergy": 300,
                }
            ],
        }
    }


def test_health() -> None:
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ingest_rejects_missing_or_invalid_api_key(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        assert client.post("/v1/ingest/health-auto-export", json=_payload()).status_code == 401
        response = client.post("/v1/ingest/health-auto-export", json=_payload(), headers={"X-API-Key": "bad"})
        assert response.status_code == 401
    finally:
        _clear_overrides()


def test_dedicated_read_key_cannot_ingest_and_ingest_key_cannot_read(tmp_path: Path) -> None:
    client = _client(tmp_path, read_api_key="read-secret")
    try:
        ingest = client.post("/v1/ingest/health-auto-export", json=_payload(), headers={"X-API-Key": "secret"})
        assert ingest.status_code == 200

        read_with_ingest_key = client.get("/v1/metrics", headers={"X-API-Key": "secret"})
        assert read_with_ingest_key.status_code == 401

        read_with_read_key = client.get("/v1/metrics", headers={"X-API-Key": "read-secret"})
        assert read_with_read_key.status_code == 200
        assert read_with_read_key.json()["count"] > 0

        ingest_with_read_key = client.post("/v1/ingest/health-auto-export", json=_payload(), headers={"X-API-Key": "read-secret"})
        assert ingest_with_read_key.status_code == 401
    finally:
        _clear_overrides()


def test_ingest_requires_configured_api_key(tmp_path: Path) -> None:
    settings = Settings(ingest_api_key=None, sqlite_path=str(tmp_path / "health.sqlite3"))
    service = HealthAutoExportService(settings.sqlite_path)
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_health_export_service] = lambda: service
    try:
        response = TestClient(app).post("/v1/ingest/health-auto-export", json=_payload(), headers={"X-API-Key": "secret"})
        assert response.status_code == 500
    finally:
        _clear_overrides()


def test_ingest_parses_metrics_preserves_raw_and_deduplicates(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        response = client.post("/v1/ingest/health-auto-export", json=_payload(), headers={"X-API-Key": "secret"})
        assert response.status_code == 200
        assert response.json()["metrics_inserted"] == 11
        assert response.json()["workouts_inserted"] == 1

        duplicate = client.post("/v1/ingest/health-auto-export", json=_payload(), headers={"X-API-Key": "secret"})
        assert duplicate.status_code == 200
        assert duplicate.json()["metrics_inserted"] == 0
        assert duplicate.json()["workouts_inserted"] == 0

        metric = client.get("/v1/metrics/blood_pressure", headers=_auth())
        assert metric.status_code == 200
        record = metric.json()["records"][0]
        assert record["quantity"] is None
        assert record["raw"]["systolic"] == 120
        assert record["raw"]["diastolic"] == 80
    finally:
        _clear_overrides()


def test_metric_listing_and_date_filtering(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        client.post("/v1/ingest/health-auto-export", json=_payload(), headers={"X-API-Key": "secret"})

        assert client.get("/v1/metrics").status_code == 401

        listing = client.get("/v1/metrics", headers=_auth())
        assert listing.status_code == 200
        names = {item["name"] for item in listing.json()["metrics"]}
        assert {"dietary_energy", "protein", "body_mass"}.issubset(names)

        filtered = client.get("/v1/metrics/dietary_energy?start=2026-05-02&end=2026-05-02", headers=_auth())
        assert filtered.status_code == 200
        assert filtered.json()["count"] == 1
        assert filtered.json()["records"][0]["quantity"] == 500
    finally:
        _clear_overrides()


def test_daily_summary_for_common_nutrition_and_activity_metrics(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        client.post("/v1/ingest/health-auto-export", json=_payload(), headers={"X-API-Key": "secret"})

        response = client.get("/v1/daily-summary?start=2026-05-01&end=2026-05-01", headers=_auth())
        assert response.status_code == 200
        assert response.json()["count"] == 1
        summary = response.json()["summaries"][0]
        assert summary["calories"] == 2200
        assert summary["protein"] == 180
        assert summary["carbohydrates"] == 240
        assert summary["fat"] == 70
        assert round(summary["water"], 1) == 2070.1
        assert summary["weight"] == 80.5
        assert summary["steps"] == 7500
        assert round(summary["active_energy"], 1) == 450
    finally:
        _clear_overrides()


def test_daily_summary_uses_latest_macrofactor_nutrition_total(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        first = {
            "data": {
                "metrics": [
                    {
                        "name": "dietary_energy",
                        "units": "kcal",
                        "data": [{"qty": 1200, "date": "2026-05-06", "source": "MacroFactor", "export_id": "morning"}],
                    },
                    {
                        "name": "protein",
                        "units": "g",
                        "data": [{"qty": 90, "date": "2026-05-06", "source": "MacroFactor", "export_id": "morning"}],
                    },
                ]
            }
        }
        second = {
            "data": {
                "metrics": [
                    {
                        "name": "dietary_energy",
                        "units": "kcal",
                        "data": [{"qty": 2300, "date": "2026-05-06", "source": "MacroFactor", "export_id": "night"}],
                    },
                    {
                        "name": "protein",
                        "units": "g",
                        "data": [{"qty": 165, "date": "2026-05-06", "source": "MacroFactor", "export_id": "night"}],
                    },
                ]
            }
        }

        assert client.post("/v1/ingest/health-auto-export", json=first, headers=_auth()).status_code == 200
        assert client.post("/v1/ingest/health-auto-export", json=second, headers=_auth()).status_code == 200

        response = client.get("/v1/daily-summary?start=2026-05-06&end=2026-05-06", headers=_auth())
        assert response.status_code == 200
        summary = response.json()["summaries"][0]
        assert summary["calories"] == 2300
        assert summary["protein"] == 165

        records = client.get("/v1/metrics/dietary_energy?start=2026-05-06&end=2026-05-06", headers=_auth())
        assert records.status_code == 200
        assert records.json()["count"] == 2
    finally:
        _clear_overrides()


def test_ingest_deduplicates_logical_metric_when_raw_metadata_changes(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        first = {
            "data": {
                "metrics": [
                    {
                        "name": "dietary_energy",
                        "units": "kcal",
                        "data": [{"qty": 2200, "date": "2026-05-06", "source": "MacroFactor", "export_id": "a"}],
                    }
                ]
            }
        }
        second = {
            "data": {
                "metrics": [
                    {
                        "name": "dietary_energy",
                        "units": "kcal",
                        "data": [{"qty": 2200, "date": "2026-05-06", "source": "MacroFactor", "export_id": "b"}],
                    }
                ]
            }
        }

        assert client.post("/v1/ingest/health-auto-export", json=first, headers=_auth()).json()["metrics_inserted"] == 1
        duplicate = client.post("/v1/ingest/health-auto-export", json=second, headers=_auth())
        assert duplicate.status_code == 200
        assert duplicate.json()["metrics_inserted"] == 0
    finally:
        _clear_overrides()


def test_metric_date_diagnostics_reports_replacement_duplicates(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        payload = {
            "data": {
                "metrics": [
                    {
                        "name": "dietary_energy",
                        "units": "kcal",
                        "data": [
                            {"qty": 1200, "date": "2026-05-06", "source": "MacroFactor"},
                            {"qty": 2300, "date": "2026-05-06T22:00:00+08:00", "source": "MacroFactor"},
                        ],
                    },
                    {"name": "step_count", "units": "count", "data": [{"qty": 1000, "date": "2026-05-06"}]},
                ]
            }
        }
        assert client.post("/v1/ingest/health-auto-export", json=payload, headers=_auth()).status_code == 200

        assert client.get("/v1/diagnostics/metrics/2026-05-06").status_code == 401
        response = client.get("/v1/diagnostics/metrics/2026-05-06", headers=_auth())
        assert response.status_code == 200
        diagnostics = {item["metric_name"]: item for item in response.json()["diagnostics"]}
        assert diagnostics["dietary_energy"]["aggregation"] == "replacement"
        assert diagnostics["dietary_energy"]["row_count"] == 2
        assert diagnostics["dietary_energy"]["summed_value"] == 3500
        assert diagnostics["dietary_energy"]["replacement_value"] == 2300
        assert diagnostics["dietary_energy"]["suspicious"] is True
        assert diagnostics["step_count"]["aggregation"] == "additive"
        assert diagnostics["step_count"]["suspicious"] is False
    finally:
        _clear_overrides()


def test_workouts_and_invalid_range(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        client.post("/v1/ingest/health-auto-export", json=_payload(), headers={"X-API-Key": "secret"})

        response = client.get("/v1/workouts?start=2026-05-01&end=2026-05-01", headers=_auth())
        assert response.status_code == 200
        assert response.json()["count"] == 1
        assert response.json()["workouts"][0]["name"] == "Strength Training"

        invalid = client.get("/v1/workouts?start=2026-05-02&end=2026-05-01", headers=_auth())
        assert invalid.status_code == 422
    finally:
        _clear_overrides()


def test_dashboard_login_cookie_allows_private_reads(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        client.post("/v1/ingest/health-auto-export", json=_payload(), headers=_auth())

        assert client.get("/", follow_redirects=False).status_code == 303

        login = client.post("/login", data={"password": "secret"}, follow_redirects=False)
        assert login.status_code == 303

        response = client.get("/v1/metrics")
        assert response.status_code == 200
        assert response.json()["count"] > 0
        assert client.get("/").status_code == 200
    finally:
        _clear_overrides()


def test_ingest_status_dashboard_summary_and_exports_require_auth(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        client.post("/v1/ingest/health-auto-export", json=_payload(), headers=_auth())

        assert client.get("/v1/ingest/status").status_code == 401
        status = client.get("/v1/ingest/status", headers=_auth())
        assert status.status_code == 200
        assert status.json()["batch_count"] == 1
        assert status.json()["metric_record_count"] == 11

        dashboard = client.get("/v1/dashboard/summary?start=2026-05-01&end=2026-05-02", headers=_auth())
        assert dashboard.status_code == 200
        assert dashboard.json()["latest_date"] == "2026-05-02"
        assert dashboard.json()["summaries"][1]["weight"] == 81.2

        csv_response = client.get("/v1/export/daily-summary.csv?start=2026-05-01&end=2026-05-01", headers=_auth())
        assert csv_response.status_code == 200
        assert "date,calories_kcal" in csv_response.text

        metric_csv = client.get("/v1/export/metrics/protein.csv", headers=_auth())
        assert metric_csv.status_code == 200
        assert "metric_name" in metric_csv.text
    finally:
        _clear_overrides()


def test_excel_csv_feeds_use_stable_headers_and_blank_missing_values(tmp_path: Path) -> None:
    client = _client(tmp_path, read_api_key="read-secret")
    try:
        assert client.post("/v1/ingest/health-auto-export", json=_payload(), headers=_auth()).status_code == 200
        read_auth = {"X-API-Key": "read-secret"}

        assert client.get("/v1/excel/daily-log.csv?start=2026-05-01&end=2026-05-01").status_code == 401
        daily = client.get("/v1/excel/daily-log.csv?start=2026-05-01&end=2026-05-01", headers=read_auth)
        assert daily.status_code == 200
        lines = daily.text.splitlines()
        assert lines[0] == "date,calories,protein,carbohydrates,fat,water,weight,steps,active_energy"
        assert "2026-05-01,2200.0,180.0,240.0,70.0" in lines[1]

        calories_weight = client.get("/v1/excel/calories-weight.csv?start=2026-05-01&end=2026-05-02", headers=read_auth)
        assert calories_weight.status_code == 200
        assert calories_weight.text.splitlines()[0] == "date,calories,weight,rolling_calories_7d,weight_delta"
        assert "2026-05-02,500.0,81.2,1350.0,0.7000000000000028" in calories_weight.text

        metric = client.get("/v1/excel/metrics/dietary_energy.csv?start=2026-05-02&end=2026-05-02", headers=read_auth)
        assert metric.status_code == 200
        assert metric.text.splitlines()[0] == "id,metric_name,units,date,timestamp,quantity,source"
        assert "dietary_energy,kcal,2026-05-02" in metric.text
    finally:
        _clear_overrides()


def test_dashboard_preferences_are_private_and_persist(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        assert client.get("/v1/dashboard/preferences").status_code == 401

        defaults = client.get("/v1/dashboard/preferences", headers=_auth())
        assert defaults.status_code == 200
        assert defaults.json()["preferred_range_days"] == 30
        assert "water" in defaults.json()["visible_summary_cards"]

        updated = defaults.json()
        updated["hidden_summary_fields"] = ["water", "steps", "weight"]
        updated["visible_summary_cards"] = ["calories", "protein", "carbohydrates", "fat", "active_energy"]
        updated["preferred_range_days"] = 14
        response = client.put("/v1/dashboard/preferences", json=updated, headers=_auth())
        assert response.status_code == 200
        assert response.json()["hidden_summary_fields"] == ["water", "steps", "weight"]

        persisted = client.get("/v1/dashboard/preferences", headers=_auth())
        assert persisted.status_code == 200
        assert persisted.json()["preferred_range_days"] == 14
        assert persisted.json()["hidden_summary_fields"] == ["water", "steps", "weight"]
    finally:
        _clear_overrides()


def test_dashboard_summary_respects_hidden_fields_and_include_hidden(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        client.post("/v1/ingest/health-auto-export", json=_payload(), headers=_auth())
        preferences = client.get("/v1/dashboard/preferences", headers=_auth()).json()
        preferences["hidden_summary_fields"] = ["water", "steps"]
        preferences["visible_summary_cards"] = ["calories", "protein", "carbohydrates", "fat", "weight", "active_energy"]
        assert client.put("/v1/dashboard/preferences", json=preferences, headers=_auth()).status_code == 200

        response = client.get("/v1/dashboard/summary?start=2026-05-01&end=2026-05-01", headers=_auth())
        assert response.status_code == 200
        summary = response.json()["summaries"][0]
        assert response.json()["hidden_fields"] == ["water", "steps"]
        assert summary["water"] is None
        assert summary["steps"] is None
        assert summary["calories"] == 2200

        full = client.get("/v1/dashboard/summary?start=2026-05-01&end=2026-05-01&include_hidden=true", headers=_auth())
        assert full.status_code == 200
        full_summary = full.json()["summaries"][0]
        assert round(full_summary["water"], 1) == 2070.1
        assert full_summary["steps"] == 7500
    finally:
        _clear_overrides()


def test_dashboard_metric_catalog_reports_sources_mapping_and_trust(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        client.post("/v1/ingest/health-auto-export", json=_payload(), headers=_auth())
        preferences = client.get("/v1/dashboard/preferences", headers=_auth()).json()
        preferences["untrusted_metric_names"] = ["step_count"]
        assert client.put("/v1/dashboard/preferences", json=preferences, headers=_auth()).status_code == 200

        assert client.get("/v1/dashboard/metric-catalog").status_code == 401
        response = client.get("/v1/dashboard/metric-catalog", headers=_auth())
        assert response.status_code == 200
        metrics = {item["name"]: item for item in response.json()["metrics"]}
        assert metrics["dietary_energy"]["dashboard_field"] == "calories"
        assert metrics["dietary_energy"]["sources"] == ["MacroFactor"]
        assert metrics["weight_body_mass"]["dashboard_field"] == "weight"
        assert metrics["step_count"]["dashboard_field"] == "steps"
        assert metrics["step_count"]["is_trusted"] is False
    finally:
        _clear_overrides()


def test_malformed_payload_returns_400(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        response = client.post(
            "/v1/ingest/health-auto-export",
            content="{",
            headers={"X-API-Key": "secret", "Content-Type": "application/json"},
        )
        assert response.status_code == 400
    finally:
        _clear_overrides()
