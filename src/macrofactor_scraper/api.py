from __future__ import annotations

import asyncio
import base64
import csv
import hmac
import io
import json
import time
from collections import defaultdict, deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date
from hashlib import sha256
from pathlib import Path
from urllib.parse import parse_qs

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from macrofactor_scraper.config import Settings, get_settings
from macrofactor_scraper.health_export import HealthAutoExportService
from macrofactor_scraper.models import (
    BodyMeasurement,
    BodyMeasurementListResponse,
    BodyMeasurementUpsert,
    CoachDraftResponse,
    CutPhase,
    CutPhaseCreate,
    CutPhaseListResponse,
    CutPhaseUpdate,
    DailyLog,
    DailyLogListResponse,
    DailyLogUpsert,
    DailySummaryResponse,
    DashboardMetricCatalogResponse,
    DashboardPreferences,
    DashboardSummaryResponse,
    HealthResponse,
    IngestStatusResponse,
    IngestResponse,
    MetricDateDiagnosticResponse,
    MetricListResponse,
    MetricRecordsResponse,
    ReadinessReport,
    RepairReport,
    StrongAnalyticsResponse,
    StrongExerciseDetailResponse,
    StrongImportListResponse,
    StrongImportResponse,
    StrongSessionListResponse,
    StrongSessionRecord,
    AiAnalyseRequest,
    AiAnalyseResponse,
    PhotoListResponse,
    PhotoDateEntry,
    StrongSummaryResponse,
    WorkoutListResponse,
    _row_to_cut_phase,
    _row_to_daily_log,
    _row_to_measurement,
)


SESSION_COOKIE_NAME = "health_export_session"
SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
LOGIN_BODY_MAX_BYTES = 4 * 1024
LOGIN_FAILURE_LIMIT = 5
LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60
LOGIN_LOCKOUT_SECONDS = 10 * 60
HEALTH_EXPORT_JSON_MAX_BYTES = 25 * 1024 * 1024
STRONG_CSV_MAX_BYTES = 10 * 1024 * 1024
STATIC_DIR = Path(__file__).with_name("static")
FRONTEND_DIR = STATIC_DIR / "dashboard"
APP_SETTINGS = Settings()
APP_SETTINGS.validate_runtime_security()
_LOGIN_FAILURES: defaultdict[str, deque[float]] = defaultdict(deque)
_LOGIN_LOCKOUTS: dict[str, float] = {}


async def _notification_scheduler(app: FastAPI) -> None:
    """Fire morning (06:30) and evening (20:30) push notifications daily."""
    import datetime as _dt
    from macrofactor_scraper.notifications import send_push

    sent_morning: str | None = None
    sent_evening: str | None = None

    while True:
        try:
            await asyncio.sleep(60)
            settings = get_settings()
            if not settings.has_push_configured:
                continue
            service: HealthAutoExportService = app.state.health_export_service
            now = _dt.datetime.now()
            today = now.strftime("%Y-%m-%d")

            if now.hour == 6 and now.minute == 30 and sent_morning != today:
                sent_morning = today
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: send_push(
                        service,
                        "Good morning!",
                        "Time to log your morning check-in.",
                        "/morning",
                        vapid_private_key=settings.vapid_private_key,  # type: ignore[arg-type]
                        vapid_contact=settings.vapid_contact,
                    ),
                )

            if now.hour == 20 and now.minute == 30 and sent_evening != today:
                log_row = service.get_daily_log(today)
                if log_row and not log_row.get("pm_energy"):
                    sent_evening = today
                    await asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda: send_push(
                            service,
                            "Evening check-in",
                            "Don't forget to fill in your evening log.",
                            "/evening",
                            vapid_private_key=settings.vapid_private_key,  # type: ignore[arg-type]
                            vapid_contact=settings.vapid_contact,
                        ),
                    )
        except asyncio.CancelledError:
            return
        except Exception as exc:  # noqa: BLE001
            import logging
            logging.getLogger(__name__).warning("Notification scheduler error: %s", exc)


