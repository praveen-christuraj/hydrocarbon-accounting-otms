import hashlib
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import TokenBlacklist, User, AuthLoginChallenge, PasswordResetRequest, Role, UserRole, OperationTask
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
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.security import hash_password, verify_password, encrypt_security_value
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


router = APIRouter(prefix="/auth", tags=["Authentication"])


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

    if user.locked_until and user.locked_until > datetime.now(timezone.utc):
        create_audit_log(
            db=db,
            module_name="Authentication",
            action="Login Blocked",
            current_user=user,
            entity_type="User",
            entity_id=user.id,
            entity_label=f"{user.full_name} ({user.username})" if user.full_name else user.username,
            remarks="User account temporarily locked",
            request_path="/auth/login",
            details={"username": user.username, "locked_until": user.locked_until.isoformat()},
        )
        db.commit()
        raise HTTPException(status_code=423, detail="Account is temporarily locked. Please try again later.")

    if not verify_password(login_request.password, user.password_hash):
        user.failed_login_count = int(user.failed_login_count or 0) + 1
        if user.failed_login_count >= 5:
            user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=15)
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
            details={"username": user.username, "failed_login_count": user.failed_login_count},
        )
        db.commit()
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password",
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

    user.last_login_at = datetime.now(timezone.utc)
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
        details={
            "username": user.username,
            "user_status": user.status,
        },
    )
    db.commit()

    return {
        "message": "Login successful",
        "requires_2fa": False,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": logged_in_user,
        "role": logged_in_user["role"],
        "permissions": logged_in_user["permissions"],
    }


@router.post("/2fa/verify")
def verify_login_2fa(
    verify_request: TwoFAVerifyRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    client_ip = request.client.host if request.client else None
    challenge = (
        db.query(AuthLoginChallenge)
        .filter(AuthLoginChallenge.challenge_id == verify_request.challenge_id)
        .first()
    )
    if not challenge or challenge.status != "Pending" or challenge.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Invalid or expired 2FA challenge")

    user = db.query(User).filter(User.id == challenge.user_id).first()
    if not user or user.status != "Active":
        raise HTTPException(status_code=401, detail="Invalid 2FA challenge")

    if not verify_totp_or_backup_code(user, verify_request.code):
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
            details={"challenge_id": challenge.challenge_id},
        )
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid authentication code")

    challenge.status = "Verified"
    challenge.verified_at = datetime.now(timezone.utc)
    user.last_login_at = datetime.now(timezone.utc)
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

    return {
        "message": "Login successful",
        "requires_2fa": False,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": logged_in_user,
        "role": logged_in_user["role"],
        "permissions": logged_in_user["permissions"],
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
        "permissions": logged_in_user["permissions"],
    }


@router.post("/change-password")
def change_own_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Own Security Settings", db)
    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="New password and confirmation do not match")
    validate_password_policy(payload.new_password, payload.current_password)
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    current_user.password_hash = hash_password(payload.new_password)
    current_user.password_changed_at = datetime.now(timezone.utc)
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
    return {"message": "Password changed successfully"}


# Rate-limiting: track forgot-password requests per IP in last 15 minutes
FORGOT_PASSWORD_WINDOW = timedelta(minutes=15)
FORGOT_PASSWORD_MAX_PER_WINDOW = 3


def _check_forgot_password_rate_limit(request: Request, db: Session):
    client_ip = request.client.host if request.client else "unknown"
    cutoff = datetime.now(timezone.utc) - FORGOT_PASSWORD_WINDOW
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

    from app.utils.helpers import generate_operation_task_number
    from app.dependencies.permissions import get_role_ids_with_permission, add_operation_task_event

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
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    if not authorization or not authorization.startswith("Bearer "):
        # No valid token to revoke — still a successful logout client-side
        return {"message": "Logged out successfully"}

    token = authorization[7:].strip()
    try:
        from app.utils.jwt import decode_access_token
        payload = decode_access_token(token)
        expires_at = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)

        blacklisted = TokenBlacklist(
            token_hash=hash_token(token),
            expires_at=expires_at,
        )
        db.add(blacklisted)
        db.commit()
    except Exception:
        # Best-effort: don't fail logout if blacklist write fails
        db.rollback()

    return {"message": "Logged out successfully"}


# --- Cleanup old blacklisted tokens (runs once a day via a lightweight sweep) ---
@router.post("/cleanup-blacklist")
def cleanup_token_blacklist(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage System Settings", db)
    deleted = (
        db.query(TokenBlacklist)
        .filter(TokenBlacklist.expires_at <= datetime.now(timezone.utc))
        .delete()
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

    new_access_token = create_access_token(
        data={"user_id": user.id, "username": user.username},
    )
    new_refresh_token = create_refresh_token(
        data={"user_id": user.id, "username": user.username},
    )

    return {
        "access_token": new_access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
    }


@router.post("/2fa/setup/start")
def start_2fa_setup(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Own Security Settings", db)
    import pyotp
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
    }


@router.post("/2fa/setup/verify")
def verify_2fa_setup(
    payload: TwoFASetupVerifyRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Own Security Settings", db)
    from app.utils.security import decrypt_security_value
    secret = decrypt_security_value(current_user.totp_secret_encrypted)
    if not secret:
        raise HTTPException(status_code=400, detail="2FA setup has not been started")
    normalized = "".join(ch for ch in str(payload.code or "").strip() if ch.isdigit())
    if len(normalized) != 6 or not pyotp.TOTP(secret).verify(normalized, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid authentication code")

    backup_codes = generate_backup_codes()
    current_user.totp_enabled = "Yes"
    current_user.totp_confirmed_at = datetime.now(timezone.utc)
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
    require_user_permission(current_user, "Manage Own Security Settings", db)
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
    require_user_permission(current_user, "Manage Own Security Settings", db)
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
    validate_password_policy(payload.new_password)
    target.password_hash = hash_password(payload.new_password)
    target.password_changed_at = datetime.now(timezone.utc)
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
        reset_request.acted_at = datetime.now(timezone.utc)
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
                from app.dependencies.permissions import add_operation_task_event
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