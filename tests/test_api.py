from datetime import date

from fastapi.testclient import TestClient

from macrofactor_scraper.api import app, get_service
from macrofactor_scraper.models import DatasetCollection, DatasetRecord, ProfileResponse


class FakeService:
    async def profile(self) -> ProfileResponse:
        return ProfileResponse(id="uid-1", path="users/uid-1", raw={"email": "user@example.com"})

    async def dated_document(self, dataset: str, day: date) -> DatasetRecord:
        return DatasetRecord(id=day.isoformat(), path=f"{dataset}/{day.isoformat()}", date=day, raw={"ok": True})

    async def collection_between(self, dataset: str, start: date, end: date) -> DatasetCollection:
        if start > end:
            raise ValueError("start must be on or before end")
        record = DatasetRecord(id="1", path=f"{dataset}/1", date=start, raw={"ok": True})
        return DatasetCollection(dataset=dataset, count=1, records=[record])

    async def get_workout(self, workout_id: str) -> DatasetRecord:
        return DatasetRecord(id=workout_id, path=f"workouts/{workout_id}", raw={"name": "Session"})

    async def collection(self, dataset: str) -> DatasetCollection:
        return DatasetCollection(dataset=dataset, count=0, records=[])

    async def raw_dataset(self, dataset: str, **values):
        return {"dataset": dataset, "source_path": dataset, "kind": "collection", "data": []}


def override_service() -> FakeService:
    return FakeService()


def test_health() -> None:
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_profile_route() -> None:
    app.dependency_overrides[get_service] = override_service
    client = TestClient(app)

    response = client.get("/v1/profile")

    assert response.status_code == 200
    assert response.json()["id"] == "uid-1"
    app.dependency_overrides.clear()


def test_food_log_route_uses_date_alias() -> None:
    app.dependency_overrides[get_service] = override_service
    client = TestClient(app)

    response = client.get("/v1/food-log?date=2026-05-01")

    assert response.status_code == 200
    assert response.json()["id"] == "2026-05-01"
    app.dependency_overrides.clear()


def test_invalid_range_returns_422() -> None:
    app.dependency_overrides[get_service] = override_service
    client = TestClient(app)

    response = client.get("/v1/weight-log?start=2026-06-01&end=2026-05-01")

    assert response.status_code == 422
    app.dependency_overrides.clear()
