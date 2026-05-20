# macrofactor-scraper — personal health dashboard

FastAPI backend + React dashboard for nutrition tracking and Garmin biometrics, running at `health.ar333lot.lol`.

## Data sources

| Source | How it gets in |
|--------|----------------|
| MacroFactor (nutrition) | iPhone → Apple Health → HealthAutoExport (hourly JSON) → `POST /v1/ingest/health-auto-export` |
| Garmin Connect (biometrics) | Background sync every 6 hours; manual via `POST /v1/garmin/sync` |

## Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.12 + FastAPI + SQLite (no ORM) |
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS v4 + React Query v5 + Recharts |
| Deploy | Docker Compose + Caddy (HTTPS) |

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Today — calorie ring, macros, progress bars vs targets, anomaly strip, days-to-goal pill, 30-day heatmap, Garmin recovery cards |
| `/health` | All Garmin metrics with 30-day sparklines, date picker, manual sync |
| `/trends` | Time-series charts with field toggles, 7d MA overlay, cut-phase bands, 30d weight forecast |
| `/week` | Weekly scorecard — daily grades (A/B/C) vs calorie/protein/steps targets |
| `/workouts` | Strong workout analytics (weekly load, group balance, exercise PRs) |
| `/measurements` | Body measurements history with delta summary card |
| `/cut-phases` | Diet phase tracking with weight trajectory chart and days-to-goal estimate |
| `/coach` | AI coaching prompt — framing chips, context preview, prompt history, anomaly auto-append |
| `/morning` `/evening` | Daily log forms (morning pre-fills RHR/HRV/sleep from Garmin) |
| `/data-health` | Data quality diagnostics + one-click repair |
| `/explorer` | Raw metric explorer (sort / filter / paginate / CSV export) |
| `/settings` | Dashboard preferences including protein goal |

## Garmin metrics

| Category | Metrics |
|----------|---------|
| Recovery | Sleep duration, sleep score, resting HR, overnight HRV |
| Wellness | Body battery (high/low/charged/drained), stress (avg/max), respiration avg, SpO₂ (avg/lowest) |
| Training | Training readiness score, VO₂ max running/cycling, intensity minutes (moderate/vigorous) |
| Activity | Steps, floors ascended, active calories, total distance |

## Setup

Requires Python 3.12+ and Node 20+.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
Copy-Item .env.example .env   # then fill in values
```

### .env variables

```dotenv
HEALTH_EXPORT_API_KEY=          # ingest write key (used by HealthAutoExport + Garmin sync)
HEALTH_EXPORT_READ_API_KEY=     # read-only key (dashboard, CSV exports)
HEALTH_EXPORT_SQLITE_PATH=health_export.sqlite3
SESSION_SECRET=                 # signs dashboard login cookies
DASHBOARD_PASSWORD_HASH=        # argon2id hash of dashboard password (generate with command below)

GARMIN_USERNAME=                # Garmin account email
GARMIN_PASSWORD=                # Garmin account password
GARMIN_MFA_SECRET=              # optional — TOTP secret for 2FA accounts
```

Generate `DASHBOARD_PASSWORD_HASH`:

```powershell
python -m macrofactor_scraper.hash_password
# paste the output line into .env
```

`DASHBOARD_PASSWORD` (plaintext) is still accepted as a fallback for local dev.

## Run locally

```powershell
# Backend
uvicorn macrofactor_scraper.api:app --host 127.0.0.1 --port 8000 --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev    # http://127.0.0.1:5173  — proxies /v1 to port 8000
```

```powershell
# Tests
python -m pytest --basetemp=tmp_pytest -p no:cacheprovider -q
# 84 passed

# Build frontend for production
cd frontend && npm run build
```

## Deploy

```bash
git pull
docker compose up --build -d
```

## Garmin backfill

The background sync covers today + yesterday. To backfill history, loop the sync endpoint from the VPS:

```bash
# Backfill 90 days (adjust seq range as needed)
for i in $(seq 89 -1 0); do
  d=$(date -d "-$i days" +%Y-%m-%d)
  echo "Syncing $d..."
  curl -s -X POST \
    -H "X-API-Key: $HEALTH_EXPORT_API_KEY" \
    "https://health.ar333lot.lol/v1/garmin/sync?sync_date=$d"
  echo ""
  sleep 2
done
```

Or via Docker exec (single login, faster):

```bash
docker compose exec api python - <<'EOF'
from datetime import date, timedelta
from macrofactor_scraper.garmin import GarminSyncService
from macrofactor_scraper.health_export import HealthAutoExportService
from macrofactor_scraper.config import get_settings

settings = get_settings()
svc = HealthAutoExportService(settings.sqlite_path)
garmin = GarminSyncService(settings.garmin_username, settings.garmin_password)

