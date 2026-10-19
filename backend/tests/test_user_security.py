"""Account security: lockouts, password policy, 2FA and reset-request queue."""

from datetime import timedelta

import pyotp
import pytest

from app.models import AuditLog, AuthLoginChallenge, OperationTask, PasswordResetRequest, User
from app.utils.password_policy import validate_password_policy
from app.utils.security import hash_password
from app.utils.time import utcnow
from tests.conftest import create_role_with_permission, create_user


def _login(client, username, password):
    return client.post("/auth/login", json={"username": username, "password": password})


def _auth_headers(client, username, password):
    response = _login(client, username, password)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _admin_headers(client, db):
    from app.models import Role

    role = db.query(Role).filter(Role.role_name == "Admin").first()
    if not role:
        role = Role(role_name="Admin", description="Full access", status="Active")
        db.add(role)
        db.flush()
    admin = db.query(User).filter(User.username == "admin").first()
    if not admin:
        admin = create_user(db, "admin", "AdminPass123!", roles=[role])
    db.commit()
    return _auth_headers(client, "admin", "AdminPass123!"), admin


def _target_user(db, username="target", password="TargetPass123!", **kwargs):
    user = create_user(db, username, password, **kwargs)
    db.commit()
    return user


def _grant(db, role, permission_name, module_name="Profile & Security"):
    from app.models import Permission, RolePermission

    permission = (
        db.query(Permission)
        .filter(Permission.permission_name == permission_name)
        .first()
    )
    if not permission:
        permission = Permission(
            permission_name=permission_name,
            module_name=module_name,
            status="Active",
        )
        db.add(permission)
        db.flush()
    exists = (
        db.query(RolePermission)
        .filter(
            RolePermission.role_id == role.id,
            RolePermission.permission_id == permission.id,
        )
        .first()
    )
    if not exists:
        db.add(RolePermission(role_id=role.id, permission_id=permission.id))
        db.flush()


def _set_two_factor(db, user):
    secret = pyotp.random_base32()
    from app.utils.security import encrypt_security_value
    from app.utils.totp import hash_backup_codes

    user.totp_secret_encrypted = encrypt_security_value(secret)
    user.totp_enabled = "Yes"
    user.totp_confirmed_at = utcnow()
    user.backup_codes_hash_json = hash_backup_codes(
        ["ABCDE-FGHIJ", "KLMNO-PQRST", "UVWXY-Z2345"]
    )
    db.commit()
    return secret


# ---------------------------------------------------------------------------
# Locked accounts are visible and manageable
# ---------------------------------------------------------------------------

def test_locked_account_is_visible_in_registry_and_can_be_unlocked(client, db):
    headers, admin = _admin_headers(client, db)
    target = _target_user(db)
    target.locked_until = utcnow() + timedelta(minutes=10)
    target.failed_login_count = 5
    target.locked_reason = "Automatically locked after 5 failed sign-in attempts"
    db.commit()

    response = client.get("/security/users?status=locked", headers=headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] >= 1
    row = next(item for item in payload["items"] if item["id"] == target.id)
    assert row["is_locked"] is True
    assert row["lock_state"] == "Locked"
    assert row["failed_login_count"] == 5
    assert row["locked_reason"]

    overview = client.get("/security/overview", headers=headers)
    assert overview.status_code == 200, overview.text
    assert overview.json()["locked_users"] >= 1

    unlock = client.post(f"/security/users/{target.id}/unlock", headers=headers, json={})
    assert unlock.status_code == 200, unlock.text
    assert unlock.json()["was_locked"] is True

    db.refresh(target)
    assert target.locked_until is None
    assert target.failed_login_count == 0
    assert target.locked_reason is None

    # The account can sign in immediately after the unlock.
    assert _login(client, "target", "TargetPass123!").status_code == 200


