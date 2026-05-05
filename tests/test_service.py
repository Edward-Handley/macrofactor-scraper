from datetime import UTC, date, datetime

import pytest

from macrofactor_scraper.auth import FirebaseSession
from macrofactor_scraper.config import Settings
from macrofactor_scraper.models import DatasetCollection
from macrofactor_scraper.service import MacroFactorReadService


class FakeAuth:
    async def get_session(self) -> FirebaseSession:
        return FirebaseSession(
            id_token="token",
            refresh_token="refresh",
            uid="uid-1",
            expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        )


class FakeFirestore:
    _auth = FakeAuth()

    async def current_uid(self) -> str:
        return "uid-1"

    async def get_document(self, path: str):
        if path == "users/uid-1/scale/2026":
            return {
                "_id": "2026",
                "_path": path,
                "0501": {"w": 80.5, "s": "macro_factor"},
                "0601": {"w": 81.0, "s": "macro_factor"},
            }
        if path == "users/uid-1/nutrition/2026":
            return {
                "_id": "2026",
                "_path": path,
                "0501": {"k": 2200, "p": 180, "c": 240, "f": 70},
            }
        return {
            "_id": path.rsplit("/", 1)[-1],
            "_path": path,
            "date": "2026-05-01",
            "value": 1,
        }

    async def list_collection(self, path: str):
        return [
            {"_id": "a", "_path": f"{path}/a", "date": "2026-05-01", "value": 1},
            {"_id": "b", "_path": f"{path}/b", "date": "2026-06-01", "value": 2},
        ]

    async def list_collection_ids(self, parent_path: str | None = None):
        return ["foodLogs", "workouts", "weightLog"]


@pytest.mark.asyncio
async def test_dated_document_uses_dataset_path_template() -> None:
    service = MacroFactorReadService(Settings(), FakeFirestore())  # type: ignore[arg-type]

    record = await service.dated_document("food_log", date(2026, 5, 1))

    assert record is not None
    assert record.path == "users/uid-1/food/2026-05-01"
    assert record.raw == {"date": "2026-05-01", "value": 1}


@pytest.mark.asyncio
async def test_collection_between_filters_by_record_date() -> None:
    service = MacroFactorReadService(Settings(), FakeFirestore())  # type: ignore[arg-type]

    result = await service.collection_between("workouts", date(2026, 5, 1), date(2026, 5, 31))

    assert isinstance(result, DatasetCollection)
    assert result.count == 1
    assert result.records[0].id == "a"


@pytest.mark.asyncio
async def test_collection_between_rejects_reversed_range() -> None:
    service = MacroFactorReadService(Settings(), FakeFirestore())  # type: ignore[arg-type]

    with pytest.raises(ValueError):
        await service.collection_between("workouts", date(2026, 6, 1), date(2026, 5, 1))


@pytest.mark.asyncio
async def test_year_field_document_reads_mmdd_field() -> None:
    service = MacroFactorReadService(Settings(), FakeFirestore())  # type: ignore[arg-type]

    record = await service.year_field_document("nutrition", date(2026, 5, 1))

    assert record is not None
    assert record.id == "0501"
    assert record.path == "users/uid-1/nutrition/2026.0501"
    assert record.raw == {"k": 2200, "p": 180, "c": 240, "f": 70}


@pytest.mark.asyncio
async def test_year_field_collection_between_reads_year_documents() -> None:
    service = MacroFactorReadService(Settings(), FakeFirestore())  # type: ignore[arg-type]

    result = await service.year_field_collection_between("weight_log", date(2026, 5, 1), date(2026, 5, 31))

    assert result.count == 1
    assert result.records[0].id == "0501"
    assert result.records[0].raw == {"w": 80.5, "s": "macro_factor"}


@pytest.mark.asyncio
async def test_collection_ids_defaults_to_user_document() -> None:
    service = MacroFactorReadService(Settings(), FakeFirestore())  # type: ignore[arg-type]

    result = await service.collection_ids()

    assert result.parent_path == "users/uid-1"
    assert result.collection_ids == ["foodLogs", "workouts", "weightLog"]
