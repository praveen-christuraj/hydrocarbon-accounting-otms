"""End-to-end tests for the password management & 2FA security module.

Covers the enterprise flows the Profile & Security module depends on:

* full 2FA lifecycle: setup -> verify -> login challenge -> code verify
* account lockout after repeated failures + administrator unlock
* administrator password reset (completes pending reset requests)
* password reset request queue: list + decline
* server-side password policy on user create/update
* change-password returns a fresh token pair and old tokens are revoked
"""

from datetime import datetime, timedelta

import pyotp

from app.models import PasswordResetRequest, User
from app.utils.security import decrypt_security_value
from tests.conftest import create_role_with_permission, create_user


ADMIN_PASSWORD = "AdminPass123!$Secure"
USER_PASSWORD = "UserPass123!$Secure"


def _login(client, username, password):
    return client.post("/auth/login", json={"username": username, "password": password})


def _auth_headers(client, username, password):
    response = _login(client, username, password)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _make_admin(db):
    role, _ = create_role_with_permission(db, "Admin", "View User")
    admin = create_user(db, "admin", ADMIN_PASSWORD, roles=[role])
    db.commit()
    return admin


def _make_user(db, username="operator", password=USER_PASSWORD, permission="View Dashboard"):
    role, _ = create_role_with_permission(db, f"{username}-role", permission)
    user = create_user(db, username, password, roles=[role])
    db.commit()
    return user


# ---------------------------------------------------------------------------
# 2FA lifecycle
# ---------------------------------------------------------------------------

def test_full_2fa_lifecycle(client, db):
    role, _ = create_role_with_permission(db, "SelfService", "Edit Own Security Settings")
    user = create_user(db, "mfauser", USER_PASSWORD, roles=[role])
    db.commit()
    headers = _auth_headers(client, "mfauser", USER_PASSWORD)

    # Start setup: must return a QR image AND the manual secret.
    start = client.post("/auth/2fa/setup/start", headers=headers)
    assert start.status_code == 200, start.text
    assert start.json()["qr_code_data_url"].startswith("data:image/png;base64,")
    secret = start.json()["secret"]
    assert secret

    # Verify setup with a real TOTP code (regression: used to 500 via NameError).
    code = pyotp.TOTP(secret).now()
    verify = client.post("/auth/2fa/setup/verify", json={"code": code}, headers=headers)
    assert verify.status_code == 200, verify.text
    backup_codes = verify.json()["backup_codes"]
    assert len(backup_codes) == 10

    # Login now requires a challenge.
    login = _login(client, "mfauser", USER_PASSWORD)
    assert login.status_code == 200, login.text
    assert login.json()["requires_2fa"] is True
    challenge_id = login.json()["challenge_id"]

    # Verify the challenge (regression: naive/aware datetime comparison 500).
    code = pyotp.TOTP(secret).now()
    challenge = client.post(
        "/auth/2fa/verify", json={"challenge_id": challenge_id, "code": code}
    )
    assert challenge.status_code == 200, challenge.text
    assert "access_token" in challenge.json()

    # A backup code also works (fresh challenge).
    challenge_id = _login(client, "mfauser", USER_PASSWORD).json()["challenge_id"]
    backup = client.post(
        "/auth/2fa/verify", json={"challenge_id": challenge_id, "code": backup_codes[0]}
    )
    assert backup.status_code == 200, backup.text

    # A used backup code is rejected.
    challenge_id = _login(client, "mfauser", USER_PASSWORD).json()["challenge_id"]
    reused = client.post(
        "/auth/2fa/verify", json={"challenge_id": challenge_id, "code": backup_codes[0]}
    )
    assert reused.status_code == 401


def test_2fa_challenge_attempts_are_capped(client, db):
    role, _ = create_role_with_permission(db, "SelfService", "Edit Own Security Settings")
    create_user(db, "mfauser2", USER_PASSWORD, roles=[role])
    db.commit()
    headers = _auth_headers(client, "mfauser2", USER_PASSWORD)

    secret = client.post("/auth/2fa/setup/start", headers=headers).json()["secret"]
    code = pyotp.TOTP(secret).now()
    assert client.post("/auth/2fa/setup/verify", json={"code": code}, headers=headers).status_code == 200

    challenge_id = _login(client, "mfauser2", USER_PASSWORD).json()["challenge_id"]
    for _ in range(5):
        bad = client.post(
            "/auth/2fa/verify", json={"challenge_id": challenge_id, "code": "000000"}
        )
        assert bad.status_code == 401

    # Challenge is burned even with the correct code now.
    good = pyotp.TOTP(secret).now()
    final = client.post(
        "/auth/2fa/verify", json={"challenge_id": challenge_id, "code": good}
    )
    assert final.status_code == 401


