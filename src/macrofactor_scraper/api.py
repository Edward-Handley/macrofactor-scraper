from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date

from fastapi import Depends, FastAPI, Header, HTTPException, Request

from macrofactor_scraper.config import Settings, get_settings
from macrofactor_scraper.health_export import HealthAutoExportService
from macrofactor_scraper.models import (
    DailySummaryResponse,
    HealthResponse,
    IngestResponse,
    MetricListResponse,
    MetricRecordsResponse,
    WorkoutListResponse,
)


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
)


def get_health_export_service(settings: Settings = Depends(get_settings)) -> HealthAutoExportService:
    service = getattr(app.state, "health_export_service", None)
    if service is not None:
        return service
    service = HealthAutoExportService(settings.sqlite_path)
    app.state.health_export_service = service
    return service


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


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


@app.get("/v1/metrics", response_model=MetricListResponse)
async def metrics(service: HealthAutoExportService = Depends(get_health_export_service)) -> MetricListResponse:
    return service.list_metrics()


@app.get("/v1/metrics/{metric_name}", response_model=MetricRecordsResponse)
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


@app.get("/v1/daily-summary", response_model=DailySummaryResponse)
async def daily_summary(
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> DailySummaryResponse:
    try:
        return service.daily_summary(start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/v1/workouts", response_model=WorkoutListResponse)
async def workouts(
    start: date | None = None,
    end: date | None = None,
    service: HealthAutoExportService = Depends(get_health_export_service),
) -> WorkoutListResponse:
    try:
        return service.workouts(start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