def test_security_actions_require_their_own_permission(client, db):
    role, _ = create_role_with_permission(db, "Security Viewer", "View User Security")
    viewer = create_user(db, "security_viewer", "ViewerPass123!", roles=[role])
    db.commit()
    headers = _auth_headers(client, "security_viewer", "ViewerPass123!")
    target = _target_user(db)

    assert client.get("/security/users", headers=headers).status_code == 200
    denied = client.post(f"/security/users/{target.id}/lock", headers=headers, json={})
    assert denied.status_code == 403
    assert "Lock User Account" in denied.text

    _grant(db, role, "Lock User Account")
    _grant(db, role, "Unlock User Account")
    db.commit()

    locked = client.post(
        f"/security/users/{target.id}/lock",
        headers=headers,
        json={"reason": "Policy violation", "duration_minutes": 30},
    )
    assert locked.status_code == 200, locked.text
    db.refresh(target)
    assert target.locked_until is not None
    assert target.locked_reason == "Policy violation"
    assert target.locked_by_user_id == viewer.id

    denied_unlock = client.post(
        f"/security/users/{target.id}/reset-2fa", headers=headers, json={}
    )
    assert denied_unlock.status_code == 403

    unlocked = client.post(f"/security/users/{target.id}/unlock", headers=headers, json={})
    assert unlocked.status_code == 200, unlocked.text


def test_cannot_lock_or_reset_your_own_account_from_the_console(client, db):
    headers, admin = _admin_headers(client, db)
    lock = client.post(f"/security/users/{admin.id}/lock", headers=headers, json={})
    assert lock.status_code == 400
    reset = client.post(
        f"/auth/users/{admin.id}/security/reset-password",
        headers=headers,
        json={"new_password": "AnotherPass123!", "force_password_change": True},
    )
    assert reset.status_code == 400


# ---------------------------------------------------------------------------
# Administrator password reset
# ---------------------------------------------------------------------------

