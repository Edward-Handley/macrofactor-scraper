# Agent Handoff — macrofactor-scraper

This file is the primary context document for any AI agent (Codex, Claude, etc.) working on this repo. Read it before touching anything.

---

## What this project is

A **personal nutrition dashboard** running at `health.ar333lot.lol` on a Digital Ocean VPS (Ubuntu + Docker + Caddy).

Data pipeline:
```
iPhone → MacroFactor app → Apple Health → HealthAutoExport (hourly, JSON v2, "Summarize Data ON", "Time grouping = day")
    → POST /v1/ingest/health-auto-export → SQLite → FastAPI → React dashboard
```

There are no calorie/macro targets in the dashboard — it shows absolute consumption only.

---

## Tech stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.12 + FastAPI + SQLite (no ORM) |
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS v4 + React Query v5 + React Router v6 + Recharts |
| Deploy | Docker Compose + Caddy reverse proxy |
| Tests | pytest (84 tests, all passing) |

---

## Directory structure

```
macrofactor-scraper/
├── src/macrofactor_scraper/
│   ├── api.py              ← FastAPI app, all endpoints
│   ├── health_export.py    ← Core service: ingest, aggregation, diagnostics, repair
│   ├── garmin.py           ← Garmin Connect sync: extractors, GarminSyncService, background loop
│   ├── models.py           ← Pydantic models for all responses
│   ├── config.py           ← Settings (reads .env)
│   ├── repair.py           ← CLI for retroactive cleanup of stacked rows
│   └── static/
│       ├── dashboard/      ← Built frontend (DO NOT EDIT — output of `npm run build`)
│       └── login.html      ← Server-rendered login page
├── frontend/
│   ├── src/
│   │   ├── main.tsx        ← Entrypoint: QueryClientProvider + RouterProvider
│   │   ├── routes.tsx      ← createBrowserRouter with all routes
│   │   ├── index.css       ← Tailwind v4 + CSS color tokens
│   │   ├── lib/
│   │   │   ├── api.ts      ← Typed fetch client for all /v1 endpoints
│   │   │   ├── types.ts    ← All TS interfaces + FIELD_META + ALL_FIELDS
│   │   │   ├── format.ts   ← fmt, compact, isoDate, offsetDate, etc.
│   │   │   └── utils.ts    ← cn() helper
│   │   ├── hooks/
│   │   │   ├── use-dashboard.ts   ← React Query hooks for all API calls
│   │   │   ├── use-date-range.ts  ← Syncs start/end to URL search params
│   │   │   └── use-theme.ts       ← localStorage dark/light toggle
│   │   ├── components/
│   │   │   ├── layout/     ← app-shell.tsx, nav.tsx, theme-toggle.tsx
│   │   │   └── charts/     ← calorie-ring.tsx, macro-stack.tsx, sparkline.tsx,
│   │   │                       trend-chart.tsx, calendar-heatmap.tsx
│   │   └── pages/
│   │       ├── today.tsx       ← Hero page with ring, macros, stats, heatmap
│   │       ├── health.tsx      ← Garmin health tab: all metrics, sparklines, sync button
│   │       ├── trends.tsx      ← Time-series charts with field toggles
│   │       ├── data-health.tsx ← Suspicious days + repair + metric catalog
│   │       ├── explorer.tsx    ← API data explorer (see details below)
│   │       └── settings.tsx    ← Dashboard preferences
│   ├── package.json
│   ├── vite.config.ts      ← Proxies /v1 → localhost:8000, builds to static/dashboard
│   └── tsconfig.json       ← target ES2022
├── tests/
│   ├── test_api.py         ← Integration tests
│   └── test_garmin.py      ← Garmin extractor unit tests
```

---

## Routes

| Path | Page | What it shows |
|------|------|---------------|
| `/` | Today | Calorie ring, macro bars, calorie split %, yesterday delta, rolling averages, heatmap, 14-day table with 7d avg footer |
| `/health` | Health | All Garmin metrics (recovery / wellness / training / activity), date picker, sync button, 30-day sparklines per metric |
| `/trends` | Trends | Field toggles, range presets, per-field stats (avg/min/max/slope), optional 7d MA overlay, CSV export |
| `/data-health` | Data Health | Suspicious days (>5000 kcal), inline diagnostics, one-click repair, metric catalog with trust toggles |
| `/explorer` | Explorer | Dataset picker, sort/filter/paginate (50/page), column visibility, per-column stats, CSV export |
| `/settings` | Settings | Visible summary cards, default chart fields, preferred range, reset |

---

## API endpoints (all require auth)

