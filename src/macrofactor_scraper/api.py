from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date

from fastapi import Depends, FastAPI, HTTPException, Query

from macrofactor_scraper.auth import FirebaseAuthClient
from macrofactor_scraper.config import Settings, get_settings
from macrofactor_scraper.errors import AuthenticationError, ConfigurationError, UpstreamError
from macrofactor_scraper.firestore import FirestoreClient
from macrofactor_scraper.models import DatasetCollection, DatasetRecord, HealthResponse, ProfileResponse, RawDatasetResponse
from macrofactor_scraper.service import MacroFactorReadService


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    firestore = getattr(app.state, "firestore", None)
    if firestore is not None:
        await firestore.close()


app = FastAPI(
    title="MacroFactor Scraper API",
    version="0.1.0",
    description="Unofficial local read-only API for MacroFactor account data.",
    lifespan=lifespan,
)


def get_service(settings: Settings = Depends(get_settings)) -> MacroFactorReadService:
    service = getattr(app.state, "service", None)
    if service is not None:
        return service
    auth = FirebaseAuthClient(settings)
    firestore = FirestoreClient(settings, auth)
    app.state.firestore = firestore
    service = MacroFactorReadService(settings, firestore)
    app.state.service = service
    return service


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


@app.get("/v1/profile", response_model=ProfileResponse)
async def profile(service: MacroFactorReadService = Depends(get_service)) -> ProfileResponse:
    return await _call(service.profile)


@app.get("/v1/food-log", response_model=DatasetRecord | None)
async def food_log(
    date_: date = Query(alias="date"),
    service: MacroFactorReadService = Depends(get_service),
) -> DatasetRecord | None:
    return await _call(service.dated_document, "food_log", date_)


@app.get("/v1/nutrition", response_model=DatasetRecord | None)
async def nutrition(
    date_: date = Query(alias="date"),
    service: MacroFactorReadService = Depends(get_service),
) -> DatasetRecord | None:
    return await _call(service.dated_document, "nutrition", date_)


@app.get("/v1/weight-log", response_model=DatasetCollection)
async def weight_log(
    start: date,
    end: date,
    service: MacroFactorReadService = Depends(get_service),
) -> DatasetCollection:
    return await _call(service.collection_between, "weight_log", start, end)


@app.get("/v1/workouts", response_model=DatasetCollection)
async def workouts(
    start: date,
    end: date,
    service: MacroFactorReadService = Depends(get_service),
) -> DatasetCollection:
    return await _call(service.collection_between, "workouts", start, end)


@app.get("/v1/workouts/{workout_id}", response_model=DatasetRecord | None)
async def workout(
    workout_id: str,
    service: MacroFactorReadService = Depends(get_service),
) -> DatasetRecord | None:
    return await _call(service.get_workout, workout_id)


@app.get("/v1/gyms", response_model=DatasetCollection)
async def gyms(service: MacroFactorReadService = Depends(get_service)) -> DatasetCollection:
    return await _call(service.collection, "gyms")


@app.get("/v1/raw/{dataset}", response_model=RawDatasetResponse)
async def raw_dataset(
    dataset: str,
    date_: date | None = Query(default=None, alias="date"),
    service: MacroFactorReadService = Depends(get_service),
) -> RawDatasetResponse:
    values = {"date": date_.isoformat()} if date_ else {}
    return await _call(service.raw_dataset, dataset, **values)


async def _call(function, *args, **kwargs):
    try:
        return await function(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ConfigurationError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except AuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except UpstreamError as exc:
        raise HTTPException(status_code=exc.status_code or 502, detail=str(exc)) from exc
