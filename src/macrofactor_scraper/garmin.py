"""Garmin Connect sync — pulls sleep, RHR, HRV, steps into health_records."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac as hmac_mod
import logging
import struct
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_SYNC_LOCK = asyncio.Lock()

# ─── TOTP (stdlib only, no pyotp) ────────────────────────────────────────────

def _totp(secret_b32: str) -> str:
    key = base64.b32decode(secret_b32.upper().replace(" ", ""))
    counter = struct.pack(">Q", int(time.time()) // 30)
    h = hmac_mod.new(key, counter, hashlib.sha1).digest()
    offset = h[-1] & 0xF
    code = struct.unpack(">I", h[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(code % 1_000_000).zfill(6)


# ─── Safe data extraction ─────────────────────────────────────────────────────

def _safe_float(data: Any, *keys: str) -> float | None:
    obj = data
    for k in keys:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(k)
    if obj is None:
        return None
    try:
        return float(obj)
    except (TypeError, ValueError):
        return None


def _extract_sleep(data: dict) -> dict[str, float | None]:
    """Extract sleep metrics from garminconnect get_sleep_data() response."""
    result: dict[str, float | None] = {"sleep_minutes": None, "sleep_score": None}

    dto = data.get("dailySleepDTO") or {}
    secs = _safe_float(dto, "sleepTimeSeconds")
    if secs is not None:
        result["sleep_minutes"] = round(secs / 60, 1)

    # Sleep score — try multiple paths garmin has used over versions
    score = (
        _safe_float(data, "overallSleepScore", "value")
        or _safe_float(data, "sleepScorePVO", "value")
        or _safe_float(dto, "sleepScorePVO", "value")
        or _safe_float(data, "averageOverallScore")
    )
    result["sleep_score"] = score
    return result


def _extract_rhr(data: dict) -> float | None:
    """Extract RHR from garminconnect get_rhr_day() response."""
    # v1 structure: allMetrics.metricsMap.WELLNESS_RESTING_HEART_RATE[].value
    try:
        metrics = data["allMetrics"]["metricsMap"]["WELLNESS_RESTING_HEART_RATE"]
        if metrics:
            return float(metrics[0]["value"])
    except (KeyError, IndexError, TypeError, ValueError):
        pass
    # Fallback: restingHeartRate direct field
    return _safe_float(data, "restingHeartRate")


def _extract_hrv(data: dict | None) -> float | None:
    """Extract overnight HRV from garminconnect get_hrv_data() response."""
    if not data:
        return None
    return (
        _safe_float(data, "hrvSummary", "lastNight")
        or _safe_float(data, "hrvSummary", "weeklyAverage")
        or _safe_float(data, "lastNight")
    )


def _extract_steps(data: dict) -> float | None:
    """Extract step count from garminconnect get_daily_steps() response.

    get_daily_steps returns a list of dicts like [{"calendarDate": "...", "totalSteps": 8000}].
    """
    if isinstance(data, list):
        for item in data:
            steps = _safe_float(item, "totalSteps")
            if steps is not None:
                return steps
    return _safe_float(data, "totalSteps")


# ─── GarminSyncService ───────────────────────────────────────────────────────

class GarminSyncService:
    def __init__(self, username: str, password: str, mfa_secret: str | None = None, tokenstore: str | None = None) -> None:
        self._username = username
        self._password = password
        self._mfa_secret = mfa_secret
        self._tokenstore = tokenstore
        self._client: Any = None
        self._last_error: str | None = None
        self._last_sync_at: datetime | None = None
        self._synced_dates: set[str] = set()

    @property
    def last_error(self) -> str | None:
        return self._last_error

    @property
    def last_sync_at(self) -> datetime | None:
        return self._last_sync_at

    def _build_mfa_callback(self):
        secret = self._mfa_secret

        def _prompt_mfa() -> str:
            if secret:
                code = _totp(secret)
                logger.info("Garmin: providing TOTP MFA code automatically")
                return code
            raise RuntimeError("Garmin MFA required but GARMIN_MFA_SECRET not set")

        return _prompt_mfa

    def _login(self) -> bool:
        try:
            from garminconnect import Garmin  # type: ignore[import]
        except ImportError:
            self._last_error = "garminconnect package not installed (pip install garminconnect)"
            logger.error(self._last_error)
            return False

        try:
            client = Garmin(
                email=self._username,
                password=self._password,
                prompt_mfa=self._build_mfa_callback(),
            )
            result = client.login(tokenstore=self._tokenstore)
            # result is (mfa_status, _); if mfa_status is not None login may need resume
            if result and result[0] == "needs_mfa":
                code = self._build_mfa_callback()()
                client.resume_login(mfa_code=code)
            self._client = client
            self._last_error = None
            logger.info("Garmin: logged in as %s", self._username)
            return True
        except Exception as exc:
            self._last_error = f"Garmin login failed: {exc}"
            logger.warning(self._last_error)
            return False

    def _ensure_client(self) -> bool:
        if self._client is not None:
            return True
        return self._login()

    def sync_date(self, d: date, service: Any) -> dict[str, bool]:
        """Sync all metrics for a single date into health_records. Returns {metric: changed}."""
        if not self._ensure_client():
            return {}

        date_str = d.isoformat()
        results: dict[str, bool] = {}

        # Sleep
        try:
            sleep_data = self._client.get_sleep_data(date_str)
            metrics = _extract_sleep(sleep_data)
            if metrics["sleep_minutes"] is not None:
                results["sleep_minutes"] = service.upsert_garmin_metric(
                    "sleep_minutes", "min", date_str, metrics["sleep_minutes"]
                )
            if metrics["sleep_score"] is not None:
                results["sleep_score"] = service.upsert_garmin_metric(
                    "sleep_score", "score", date_str, metrics["sleep_score"]
                )
        except Exception as exc:
            logger.warning("Garmin sleep fetch failed for %s: %s", date_str, exc)

        # RHR
        try:
            rhr_data = self._client.get_rhr_day(date_str)
            rhr = _extract_rhr(rhr_data)
            if rhr is not None:
                results["resting_heart_rate"] = service.upsert_garmin_metric(
                    "resting_heart_rate", "bpm", date_str, rhr
                )
        except Exception as exc:
            logger.warning("Garmin RHR fetch failed for %s: %s", date_str, exc)

        # HRV
        try:
            hrv_data = self._client.get_hrv_data(date_str)
            hrv = _extract_hrv(hrv_data)
            if hrv is not None:
                results["hrv_overnight"] = service.upsert_garmin_metric(
                    "hrv_overnight", "ms", date_str, hrv
                )
        except Exception as exc:
            logger.warning("Garmin HRV fetch failed for %s: %s", date_str, exc)

        # Steps (stored as garmin_steps to avoid clobbering Apple Health step_count)
        try:
            steps_data = self._client.get_daily_steps(date_str, date_str)
            steps = _extract_steps(steps_data) if isinstance(steps_data, list) else None
            if steps is None and isinstance(steps_data, dict):
                steps = _extract_steps(steps_data)
            if steps is not None:
                results["garmin_steps"] = service.upsert_garmin_metric(
                    "garmin_steps", "count", date_str, steps
                )
        except Exception as exc:
            logger.warning("Garmin steps fetch failed for %s: %s", date_str, exc)

        if results:
            self._last_sync_at = datetime.now(timezone.utc)
            self._synced_dates.add(date_str)
            logger.info("Garmin sync %s: %s", date_str, {k: "changed" if v else "same" for k, v in results.items()})

        return results

    def sync_recent(self, service: Any, days: int = 2) -> None:
        """Sync last `days` days (today + yesterday by default)."""
        today = date.today()
        for offset in range(days):
            d = today - timedelta(days=offset)
            self.sync_date(d, service)

    def get_garmin_values_for_date(self, d: date, service: Any) -> dict[str, float | None]:
        """Return cached Garmin values for date from health_records (for evening form autofill)."""
        date_str = d.isoformat()
        # Query health_records directly for Garmin source metrics
        from macrofactor_scraper.health_export import _validate_range  # noqa: F401
        with service._connect() as conn:
            rows = conn.execute(
                """
                SELECT metric_name, quantity FROM health_records
                WHERE record_date = ? AND source = 'Garmin'
                """,
                (date_str,),
            ).fetchall()
        return {row["metric_name"]: float(row["quantity"]) for row in rows}


# ─── Background loop ─────────────────────────────────────────────────────────

async def garmin_sync_loop(app: Any, interval_hours: int = 6) -> None:
    """Background asyncio task: sync on startup then every interval_hours."""
    while True:
        garmin: GarminSyncService | None = getattr(app.state, "garmin_service", None)
        service = getattr(app.state, "health_export_service", None)
        if garmin and service:
            async with _SYNC_LOCK:
                try:
                    await asyncio.get_event_loop().run_in_executor(None, garmin.sync_recent, service)
                except Exception as exc:
                    logger.warning("Garmin background sync failed: %s", exc)
        await asyncio.sleep(interval_hours * 3600)
