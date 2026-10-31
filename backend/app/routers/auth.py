import hashlib
from datetime import datetime, timedelta, timezone

import pyotp
from fastapi import APIRouter, Cookie, Depends, HTTPException, Header, Query, Request, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    TokenBlacklist,
    User,
    AuthLoginChallenge,
    PasswordResetRequest,
    Role,
    Permission,
    RolePermission,
    UserRole,
    OperationTask,
)
from app.dependencies.auth import hash_token
from app.schemas import (
    LoginRequest,
    TwoFAVerifyRequest,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    AdminResetPasswordRequest,
    TwoFASetupVerifyRequest,
    TwoFADisableRequest,
    RefreshTokenRequest,
    LogoutRequest,
    DeclinePasswordResetRequest,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.security import hash_password, verify_password, encrypt_security_value
from app.utils.password_policy import build_security_flags, is_password_expired
from app.utils.totp import (
    generate_backup_codes,
    hash_backup_codes,
    verify_backup_code,
    verify_totp_or_backup_code,
    build_totp_qr_data_url,
    create_login_challenge,
)
from app.utils.jwt import create_access_token, create_refresh_token, decode_refresh_token
from app.utils.helpers import clean_optional_text, normalize_yes_no
from app.utils.password_policy import validate_password_policy
from app.config import (
    AUTH_COOKIE_NAME,
    AUTH_COOKIE_PATH,
    AUTH_COOKIE_SECURE,
    REFRESH_TOKEN_EXPIRE_DAYS,
)


router = APIRouter(prefix="/auth", tags=["Authentication"])


# ---------------------------------------------------------------------------
# Account lockout / 2FA brute-force policy (enterprise defaults)
# ---------------------------------------------------------------------------
MAX_FAILED_LOGIN_ATTEMPTS = 5
ACCOUNT_LOCK_MINUTES = 15
MAX_2FA_ATTEMPTS_PER_CHALLENGE = 5


def set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=refresh_token,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=AUTH_COOKIE_SECURE,
        samesite="strict",
        path=AUTH_COOKIE_PATH,
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        httponly=True,
        secure=AUTH_COOKIE_SECURE,
        samesite="strict",
        path=AUTH_COOKIE_PATH,
    )


def utc_now_naive() -> datetime:
    """Current UTC time as a naive datetime, matching the TIMESTAMP columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def as_naive_utc(value: datetime | None) -> datetime | None:
    """Normalize a possibly timezone-aware datetime to naive UTC for safe comparison."""
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def lock_remaining_minutes(locked_until: datetime | None) -> int:
    locked = as_naive_utc(locked_until)
    if not locked:
        return 0
    remaining = (locked - utc_now_naive()).total_seconds()
    return max(1, int(remaining // 60) + (1 if remaining % 60 else 0)) if remaining > 0 else 0


def user_entity_label(user: User) -> str:
    return f"{user.full_name} ({user.username})" if user.full_name else user.username


def ensure_actor_may_administer_target(current_user: User, target: User, db: Session):
    """Shared guard for all admin security actions on another user's account."""
    from app.dependencies.permissions import ensure_user_in_actor_location_scope, is_admin_user

    ensure_user_in_actor_location_scope(current_user, target, db)
    if is_admin_user(target, db) and not is_admin_user(current_user, db):
        raise HTTPException(
            status_code=403,
            detail="Only an administrator can manage an administrator account's security",
        )


def generate_password_reset_request_number(db: Session):
    today = datetime.now().strftime("%Y%m%d")
    prefix = f"PWR-{today}"
    count = db.query(PasswordResetRequest).filter(
        PasswordResetRequest.request_number.ilike(f"{prefix}%")
    ).count()
    return f"{prefix}-{count + 1:04d}"