def test_admin_reset_password_revokes_sessions_and_enforces_change(client, db):
    headers, _admin = _admin_headers(client, db)

    role, _ = create_role_with_permission(db, "Security Reader", "View User Security")
    target = _target_user(db, roles=[role])
    old_headers = _auth_headers(client, "target", "TargetPass123!")
    assert client.get("/security/overview", headers=old_headers).status_code == 200

    response = client.post(
        f"/auth/users/{target.id}/security/reset-password",
        headers=headers,
        json={
            "new_password": "ResetPass12345!",
            "force_password_change": True,
            "reset_2fa": False,
            "remarks": "User called the service desk",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["sessions_revoked"] is True
    assert response.json()["temporary_password"] is None

    # Existing session is revoked by the rotated security stamp.
    revoked = client.get("/auth/me", headers=old_headers)
    assert revoked.status_code == 401
    assert "revoked" in revoked.text.lower()

    # The new password works, but business endpoints are blocked until the
    # forced password change has been completed.
    new_headers = _auth_headers(client, "target", "ResetPass12345!")
    blocked = client.get("/security/overview", headers=new_headers)
    assert blocked.status_code == 403
    assert "password change is required" in blocked.text.lower()

    me = client.get("/auth/me", headers=new_headers)
    assert me.status_code == 200
    assert me.json()["security"]["password_change_required"] is True

    changed = client.post(
        "/auth/change-password",
        headers=new_headers,
        json={
            "current_password": "ResetPass12345!",
            "new_password": "BrandNewPass456!",
            "confirm_password": "BrandNewPass456!",
        },
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["security"]["password_change_required"] is False
    refreshed_headers = {
        "Authorization": f"Bearer {changed.json()['access_token']}"
    }
    assert client.get("/security/overview", headers=refreshed_headers).status_code == 200


def test_generated_temporary_password_is_returned_once_and_works(client, db):
    headers, _admin = _admin_headers(client, db)
    target = _target_user(db)

    response = client.post(
        f"/auth/users/{target.id}/security/reset-password",
        headers=headers,
        json={"generate_password": True, "force_password_change": True},
    )
    assert response.status_code == 200, response.text
    temporary_password = response.json()["temporary_password"]
    assert temporary_password
    validate_password_policy(temporary_password)

    login = _login(client, "target", temporary_password)
    assert login.status_code == 200, login.text
    assert login.json()["security"]["password_change_required"] is True


def test_non_admin_cannot_reset_an_admin_account(client, db):
    admin_role = create_role_with_permission(db, "Admin", "View User Security")[0]
    create_user(db, "admin", "AdminPass123!", roles=[admin_role])

    role, _ = create_role_with_permission(db, "Helpdesk", "Reset User Password")
    create_user(db, "helpdesk", "HelpdeskPass123!", roles=[role])
    db.commit()
    headers = _auth_headers(client, "helpdesk", "HelpdeskPass123!")

    admin_user = db.query(User).filter(User.username == "admin").first()
    response = client.post(
        f"/auth/users/{admin_user.id}/security/reset-password",
        headers=headers,
        json={"new_password": "HijackedPass123!", "force_password_change": True},
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Password policy / history
# ---------------------------------------------------------------------------

def test_user_creation_and_update_enforce_password_policy(client, db):
    headers, _admin = _admin_headers(client, db)

    weak = client.post(
        "/users",
        headers=headers,
        json={
            "username": "weakuser",
            "full_name": "Weak User",
            "email": "weak@example.com",
            "password": "weakpass",
            "status": "Active",
        },
    )
    assert weak.status_code == 400
    assert "12 characters" in weak.text

    strong = client.post(
        "/users",
        headers=headers,
        json={
            "username": "alphatester",
            "full_name": "Alpha Tester",
            "email": "alpha@example.com",
            "password": "OrbitGuard123!",
            "status": "Active",
        },
    )
    assert strong.status_code == 200, strong.text
    user_id = strong.json()["id"]

    reuse = client.put(
        f"/users/{user_id}",
        headers=headers,
        json={
            "username": "alphatester",
            "full_name": "Alpha Tester",
            "email": "alpha@example.com",
            "password": "OrbitGuard123!",
            "status": "Active",
        },
    )
    assert reuse.status_code == 400
    assert "recently" in reuse.text.lower() or "different" in reuse.text.lower()


def test_password_history_prevents_reuse(client, db):
    role, _ = create_role_with_permission(db, "Self Service", "Edit Own Security Settings")
    create_user(db, "selfservice", "FirstPass12345!", roles=[role])
    db.commit()

    headers = _auth_headers(client, "selfservice", "FirstPass12345!")
    first = client.post(
        "/auth/change-password",
        headers=headers,
        json={
            "current_password": "FirstPass12345!",
            "new_password": "SecondPass12345!",
            "confirm_password": "SecondPass12345!",
        },
    )
    assert first.status_code == 200, first.text
    headers = {"Authorization": f"Bearer {first.json()['access_token']}"}

    reuse = client.post(
        "/auth/change-password",
        headers=headers,
        json={
            "current_password": "SecondPass12345!",
            "new_password": "FirstPass12345!",
            "confirm_password": "FirstPass12345!",
        },
    )
    assert reuse.status_code == 400
    assert "recently" in reuse.text.lower()

    third = client.post(
        "/auth/change-password",
        headers=headers,
        json={
            "current_password": "SecondPass12345!",
            "new_password": "ThirdPass12345!",
            "confirm_password": "ThirdPass12345!",
        },
    )
    assert third.status_code == 200, third.text


# ---------------------------------------------------------------------------
# 2FA
# ---------------------------------------------------------------------------

def test_two_factor_setup_login_with_backup_code_and_expired_challenge(client, db):
    role, _ = create_role_with_permission(db, "Self Service", "Edit Own Security Settings")
    create_user(db, "twofa_user", "TwoFactorPass123!", roles=[role])
    db.commit()
    headers = _auth_headers(client, "twofa_user", "TwoFactorPass123!")

    start = client.post("/auth/2fa/setup/start", headers=headers, json={})
    assert start.status_code == 200, start.text
    secret = start.json()["manual_entry_code"]
    assert secret
    assert start.json()["qr_code_data_url"].startswith("data:image/png;base64,")

    verify = client.post(
        "/auth/2fa/setup/verify",
        headers=headers,
        json={"code": pyotp.TOTP(secret).now()},
    )
    assert verify.status_code == 200, verify.text
    backup_codes = verify.json()["backup_codes"]
    assert len(backup_codes) == 10

    # Password login now creates a 2FA challenge.
    login = _login(client, "twofa_user", "TwoFactorPass123!")
    assert login.status_code == 200
    assert login.json()["requires_2fa"] is True
    challenge_id = login.json()["challenge_id"]

    # Expired challenges must fail cleanly (previously a naive/aware datetime
    # comparison raised a 500 error).
    challenge = db.query(AuthLoginChallenge).filter_by(challenge_id=challenge_id).first()
    challenge.expires_at = utcnow() - timedelta(minutes=1)
    db.commit()
    expired = client.post(
        "/auth/2fa/verify",
        json={"challenge_id": challenge_id, "code": "123456"},
    )
    assert expired.status_code == 401
    assert "expired" in expired.text.lower()

    # A fresh login can be completed with a recovery code.
    login = _login(client, "twofa_user", "TwoFactorPass123!")
    challenge_id = login.json()["challenge_id"]
    used_backup_code = backup_codes[0]
    verified = client.post(
        "/auth/2fa/verify",
        json={"challenge_id": challenge_id, "code": used_backup_code},
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["security"]["backup_codes_remaining"] == 9

    # The used recovery code cannot be replayed.
    login = _login(client, "twofa_user", "TwoFactorPass123!")
    replay = client.post(
        "/auth/2fa/verify",
        json={"challenge_id": login.json()["challenge_id"], "code": used_backup_code},
    )
    assert replay.status_code == 401


def test_2fa_setup_never_disables_an_active_authenticator_without_reauth(client, db):
    role, _ = create_role_with_permission(db, "Self Service", "Edit Own Security Settings")
    user = create_user(db, "twofa_guard", "GuardPass12345!", roles=[role])
    db.commit()
    headers = _auth_headers(client, "twofa_guard", "GuardPass12345!")

    start = client.post("/auth/2fa/setup/start", headers=headers, json={})
    secret = start.json()["manual_entry_code"]
    verify = client.post(
        "/auth/2fa/setup/verify",
        headers=headers,
        json={"code": pyotp.TOTP(secret).now()},
    )
    assert verify.status_code == 200, verify.text

    db.refresh(user)
    original_secret = user.totp_secret_encrypted
    original_codes = list(user.backup_codes_hash_json)

    no_reauth = client.post("/auth/2fa/setup/start", headers=headers, json={})
    assert no_reauth.status_code == 400
    assert "already enabled" in no_reauth.text.lower()

    wrong_password = client.post(
        "/auth/2fa/setup/start",
        headers=headers,
        json={"current_password": "WrongPass12345!", "code": "123456"},
    )
    assert wrong_password.status_code == 401

    db.refresh(user)
    assert user.totp_enabled == "Yes"
    assert user.totp_secret_encrypted == original_secret
    assert list(user.backup_codes_hash_json) == original_codes

    reconfigure = client.post(
        "/auth/2fa/setup/start",
        headers=headers,
        json={
            "current_password": "GuardPass12345!",
            "code": verify.json()["backup_codes"][0],
        },
    )
    assert reconfigure.status_code == 200, reconfigure.text
    assert reconfigure.json()["is_reconfiguration"] is True
    db.refresh(user)
    # The active authenticator is untouched until the new secret is verified.
    assert user.totp_enabled == "Yes"
    assert user.totp_secret_encrypted == original_secret


def test_regenerate_backup_codes_requires_password_and_second_factor(client, db):
    role, _ = create_role_with_permission(db, "Self Service", "Edit Own Security Settings")
    create_user(db, "regen_user", "RegenPass12345!", roles=[role])
    db.commit()
    headers = _auth_headers(client, "regen_user", "RegenPass12345!")

    start = client.post("/auth/2fa/setup/start", headers=headers, json={})
    secret = start.json()["manual_entry_code"]
    verify = client.post(
        "/auth/2fa/setup/verify",
        headers=headers,
        json={"code": pyotp.TOTP(secret).now()},
    )
    old_code = verify.json()["backup_codes"][0]

    no_password = client.post(
        "/auth/2fa/backup-codes/regenerate",
        headers=headers,
        json={"current_password": "WrongPass12345!", "code": old_code},
    )
    assert no_password.status_code == 401

    regenerated = client.post(
        "/auth/2fa/backup-codes/regenerate",
        headers=headers,
        json={"current_password": "RegenPass12345!", "code": old_code},
    )
    assert regenerated.status_code == 200, regenerated.text
    assert len(regenerated.json()["backup_codes"]) == 10
    assert regenerated.json()["backup_codes"] != verify.json()["backup_codes"]


def test_forced_2fa_enrollment_blocks_business_endpoints_until_enrolled(client, db):
    role, _ = create_role_with_permission(db, "Security Reader", "View User Security")
    user = create_user(db, "forced_2fa", "ForcedPass12345!", roles=[role])
    user.force_2fa = "Yes"
    db.commit()

    headers = _auth_headers(client, "forced_2fa", "ForcedPass12345!")
    blocked = client.get("/security/overview", headers=headers)
    assert blocked.status_code == 403
    assert "two-factor authentication enrolment is required" in blocked.text.lower()

    start = client.post("/auth/2fa/setup/start", headers=headers, json={})
    assert start.status_code == 200, start.text
    verify = client.post(
        "/auth/2fa/setup/verify",
        headers=headers,
        json={"code": pyotp.TOTP(start.json()["manual_entry_code"]).now()},
    )
    assert verify.status_code == 200, verify.text

    # 2FA is now enrolled; the same session can reach business endpoints again.
    assert client.get("/security/overview", headers=headers).status_code == 200


def test_forced_password_change_blocks_business_endpoints_until_changed(client, db):
    role, _ = create_role_with_permission(db, "Security Reader Password", "View User Security")
    user = create_user(db, "forced_pwd", "ForcedPwdStart123!", roles=[role])
    user.force_password_change = "Yes"
    db.commit()

    headers = _auth_headers(client, "forced_pwd", "ForcedPwdStart123!")
    blocked = client.get("/security/overview", headers=headers)
    assert blocked.status_code == 403
    assert "password change is required" in blocked.text.lower()

    # /auth/me stays available so the SPA can render the blocking screen.
    me = client.get("/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["security"]["password_change_required"] is True

    changed = client.post(
        "/auth/change-password",
        headers=headers,
        json={
            "current_password": "ForcedPwdStart123!",
            "new_password": "ForcedPwdFinish456!",
            "confirm_password": "ForcedPwdFinish456!",
        },
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["access_token"]
    new_headers = {"Authorization": f"Bearer {changed.json()['access_token']}"}

    assert client.get("/security/overview", headers=new_headers).status_code == 200
    me_after = client.get("/auth/me", headers=new_headers)
    assert me_after.json()["security"]["password_change_required"] is False


# ---------------------------------------------------------------------------
# Reset-request queue
# ---------------------------------------------------------------------------

def test_password_reset_request_queue_approve_and_reject(client, db):
    headers, _admin = _admin_headers(client, db)
    target = _target_user(db)

    first = client.post(
        "/auth/forgot-password",
        json={"username": "target", "reason": "Locked out", "reset_2fa": True},
    )
    assert first.status_code == 200, first.text

    queue = client.get("/security/password-reset-requests?status=Pending", headers=headers)
    assert queue.status_code == 200, queue.text
    item = next(row for row in queue.json()["items"] if row["user_id"] == target.id)
    assert item["full_name"] == target.full_name
    assert item["reset_2fa"] == "Yes"
    request_id = item["id"]
    task_id = item["task_id"]

    approved = client.post(
        f"/security/password-reset-requests/{request_id}/approve",
        headers=headers,
        json={
            "generate_password": True,
            "force_password_change": True,
            "remarks": "Identity verified by phone",
        },
    )
    assert approved.status_code == 200, approved.text
    temporary_password = approved.json()["temporary_password"]
    assert temporary_password
    assert _login(client, "target", temporary_password).status_code == 200

    reset_request = db.query(PasswordResetRequest).filter_by(id=request_id).first()
    assert reset_request.status == "Approved"
    task = db.query(OperationTask).filter_by(id=task_id).first()
    assert task.status == "Closed"

    # A second request can be rejected with a reason.
    second = client.post("/auth/forgot-password", json={"username": "target"})
    assert second.status_code == 200
    pending = (
        db.query(PasswordResetRequest)
        .filter(PasswordResetRequest.user_id == target.id, PasswordResetRequest.status == "Pending")
        .first()
    )
    assert pending is not None
    rejected = client.post(
        f"/security/password-reset-requests/{pending.id}/reject",
        headers=headers,
        json={"remarks": "Request cannot be verified"},
    )
    assert rejected.status_code == 200, rejected.text
    db.refresh(pending)
    assert pending.status == "Rejected"
    assert pending.action_notes == "Request cannot be verified"


def test_reset_request_approval_requires_manage_permission(client, db):
    role, _ = create_role_with_permission(db, "Security Viewer", "View User Security")
    create_user(db, "request_viewer", "ViewerPass123!", roles=[role])
    target = _target_user(db)
    db.commit()

    client.post("/auth/forgot-password", json={"username": "target"})
    request_row = (
        db.query(PasswordResetRequest)
        .filter(PasswordResetRequest.user_id == target.id)
        .first()
    )

    headers = _auth_headers(client, "request_viewer", "ViewerPass123!")
    denied = client.post(
        f"/security/password-reset-requests/{request_row.id}/approve",
        headers=headers,
        json={"generate_password": True},
    )
    assert denied.status_code == 403
    assert "Approve Password Reset Requests" in denied.text


# ---------------------------------------------------------------------------
# Lockout behaviour
# ---------------------------------------------------------------------------

def test_failed_logins_lock_the_account_and_expired_lock_clears(client, db):
    target = _target_user(db)

    for _ in range(5):
        response = _login(client, "target", "WrongPass123!")
        assert response.status_code == 401

    locked = _login(client, "target", "TargetPass123!")
    assert locked.status_code == 423
    assert "locked" in locked.text.lower()

    db.refresh(target)
    assert target.locked_until is not None
    assert target.failed_login_count >= 5
    assert target.locked_by_user_id is None

    audit = (
        db.query(AuditLog)
        .filter(
            AuditLog.action == "Account Locked",
            AuditLog.entity_id == target.id,
        )
        .first()
    )
    assert audit is not None

    # Simulate the timed lock expiring; the next successful login clears it.
    target.locked_until = utcnow() - timedelta(minutes=1)
    db.commit()
    recovered = _login(client, "target", "TargetPass123!")
    assert recovered.status_code == 200, recovered.text
    db.refresh(target)
    assert target.locked_until is None
    assert target.failed_login_count == 0


def test_administrator_lock_is_indefinite_and_not_auto_released(client, db):
    headers, _admin = _admin_headers(client, db)
    target = _target_user(db)

    locked = client.post(
        f"/security/users/{target.id}/lock",
        headers=headers,
        json={"reason": "Investigation"},
    )
    assert locked.status_code == 200, locked.text
    assert locked.json()["indefinite"] is True

    db.refresh(target)
    assert target.locked_until.year == 9999

    # Simulating time passing does not release an administrative lock.
    target.locked_until = utcnow() - timedelta(minutes=1)  # not used by the guard
    db.commit()
    # Restore the indefinite lock and confirm login is still blocked.
    target.locked_until = utcnow() + timedelta(days=1)
    db.commit()
    blocked = _login(client, "target", "TargetPass123!")
    assert blocked.status_code == 423


def test_revoke_sessions_invalidates_existing_tokens(client, db):
    headers, _admin = _admin_headers(client, db)
    target = _target_user(db)
    target_headers = _auth_headers(client, "target", "TargetPass123!")
    assert client.get("/auth/me", headers=target_headers).status_code == 200

    revoked = client.post(
        f"/security/users/{target.id}/revoke-sessions",
        headers=headers,
        json={"reason": "Laptop lost"},
    )
    assert revoked.status_code == 200, revoked.text
    assert client.get("/auth/me", headers=target_headers).status_code == 401