def test_admin_can_reset_user_2fa_without_password(client, db):
    _make_admin(db)
    role, _ = create_role_with_permission(db, "SelfService", "Edit Own Security Settings")
    user = create_user(db, "mfauser3", USER_PASSWORD, roles=[role])
    db.commit()
    headers = _auth_headers(client, "mfauser3", USER_PASSWORD)
    secret = client.post("/auth/2fa/setup/start", headers=headers).json()["secret"]
    code = pyotp.TOTP(secret).now()
    assert client.post("/auth/2fa/setup/verify", json={"code": code}, headers=headers).status_code == 200

    admin_headers = _auth_headers(client, "admin", ADMIN_PASSWORD)
    reset = client.post(f"/auth/users/{user.id}/security/reset-2fa", headers=admin_headers)
    assert reset.status_code == 200, reset.text

    db.refresh(user)
    assert user.totp_enabled == "No"
    assert user.totp_secret_encrypted is None
    # Login no longer demands a challenge.
    login = _login(client, "mfauser3", USER_PASSWORD)
    assert login.status_code == 200
    assert login.json()["requires_2fa"] is False


# ---------------------------------------------------------------------------
# Lockout + unlock
# ---------------------------------------------------------------------------

def test_account_lockout_and_admin_unlock(client, db):
    _make_admin(db)
    user = _make_user(db, "lockme")

    for attempt in range(4):
        response = _login(client, "lockme", "WrongPassword1!")
        assert response.status_code == 401
    # Fifth failure locks the account with a clear 423.
    locked = _login(client, "lockme", "WrongPassword1!")
    assert locked.status_code == 423

    # Even the right password is refused while locked.
    refused = _login(client, "lockme", USER_PASSWORD)
    assert refused.status_code == 423
    assert "locked" in refused.json()["detail"].lower()

    # The security overview surfaces the locked account to the admin.
    admin_headers = _auth_headers(client, "admin", ADMIN_PASSWORD)
    overview = client.get("/auth/users/security-overview", headers=admin_headers)
    assert overview.status_code == 200, overview.text
    row = next(item for item in overview.json()["items"] if item["username"] == "lockme")
    assert row["is_locked"] is True
    assert row["failed_login_count"] == 5
    assert overview.json()["locked_count"] >= 1

    # Admin unlocks; the user signs straight back in.
    unlock = client.post(f"/auth/users/{user.id}/security/unlock", headers=admin_headers)
    assert unlock.status_code == 200, unlock.text
    assert _login(client, "lockme", USER_PASSWORD).status_code == 200


def test_security_overview_requires_permission(client, db):
    _make_user(db, "plainuser")
    headers = _auth_headers(client, "plainuser", USER_PASSWORD)
    response = client.get("/auth/users/security-overview", headers=headers)
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Password reset requests queue
# ---------------------------------------------------------------------------

def test_forgot_password_request_admin_reset_completes_it(client, db):
    _make_admin(db)
    user = _make_user(db, "forgetful")

    submitted = client.post(
        "/auth/forgot-password",
        json={"username": "forgetful", "reason": "Lost my password", "reset_2fa": False},
    )
    assert submitted.status_code == 200

    admin_headers = _auth_headers(client, "admin", ADMIN_PASSWORD)
    queue = client.get("/auth/password-reset-requests?status=Pending", headers=admin_headers)
    assert queue.status_code == 200, queue.text
    assert queue.json()["pending_count"] == 1
    request_row = queue.json()["items"][0]
    assert request_row["username"] == "forgetful"

    # Admin resets the password; the pending request auto-completes.
    reset = client.post(
        f"/auth/users/{user.id}/security/reset-password",
        json={
            "new_password": "FreshSecret!2026x",
            "force_password_change": True,
            "reset_2fa": False,
            "remarks": "Handled from queue",
        },
        headers=admin_headers,
    )
    assert reset.status_code == 200, reset.text

    queue = client.get("/auth/password-reset-requests?status=Pending", headers=admin_headers)
    assert queue.json()["pending_count"] == 0

    login = _login(client, "forgetful", "FreshSecret!2026x")
    assert login.status_code == 200
    assert login.json()["must_change_password"] is True


def test_decline_password_reset_request(client, db):
    _make_admin(db)
    _make_user(db, "declined")
    client.post("/auth/forgot-password", json={"username": "declined", "reason": "test"})

    admin_headers = _auth_headers(client, "admin", ADMIN_PASSWORD)
    queue = client.get("/auth/password-reset-requests", headers=admin_headers)
    request_id = queue.json()["items"][0]["id"]

    decline = client.post(
        f"/auth/password-reset-requests/{request_id}/decline",
        json={"notes": "Identity not confirmed"},
        headers=admin_headers,
    )
    assert decline.status_code == 200, decline.text
    assert decline.json()["request"]["status"] == "Declined"

    # Cannot decline twice.
    again = client.post(
        f"/auth/password-reset-requests/{request_id}/decline",
        json={"notes": "again"},
        headers=admin_headers,
    )
    assert again.status_code == 400

    row = db.query(PasswordResetRequest).filter(PasswordResetRequest.id == request_id).first()
    assert row.status == "Declined"
    assert row.action_notes == "Identity not confirmed"


