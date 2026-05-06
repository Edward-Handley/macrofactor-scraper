# macrofactor-scraper

Local-first FastAPI backend for ingesting Apple Health data exported by Health Auto Export.

This project previously explored direct MacroFactor Firebase reads. The default runtime path now avoids MacroFactor private APIs and stores data posted by Health Auto Export into local SQLite. That means the API can only expose data available in Apple Health, not MacroFactor-only details such as food item names, recipes, coaching state, expenditure internals, or app targets.

## Status

Implemented:

- `POST /v1/ingest/health-auto-export` with `X-API-Key` authentication.
- Private API reads with a dedicated read `X-API-Key` or a signed dashboard session cookie.
- Browser dashboard with login, React charts, daily summary cards, API Explorer, metric catalog, data quality views, saved preferences, ingest status, and CSV/Excel feed exports.
- Generic Health Auto Export JSON metric ingestion for objects shaped like `name`, `units`, and `data`.
- SQLite storage for raw ingest batches, normalized health metric rows, and workout rows.
- Metric listing, per-metric date filtering, daily summaries, dashboard summaries, workouts, ingest status, CSV exports, and health check routes.
- Protected dashboard preference APIs backed by SQLite.
- Nutrition-friendly daily summaries with unit normalization for common metric names such as `dietary_energy`, `protein`, `carbohydrates`, `total_fat`, `dietary_water`, `body_mass`, `step_count`, and `active_energy`.

Legacy Firebase modules remain importable under the original module names for reference and tests, but they are not used by the FastAPI app.

## Setup

Requires Python 3.12+.
The production dashboard build also requires Node 20+.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
Copy-Item .env.example .env
```

Edit `.env`:

```dotenv
HEALTH_EXPORT_API_KEY=change-me-local-secret
HEALTH_EXPORT_READ_API_KEY=change-me-read-secret
HEALTH_EXPORT_SQLITE_PATH=health_export.sqlite3
SESSION_SECRET=change-me-session-secret
DASHBOARD_PASSWORD=change-me-dashboard-password
```

`HEALTH_EXPORT_API_KEY` is the ingest-only secret Health Auto Export sends in the `X-API-Key` header.
`HEALTH_EXPORT_READ_API_KEY` is the read-only secret for API reads, CSV exports, and Excel Power Query refreshes. If it is unset, read endpoints temporarily accept `HEALTH_EXPORT_API_KEY` for backward compatibility.
`SESSION_SECRET` signs dashboard cookies. `DASHBOARD_PASSWORD` is used for browser login and defaults to `HEALTH_EXPORT_API_KEY` if unset.

## Run

```powershell
uvicorn macrofactor_scraper.api:app --host 127.0.0.1 --port 8000 --reload
```

Open:

- API docs: <http://127.0.0.1:8000/docs>
- Health check: <http://127.0.0.1:8000/health>
- Dashboard: <http://127.0.0.1:8000/>

For frontend development, run the API above and start Vite in another shell:

```powershell
cd frontend
npm install
npm run dev
```

Open <http://127.0.0.1:5173/>. Vite proxies `/v1` API calls to the local FastAPI server.

To build the dashboard assets served by FastAPI:

```powershell
cd frontend
npm run build
```

## Endpoints

- `GET /health`
- `POST /v1/ingest/health-auto-export`
- `GET /v1/metrics`
- `GET /v1/metrics/{metric_name}?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /v1/daily-summary?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /v1/dashboard/summary?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /v1/dashboard/summary?start=YYYY-MM-DD&end=YYYY-MM-DD&include_hidden=true`
- `GET /v1/dashboard/preferences`
- `PUT /v1/dashboard/preferences`
- `GET /v1/dashboard/metric-catalog`
- `GET /v1/workouts?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /v1/ingest/status`
- `GET /v1/export/daily-summary.csv?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /v1/export/metrics/{metric_name}.csv?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /v1/excel/daily-log.csv?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /v1/excel/calories-weight.csv?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /v1/excel/metrics/{metric_name}.csv?start=YYYY-MM-DD&end=YYYY-MM-DD`

All `/v1` read endpoints require either `X-API-Key: <HEALTH_EXPORT_READ_API_KEY>` or a dashboard login session cookie. `/health` remains public. In production, `/docs`, `/redoc`, and `/openapi.json` are disabled.

Excel Power Query should use Data from Web with the feed URL and an `X-API-Key` request header. Do not put API keys in feed URLs.

## Health Auto Export

Configure Health Auto Export:

- Automation type: REST API.
- Format: JSON.
- Export version: Version 2.
- Data type: start with Health Metrics, then add Workouts as a second automation if needed.
- URL: your local or tunneled `/v1/ingest/health-auto-export` endpoint.
- Header: `X-API-Key: <HEALTH_EXPORT_API_KEY>`.
- Date range: use "Since Last Sync" for ongoing sync and Manual Export for history.

For iPhone testing, run the API locally on `127.0.0.1:8000` and expose it temporarily with a tunnel such as Cloudflare Tunnel or ngrok. iOS background exports can be delayed when the phone is locked, Background App Refresh is unavailable, or Low Power Mode is enabled.

## Storage

The SQLite database contains:

- `ingest_batches`: received time, source headers with secrets redacted, payload hash, and raw payload JSON.
- `health_records`: one normalized row per metric data point, with metric name, units, date/timestamp, quantity, source, raw row JSON, and a dedupe fingerprint.
- `workout_records`: workout rows with start/end times, duration, energy, raw row JSON, and a dedupe fingerprint.
- `dashboard_preferences`: one saved dashboard preference document, including visible fields, hidden fields, trusted or untrusted metrics, source filters, default charts, and preferred range.

Unknown metric row fields are preserved in `raw_json`, so special data such as blood pressure, heart rate details, and sleep segments can be inspected even when no first-class columns exist yet.

## Tests

```powershell
pytest
python -m compileall src tests
cd frontend
npm run build
```
