# Security Policy

## About this project

This is a personal health dashboard that ingests sensitive personal data — nutrition logs from MacroFactor via Apple Health, and biometric data from Garmin Connect (heart rate, HRV, sleep, SpO₂, body battery, etc.). It is a self-hosted application deployed via Docker Compose behind a Caddy reverse proxy. Even though it is a personal project, the sensitivity of the data it stores means responsible security practices matter.

## Supported versions

| Component | Status |
|-----------|--------|
| Latest `main` branch | ✅ Actively maintained |
| Any prior tagged release | ❌ Not supported |

This is a solo personal project — only the current `main` branch receives fixes.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.** Because this project handles personal health data, even a theoretical disclosure route is worth taking seriously.

Instead, please report vulnerabilities privately via one of the following:

1. **GitHub Private Vulnerability Reporting** (preferred): navigate to [Security → Report a vulnerability](../../security/advisories/new) in this repo.
2. **Email**: `edward.handley@[your-domain].com` — subject line `SECURITY: <short summary>`.

Please include:
- A description of the vulnerability and its potential impact.
- Steps to reproduce or a proof-of-concept.
- The affected component (backend API, frontend, Docker configuration, ingest pipeline, etc.).
- Any suggested mitigation, if you have one.

I will aim to acknowledge all reports within **5 business days** and provide a resolution timeline within **14 days**.

## Threat model and scope

This application is intended to be self-hosted by the owner only. The primary threat surface is:

- **Unauthenticated access** to `/v1` read endpoints or ingest endpoints (these are protected by API key headers and session cookies).
- **Credential exposure** — Garmin username/password, Anthropic API key, session secret, or API keys committed to the repository or leaked via environment.
- **Injection attacks** — the FastAPI backend uses raw SQLite (no ORM), making SQL injection a realistic concern if query construction is not parameterised correctly.
- **Insecure direct object reference** — metric names and date parameters passed directly into queries.
- **Supply-chain risk** — compromised Python or npm dependency introducing malicious code.
- **Docker escape or privilege escalation** — the container already runs as UID 1000 with `no-new-privileges` and all capabilities dropped, but further hardening is possible.

In scope for reporting:
- Authentication/authorisation bypasses on any `/v1` endpoint.
- SQL injection in the FastAPI backend.
- Secrets or sensitive data visible in API responses that should be redacted.
- Container misconfigurations that could allow privilege escalation.
- Dependency vulnerabilities not yet detected by Dependabot.

Out of scope:
- Vulnerabilities that require physical access to the VPS.
- Denial-of-service via excessive ingest requests (no rate limiting is currently implemented — this is a known limitation for a personal project).
- Third-party service vulnerabilities (Garmin Connect, MacroFactor, Apple Health).

## Safe harbour

If you discover a vulnerability and report it responsibly in line with this policy, I will not take legal action against you and will acknowledge your contribution in the fix commit (unless you prefer to remain anonymous).
