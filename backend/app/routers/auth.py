from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import (
    ACCOUNT_LOCKOUT_MINUTES,
    MAX_2FA_ATTEMPTS,
    MAX_FAILED_LOGIN_ATTEMPTS,
    TOTP_SETUP_TTL_MINUTES,
)
from app.database import get_db
from app.dependencies.auth import get_current_user_from_token, hash_token, is_token_blacklisted
from app.dependencies.permissions import (
    build_logged_in_user_response,
    get_role_ids_with_permission,
    require_user_permission,
)
from app.models import (
    AuditLog,
    AuthLoginChallenge,
    OperationTask,
    PasswordResetRequest,
    Permission,
    Role,
    RolePermission,
    TokenBlacklist,
    User,
    UserRole,
)
from app.schemas import (
    AdminResetPasswordRequest,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    LogoutRequest,
    RefreshTokenRequest,
    TwoFADisableRequest,
    TwoFARegenerateBackupCodesRequest,
    TwoFASetupStartRequest,
    TwoFASetupVerifyRequest,
    TwoFAVerifyRequest,
)
from app.services.audit_service import create_audit_log
from app.services.user_security_service import (
    INDEFINITE_LOCK_UNTIL,
    apply_password_reset,
    clear_two_factor,
    close_password_reset_requests,
    create_password_reset_task,
    ensure_target_can_be_administered,
    get_user_or_404,
)
from app.utils.helpers import clean_optional_text, normalize_yes_no
from app.utils.password_policy import (
    build_security_flags,
    password_change_required,
    password_policy_rules,
    remember_password_hash,
    validate_password_policy,
)
from app.utils.security import (
    decrypt_security_value,
    encrypt_security_value,
    generate_security_stamp,
    hash_password,
    verify_password,
)
from app.utils.time import to_utc_naive, utcnow
from app.utils.totp import (
    BACKUP_CODE_COUNT,
    build_provisioning_uri,
    build_totp_qr_data_url,
    count_backup_codes,
    create_login_challenge,
    generate_backup_codes,
    hash_backup_codes,
    setup_is_expired,
    verify_totp_code,
    verify_totp_or_backup_code,
)
from app.utils.jwt import create_access_token, create_refresh_token, decode_refresh_token

router = APIRouter(prefix="/auth", tags=["Authentication"])

FORGOT_PASSWORD_WINDOW = timedelta(minutes=15)
FORGOT_PASSWORD_MAX_PER_WINDOW = 10


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def generate_password_reset_request_number(db: Session) -> str:
    """Collision-safe ``PWR-YYYYMMDD-NNNN`` request number."""
    prefix = f"PWR-{utcnow().strftime('%Y%m%d')}"
    last = (
        db.query(PasswordResetRequest.request_number)
        .filter(PasswordResetRequest.request_number.ilike(f"{prefix}-%"))
        .order_by(PasswordResetRequest.request_number.desc())
        .first()
    )
    next_number = 1
    if last and last[0]:
        try:
            next_number = int(str(last[0]).rsplit("-", 1)[1]) + 1
        except (IndexError, ValueError):
            next_number = 1
    return f"{prefix}-{next_number:04d}"


def _client_ip(request: Request) -> str | None:
    # Respect the reverse proxy header when present; fall back to socket data.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _user_agent(request: Request) -> str | None:
    return (request.headers.get("user-agent") or "")[:500] or None


def _ensure_security_stamp(user: User) -> str:
    if not user.security_stamp:
        user.security_stamp = generate_security_stamp()
    return user.security_stamp


def _build_token_pair(user: User) -> tuple[str, str]:
    stamp = _ensure_security_stamp(user)
    payload = {"user_id": user.id, "username": user.username, "stamp": stamp}
    return create_access_token(payload), create_refresh_token(payload)


def _build_auth_response(user: User, db: Session, message: str = "Login successful") -> dict:
    logged_in_user = build_logged_in_user_response(user, db)
    access_token, refresh_token = _build_token_pair(user)
    return {
        "message": message,
        "requires_2fa": False,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": logged_in_user,
        "role": logged_in_user["role"],
        "roles": logged_in_user["roles"],
        "permissions": logged_in_user["permissions"],
        "security": logged_in_user["security"],
    }


