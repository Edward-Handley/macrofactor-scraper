from __future__ import annotations

from collections.abc import AsyncIterator
from urllib.parse import quote

import httpx

from macrofactor_scraper.auth import FirebaseAuthClient
from macrofactor_scraper.config import Settings
from macrofactor_scraper.errors import UpstreamError


class FirestoreClient:
    def __init__(
        self,
        settings: Settings,
        auth: FirebaseAuthClient,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._settings = settings
        self._auth = auth
        self._http = http_client or httpx.AsyncClient(timeout=settings.api_timeout_seconds)

    async def close(self) -> None:
        await self._http.aclose()

    async def current_uid(self) -> str:
        return (await self._auth.get_session()).uid

    async def get_document(self, path: str) -> dict[str, object] | None:
        response = await self._request("GET", self._document_url(path))
        if response.status_code == 404:
            return None
        self._raise_for_upstream(response)
        return decode_document(response.json())

    async def list_collection(self, path: str, *, page_size: int = 300) -> list[dict[str, object]]:
        documents: list[dict[str, object]] = []
        page_token: str | None = None
        while True:
            params: dict[str, object] = {"pageSize": page_size}
            if page_token:
                params["pageToken"] = page_token
            response = await self._request("GET", self._document_url(path), params=params)
            if response.status_code == 404:
                return documents
            self._raise_for_upstream(response)
            body = response.json()
            for item in body.get("documents", []):
                documents.append(decode_document(item))
            page_token = body.get("nextPageToken")
            if not page_token:
                return documents

    async def iter_collection(self, path: str) -> AsyncIterator[dict[str, object]]:
        for item in await self.list_collection(path):
            yield item

    async def list_collection_ids(self, parent_path: str | None = None) -> list[str]:
        url = f"{self._document_url(parent_path)}:listCollectionIds" if parent_path else f"{self._base_url()}:listCollectionIds"
        response = await self._request("POST", url, json={})
        self._raise_for_upstream(response)
        body = response.json()
        collection_ids = body.get("collectionIds", [])
        if not isinstance(collection_ids, list):
            return []
        return [str(collection_id) for collection_id in collection_ids]

    async def _request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        session = await self._auth.get_session()
        headers = {"Authorization": f"Bearer {session.id_token}"}
        return await self._http.request(method, url, headers=headers, **kwargs)

    def _document_url(self, path: str) -> str:
        encoded_path = "/".join(quote(part, safe="") for part in path.strip("/").split("/"))
        return f"{self._base_url()}/{encoded_path}"

    def _base_url(self) -> str:
        database = quote(self._settings.firestore_database, safe="")
        return (
            "https://firestore.googleapis.com/v1/projects/"
            f"{self._settings.firebase_project_id}/databases/{database}/documents"
        )

    @staticmethod
    def _raise_for_upstream(response: httpx.Response) -> None:
        if response.status_code < 400:
            return
        try:
            body = response.json()
        except ValueError:
            body = response.text
        raise UpstreamError(f"Firestore request failed: {body}", response.status_code)


def decode_document(document: dict[str, object]) -> dict[str, object]:
    name = str(document.get("name", ""))
    fields = document.get("fields", {})
    decoded = decode_firestore_value({"mapValue": {"fields": fields}})
    if not isinstance(decoded, dict):
        decoded = {}
    decoded["_path"] = _relative_document_path(name)
    decoded["_id"] = name.rsplit("/", 1)[-1] if name else None
    decoded["_create_time"] = document.get("createTime")
    decoded["_update_time"] = document.get("updateTime")
    return decoded


def decode_firestore_value(value: dict[str, object]) -> object:
    if "nullValue" in value:
        return None
    if "booleanValue" in value:
        return bool(value["booleanValue"])
    if "integerValue" in value:
        return int(str(value["integerValue"]))
    if "doubleValue" in value:
        return float(value["doubleValue"])
    if "timestampValue" in value:
        return value["timestampValue"]
    if "stringValue" in value:
        return value["stringValue"]
    if "bytesValue" in value:
        return value["bytesValue"]
    if "referenceValue" in value:
        return value["referenceValue"]
    if "geoPointValue" in value:
        geo = value["geoPointValue"]
        return dict(geo) if isinstance(geo, dict) else geo
    if "arrayValue" in value:
        array = value["arrayValue"]
        if not isinstance(array, dict):
            return []
        values = array.get("values", [])
        if not isinstance(values, list):
            return []
        return [decode_firestore_value(item) for item in values if isinstance(item, dict)]
    if "mapValue" in value:
        map_value = value["mapValue"]
        if not isinstance(map_value, dict):
            return {}
        fields = map_value.get("fields", {})
        if not isinstance(fields, dict):
            return {}
        return {
            key: decode_firestore_value(inner)
            for key, inner in fields.items()
            if isinstance(inner, dict)
        }
    return value


def _relative_document_path(name: str) -> str | None:
    marker = "/documents/"
    if marker not in name:
        return name or None
    return name.split(marker, 1)[1]