@router.post("/login")
def login_user(
    login_request: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    client_ip = request.client.host if request.client else None
    username = login_request.username.strip()

    if username == "":
        raise HTTPException(
            status_code=400,
            detail="Username is required",
        )

    if login_request.password.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Password is required",
        )

    user = (
        db.query(User)
        .filter(User.username.ilike(username))
        .first()
    )

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password",
        )

    if user.status != "Active":
        raise HTTPException(
            status_code=403,
            detail="User is not Active",
        )

    if as_naive_utc(user.locked_until) and as_naive_utc(user.locked_until) > utc_now_naive():
        remaining = lock_remaining_minutes(user.locked_until)
        create_audit_log(
            db=db,
            module_name="Authentication",
            action="Login Blocked",
            current_user=user,
            entity_type="User",
            entity_id=user.id,
            entity_label=user_entity_label(user),
            remarks="User account temporarily locked",
            request_path="/auth/login",
            details={"username": user.username, "locked_until": user.locked_until.isoformat()},
        )
        db.commit()
        raise HTTPException(
            status_code=423,
            detail=(
                f"Account is temporarily locked after too many failed sign-in attempts. "
                f"Try again in about {remaining} minute(s) or contact an administrator to unlock it."
            ),
        )

    if not verify_password(login_request.password, user.password_hash):
        user.failed_login_count = int(user.failed_login_count or 0) + 1
        account_locked_now = user.failed_login_count >= MAX_FAILED_LOGIN_ATTEMPTS
        if account_locked_now:
            user.locked_until = utc_now_naive() + timedelta(minutes=ACCOUNT_LOCK_MINUTES)
        create_audit_log(
            db=db,
            module_name="Authentication",
            action="Account Locked" if account_locked_now else "Login Failed",
            current_user=user,
            entity_type="User",
            entity_id=user.id,
            entity_label=user_entity_label(user),
            remarks=(
                f"Account locked for {ACCOUNT_LOCK_MINUTES} minutes after "
                f"{user.failed_login_count} failed sign-in attempts"
                if account_locked_now
                else "Invalid password"
            ),
            request_path="/auth/login",
            details={
                "username": user.username,
                "failed_login_count": user.failed_login_count,
                "locked_until": user.locked_until.isoformat() if account_locked_now else None,
            },
        )
        db.commit()
        if account_locked_now:
            raise HTTPException(
                status_code=423,
                detail=(
                    f"Account locked for {ACCOUNT_LOCK_MINUTES} minutes after too many failed "
                    f"sign-in attempts. Contact an administrator if you need it unlocked sooner."
                ),
            )
        remaining_attempts = MAX_FAILED_LOGIN_ATTEMPTS - user.failed_login_count
        raise HTTPException(
            status_code=401,
            detail=(
                "Invalid username or password"
                + (
                    f". {remaining_attempts} attempt(s) remaining before the account is locked."
                    if remaining_attempts <= 2
                    else ""
                )
            ),
        )

    user.failed_login_count = 0
    user.locked_until = None

    if normalize_yes_no(getattr(user, "totp_enabled", "No")) == "Yes":
        challenge = create_login_challenge(db, user, client_ip)
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
            "user_hint": {
                "full_name": user.full_name,
                "username": user.username,
            },
        }

    from app.dependencies.permissions import build_logged_in_user_response
    logged_in_user = build_logged_in_user_response(user, db)

    access_token = create_access_token(
        data={
            "user_id": user.id,
            "username": user.username,
        }
    )
    refresh_token = create_refresh_token(
        data={
            "user_id": user.id,
            "username": user.username,
        }
    )
    set_refresh_cookie(response, refresh_token)

    user.last_login_at = utc_now_naive()
    user.last_login_ip = client_ip

    create_audit_log(
        db=db,
        module_name="Authentication",
        action="Login Success",
        current_user=user,
        entity_type="User",
        entity_id=user.id,
        entity_label=user_entity_label(user),
        remarks="User login successful",
        request_path="/auth/login",
        details={
            "username": user.username,
            "user_status": user.status,
        },
    )
    db.commit()

    security_flags = logged_in_user.get("security") or {}
    return {
        "message": "Login successful",
        "requires_2fa": False,
        "access_token": access_token,
        "token_type": "bearer",
        "user": logged_in_user,
        "role": logged_in_user["role"],
        "roles": logged_in_user["roles"],
        "permissions": logged_in_user["permissions"],
        "must_change_password": bool(
            security_flags.get("force_password_change") or security_flags.get("password_expired")
        ),
    }