def _record_failed_password_attempt(db: Session, user: User, request: Request) -> None:
    user.failed_login_count = int(user.failed_login_count or 0) + 1
    locked_now = False
    if user.failed_login_count >= MAX_FAILED_LOGIN_ATTEMPTS:
        user.locked_until = utcnow() + timedelta(minutes=ACCOUNT_LOCKOUT_MINUTES)
        user.locked_reason = (
            f"Automatically locked after {user.failed_login_count} failed sign-in attempts"
        )
        user.locked_by_user_id = None
        locked_now = True

    create_audit_log(
        db=db,
        module_name="Authentication",
        action="Login Failed",
        current_user=user,
        entity_type="User",
        entity_id=user.id,
        entity_label=f"{user.full_name} ({user.username})" if user.full_name else user.username,
        remarks="Invalid password",
        request_path="/auth/login",
        details={
            "username": user.username,
            "failed_login_count": user.failed_login_count,
            "account_locked": locked_now,
        },
    )
    if locked_now:
        create_audit_log(
            db=db,
            module_name="User Security",
            action="Account Locked",
            current_user=user,
            entity_type="User",
            entity_id=user.id,
            entity_label=f"{user.full_name} ({user.username})" if user.full_name else user.username,
            remarks=user.locked_reason,
            request_path="/auth/login",
            details={
                "username": user.username,
                "locked_until": to_utc_naive(user.locked_until).isoformat(),
                "failed_login_count": user.failed_login_count,
                "automatic": True,
            },
        )


def _clear_expired_lock(user: User) -> bool:
    """Release a timed automatic lock that has expired. Returns True if cleared."""
    locked_until = to_utc_naive(user.locked_until)
    if locked_until is None or locked_until > utcnow():
        return False
    # An indefinitely locked account is never released automatically.
    if locked_until >= INDEFINITE_LOCK_UNTIL - timedelta(days=1):
        return False
    user.locked_until = None
    user.locked_reason = None
    user.locked_by_user_id = None
    user.failed_login_count = 0
    return True


def _require_self_service_permission(
    user: User,
    db: Session,
    *,
    forced_password_change: bool = False,
    forced_2fa_enrollment: bool = False,
) -> None:
    """Allow the mandatory remediation flows even if a role forgot the
    self-service permission.

    Otherwise an administrator could reset a password / force 2FA for a user
    whose role lacks "Edit Own Security Settings" and strand the account.
    """
    if forced_password_change and password_change_required(user):
        return
    if forced_2fa_enrollment:
        from app.utils.helpers import normalize_yes_no as _normalize

        if _normalize(getattr(user, "force_2fa", "No")) == "Yes" and _normalize(
            getattr(user, "totp_enabled", "No")
        ) != "Yes":
            return
    require_user_permission(user, "Edit Own Security Settings", db)