async def _weekly_recap_scheduler(app: FastAPI) -> None:
    """Generate weekly recap every Sunday at 19:00 local time."""
    import datetime as _dt

    generated: str | None = None

    while True:
        try:
            await asyncio.sleep(60)
            settings = get_settings()
            if not settings.anthropic_api_key:
                continue
            now = _dt.datetime.now()
            # Sunday = weekday 6, fire at 19:00
            if now.weekday() != 6 or now.hour != 19 or now.minute != 0:
                continue
            week_start = (now - _dt.timedelta(days=6)).strftime("%Y-%m-%d")
            if generated == week_start:
                continue
            generated = week_start
            service: HealthAutoExportService = app.state.health_export_service
            from macrofactor_scraper.ai import generate_weekly_recap
            result = await generate_weekly_recap(
                service,
                _dt.date.fromisoformat(week_start),
                settings.anthropic_api_key,
            )
            service.upsert_weekly_recap(
                result["week_start_date"],
                result["narrative"],
                result["highlights"],
                result["model"],
                result["tokens_used"],
            )
            if settings.has_push_configured:
                from macrofactor_scraper.notifications import send_push
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: send_push(
                        service,
                        "Your weekly recap is ready",
                        "See how your week went — open the app to read it.",
                        "/week",
                        vapid_private_key=settings.vapid_private_key,  # type: ignore[arg-type]
                        vapid_contact=settings.vapid_contact,
                    ),
                )
        except asyncio.CancelledError:
            return
        except Exception as exc:  # noqa: BLE001
            import logging
            logging.getLogger(__name__).warning("Weekly recap scheduler error: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Start Garmin background sync if credentials configured
    _garmin_task = None
    settings = get_settings()
    if settings.has_garmin_credentials:
        from macrofactor_scraper.garmin import GarminSyncService, garmin_sync_loop
        garmin = GarminSyncService(
            username=settings.garmin_username,  # type: ignore[arg-type]
            password=settings.garmin_password,  # type: ignore[arg-type]
            mfa_secret=settings.garmin_mfa_secret,
            tokenstore=settings.garmin_tokenstore,
        )
        app.state.garmin_service = garmin
        _garmin_task = asyncio.create_task(
            garmin_sync_loop(app, interval_hours=settings.garmin_sync_interval_hours)
        )
    _notif_task = None
    if settings.has_push_configured:
        _notif_task = asyncio.create_task(_notification_scheduler(app))
    _recap_task = None
    if settings.anthropic_api_key:
        _recap_task = asyncio.create_task(_weekly_recap_scheduler(app))
    yield
    if _garmin_task is not None:
        _garmin_task.cancel()
    if _notif_task is not None:
        _notif_task.cancel()
    if _recap_task is not None:
        _recap_task.cancel()
    service = getattr(app.state, "health_export_service", None)
    if service is not None:
        service.close()


app = FastAPI(
    title="Health Auto Export Ingestion API",
    version="0.2.0",
    description="Local-first API for ingesting Apple Health data exported by Health Auto Export.",
    lifespan=lifespan,
    docs_url=None if APP_SETTINGS.environment == "production" else "/docs",
    redoc_url=None if APP_SETTINGS.environment == "production" else "/redoc",
    openapi_url=None if APP_SETTINGS.environment == "production" else "/openapi.json",
)
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets", check_dir=False), name="dashboard-assets")
app.mount("/icons", StaticFiles(directory=FRONTEND_DIR / "icons", check_dir=False), name="dashboard-icons")


def get_health_export_service(settings: Settings = Depends(get_settings)) -> HealthAutoExportService:
    service = getattr(app.state, "health_export_service", None)
    if service is not None:
        return service
    service = HealthAutoExportService(settings.sqlite_path)
    app.state.health_export_service = service
    return service


def _valid_api_key(candidate: str | None, settings: Settings) -> bool:
    return bool(settings.ingest_api_key and candidate and hmac.compare_digest(candidate, settings.ingest_api_key))


def _valid_read_api_key(candidate: str | None, settings: Settings) -> bool:
    expected = settings.read_api_key
    if expected is None and settings.environment != "production":
        expected = settings.ingest_api_key
    return bool(expected and candidate and hmac.compare_digest(candidate, expected))


def _sign_session(expires_at: int, secret: str) -> str:
    payload = str(expires_at).encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), payload, sha256).hexdigest()
    token = f"{expires_at}:{signature}".encode("utf-8")
    return base64.urlsafe_b64encode(token).decode("ascii")


def _verify_session(token: str | None, settings: Settings) -> bool:
    secret = settings.effective_session_secret
    if not token or not secret:
        return False
    try:
        decoded = base64.urlsafe_b64decode(token.encode("ascii")).decode("utf-8")
        expires_at_text, signature = decoded.split(":", 1)
        expires_at = int(expires_at_text)
    except (ValueError, UnicodeDecodeError):
        return False
    if expires_at < int(time.time()):
        return False
    expected = hmac.new(secret.encode("utf-8"), expires_at_text.encode("utf-8"), sha256).hexdigest()
    return hmac.compare_digest(signature, expected)


def require_private_access(
    request: Request,
    x_api_key: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    if not settings.read_api_key and not (settings.environment != "production" and settings.ingest_api_key):
        raise HTTPException(status_code=500, detail="Read API key is not configured")
    if _valid_read_api_key(x_api_key, settings):
        return
    if _verify_session(request.cookies.get(SESSION_COOKIE_NAME), settings):
        return
    raise HTTPException(status_code=401, detail="Authentication required")


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


@app.get("/")
async def dashboard(request: Request, settings: Settings = Depends(get_settings)) -> Response:
    if _verify_session(request.cookies.get(SESSION_COOKIE_NAME), settings):
        return HTMLResponse(_read_static("dashboard.html"))
    return RedirectResponse("/login", status_code=303)


@app.get("/login", response_class=HTMLResponse)
async def login_page() -> HTMLResponse:
    return HTMLResponse(_read_static("login.html"))


@app.post("/login")
async def login(request: Request, settings: Settings = Depends(get_settings)) -> Response:
    _enforce_content_length(request, LOGIN_BODY_MAX_BYTES)
    client_key = _client_key(request)
    now = time.time()
    if _is_login_locked(client_key, now):
        return HTMLResponse(_read_static("login.html", error="Too many failed attempts. Try again later."), status_code=429)

    raw_body = await request.body()
    if len(raw_body) > LOGIN_BODY_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Login request body is too large")
    body = raw_body.decode("utf-8")
    password = parse_qs(body).get("password", [""])[0]
    if not settings.verify_dashboard_password(password):
        _record_login_failure(client_key, now)
        return HTMLResponse(_read_static("login.html", error="Invalid password"), status_code=401)
    _clear_login_failures(client_key)
    expires_at = int(time.time()) + SESSION_MAX_AGE_SECONDS
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        SESSION_COOKIE_NAME,
        _sign_session(expires_at, settings.effective_session_secret or ""),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
    )
    return response


