"""Shared account-security operations.

Every mutation lives here so the administrator console, the User Master reset
endpoint and the password-reset approval flow behave identically (policy,
password history, session revocation, audit trail and reset-task closure).
"""

from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.config import PASSWORD_HISTORY_COUNT
from app.dependencies.permissions import (
    ensure_user_in_actor_location_scope,
    is_admin_user,
)
from app.models import (
    AuthLoginChallenge,
    OperationTask,
    PasswordResetRequest,
    User,
)
from app.services.audit_service import create_audit_log
from app.services.transaction_helpers import (
    add_operation_task_event,
    generate_operation_task_number,
)
from app.utils.helpers import clean_optional_text
from app.utils.password_policy import (
    remember_password_hash,
    validate_password_policy,
)
from app.utils.security import (
    generate_secure_password,
    generate_security_stamp,
    hash_password,
)
from app.utils.time import utcnow

INDEFINITE_LOCK_UNTIL = datetime(9999, 12, 31, 23, 59, 59)


def get_user_or_404(db: Session, user_id: int) -> User:
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    return target


def ensure_target_can_be_administered(actor: User, target: User, db: Session) -> None:
    """Guard rails shared by every account-security action.

    * Restricted administrators only manage users inside their location scope.
    * Only a reserved Admin may reset/lock another Admin account.
    * Nobody may lock themselves out, reset their own password without knowing
      the current one, or revoke their own sessions through the console.
    """
    if target.id == actor.id:
        raise HTTPException(
            status_code=400,
            detail="Use Profile & Security to manage your own account",
        )
    if is_admin_user(target, db) and not is_admin_user(actor, db):
        raise HTTPException(
            status_code=403,
            detail="Only an administrator can manage an administrator account",
        )
    ensure_user_in_actor_location_scope(actor, target, db)


def close_password_reset_requests(
    db: Session,
    actor: User,
    target: User,
    *,
    primary_request: PasswordResetRequest | None = None,
    approved: bool = True,
    notes: str | None = None,
    request_path: str = "",
) -> None:
    """Close the approval task(s) tied to a user's password reset requests."""
    pending_requests = (
        db.query(PasswordResetRequest)
        .filter(
            PasswordResetRequest.user_id == target.id,
            PasswordResetRequest.status == "Pending",
        )
        .all()
    )

    for reset_request in pending_requests:
        is_primary = primary_request is not None and reset_request.id == primary_request.id
        if approved:
            reset_request.status = "Approved" if is_primary else "Cancelled"
        else:
            reset_request.status = "Rejected" if is_primary else "Cancelled"
        reset_request.acted_by_user_id = actor.id
        reset_request.acted_at = utcnow()
        reset_request.action_notes = notes

        if not reset_request.task_id:
            continue
        task = db.query(OperationTask).filter(OperationTask.id == reset_request.task_id).first()
        if not task or task.status not in ["Pending", "In Progress"]:
            continue

        old_status = task.status
        task.status = "Closed" if approved else "Rejected"
        task.acted_by_user_id = actor.id
        task.acted_at = utcnow()
        task.action_taken = "Password Reset Completed" if approved else "Password Reset Rejected"
        task.remarks = notes
        task.updated_at = utcnow()
        add_operation_task_event(
            db=db,
            task=task,
            event_type=task.action_taken,
            current_user=actor,
            old_status=old_status,
            new_status=task.status,
            notes=notes,
            details={"password_reset_request_id": reset_request.id, "target_user_id": target.id},
        )
        create_audit_log(
            db=db,
            module_name="Operation Task",
            action="Close Password Reset Task" if approved else "Reject Password Reset Task",
            current_user=actor,
            entity_type="OperationTask",
            entity_id=task.id,
            entity_label=task.task_number,
            old_status=old_status,
            new_status=task.status,
            remarks=notes,
            request_path=request_path,
            details={"password_reset_request_id": reset_request.id, "target_user_id": target.id},
        )


