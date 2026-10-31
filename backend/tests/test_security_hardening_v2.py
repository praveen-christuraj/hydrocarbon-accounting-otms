"""Regression tests for the second security-hardening pass.

Covers the controls added on top of the original 24-finding remediation:
server-side forced/expired password enforcement, password history, the
administrator expiry cap, login/2FA throttling, session revocation and refresh
token reuse detection, TOTP replay, username normalisation and cookie-origin
checks.
"""

import time
from datetime import datetime, timedelta

import pyotp
import pytest

from sqlalchemy import func

from app.config import AUTH_COOKIE_NAME
from app.models import Permission, Role, RolePermission
from app.utils import rate_limit
from app.utils.rate_limit import reset_rate_limits
from tests.conftest import create_user

PASSWORD = "StrongPass123!$Secure"
NEW_PASSWORD = "Brand#New$ecret99"
THIRD_PASSWORD = "Another!Secret#2026"


def _login(client, username, password=PASSWORD):
    return client.post("/auth/login", json={"username": username, "password": password})


def _headers(client, username, password=PASSWORD):
    response = _login(client, username, password)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _permission(db, name):
    existing = (
        db.query(Permission)
        .filter(func.lower(Permission.permission_name) == name.lower())
        .first()
    )
    if existing:
        return existing
    permission = Permission(permission_name=name, module_name="User Management", status="Active")
    db.add(permission)
    db.flush()
    return permission


def _role(db, name, permission_names):
    role = db.query(Role).filter(func.lower(Role.role_name) == name.lower()).first()
    if not role:
        role = Role(role_name=name, status="Active")
        db.add(role)
        db.flush()
    for permission_name in permission_names:
        permission = _permission(db, permission_name)
        link = (
            db.query(RolePermission)
            .filter(
                RolePermission.role_id == role.id,
                RolePermission.permission_id == permission.id,
            )
            .first()
        )
        if not link:
            db.add(RolePermission(role_id=role.id, permission_id=permission.id))
    db.flush()
    return role


def _make_admin(db):
    role = _role(db, "Admin", ["View User", "Create User"])
    admin = create_user(db, "admin", PASSWORD, roles=[role])
    db.commit()
    return admin


def _make_user(db, username="operator"):
    role = _role(db, f"{username}-role", ["View User"])
    user = create_user(db, username, PASSWORD, roles=[role])
    db.commit()
    return user


@pytest.fixture()
def throttling(monkeypatch):
    monkeypatch.setattr(rate_limit, "RATE_LIMIT_ENABLED", True)
    reset_rate_limits()
    yield
    reset_rate_limits()


# ---------------------------------------------------------------------------
# Forced / expired password enforcement
# ---------------------------------------------------------------------------

def test_forced_password_change_blocks_every_other_endpoint(client, db):
    user = _make_user(db, "forceduser")
    user.force_password_change = "Yes"
    db.commit()

    login = _login(client, "forceduser")
    assert login.status_code == 200
    assert login.json()["must_change_password"] is True
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    # Identity is still readable so the UI can render the gate...
    assert client.get("/auth/me", headers=headers).status_code == 200

    # ...but the rest of the API is refused by the server, not just the UI.
    blocked = client.get("/users", headers=headers)
    assert blocked.status_code == 403
    assert blocked.json()["detail"]["code"] == "PASSWORD_CHANGE_REQUIRED"

    changed = client.post(
        "/auth/change-password",
        headers=headers,
        json={
            "current_password": PASSWORD,
            "new_password": NEW_PASSWORD,
            "confirm_password": NEW_PASSWORD,
        },
    )
    assert changed.status_code == 200, changed.text
    refreshed = {"Authorization": f"Bearer {changed.json()['access_token']}"}
    assert client.get("/users", headers=refreshed).status_code == 200


def test_expired_password_blocks_api_until_rotated(client, db):
    user = _make_user(db, "expireduser")
    user.password_expiry_days = 30
    user.password_changed_at = datetime.utcnow() - timedelta(days=45)
    db.commit()

    login = _login(client, "expireduser")
    assert login.status_code == 200
    assert login.json()["must_change_password"] is True
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    expired = client.get("/users", headers=headers)
    assert expired.status_code == 403
    assert expired.json()["detail"]["reason"] == "password_expired"


# ---------------------------------------------------------------------------
# Password history and composition
# ---------------------------------------------------------------------------

