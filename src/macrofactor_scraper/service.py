from __future__ import annotations

from datetime import date
from string import Formatter
from typing import Any

from macrofactor_scraper.config import Settings
from macrofactor_scraper.errors import ConfigurationError
from macrofactor_scraper.firestore import FirestoreClient
from macrofactor_scraper.models import DatasetCollection, DatasetRecord, ProfileResponse, RawDatasetResponse


class MacroFactorReadService:
    def __init__(self, settings: Settings, firestore: FirestoreClient) -> None:
        self._settings = settings
        self._firestore = firestore

    async def profile(self) -> ProfileResponse:
        record = await self._get_mapped_document("profile")
        if record is None:
            return ProfileResponse()
        return ProfileResponse(id=_record_id(record), path=_record_path(record), raw=_public_raw(record))

    async def dated_document(self, dataset: str, day: date) -> DatasetRecord | None:
        record = await self._get_mapped_document(dataset, date=day.isoformat())
        if record is None:
            return None
        return _dataset_record(record, day)

    async def collection_between(self, dataset: str, start: date, end: date) -> DatasetCollection:
        if start > end:
            raise ValueError("start must be on or before end")
        path = await self._format_path(dataset)
        records = await self._firestore.list_collection(path)
        filtered = [
            _dataset_record(record)
            for record in records
            if _record_date_in_range(record, start, end)
        ]
        return DatasetCollection(dataset=dataset, count=len(filtered), records=filtered)

    async def get_workout(self, workout_id: str) -> DatasetRecord | None:
        base_path = await self._format_path("workouts")
        record = await self._firestore.get_document(f"{base_path}/{workout_id}")
        if record is None:
            return None
        return _dataset_record(record)

    async def collection(self, dataset: str) -> DatasetCollection:
        path = await self._format_path(dataset)
        records = [_dataset_record(record) for record in await self._firestore.list_collection(path)]
        return DatasetCollection(dataset=dataset, count=len(records), records=records)

    async def raw_dataset(self, dataset: str, **values: str) -> RawDatasetResponse:
        path = await self._format_path(dataset, **values)
        kind = "document" if _looks_like_document_path(path) else "collection"
        data: dict[str, Any] | list[dict[str, Any]] | None
        if kind == "document":
            data = await self._firestore.get_document(path)
        else:
            data = await self._firestore.list_collection(path)
        return RawDatasetResponse(dataset=dataset, source_path=path, kind=kind, data=data)

    async def _get_mapped_document(self, dataset: str, **values: str) -> dict[str, Any] | None:
        path = await self._format_path(dataset, **values)
        return await self._firestore.get_document(path)

    async def _format_path(self, dataset: str, **values: str) -> str:
        template = self._settings.dataset_paths.get(dataset)
        if template is None:
            known = ", ".join(sorted(self._settings.dataset_paths))
            raise ConfigurationError(f"Unknown dataset '{dataset}'. Known datasets: {known}")
        uid = await self._current_uid()
        format_values = {"uid": uid, **values}
        missing = [
            field_name
            for _, field_name, _, _ in Formatter().parse(template)
            if field_name and field_name not in format_values
        ]
        if missing:
            raise ConfigurationError(
                f"Dataset '{dataset}' requires path values: {', '.join(sorted(set(missing)))}"
            )
        return template.format(**format_values)

    async def _current_uid(self) -> str:
        return await self._firestore.current_uid()


def _dataset_record(record: dict[str, Any], fallback_date: date | None = None) -> DatasetRecord:
    return DatasetRecord(
        id=_record_id(record),
        path=_record_path(record),
        date=_coerce_record_date(record) or fallback_date,
        raw=_public_raw(record),
    )


def _record_id(record: dict[str, Any]) -> str | None:
    value = record.get("_id")
    return str(value) if value is not None else None


def _record_path(record: dict[str, Any]) -> str | None:
    value = record.get("_path")
    return str(value) if value is not None else None


def _public_raw(record: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in record.items() if not key.startswith("_")}


def _record_date_in_range(record: dict[str, Any], start: date, end: date) -> bool:
    record_date = _coerce_record_date(record)
    if record_date is None:
        return True
    return start <= record_date <= end


def _coerce_record_date(record: dict[str, Any]) -> date | None:
    for key in ("date", "day", "loggedDate", "startDate"):
        value = record.get(key)
        if isinstance(value, date):
            return value
        if isinstance(value, str):
            try:
                return date.fromisoformat(value[:10])
            except ValueError:
                continue
    path = _record_path(record) or ""
    last_segment = path.rsplit("/", 1)[-1]
    try:
        return date.fromisoformat(last_segment[:10])
    except ValueError:
        return None


def _looks_like_document_path(path: str) -> bool:
    parts = [part for part in path.strip("/").split("/") if part]
    return len(parts) % 2 == 0