def _lock_minutes_remaining(user: User) -> int:
    locked_until = to_utc_naive(user.locked_until)
    if not locked_until:
        return 0
    return max(1, int((locked_until - utcnow()).total_seconds() // 60) + 1)


# ---------------------------------------------------------------------------
# Login / session
# ---------------------------------------------------------------------------

@router.post("/login")
def login_user(
    login_request: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    client_ip = _client_ip(request)
    username = str(login_request.username or "").strip()

    if username == "":
        raise HTTPException(status_code=400, detail="Username is required")
    if str(login_request.password or "").strip() == "":
        raise HTTPException(status_code=400, detail="Password is required")

    user = db.query(User).filter(User.username.ilike(username)).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    if str(user.status or "").strip().lower() != "active":
        raise HTTPException(
            status_code=403,
            detail="This account is disabled. Contact an administrator.",
        )

    _clear_expired_lock(user)

    if user.locked_until:
        create_audit_log(
            db=db,
            module_name="Authentication",
            action="Login Blocked",
            current_user=user,
            entity_type="User",
            entity_id=user.id,
            entity_label=f"{user.full_name} ({user.username})" if user.full_name else user.username,
            remarks="User account locked",
            request_path="/auth/login",
            details={
                "username": user.username,
                "locked_until": to_utc_naive(user.locked_until).isoformat(),
                "locked_reason": user.locked_reason,
            },
        )
        db.commit()
        locked_until = to_utc_naive(user.locked_until)
        if locked_until and locked_until >= INDEFINITE_LOCK_UNTIL - timedelta(days=1):
            detail = (
                "This account has been locked by an administrator. "
                "Contact an administrator to have it unlocked."
            )
        else:
            minutes = _lock_minutes_remaining(user)
            detail = (
                "Account is temporarily locked. "
                f"Try again in about {minutes} minute{'s' if minutes != 1 else ''} "
                "or ask an administrator to unlock it."
            )
        raise HTTPException(status_code=423, detail=detail)

    if not verify_password(login_request.password, user.password_hash):
        _record_failed_password_attempt(db, user, request)
        db.commit()
        remaining = max(0, MAX_FAILED_LOGIN_ATTEMPTS - int(user.failed_login_count or 0))
        detail = "Invalid username or password"
        if user.locked_until:
            detail = (
                "Invalid username or password. The account is now locked for "
                f"{ACCOUNT_LOCKOUT_MINUTES} minutes."
            )
        elif 0 < remaining <= 2:
            detail = f"Invalid username or password. {remaining} attempt{'s' if remaining != 1 else ''} remaining."
        raise HTTPException(status_code=401, detail=detail)

    user.failed_login_count = 0
    user.locked_until = None
    user.locked_reason = None
    user.locked_by_user_id = None
    _ensure_security_stamp(user)

    if normalize_yes_no(user.totp_enabled) == "Yes":
        challenge = create_login_challenge(db, user, client_ip, _user_agent(request))
        create_audit_log(
            db=db,
            module_name="Authentication",
            action="Login 2FA Required",
            current_user=user,
            entity_type="User",
            entity_id=user.id,
            entity_label=f"{user.full_name} ({user.username})" if user.full_name else user.username,
            remarks="Password verified; waiting for 2FA verification",
            request_path="/auth/login",
            details={"challenge_id": challenge.challenge_id, "ip_address": client_ip},
        )
        db.commit()
        return {
            "message": "Two-factor authentication required",
            "requires_2fa": True,
            "challenge_id": challenge.challenge_id,
            "expires_in_seconds": 300,
            "user_hint": {
                "full_name": user.full_name,
                "username": user.username,
            },
        }

    user.last_login_at = utcnow()
    user.last_login_ip = client_ip
    create_audit_log(
        db=db,
        module_name="Authentication",
        action="Login Success",
        current_user=user,
        entity_type="User",
        entity_id=user.id,
        entity_label=f"{user.full_name} ({user.username})" if user.full_name else user.username,
        remarks="User login successful",
        request_path="/auth/login",
        details={"username": user.username, "user_status": user.status, "ip_address": client_ip},
    )
    db.commit()
    return _build_auth_response(user, db)


@router.post("/2fa/verify")
def verify_login_2fa(
    verify_request: TwoFAVerifyRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    client_ip = _client_ip(request)
    challenge = (
        db.query(AuthLoginChallenge)
        .filter(AuthLoginChallenge.challenge_id == str(verify_request.challenge_id or "").strip())
        .first()
    )
    if not challenge or challenge.status != "Pending":
        raise HTTPException(status_code=401, detail="Invalid or expired 2FA challenge")

    expires_at = to_utc_naive(challenge.expires_at)
    if expires_at is None or expires_at < utcnow():
        challenge.status = "Expired"
        db.commit()
        raise HTTPException(status_code=401, detail="The 2FA challenge has expired. Please sign in again.")

    attempts = int(challenge.attempt_count or 0)
    if attempts >= MAX_2FA_ATTEMPTS:
        challenge.status = "Locked"
        db.commit()
        raise HTTPException(
            status_code=401,
            detail="Too many invalid authentication codes. Please sign in again.",
        )

    user = db.query(User).filter(User.id == challenge.user_id).first()
    if not user or str(user.status or "").strip().lower() != "active":
        raise HTTPException(status_code=401, detail="Invalid 2FA challenge")

    if user.locked_until and to_utc_naive(user.locked_until) > utcnow():
        challenge.status = "Superseded"
        db.commit()
        raise HTTPException(status_code=423, detail="Account is locked. Contact an administrator.")

    if not verify_totp_or_backup_code(user, verify_request.code):
        challenge.attempt_count = attempts + 1
        challenge.last_attempt_at = utcnow()
        user.failed_login_count = int(user.failed_login_count or 0) + 1

        if challenge.attempt_count >= MAX_2FA_ATTEMPTS:
            challenge.status = "Locked"
        if user.failed_login_count >= MAX_FAILED_LOGIN_ATTEMPTS:
            user.locked_until = utcnow() + timedelta(minutes=ACCOUNT_LOCKOUT_MINUTES)
            user.locked_reason = (
                f"Automatically locked after {user.failed_login_count} failed authentication attempts"
            )
            user.locked_by_user_id = None
            challenge.status = "Locked"
            create_audit_log(
                db=db,
                module_name="User Security",
                action="Account Locked",
                current_user=user,
                entity_type="User",
                entity_id=user.id,
                entity_label=f"{user.full_name} ({user.username})" if user.full_name else user.username,
                remarks=user.locked_reason,
                request_path="/auth/2fa/verify",
                details={
                    "automatic": True,
                    "locked_until": to_utc_naive(user.locked_until).isoformat(),
                    "failed_login_count": user.failed_login_count,
                },
            )

        create_audit_log(
            db=db,
            module_name="Authentication",
            action="2FA Failed",
            current_user=user,
            entity_type="User",
            entity_id=user.id,
            entity_label=f"{user.full_name} ({user.username})" if user.full_name else user.username,
            remarks="Invalid 2FA code",
            request_path="/auth/2fa/verify",
            details={
                "challenge_id": challenge.challenge_id,
                "attempt_count": challenge.attempt_count,
            },
        )
        db.commit()
        remaining = max(0, MAX_2FA_ATTEMPTS - challenge.attempt_count)
        detail = "Invalid authentication code"
        if remaining:
            detail += f". {remaining} attempt{'s' if remaining != 1 else ''} remaining."
        raise HTTPException(status_code=401, detail=detail)

    challenge.status = "Verified"
    challenge.verified_at = utcnow()
    challenge.attempt_count = attempts + 1
    user.last_login_at = utcnow()
    user.last_login_ip = client_ip
    user.failed_login_count = 0
    user.locked_until = None
    user.locked_reason = None
    user.locked_by_user_id = None

    create_audit_log(
        db=db,
        module_name="Authentication",
        action="2FA Success",
        current_user=user,
        entity_type="User",
        entity_id=user.id,
        entity_label=f"{user.full_name} ({user.username})" if user.full_name else user.username,
        remarks="2FA verification successful",
        request_path="/auth/2fa/verify",
        details={
            "challenge_id": challenge.challenge_id,
            "backup_codes_remaining": count_backup_codes(user),
        },
    )
    db.commit()
    return _build_auth_response(user, db)


@router.get("/me")
def get_logged_in_user(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    logged_in_user = build_logged_in_user_response(current_user, db)
    return {
        "user": logged_in_user,
        "role": logged_in_user["role"],
        "roles": logged_in_user["roles"],
        "permissions": logged_in_user["permissions"],
        "security": logged_in_user["security"],
    }


@router.get("/password-policy")
def get_password_policy(
    current_user: User = Depends(get_current_user_from_token),
):
    return password_policy_rules()


@router.get("/me/rbac-diagnostics")
def get_rbac_diagnostics(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Return the current user's effective RBAC state for self-service support."""
    from sqlalchemy import func

    from app.dependencies.permissions import (
        get_user_location_codes,
        get_user_permissions,
        is_super_admin,
    )

    role_rows = (
        db.query(UserRole, Role)
        .join(Role, Role.id == UserRole.role_id)
        .filter(UserRole.user_id == current_user.id)
        .order_by(Role.role_name, Role.id)
        .all()
    )
    role_details = []
    for assignment, role in role_rows:
        active_permission_count = (
            db.query(func.count(RolePermission.id))
            .join(Permission, Permission.id == RolePermission.permission_id)
            .filter(
                RolePermission.role_id == role.id,
                Permission.status == "Active",
            )
            .scalar()
            or 0
        )
        role_details.append({
            "assignment_id": assignment.id,
            "role_id": role.id,
            "role_name": role.role_name,
            "status": role.status,
            "active_permission_count": active_permission_count,
        })

    granted_permissions = sorted(get_user_permissions(current_user, db))
    allowed_locations = get_user_location_codes(current_user, db)
    unrestricted_locations = allowed_locations is None
    return {
        "user_id": current_user.id,
        "username": current_user.username,
        "full_name": current_user.full_name,
        "is_super_admin": is_super_admin(current_user, db),
        "assigned_roles": role_details,
        "active_role_count": sum(1 for role in role_details if role["status"] == "Active"),
        "granted_permission_count": len(granted_permissions),
        "granted_permissions": granted_permissions,
        "assigned_location_codes": sorted(allowed_locations or set()),
        "location_count": None if unrestricted_locations else len(allowed_locations or set()),
        "all_locations_access": unrestricted_locations,
    }


# ---------------------------------------------------------------------------
# Self-service password / 2FA
# ---------------------------------------------------------------------------

@router.post("/change-password")
def change_own_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    _require_self_service_permission(current_user, db, forced_password_change=True)

    if not verify_password(payload.current_password, current_user.password_hash):
        create_audit_log(
            db=db,
            module_name="User Security",
            action="Change Own Password Failed",
            current_user=current_user,
            entity_type="User",
            entity_id=current_user.id,
            entity_label=f"{current_user.full_name} ({current_user.username})",
            remarks="Current password verification failed",
            request_path="/auth/change-password",
        )
        db.commit()
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="New password and confirmation do not match")

    validate_password_policy(
        payload.new_password,
        current_password=payload.current_password,
        user=current_user,
    )

    remember_password_hash(current_user, current_user.password_hash)
    current_user.password_hash = hash_password(payload.new_password)
    current_user.password_changed_at = utcnow()
    current_user.force_password_change = "No"
    current_user.failed_login_count = 0
    current_user.locked_until = None
    current_user.locked_reason = None
    current_user.locked_by_user_id = None
    current_user.security_stamp = generate_security_stamp()
    current_user.updated_at = utcnow()

    create_audit_log(
        db=db,
        module_name="User Security",
        action="Change Own Password",
        current_user=current_user,
        entity_type="User",
        entity_id=current_user.id,
        entity_label=f"{current_user.full_name} ({current_user.username})",
        remarks="User changed own password",
        request_path="/auth/change-password",
        details={"password_changed": True, "sessions_revoked": True},
    )
    db.commit()

    # Re-issue tokens carrying the new security stamp so the browser that
    # performed the change stays signed in while every other session is
    # revoked immediately.
    response = _build_auth_response(current_user, db, message="Password changed successfully")
    return response


@router.post("/forgot-password")
def request_password_reset_with_rate_limit(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    client_ip = _client_ip(request) or "unknown"
    cutoff = utcnow() - FORGOT_PASSWORD_WINDOW
    recent_count = (
        db.query(PasswordResetRequest)
        .filter(
            PasswordResetRequest.requested_by_ip == client_ip,
            PasswordResetRequest.requested_at >= cutoff,
        )
        .count()
    )
    if recent_count >= FORGOT_PASSWORD_MAX_PER_WINDOW:
        raise HTTPException(
            status_code=429,
            detail="Too many password reset requests. Please try again later.",
        )

    username = str(payload.username or "").strip()
    if username == "":
        raise HTTPException(status_code=400, detail="Username is required")

    generic_message = {
        "message": "If the account exists, a reset request has been submitted to the administrators."
    }

    user = db.query(User).filter(User.username.ilike(username)).first()
    if not user or str(user.status or "").strip().lower() != "active":
        return generic_message

    existing = (
        db.query(PasswordResetRequest)
        .filter(
            PasswordResetRequest.user_id == user.id,
            PasswordResetRequest.status == "Pending",
        )
        .first()
    )
    if existing:
        return generic_message

    reset_request = PasswordResetRequest(
        request_number=generate_password_reset_request_number(db),
        user_id=user.id,
        username=user.username,
        status="Pending",
        reason=clean_optional_text(payload.reason),
        reset_2fa="Yes" if payload.reset_2fa else "No",
        requested_by_ip=client_ip,
        requested_at=utcnow(),
    )
    db.add(reset_request)
    db.flush()

    task = create_password_reset_task(db, reset_request, requested_by=user)

    create_audit_log(
        db=db,
        module_name="User Security",
        action="Request Password Reset",
        current_user=user,
        entity_type="PasswordResetRequest",
        entity_id=reset_request.id,
        entity_label=reset_request.request_number,
        remarks="Password reset requested",
        request_path="/auth/forgot-password",
        details={
            "username": user.username,
            "target_user_id": user.id,
            "reset_2fa": reset_request.reset_2fa,
            "task_id": task.id,
            "ip_address": client_ip,
        },
    )
    db.commit()
    return generic_message


@router.get("/my/reset-requests")
def list_my_password_reset_requests(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    requests = (
        db.query(PasswordResetRequest)
        .filter(PasswordResetRequest.user_id == current_user.id)
        .order_by(PasswordResetRequest.requested_at.desc(), PasswordResetRequest.id.desc())
        .limit(25)
        .all()
    )
    return {
        "items": [
            {
                "id": row.id,
                "request_number": row.request_number,
                "status": row.status,
                "reason": row.reason,
                "reset_2fa": row.reset_2fa,
                "requested_at": row.requested_at,
                "acted_at": row.acted_at,
                "action_notes": row.action_notes,
            }
            for row in requests
        ]
    }


@router.post("/my/reset-requests/{request_id}/cancel")
def cancel_my_password_reset_request(
    request_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    from app.services.transaction_helpers import add_operation_task_event

    reset_request = (
        db.query(PasswordResetRequest)
        .filter(
            PasswordResetRequest.id == request_id,
            PasswordResetRequest.user_id == current_user.id,
        )
        .first()
    )
    if not reset_request:
        raise HTTPException(status_code=404, detail="Password reset request not found")
    if str(reset_request.status or "").strip().lower() != "pending":
        raise HTTPException(status_code=409, detail="Only a pending request can be cancelled")

    reset_request.status = "Cancelled"
    reset_request.acted_by_user_id = current_user.id
    reset_request.acted_at = utcnow()
    reset_request.action_notes = "Cancelled by the requesting user"

    if reset_request.task_id:
        task = db.query(OperationTask).filter(OperationTask.id == reset_request.task_id).first()
        if task and task.status in ["Pending", "In Progress"]:
            old_status = task.status
            task.status = "Closed"
            task.acted_by_user_id = current_user.id
            task.acted_at = utcnow()
            task.action_taken = "Password Reset Cancelled"
            task.remarks = reset_request.action_notes
            task.updated_at = utcnow()
            add_operation_task_event(
                db=db,
                task=task,
                event_type="Password Reset Cancelled",
                current_user=current_user,
                old_status=old_status,
                new_status=task.status,
                notes=reset_request.action_notes,
                details={"password_reset_request_id": reset_request.id},
            )

    create_audit_log(
        db=db,
        module_name="User Security",
        action="Cancel Password Reset Request",
        current_user=current_user,
        entity_type="PasswordResetRequest",
        entity_id=reset_request.id,
        entity_label=reset_request.request_number,
        old_status="Pending",
        new_status="Cancelled",
        remarks=reset_request.action_notes,
        request_path=f"/auth/my/reset-requests/{request_id}/cancel",
    )
    db.commit()
    return {"message": "Password reset request cancelled"}


@router.get("/my/security-activity")
def list_my_security_activity(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(AuditLog)
        .filter(
            AuditLog.entity_id == current_user.id,
            or_(
                AuditLog.module_name == "User Security",
                AuditLog.module_name == "Authentication",
            ),
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(30)
        .all()
    )
    return {
        "items": [
            {
                "id": row.id,
                "action": row.action,
                "module_name": row.module_name,
                "remarks": row.remarks,
                "performed_by": row.performed_by,
                "created_at": row.created_at,
                "details": row.details,
            }
            for row in rows
        ]
    }


@router.post("/logout")
def logout_user(
    payload: LogoutRequest | None = None,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    from app.utils.jwt import decode_access_token

    tokens_to_revoke: list[tuple[str, datetime]] = []
    if authorization and authorization.startswith("Bearer "):
        access_token = authorization[7:].strip()
        try:
            decoded_access = decode_access_token(access_token)
            if decoded_access.get("token_type") == "access" and decoded_access.get("exp"):
                tokens_to_revoke.append(
                    (access_token, to_utc_naive(datetime.fromtimestamp(decoded_access["exp"], tz=timezone.utc)))
                )
        except Exception:
            # Logout is best-effort for an expired or malformed access token.
            pass

    refresh_token = str(payload.refresh_token or "").strip() if payload else ""
    if refresh_token:
        try:
            decoded_refresh = decode_refresh_token(refresh_token)
            if decoded_refresh.get("exp"):
                tokens_to_revoke.append(
                    (refresh_token, to_utc_naive(datetime.fromtimestamp(decoded_refresh["exp"], tz=timezone.utc)))
                )
        except Exception:
            pass

    try:
        for token, expires_at in tokens_to_revoke:
            if not is_token_blacklisted(token, db):
                db.add(TokenBlacklist(token_hash=hash_token(token), expires_at=expires_at))
        db.commit()
    except Exception:
        # Best-effort: don't fail logout if blacklist write fails.
        db.rollback()

    return {"message": "Logged out successfully"}


@router.post("/cleanup-blacklist")
def cleanup_token_blacklist(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit System Settings", db)
    deleted = (
        db.query(TokenBlacklist)
        .filter(TokenBlacklist.expires_at <= utcnow())
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"message": f"Cleaned up {deleted} expired token blacklist entries"}


@router.post("/refresh")
def refresh_access_token(
    payload: RefreshTokenRequest,
    db: Session = Depends(get_db),
):
    refresh_token_str = payload.refresh_token
    if not refresh_token_str:
        raise HTTPException(status_code=400, detail="Refresh token is required")

    if is_token_blacklisted(refresh_token_str, db):
        raise HTTPException(status_code=401, detail="Refresh token has been revoked")

    decoded = decode_refresh_token(refresh_token_str)
    user_id = decoded.get("user_id")

    user = db.query(User).filter(User.id == user_id).first()
    if not user or str(user.status or "").strip().lower() != "active":
        raise HTTPException(status_code=401, detail="User not found or inactive")

    token_stamp = decoded.get("stamp")
    if token_stamp and user.security_stamp and token_stamp != user.security_stamp:
        raise HTTPException(
            status_code=401,
            detail="Session has been revoked. Please login again.",
        )

    access_token, new_refresh_token = _build_token_pair(user)

    refresh_expiry = decoded.get("exp")
    if refresh_expiry:
        db.add(
            TokenBlacklist(
                token_hash=hash_token(refresh_token_str),
                expires_at=to_utc_naive(datetime.fromtimestamp(refresh_expiry, tz=timezone.utc)),
            )
        )
        db.commit()

    return {
        "access_token": access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
    }


@router.post("/2fa/setup/start")
def start_2fa_setup(
    payload: TwoFASetupStartRequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    _require_self_service_permission(current_user, db, forced_2fa_enrollment=True)
    payload = payload or TwoFASetupStartRequest()

    is_reconfiguration = normalize_yes_no(current_user.totp_enabled) == "Yes"
    if is_reconfiguration:
        # Re-configuring an active authenticator is a sensitive operation: it
        # must not be possible with a stolen session alone, and starting setup
        # must never silently disable the existing 2FA.
        if not payload.current_password or not payload.code:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Two-factor authentication is already enabled. "
                    "Provide your current password and authentication code to reconfigure it."
                ),
            )
        if not verify_password(payload.current_password, current_user.password_hash):
            raise HTTPException(status_code=401, detail="Current password is incorrect")
        if not verify_totp_or_backup_code(current_user, payload.code):
            raise HTTPException(status_code=400, detail="Invalid authentication code")
        if normalize_yes_no(current_user.force_2fa) == "Yes" and payload.code.strip().isdigit():
            # A fresh TOTP code is fine; the check above already accepted it.
            pass

    import pyotp

    secret = pyotp.random_base32()
    current_user.pending_totp_secret_encrypted = encrypt_security_value(secret)
    current_user.totp_setup_started_at = utcnow()
    current_user.updated_at = utcnow()

    provisioning_uri = build_provisioning_uri(current_user, secret)
    create_audit_log(
        db=db,
        module_name="User Security",
        action="Start 2FA Setup",
        current_user=current_user,
        entity_type="User",
        entity_id=current_user.id,
        entity_label=f"{current_user.full_name} ({current_user.username})",
        remarks="2FA setup started",
        request_path="/auth/2fa/setup/start",
        details={"reconfiguration": is_reconfiguration, "totp_enabled": is_reconfiguration},
    )
    db.commit()
    return {
        "message": "2FA setup started",
        "qr_code_data_url": build_totp_qr_data_url(provisioning_uri),
        # The secret is shown only during enrolment so users can type it into
        # an authenticator when the QR code cannot be scanned.
        "manual_entry_code": secret,
        "issuer": "Hydrocarbon Accounting System",
        "account_name": current_user.username,
        "expires_in_minutes": TOTP_SETUP_TTL_MINUTES,
        "is_reconfiguration": is_reconfiguration,
    }


@router.post("/2fa/setup/verify")
def verify_2fa_setup(
    payload: TwoFASetupVerifyRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    _require_self_service_permission(current_user, db, forced_2fa_enrollment=True)

    secret = decrypt_security_value(current_user.pending_totp_secret_encrypted)
    if not secret:
        raise HTTPException(status_code=400, detail="2FA setup has not been started. Start setup again.")
    if setup_is_expired(current_user):
        current_user.pending_totp_secret_encrypted = None
        current_user.totp_setup_started_at = None
        db.commit()
        raise HTTPException(
            status_code=400,
            detail="2FA setup expired. Start setup again to get a new QR code.",
        )

    # Enrolment verification must not burn the current time step: the same
    # code may legitimately be used for the first sign-in moments later.
    if not verify_totp_code(secret, payload.code, user=current_user, mark_used=False):
        raise HTTPException(
            status_code=400,
            detail="Invalid authentication code. Check your authenticator app and try again.",
        )

    was_enabled = normalize_yes_no(current_user.totp_enabled) == "Yes"
    backup_codes = generate_backup_codes(BACKUP_CODE_COUNT)
    current_user.totp_secret_encrypted = current_user.pending_totp_secret_encrypted
    current_user.totp_enabled = "Yes"
    current_user.totp_confirmed_at = utcnow()
    current_user.backup_codes_hash_json = hash_backup_codes(backup_codes)
    current_user.pending_totp_secret_encrypted = None
    current_user.totp_setup_started_at = None
    current_user.updated_at = utcnow()

    create_audit_log(
        db=db,
        module_name="User Security",
        action="Enable 2FA" if not was_enabled else "Reconfigure 2FA",
        current_user=current_user,
        entity_type="User",
        entity_id=current_user.id,
        entity_label=f"{current_user.full_name} ({current_user.username})",
        remarks="2FA enabled" if not was_enabled else "Authenticator reconfigured",
        request_path="/auth/2fa/setup/verify",
        details={"backup_code_count": len(backup_codes), "was_enabled": was_enabled},
    )
    db.commit()
    return {
        "message": "2FA enabled successfully",
        "backup_codes": backup_codes,
        "backup_codes_remaining": len(backup_codes),
        "security": build_security_flags(current_user),
    }


@router.post("/2fa/backup-codes/regenerate")
def regenerate_2fa_backup_codes(
    payload: TwoFARegenerateBackupCodesRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit Own Security Settings", db)
    if normalize_yes_no(current_user.totp_enabled) != "Yes":
        raise HTTPException(status_code=400, detail="2FA is not enabled")

    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if not verify_totp_or_backup_code(current_user, payload.code):
        raise HTTPException(status_code=400, detail="Invalid authentication code")

    backup_codes = generate_backup_codes(BACKUP_CODE_COUNT)
    current_user.backup_codes_hash_json = hash_backup_codes(backup_codes)
    current_user.updated_at = utcnow()
    create_audit_log(
        db=db,
        module_name="User Security",
        action="Regenerate 2FA Backup Codes",
        current_user=current_user,
        entity_type="User",
        entity_id=current_user.id,
        entity_label=f"{current_user.full_name} ({current_user.username})",
        remarks="2FA backup codes regenerated",
        request_path="/auth/2fa/backup-codes/regenerate",
        details={"backup_code_count": len(backup_codes)},
    )
    db.commit()
    return {
        "message": "Backup codes regenerated",
        "backup_codes": backup_codes,
        "backup_codes_remaining": len(backup_codes),
    }


@router.post("/2fa/disable")
def disable_own_2fa(
    payload: TwoFADisableRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit Own Security Settings", db)
    if normalize_yes_no(current_user.force_2fa) == "Yes":
        raise HTTPException(
            status_code=400,
            detail="Two-factor authentication is mandatory for this account and cannot be disabled.",
        )
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if not verify_totp_or_backup_code(current_user, payload.code):
        raise HTTPException(status_code=400, detail="Invalid authentication code")

    clear_two_factor(current_user)
    # Revoke sessions: a user disabling 2FA after a compromise should not leave
    # the attacker's existing session alive. Fresh tokens keep this browser in.
    current_user.security_stamp = generate_security_stamp()
    current_user.updated_at = utcnow()
    create_audit_log(
        db=db,
        module_name="User Security",
        action="Disable 2FA",
        current_user=current_user,
        entity_type="User",
        entity_id=current_user.id,
        entity_label=f"{current_user.full_name} ({current_user.username})",
        remarks="2FA disabled",
        request_path="/auth/2fa/disable",
        details={"totp_enabled": False, "sessions_revoked": True},
    )
    db.commit()
    return _build_auth_response(current_user, db, message="2FA disabled successfully")


# ---------------------------------------------------------------------------
# Administrator reset (kept at the historical /auth path used by the UI)
# ---------------------------------------------------------------------------

@router.post("/users/{user_id}/security/reset-password")
def admin_reset_user_password(
    user_id: int,
    payload: AdminResetPasswordRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Reset User Password", db)
    if payload.reset_2fa:
        require_user_permission(current_user, "Reset User 2FA", db)

    target = get_user_or_404(db, user_id)
    ensure_target_can_be_administered(current_user, target, db)

    result = apply_password_reset(
        db,
        current_user,
        target,
        new_password=payload.new_password,
        generate_password=payload.generate_password,
        force_password_change=payload.force_password_change,
        reset_2fa=payload.reset_2fa,
        unlock_account=payload.unlock_account,
        remarks=payload.remarks,
        request_path=f"/auth/users/{user_id}/security/reset-password",
    )
    db.commit()
    return result
