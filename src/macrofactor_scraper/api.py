from __future__ import annotations

import base64
import csv
import hmac
import io
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date
from hashlib import sha256
from pathlib import Path
from urllib.parse import parse_qs

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, Response, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from macrofactor_scraper.config import Settings, get_settings
from macrofactor_scraper.health_export import HealthAutoExportService
from macrofactor_scraper.models import (
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
    RepairReport,
    StrongExerciseDetailResponse,
    StrongImportListResponse,
    StrongImportResponse,
    StrongSessionListResponse,
    StrongSummaryResponse,
    WorkoutListResponse,
)


SESSION_COOKIE_NAME = "health_export_session"
SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
STATIC_DIR = Path(__file__).with_name("static")
FRONTEND_DIR = STATIC_DIR / "dashboard"
APP_SETTINGS = Settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
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
    expected = settings.read_api_key or settings.ingest_api_key
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
    if not (settings.read_api_key or settings.ingest_api_key):
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
    body = (await request.body()).decode("utf-8")
    password = parse_qs(body).get("password", [""])[0]
    if not settings.dashboard_secret or not hmac.compare_digest(password, settings.dashboard_secret):
        return HTMLResponse(_read_static("login.html", error="Invalid password"), status_code=401)
    expires_at = int(time.time()) + SESSION_MAX_AGE_SECONDS
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        SESSION_COOKIE_NAME,
        _sign_session(expires_at, settings.effective_session_secret or settings.dashboard_secret),
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
    try:
        payload = await request.json()
    except ValueError as exc:
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
    file: UploadFile = File(...),
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> StrongImportResponse:
    filename = file.filename or "strong.csv"
    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=422, detail="Strong export must be a CSV file")
    try:
        return service.import_strong_csv(filename, await file.read())
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


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str, request: Request, settings: Settings = Depends(get_settings)) -> Response:
    if not _verify_session(request.cookies.get(SESSION_COOKIE_NAME), settings):
        return RedirectResponse("/login", status_code=303)
    return HTMLResponse(_read_static("dashboard.html"))


def _read_static(filename: str, *, error: str | None = None) -> str:
    path = FRONTEND_DIR / "index.html" if filename == "dashboard.html" and (FRONTEND_DIR / "index.html").exists() else STATIC_DIR / filename
    body = path.read_text(encoding="utf-8")
    if error is not None:
        body = body.replace("{{ error }}", error)
    return body.replace("{{ error }}", "")