@router.post("/2fa/verify")
def verify_login_2fa(
    verify_request: TwoFAVerifyRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    client_ip = request.client.host if request.client else None
    challenge = (
        db.query(AuthLoginChallenge)
        .filter(AuthLoginChallenge.challenge_id == verify_request.challenge_id)
        .first()
    )
    if (
        not challenge
        or challenge.status != "Pending"
        or as_naive_utc(challenge.expires_at) is None
        or as_naive_utc(challenge.expires_at) < utc_now_naive()
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired 2FA challenge. Please sign in again.",
        )

    user = db.query(User).filter(User.id == challenge.user_id).first()
    if not user or user.status != "Active":
        raise HTTPException(status_code=401, detail="Invalid 2FA challenge")

    if not verify_totp_or_backup_code(user, verify_request.code):
        challenge.attempt_count = int(getattr(challenge, "attempt_count", 0) or 0) + 1
        challenge_exhausted = challenge.attempt_count >= MAX_2FA_ATTEMPTS_PER_CHALLENGE
        if challenge_exhausted:
            challenge.status = "Expired"
        create_audit_log(
            db=db,
            module_name="Authentication",
            action="2FA Failed",
            current_user=user,
            entity_type="User",
            entity_id=user.id,
            entity_label=user_entity_label(user),
            remarks="Invalid 2FA code" + (" - challenge exhausted" if challenge_exhausted else ""),
            request_path="/auth/2fa/verify",
            details={
                "challenge_id": challenge.challenge_id,
                "attempt_count": challenge.attempt_count,
            },
        )
        db.commit()
        if challenge_exhausted:
            raise HTTPException(
                status_code=401,
                detail="Too many incorrect authentication codes. Please sign in again.",
            )
        raise HTTPException(status_code=401, detail="Invalid authentication code")

    challenge.status = "Verified"
    challenge.verified_at = utc_now_naive()
    user.last_login_at = utc_now_naive()
    user.last_login_ip = client_ip
    user.failed_login_count = 0
    user.locked_until = None

    from app.dependencies.permissions import build_logged_in_user_response
    logged_in_user = build_logged_in_user_response(user, db)
    access_token = create_access_token(
        data={
            "user_id": user.id,
            "username": user.username,
        }
    )
    refresh_token = create_refresh_token(
        data={
            "user_id": user.id,
            "username": user.username,
        }
    )
    set_refresh_cookie(response, refresh_token)

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
        details={"challenge_id": challenge.challenge_id},
    )
    db.commit()

    security_flags = logged_in_user.get("security") or {}
    return {
        "message": "Login successful",
        "requires_2fa": False,
        "access_token": access_token,
        "token_type": "bearer",
        "user": logged_in_user,
        "role": logged_in_user["role"],
        "roles": logged_in_user["roles"],
        "permissions": logged_in_user["permissions"],
        "must_change_password": bool(
            security_flags.get("force_password_change") or security_flags.get("password_expired")
        ),
    }


