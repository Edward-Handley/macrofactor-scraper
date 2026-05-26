"""Tests for coach conversation persistence and API endpoints (no real Anthropic calls)."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from macrofactor_scraper import api as api_module
from macrofactor_scraper.api import app, get_health_export_service
from macrofactor_scraper.config import Settings, get_settings
from macrofactor_scraper.health_export import HealthAutoExportService


# ─── Fixtures ─────────────────────────────────────────────────────────────────

def _make_service(tmp_path: Path) -> HealthAutoExportService:
    settings = Settings(sqlite_path=str(tmp_path / "health.sqlite3"))
    svc = HealthAutoExportService(settings.sqlite_path)
    svc._ensure_schema()
    return svc


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(ingest_api_key="secret", sqlite_path=str(tmp_path / "health.sqlite3"))
    svc = _make_service(tmp_path)
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_health_export_service] = lambda: svc
    return TestClient(app)


def _clear():
    app.dependency_overrides.clear()
    api_module._LOGIN_FAILURES.clear()
    api_module._LOGIN_LOCKOUTS.clear()


AUTH = {"X-API-Key": "secret"}


# ─── DB-level tests ───────────────────────────────────────────────────────────

def test_create_and_retrieve_conversation(tmp_path):
    svc = _make_service(tmp_path)
    conv = svc.create_coach_conversation("Test conv", "check_in", "2026-05-26")
    assert conv["id"] is not None
    assert conv["title"] == "Test conv"
    assert conv["framing"] == "check_in"
    assert conv["archived"] == 0


def test_list_conversations_excludes_archived(tmp_path):
    svc = _make_service(tmp_path)
    c1 = svc.create_coach_conversation("Active", None, None)
    c2 = svc.create_coach_conversation("To archive", None, None)
    svc.archive_coach_conversation(c2["id"])
    convs = svc.list_coach_conversations()
    ids = [c["id"] for c in convs]
    assert c1["id"] in ids
    assert c2["id"] not in ids


def test_archive_conversation(tmp_path):
    svc = _make_service(tmp_path)
    conv = svc.create_coach_conversation("Temp", None, None)
    result = svc.archive_coach_conversation(conv["id"])
    assert result is True
    convs = svc.list_coach_conversations()
    assert not any(c["id"] == conv["id"] for c in convs)


def test_archive_nonexistent_returns_false(tmp_path):
    svc = _make_service(tmp_path)
    result = svc.archive_coach_conversation(99999)
    assert result is False


def test_add_and_get_messages(tmp_path):
    svc = _make_service(tmp_path)
    conv = svc.create_coach_conversation("Chat", "free", "2026-05-26")
    cid = conv["id"]
    svc.add_coach_message(cid, "user", "Hello coach")
    svc.add_coach_message(cid, "assistant", "Hello! How can I help?", tokens_used=42, model="claude-haiku-4-5")

    msgs = svc.get_coach_messages(cid)
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "Hello coach"
    assert msgs[1]["role"] == "assistant"
    assert msgs[1]["tokens_used"] == 42


def test_get_conversation_includes_messages(tmp_path):
    svc = _make_service(tmp_path)
    conv = svc.create_coach_conversation("Full conv", None, None)
    cid = conv["id"]
    svc.add_coach_message(cid, "user", "Msg 1")
    svc.add_coach_message(cid, "assistant", "Reply 1")
    full = svc.get_coach_conversation(cid)
    assert full is not None
    assert len(full["messages"]) == 2
    assert full["messages"][0]["content"] == "Msg 1"


def test_message_ordering(tmp_path):
    svc = _make_service(tmp_path)
    conv = svc.create_coach_conversation("Order test", None, None)
    cid = conv["id"]
    for i in range(5):
        svc.add_coach_message(cid, "user" if i % 2 == 0 else "assistant", f"Message {i}")
    msgs = svc.get_coach_messages(cid)
    contents = [m["content"] for m in msgs]
    assert contents == [f"Message {i}" for i in range(5)]


# ─── API endpoint tests ───────────────────────────────────────────────────────

def test_post_conversation(tmp_path):
    client = _client(tmp_path)
    try:
        resp = client.post(
            "/v1/coach/conversations",
            json={"framing": "weekly", "for_date": "2026-05-26", "title": "My chat"},
            headers=AUTH,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "My chat"
        assert data["framing"] == "weekly"
    finally:
        _clear()


def test_list_conversations_endpoint(tmp_path):
    svc = _make_service(tmp_path)
    settings = Settings(ingest_api_key="secret", sqlite_path=str(tmp_path / "health.sqlite3"))
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_health_export_service] = lambda: svc
    client = TestClient(app)
    try:
        client.post("/v1/coach/conversations", json={"title": "C1"}, headers=AUTH)
        client.post("/v1/coach/conversations", json={"title": "C2"}, headers=AUTH)
        resp = client.get("/v1/coach/conversations", headers=AUTH)
        assert resp.status_code == 200
        assert len(resp.json()["conversations"]) >= 2
    finally:
        _clear()


def test_get_conversation_endpoint(tmp_path):
    client = _client(tmp_path)
    try:
        create = client.post("/v1/coach/conversations", json={"title": "Fetch test"}, headers=AUTH)
        conv_id = create.json()["id"]
        resp = client.get(f"/v1/coach/conversations/{conv_id}", headers=AUTH)
        assert resp.status_code == 200
        assert resp.json()["id"] == conv_id
    finally:
        _clear()


def test_get_missing_conversation_returns_404(tmp_path):
    client = _client(tmp_path)
    try:
        resp = client.get("/v1/coach/conversations/99999", headers=AUTH)
        assert resp.status_code == 404
    finally:
        _clear()


def test_delete_conversation_endpoint(tmp_path):
    client = _client(tmp_path)
    try:
        create = client.post("/v1/coach/conversations", json={"title": "Delete me"}, headers=AUTH)
        conv_id = create.json()["id"]
        resp = client.delete(f"/v1/coach/conversations/{conv_id}", headers=AUTH)
        assert resp.status_code == 200

        # Should no longer appear in list
        list_resp = client.get("/v1/coach/conversations", headers=AUTH)
        ids = [c["id"] for c in list_resp.json()["conversations"]]
        assert conv_id not in ids
    finally:
        _clear()


def test_stream_message_endpoint_mocked(tmp_path):
    """SSE stream endpoint returns chunked text deltas."""
    async def _fake_stream(messages, api_key):
        yield '{"delta":"Hello"}'
        yield '{"delta":" world"}'
        yield '{"done":true,"tokens":10}'

    svc = _make_service(tmp_path)
    settings = Settings(ingest_api_key="secret", anthropic_api_key="sk-fake", sqlite_path=str(tmp_path / "health.sqlite3"))
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_health_export_service] = lambda: svc
    client = TestClient(app)
    try:
        create = client.post("/v1/coach/conversations", json={"title": "Stream test"}, headers=AUTH)
        conv_id = create.json()["id"]

        with patch("macrofactor_scraper.ai.stream_chat", side_effect=_fake_stream):
            resp = client.post(
                f"/v1/coach/conversations/{conv_id}/messages",
                json={"message": "How am I doing?"},
                headers={**AUTH, "Accept": "text/event-stream"},
            )
        assert resp.status_code == 200
        body = resp.text
        assert "Hello" in body or "delta" in body
    finally:
        _clear()


def test_stream_message_persists_to_db(tmp_path):
    """After stream completes, both user and assistant messages persist."""
    async def _fake_stream(messages, api_key):
        yield '{"delta":"Great progress!"}'
        yield '{"done":true,"tokens":5}'

    svc = _make_service(tmp_path)
    settings = Settings(ingest_api_key="secret", anthropic_api_key="sk-fake", sqlite_path=str(tmp_path / "health.sqlite3"))
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_health_export_service] = lambda: svc

    try:
        client = TestClient(app)
        create = client.post("/v1/coach/conversations", json={"title": "Persist test"}, headers=AUTH)
        conv_id = create.json()["id"]

        with patch("macrofactor_scraper.ai.stream_chat", side_effect=_fake_stream):
            client.post(
                f"/v1/coach/conversations/{conv_id}/messages",
                json={"message": "Tell me about my week"},
                headers=AUTH,
            )

        msgs = svc.get_coach_messages(conv_id)
        roles = [m["role"] for m in msgs]
        assert "user" in roles
        assert "assistant" in roles

        asst = next(m for m in msgs if m["role"] == "assistant")
        assert "Great progress!" in asst["content"]
    finally:
        _clear()


def test_conversations_require_auth(tmp_path):
    client = _client(tmp_path)
    try:
        resp = client.get("/v1/coach/conversations")
        assert resp.status_code in (401, 403)
    finally:
        _clear()
