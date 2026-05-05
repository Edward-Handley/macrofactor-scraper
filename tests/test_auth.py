from datetime import UTC, datetime, timedelta

import httpx
import pytest

from macrofactor_scraper.auth import FirebaseAuthClient, FirebaseSession
from macrofactor_scraper.config import Settings
from macrofactor_scraper.errors import AuthenticationError, ConfigurationError


class MockTransport(httpx.AsyncBaseTransport):
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if "signInWithPassword" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "idToken": "id-token",
                    "refreshToken": "refresh-token",
                    "localId": "uid-1",
                    "expiresIn": "3600",
                },
            )
        return httpx.Response(
            200,
            json={
                "id_token": "new-id-token",
                "refresh_token": "new-refresh-token",
                "user_id": "uid-1",
                "expires_in": "3600",
            },
        )


@pytest.mark.asyncio
async def test_sign_in_requires_credentials() -> None:
    client = FirebaseAuthClient(Settings())

    with pytest.raises(ConfigurationError):
        await client.sign_in()


@pytest.mark.asyncio
async def test_sign_in_and_refresh() -> None:
    transport = MockTransport()
    http_client = httpx.AsyncClient(transport=transport)
    client = FirebaseAuthClient(
        Settings(
            username="user@example.com",
            password="secret",
            firebase_api_key="key",
        ),
        http_client=http_client,
    )

    session = await client.get_session()
    assert session.id_token == "id-token"
    assert session.uid == "uid-1"

    client._session = FirebaseSession(
        id_token="old",
        refresh_token="refresh-token",
        uid="uid-1",
        expires_at=datetime.now(UTC) + timedelta(seconds=10),
    )
    refreshed = await client.get_session()

    assert refreshed.id_token == "new-id-token"
    assert len(transport.requests) == 2
    await http_client.aclose()


@pytest.mark.asyncio
async def test_authentication_error_includes_firebase_message() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "INVALID_PASSWORD"}})

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = FirebaseAuthClient(
        Settings(username="user@example.com", password="bad", firebase_api_key="key"),
        http_client=http_client,
    )

    with pytest.raises(AuthenticationError, match="INVALID_PASSWORD"):
        await client.sign_in()
    await http_client.aclose()