@router.get("/me")
def get_logged_in_user(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    from app.dependencies.permissions import build_logged_in_user_response
    logged_in_user = build_logged_in_user_response(current_user, db)

    return {
        "user": logged_in_user,
        "role": logged_in_user["role"],
        "roles": logged_in_user["roles"],
        "permissions": logged_in_user["permissions"],
    }


@router.get("/me/rbac-diagnostics")
def get_rbac_diagnostics(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Return elevated RBAC diagnostics for authorized support users."""
    require_user_permission(current_user, "Edit System Settings", db)
    from sqlalchemy import func
    from app.dependencies.permissions import (
        get_user_permissions,
        get_user_location_codes,
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


@router.post("/change-password")
def change_own_password(
    payload: ChangePasswordRequest,
    response: Response,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    # Changing your own password is an inherent right of every authenticated
    # account (identity is re-verified with the current password). It is NOT
    # gated behind "Edit Own Security Settings": new users are created with
    # force_password_change="Yes" before any role is assigned, and must be
    # able to satisfy that policy.
    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="New password and confirmation do not match")
    validate_password_policy(payload.new_password, payload.current_password, username=current_user.username)
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    current_user.password_hash = hash_password(payload.new_password)
    current_user.password_changed_at = utc_now_naive()
    current_user.force_password_change = "No"
    current_user.failed_login_count = 0
    current_user.locked_until = None
    current_user.updated_at = datetime.now()

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
        details={"password_changed": True},
    )
    db.commit()

    # Rotating the password invalidates every token issued before the change
    # (see get_current_user_from_token). Hand the caller a fresh token pair so
    # the current session continues without interruption.
    access_token = create_access_token(data={"user_id": current_user.id, "username": current_user.username})
    refresh_token = create_refresh_token(data={"user_id": current_user.id, "username": current_user.username})
    set_refresh_cookie(response, refresh_token)
    return {
        "message": "Password changed successfully",
        "access_token": access_token,
        "token_type": "bearer",
    }


# Rate-limiting: track forgot-password requests per IP in last 15 minutes
FORGOT_PASSWORD_WINDOW = timedelta(minutes=15)
FORGOT_PASSWORD_MAX_PER_WINDOW = 3


def _check_forgot_password_rate_limit(request: Request, db: Session):
    client_ip = request.client.host if request.client else "unknown"
    cutoff = utc_now_naive() - FORGOT_PASSWORD_WINDOW
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
    return client_ip


@router.post("/forgot-password")
def request_password_reset_with_rate_limit(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    client_ip = _check_forgot_password_rate_limit(request, db)
    username = str(payload.username or "").strip()
    if username == "":
        raise HTTPException(status_code=400, detail="Username is required")

    user = db.query(User).filter(User.username.ilike(username)).first()
    if not user or user.status != "Active":
        return {"message": "If the account exists, a reset request has been submitted"}

    existing = (
        db.query(PasswordResetRequest)
        .filter(
            PasswordResetRequest.user_id == user.id,
            PasswordResetRequest.status == "Pending",
        )
        .first()
    )
    if existing:
        return {"message": "If the account exists, a reset request has been submitted"}

    reset_request = PasswordResetRequest(
        request_number=generate_password_reset_request_number(db),
        user_id=user.id,
        username=user.username,
        status="Pending",
        reason=clean_optional_text(payload.reason),
        reset_2fa="Yes" if payload.reset_2fa else "No",
        requested_by_ip=client_ip,
    )
    db.add(reset_request)
    db.flush()

    from app.services.transaction_helpers import (
        add_operation_task_event,
        generate_operation_task_number,
    )
    from app.dependencies.permissions import get_role_ids_with_permission

    role_ids = get_role_ids_with_permission(db, "Reset User Password")
    task = OperationTask(
        task_number=generate_operation_task_number(db),
        task_type="PASSWORD_RESET_REQUEST",
        transaction_id=None,
        ticket_number=reset_request.request_number,
        operation_number=reset_request.request_number,
        raised_by_user_id=user.id,
        assigned_role_ids_json=role_ids,
        assigned_user_ids_json=[],
        status="Pending",
        priority="High",
        remarks=reset_request.reason,
    )
    db.add(task)
    db.flush()
    reset_request.task_id = task.id
    add_operation_task_event(
        db=db,
        task=task,
        event_type="Created",
        current_user=user,
        new_status="Pending",
        notes=reset_request.reason,
        details={"password_reset_request_id": reset_request.id, "reset_2fa": reset_request.reset_2fa},
    )
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
        details={"username": user.username, "reset_2fa": reset_request.reset_2fa, "task_id": task.id, "ip_address": client_ip},
    )
    db.commit()
    return {"message": "If the account exists, a reset request has been submitted"}


@router.post("/logout")
def logout_user(
    response: Response,
    payload: LogoutRequest | None = None,
    authorization: str | None = Header(default=None),
    refresh_cookie: str | None = Cookie(default=None, alias=AUTH_COOKIE_NAME),
    db: Session = Depends(get_db),
):
    from app.dependencies.auth import is_token_blacklisted
    from app.utils.jwt import decode_access_token

    tokens_to_revoke: list[tuple[str, datetime]] = []
    if authorization and authorization.startswith("Bearer "):
        access_token = authorization[7:].strip()
        try:
            decoded_access = decode_access_token(access_token)
            if decoded_access.get("token_type") == "access" and decoded_access.get("exp"):
                tokens_to_revoke.append(
                    (access_token, datetime.fromtimestamp(decoded_access["exp"], tz=timezone.utc))
                )
        except Exception:
            # Logout is best-effort for an expired or malformed access token.
            pass

    refresh_token = (
        str(payload.refresh_token or "").strip() if payload and payload.refresh_token else str(refresh_cookie or "").strip()
    )
    if refresh_token:
        try:
            decoded_refresh = decode_refresh_token(refresh_token)
            if decoded_refresh.get("exp"):
                tokens_to_revoke.append(
                    (refresh_token, datetime.fromtimestamp(decoded_refresh["exp"], tz=timezone.utc))
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

    clear_refresh_cookie(response)
    return {"message": "Logged out successfully"}


# --- Cleanup old blacklisted tokens (runs once a day via a lightweight sweep) ---
@router.post("/cleanup-blacklist")
def cleanup_token_blacklist(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit System Settings", db)
    deleted = (
        db.query(TokenBlacklist)
        .filter(TokenBlacklist.expires_at <= datetime.now(timezone.utc))
        .delete()
    )
    db.commit()
    return {"message": f"Cleaned up {deleted} expired token blacklist entries"}


@router.post("/refresh")
def refresh_access_token(
    response: Response,
    payload: RefreshTokenRequest | None = None,
    refresh_cookie: str | None = Cookie(default=None, alias=AUTH_COOKIE_NAME),
    db: Session = Depends(get_db),
):
    refresh_token_str = (
        str(payload.refresh_token or "").strip() if payload and payload.refresh_token else str(refresh_cookie or "").strip()
    )
    if not refresh_token_str:
        raise HTTPException(status_code=400, detail="Refresh token is required")

    # Check blacklist
    from app.dependencies.auth import is_token_blacklisted
    if is_token_blacklisted(refresh_token_str, db):
        raise HTTPException(status_code=401, detail="Refresh token has been revoked")

    decoded = decode_refresh_token(refresh_token_str)
    user_id = decoded.get("user_id")
    username = decoded.get("username")

    user = db.query(User).filter(User.id == user_id).first()
    if not user or user.status != "Active":
        raise HTTPException(status_code=401, detail="User not found or inactive")

    # A locked account must not silently keep its session alive via refresh.
    if as_naive_utc(user.locked_until) and as_naive_utc(user.locked_until) > utc_now_naive():
        raise HTTPException(status_code=401, detail="Account is temporarily locked")

    # Refresh tokens issued before the last password change are revoked
    # (administrator reset or user-initiated change ends old sessions).
    token_issued_at = decoded.get("iat")
    password_changed = as_naive_utc(user.password_changed_at)
    if token_issued_at is not None and password_changed is not None:
        changed_ts = password_changed.replace(tzinfo=timezone.utc).timestamp()
        if float(token_issued_at) + 60 < changed_ts:
            raise HTTPException(
                status_code=401,
                detail="Credentials changed since this session started. Please sign in again.",
            )

    new_access_token = create_access_token(
        data={"user_id": user.id, "username": user.username},
    )
    new_refresh_token = create_refresh_token(
        data={"user_id": user.id, "username": user.username},
    )
    set_refresh_cookie(response, new_refresh_token)

    refresh_expiry = decoded.get("exp")
    if refresh_expiry:
        db.add(
            TokenBlacklist(
                token_hash=hash_token(refresh_token_str),
                expires_at=datetime.fromtimestamp(refresh_expiry, tz=timezone.utc),
            )
        )
        db.commit()

    return {
        "access_token": new_access_token,
        "token_type": "bearer",
    }


@router.post("/2fa/setup/start")
def start_2fa_setup(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit Own Security Settings", db)
    secret = pyotp.random_base32()
    current_user.totp_secret_encrypted = encrypt_security_value(secret)
    current_user.totp_enabled = "No"
    current_user.updated_at = datetime.now()

    totp = pyotp.TOTP(secret)
    provisioning_uri = totp.provisioning_uri(
        name=current_user.username,
        issuer_name="Hydrocarbon Accounting System",
    )
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
        details={"totp_enabled": False},
    )
    db.commit()
    return {
        "message": "2FA setup started",
        "qr_code_data_url": build_totp_qr_data_url(provisioning_uri),
        # Secret for manual entry when the QR code cannot be scanned.
        "secret": secret,
        "issuer": "Hydrocarbon Accounting System",
        "account": current_user.username,
    }


@router.post("/2fa/setup/verify")
def verify_2fa_setup(
    payload: TwoFASetupVerifyRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit Own Security Settings", db)
    from app.utils.security import decrypt_security_value
    secret = decrypt_security_value(current_user.totp_secret_encrypted)
    if not secret:
        raise HTTPException(status_code=400, detail="2FA setup has not been started")
    normalized = "".join(ch for ch in str(payload.code or "").strip() if ch.isdigit())
    if len(normalized) != 6 or not pyotp.TOTP(secret).verify(normalized, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid authentication code")

    backup_codes = generate_backup_codes()
    current_user.totp_enabled = "Yes"
    current_user.totp_confirmed_at = utc_now_naive()
    current_user.backup_codes_hash_json = hash_backup_codes(backup_codes)
    current_user.updated_at = datetime.now()
    create_audit_log(
        db=db,
        module_name="User Security",
        action="Enable 2FA",
        current_user=current_user,
        entity_type="User",
        entity_id=current_user.id,
        entity_label=f"{current_user.full_name} ({current_user.username})",
        remarks="2FA enabled",
        request_path="/auth/2fa/setup/verify",
        details={"backup_code_count": len(backup_codes)},
    )
    db.commit()
    return {"message": "2FA enabled successfully", "backup_codes": backup_codes}


@router.post("/2fa/backup-codes/regenerate")
def regenerate_2fa_backup_codes(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit Own Security Settings", db)
    if normalize_yes_no(current_user.totp_enabled) != "Yes":
        raise HTTPException(status_code=400, detail="2FA is not enabled")
    backup_codes = generate_backup_codes()
    current_user.backup_codes_hash_json = hash_backup_codes(backup_codes)
    current_user.updated_at = datetime.now()
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
    return {"message": "Backup codes regenerated", "backup_codes": backup_codes}


@router.post("/2fa/disable")
def disable_own_2fa(
    payload: TwoFADisableRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit Own Security Settings", db)
    if normalize_yes_no(current_user.force_2fa) == "Yes":
        raise HTTPException(status_code=400, detail="2FA is mandatory for this account")
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if not verify_totp_or_backup_code(current_user, payload.code):
        raise HTTPException(status_code=400, detail="Invalid authentication code")
    current_user.totp_enabled = "No"
    current_user.totp_secret_encrypted = None
    current_user.totp_confirmed_at = None
    current_user.backup_codes_hash_json = None
    current_user.updated_at = datetime.now()
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
        details={"totp_enabled": False},
    )
    db.commit()
    return {"message": "2FA disabled successfully"}


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
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    ensure_actor_may_administer_target(current_user, target, db)
    validate_password_policy(payload.new_password, username=target.username)
    target.password_hash = hash_password(payload.new_password)
    target.password_changed_at = utc_now_naive()
    target.force_password_change = "Yes" if payload.force_password_change else "No"
    target.failed_login_count = 0
    target.locked_until = None
    if payload.reset_2fa:
        target.totp_enabled = "No"
        target.totp_secret_encrypted = None
        target.totp_confirmed_at = None
        target.backup_codes_hash_json = None
    target.updated_at = datetime.now()
    create_audit_log(
        db=db,
        module_name="User Security",
        action="Admin Reset User Password",
        current_user=current_user,
        entity_type="User",
        entity_id=target.id,
        entity_label=f"{target.full_name} ({target.username})",
        remarks=payload.remarks or "Password reset by administrator",
        request_path=f"/users/{user_id}/security/reset-password",
        details={
            "target_username": target.username,
            "force_password_change": target.force_password_change,
            "reset_2fa": payload.reset_2fa,
        },
    )

    pending_requests = (
        db.query(PasswordResetRequest)
        .filter(
            PasswordResetRequest.user_id == target.id,
            PasswordResetRequest.status == "Pending",
        )
        .all()
    )
    for reset_request in pending_requests:
        reset_request.status = "Completed"
        reset_request.acted_by_user_id = current_user.id
        reset_request.acted_at = utc_now_naive()
        reset_request.action_notes = payload.remarks or "Password reset completed by administrator"
        if reset_request.task_id:
            task = db.query(OperationTask).filter(OperationTask.id == reset_request.task_id).first()
            if task and task.status in ["Pending", "In Progress"]:
                old_status = task.status
                task.status = "Closed"
                task.acted_by_user_id = current_user.id
                task.acted_at = datetime.now()
                task.action_taken = "Password Reset Completed"
                task.remarks = reset_request.action_notes
                task.updated_at = datetime.now()
                from app.services.transaction_helpers import add_operation_task_event
                add_operation_task_event(
                    db=db,
                    task=task,
                    event_type="Password Reset Completed",
                    current_user=current_user,
                    old_status=old_status,
                    new_status=task.status,
                    notes=task.remarks,
                    details={"password_reset_request_id": reset_request.id},
                )
                create_audit_log(
                    db=db,
                    module_name="Operation Task",
                    action="Close Password Reset Task",
                    current_user=current_user,
                    entity_type="OperationTask",
                    entity_id=task.id,
                    entity_label=task.task_number,
                    old_status=old_status,
                    new_status=task.status,
                    remarks=task.remarks,
                    request_path=f"/users/{user_id}/security/reset-password",
                    details={"password_reset_request_id": reset_request.id, "target_user_id": target.id},
                )
    db.commit()
    return {"message": "Password reset successfully"}

# ---------------------------------------------------------------------------
# Enterprise security administration
# ---------------------------------------------------------------------------

def _serialize_user_security(user: User, pending_reset_count: int = 0) -> dict:
    """Security posture of one account, for the administrator console."""
    locked_until = as_naive_utc(user.locked_until)
    is_locked = bool(locked_until and locked_until > utc_now_naive())
    password_changed_at = as_naive_utc(user.password_changed_at)
    return {
        "id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "email": user.email,
        "department": user.department,
        "designation": user.designation,
        "status": user.status,
        "is_locked": is_locked,
        "locked_until": locked_until.isoformat() if is_locked else None,
        "failed_login_count": int(user.failed_login_count or 0),
        "totp_enabled": normalize_yes_no(getattr(user, "totp_enabled", "No")) == "Yes",
        "force_2fa": normalize_yes_no(getattr(user, "force_2fa", "No")) == "Yes",
        "force_password_change": normalize_yes_no(getattr(user, "force_password_change", "No")) == "Yes",
        "password_expired": is_password_expired(user),
        "password_changed_at": password_changed_at.isoformat() if password_changed_at else None,
        "password_never_expires": normalize_yes_no(getattr(user, "password_never_expires", "No")) == "Yes",
        "password_expiry_days": int(getattr(user, "password_expiry_days", 30) or 30),
        "last_login_at": as_naive_utc(user.last_login_at).isoformat() if user.last_login_at else None,
        "last_login_ip": user.last_login_ip,
        "pending_reset_requests": int(pending_reset_count or 0),
    }


@router.get("/users/security-overview")
def get_users_security_overview(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Account security posture of every user the actor may administer.

    Shows locked accounts, failed sign-in counters, 2FA status, password age
    and pending reset requests so an administrator can act from one place.
    """
    from app.dependencies.permissions import (
        get_user_location_codes,
        user_has_any_permission,
        user_is_within_actor_location_scope,
        is_admin_user,
    )

    if not is_admin_user(current_user, db) and not user_has_any_permission(
        current_user, ["Reset User Password", "Reset User 2FA"], db
    ):
        raise HTTPException(
            status_code=403,
            detail="Permission required: Reset User Password",
        )

    users = db.query(User).order_by(User.full_name, User.id).all()
    allowed_codes = get_user_location_codes(current_user, db)
    if allowed_codes is not None:
        users = [
            target
            for target in users
            if user_is_within_actor_location_scope(current_user, target, db)
        ]

    pending_counts: dict[int, int] = {}
    for row in (
        db.query(PasswordResetRequest.user_id, func.count(PasswordResetRequest.id))
        .filter(PasswordResetRequest.status == "Pending")
        .group_by(PasswordResetRequest.user_id)
        .all()
    ):
        pending_counts[row[0]] = row[1]

    items = [_serialize_user_security(user, pending_counts.get(user.id, 0)) for user in users]
    return {
        "items": items,
        "total": len(items),
        "locked_count": sum(1 for item in items if item["is_locked"]),
        "pending_reset_requests": sum(item["pending_reset_requests"] for item in items),
        "two_fa_enabled_count": sum(1 for item in items if item["totp_enabled"]),
    }


@router.post("/users/{user_id}/security/unlock")
def admin_unlock_user_account(
    user_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Clear a temporary lockout and the failed sign-in counter."""
    require_user_permission(current_user, "Reset User Password", db)
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    ensure_actor_may_administer_target(current_user, target, db)

    was_locked = bool(as_naive_utc(target.locked_until) and as_naive_utc(target.locked_until) > utc_now_naive())
    previous_failed = int(target.failed_login_count or 0)
    target.locked_until = None
    target.failed_login_count = 0
    target.updated_at = datetime.now()

    create_audit_log(
        db=db,
        module_name="User Security",
        action="Unlock User Account",
        current_user=current_user,
        entity_type="User",
        entity_id=target.id,
        entity_label=user_entity_label(target),
        remarks="Account unlocked by administrator",
        request_path=f"/auth/users/{user_id}/security/unlock",
        details={
            "target_username": target.username,
            "was_locked": was_locked,
            "previous_failed_login_count": previous_failed,
        },
    )
    db.commit()
    return {
        "message": f"Account for {target.username} unlocked successfully",
        "user": _serialize_user_security(target),
    }


@router.post("/users/{user_id}/security/reset-2fa")
def admin_reset_user_2fa(
    user_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Remove a user's 2FA enrolment (lost device) without touching the password."""
    require_user_permission(current_user, "Reset User 2FA", db)
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    ensure_actor_may_administer_target(current_user, target, db)
    if normalize_yes_no(getattr(target, "totp_enabled", "No")) != "Yes" and not target.totp_secret_encrypted:
        raise HTTPException(status_code=400, detail="2FA is not enabled for this user")

    target.totp_enabled = "No"
    target.totp_secret_encrypted = None
    target.totp_confirmed_at = None
    target.backup_codes_hash_json = None
    target.updated_at = datetime.now()

    create_audit_log(
        db=db,
        module_name="User Security",
        action="Admin Reset User 2FA",
        current_user=current_user,
        entity_type="User",
        entity_id=target.id,
        entity_label=user_entity_label(target),
        remarks="2FA reset by administrator",
        request_path=f"/auth/users/{user_id}/security/reset-2fa",
        details={"target_username": target.username},
    )
    db.commit()
    return {
        "message": f"2FA reset for {target.username}. The user can enrol again from Profile & Security.",
        "user": _serialize_user_security(target),
    }


@router.post("/users/{user_id}/security/require-password-change")
def admin_require_password_change(
    user_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Flag an account so the user must set a new password at next sign-in."""
    require_user_permission(current_user, "Reset User Password", db)
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    ensure_actor_may_administer_target(current_user, target, db)
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="Use Change Password to rotate your own password")

    target.force_password_change = "Yes"
    target.updated_at = datetime.now()
    create_audit_log(
        db=db,
        module_name="User Security",
        action="Require Password Change",
        current_user=current_user,
        entity_type="User",
        entity_id=target.id,
        entity_label=user_entity_label(target),
        remarks="User must change password at next sign-in",
        request_path=f"/auth/users/{user_id}/security/require-password-change",
        details={"target_username": target.username},
    )
    db.commit()
    return {
        "message": f"{target.username} must change their password at next sign-in",
        "user": _serialize_user_security(target),
    }


def _serialize_reset_request(reset_request: PasswordResetRequest, user: User | None) -> dict:
    return {
        "id": reset_request.id,
        "request_number": reset_request.request_number,
        "user_id": reset_request.user_id,
        "username": reset_request.username,
        "full_name": user.full_name if user else None,
        "user_status": user.status if user else None,
        "user_is_locked": bool(
            user
            and as_naive_utc(user.locked_until)
            and as_naive_utc(user.locked_until) > utc_now_naive()
        ),
        "status": reset_request.status,
        "reason": reset_request.reason,
        "reset_2fa": normalize_yes_no(reset_request.reset_2fa) == "Yes",
        "requested_at": as_naive_utc(reset_request.requested_at).isoformat() if reset_request.requested_at else None,
        "requested_by_ip": reset_request.requested_by_ip,
        "task_id": reset_request.task_id,
        "acted_by_user_id": reset_request.acted_by_user_id,
        "acted_at": as_naive_utc(reset_request.acted_at).isoformat() if reset_request.acted_at else None,
        "action_notes": reset_request.action_notes,
    }


@router.get("/password-reset-requests")
def list_password_reset_requests(
    status: str | None = Query(None),
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Queue of self-service password reset requests for administrators."""
    require_user_permission(current_user, "Reset User Password", db)
    from app.dependencies.permissions import (
        get_user_location_codes,
        user_is_within_actor_location_scope,
    )

    query = db.query(PasswordResetRequest, User).outerjoin(
        User, User.id == PasswordResetRequest.user_id
    )
    cleaned_status = clean_optional_text(status)
    if cleaned_status and cleaned_status.lower() != "all":
        query = query.filter(PasswordResetRequest.status.ilike(cleaned_status))
    rows = query.order_by(PasswordResetRequest.requested_at.desc(), PasswordResetRequest.id.desc()).all()

    allowed_codes = get_user_location_codes(current_user, db)
    items = []
    for reset_request, user in rows:
        if (
            allowed_codes is not None
            and user is not None
            and not user_is_within_actor_location_scope(current_user, user, db)
        ):
            continue
        items.append(_serialize_reset_request(reset_request, user))
    return {
        "items": items,
        "total": len(items),
        "pending_count": sum(1 for item in items if item["status"] == "Pending"),
    }


@router.post("/password-reset-requests/{request_id}/decline")
def decline_password_reset_request(
    request_id: int,
    payload: DeclinePasswordResetRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Close a pending reset request without changing the user's password."""
    require_user_permission(current_user, "Reset User Password", db)
    reset_request = (
        db.query(PasswordResetRequest).filter(PasswordResetRequest.id == request_id).first()
    )
    if not reset_request:
        raise HTTPException(status_code=404, detail="Password reset request not found")
    if reset_request.status != "Pending":
        raise HTTPException(status_code=400, detail="Only pending requests can be declined")

    target = db.query(User).filter(User.id == reset_request.user_id).first()
    if target:
        ensure_actor_may_administer_target(current_user, target, db)

    reset_request.status = "Declined"
    reset_request.acted_by_user_id = current_user.id
    reset_request.acted_at = utc_now_naive()
    reset_request.action_notes = clean_optional_text(payload.notes) or "Declined by administrator"

    if reset_request.task_id:
        task = db.query(OperationTask).filter(OperationTask.id == reset_request.task_id).first()
        if task and task.status in ["Pending", "In Progress"]:
            old_status = task.status
            task.status = "Closed"
            task.acted_by_user_id = current_user.id
            task.acted_at = datetime.now()
            task.action_taken = "Password Reset Declined"
            task.remarks = reset_request.action_notes
            task.updated_at = datetime.now()
            from app.services.transaction_helpers import add_operation_task_event

            add_operation_task_event(
                db=db,
                task=task,
                event_type="Password Reset Declined",
                current_user=current_user,
                old_status=old_status,
                new_status=task.status,
                notes=task.remarks,
                details={"password_reset_request_id": reset_request.id},
            )

    create_audit_log(
        db=db,
        module_name="User Security",
        action="Decline Password Reset Request",
        current_user=current_user,
        entity_type="PasswordResetRequest",
        entity_id=reset_request.id,
        entity_label=reset_request.request_number,
        remarks=reset_request.action_notes,
        request_path=f"/auth/password-reset-requests/{request_id}/decline",
        details={"target_username": reset_request.username},
    )
    db.commit()
    return {
        "message": f"Password reset request {reset_request.request_number} declined",
        "request": _serialize_reset_request(reset_request, target),
    }
