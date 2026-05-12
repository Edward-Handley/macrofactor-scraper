# Session Handoff

## Current State

Repository: `C:\Users\nutme\Development\codex\MacroFactor-scraper\macrofactor-scraper`

Branch: `main`

All 84 tests passing. Frontend builds clean (no TS errors).

## What Was Done This Session

### New `/health` Tab — Full Garmin Data

Added a new dashboard tab at `/health` that surfaces all available Garmin Connect daily metrics, stored on the VPS using the same `health_records` SQLite pattern as Auto Health Export.

#### Backend (`src/macrofactor_scraper/garmin.py`)

Added 8 new extractor functions (all use multi-path + heuristic fallback, same pattern as existing `_extract_sleep`/`_extract_hrv`):

- `_extract_user_summary()` — floors, active calories, distance, intensity minutes
- `_extract_body_battery()` — charged, drained, high, low
- `_extract_stress()` — avg, max (filters Garmin's -1/-2 sentinel values)
- `_extract_respiration()` — avg waking respiration
- `_extract_spo2()` — avg, lowest (filters 0 sentinel)
- `_extract_training_readiness()` — score (handles list response, prefers AFTER_WAKEUP_RESET context)
- `_extract_training_status()` — vo2_max_running, vo2_max_cycling
- `_extract_max_metrics()` — fallback VO2 max from allMetrics.metricsMap

Added module-level constants:
- `GARMIN_METRIC_CATEGORIES` — dict of category → metric name list
- `GARMIN_METRIC_UNITS` — metric name → unit string
- `ALL_GARMIN_METRICS` — frozenset for validation

Extended `GarminSyncService.sync_date()` with 7 new client call blocks (each wrapped in try/except mirroring existing pattern). The background loop (`garmin_sync_loop`) picks up new metrics automatically — no change needed there.

#### Backend (`src/macrofactor_scraper/api.py`)

Two new routes (both `require_private_access`):

- `GET /v1/garmin/categories` — returns `GARMIN_METRIC_CATEGORIES` + `GARMIN_METRIC_UNITS`
- `GET /v1/garmin/series/{metric_name}?days=30` — time series from `health_records` WHERE source='Garmin', validated against `ALL_GARMIN_METRICS` whitelist

#### Tests (`tests/test_garmin.py`)

22 tests total (was 5). Added 2 tests per new extractor (happy path + edge/fallback case). Full suite: 84 passed.

#### Frontend

- `frontend/src/lib/types.ts` — added `GarminSeriesPoint`, `GarminSeriesResponse`, `GarminCategoriesResponse`
- `frontend/src/lib/api.ts` — added `api.garmin.categories()` and `api.garmin.series(metric, days)`
- `frontend/src/hooks/use-dashboard.ts` — added `useGarminCategories()` and `useGarminSeries(metric, days)`
- `frontend/src/routes.tsx` — added `{ path: "health", element: <Health /> }`
- `frontend/src/components/layout/nav.tsx` — added `HeartPulse` icon + nav entry in both `SidebarNav` and `BottomNav`
- `frontend/src/pages/health.tsx` — new page (created from scratch):
  - Date picker (default today)
  - Sync Garmin button (calls existing `POST /v1/garmin/sync`)
  - Status pill (configured / last_sync_at / last_error)
  - Four category sections: Recovery / Wellness / Training / Activity
  - Per-metric cards with formatted value + 30-day Recharts `<LineChart>` sparkline
  - Inline sparklines using `api.garmin.series()` (not tied to `FIELD_META` / `TrendChart` — standalone)

## Next Operational Steps

Deploy to VPS:

```bash
git pull
docker compose up --build -d
```

Run a manual Garmin sync to populate the new metrics for today:

```bash
curl -X POST -H "X-API-Key: $HEALTH_EXPORT_API_KEY" \
  "https://health.ar333lot.lol/v1/garmin/sync?sync_date=2026-05-12"
```

Check new metrics arrived:

```bash
curl -H "X-API-Key: $HEALTH_EXPORT_READ_API_KEY" \
  "https://health.ar333lot.lol/v1/garmin/values/2026-05-12"
```

Expect keys including: `body_battery_high`, `body_battery_low`, `stress_avg`, `stress_max`, `respiration_avg`, `spo2_avg`, `spo2_lowest`, `training_readiness_score`, `vo2_max_running`, `floors_ascended`, `active_calories`, `total_distance_m`, `intensity_minutes_moderate`, `intensity_minutes_vigorous` (in addition to existing 5).

If a metric is missing, check `/v1/garmin/debug/{date}` with the ingest key to see raw payload paths, then add/fix the extractor in `garmin.py` + test in `test_garmin.py`.

Sparklines on the Health tab will populate after a few days of syncs.

### Coach Prompt — Garmin as Authoritative Source (`src/macrofactor_scraper/coach.py`)

`build_coach_data()` now queries `health_records` for Garmin data (yesterday) via new helper `_get_garmin_values(service, date)` and uses it with this priority:

| Field | Source priority |
|-------|----------------|
| `sleep_hours` | Garmin `sleep_minutes ÷ 60` → daily_log `sleep_hours` |
| `sleep_score` | Garmin `sleep_score` → daily_log `sleep_score` |
| `rhr` | Garmin `resting_heart_rate` → daily_log `rhr` |
| `hrv_overnight` | Garmin `hrv_overnight` → daily_log `hrv_overnight` |
| `steps` | Garmin `garmin_steps` → Apple Health `step_count` |
| `sleep_quality` | daily_log only (subjective 1–10, no Garmin equivalent) |

No schema changes. No new API endpoints. No frontend changes.

## Notes For Next Agent

- Do not read or expose `.env` secrets.
- `GARMIN_METRIC_CATEGORIES` / `GARMIN_METRIC_UNITS` / `ALL_GARMIN_METRICS` in `garmin.py` are the single source of truth — update these when adding new metrics, not the frontend.
- The series endpoint validates metric_name against `ALL_GARMIN_METRICS`. Adding a new metric: (1) add extractor, (2) add to `GARMIN_METRIC_CATEGORIES` + `GARMIN_METRIC_UNITS`, (3) add sync call in `sync_date()`, (4) add test.
- Garmin raw payloads must stay out of logs/responses unless sanitised via `summarize_garmin_payload`.
- Git safe directory flag if needed:

```powershell
git -c safe.directory=C:/Users/nutme/Development/codex/MacroFactor-scraper/macrofactor-scraper status --short
```
