# Droplet Deployment

This guide assumes an Ubuntu droplet, a domain such as `health.example.com`, and DNS pointing at the droplet public IPv4 address.

## 1. Point DNS

Create an `A` record:

```text
health.example.com -> your_droplet_ipv4
```

Wait for DNS to resolve before starting Caddy.

## 2. SSH Into The Droplet

```bash
ssh root@your_droplet_ipv4
```

## 3. Create A Deploy User

```bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

Reconnect as the deploy user:

```bash
exit
ssh deploy@your_droplet_ipv4
```

## 4. Install Docker

```bash
sudo apt update
sudo apt install -y ca-certificates curl git ufw
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker deploy
```

Log out and back in so the Docker group applies.

## 5. Configure Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

## 6. Upload Or Clone The App

From your local machine, either push this repo to GitHub and clone it:

```bash
sudo mkdir -p /opt/health-export
sudo chown deploy:deploy /opt/health-export
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git /opt/health-export
cd /opt/health-export
```

Or copy the project folder to `/opt/health-export` with `scp` or `rsync`.

## 7. Create Production Env

```bash
cd /opt/health-export
mkdir -p data
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
nano .env
```

Set:

```dotenv
DOMAIN=health.example.com
ENVIRONMENT=production
HEALTH_EXPORT_API_KEY=paste-the-generated-secret
HEALTH_EXPORT_READ_API_KEY=paste-a-read-only-secret
HEALTH_EXPORT_SQLITE_PATH=/data/health_export.sqlite3
SESSION_SECRET=paste-a-second-generated-secret
DASHBOARD_PASSWORD=paste-a-dashboard-password
```

## 8. Start The App

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f caddy
```

The Docker image builds the Vite React dashboard in a Node stage, then copies the compiled assets into the Python runtime image. No browser CDN dependency is required.

Test:

```bash
curl https://health.example.com/health
curl -i https://health.example.com/v1/metrics
curl -H "X-API-Key: paste-a-read-only-secret" https://health.example.com/v1/metrics
curl -H "X-API-Key: paste-a-read-only-secret" https://health.example.com/v1/dashboard/preferences
```

Expected:

```json
{"status":"ok"}
```

The unauthenticated `/v1/metrics` request should return `401`. The authenticated read-key request should return metric JSON.

## 9. Configure Health Auto Export

Use:

```text
URL: https://health.example.com/v1/ingest/health-auto-export
Method: POST
Format: JSON
Export Version: Version 2
Header: X-API-Key: paste-the-generated-secret
```

Start with Health Metrics, then add a second automation for Workouts if desired.

## 10. Check Data

```bash
curl -H "X-API-Key: paste-a-read-only-secret" https://health.example.com/v1/metrics
curl -H "X-API-Key: paste-a-read-only-secret" "https://health.example.com/v1/daily-summary?start=2026-05-01&end=2026-05-05"
curl -H "X-API-Key: paste-a-read-only-secret" https://health.example.com/v1/ingest/status
curl -H "X-API-Key: paste-a-read-only-secret" https://health.example.com/v1/dashboard/metric-catalog
curl -H "X-API-Key: paste-a-read-only-secret" https://health.example.com/v1/diagnostics/metrics/2026-05-06
curl -H "X-API-Key: paste-a-read-only-secret" "https://health.example.com/v1/excel/daily-log.csv?start=2026-05-01&end=2026-05-05"
```

Open `https://health.example.com/` in a browser and sign in with `DASHBOARD_PASSWORD`.

## Manual Backfill

If Health Auto Export gives you a JSON file, copy it to the droplet and post it to the ingest endpoint:

```bash
cd /opt/health-export
mkdir -p imports
curl -X POST "https://health.example.com/v1/ingest/health-auto-export" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: paste-the-generated-secret" \
  --data-binary @imports/health-export.json
```

The app deduplicates records, so posting the same export again should not duplicate metric rows.

## Emergency Public Read Block

If you ever deploy a build where private reads are accidentally exposed, temporarily block public reads in `Caddyfile` while leaving ingestion available:

```caddyfile
{$DOMAIN} {
    encode gzip

    @blocked_read_paths {
        method GET
        path /v1/* /docs* /redoc* /openapi.json
    }

    respond @blocked_read_paths "Not found" 404

    reverse_proxy api:8000
}
```

Then run:

```bash
docker compose restart caddy
```

## 11. Back Up SQLite

Create a quick backup:

```bash
cd /opt/health-export
cp data/health_export.sqlite3 "data/health_export-$(date +%F).sqlite3"
```

For production, add a daily cron job that copies `data/health_export.sqlite3` to another machine or object storage.

## Updating

```bash
cd /opt/health-export
git pull
docker compose up -d --build
```

For a local asset check before deployment:

```bash
cd frontend
npm install
npm run build
cd ..
python -m pytest
```