```
GET  /health                                    ← public
POST /v1/ingest/health-auto-export              ← ingest key
GET  /v1/metrics
GET  /v1/metrics/{metric_name}?start=&end=
GET  /v1/daily-summary?start=&end=
GET  /v1/dashboard/summary?start=&end=&include_hidden=true
GET  /v1/dashboard/preferences
PUT  /v1/dashboard/preferences
GET  /v1/dashboard/metric-catalog
GET  /v1/diagnostics/metrics/{YYYY-MM-DD}
GET  /v1/workouts?start=&end=
GET  /v1/ingest/status
POST /v1/admin/repair?date=YYYY-MM-DD&dry_run=false   ← ingest key
GET  /v1/export/daily-summary.csv
GET  /v1/export/metrics/{metric_name}.csv
GET  /v1/excel/daily-log.csv
GET  /v1/excel/calories-weight.csv
GET  /v1/excel/metrics/{metric_name}.csv

# Garmin (all require auth)
GET  /v1/garmin/status
POST /v1/garmin/sync?sync_date=YYYY-MM-DD       ← ingest key
GET  /v1/garmin/values/{YYYY-MM-DD}
GET  /v1/garmin/categories
GET  /v1/garmin/series/{metric_name}?days=30
GET  /v1/garmin/debug/{YYYY-MM-DD}              ← ingest key, troubleshooting only

GET  /{any-other-path}                          ← SPA catch-all → dashboard.html
```

Auth: `X-API-Key` header OR signed session cookie from `/login`.

---

## Key backend concepts

### The stacking bug (FIXED)

HealthAutoExport runs hourly with "Summarize Data ON". Each sync writes a **new row** at midnight timestamp with the updated running total. Because the dedupe fingerprint includes `quantity`, each snapshot is a distinct row. The old code summed all rows → days showed 3–9× the real intake.

**Fix** (`health_export.py`): At aggregation time, group rows by `(date, metric, source)`. If any row has a midnight timestamp with a timezone offset, keep only the **latest** (by `(timestamp, id)`). If no midnight row, sum intraday rows. This is done in `_collapse_additive_rows()`.

Affected metrics (`RUNNING_TOTAL_SUMMARY_KEYS`):
```python
{"calories", "protein", "carbohydrates", "fat", "water", "active_energy"}
```

`steps` and `weight` are unaffected (steps sums normally; weight uses latest-wins).

### Midnight detection

```python
def _is_midnight_summary(timestamp_text: str | None) -> bool:
    if not timestamp_text: return False
    ts = _parse_datetime(timestamp_text)
    if ts is None or ts.tzinfo is None: return False  # bare date string → intraday
    return ts.time() == time(0, 0, 0)
```

Key insight: real HAE midnight rows include a TZ offset (e.g., `2026-05-07T00:00:00+08:00`). Rows derived from bare date strings like `"2026-05-06"` parse to a datetime with no tzinfo → treated as intraday → they sum. This correctly handles the existing test that ingests two MacroFactor rows with null timestamps.

### Repair CLI

```bash
python -m macrofactor_scraper.repair --dry-run   # shows before/after deltas
python -m macrofactor_scraper.repair --apply     # hard-deletes stacked rows, backs up to JSON first
```

Or via API: `POST /v1/admin/repair?date=YYYY-MM-DD&dry_run=false` (ingest key required).

### `seen_records` guard

`_daily_summary_items` keeps a `seen_records` set (keyed on `metric, units, date, timestamp, source, float(quantity)`) **before** the collapse bucketing pass. This deduplicates exact-duplicate rows (same timestamp + same quantity) that legacy imports may have created. It does NOT affect running-total rows because those have different quantities.

---

## Key frontend concepts

### Color tokens

Defined in `frontend/src/index.css` as CSS custom properties (`--color-calories`, `--color-protein`, etc.). `FIELD_META` in `types.ts` uses `var(--color-X)` — charts read these at runtime so dark/light toggling works without re-rendering.

### React Query keys

| Hook | Query key |
|------|-----------|
| `useDashboardSummary(start, end)` | `["dashboard-summary", start, end]` |
| `usePreferences()` | `["preferences"]` |
| `useMetricCatalog()` | `["metric-catalog"]` |
| `useIngestStatus()` | `["ingest-status"]` |
| `useDiagnostics(date)` | `["diagnostics", date]` |
| `useRepair()` mutation | invalidates dashboard-summary + diagnostics |
| `useGarminCategories()` | `["garmin-categories"]` — staleTime Infinity |
| `useGarminSeries(metric, days)` | `["garmin-series", metric, days]` |

### TrendChart

