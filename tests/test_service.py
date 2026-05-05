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


@pytest.mark.asyncio
async def test_dated_document_uses_dataset_path_template() -> None:
    service = MacroFactorReadService(Settings(), FakeFirestore())  # type: ignore[arg-type]

    record = await service.dated_document("food_log", date(2026, 5, 1))

    assert record is not None
    assert record.path == "users/uid-1/foodLogs/2026-05-01"
    assert record.raw == {"date": "2026-05-01", "value": 1}


@pytest.mark.asyncio
async def test_collection_between_filters_by_record_date() -> None:
    service = MacroFactorReadService(Settings(), FakeFirestore())  # type: ignore[arg-type]

    result = await service.collection_between("weight_log", date(2026, 5, 1), date(2026, 5, 31))

    assert isinstance(result, DatasetCollection)
    assert result.count == 1
    assert result.records[0].id == "a"


@pytest.mark.asyncio
async def test_collection_between_rejects_reversed_range() -> None:
    service = MacroFactorReadService(Settings(), FakeFirestore())  # type: ignore[arg-type]

    with pytest.raises(ValueError):
        await service.collection_between("weight_log", date(2026, 6, 1), date(2026, 5, 1))
