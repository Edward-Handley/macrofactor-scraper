from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx

from macrofactor_scraper.config import Settings
from macrofactor_scraper.errors import AuthenticationError, ConfigurationError


IDENTITY_TOOLKIT_BASE_URL = "https://identitytoolkit.googleapis.com/v1"


@dataclass(slots=True)
class FirebaseSession:
    id_token: str
    refresh_token: str
    uid: str
    expires_at: datetime

    def expires_soon(self) -> bool:
        return datetime.now(UTC) >= self.expires_at - timedelta(minutes=5)


class FirebaseAuthClient:
    def __init__(self, settings: Settings, http_client: httpx.AsyncClient | None = None) -> None:
        self._settings = settings
        self._http = http_client
        self._session: FirebaseSession | None = None

    async def get_session(self) -> FirebaseSession:
        if self._session is None:
            self._session = await self.sign_in()
        elif self._session.expires_soon():
            self._session = await self.refresh(self._session.refresh_token)
        return self._session

    async def sign_in(self) -> FirebaseSession:
        if not self._settings.has_credentials:
            raise ConfigurationError(
                "Set MACROFACTOR_USERNAME, MACROFACTOR_PASSWORD, and "
                "MACROFACTOR_FIREBASE_API_KEY in the environment."
            )

        payload = {
            "email": self._settings.username,
            "password": self._settings.password,
            "returnSecureToken": True,
        }
        data = await self._post_identity("accounts:signInWithPassword", payload)
        return self._session_from_sign_in(data)

    async def refresh(self, refresh_token: str) -> FirebaseSession:
        payload = {"grant_type": "refresh_token", "refresh_token": refresh_token}
        data = await self._post_identity("token", payload, secure_token=True)
        return FirebaseSession(
            id_token=data["id_token"],
            refresh_token=data["refresh_token"],
            uid=data["user_id"],
            expires_at=self._expiry_from_seconds(data.get("expires_in")),
        )

    async def _post_identity(
        self,
        endpoint: str,
        payload: dict[str, object],
        *,
        secure_token: bool = False,
    ) -> dict[str, object]:
        base_url = "https://securetoken.googleapis.com/v1" if secure_token else IDENTITY_TOOLKIT_BASE_URL
        url = f"{base_url}/{endpoint}?key={self._settings.firebase_api_key}"
        client = self._http or httpx.AsyncClient(timeout=self._settings.api_timeout_seconds)
        close_client = self._http is None
        try:
            response = await client.post(url, json=payload)
        except httpx.HTTPError as exc:
            raise AuthenticationError(f"Firebase authentication request failed: {exc}") from exc
        finally:
            if close_client:
                await client.aclose()

        if response.status_code >= 400:
            message = _firebase_error_message(response)
            raise AuthenticationError(f"Firebase authentication failed: {message}")

        return response.json()

    def _session_from_sign_in(self, data: dict[str, object]) -> FirebaseSession:
        return FirebaseSession(
            id_token=str(data["idToken"]),
            refresh_token=str(data["refreshToken"]),
            uid=str(data["localId"]),
            expires_at=self._expiry_from_seconds(data.get("expiresIn")),
        )

    @staticmethod
    def _expiry_from_seconds(value: object) -> datetime:
        try:
            seconds = int(str(value))
        except (TypeError, ValueError):
            seconds = 3600
        return datetime.now(UTC) + timedelta(seconds=seconds)


def _firebase_error_message(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return response.text or response.reason_phrase
    error = body.get("error", {})
    if isinstance(error, dict):
        return str(error.get("message") or body)
    return str(body)
