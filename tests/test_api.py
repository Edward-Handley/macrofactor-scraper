from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from macrofactor_scraper import api as api_module
from macrofactor_scraper.api import app, get_health_export_service
from macrofactor_scraper.config import Settings, get_settings
from macrofactor_scraper.health_export import HealthAutoExportService, classify_strong_exercise


def _client(tmp_path: Path, *, read_api_key: str | None = None) -> TestClient:
    settings = Settings(ingest_api_key="secret", read_api_key=read_api_key, sqlite_path=str(tmp_path / "health.sqlite3"))
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


def test_daily_summary_adds_unique_macrofactor_nutrition_points(tmp_path: Path) -> None:
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
        assert summary["calories"] == 3500
        assert summary["protein"] == 255

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


def test_daily_summary_ignores_existing_logical_duplicate_rows(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        payload = {
            "data": {
                "metrics": [
                    {
                        "name": "dietary_energy",
                        "units": "kcal",
                        "data": [{"qty": 1200, "date": "2026-05-06T08:00:00+08:00", "source": "MacroFactor"}],
                    },
                ]
            }
        }
        assert client.post("/v1/ingest/health-auto-export", json=payload, headers=_auth()).status_code == 200
        service = app.dependency_overrides[get_health_export_service]()
        with service._connect() as conn:
            conn.execute(
                """
                INSERT INTO health_records
                    (batch_id, metric_name, units, record_date, timestamp, quantity, source, raw_json, fingerprint)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    1,
                    "dietary_energy",
                    "kcal",
                    "2026-05-06",
                    "2026-05-06T08:00:00+08:00",
                    1200,
                    "MacroFactor",
                    '{"export_id":"legacy-duplicate"}',
                    "legacy-duplicate-fingerprint",
                ),
            )

        response = client.get("/v1/daily-summary?start=2026-05-06&end=2026-05-06", headers=_auth())
        assert response.status_code == 200
        assert response.json()["summaries"][0]["calories"] == 1200
    finally:
        _clear_overrides()


def test_metric_date_diagnostics_reports_additive_nutrition_points(tmp_path: Path) -> None:
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
                    {"name": "body_mass", "units": "kg", "data": [{"qty": 93.1, "date": "2026-05-06"}]},
                ]
            }
        }
        assert client.post("/v1/ingest/health-auto-export", json=payload, headers=_auth()).status_code == 200

        assert client.get("/v1/diagnostics/metrics/2026-05-06").status_code == 401
        response = client.get("/v1/diagnostics/metrics/2026-05-06", headers=_auth())
        assert response.status_code == 200
        diagnostics = {item["metric_name"]: item for item in response.json()["diagnostics"]}
        assert diagnostics["dietary_energy"]["aggregation"] == "additive"
        assert diagnostics["dietary_energy"]["row_count"] == 2
        assert diagnostics["dietary_energy"]["summed_value"] == 3500
        assert diagnostics["dietary_energy"]["replacement_value"] == 2300
        assert diagnostics["dietary_energy"]["collapsed_value"] == 3500
        assert diagnostics["dietary_energy"]["suspicious"] is False
        assert diagnostics["body_mass"]["aggregation"] == "replacement"
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


def test_strong_csv_import_filters_dedupes_and_summarizes(tmp_path: Path) -> None:
    client = _client(tmp_path)
    csv_body = """Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2026-04-30 10:00:00,Old Day,45m,Bench Press (Barbell),1,60,5,0,0,,,8
2026-05-01 10:00:00,Push Day,1h 5m,Bench Press (Barbell),W,40,8,0,0,warmup,,6
2026-05-01 10:00:00,Push Day,1h 5m,Bench Press (Barbell),1,80,5,0,0,,,8
2026-05-01 10:00:00,Push Day,1h 5m,Bench Press (Barbell),2,82.5,4,0,0,,,9
2026-05-02 11:00:00,Pull Day,50m,Lat Pulldown (Cable),1,70,10,0,0,,felt good,8
"""
    try:
        client.post("/v1/ingest/health-auto-export", json=_payload(), headers=_auth())

        unauth = client.post(
            "/v1/strong/import",
            files={"file": ("strong.csv", csv_body, "text/csv")},
        )
        assert unauth.status_code == 401

        response = client.post(
            "/v1/strong/import",
            files={"file": ("strong.csv", csv_body, "text/csv")},
            headers=_auth(),
        )
        assert response.status_code == 200
        imported = response.json()
        assert imported["nutrition_start_date"] == "2026-05-01"
        assert imported["rows_seen"] == 5
        assert imported["rows_ignored_before_nutrition"] == 1
        assert imported["sessions_inserted"] == 2
        assert imported["sets_inserted"] == 4
        assert imported["duplicate_sets"] == 0

        duplicate = client.post(
            "/v1/strong/import",
            files={"file": ("strong.csv", csv_body, "text/csv")},
            headers=_auth(),
        )
        assert duplicate.status_code == 200
        assert duplicate.json()["sessions_inserted"] == 0
        assert duplicate.json()["sets_inserted"] == 0
        assert duplicate.json()["duplicate_sets"] == 4

        summary = client.get("/v1/strong/summary?start=2026-05-01&end=2026-05-02", headers=_auth())
        assert summary.status_code == 200
        body = summary.json()
        assert body["session_count"] == 2
        assert body["working_set_count"] == 3
        assert body["total_volume"] == 80 * 5 + 82.5 * 4 + 70 * 10
        assert body["nutrition"]["training_day_count"] == 2
        bench = next(item for item in body["exercises"] if item["exercise_name"] == "Bench Press (Barbell)")
        assert bench["best_estimated_1rm"] == 82.5 * (1 + 4 / 30)

        sessions = client.get("/v1/strong/sessions?start=2026-05-01&end=2026-05-02", headers=_auth())
        assert sessions.status_code == 200
        assert sessions.json()["sessions"][1]["sets"][0]["is_warmup"] is True
        session_id = sessions.json()["sessions"][0]["id"]
        assert client.get(f"/v1/strong/sessions/{session_id}").status_code == 401
        session_detail = client.get(f"/v1/strong/sessions/{session_id}", headers=_auth())
        assert session_detail.status_code == 200
        assert session_detail.json()["workout_name"] == "Pull Day"
        assert len(session_detail.json()["sets"]) == 1
        assert client.get("/v1/strong/sessions/999999", headers=_auth()).status_code == 404

        detail = client.get("/v1/strong/exercises/Bench%20Press%20%28Barbell%29?start=2026-05-01&end=2026-05-02", headers=_auth())
        assert detail.status_code == 200
        assert detail.json()["points"][0]["working_sets"] == 2
    finally:
        _clear_overrides()


def test_strong_analytics_auth_taxonomy_nutrition_and_dedupe(tmp_path: Path) -> None:
    client = _client(tmp_path)
    csv_body = """Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2026-05-01 10:00:00,Push Day,1h 5m,Bench Press (Barbell),1,80,5,0,0,,,8
2026-05-01 10:00:00,Push Day,1h 5m,Bench Press (Barbell),2,82.5,4,0,0,,,9
2026-05-02 11:00:00,Pull Day,50m,Lat Pulldown (Cable),1,70,10,0,0,,felt good,8
2026-05-02 11:00:00,Pull Day,50m,Odd Lift,1,25,12,0,0,,,7
"""
    try:
        client.post("/v1/ingest/health-auto-export", json=_payload(), headers=_auth())
        assert client.post("/v1/strong/import", files={"file": ("strong.csv", csv_body, "text/csv")}, headers=_auth()).status_code == 200
        assert client.post("/v1/strong/import", files={"file": ("strong.csv", csv_body, "text/csv")}, headers=_auth()).status_code == 200

        assert client.get("/v1/strong/analytics?start=2026-05-01&end=2026-05-02").status_code == 401
        invalid = client.get("/v1/strong/analytics?start=2026-05-02&end=2026-05-01", headers=_auth())
        assert invalid.status_code == 422

        response = client.get("/v1/strong/analytics?start=2026-05-01&end=2026-05-02", headers=_auth())
        assert response.status_code == 200
        body = response.json()
        assert body["totals"]["sessions"] == 2
        assert body["totals"]["working_sets"] == 4
        assert body["totals"]["total_volume"] == 80 * 5 + 82.5 * 4 + 70 * 10 + 25 * 12
        assert body["weekly_load"][0]["pr_count"] == 4
        assert body["weekly_load"][0]["avg_calories"] == 1350
        assert body["daily_load"][0]["date"] == "2026-05-01"
        assert body["daily_load"][0]["groups_trained"] == ["Chest"]
        assert body["weekly_group_load"][0]["week_start"] == "2026-04-27"
        assert any(item["group"] == "Chest" for item in body["weekly_group_load"])
        assert body["exercise_prs"][0]["exercise_name"] == "Bench Press (Barbell)"
        assert body["exercise_prs"][0]["session_id"] > 0
        assert "Chest" in body["filter_options"]["groups"]
        assert "Bench Press (Barbell)" in body["filter_options"]["exercises"]
        assert body["filter_options"]["start_date"] == "2026-05-01"
        assert body["exercise_taxonomy"]["Bench Press (Barbell)"]["primary_group"] == "Chest"
        assert body["exercise_taxonomy"]["Odd Lift"]["primary_group"] == "Other"
        assert any(item["group"] == "Back" for item in body["group_balance"])
        assert body["nutrition_training_days"][0]["calories"] == 2200
        assert body["nutrition_training_days"][1]["prior_protein"] == 180
        assert any(item["timing"] == "prior_day" and item["nutrient"] == "protein" for item in body["nutrition_correlations"])
    finally:
        _clear_overrides()


def test_classify_strong_exercise_known_and_unknown() -> None:
    assert classify_strong_exercise("Bench Press (Barbell)").primary_group == "Chest"
    assert classify_strong_exercise("Lat Pulldown (Cable)").movement_pattern == "Vertical Pull"
    assert classify_strong_exercise("Mystery Raise").primary_group == "Other"


def test_strong_csv_import_requires_nutrition_and_columns(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        no_nutrition = client.post(
            "/v1/strong/import",
            files={"file": ("strong.csv", "Date,Workout Name\n", "text/csv")},
            headers=_auth(),
        )
        assert no_nutrition.status_code == 422
        assert "Nutrition data" in no_nutrition.json()["detail"]

        client.post("/v1/ingest/health-auto-export", json=_payload(), headers=_auth())
        invalid = client.post(
            "/v1/strong/import",
            files={"file": ("strong.csv", "Date,Workout Name\n", "text/csv")},
            headers=_auth(),
        )
        assert invalid.status_code == 422
        assert "missing required columns" in invalid.json()["detail"]
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


def test_dashboard_login_throttles_repeated_failures(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        for _ in range(api_module.LOGIN_FAILURE_LIMIT):
            response = client.post("/login", data={"password": "bad"}, follow_redirects=False)
            assert response.status_code == 401

        locked = client.post("/login", data={"password": "secret"}, follow_redirects=False)
        assert locked.status_code == 429
    finally:
        _clear_overrides()


def test_ingest_rejects_oversized_json_body(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(tmp_path)
    monkeypatch.setattr(api_module, "HEALTH_EXPORT_JSON_MAX_BYTES", 8)
    try:
        response = client.post(
            "/v1/ingest/health-auto-export",
            content='{"data": {}}',
            headers={"X-API-Key": "secret", "Content-Type": "application/json"},
        )
        assert response.status_code == 413
    finally:
        _clear_overrides()


def test_strong_import_rejects_oversized_csv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(tmp_path)
    monkeypatch.setattr(api_module, "STRONG_CSV_MAX_BYTES", 8)
    try:
        client.post("/v1/ingest/health-auto-export", json=_payload(), headers=_auth())
        response = client.post(
            "/v1/strong/import",
            files={"file": ("strong.csv", "Date,Workout Name\n" + ("x" * 20), "text/csv")},
            headers=_auth(),
        )
        assert response.status_code == 413
    finally:
        _clear_overrides()


def test_production_requires_distinct_runtime_secrets() -> None:
    from argon2 import PasswordHasher
    ph = PasswordHasher()
    pw_hash = ph.hash("password")

    invalid = Settings(
        environment="production",
        ingest_api_key="same",
        read_api_key="same",
        session_secret="session",
        dashboard_password_hash=pw_hash,
    )
    with pytest.raises(ValueError, match="distinct"):
        invalid.validate_runtime_security()

    valid = Settings(
        environment="production",
        ingest_api_key="ingest",
        read_api_key="read",
        session_secret="session",
        dashboard_password_hash=pw_hash,
    )
    valid.validate_runtime_security()


def test_production_requires_dashboard_password_hash() -> None:
    with pytest.raises(ValueError, match="DASHBOARD_PASSWORD_HASH"):
        Settings(
            environment="production",
            ingest_api_key="ingest",
            read_api_key="read",
            session_secret="session",
            dashboard_password="plaintext-not-allowed-in-prod",
        ).validate_runtime_security()


def test_verify_dashboard_password_argon2() -> None:
    from argon2 import PasswordHasher
    ph = PasswordHasher()
    pw_hash = ph.hash("mypassword")

    settings = Settings(ingest_api_key="key", dashboard_password_hash=pw_hash)
    assert settings.verify_dashboard_password("mypassword") is True
    assert settings.verify_dashboard_password("wrongpassword") is False


def test_verify_dashboard_password_plaintext_fallback() -> None:
    settings = Settings(ingest_api_key="key", dashboard_password="plaintext")
    assert settings.verify_dashboard_password("plaintext") is True
    assert settings.verify_dashboard_password("wrong") is False


def test_production_read_key_never_falls_back_to_ingest_key() -> None:
    settings = Settings(environment="production", ingest_api_key="secret", read_api_key=None)
    assert api_module._valid_read_api_key("secret", settings) is False


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


def test_daily_summary_collapses_midnight_running_totals_to_latest_snapshot(tmp_path: Path) -> None:
    """Six hourly HAE syncs for the same day produce six midnight-snapshot rows.
    The summary must return the latest snapshot (2395.60), not the sum (9175.76).
    The raw rows are still all stored in health_records.
    """
    client = _client(tmp_path)
    try:
        quantities = [616.29, 1062.45, 1176.69, 1745.02, 2180.76, 2395.60]
        for qty in quantities:
            payload = {
                "data": {
                    "metrics": [
                        {
                            "name": "dietary_energy",
                            "units": "kcal",
                            "data": [{"qty": qty, "date": "2026-05-07T00:00:00+08:00", "source": "MacroFactor"}],
                        }
                    ]
                }
            }
            assert client.post("/v1/ingest/health-auto-export", json=payload, headers=_auth()).status_code == 200

        summary_resp = client.get("/v1/daily-summary?start=2026-05-07&end=2026-05-07", headers=_auth())
        assert summary_resp.status_code == 200
        assert summary_resp.json()["summaries"][0]["calories"] == pytest.approx(2395.60)

        records_resp = client.get("/v1/metrics/dietary_energy?start=2026-05-07&end=2026-05-07", headers=_auth())
        assert records_resp.json()["count"] == 6
    finally:
        _clear_overrides()


def test_daily_summary_prefers_midnight_over_intraday_same_source(tmp_path: Path) -> None:
    """When midnight summary + intraday meal rows coexist for the same source,
    the midnight row wins (it is the canonical daily total from MacroFactor).
    """
    client = _client(tmp_path)
    try:
        midnight_payload = {
            "data": {
                "metrics": [
                    {
                        "name": "dietary_energy",
                        "units": "kcal",
                        "data": [{"qty": 1814.02, "date": "2026-05-05T00:00:00+08:00", "source": "MacroFactor"}],
                    }
                ]
            }
        }
        intraday_payload = {
            "data": {
                "metrics": [
                    {
                        "name": "dietary_energy",
                        "units": "kcal",
                        "data": [
                            {"qty": 181.74, "date": "2026-05-05T05:00:00+08:00", "source": "MacroFactor"},
                            {"qty": 98.23, "date": "2026-05-05T07:00:00+08:00", "source": "MacroFactor"},
                            {"qty": 381.46, "date": "2026-05-05T09:28:00+08:00", "source": "MacroFactor"},
                            {"qty": 227.55, "date": "2026-05-05T13:09:00+08:00", "source": "MacroFactor"},
                            {"qty": 214.08, "date": "2026-05-05T18:01:00+08:00", "source": "MacroFactor"},
                        ],
                    }
                ]
            }
        }
        assert client.post("/v1/ingest/health-auto-export", json=midnight_payload, headers=_auth()).status_code == 200
        assert client.post("/v1/ingest/health-auto-export", json=intraday_payload, headers=_auth()).status_code == 200

        summary_resp = client.get("/v1/daily-summary?start=2026-05-05&end=2026-05-05", headers=_auth())
        assert summary_resp.status_code == 200
        assert summary_resp.json()["summaries"][0]["calories"] == pytest.approx(1814.02)
    finally:
        _clear_overrides()


def test_daily_summary_sums_intraday_when_no_midnight_present(tmp_path: Path) -> None:
    """When only intraday rows exist (no midnight summary), they must still be summed."""
    client = _client(tmp_path)
    try:
        payload = {
            "data": {
                "metrics": [
                    {
                        "name": "dietary_energy",
                        "units": "kcal",
                        "data": [
                            {"qty": 900.0, "date": "2026-05-08T08:00:00+08:00", "source": "MacroFactor"},
                            {"qty": 700.0, "date": "2026-05-08T13:00:00+08:00", "source": "MacroFactor"},
                            {"qty": 600.0, "date": "2026-05-08T19:00:00+08:00", "source": "MacroFactor"},
                        ],
                    }
                ]
            }
        }
        assert client.post("/v1/ingest/health-auto-export", json=payload, headers=_auth()).status_code == 200

        summary_resp = client.get("/v1/daily-summary?start=2026-05-08&end=2026-05-08", headers=_auth())
        assert summary_resp.status_code == 200
        assert summary_resp.json()["summaries"][0]["calories"] == pytest.approx(2200.0)
    finally:
        _clear_overrides()


def test_metric_date_diagnostics_flags_running_total_stacking_as_suspicious(tmp_path: Path) -> None:
    """Two midnight rows for the same source on the same day are suspicious for an additive metric."""
    client = _client(tmp_path)
    try:
        for qty in [616.29, 2395.60]:
            payload = {
                "data": {
                    "metrics": [
                        {
                            "name": "dietary_energy",
                            "units": "kcal",
                            "data": [{"qty": qty, "date": "2026-05-07T00:00:00+08:00", "source": "MacroFactor"}],
                        }
                    ]
                }
            }
            assert client.post("/v1/ingest/health-auto-export", json=payload, headers=_auth()).status_code == 200

        response = client.get("/v1/diagnostics/metrics/2026-05-07", headers=_auth())
        assert response.status_code == 200
        diag = {item["metric_name"]: item for item in response.json()["diagnostics"]}
        assert diag["dietary_energy"]["suspicious"] is True
        assert diag["dietary_energy"]["collapsed_value"] == pytest.approx(2395.60)
        assert diag["dietary_energy"]["summed_value"] == pytest.approx(616.29 + 2395.60)
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
        updated["workout_preferences"] = {
            "default_range_days": 9999,
            "landing_tab": "Bogus",
            "visible_workout_cards": ["sessions", "bad-card"],
            "default_charts": ["training_heatmap", "bad-chart"],
            "pinned_exercises": ["Bench Press (Barbell)", "Bench Press (Barbell)", ""],
            "default_group_filter": "",
            "default_exercise_sort": "unknown",
            "show_import_panel": False,
        }
        response = client.put("/v1/dashboard/preferences", json=updated, headers=_auth())
        assert response.status_code == 200
        assert response.json()["hidden_summary_fields"] == ["water", "steps", "weight"]
        assert response.json()["workout_preferences"]["default_range_days"] == 3650
        assert response.json()["workout_preferences"]["landing_tab"] == "Overview"
        assert response.json()["workout_preferences"]["visible_workout_cards"] == ["sessions"]
        assert response.json()["workout_preferences"]["default_charts"] == ["training_heatmap"]
        assert response.json()["workout_preferences"]["pinned_exercises"] == ["Bench Press (Barbell)"]
        assert response.json()["workout_preferences"]["default_exercise_sort"] == "recent_pr"
        assert response.json()["workout_preferences"]["show_import_panel"] is False

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


def test_readiness_endpoint_insufficient_data(tmp_path: Path) -> None:
    client = _client(tmp_path)
    try:
        resp = client.get("/v1/insights/readiness/2026-05-15", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert data["band"] is None
        assert data["score"] is None
        assert "Insufficient" in data["summary"]
    finally:
        _clear_overrides()


def test_readiness_endpoint_with_garmin_data(tmp_path: Path) -> None:
    from macrofactor_scraper.health_export import HealthAutoExportService
    from datetime import date, timedelta

    settings = Settings(ingest_api_key="secret", sqlite_path=str(tmp_path / "health.sqlite3"))
    service = HealthAutoExportService(settings.sqlite_path)
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_health_export_service] = lambda: service
    client = TestClient(app)

    try:
        target = date(2026, 5, 15)
        # Seed 7 baseline days + today for HRV and RHR
        hrv_values = [45.0, 47.0, 46.0, 44.0, 48.0, 45.0, 46.0]
        rhr_values = [58.0, 57.0, 59.0, 58.0, 57.0, 59.0, 58.0]
        for i, (hrv, rhr) in enumerate(zip(hrv_values, rhr_values)):
            d = (target - timedelta(days=7 - i)).isoformat()
            service.upsert_garmin_metric("hrv_overnight", "ms", d, hrv)
            service.upsert_garmin_metric("resting_heart_rate", "bpm", d, rhr)
        # Today: high HRV (good), low RHR (good) → should be green
        service.upsert_garmin_metric("hrv_overnight", "ms", target.isoformat(), 62.0)
        service.upsert_garmin_metric("resting_heart_rate", "bpm", target.isoformat(), 50.0)

        resp = client.get(f"/v1/insights/readiness/{target.isoformat()}", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert data["band"] == "green"
        assert data["score"] is not None and data["score"] > 67
        assert data["hrv_today"] == 62.0
        assert data["rhr_today"] == 50.0
        assert data["hrv_z"] is not None and data["hrv_z"] > 0
        assert data["rhr_z"] is not None and data["rhr_z"] < 0
    finally:
        _clear_overrides()
