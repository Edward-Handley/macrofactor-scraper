"""Garmin Connect sync — pulls sleep, RHR, HRV, steps, and activities into health_records/activities."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac as hmac_mod
import json
import logging
import struct
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

_SYNC_LOCK = asyncio.Lock()

# Metric taxonomy exposed to API and frontend
GARMIN_METRIC_CATEGORIES: dict[str, list[str]] = {
    "recovery": ["sleep_minutes", "sleep_score", "resting_heart_rate", "hrv_overnight"],
    "wellness": [
        "body_battery_high", "body_battery_low", "body_battery_charged", "body_battery_drained",
        "stress_avg", "stress_max", "respiration_avg", "spo2_avg", "spo2_lowest",
    ],
    "training": [
        "training_readiness_score", "vo2_max_running", "vo2_max_cycling",
        "intensity_minutes_moderate", "intensity_minutes_vigorous",
    ],
    "activity": ["garmin_steps", "floors_ascended", "active_calories", "total_distance_m"],
}

GARMIN_METRIC_UNITS: dict[str, str] = {
    "sleep_minutes": "min",
    "sleep_score": "score",
    "resting_heart_rate": "bpm",
    "hrv_overnight": "ms",
    "body_battery_high": "%",
    "body_battery_low": "%",
    "body_battery_charged": "%",
    "body_battery_drained": "%",
    "stress_avg": "score",
    "stress_max": "score",
    "respiration_avg": "brpm",
    "spo2_avg": "%",
    "spo2_lowest": "%",
    "training_readiness_score": "score",
    "vo2_max_running": "ml/kg/min",
    "vo2_max_cycling": "ml/kg/min",
    "intensity_minutes_moderate": "min",
    "intensity_minutes_vigorous": "min",
    "garmin_steps": "count",
    "floors_ascended": "count",
    "active_calories": "kcal",
    "total_distance_m": "m",
}

# Flat set of all known metric names for validation
ALL_GARMIN_METRICS: frozenset[str] = frozenset(
    m for metrics in GARMIN_METRIC_CATEGORIES.values() for m in metrics
)

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


def _safe_float_path(data: Any, path: tuple[str, ...]) -> float | None:
    return _safe_float(data, *path)


def _iter_numeric_paths(data: Any, prefix: tuple[str, ...] = ()) -> list[tuple[str, float]]:
    paths: list[tuple[str, float]] = []
    if isinstance(data, dict):
        for key, value in data.items():
            paths.extend(_iter_numeric_paths(value, (*prefix, str(key))))
    elif isinstance(data, list):
        for index, value in enumerate(data[:5]):
            paths.extend(_iter_numeric_paths(value, (*prefix, str(index))))
    else:
        try:
            if isinstance(data, bool) or data is None:
                return paths
            paths.append((".".join(prefix), float(data)))
        except (TypeError, ValueError):
            pass
    return paths


def _find_numeric_by_path_hint(data: Any, required_tokens: tuple[str, ...]) -> float | None:
    normalized_tokens = tuple(token.lower() for token in required_tokens)
    for path, value in _iter_numeric_paths(data):
        normalized_path = path.lower().replace("_", "").replace("-", "")
        if all(token in normalized_path for token in normalized_tokens):
            return value
    return None


def _extract_sleep(data: dict) -> dict[str, float | None]:
    """Extract sleep metrics from garminconnect get_sleep_data() response."""
    result: dict[str, float | None] = {"sleep_minutes": None, "sleep_score": None}

    dto = data.get("dailySleepDTO") or {}
    secs = _safe_float(dto, "sleepTimeSeconds")
    if secs is not None:
        result["sleep_minutes"] = round(secs / 60, 1)

    # Sleep score — try multiple paths garmin has used over versions
    score_paths = (
        ("dailySleepDTO", "sleepScores", "overall", "value"),
        ("dailySleepDTO", "sleepScores", "overall"),
        ("sleepScores", "overall", "value"),
        ("sleepScores", "overall"),
        ("dailySleepDTO", "overallSleepScore", "value"),
        ("overallSleepScore", "value"),
        ("dailySleepDTO", "sleepScorePVO", "value"),
        ("sleepScorePVO", "value"),
        ("dailySleepDTO", "sleepScore", "value"),
        ("sleepScore", "value"),
        ("averageOverallScore",),
    )
    score = next((value for path in score_paths if (value := _safe_float_path(data, path)) is not None), None)
    if score is None:
        score = _find_numeric_by_path_hint(data, ("sleep", "score", "overall"))
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
    hrv_paths = (
        ("hrvSummary", "lastNightAvg"),
        ("hrvSummary", "lastNightAverage"),
        ("hrvSummary", "lastNightMean"),
        ("hrvSummary", "lastNight"),
        ("lastNightAvg",),
        ("lastNightAverage",),
        ("lastNightMean",),
        ("lastNight",),
    )
    return next((value for path in hrv_paths if (value := _safe_float_path(data, path)) is not None), None)


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


def _extract_user_summary(data: dict) -> dict[str, float | None]:
    """Extract activity summary from garminconnect get_user_summary() response."""
    return {
        "floors_ascended": _safe_float(data, "floorsAscended"),
        "active_calories": (
            _safe_float(data, "activeKilocalories")
            or _safe_float(data, "totalKilocalories")
        ),
        "total_distance_m": _safe_float(data, "totalDistanceMeters"),
        "intensity_minutes_moderate": _safe_float(data, "moderateIntensityMinutes"),
        "intensity_minutes_vigorous": _safe_float(data, "vigorousIntensityMinutes"),
    }


def _extract_body_battery(data: Any) -> dict[str, float | None]:
    """Extract body battery from garminconnect get_body_battery(date, date) response.

    Returns a list of daily dicts. Each may have: charged, used (=drained),
    bodyBatteryStatList[0].bodyBatteryHigh / bodyBatteryLow.
    """
    result: dict[str, float | None] = {
        "body_battery_charged": None,
        "body_battery_drained": None,
        "body_battery_high": None,
        "body_battery_low": None,
    }
    items = data if isinstance(data, list) else ([data] if isinstance(data, dict) else [])
    if not items:
        return result
    item = items[0]
    result["body_battery_charged"] = _safe_float(item, "charged")
    result["body_battery_drained"] = _safe_float(item, "used") or _safe_float(item, "drained")
    stat_list = item.get("bodyBatteryStatList") or []
    stat = stat_list[0] if stat_list else item
    result["body_battery_high"] = _safe_float(stat, "bodyBatteryHigh") or _safe_float(stat, "high")
    result["body_battery_low"] = _safe_float(stat, "bodyBatteryLow") or _safe_float(stat, "low")
    if result["body_battery_high"] is None:
        result["body_battery_high"] = _find_numeric_by_path_hint(item, ("battery", "high"))
    if result["body_battery_low"] is None:
        result["body_battery_low"] = _find_numeric_by_path_hint(item, ("battery", "low"))
    return result


def _extract_stress(data: dict) -> dict[str, float | None]:
    """Extract daily stress from garminconnect get_stress_data() response."""
    avg = (
        _safe_float(data, "avgStressLevel")
        or _safe_float(data, "averageStressLevel")
        or _find_numeric_by_path_hint(data, ("avg", "stress"))
    )
    mx = (
        _safe_float(data, "maxStressLevel")
        or _safe_float(data, "peakStressLevel")
        or _find_numeric_by_path_hint(data, ("max", "stress"))
    )
    # Garmin returns -1 / -2 for "no stress data"
    return {
        "stress_avg": avg if (avg is not None and avg >= 0) else None,
        "stress_max": mx if (mx is not None and mx >= 0) else None,
    }


def _extract_respiration(data: dict) -> dict[str, float | None]:
    """Extract respiration from garminconnect get_respiration_data() response."""
    return {
        "respiration_avg": (
            _safe_float(data, "avgWakingRespirationValue")
            or _safe_float(data, "averageRespirationValue")
            or _find_numeric_by_path_hint(data, ("avg", "respir"))
        ),
    }


def _extract_spo2(data: dict) -> dict[str, float | None]:
    """Extract SpO2 from garminconnect get_spo2_data() response."""
    avg = (
        _safe_float(data, "averageSpO2")
        or _safe_float(data, "avgSpO2")
        or _find_numeric_by_path_hint(data, ("avg", "spo2"))
    )
    low = (
        _safe_float(data, "lowestSpO2")
        or _safe_float(data, "minimumSpO2")
        or _find_numeric_by_path_hint(data, ("low", "spo2"))
    )
    return {
        "spo2_avg": avg if (avg is not None and avg > 0) else None,
        "spo2_lowest": low if (low is not None and low > 0) else None,
    }


_SWIM_SPORT_KEYS: frozenset[str] = frozenset({"lap_swimming", "open_water_swimming", "pool_swimming", "swim"})


def _extract_activity_summary(item: dict) -> dict:
    """Extract a normalised activity summary from a garminconnect activity list item."""
    sport = (
        _safe_float(item, "activityType", "typeKey") or
        item.get("activityType", {}).get("typeKey") if isinstance(item.get("activityType"), dict) else None
    ) or str(item.get("activityType", "unknown"))
    if isinstance(sport, float):
        sport = "unknown"

    start_time = item.get("startTimeLocal") or item.get("startTimeGMT") or ""
    activity_date = start_time[:10] if start_time else None

    duration_seconds = _safe_float(item, "duration") or _safe_float(item, "elapsedDuration")
    distance_m = _safe_float(item, "distance")
    calories = _safe_float(item, "calories") or _safe_float(item, "activeKilocalories")
    avg_hr = _safe_float(item, "averageHR")
    max_hr = _safe_float(item, "maxHR")
    aerobic_te = _safe_float(item, "aerobicTrainingEffect")
    anaerobic_te = _safe_float(item, "anaerobicTrainingEffect")
    training_load = _safe_float(item, "activityTrainingLoad")

    # Swim-specific
    pool_length_m: float | None = None
    raw_pl = item.get("poolLength")
    if isinstance(raw_pl, dict):
        pool_length_m = _safe_float(raw_pl, "value")
    elif raw_pl is not None:
        try:
            pool_length_m = float(raw_pl)
        except (TypeError, ValueError):
            pass

    laps = _safe_float(item, "lapCount") or _safe_float(item, "numberOfActiveLengths")
    if laps is not None:
        laps = int(laps)  # type: ignore[assignment]

    total_strokes = _safe_float(item, "strokes") or _safe_float(item, "avgStrokes")
    if total_strokes is not None:
        total_strokes = int(total_strokes)  # type: ignore[assignment]

    avg_swolf = _safe_float(item, "averageSwolf") or _safe_float(item, "avgSwolf")

    # Pace per 100m from averageSpeed (m/s): pace_s_per_100m = 100 / speed_mps
    avg_speed_mps = _safe_float(item, "averageSpeed")
    avg_pace_s_per_100m: float | None = None
    if avg_speed_mps is not None and avg_speed_mps > 0:
        avg_pace_s_per_100m = round(100.0 / avg_speed_mps, 1)

    stroke_type = item.get("swimStroke") or item.get("strokeType")
    if isinstance(stroke_type, dict):
        stroke_type = stroke_type.get("key") or stroke_type.get("typeKey")

    return {
        "garmin_activity_id": item.get("activityId"),
        "sport": sport,
        "activity_date": activity_date,
        "start_time": start_time,
        "duration_seconds": duration_seconds,
        "distance_m": distance_m,
        "calories": calories,
        "avg_hr": avg_hr,
        "max_hr": max_hr,
        "aerobic_te": aerobic_te,
        "anaerobic_te": anaerobic_te,
        "training_load": training_load,
        "load_source": "garmin" if training_load is not None else None,
        "pool_length_m": pool_length_m,
        "laps": laps,
        "total_strokes": total_strokes,
        "avg_swolf": avg_swolf,
        "avg_pace_s_per_100m": avg_pace_s_per_100m,
        "stroke_type": stroke_type,
        "raw": item,
    }


def _extract_hr_zones(data: Any) -> list[dict]:
    """Extract HR zone breakdown from get_activity_hr_in_timezones() response."""
    zones: list[dict] = []
    items = data if isinstance(data, list) else ([data] if isinstance(data, dict) else [])
    for item in items:
        if not isinstance(item, dict):
            continue
        zone_num = _safe_float(item, "zoneNumber") or _safe_float(item, "zone")
        secs = _safe_float(item, "secsInZone") or _safe_float(item, "timeInZone")
        if zone_num is not None and secs is not None:
            zones.append({"zone": int(zone_num), "secs": int(secs)})
    return zones


def _extract_swim_laps(data: Any) -> list[dict]:
    """Extract swim lap details from get_activity_splits() response."""
    laps: list[dict] = []
    if isinstance(data, dict):
        items = data.get("lapDTOs") or data.get("laps") or []
    elif isinstance(data, list):
        items = data
    else:
        return laps
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        lap: dict = {"lap": i + 1}
        dist = _safe_float(item, "distance")
        if dist is not None:
            lap["distance_m"] = dist
        dur = _safe_float(item, "duration") or _safe_float(item, "elapsedDuration")
        if dur is not None:
            lap["duration_s"] = dur
        strokes = _safe_float(item, "strokes")
        if strokes is not None:
            lap["strokes"] = int(strokes)
        swolf = _safe_float(item, "averageSwolf") or _safe_float(item, "swolf")
        if swolf is not None:
            lap["swolf"] = swolf
        speed = _safe_float(item, "averageSpeed")
        if speed is not None and speed > 0:
            lap["pace_s_per_100m"] = round(100.0 / speed, 1)
        laps.append(lap)
    return laps


def _extract_training_readiness(data: Any) -> dict[str, float | None]:
    """Extract training readiness score from get_training_readiness() response.

    Response may be a list (one entry per reading) or a single dict.
    """
    item: dict = {}
    if isinstance(data, list) and data:
        # Prefer AFTER_WAKEUP_RESET context; fall back to first entry
        item = next(
            (e for e in data if e.get("inputContext") == "AFTER_WAKEUP_RESET"),
            data[0],
        )
    elif isinstance(data, dict):
        item = data
    score = (
        _safe_float(item, "score")
        or _safe_float(item, "trainingReadinessScore")
        or _find_numeric_by_path_hint(item, ("readiness", "score"))
    )
    return {"training_readiness_score": score}


def _extract_training_status(data: dict) -> dict[str, float | None]:
    """Extract VO2 max from get_training_status() response."""
    vo2_run = (
        _safe_float(data, "latestVo2MaxRunning")
        or _safe_float(data, "vo2MaxRunning")
        or _safe_float(data, "latestVo2Max")
        or _find_numeric_by_path_hint(data, ("vo2", "run"))
    )
    vo2_cyc = (
        _safe_float(data, "latestVo2MaxCycling")
        or _safe_float(data, "vo2MaxCycling")
        or _find_numeric_by_path_hint(data, ("vo2", "cycl"))
    )
    return {
        "vo2_max_running": vo2_run,
        "vo2_max_cycling": vo2_cyc,
    }


def _extract_max_metrics(data: Any) -> dict[str, float | None]:
    """Extract VO2 max from get_max_metrics() response as fallback.

    Response is typically a list of metric dicts, each with metricDescriptors + allMetrics.
    """
    result: dict[str, float | None] = {"vo2_max_running": None, "vo2_max_cycling": None}
    items = data if isinstance(data, list) else ([data] if isinstance(data, dict) else [])
    for item in items:
        if not isinstance(item, dict):
            continue
        # Common shape: allMetrics.metricsMap.VO2MAXVALUE[0].value
        try:
            metrics_map = item["allMetrics"]["metricsMap"]
            for key, values in metrics_map.items():
                key_up = key.upper()
                if "VO2MAX" in key_up and isinstance(values, list) and values:
                    val = _safe_float(values[0], "value")
                    if val is not None:
                        if "CYCL" in key_up:
                            result["vo2_max_cycling"] = val
                        else:
                            result["vo2_max_running"] = val
        except (KeyError, TypeError):
            pass
        # Heuristic fallback
        if result["vo2_max_running"] is None:
            result["vo2_max_running"] = _find_numeric_by_path_hint(item, ("vo2", "run"))
        if result["vo2_max_cycling"] is None:
            result["vo2_max_cycling"] = _find_numeric_by_path_hint(item, ("vo2", "cycl"))
    return result


# ─── GarminSyncService ───────────────────────────────────────────────────────

def summarize_garmin_payload(data: Any, keywords: tuple[str, ...]) -> dict[str, Any]:
    """Return a small, non-raw summary for troubleshooting Garmin response shapes."""
    normalized_keywords = tuple(keyword.lower() for keyword in keywords)
    numeric_matches = []
    for path, value in _iter_numeric_paths(data):
        normalized_path = path.lower().replace("_", "").replace("-", "")
        if any(keyword in normalized_path for keyword in normalized_keywords):
            numeric_matches.append({"path": path, "value": value})
    top_level_keys = list(data.keys())[:50] if isinstance(data, dict) else None
    return {
        "type": type(data).__name__,
        "top_level_keys": top_level_keys,
        "numeric_matches": numeric_matches[:50],
    }


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

        # User summary: floors, active calories, distance, intensity minutes
        try:
            summary_data = self._client.get_user_summary(date_str)
            summary = _extract_user_summary(summary_data)
            for name, val in summary.items():
                if val is not None:
                    results[name] = service.upsert_garmin_metric(
                        name, GARMIN_METRIC_UNITS[name], date_str, val
                    )
        except Exception as exc:
            logger.warning("Garmin user summary fetch failed for %s: %s", date_str, exc)

        # Body battery
        try:
            bb_data = self._client.get_body_battery(date_str, date_str)
            bb = _extract_body_battery(bb_data)
            for name, val in bb.items():
                if val is not None:
                    results[name] = service.upsert_garmin_metric(
                        name, GARMIN_METRIC_UNITS[name], date_str, val
                    )
        except Exception as exc:
            logger.warning("Garmin body battery fetch failed for %s: %s", date_str, exc)

        # Stress
        try:
            stress_data = self._client.get_stress_data(date_str)
            stress = _extract_stress(stress_data)
            for name, val in stress.items():
                if val is not None:
                    results[name] = service.upsert_garmin_metric(
                        name, GARMIN_METRIC_UNITS[name], date_str, val
                    )
        except Exception as exc:
            logger.warning("Garmin stress fetch failed for %s: %s", date_str, exc)

        # Respiration
        try:
            resp_data = self._client.get_respiration_data(date_str)
            resp = _extract_respiration(resp_data)
            for name, val in resp.items():
                if val is not None:
                    results[name] = service.upsert_garmin_metric(
                        name, GARMIN_METRIC_UNITS[name], date_str, val
                    )
        except Exception as exc:
            logger.warning("Garmin respiration fetch failed for %s: %s", date_str, exc)

        # SpO2
        try:
            spo2_data = self._client.get_spo2_data(date_str)
            spo2 = _extract_spo2(spo2_data)
            for name, val in spo2.items():
                if val is not None:
                    results[name] = service.upsert_garmin_metric(
                        name, GARMIN_METRIC_UNITS[name], date_str, val
                    )
        except Exception as exc:
            logger.warning("Garmin SpO2 fetch failed for %s: %s", date_str, exc)

        # Training readiness
        try:
            tr_data = self._client.get_training_readiness(date_str)
            tr = _extract_training_readiness(tr_data)
            for name, val in tr.items():
                if val is not None:
                    results[name] = service.upsert_garmin_metric(
                        name, GARMIN_METRIC_UNITS[name], date_str, val
                    )
        except Exception as exc:
            logger.warning("Garmin training readiness fetch failed for %s: %s", date_str, exc)

        # Training status (VO2 max primary)
        try:
            ts_data = self._client.get_training_status(date_str)
            ts = _extract_training_status(ts_data)
            for name, val in ts.items():
                if val is not None:
                    results[name] = service.upsert_garmin_metric(
                        name, GARMIN_METRIC_UNITS[name], date_str, val
                    )
            # Fallback VO2 max from max_metrics if training_status missed it
            if ts.get("vo2_max_running") is None and ts.get("vo2_max_cycling") is None:
                mm_data = self._client.get_max_metrics(date_str)
                mm = _extract_max_metrics(mm_data)
                for name, val in mm.items():
                    if val is not None:
                        results[name] = service.upsert_garmin_metric(
                            name, GARMIN_METRIC_UNITS[name], date_str, val
                        )
        except Exception as exc:
            logger.warning("Garmin training status fetch failed for %s: %s", date_str, exc)

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

    def sync_activities(self, service: Any, days_back: int = 7, fetch_details: bool = True) -> dict:
        """Sync per-activity data for the last days_back days. Returns counts dict."""
        if not self._ensure_client():
            return {"ok": False, "error": self._last_error}

        today = date.today()
        start = today - timedelta(days=days_back)
        counts = {"fetched": 0, "inserted": 0, "updated": 0, "detail_calls": 0}

        try:
            activities_raw = self._client.get_activities_by_date(start.isoformat(), today.isoformat())
        except Exception as exc:
            logger.warning("Garmin get_activities_by_date failed: %s", exc)
            return {"ok": False, "error": str(exc)}

        if not isinstance(activities_raw, list):
            activities_raw = []

        counts["fetched"] = len(activities_raw)

        for item in activities_raw:
            if not isinstance(item, dict):
                continue
            garmin_id = item.get("activityId")
            if garmin_id is None:
                continue

            summary = _extract_activity_summary(item)

            # Only fetch detail endpoints for NEW activities not yet in DB
            existing = service.get_activity_by_garmin_id(int(garmin_id))
            is_new = existing is None

            if is_new and fetch_details:
                # HR zones — always try
                try:
                    time.sleep(0.5)
                    hr_data = self._client.get_activity_hr_in_timezones(int(garmin_id))
                    summary["hr_zones"] = _extract_hr_zones(hr_data)
                    counts["detail_calls"] += 1
                except Exception as exc:
                    logger.debug("Garmin HR zones fetch failed for activity %s: %s", garmin_id, exc)
                    summary["hr_zones"] = None

                # Swim laps — swim activities only
                sport = summary.get("sport", "")
                if isinstance(sport, str) and any(s in sport.lower() for s in ("swim", "pool")):
                    try:
                        time.sleep(0.5)
                        splits_data = self._client.get_activity_splits(int(garmin_id))
                        summary["lap_details"] = _extract_swim_laps(splits_data)
                        counts["detail_calls"] += 1
                    except Exception as exc:
                        logger.debug("Garmin swim splits fetch failed for activity %s: %s", garmin_id, exc)
                        summary["lap_details"] = None
            else:
                summary.setdefault("hr_zones", None)
                summary.setdefault("lap_details", None)

            inserted = service.upsert_garmin_activity(summary)
            if inserted:
                counts["inserted"] += 1
            elif not is_new:
                counts["updated"] += 1

        logger.info("Garmin activity sync: %s", counts)
        return {"ok": True, **counts}

    def debug_date(self, d: date) -> dict[str, Any]:
        """Fetch Garmin payloads for a date and return only parser/debug summaries."""
        if not self._ensure_client():
            return {"ok": False, "last_error": self._last_error}

        date_str = d.isoformat()
        result: dict[str, Any] = {"ok": True, "date": date_str, "extracted": {}, "payloads": {}}

        try:
            sleep_data = self._client.get_sleep_data(date_str)
            result["extracted"]["sleep"] = _extract_sleep(sleep_data)
            result["payloads"]["sleep"] = summarize_garmin_payload(sleep_data, ("sleep", "score"))
        except Exception as exc:
            result["payloads"]["sleep"] = {"error": str(exc)}

        try:
            hrv_data = self._client.get_hrv_data(date_str)
            result["extracted"]["hrv_overnight"] = _extract_hrv(hrv_data)
            result["payloads"]["hrv"] = summarize_garmin_payload(
                hrv_data, ("hrv", "lastnight", "night", "weekly")
            )
        except Exception as exc:
            result["payloads"]["hrv"] = {"error": str(exc)}

        return result

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
                    logger.warning("Garmin daily metrics sync failed: %s", exc)
                try:
                    await asyncio.get_event_loop().run_in_executor(
                        None, lambda: garmin.sync_activities(service, days_back=2)
                    )
                except Exception as exc:
                    logger.warning("Garmin activity sync failed: %s", exc)
        await asyncio.sleep(interval_hours * 3600)