def apply_password_reset(
    db: Session,
    actor: User,
    target: User,
    *,
    new_password: str | None = None,
    generate_password: bool = False,
    force_password_change: bool = True,
    reset_2fa: bool = False,
    unlock_account: bool = True,
    remarks: str | None = None,
    request_path: str = "",
    primary_reset_request: PasswordResetRequest | None = None,
) -> dict:
    """Reset a target user's password and return the temporary password if generated."""
    if generate_password and new_password:
        raise HTTPException(
            status_code=400,
            detail="Choose either a generated password or a manually entered password, not both",
        )
    if not generate_password and not str(new_password or "").strip():
        raise HTTPException(status_code=400, detail="New password is required")

    generated_password = None
    if generate_password:
        generated_password = generate_secure_password(16)
        new_password = generated_password
    else:
        validate_password_policy(str(new_password), user=target)

    previous_hash = target.password_hash
    remember_password_hash(target, previous_hash)
    target.password_hash = hash_password(str(new_password))
    target.password_changed_at = utcnow()
    target.force_password_change = "Yes" if force_password_change else "No"
    target.security_stamp = generate_security_stamp()
    target.updated_at = utcnow()
    target.failed_login_count = 0
    if unlock_account:
        target.locked_until = None
        target.locked_reason = None
        target.locked_by_user_id = None

    if reset_2fa:
        clear_two_factor(target)
        # Any in-flight login challenge for the old authenticator is void.
        db.query(AuthLoginChallenge).filter(
            AuthLoginChallenge.user_id == target.id,
            AuthLoginChallenge.status == "Pending",
        ).update({"status": "Superseded"}, synchronize_session=False)

    close_password_reset_requests(
        db,
        actor,
        target,
        primary_request=primary_reset_request,
        approved=True,
        notes=remarks or "Password reset completed by administrator",
        request_path=request_path,
    )

    create_audit_log(
        db=db,
        module_name="User Security",
        action="Admin Reset User Password",
        current_user=actor,
        entity_type="User",
        entity_id=target.id,
        entity_label=f"{target.full_name} ({target.username})",
        remarks=remarks or "Password reset by administrator",
        request_path=request_path,
        details={
            "target_username": target.username,
            "force_password_change": target.force_password_change,
            "reset_2fa": reset_2fa,
            "generated_password": bool(generated_password),
            "sessions_revoked": True,
            "password_history_count": min(
                PASSWORD_HISTORY_COUNT,
                len(list(target.password_history_json or [])),
            ),
        },
    )

    return {
        "message": "Password reset successfully",
        "temporary_password": generated_password,
        "must_change_password": target.force_password_change == "Yes",
        "two_factor_reset": bool(reset_2fa),
        "sessions_revoked": True,
    }


def clear_two_factor(target: User) -> None:
    target.totp_enabled = "No"
    target.totp_secret_encrypted = None
    target.pending_totp_secret_encrypted = None
    target.totp_setup_started_at = None
    target.totp_confirmed_at = None
    target.totp_last_used_step = None
    target.backup_codes_hash_json = None
    target.updated_at = utcnow()


def reset_user_two_factor(
    db: Session,
    actor: User,
    target: User,
    *,
    reason: str | None = None,
    request_path: str = "",
) -> dict:
    if str(target.totp_enabled or "").strip().lower() != "yes":
        raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled for this user")

    clear_two_factor(target)
    target.security_stamp = generate_security_stamp()
    target.updated_at = utcnow()
    db.query(AuthLoginChallenge).filter(
        AuthLoginChallenge.user_id == target.id,
        AuthLoginChallenge.status == "Pending",
    ).update({"status": "Superseded"}, synchronize_session=False)

    create_audit_log(
        db=db,
        module_name="User Security",
        action="Admin Reset User 2FA",
        current_user=actor,
        entity_type="User",
        entity_id=target.id,
        entity_label=f"{target.full_name} ({target.username})",
        remarks=reason or "Two-factor authentication reset by administrator",
        request_path=request_path,
        details={"target_username": target.username, "sessions_revoked": True},
    )
    return {"message": "Two-factor authentication reset successfully", "sessions_revoked": True}