# ---------------------------------------------------------------------------
# Password policy + change password session handling
# ---------------------------------------------------------------------------

def test_user_create_enforces_password_policy(client, db):
    role, _ = create_role_with_permission(db, "UserAdmin", "Create User")
    create_user(db, "useradmin", USER_PASSWORD, roles=[role])
    db.commit()
    headers = _auth_headers(client, "useradmin", USER_PASSWORD)

    weak = client.post(
        "/users",
        json={
            "full_name": "Weak User",
            "username": "weakuser",
            "email": "weak@test.com",
            "password": "short",
            "status": "Active",
        },
        headers=headers,
    )
    assert weak.status_code in (400, 422)

    contains_username = client.post(
        "/users",
        json={
            "full_name": "Echo User",
            "username": "echouser",
            "email": "echo@test.com",
            "password": "Echouser!23456789",
            "status": "Active",
        },
        headers=headers,
    )
    assert contains_username.status_code == 400
    assert "username" in contains_username.json()["detail"].lower()

    strong = client.post(
        "/users",
        json={
            "full_name": "Strong User",
            "username": "stronguser",
            "email": "strong@test.com",
            "password": "Str0ng&Secure#2026",
            "status": "Active",
        },
        headers=headers,
    )
    assert strong.status_code == 200, strong.text


def test_change_password_rotates_tokens_and_revokes_old_sessions(client, db):
    role, _ = create_role_with_permission(db, "SelfService", "Edit Own Security Settings")
    create_user(db, "rotator", USER_PASSWORD, roles=[role])
    db.commit()

    login = _login(client, "rotator", USER_PASSWORD)
    old_token = login.json()["access_token"]
    old_headers = {"Authorization": f"Bearer {old_token}"}

    changed = client.post(
        "/auth/change-password",
        json={
            "current_password": USER_PASSWORD,
            "new_password": "Brand#New$ecret99",
            "confirm_password": "Brand#New$ecret99",
        },
        headers=old_headers,
    )
    assert changed.status_code == 200, changed.text
    body = changed.json()
    assert body["access_token"]
    assert "refresh_token" not in body
    assert "httponly" in changed.headers["set-cookie"].lower()

    # The fresh token works.
    new_headers = {"Authorization": f"Bearer {body['access_token']}"}
    assert client.get("/auth/me", headers=new_headers).status_code == 200

    # Simulate the old session being older than the rotation leeway.
    user = db.query(User).filter(User.username == "rotator").first()
    user.password_changed_at = datetime.utcnow() + timedelta(seconds=120)
    db.commit()
    stale = client.get("/auth/me", headers=old_headers)
    assert stale.status_code == 401


def test_admin_reset_clears_lock_and_forces_change(client, db):
    _make_admin(db)
    user = _make_user(db, "resetme")
    for _ in range(5):
        _login(client, "resetme", "WrongPassword1!")
    assert _login(client, "resetme", USER_PASSWORD).status_code == 423

    admin_headers = _auth_headers(client, "admin", ADMIN_PASSWORD)
    reset = client.post(
        f"/auth/users/{user.id}/security/reset-password",
        json={
            "new_password": "Recovery!Pass2026",
            "force_password_change": True,
            "reset_2fa": False,
            "remarks": "Unlock via reset",
        },
        headers=admin_headers,
    )
    assert reset.status_code == 200, reset.text

    login = _login(client, "resetme", "Recovery!Pass2026")
    assert login.status_code == 200
    assert login.json()["must_change_password"] is True


def test_non_admin_cannot_reset_admin_password(client, db):
    _make_admin(db)
    role, _ = create_role_with_permission(db, "Helpdesk", "Reset User Password")
    create_user(db, "helpdesk", USER_PASSWORD, roles=[role])
    db.commit()

    admin = db.query(User).filter(User.username == "admin").first()
    headers = _auth_headers(client, "helpdesk", USER_PASSWORD)
    response = client.post(
        f"/auth/users/{admin.id}/security/reset-password",
        json={
            "new_password": "Takeover!Pass2026",
            "force_password_change": False,
            "reset_2fa": False,
        },
        headers=headers,
    )
    # 403 (admin shield) or 404 (hidden by location scope) are both refusals.
    assert response.status_code in (403, 404)

    admin_still = db.query(User).filter(User.username == "admin").first()
    db.refresh(admin_still)
    login = _login(client, "admin", ADMIN_PASSWORD)
    assert login.status_code == 200
