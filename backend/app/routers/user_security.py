"""Enterprise account-security administration console API.

All endpoints are additive and mounted under ``/security``. They give
administrators a complete view of account lock state, failed sign-in counters,
2FA coverage and the self-service password-reset queue, plus every remediation
action (unlock, lock, reset password / 2FA, revoke sessions).

Self-service password and 2FA actions remain in ``/auth`` so existing clients
keep working.
"""

from datetime import timedelta
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    ensure_user_in_actor_location_scope,
    get_user_location_codes,
    is_admin_user,
    normalize_location_code,
    require_user_permission,
)
from app.models import (
    AuditLog,
    OperationTask,
    PasswordResetRequest,
    Permission,
    Role,
    RoleLocation,
    User,
    UserLocation,
    UserRole,
)
from app.schemas import (
    PasswordResetApproveRequest,
    PasswordResetRejectRequest,
    ResetUser2FARequest,
    RevokeUserSessionsRequest,
    UserAccountLockRequest,
    UserAccountUnlockRequest,
    UserTwoFactorPolicyRequest,
)
from app.services.audit_service import create_audit_log
from app.services.user_security_service import (
    apply_password_reset,
    close_password_reset_requests,
    ensure_target_can_be_administered,
    get_user_or_404,
    lock_user_account,
    reset_user_two_factor,
    revoke_user_sessions,
    unlock_user_account,
)
from app.utils.password_policy import (
    build_security_flags,
    password_change_required,
    password_expiry_at,
    password_is_forced,
)
from app.utils.time import to_utc_naive, utcnow

router = APIRouter(prefix="/security", tags=["User Security"])

MAX_SECURITY_ROWS = 20000


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _scoped_users(actor: User, users: list[User], db: Session) -> list[User]:
    """Apply the same location-scope rule as the User Master list, in batch."""
    actor_codes = get_user_location_codes(actor, db)
    if actor_codes is None:
        return users
    if not users:
        return []

    user_ids = [user.id for user in users]
    own_locations: dict[int, set[str]] = defaultdict(set)
    for user_id, location_code in (
        db.query(UserLocation.user_id, UserLocation.location_code)
        .filter(UserLocation.user_id.in_(user_ids))
        .all()
    ):
        normalized = normalize_location_code(location_code)
        if normalized:
            own_locations[user_id].add(normalized)

    assignments = (
        db.query(UserRole.user_id, UserRole.role_id)
        .filter(UserRole.user_id.in_(user_ids))
        .all()
    )
    role_ids = {role_id for _, role_id in assignments}
    role_locations: dict[int, set[str]] = defaultdict(set)
    if role_ids:
        for role_id, location_code in (
            db.query(RoleLocation.role_id, RoleLocation.location_code)
            .filter(RoleLocation.role_id.in_(role_ids))
            .all()
        ):
            normalized = normalize_location_code(location_code)
            if normalized:
                role_locations[role_id].add(normalized)

    roles_by_user: dict[int, set[int]] = defaultdict(set)
    for user_id, role_id in assignments:
        roles_by_user[user_id].add(role_id)

    admin_role_ids = {
        role_id
        for (role_id,) in db.query(Role.id)
        .filter(func.lower(func.trim(Role.role_name)) == "admin")
        .all()
    }
    admin_user_ids = {
        user_id for user_id, role_id in assignments if role_id in admin_role_ids
    }

    visible: list[User] = []
    for user in users:
        if user.id in admin_user_ids:
            continue
        if str(user.all_locations_access or "").strip().casefold() in {"yes", "true", "1", "y"}:
            continue
        codes = set(own_locations.get(user.id, set()))
        for role_id in roles_by_user.get(user.id, set()):
            codes.update(role_locations.get(role_id, set()))
        if codes.issubset(actor_codes):
            visible.append(user)
    return visible


def _role_map(db: Session, user_ids: list[int]) -> dict[int, list[dict]]:
    if not user_ids:
        return {}
    rows = (
        db.query(UserRole.user_id, Role.id, Role.role_name, Role.status)
        .join(Role, Role.id == UserRole.role_id)
        .filter(UserRole.user_id.in_(user_ids))
        .order_by(Role.role_name)
        .all()
    )
    mapping: dict[int, list[dict]] = defaultdict(list)
    for user_id, role_id, role_name, status in rows:
        mapping[user_id].append({"id": role_id, "role_name": role_name, "status": status})
    return mapping


