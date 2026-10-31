"""Regression tests for the hardening infrastructure itself.

These cover the pieces that are easy to break silently: the request-body
ceiling, request-id correlation, production API-doc gating, the privileged
database browser's audit trail, and the error-message contract that keeps
driver text out of responses and out of the database.
"""

import asyncio
import json

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.models import AuditLog, User
from app.utils.errors import safe_client_error, stored_error_message
from app.utils.helpers import escape_like
from app.utils.http_hardening import RequestBodyLimitMiddleware

from .conftest import create_user
from .test_security_hardening_v2 import PASSWORD, _role


# ---------------------------------------------------------------------------
# Request body ceiling
# ---------------------------------------------------------------------------

def _limited_app(max_bytes=1024):
    app = FastAPI()

    @app.post("/echo")
    async def echo(request: Request):  # pragma: no cover - exercised via client
        body = await request.body()
        return {"size": len(body)}

    app.add_middleware(RequestBodyLimitMiddleware, max_bytes=max_bytes)
    return app


def test_declared_oversized_body_is_rejected_before_parsing():
    client = TestClient(_limited_app(), raise_server_exceptions=False)
    response = client.post(
        "/echo",
        content=b"x" * 2048,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["detail"] == "Request body is too large"


def test_streamed_oversized_body_raises_413_without_content_length():
    """Chunked uploads must hit the same ceiling as declared lengths."""
    chunks = [b"a" * 700, b"b" * 700, b"c" * 700]
    state = {"index": 0, "sent": []}

    async def receive():
        if state["index"] < len(chunks):
            body = chunks[state["index"]]
            state["index"] += 1
            return {"type": "http.request", "body": body, "more_body": True}
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        state["sent"].append(message)

    async def app(scope, receive, send):
        # Simulates a route that streams the body (no Content-Length header).
        while True:
            message = await receive()
            if not message.get("more_body"):
                break

    middleware = RequestBodyLimitMiddleware(app=app, max_bytes=1024)

    scope = {
        "type": "http",
        "method": "POST",
        "headers": [(b"content-type", b"application/octet-stream")],
        "path": "/upload",
        "raw_path": b"/upload",
        "state": {},
    }

    with pytest.raises(Exception) as excinfo:
        asyncio.run(middleware(scope, receive, send))

    assert getattr(excinfo.value, "status_code", None) == 413


# ---------------------------------------------------------------------------
# Request-id correlation
# ---------------------------------------------------------------------------

def test_valid_request_id_is_echoed(client):
    response = client.get("/health", headers={"X-Request-ID": "it-ticket-4231"})
    assert response.status_code == 200
    assert response.headers["x-request-id"] == "it-ticket-4231"


@pytest.mark.parametrize("header", ["short", "bad id with spaces", "x" * 65, ""])
def test_invalid_request_id_is_replaced(client, header):
    response = client.get("/health", headers={"X-Request-ID": header})
    assert response.status_code == 200
    generated = response.headers["x-request-id"]
    assert generated != header
    assert len(generated) >= 8


def test_every_response_carries_a_request_id(client):
    response = client.get("/health")
    assert response.headers.get("x-request-id")


# ---------------------------------------------------------------------------
# Production docs gating
# ---------------------------------------------------------------------------

def test_api_docs_are_disabled_in_production(monkeypatch):
    from app import main as main_module

    monkeypatch.setattr(main_module, "IS_PRODUCTION", True)
    monkeypatch.delenv("ENABLE_API_DOCS", raising=False)
    assert main_module.api_docs_path("/docs") is None
    assert main_module.api_docs_path("/openapi.json") is None

    monkeypatch.setenv("ENABLE_API_DOCS", "true")
    assert main_module.api_docs_path("/docs") == "/docs"


def test_api_docs_are_available_outside_production(monkeypatch):
    from app import main as main_module

    monkeypatch.setattr(main_module, "IS_PRODUCTION", False)
    assert main_module.api_docs_path("/docs") == "/docs"


# ---------------------------------------------------------------------------
# Error-message contract
# ---------------------------------------------------------------------------

def test_client_errors_never_contain_driver_text():
    leaky = RuntimeError(
        'connection to server at "db.internal" failed: password authentication '
        "failed for user 'hc_admin'; DSN=postgresql://hc_admin:s3cret@db.internal:5432/otms"
    )
    client_message = safe_client_error("Backup restore")
    stored_message = stored_error_message("Backup restore", leaky)

    for message in (client_message, stored_message):
        lowered = message.lower()
        assert "postgresql://" not in lowered
        assert "s3cret" not in lowered
        assert "password authentication" not in lowered
        assert "db.internal" not in lowered
    assert "RuntimeError" in stored_message
    assert "request id" in client_message.lower()


def test_error_helpers_keep_deliberate_http_details():
    from fastapi import HTTPException

    exc = HTTPException(status_code=400, detail="Validation failed: duplicate row")
    assert "duplicate row" in stored_error_message("Bulk upload", exc)


# ---------------------------------------------------------------------------
# LIKE escaping
# ---------------------------------------------------------------------------

def test_escape_like_neutralizes_wildcards():
    assert escape_like("100%") == "100\\%"
    assert escape_like("a_b") == "a\\_b"
    assert escape_like("back\\slash") == "back\\\\slash"
    assert escape_like("normal") == "normal"


# ---------------------------------------------------------------------------
# User administration rules through the API
# ---------------------------------------------------------------------------

def _admin_headers(client, db):
    role = _role(db, "Admin", ["View User", "Create User", "Edit User", "Delete User"])
    create_user(db, "admin", PASSWORD, roles=[role])
    db.commit()
    login = client.post("/auth/login", json={"username": "admin", "password": PASSWORD})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_reserved_username_is_rejected_by_the_api(client, db):
    headers = _admin_headers(client, db)
    response = client.post(
        "/users",
        headers=headers,
        json={
            "full_name": "Root Account",
            "username": "root",
            "email": "root@test.com",
            "password": "Triton#Vault9!2026",
            "status": "Active",
        },
    )
    assert response.status_code == 400
    assert "reserved" in response.json()["detail"].lower()


def test_case_insensitive_duplicate_username_is_rejected(client, db):
    headers = _admin_headers(client, db)
    first = client.post(
        "/users",
        headers=headers,
        json={
            "full_name": "Dup One",
            "username": "DupUser",
            "email": "dup1@test.com",
            "password": "Triton#Vault9!2026",
            "status": "Active",
        },
    )
    assert first.status_code == 200, first.text

    second = client.post(
        "/users",
        headers=headers,
        json={
            "full_name": "Dup Two",
            "username": "dupuser",
            "email": "dup2@test.com",
            "password": "Triton#Vault9!2026",
            "status": "Active",
        },
    )
    assert second.status_code == 400
    assert "exists" in second.json()["detail"].lower()


def test_administrator_cannot_deactivate_their_own_account(client, db):
    headers = _admin_headers(client, db)
    admin = db.query(User).filter(User.username == "admin").first()
    response = client.put(
        f"/users/{admin.id}",
        headers=headers,
        json={
            "full_name": admin.full_name,
            "username": admin.username,
            "email": admin.email,
            "status": "Inactive",
        },
    )
    assert response.status_code == 403
    assert "own account" in response.json()["detail"].lower()


def test_password_rotation_ends_existing_sessions(client, db):
    role = _role(db, "Admin", ["View User", "Create User", "Edit User", "Delete User"])
    target = create_user(db, "rotatetarget", PASSWORD, roles=[role])
    db.commit()

    login = client.post("/auth/login", json={"username": "rotatetarget", "password": PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert client.get("/auth/me", headers=headers).status_code == 200

    admin_headers = _admin_headers(client, db)
    reset = client.post(
        f"/auth/users/{target.id}/security/reset-password",
        headers=admin_headers,
        json={"new_password": "Brand#New$ecret99", "force_password_change": True},
    )
    assert reset.status_code == 200, reset.text

    # The session that existed before the reset is dead immediately.
    assert client.get("/auth/me", headers=headers).status_code == 401


# ---------------------------------------------------------------------------
# Privileged database browser
# ---------------------------------------------------------------------------

def test_database_browser_writes_an_audit_row_without_row_contents(client, db):
    headers = _admin_headers(client, db)
    response = client.get("/admin/db/tables/users", headers=headers)
    assert response.status_code == 200, response.text

    # The browser still lists the column, but every value is masked.
    payload = response.json()
    assert "password_hash" in payload["columns"]
    for row in payload["data"]:
        assert row["password_hash"] == "*** REDACTED ***"
    assert "$2b$" not in json.dumps(payload)

    entry = (
        db.query(AuditLog)
        .filter(AuditLog.action == "Browse Database Table")
        .order_by(AuditLog.id.desc())
        .first()
    )
    assert entry is not None
    assert entry.entity_label == "users"
    details = entry.details or {}
    assert details["table_name"] == "users"
    assert "returned_rows" in details
    assert "$2b$" not in json.dumps(details)