def lock_user_account(
    db: Session,
    actor: User,
    target: User,
    *,
    reason: str | None = None,
    duration_minutes: int | None = None,
    request_path: str = "",
) -> dict:
    if is_admin_user(target, db) and not is_admin_user(actor, db):
        raise HTTPException(status_code=403, detail="Only an administrator can lock an administrator account")

    locked_until = (
        utcnow() + timedelta(minutes=int(duration_minutes))
        if duration_minutes
        else INDEFINITE_LOCK_UNTIL
    )
    target.locked_until = locked_until
    target.locked_reason = clean_optional_text(reason) or (
        f"Locked for {int(duration_minutes)} minutes" if duration_minutes else "Locked by administrator"
    )
    target.locked_by_user_id = actor.id
    target.updated_at = utcnow()

    create_audit_log(
        db=db,
        module_name="User Security",
        action="Lock User Account",
        current_user=actor,
        entity_type="User",
        entity_id=target.id,
        entity_label=f"{target.full_name} ({target.username})",
        remarks=target.locked_reason,
        request_path=request_path,
        details={
            "target_username": target.username,
            "locked_until": locked_until.isoformat(),
            "indefinite": duration_minutes is None,
            "duration_minutes": duration_minutes,
        },
    )
    return {
        "message": "User account locked",
        "locked_until": locked_until,
        "indefinite": duration_minutes is None,
    }


def unlock_user_account(
    db: Session,
    actor: User,
    target: User,
    *,
    reason: str | None = None,
    request_path: str = "",
) -> dict:
    was_locked = bool(target.locked_until)
    target.locked_until = None
    target.locked_reason = None
    target.locked_by_user_id = None
    target.failed_login_count = 0
    target.updated_at = utcnow()

    create_audit_log(
        db=db,
        module_name="User Security",
        action="Unlock User Account",
        current_user=actor,
        entity_type="User",
        entity_id=target.id,
        entity_label=f"{target.full_name} ({target.username})",
        remarks=reason or "Account unlocked and failed sign-in attempts cleared",
        request_path=request_path,
        details={"target_username": target.username, "was_locked": was_locked},
    )
    return {"message": "User account unlocked", "was_locked": was_locked}


def revoke_user_sessions(
    db: Session,
    actor: User,
    target: User,
    *,
    reason: str | None = None,
    request_path: str = "",
) -> dict:
    target.security_stamp = generate_security_stamp()
    target.updated_at = utcnow()
    db.query(AuthLoginChallenge).filter(
        AuthLoginChallenge.user_id == target.id,
        AuthLoginChallenge.status == "Pending",
    ).update({"status": "Superseded"}, synchronize_session=False)

    create_audit_log(
        db=db,
        module_name="User Security",
        action="Revoke User Sessions",
        current_user=actor,
        entity_type="User",
        entity_id=target.id,
        entity_label=f"{target.full_name} ({target.username})",
        remarks=reason or "All sessions revoked by administrator",
        request_path=request_path,
        details={"target_username": target.username},
    )
    return {"message": "All sessions for this user have been revoked"}


def create_password_reset_task(
    db: Session,
    reset_request: PasswordResetRequest,
    *,
    requested_by: User,
) -> OperationTask:
    from app.dependencies.permissions import get_role_ids_with_permission

    role_ids = get_role_ids_with_permission(db, "Reset User Password")
    task = OperationTask(
        task_number=generate_operation_task_number(db),
        task_type="PASSWORD_RESET_REQUEST",
        transaction_id=None,
        ticket_number=reset_request.request_number,
        operation_number=reset_request.request_number,
        raised_by_user_id=requested_by.id,
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
        current_user=requested_by,
        new_status="Pending",
        notes=reset_request.reason,
        details={
            "password_reset_request_id": reset_request.id,
            "reset_2fa": reset_request.reset_2fa,
        },
    )
    return task