start = date(2026, 1, 1)   # adjust start date
d = date.today()
while d >= start:
    print(f"Syncing {d}...")
    print(garmin.sync_date(d, svc))
    d -= timedelta(days=1)
EOF
```

## Troubleshooting Garmin

If a metric is missing on the `/health` tab:

```bash
curl -H "X-API-Key: $HEALTH_EXPORT_API_KEY" \
  "https://health.ar333lot.lol/v1/garmin/debug/YYYY-MM-DD"
```

Check `extracted.*` and `payloads.*.numeric_matches` for the actual payload path. If it differs from what the extractor expects, update the relevant `_extract_*` function in `src/macrofactor_scraper/garmin.py` and add a test in `tests/test_garmin.py`.

## API endpoints

```
GET  /health                                          public health check
POST /v1/ingest/health-auto-export                    ingest key
GET  /v1/metrics
GET  /v1/metrics/{metric_name}?start=&end=
GET  /v1/daily-summary?start=&end=
GET  /v1/dashboard/summary?start=&end=
GET  /v1/dashboard/preferences
PUT  /v1/dashboard/preferences
GET  /v1/dashboard/metric-catalog
GET  /v1/diagnostics/metrics/{YYYY-MM-DD}
GET  /v1/workouts?start=&end=
GET  /v1/ingest/status
POST /v1/admin/repair?date=YYYY-MM-DD&dry_run=false   ingest key
GET  /v1/export/daily-summary.csv
GET  /v1/export/metrics/{metric_name}.csv
GET  /v1/excel/daily-log.csv
GET  /v1/excel/calories-weight.csv
GET  /v1/excel/metrics/{metric_name}.csv

GET  /v1/garmin/status
POST /v1/garmin/sync?sync_date=YYYY-MM-DD             ingest key
GET  /v1/garmin/values/{YYYY-MM-DD}
GET  /v1/garmin/categories
GET  /v1/garmin/series/{metric_name}?days=30
GET  /v1/garmin/debug/{YYYY-MM-DD}                    ingest key

GET  /v1/insights/anomalies/{YYYY-MM-DD}
GET  /v1/coach/draft?kind=checkin|weekly|plateau|cut_reassess
```

All `/v1` read endpoints require `X-API-Key: <HEALTH_EXPORT_READ_API_KEY>` or a dashboard session cookie.

## HealthAutoExport config

- Automation type: REST API
- Format: JSON, Version 2
- URL: `https://health.ar333lot.lol/v1/ingest/health-auto-export`
- Header: `X-API-Key: <HEALTH_EXPORT_API_KEY>`
- Date range: "Since Last Sync" for ongoing, manual export for history
- Cadence: hourly recommended

## Storage

SQLite tables:
- `ingest_batches` — raw payload per sync (hash, headers, JSON)
- `health_records` — one row per metric data point (metric name, units, date, quantity, source, fingerprint)
- `workout_records` — workout sessions from HealthAutoExport
- `strong_workout_sessions` / `strong_workout_sets` — imported from Strong CSV
- `dashboard_preferences` — user settings
- `cut_phases` / `daily_log` / `body_measurements` — manual tracking

Garmin metrics land in `health_records` with `source = 'Garmin'`, same schema as HealthAutoExport data.

## Key files

```
src/macrofactor_scraper/
  api.py            — all FastAPI endpoints
  health_export.py  — ingest, aggregation, diagnostics, upsert_garmin_metric
  garmin.py         — Garmin extractors, GarminSyncService, background loop
  coach.py          — coach prompt builder, framing kinds, build_prompt(kind=)
  insights.py       — anomaly detection rules engine
  models.py         — Pydantic response models
  config.py         — Settings from .env

frontend/src/
  pages/today.tsx        — main dashboard (anomaly strip, progress bars, projection pill)
  pages/week.tsx         — weekly scorecard with A/B/C grades
  pages/coach.tsx        — coach page (framing chips, prompt history, anomaly append)
  pages/health.tsx       — Garmin health tab
  components/command-palette/ — Ctrl/Cmd-K command palette (cmdk + chrono-node)
  components/insights/anomaly-strip.tsx — HRV/RHR/steps/protein anomaly chips
  components/layout/date-scope.tsx — prev/next/now date navigator widget
  hooks/use-active-date.ts — syncs ?date= URL param across all pages
  lib/projections.ts     — linear regression, days-to-goal, forecast tail
  lib/coach-history.ts   — IndexedDB prompt history (idb-keyval)
  lib/api.ts             — typed fetch client
  hooks/use-dashboard.ts — React Query hooks

tests/
  test_api.py       — integration tests
  test_garmin.py    — Garmin extractor unit tests (22 tests)
```

See `AGENTS.md` for full technical reference (architecture, query keys, constraints).