def test_password_history_prevents_reuse(client, db):
    _make_user(db, "historyuser")
    headers = _headers(client, "historyuser")

    first = client.post(
        "/auth/change-password",
        headers=headers,
        json={
            "current_password": PASSWORD,
            "new_password": NEW_PASSWORD,
            "confirm_password": NEW_PASSWORD,
        },
    )
    assert first.status_code == 200, first.text
    headers = {"Authorization": f"Bearer {first.json()['access_token']}"}

    reuse = client.post(
        "/auth/change-password",
        headers=headers,
        json={
            "current_password": NEW_PASSWORD,
            "new_password": PASSWORD,
            "confirm_password": PASSWORD,
        },
    )
    assert reuse.status_code == 400
    assert "recently" in reuse.json()["detail"].lower()

    third = client.post(
        "/auth/change-password",
        headers=headers,
        json={
            "current_password": NEW_PASSWORD,
            "new_password": THIRD_PASSWORD,
            "confirm_password": THIRD_PASSWORD,
        },
    )
    assert third.status_code == 200, third.text


@pytest.mark.parametrize(
    "weak_password",
    [
        "Password1234!",
        "Qwerty!234567",
        "Aaaaaaaa1234!",
        "Hydrocarbon1!",
    ],
)
def test_password_policy_rejects_predictable_passwords(client, db, weak_password):
    _make_admin(db)
    headers = _headers(client, "admin")
    response = client.post(
        "/users",
        headers=headers,
        json={
            "full_name": "Weak Candidate",
            "username": "weakcandidate",
            "email": "weak@test.com",
            "password": weak_password,
            "status": "Active",
        },
    )
    assert response.status_code == 400, response.text


def test_username_is_case_insensitive_unique_and_logins_are_exact(client, db):
    _make_admin(db)
    headers = _headers(client, "admin")

    created = client.post(
        "/users",
        headers=headers,
        json={
            "full_name": "Case User",
            "username": "CaseUser",
            "email": "case@test.com",
            "password": "Triton#Vault9!2026",
            "status": "Active",
        },
    )
    assert created.status_code == 200, created.text

    duplicate = client.post(
        "/users",
        headers=headers,
        json={
            "full_name": "Case Duplicate",
            "username": "caseuser",
            "email": "dupe@test.com",
            "password": "Triton#Vault9!2026",
            "status": "Active",
        },
    )
    assert duplicate.status_code == 400

    assert _login(client, "CASEUSER", "Triton#Vault9!2026").status_code == 200

    # LIKE wildcards must never resolve to another account.
    assert _login(client, "%", "Triton#Vault9!2026").status_code == 401


def test_user_search_wildcards_are_escaped(client, db):
    _make_admin(db)
    _make_user(db, "searchtarget")
    headers = _headers(client, "admin")

    everything = client.get("/users", headers=headers)
    assert everything.json()["total"] >= 2

    filtered = client.get("/users", headers=headers, params={"search": "%"})
    assert filtered.status_code == 200
    assert filtered.json()["total"] == 0


# ---------------------------------------------------------------------------
# Administrator password policy
# ---------------------------------------------------------------------------

def test_admin_password_never_expires_is_refused(client, db):
    admin = _make_admin(db)
    target = _make_user(db, "policytarget")
    headers = _headers(client, "admin")

    refused = client.put(
        f"/auth/users/{admin.id}/security/password-policy",
        headers=headers,
        json={"password_expiry_days": 90, "password_never_expires": True},
    )
    assert refused.status_code == 400
    assert "expire" in refused.json()["detail"].lower()

    capped = client.put(
        f"/auth/users/{admin.id}/security/password-policy",
        headers=headers,
        json={"password_expiry_days": 180, "password_never_expires": False},
    )
    assert capped.status_code == 400

    allowed = client.put(
        f"/auth/users/{target.id}/security/password-policy",
        headers=headers,
        json={"password_expiry_days": 45, "password_never_expires": True},
    )
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["user"]["password_never_expires"] is True


def test_admin_cannot_reset_own_password_through_admin_endpoint(client, db):
    admin = _make_admin(db)
    headers = _headers(client, "admin")
    response = client.post(
        f"/auth/users/{admin.id}/security/reset-password",
        headers=headers,
        json={"new_password": NEW_PASSWORD, "force_password_change": True},
    )
    assert response.status_code == 400
    assert "change password" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Session revocation
# ---------------------------------------------------------------------------

def test_admin_can_revoke_every_session_of_a_user(client, db):
    _make_admin(db)
    user = _make_user(db, "revokee")
    user_headers = _headers(client, "revokee")
    admin_headers = _headers(client, "admin")

    assert client.get("/auth/me", headers=user_headers).status_code == 200

    revoked = client.post(
        f"/auth/users/{user.id}/security/revoke-sessions", headers=admin_headers
    )
    assert revoked.status_code == 200, revoked.text

    assert client.get("/auth/me", headers=user_headers).status_code == 401