def _pending_reset_map(db: Session, user_ids: list[int]) -> dict[int, list[PasswordResetRequest]]:
    if not user_ids:
        return {}
    rows = (
        db.query(PasswordResetRequest)
        .filter(
            PasswordResetRequest.user_id.in_(user_ids),
            PasswordResetRequest.status == "Pending",
        )
        .order_by(PasswordResetRequest.requested_at.desc())
        .all()
    )
    mapping: dict[int, list[PasswordResetRequest]] = defaultdict(list)
    for row in rows:
        mapping[row.user_id].append(row)
    return mapping


def _user_payload(
    user: User,
    *,
    roles: list[dict],
    pending_requests: list[PasswordResetRequest],
    locked_by_username: str | None,
) -> dict:
    security = build_security_flags(user)
    latest_request = pending_requests[0] if pending_requests else None
    expires_at = password_expiry_at(user)
    return {
        "id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "email": user.email,
        "phone": user.phone,
        "department": user.department,
        "designation": user.designation,
        "status": user.status,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
        "roles": roles,
        "failed_login_count": int(user.failed_login_count or 0),
        "locked_until": user.locked_until,
        "locked_reason": user.locked_reason,
        "locked_by_username": locked_by_username,
        "is_locked": security["is_locked"],
        "lock_state": "Locked" if security["is_locked"] else (
            "Disabled" if str(user.status or "").strip().lower() != "active" else "Unlocked"
        ),
        "totp_enabled": security["totp_enabled"],
        "force_2fa": security["force_2fa"],
        "two_factor_enrollment_required": security["two_factor_enrollment_required"],
        "two_factor_confirmed_at": security["two_factor_confirmed_at"],
        "backup_codes_remaining": security["backup_codes_remaining"],
        "force_password_change": security["force_password_change"],
        "password_expired": security["password_expired"],
        "password_change_required": security["password_change_required"],
        "password_changed_at": user.password_changed_at,
        "password_expires_at": expires_at,
        "password_never_expires": security["password_never_expires"],
        "password_expiry_days": int(user.password_expiry_days or 0),
        "last_login_at": user.last_login_at,
        "last_login_ip": user.last_login_ip,
        "pending_reset_request_count": len(pending_requests),
        "latest_reset_request": (
            {
                "id": latest_request.id,
                "request_number": latest_request.request_number,
                "status": latest_request.status,
                "reset_2fa": latest_request.reset_2fa,
                "reason": latest_request.reason,
                "requested_at": latest_request.requested_at,
            }
            if latest_request
            else None
        ),
    }


def _serialise_users(users: list[User], db: Session) -> list[dict]:
    user_ids = [user.id for user in users]
    roles = _role_map(db, user_ids)
    pending = _pending_reset_map(db, user_ids)
    locked_by_ids = {user.locked_by_user_id for user in users if user.locked_by_user_id}
    locked_by_names = {}
    if locked_by_ids:
        locked_by_names = {
            user_id: username
            for user_id, username in db.query(User.id, User.username)
            .filter(User.id.in_(locked_by_ids))
            .all()
        }
    return [
        _user_payload(
            user,
            roles=roles.get(user.id, []),
            pending_requests=pending.get(user.id, []),
            locked_by_username=locked_by_names.get(user.locked_by_user_id),
        )
        for user in users
    ]


def _matches_status(user: User, status_filter: str) -> bool:
    status = str(status_filter or "all").strip().lower()
    if status in {"", "all"}:
        return True
    is_locked = bool(user.locked_until and to_utc_naive(user.locked_until) > utcnow())
    totp_enabled = str(user.totp_enabled or "").strip().lower() == "yes"
    account_status = str(user.status or "").strip().lower()
    if status == "active":
        return account_status == "active"
    if status == "inactive":
        return account_status == "inactive"
    if status == "blocked":
        return account_status == "blocked"
    if status == "locked":
        return is_locked
    if status == "unlocked":
        return not is_locked
    if status == "2fa_enabled":
        return totp_enabled
    if status == "2fa_disabled":
        return not totp_enabled
    if status == "password_change_required":
        return password_change_required(user)
    if status == "password_expired":
        return bool(user.password_expired)
    if status == "force_password_change":
        return password_is_forced(user)
    if status == "no_2fa":
        return not totp_enabled and account_status == "active"
    return True


