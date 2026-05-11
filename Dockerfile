FROM node:20-slim AS frontend-build

WORKDIR /frontend

COPY frontend/package.json frontend/tsconfig.json frontend/vite.config.ts frontend/index.html ./
COPY frontend/src ./src

RUN npm install && npm run build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src
COPY --from=frontend-build /src/macrofactor_scraper/static/dashboard ./src/macrofactor_scraper/static/dashboard

RUN pip install --no-cache-dir . \
    && groupadd --gid 1000 app \
    && useradd --uid 1000 --gid app --home-dir /app --shell /usr/sbin/nologin app \
    && mkdir -p /data \
    && chown -R 1000:1000 /app /data

USER 1000:1000

EXPOSE 8000

CMD ["uvicorn", "macrofactor_scraper.api:app", "--host", "0.0.0.0", "--port", "8000"]