def test_logout_all_revokes_the_current_access_token(client, db):
    _make_user(db, "logoutall")
    headers = _headers(client, "logoutall")
    assert client.post("/auth/logout-all", headers=headers, json={}).status_code == 200
    assert client.get("/auth/me", headers=headers).status_code == 401


def test_refresh_token_reuse_revokes_the_account_sessions(client, db):
    _make_user(db, "reusetarget")
    login = _login(client, "reusetarget")
    assert login.status_code == 200

    old_refresh = client.cookies.get(AUTH_COOKIE_NAME)
    assert old_refresh

    rotated = client.post("/auth/refresh", json={})
    assert rotated.status_code == 200
    new_access = rotated.json()["access_token"]
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {new_access}"}).status_code == 200

    # Replay the rotated-away refresh token: treated as theft.
    client.cookies.set(AUTH_COOKIE_NAME, old_refresh)
    replay = client.post("/auth/refresh", json={})
    assert replay.status_code == 401

    # The whole session family is now dead, including the newest access token.
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {new_access}"}).status_code == 401


def test_cross_site_origin_is_rejected_for_cookie_refresh(client, db):
    _make_user(db, "origintarget")
    assert _login(client, "origintarget").status_code == 200
    response = client.post(
        "/auth/refresh",
        json={},
        headers={"Origin": "https://attacker.example"},
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# 2FA hardening
# ---------------------------------------------------------------------------

def _enable_2fa(client, db, username):
    role = _role(db, f"{username}-sec", ["Edit Own Security Settings"])
    user = create_user(db, username, PASSWORD, roles=[role])
    db.commit()
    headers = _headers(client, username)
    secret = client.post("/auth/2fa/setup/start", headers=headers).json()["secret"]
    code = pyotp.TOTP(secret).now()
    assert client.post("/auth/2fa/setup/verify", headers=headers, json={"code": code}).status_code == 200
    return user, headers, secret


def test_totp_code_cannot_be_replayed(client, db):
    _user, _headers_2fa, secret = _enable_2fa(client, db, "replayuser")
    # Use the previous 30-second step so the test does not race a boundary.
    step = int(time.time()) // 30 - 1
    code = pyotp.TOTP(secret).at(step * 30)

    first_challenge = _login(client, "replayuser").json()["challenge_id"]
    first = client.post("/auth/2fa/verify", json={"challenge_id": first_challenge, "code": code})
    assert first.status_code == 200, first.text

    second_challenge = _login(client, "replayuser").json()["challenge_id"]
    replay = client.post("/auth/2fa/verify", json={"challenge_id": second_challenge, "code": code})
    assert replay.status_code == 401


def test_starting_2fa_setup_cannot_disable_an_existing_enrolment(client, db):
    _user, headers, _secret = _enable_2fa(client, db, "downgradeuser")
    response = client.post("/auth/2fa/setup/start", headers=headers)
    assert response.status_code == 400
    assert "already enabled" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Throttling and enumeration
# ---------------------------------------------------------------------------

def test_login_is_throttled_per_ip(client, db, throttling):
    for index in range(25):
        response = _login(client, f"missing{index}", "WrongPassword123!")
        if response.status_code == 429:
            assert "Retry-After" in response.headers
            return
    pytest.fail("login never returned HTTP 429 after 25 failed attempts")


def test_unknown_inactive_and_wrong_password_share_one_message(client, db):
    inactive = _make_user(db, "inactiveuser")
    inactive.status = "Inactive"
    db.commit()
    _make_user(db, "realuser")

    unknown = _login(client, "ghostuser", "WrongPassword123!")
    wrong = _login(client, "realuser", "WrongPassword123!")
    disabled = _login(client, "inactiveuser", PASSWORD)

    assert unknown.status_code == wrong.status_code == disabled.status_code == 401
    assert unknown.json()["detail"] == wrong.json()["detail"] == disabled.json()["detail"]


def test_password_policy_endpoint_is_public_and_hides_no_secrets(client):
    response = client.get("/auth/password-policy")
    assert response.status_code == 200
    payload = response.json()
    assert payload["min_length"] >= 12
    assert payload["history_count"] >= 1
    assert "salt" not in str(payload).lower()


# ---------------------------------------------------------------------------
# Response hygiene
# ---------------------------------------------------------------------------

def test_responses_carry_request_id_and_no_store(client):
    response = client.get("/health")
    assert response.headers["x-request-id"]
    assert response.headers["cache-control"] == "no-store"
    assert "object-src 'none'" in response.headers["content-security-policy"]
    assert response.headers["cross-origin-resource-policy"] == "same-origin"