def _count_active_admins(db: Session, exclude_user_id: int | None = None) -> int:
    query = (
        db.query(func.count(func.distinct(User.id)))
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .filter(
            func.lower(func.trim(Role.role_name)) == "admin",
            User.status == "Active",
        )
    )
    if exclude_user_id is not None:
        query = query.filter(User.id != exclude_user_id)
    return int(query.scalar() or 0)


def _request_payload(row: PasswordResetRequest, user: User | None, task: OperationTask | None) -> dict:
    return {
        "id": row.id,
        "request_number": row.request_number,
        "user_id": row.user_id,
        "username": row.username,
        "full_name": user.full_name if user else None,
        "user_status": user.status if user else None,
        "user_locked": bool(
            user and user.locked_until and to_utc_naive(user.locked_until) > utcnow()
        ),
        "user_totp_enabled": bool(user and str(user.totp_enabled or "").strip().lower() == "yes"),
        "status": row.status,
        "reason": row.reason,
        "reset_2fa": row.reset_2fa,
        "requested_at": row.requested_at,
        "requested_by_ip": row.requested_by_ip,
        "task_id": row.task_id,
        "task_number": task.task_number if task else None,
        "task_status": task.status if task else None,
        "acted_by_user_id": row.acted_by_user_id,
        "acted_at": row.acted_at,
        "action_notes": row.action_notes,
    }


# ---------------------------------------------------------------------------
# Overview + registry
# ---------------------------------------------------------------------------

@router.get("/overview")
def get_security_overview(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View User Security", db)

    users = _scoped_users(current_user, db.query(User).all(), db)
    user_ids = [user.id for user in users]
    pending_requests = 0
    if user_ids:
        pending_requests = (
            db.query(func.count(PasswordResetRequest.id))
            .filter(
                PasswordResetRequest.status == "Pending",
                PasswordResetRequest.user_id.in_(user_ids),
            )
            .scalar()
            or 0
        )

    locked = [user for user in users if user.locked_until and to_utc_naive(user.locked_until) > utcnow()]
    automatic_locked = [user for user in locked if not user.locked_by_user_id]
    admin_locked = [user for user in locked if user.locked_by_user_id]
    active_users = [user for user in users if str(user.status or "").strip().lower() == "active"]

    lock_events_7d = 0
    if user_ids:
        cutoff = utcnow() - timedelta(days=7)
        lock_events_7d = (
            db.query(func.count(AuditLog.id))
            .filter(
                AuditLog.action == "Account Locked",
                AuditLog.entity_type == "User",
                AuditLog.entity_id.in_(user_ids),
                AuditLog.created_at >= cutoff,
            )
            .scalar()
            or 0
        )

    pending_admin_requests = 0
    if user_ids:
        pending_admin_requests = (
            db.query(func.count(OperationTask.id))
            .join(PasswordResetRequest, PasswordResetRequest.task_id == OperationTask.id)
            .filter(
                PasswordResetRequest.user_id.in_(user_ids),
                OperationTask.task_type == "PASSWORD_RESET_REQUEST",
                OperationTask.status.in_(["Pending", "In Progress"]),
            )
            .scalar()
            or 0
        )

    return {
        "generated_at": utcnow(),
        "total_users": len(users),
        "active_users": len(active_users),
        "inactive_users": len(users) - len(active_users),
        "locked_users": len(locked),
        "automatic_locked_users": len(automatic_locked),
        "administratively_locked_users": len(admin_locked),
        "two_factor_enabled_users": sum(
            1 for user in users if str(user.totp_enabled or "").strip().lower() == "yes"
        ),
        "two_factor_required_users": sum(
            1 for user in users if str(user.force_2fa or "").strip().lower() == "yes"
        ),
        "password_change_required_users": sum(1 for user in users if password_change_required(user)),
        "password_expired_users": sum(1 for user in users if user.password_expired),
        "users_without_two_factor": sum(
            1 for user in active_users if str(user.totp_enabled or "").strip().lower() != "yes"
        ),
        "pending_password_reset_requests": pending_requests,
        "pending_password_reset_tasks": pending_admin_requests,
        "account_lock_events_last_7_days": int(lock_events_7d),
    }


@router.get("/users")
def list_security_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=2000),
    search: str | None = Query(None),
    status: str = Query("all"),
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View User Security", db)

    query = db.query(User).order_by(User.id)
    if search:
        term = f"%{str(search).strip()}%"
        query = query.filter(
            User.full_name.ilike(term)
            | User.username.ilike(term)
            | User.email.ilike(term)
            | User.department.ilike(term)
            | User.designation.ilike(term)
        )
    users = _scoped_users(current_user, query.limit(MAX_SECURITY_ROWS).all(), db)
    filtered = [user for user in users if _matches_status(user, status)]

    total = len(filtered)
    page = filtered[skip : skip + limit]
    return {
        "items": _serialise_users(page, db),
        "total": total,
        "skip": skip,
        "limit": limit,
        "has_more": skip + limit < total,
        "status_filter": status,
    }