@app.post("/logout")
async def logout() -> Response:
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(SESSION_COOKIE_NAME)
    return response


@app.post("/v1/admin/repair", response_model=RepairReport)
async def admin_repair(
    date: date,
    dry_run: bool = True,
    x_api_key: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> RepairReport:
    if not settings.ingest_api_key or x_api_key != settings.ingest_api_key:
        raise HTTPException(status_code=401, detail="Invalid admin API key")
    backup_dir = Path(settings.sqlite_path).parent / "repair_backups"
    return service.repair_running_totals(date, date, dry_run=dry_run, backup_dir=backup_dir)


@app.post("/v1/ingest/health-auto-export", response_model=IngestResponse)
async def ingest_health_auto_export(
    request: Request,
    x_api_key: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> IngestResponse:
    if not settings.ingest_api_key:
        raise HTTPException(status_code=500, detail="Ingestion API key is not configured")
    if x_api_key != settings.ingest_api_key:
        raise HTTPException(status_code=401, detail="Invalid ingestion API key")
    _enforce_content_length(request, HEALTH_EXPORT_JSON_MAX_BYTES)
    body = await request.body()
    if len(body) > HEALTH_EXPORT_JSON_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Health export payload is too large")
    try:
        payload = json.loads(body)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Malformed JSON payload") from exc
    try:
        return service.ingest(payload, dict(request.headers))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/v1/metrics", response_model=MetricListResponse, dependencies=[Depends(require_private_access)])
async def metrics(service: HealthAutoExportService = Depends(get_health_export_service)) -> MetricListResponse:
    return service.list_metrics()


@app.get("/v1/metrics/{metric_name}", response_model=MetricRecordsResponse, dependencies=[Depends(require_private_access)])
async def metric_records(
    metric_name: str,
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> MetricRecordsResponse:
    try:
        return service.metric_records(metric_name, start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/v1/daily-summary", response_model=DailySummaryResponse, dependencies=[Depends(require_private_access)])
async def daily_summary(
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> DailySummaryResponse:
    try:
        return service.daily_summary(start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/v1/dashboard/summary", response_model=DashboardSummaryResponse, dependencies=[Depends(require_private_access)])
async def dashboard_summary(
    start: date | None = None,
    end: date | None = None,
    include_hidden: bool = False,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> DashboardSummaryResponse:
    try:
        return service.dashboard_summary(start, end, include_hidden=include_hidden)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/v1/dashboard/preferences", response_model=DashboardPreferences, dependencies=[Depends(require_private_access)])
async def dashboard_preferences(service: HealthAutoExportService = Depends(get_health_export_service)) -> DashboardPreferences:
    return service.dashboard_preferences()


@app.put("/v1/dashboard/preferences", response_model=DashboardPreferences, dependencies=[Depends(require_private_access)])
async def update_dashboard_preferences(
    preferences: DashboardPreferences,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> DashboardPreferences:
    return service.update_dashboard_preferences(preferences)


@app.get("/v1/dashboard/metric-catalog", response_model=DashboardMetricCatalogResponse, dependencies=[Depends(require_private_access)])
async def dashboard_metric_catalog(service: HealthAutoExportService = Depends(get_health_export_service)) -> DashboardMetricCatalogResponse:
    return service.dashboard_metric_catalog()


@app.get("/v1/diagnostics/metrics/{target_date}", response_model=MetricDateDiagnosticResponse, dependencies=[Depends(require_private_access)])
async def metric_date_diagnostics(
    target_date: date,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> MetricDateDiagnosticResponse:
    return service.metric_date_diagnostics(target_date)


@app.get("/v1/diagnostics/weight/{target_date}", dependencies=[Depends(require_private_access)])
async def weight_diagnostics(
    target_date: date,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> dict:
    """Return every weight row for a date with source/timestamp/quantity for debugging."""
    with service._connect() as conn:
        rows = conn.execute(
            """SELECT id, metric_name, source, timestamp, record_date, quantity, units
               FROM health_records
               WHERE record_date = ? AND metric_name IN ('weight','body_mass','body_weight','weight_body_mass')
               ORDER BY timestamp, id""",
            (target_date.isoformat(),),
        ).fetchall()
    return {
        "date": target_date.isoformat(),
        "rows": [
            {
                "id": r["id"],
                "metric_name": r["metric_name"],
                "source": r["source"],
                "timestamp": r["timestamp"],
                "quantity": float(r["quantity"]),
                "units": r["units"],
            }
            for r in rows
        ],
    }


@app.get("/v1/workouts", response_model=WorkoutListResponse, dependencies=[Depends(require_private_access)])
async def workouts(
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> WorkoutListResponse:
    try:
        return service.workouts(start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/v1/strong/import", response_model=StrongImportResponse, dependencies=[Depends(require_private_access)])
async def import_strong_csv(
    request: Request,
    file: UploadFile = File(...),
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> StrongImportResponse:
    _enforce_content_length(request, STRONG_CSV_MAX_BYTES + 1024 * 1024)
    filename = file.filename or "strong.csv"
    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=422, detail="Strong export must be a CSV file")
    content = await file.read()
    if len(content) > STRONG_CSV_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Strong export CSV is too large")
    try:
        return service.import_strong_csv(filename, content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/v1/strong/imports", response_model=StrongImportListResponse, dependencies=[Depends(require_private_access)])
async def strong_imports(service: HealthAutoExportService = Depends(get_health_export_service)) -> StrongImportListResponse:
    return service.strong_imports()


@app.get("/v1/strong/summary", response_model=StrongSummaryResponse, dependencies=[Depends(require_private_access)])
async def strong_summary(
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> StrongSummaryResponse:
    try:
        return service.strong_summary(start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/v1/strong/analytics", response_model=StrongAnalyticsResponse, dependencies=[Depends(require_private_access)])
async def strong_analytics(
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> StrongAnalyticsResponse:
    try:
        return service.strong_analytics(start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/v1/strong/sessions", response_model=StrongSessionListResponse, dependencies=[Depends(require_private_access)])
async def strong_sessions(
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> StrongSessionListResponse:
    try:
        return service.strong_sessions(start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/v1/strong/sessions/{session_id}", response_model=StrongSessionRecord, dependencies=[Depends(require_private_access)])
async def strong_session_detail(
    session_id: int,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> StrongSessionRecord:
    session = service.strong_session_detail(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Strong session not found")
    return session


@app.get("/v1/strong/exercises/{exercise_name}", response_model=StrongExerciseDetailResponse, dependencies=[Depends(require_private_access)])
async def strong_exercise_detail(
    exercise_name: str,
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> StrongExerciseDetailResponse:
    try:
        return service.strong_exercise_detail(exercise_name, start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/v1/ingest/status", response_model=IngestStatusResponse, dependencies=[Depends(require_private_access)])
async def ingest_status(service: HealthAutoExportService = Depends(get_health_export_service)) -> IngestStatusResponse:
    return service.ingest_status()


@app.get("/v1/export/daily-summary.csv", dependencies=[Depends(require_private_access)])
async def export_daily_summary(
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> Response:
    try:
        summary = service.daily_summary(start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["date", "calories_kcal", "protein_g", "carbohydrates_g", "fat_g", "water_ml", "weight_kg", "steps", "active_energy_kcal"])
    for item in summary.summaries:
        writer.writerow([
            item.date.isoformat(),
            item.calories,
            item.protein,
            item.carbohydrates,
            item.fat,
            item.water,
            item.weight,
            item.steps,
            item.active_energy,
        ])
    return _csv_response(output.getvalue(), "daily-summary.csv")


@app.get("/v1/export/metrics/{metric_name}.csv", dependencies=[Depends(require_private_access)])
async def export_metric_records(
    metric_name: str,
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> Response:
    try:
        records = service.metric_records(metric_name, start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "metric_name", "units", "date", "timestamp", "quantity", "source"])
    for item in records.records:
        writer.writerow([
            item.id,
            item.metric_name,
            item.units,
            item.date.isoformat() if item.date else None,
            item.timestamp.isoformat() if item.timestamp else None,
            item.quantity,
            item.source,
        ])
    return _csv_response(output.getvalue(), f"{metric_name}.csv")


def _csv_response(body: str, filename: str) -> Response:
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/v1/excel/daily-log.csv", dependencies=[Depends(require_private_access)])
async def excel_daily_log(
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> Response:
    try:
        rows = service.excel_daily_log_rows(start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _csv_rows_response(
        rows,
        ["date", "calories", "protein", "carbohydrates", "fat", "water", "weight", "steps", "active_energy"],
        "excel-daily-log.csv",
    )


@app.get("/v1/excel/calories-weight.csv", dependencies=[Depends(require_private_access)])
async def excel_calories_weight(
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> Response:
    try:
        rows = service.excel_calories_weight_rows(start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _csv_rows_response(
        rows,
        ["date", "calories", "weight", "rolling_calories_7d", "weight_delta"],
        "excel-calories-weight.csv",
    )


@app.get("/v1/excel/metrics/{metric_name}.csv", dependencies=[Depends(require_private_access)])
async def excel_metric_records(
    metric_name: str,
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> Response:
    try:
        records = service.metric_records(metric_name, start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    rows = [
        {
            "id": item.id,
            "metric_name": item.metric_name,
            "units": item.units,
            "date": item.date.isoformat() if item.date else None,
            "timestamp": item.timestamp.isoformat() if item.timestamp else None,
            "quantity": item.quantity,
            "source": item.source,
        }
        for item in records.records
    ]
    return _csv_rows_response(rows, ["id", "metric_name", "units", "date", "timestamp", "quantity", "source"], f"excel-{metric_name}.csv")


def _csv_rows_response(rows: list[dict[str, object]], fieldnames: list[str], filename: str) -> Response:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({field: "" if row.get(field) is None else row.get(field) for field in fieldnames})
    return _csv_response(output.getvalue(), filename)


def _enforce_content_length(request: Request, max_bytes: int) -> None:
    content_length = request.headers.get("content-length")
    if content_length is None:
        return
    try:
        length = int(content_length)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid Content-Length header") from exc
    if length > max_bytes:
        raise HTTPException(status_code=413, detail="Request body is too large")


def _client_key(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.rsplit(",", 1)[-1].strip()
    return request.client.host if request.client else "unknown"


def _is_login_locked(client_key: str, now: float) -> bool:
    locked_until = _LOGIN_LOCKOUTS.get(client_key)
    if locked_until is None:
        return False
    if locked_until <= now:
        _LOGIN_LOCKOUTS.pop(client_key, None)
        _LOGIN_FAILURES.pop(client_key, None)
        return False
    return True


def _record_login_failure(client_key: str, now: float) -> None:
    failures = _LOGIN_FAILURES[client_key]
    cutoff = now - LOGIN_FAILURE_WINDOW_SECONDS
    while failures and failures[0] < cutoff:
        failures.popleft()
    failures.append(now)
    if len(failures) >= LOGIN_FAILURE_LIMIT:
        _LOGIN_LOCKOUTS[client_key] = now + LOGIN_LOCKOUT_SECONDS


def _clear_login_failures(client_key: str) -> None:
    _LOGIN_FAILURES.pop(client_key, None)
    _LOGIN_LOCKOUTS.pop(client_key, None)


@app.get("/v1/garmin/status", dependencies=[Depends(require_private_access)])
async def garmin_status() -> dict:
    garmin = getattr(app.state, "garmin_service", None)
    if garmin is None:
        return {"configured": False, "last_sync_at": None, "last_error": None}
    return {
        "configured": True,
        "last_sync_at": garmin.last_sync_at.isoformat() if garmin.last_sync_at else None,
        "last_error": garmin.last_error,
    }


@app.post("/v1/garmin/sync", dependencies=[Depends(require_private_access)])
async def garmin_manual_sync(
    sync_date: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> dict:
    garmin = getattr(app.state, "garmin_service", None)
    if garmin is None:
        raise HTTPException(status_code=503, detail="Garmin not configured — set GARMIN_USERNAME and GARMIN_PASSWORD")
    from macrofactor_scraper.garmin import _SYNC_LOCK
    async with _SYNC_LOCK:
        if sync_date:
            changed = await asyncio.get_event_loop().run_in_executor(
                None, garmin.sync_date, sync_date, service
            )
        else:
            changed = await asyncio.get_event_loop().run_in_executor(
                None, garmin.sync_recent, service
            )
    return {"synced": True, "changed": changed if isinstance(changed, dict) else {}}


@app.get("/v1/garmin/debug/{for_date}", dependencies=[Depends(require_private_access)])
async def garmin_debug(
    for_date: date,
) -> dict:
    garmin = getattr(app.state, "garmin_service", None)
    if garmin is None:
        raise HTTPException(status_code=503, detail="Garmin not configured - set GARMIN_USERNAME and GARMIN_PASSWORD")
    from macrofactor_scraper.garmin import _SYNC_LOCK
    async with _SYNC_LOCK:
        return await asyncio.get_event_loop().run_in_executor(None, garmin.debug_date, for_date)


@app.get("/v1/garmin/values/{for_date}", dependencies=[Depends(require_private_access)])
async def garmin_values(
    for_date: date,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> dict:
    """Return Garmin-sourced metric values for a date (for evening form autofill)."""
    with service._connect() as conn:
        rows = conn.execute(
            "SELECT metric_name, quantity FROM health_records WHERE record_date = ? AND source = 'Garmin'",
            (for_date.isoformat(),),
        ).fetchall()
    return {row["metric_name"]: float(row["quantity"]) for row in rows}


@app.get("/v1/garmin/categories", dependencies=[Depends(require_private_access)])
async def garmin_categories() -> dict:
    """Return metric categories + units for the Health tab."""
    from macrofactor_scraper.garmin import GARMIN_METRIC_CATEGORIES, GARMIN_METRIC_UNITS
    return {"categories": GARMIN_METRIC_CATEGORIES, "units": GARMIN_METRIC_UNITS}


@app.get("/v1/garmin/series/{metric_name}", dependencies=[Depends(require_private_access)])
async def garmin_series(
    metric_name: str,
    days: int = 30,
    start: str | None = None,
    end: str | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> dict:
    """Return a time series of a single Garmin metric. Use start+end for date range or days for lookback."""
    from macrofactor_scraper.garmin import ALL_GARMIN_METRICS, GARMIN_METRIC_UNITS
    if metric_name not in ALL_GARMIN_METRICS:
        raise HTTPException(status_code=404, detail=f"Unknown Garmin metric: {metric_name!r}")
    with service._connect() as conn:
        if start and end:
            rows = conn.execute(
                """
                SELECT record_date, quantity FROM health_records
                WHERE source = 'Garmin' AND metric_name = ?
                  AND record_date BETWEEN ? AND ?
                ORDER BY record_date ASC
                """,
                (metric_name, start, end),
            ).fetchall()
        else:
            if not (1 <= days <= 365):
                raise HTTPException(status_code=400, detail="days must be 1–365")
            rows = conn.execute(
                """
                SELECT record_date, quantity FROM health_records
                WHERE source = 'Garmin' AND metric_name = ?
                  AND record_date >= date('now', ? || ' days')
                ORDER BY record_date ASC
                """,
                (metric_name, f"-{days}"),
            ).fetchall()
    units = GARMIN_METRIC_UNITS.get(metric_name, "")
    return {
        "metric": metric_name,
        "units": units,
        "points": [{"date": row["record_date"], "value": float(row["quantity"])} for row in rows],
    }


@app.get("/v1/cut-phases", response_model=CutPhaseListResponse, dependencies=[Depends(require_private_access)])
async def list_cut_phases(service: HealthAutoExportService = Depends(get_health_export_service)) -> CutPhaseListResponse:
    phases = service.get_cut_phases()
    return CutPhaseListResponse(count=len(phases), phases=[_row_to_cut_phase(p) for p in phases])


@app.post("/v1/cut-phases", response_model=CutPhase, dependencies=[Depends(require_private_access)])
async def create_cut_phase(
    body: CutPhaseCreate,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> CutPhase:
    row = service.create_cut_phase(
        name=body.name,
        start_date=body.start_date.isoformat(),
        end_date=body.end_date.isoformat() if body.end_date else None,
        target_weight_kg=body.target_weight_kg,
        target_calories=body.target_calories,
        notes=body.notes,
    )
    return _row_to_cut_phase(row)


@app.put("/v1/cut-phases/{phase_id}", response_model=CutPhase, dependencies=[Depends(require_private_access)])
async def update_cut_phase(
    phase_id: int,
    body: CutPhaseUpdate,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> CutPhase:
    fields = body.model_dump(exclude_unset=True)
    if "start_date" in fields and fields["start_date"] is not None:
        fields["start_date"] = fields["start_date"].isoformat()
    if "end_date" in fields and fields["end_date"] is not None:
        fields["end_date"] = fields["end_date"].isoformat()
    row = service.update_cut_phase(phase_id, **fields)
    if row is None:
        raise HTTPException(status_code=404, detail="Cut phase not found")
    return _row_to_cut_phase(row)


@app.get("/v1/cut-phases/{phase_id}/drift", dependencies=[Depends(require_private_access)])
async def cut_phase_drift(
    phase_id: int,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> dict:
    from macrofactor_scraper.analytics import evaluate_cut_drift
    return await asyncio.get_event_loop().run_in_executor(
        None, evaluate_cut_drift, service, phase_id, date.today()
    )


@app.get("/v1/daily-log", response_model=DailyLogListResponse, dependencies=[Depends(require_private_access)])
async def list_daily_logs(
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> DailyLogListResponse:
    try:
        rows = service.get_daily_logs(start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DailyLogListResponse(count=len(rows), logs=[_row_to_daily_log(r) for r in rows])


@app.get("/v1/daily-log/{log_date}", response_model=DailyLog, dependencies=[Depends(require_private_access)])
async def get_daily_log(log_date: date, service: HealthAutoExportService = Depends(get_health_export_service)) -> DailyLog:
    row = service.get_daily_log(log_date.isoformat())
    if row is None:
        raise HTTPException(status_code=404, detail="No log entry for this date")
    return _row_to_daily_log(row)


@app.put("/v1/daily-log/{log_date}", response_model=DailyLog, dependencies=[Depends(require_private_access)])
async def upsert_daily_log(
    log_date: date,
    body: DailyLogUpsert,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> DailyLog:
    fields = body.model_dump(exclude_unset=True)
    # Convert booleans to ints for SQLite
    for bool_field in ("gym_done", "vyvanse_taken", "dex_booster_taken"):
        if bool_field in fields and fields[bool_field] is not None:
            fields[bool_field] = int(fields[bool_field])
    row = service.upsert_daily_log(log_date.isoformat(), fields)
    return _row_to_daily_log(row)


@app.get("/v1/measurements", response_model=BodyMeasurementListResponse, dependencies=[Depends(require_private_access)])
async def list_measurements(
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> BodyMeasurementListResponse:
    try:
        rows = service.get_measurements(start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return BodyMeasurementListResponse(count=len(rows), measurements=[_row_to_measurement(r) for r in rows])


@app.get("/v1/measurements/{measure_date}", response_model=BodyMeasurement, dependencies=[Depends(require_private_access)])
async def get_measurement(measure_date: date, service: HealthAutoExportService = Depends(get_health_export_service)) -> BodyMeasurement:
    row = service.get_measurement(measure_date.isoformat())
    if row is None:
        raise HTTPException(status_code=404, detail="No measurement entry for this date")
    return _row_to_measurement(row)


@app.put("/v1/measurements/{measure_date}", response_model=BodyMeasurement, dependencies=[Depends(require_private_access)])
async def upsert_measurement(
    measure_date: date,
    body: BodyMeasurementUpsert,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> BodyMeasurement:
    fields = body.model_dump(exclude_unset=True)
    row = service.upsert_measurement(measure_date.isoformat(), fields)
    return _row_to_measurement(row)


@app.get("/v1/coach/draft", response_model=CoachDraftResponse, dependencies=[Depends(require_private_access)])
async def coach_draft(
    for_date: date | None = None,
    kind: str = "check_in",
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> CoachDraftResponse:
    from macrofactor_scraper.coach import build_coach_data, build_prompt
    import datetime as _dt
    target = for_date or _dt.date.today()
    coach_data = build_coach_data(service, target)
    prompt_text = build_prompt(coach_data, kind=kind)
    return CoachDraftResponse(date=target.isoformat(), prompt_text=prompt_text)


@app.get("/v1/insights/readiness/{record_date}", response_model=ReadinessReport, dependencies=[Depends(require_private_access)])
async def insights_readiness(
    record_date: date,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> ReadinessReport:
    from macrofactor_scraper.analytics import readiness_for
    return readiness_for(service, record_date)


@app.get("/v1/insights/anomalies/{record_date}", dependencies=[Depends(require_private_access)])
async def insights_anomalies(
    record_date: date,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> dict:
    from macrofactor_scraper.insights import compute_anomalies
    prefs = service.dashboard_preferences()
    protein_goal = getattr(prefs, "protein_goal_g", None)
    anomalies = compute_anomalies(service, record_date, protein_goal_g=protein_goal)
    return {"date": record_date.isoformat(), "anomalies": [a.to_dict() for a in anomalies]}


@app.get("/v1/streaks", dependencies=[Depends(require_private_access)])
async def get_streaks(
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> dict:
    from macrofactor_scraper.streaks import compute_streaks
    prefs = service.dashboard_preferences()
    protein_goal = getattr(prefs, "protein_goal_g", None)
    active_phase = service.get_active_cut_phase()
    kcal_goal = active_phase.get("target_calories") if active_phase else None
    steps_goal = None
    streaks = await asyncio.get_event_loop().run_in_executor(
        None, lambda: compute_streaks(service, protein_goal_g=protein_goal, kcal_goal=kcal_goal, steps_goal=steps_goal)
    )
    return {"streaks": streaks}


@app.get("/v1/badges", dependencies=[Depends(require_private_access)])
async def get_badges(
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> dict:
    from macrofactor_scraper.streaks import compute_badges
    prefs = service.dashboard_preferences()
    protein_goal = getattr(prefs, "protein_goal_g", None)
    badges = await asyncio.get_event_loop().run_in_executor(
        None, lambda: compute_badges(service, protein_goal_g=protein_goal)
    )
    earned_count = sum(1 for b in badges if b["earned"])
    return {"badges": badges, "earned_count": earned_count, "total": len(badges)}


@app.get("/v1/insights/refeed-suggestion/{record_date}", dependencies=[Depends(require_private_access)])
async def insights_refeed_suggestion(
    record_date: date,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> dict:
    from macrofactor_scraper.insights import recommend_refeed
    return await asyncio.get_event_loop().run_in_executor(
        None, recommend_refeed, service, record_date
    )


@app.get("/v1/insights/training-call/{record_date}", dependencies=[Depends(require_private_access)])
async def insights_training_call(
    record_date: date,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> dict:
    from macrofactor_scraper.insights import recommend_training
    return await asyncio.get_event_loop().run_in_executor(
        None, recommend_training, service, record_date
    )


PHOTO_MAX_BYTES = 15 * 1024 * 1024
VALID_POSES = {"front", "side"}


def _get_photos_dir(settings: Settings) -> Path:
    d = settings.photos_dir
    d.mkdir(parents=True, exist_ok=True)
    return d


def _photo_path(photos_dir: Path, photo_date: str, pose: str) -> Path:
    return photos_dir / f"{photo_date}_{pose}.jpg"


@app.post("/v1/photos/{photo_date}", dependencies=[Depends(require_private_access)])
async def upload_photo(
    photo_date: str,
    pose: str = Query(...),
    file: UploadFile = File(...),
    service: HealthAutoExportService = Depends(get_health_export_service),
    settings: Settings = Depends(get_settings),
) -> dict:
    if pose not in VALID_POSES:
        raise HTTPException(status_code=400, detail=f"pose must be one of {sorted(VALID_POSES)}")
    data = await file.read(PHOTO_MAX_BYTES + 1)
    if len(data) > PHOTO_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Photo exceeds 15 MB limit")

    try:
        from PIL import Image
        import io as _io
        img = Image.open(_io.BytesIO(data))
        img = img.convert("RGB")
        if img.width > 1400 or img.height > 1400:
            img.thumbnail((1400, 1400), Image.LANCZOS)
        buf = _io.BytesIO()
        img.save(buf, format="JPEG", quality=82, optimize=True)
        compressed = buf.getvalue()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image: {exc}") from exc

    photos_dir = _get_photos_dir(settings)
    dest = _photo_path(photos_dir, photo_date, pose)
    dest.write_bytes(compressed)
    service.record_photo(photo_date, pose, len(compressed))
    return {"date": photo_date, "pose": pose, "size_bytes": len(compressed)}


@app.get("/v1/photos/{photo_date}/{pose}")
async def serve_photo(
    photo_date: str,
    pose: str,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    if not _verify_session(request.cookies.get(SESSION_COOKIE_NAME), settings):
        raise HTTPException(status_code=401, detail="Authentication required")
    if pose not in VALID_POSES:
        raise HTTPException(status_code=404, detail="Not found")
    photos_dir = _get_photos_dir(settings)
    path = _photo_path(photos_dir, photo_date, pose)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")
    return FileResponse(path, media_type="image/jpeg")


@app.get("/v1/photos/list", response_model=PhotoListResponse, dependencies=[Depends(require_private_access)])
async def list_photos(
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> PhotoListResponse:
    rows = service.list_photos()
    by_date: dict[str, list[str]] = {}
    weight_by_date: dict[str, float | None] = {}
    for row in rows:
        by_date.setdefault(row["photo_date"], []).append(row["pose"])
        weight_by_date[row["photo_date"]] = row.get("weight_kg")
    dates = [
        PhotoDateEntry(date=d, poses=poses, weight_kg=weight_by_date.get(d))
        for d, poses in sorted(by_date.items(), reverse=True)
    ]
    return PhotoListResponse(count=len(dates), dates=dates)


@app.delete("/v1/photos/{photo_date}/{pose}", dependencies=[Depends(require_private_access)])
async def delete_photo(
    photo_date: str,
    pose: str,
    service: HealthAutoExportService = Depends(get_health_export_service),
    settings: Settings = Depends(get_settings),
) -> dict:
    if pose not in VALID_POSES:
        raise HTTPException(status_code=404, detail="Not found")
    photos_dir = _get_photos_dir(settings)
    path = _photo_path(photos_dir, photo_date, pose)
    if path.exists():
        path.unlink()
    deleted = service.delete_photo_record(photo_date, pose)
    if not deleted and not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")
    return {"deleted": True, "date": photo_date, "pose": pose}


@app.get("/v1/push/vapid-public-key", dependencies=[Depends(require_private_access)])
async def get_vapid_public_key(settings: Settings = Depends(get_settings)) -> dict:
    if not settings.has_push_configured:
        raise HTTPException(status_code=503, detail="Push notifications not configured — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY")
    return {"publicKey": settings.vapid_public_key}


class PushSubscribeRequest(BaseModel):
    endpoint: str
    keys: dict[str, str]


@app.post("/v1/push/subscribe", status_code=201, dependencies=[Depends(require_private_access)])
async def push_subscribe(
    body: PushSubscribeRequest,
    service: HealthAutoExportService = Depends(get_health_export_service),
    settings: Settings = Depends(get_settings),
) -> dict:
    if not settings.has_push_configured:
        raise HTTPException(status_code=503, detail="Push notifications not configured")
    service.upsert_push_subscription(
        endpoint=body.endpoint,
        p256dh=body.keys.get("p256dh", ""),
        auth=body.keys.get("auth", ""),
    )
    return {"subscribed": True}


@app.delete("/v1/push/subscribe", dependencies=[Depends(require_private_access)])
async def push_unsubscribe(
    body: PushSubscribeRequest,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> dict:
    removed = service.delete_push_subscription(body.endpoint)
    return {"unsubscribed": removed}


@app.post("/v1/push/test", dependencies=[Depends(require_private_access)])
async def push_test(
    service: HealthAutoExportService = Depends(get_health_export_service),
    settings: Settings = Depends(get_settings),
) -> dict:
    if not settings.has_push_configured:
        raise HTTPException(status_code=503, detail="Push notifications not configured")
    from macrofactor_scraper.notifications import send_push
    sent = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: send_push(
            service,
            "Health Dashboard",
            "Push notifications are working!",
            "/",
            vapid_private_key=settings.vapid_private_key,  # type: ignore[arg-type]
            vapid_contact=settings.vapid_contact,
        ),
    )
    return {"sent": sent}


@app.post("/v1/ai/analyse", response_model=AiAnalyseResponse, dependencies=[Depends(require_private_access)])
async def ai_analyse(
    body: AiAnalyseRequest,
    service: HealthAutoExportService = Depends(get_health_export_service),
    settings: Settings = Depends(get_settings),
) -> AiAnalyseResponse:
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="AI analysis not configured — set ANTHROPIC_API_KEY")
    from macrofactor_scraper.ai import run_analysis, check_rate_limit, RateLimitError
    try:
        check_rate_limit()
    except RateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    analysis_date = date.fromisoformat(body.date) if body.date else date.today()
    result = await run_analysis(service, analysis_date, body.type, settings.anthropic_api_key)
    return AiAnalyseResponse(**result)


@app.get("/v1/weekly-recap/list", dependencies=[Depends(require_private_access)])
async def weekly_recap_list(
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> dict:
    recaps = await asyncio.get_event_loop().run_in_executor(None, lambda: service.list_weekly_recaps())
    return {"recaps": recaps}


@app.get("/v1/weekly-recap/{week_start}", dependencies=[Depends(require_private_access)])
async def weekly_recap_get(
    week_start: str,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> dict:
    recap = await asyncio.get_event_loop().run_in_executor(None, lambda: service.get_weekly_recap(week_start))
    if not recap:
        raise HTTPException(status_code=404, detail="No recap found for this week")
    return recap


@app.post("/v1/weekly-recap/{week_start}/regenerate", dependencies=[Depends(require_private_access)])
async def weekly_recap_regenerate(
    week_start: str,
    service: HealthAutoExportService = Depends(get_health_export_service),
    settings: Settings = Depends(get_settings),
) -> dict:
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="AI not configured")
    from macrofactor_scraper.ai import generate_weekly_recap, check_rate_limit, RateLimitError
    try:
        check_rate_limit()
    except RateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    try:
        week_date = date.fromisoformat(week_start)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid week_start date")
    result = await generate_weekly_recap(service, week_date, settings.anthropic_api_key)
    await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: service.upsert_weekly_recap(
            result["week_start_date"],
            result["narrative"],
            result["highlights"],
            result["model"],
            result["tokens_used"],
        ),
    )
    return result


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str, request: Request, settings: Settings = Depends(get_settings)) -> Response:
    # Serve PWA static files (sw.js, workbox-*.js, manifest, registerSW.js) without auth
    candidate = FRONTEND_DIR / full_path
    try:
        candidate = candidate.resolve()
        FRONTEND_DIR.resolve()
    except Exception:
        pass
    else:
        if str(candidate).startswith(str(FRONTEND_DIR.resolve())) and candidate.is_file() and candidate.suffix in {".js", ".webmanifest", ".json", ".txt", ".ico"}:
            return FileResponse(candidate)
    if not _verify_session(request.cookies.get(SESSION_COOKIE_NAME), settings):
        return RedirectResponse("/login", status_code=303)
    return HTMLResponse(_read_static("dashboard.html"))


def _read_static(filename: str, *, error: str | None = None) -> str:
    path = FRONTEND_DIR / "index.html" if filename == "dashboard.html" and (FRONTEND_DIR / "index.html").exists() else STATIC_DIR / filename
    body = path.read_text(encoding="utf-8")
    if error is not None:
        body = body.replace("{{ error }}", error)
    return body.replace("{{ error }}", "")