`TrendChart` in `components/charts/trend-chart.tsx` accepts either:
- `rawData: ChartRow[]` — pre-computed rows (used by Trends page which adds `field_ma` keys for the 7d moving average)
- `data: DailySummary[]` — legacy simple path

The `maFields` prop adds dashed overlay lines for moving averages.

### Explorer page features

- Column sort: click header toggles asc/desc
- Live filter: searches all columns, resets page to 0
- Pagination: 50 rows/page with first/prev/next/last
- Column visibility: picker dropdown to hide/show any column
- Per-column stats: numeric columns show `min / avg / max` in the header
- CSV export: downloads all filtered+sorted rows (not just current page)

### SPA catch-all

`api.py` has a `/{full_path:path}` catch-all **after** all `/v1/*` routes that serves `dashboard.html` (with auth check). This allows hard-refresh on `/trends?start=...` etc. to work in production.

---

## Running locally

```powershell
# Backend
python -m venv .venv && .\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
cp .env.example .env   # edit values
uvicorn macrofactor_scraper.api:app --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev    # http://127.0.0.1:5173 — proxies /v1 to port 8000
```

```powershell
# Tests
pytest -v   # should show 34 passed

# Build for production
cd frontend && npm run build
# Output lands in src/macrofactor_scraper/static/dashboard/
```

---

## Deploy (production VPS)

```bash
git pull
docker compose up --build -d
```

Run repair after first deploy if the DB has pre-fix stacked rows:
```bash
docker compose exec api python -m macrofactor_scraper.repair --dry-run
docker compose exec api python -m macrofactor_scraper.repair --apply
```

---

## Garmin integration

`garmin.py` syncs daily Garmin Connect data into the shared `health_records` table (`source = 'Garmin'`). Background loop runs every 6 hours via `garmin_sync_loop`.

### Metrics pulled per sync

| Category | Metric names stored |
|----------|---------------------|
| Recovery | `sleep_minutes`, `sleep_score`, `resting_heart_rate`, `hrv_overnight` |
| Wellness | `body_battery_high`, `body_battery_low`, `body_battery_charged`, `body_battery_drained`, `stress_avg`, `stress_max`, `respiration_avg`, `spo2_avg`, `spo2_lowest` |
| Training | `training_readiness_score`, `vo2_max_running`, `vo2_max_cycling`, `intensity_minutes_moderate`, `intensity_minutes_vigorous` |
| Activity | `garmin_steps`, `floors_ascended`, `active_calories`, `total_distance_m` |

`GARMIN_METRIC_CATEGORIES`, `GARMIN_METRIC_UNITS`, `ALL_GARMIN_METRICS` constants in `garmin.py` drive both the API (`/v1/garmin/categories`) and validation (series endpoint whitelist).

### Storage

`upsert_garmin_metric(metric_name, units, record_date, quantity)` in `health_export.py:1500`. Writes to same `health_records` table as Auto Health Export. Fingerprint: `_fingerprint("garmin_v1", metric_name, record_date, "Garmin")`. Update-on-change (threshold 0.001).

### Troubleshoot missing values

```bash
curl -H "X-API-Key: $HEALTH_EXPORT_API_KEY" \
  "https://health.ar333lot.lol/v1/garmin/debug/2026-05-12"
```

Look at `extracted.*` and `payloads.*.numeric_matches`. If a value appears at an unexpected path, add it to the relevant `_extract_*` function and add a test in `tests/test_garmin.py`.

---

## What has NOT been done (potential next tasks)

- **Garmin backfill**: `sync_recent(days=2)` only covers today + yesterday. To backfill history, loop `garmin.sync_date(d, service)` over a date range manually or add a backfill endpoint.
- **Health tab long-range charts**: Current sparklines are 30 days. Could add date-range picker for longer history.
- **Weekly/monthly aggregation view**: Trends shows daily; no weekly rollup chart.
- **Food-level detail**: Not possible — Apple Health only stores nutrient totals, not individual food items.
- **Auth improvement**: Currently a single shared password. No multi-user support.
- **Code splitting**: The JS bundle is ~830 KB (recharts + react-router). Vite warns about this. Could lazy-load route components.
- **Mobile date picker UX**: Native `<input type="date">` works but is ugly on iOS Safari.
- **Notifications**: No alerting when a suspicious day is detected.

---

## Important constraints

- **No calorie/macro targets** — the dashboard shows absolute consumption only, not progress toward goals.
- **No changing the ingest fingerprint** — changing the `UNIQUE` constraint on `health_records.fingerprint` requires destructive SQLite migration. Keep ingest faithful and fix at read time.
- **Single-user personal project** — no need for multi-tenancy, access control beyond password, or rate limiting.