@router.get("/users/{user_id}")
def get_security_user(
    user_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View User Security", db)
    target = get_user_or_404(db, user_id)
    ensure_user_in_actor_location_scope(current_user, target, db)
    return _serialise_users([target], db)[0]


@router.get("/users/{user_id}/history")
def get_security_user_history(
    user_id: int,
    limit: int = Query(30, ge=1, le=200),
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View User Security", db)
    target = get_user_or_404(db, user_id)
    ensure_user_in_actor_location_scope(current_user, target, db)

    rows = (
        db.query(AuditLog)
        .filter(
            AuditLog.entity_id == target.id,
            AuditLog.entity_type == "User",
            AuditLog.module_name.in_(["User Security", "Authentication", "User Master"]),
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
        .all()
    )
    return {
        "user_id": target.id,
        "username": target.username,
        "items": [
            {
                "id": row.id,
                "action": row.action,
                "module_name": row.module_name,
                "remarks": row.remarks,
                "performed_by": row.performed_by,
                "created_at": row.created_at,
                "request_path": row.request_path,
                "details": row.details,
            }
            for row in rows
        ],
    }


# ---------------------------------------------------------------------------
# Account actions
# ---------------------------------------------------------------------------

@router.post("/users/{user_id}/lock")
def lock_account(
    user_id: int,
    payload: UserAccountLockRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Lock User Account", db)
    target = get_user_or_404(db, user_id)
    ensure_target_can_be_administered(current_user, target, db)
    if is_admin_user(target, db) and _count_active_admins(db, exclude_user_id=target.id) == 0:
        raise HTTPException(
            status_code=400,
            detail="Cannot lock the only active administrator account",
        )

    result = lock_user_account(
        db,
        current_user,
        target,
        reason=payload.reason,
        duration_minutes=payload.duration_minutes,
        request_path=f"/security/users/{user_id}/lock",
    )
    db.commit()
    return result


@router.post("/users/{user_id}/unlock")
def unlock_account(
    user_id: int,
    payload: UserAccountUnlockRequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Unlock User Account", db)
    target = get_user_or_404(db, user_id)
    ensure_target_can_be_administered(current_user, target, db)

    result = unlock_user_account(
        db,
        current_user,
        target,
        reason=(payload.reason if payload else None),
        request_path=f"/security/users/{user_id}/unlock",
    )
    db.commit()
    return result


@router.post("/users/{user_id}/reset-2fa")
def reset_account_two_factor(
    user_id: int,
    payload: ResetUser2FARequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Reset User 2FA", db)
    target = get_user_or_404(db, user_id)
    ensure_target_can_be_administered(current_user, target, db)

    result = reset_user_two_factor(
        db,
        current_user,
        target,
        reason=(payload.reason if payload else None),
        request_path=f"/security/users/{user_id}/reset-2fa",
    )
    db.commit()
    return result


@router.post("/users/{user_id}/revoke-sessions")
def revoke_sessions(
    user_id: int,
    payload: RevokeUserSessionsRequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Revoke User Sessions", db)
    target = get_user_or_404(db, user_id)
    ensure_target_can_be_administered(current_user, target, db)

    result = revoke_user_sessions(
        db,
        current_user,
        target,
        reason=(payload.reason if payload else None),
        request_path=f"/security/users/{user_id}/revoke-sessions",
    )
    db.commit()
    return result


@router.post("/users/{user_id}/require-password-change")
def require_password_change(
    user_id: int,
    payload: UserAccountUnlockRequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Reset User Password", db)
    target = get_user_or_404(db, user_id)
    ensure_target_can_be_administered(current_user, target, db)

    target.force_password_change = "Yes"
    target.updated_at = utcnow()
    reason = (payload.reason if payload else None) or "Administrator requires a password change"
    create_audit_log(
        db=db,
        module_name="User Security",
        action="Require Password Change",
        current_user=current_user,
        entity_type="User",
        entity_id=target.id,
        entity_label=f"{target.full_name} ({target.username})",
        remarks=reason,
        request_path=f"/security/users/{user_id}/require-password-change",
        details={"target_username": target.username},
    )
    db.commit()
    return {"message": "The user must change their password at next sign-in"}


@router.post("/users/{user_id}/two-factor-policy")
def update_two_factor_policy(
    user_id: int,
    payload: UserTwoFactorPolicyRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Turn the "2FA is mandatory" policy on/off for one account."""
    require_user_permission(current_user, "Reset User 2FA", db)
    target = get_user_or_404(db, user_id)
    ensure_target_can_be_administered(current_user, target, db)

    old_value = "Yes" if str(target.force_2fa or "").strip().lower() == "yes" else "No"
    target.force_2fa = "Yes" if payload.required else "No"
    target.updated_at = utcnow()
    create_audit_log(
        db=db,
        module_name="User Security",
        action="Update 2FA Policy",
        current_user=current_user,
        entity_type="User",
        entity_id=target.id,
        entity_label=f"{target.full_name} ({target.username})",
        old_status=old_value,
        new_status=target.force_2fa,
        remarks=payload.reason or (
            "Two-factor authentication made mandatory" if payload.required
            else "Two-factor authentication no longer mandatory"
        ),
        request_path=f"/security/users/{user_id}/two-factor-policy",
        details={
            "target_username": target.username,
            "required": payload.required,
            "totp_enabled": str(target.totp_enabled or "").strip().lower() == "yes",
        },
    )
    db.commit()
    return {
        "message": (
            "Two-factor authentication is now mandatory for this user"
            if payload.required
            else "Two-factor authentication is no longer mandatory for this user"
        ),
        "force_2fa": target.force_2fa,
    }


# ---------------------------------------------------------------------------
# Password reset request queue
# ---------------------------------------------------------------------------

@router.get("/password-reset-requests")
def list_password_reset_requests(
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=2000),
    status: str = Query("all"),
    search: str | None = Query(None),
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View User Security", db)

    query = db.query(PasswordResetRequest)
    if str(status or "all").strip().lower() not in {"", "all"}:
        query = query.filter(PasswordResetRequest.status.ilike(status))
    if search:
        term = f"%{str(search).strip()}%"
        query = query.filter(
            PasswordResetRequest.request_number.ilike(term)
            | PasswordResetRequest.username.ilike(term)
            | PasswordResetRequest.reason.ilike(term)
        )
    rows = query.order_by(
        PasswordResetRequest.requested_at.desc(),
        PasswordResetRequest.id.desc(),
    ).limit(MAX_SECURITY_ROWS).all()

    # Location scope: a restricted administrator only sees requests for users
    # they may administer.
    users_by_id = {
        user.id: user
        for user in _scoped_users(
            current_user,
            db.query(User).filter(User.id.in_([row.user_id for row in rows] or [-1])).all(),
            db,
        )
    }
    rows = [row for row in rows if row.user_id in users_by_id]

    task_ids = [row.task_id for row in rows if row.task_id]
    tasks_by_id = {}
    if task_ids:
        tasks_by_id = {
            task.id: task
            for task in db.query(OperationTask).filter(OperationTask.id.in_(task_ids)).all()
        }

    counts = {"pending": 0, "approved": 0, "rejected": 0, "cancelled": 0}
    for row in rows:
        key = str(row.status or "").strip().lower()
        if key in counts:
            counts[key] += 1

    total = len(rows)
    page = rows[skip : skip + limit]
    return {
        "items": [
            _request_payload(row, users_by_id.get(row.user_id), tasks_by_id.get(row.task_id))
            for row in page
        ],
        "total": total,
        "skip": skip,
        "limit": limit,
        "has_more": skip + limit < total,
        "counts": counts,
    }


@router.post("/password-reset-requests/{request_id}/approve")
def approve_password_reset_request(
    request_id: int,
    payload: PasswordResetApproveRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Approve Password Reset Requests", db)
    require_user_permission(current_user, "Reset User Password", db)

    reset_request = db.query(PasswordResetRequest).filter(PasswordResetRequest.id == request_id).first()
    if not reset_request:
        raise HTTPException(status_code=404, detail="Password reset request not found")
    if str(reset_request.status or "").strip().lower() != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"This request is already {str(reset_request.status).lower()}",
        )

    target = get_user_or_404(db, reset_request.user_id)
    ensure_target_can_be_administered(current_user, target, db)

    reset_2fa = (
        payload.reset_2fa
        if payload.reset_2fa is not None
        else str(reset_request.reset_2fa or "").strip().lower() == "yes"
    )
    if reset_2fa:
        require_user_permission(current_user, "Reset User 2FA", db)

    result = apply_password_reset(
        db,
        current_user,
        target,
        new_password=payload.new_password,
        generate_password=payload.generate_password,
        force_password_change=payload.force_password_change,
        reset_2fa=reset_2fa,
        unlock_account=True,
        remarks=payload.remarks or f"Approved password reset request {reset_request.request_number}",
        request_path=f"/security/password-reset-requests/{request_id}/approve",
        primary_reset_request=reset_request,
    )

    create_audit_log(
        db=db,
        module_name="User Security",
        action="Approve Password Reset Request",
        current_user=current_user,
        entity_type="PasswordResetRequest",
        entity_id=reset_request.id,
        entity_label=reset_request.request_number,
        old_status="Pending",
        new_status="Approved",
        remarks=payload.remarks or "Password reset request approved",
        request_path=f"/security/password-reset-requests/{request_id}/approve",
        details={
            "target_user_id": target.id,
            "target_username": target.username,
            "reset_2fa": reset_2fa,
            "generated_password": bool(result.get("temporary_password")),
        },
    )
    db.commit()
    result["request"] = _request_payload(reset_request, target, None)
    return result


@router.post("/password-reset-requests/{request_id}/reject")
def reject_password_reset_request(
    request_id: int,
    payload: PasswordResetRejectRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Approve Password Reset Requests", db)

    reset_request = db.query(PasswordResetRequest).filter(PasswordResetRequest.id == request_id).first()
    if not reset_request:
        raise HTTPException(status_code=404, detail="Password reset request not found")
    if str(reset_request.status or "").strip().lower() != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"This request is already {str(reset_request.status).lower()}",
        )

    target = get_user_or_404(db, reset_request.user_id)
    ensure_user_in_actor_location_scope(current_user, target, db)

    close_password_reset_requests(
        db,
        current_user,
        target,
        primary_request=reset_request,
        approved=False,
        notes=payload.remarks,
        request_path=f"/security/password-reset-requests/{request_id}/reject",
    )
    create_audit_log(
        db=db,
        module_name="User Security",
        action="Reject Password Reset Request",
        current_user=current_user,
        entity_type="PasswordResetRequest",
        entity_id=reset_request.id,
        entity_label=reset_request.request_number,
        old_status="Pending",
        new_status="Rejected",
        remarks=payload.remarks,
        request_path=f"/security/password-reset-requests/{request_id}/reject",
        details={"target_user_id": target.id, "target_username": target.username},
    )
    db.commit()
    return {
        "message": "Password reset request rejected",
        "request": _request_payload(reset_request, target, None),
    }
