# macrofactor-scraper

Unofficial local read-only FastAPI backend for MacroFactor account data.

This project is intentionally scoped as a personal/local tool. MacroFactor's current Terms of Service restrict automated scraping/data extraction and commercial or business use without authorization. Do not deploy this as a public hosted service unless you have permission from MacroFactor.

## Status

This is an initial backend scaffold. It implements:

- Firebase email/password authentication with in-memory token refresh.
- Firestore REST decoding for common Firestore data types.
- Read-only FastAPI endpoints for profile, food log, nutrition, weight log, workouts, gym profiles, and raw dataset inspection.
- Configurable Firestore path templates so the project can be adjusted once real MacroFactor account responses are inspected.

It does not implement any write operations.

## Setup

Requires Python 3.12+.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
Copy-Item .env.example .env
```

Edit `.env`:

```dotenv
MACROFACTOR_USERNAME=you@example.com
MACROFACTOR_PASSWORD=your-password
MACROFACTOR_FIREBASE_API_KEY=your-firebase-web-api-key
MACROFACTOR_FIREBASE_PROJECT_ID=sbs-diet-app
```

The Firebase API key is required for Firebase's Identity Toolkit sign-in endpoint. Firebase API keys are not account passwords, but they are still project configuration and should not be guessed into the codebase.

## Run

```powershell
uvicorn macrofactor_scraper.api:app --reload
```

Open:

- API docs: <http://127.0.0.1:8000/docs>
- Health check: <http://127.0.0.1:8000/health>

## Endpoints

- `GET /health`
- `GET /v1/profile`
- `GET /v1/food-log?date=YYYY-MM-DD`
- `GET /v1/nutrition?date=YYYY-MM-DD`
- `GET /v1/weight-log?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /v1/workouts?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /v1/workouts/{id}`
- `GET /v1/gyms`
- `GET /v1/raw/{dataset}`

## Dataset Paths

Default Firestore path templates are in `src/macrofactor_scraper/config.py`.

They are deliberately centralized because MacroFactor does not publish this schema as an official API. If a live request returns 404s, inspect the real Firestore paths and update `dataset_paths` rather than changing the route layer.

## Tests

```powershell
pytest
python -m compileall src tests
```
