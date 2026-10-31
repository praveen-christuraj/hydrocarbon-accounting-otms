import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import ADMIN_PASSWORD_EXPIRY_DAYS, DEFAULT_PASSWORD_EXPIRY_DAYS
from app.database import get_db
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    ensure_user_in_actor_location_scope,
    get_user_location_codes,
    is_admin_user,
    require_user_permission,
    user_is_within_actor_location_scope,
    user_has_permission,
)
from app.models import User, UserRole
from app.schemas import UserCreate, UserUpdate, UserResponse, USERNAME_PATTERN
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text, escape_like
from app.utils.session import revoke_user_sessions
from app.utils.password_policy import (
    password_history_for,
    record_new_password,
    validate_password_policy,
)
from app.utils.pagination import paginate_query
from app.utils.security import hash_password, verify_password

router = APIRouter(prefix="/users", tags=["Users"])

RESERVED_USERNAMES = {"admin", "administrator", "root", "system", "superuser"}


def validate_reserved_username(username: str, *, existing_username: str | None = None) -> None:
    normalized = str(username or "").strip().casefold()
    existing = str(existing_username or "").strip().casefold()
    if normalized in RESERVED_USERNAMES and normalized != existing:
        raise HTTPException(status_code=400, detail="This username is reserved and cannot be used")


def validate_username_format(username: str) -> None:
    if not re.match(USERNAME_PATTERN, str(username or "")):
        raise HTTPException(
            status_code=400,
            detail=(
                "Username must be 3-80 characters using letters, numbers, dot, "
                "underscore or hyphen, and must start with a letter or number"
            ),
        )


def _normalized_username(username: str) -> str:
    return str(username or "").strip().casefold()


def _find_username_conflict(db: Session, username: str, exclude_user_id: int | None = None) -> User | None:
    """Case/whitespace-insensitive duplicate detection (matches the DB index)."""
    query = db.query(User).filter(
        func.lower(func.trim(User.username)) == _normalized_username(username)
    )
    if exclude_user_id is not None:
        query = query.filter(User.id != exclude_user_id)
    return query.first()


def _user_audit_data(user: User) -> dict:
    return {
        "full_name": user.full_name,
        "username": user.username,
        "email": user.email,
        "phone": user.phone,
        "department": user.department,
        "designation": user.designation,
        "status": user.status,
    }


def _default_expiry_days_for(target_is_admin: bool) -> int:
    return ADMIN_PASSWORD_EXPIRY_DAYS if target_is_admin else DEFAULT_PASSWORD_EXPIRY_DAYS


@router.get("")
def get_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None, max_length=120),
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View User", db)
    query = db.query(User).order_by(User.id)
    if search:
        pattern = f"%{escape_like(search)}%"
        query = query.filter(
            or_(
                User.full_name.ilike(pattern, escape="\\"),
                User.username.ilike(pattern, escape="\\"),
                User.email.ilike(pattern, escape="\\"),
            )
        )
    allowed_codes = get_user_location_codes(current_user, db)
    if allowed_codes is None:
        result = paginate_query(query, skip, limit)
        items = result["items"]
        total = result["total"]
        has_more = result["has_more"]
    else:
        visible_users = [
            target
            for target in query.all()
            if user_is_within_actor_location_scope(current_user, target, db)
        ]
        total = len(visible_users)
        items = visible_users[skip : skip + limit]
        has_more = skip + limit < total

    return {
        "items": [UserResponse.model_validate(target) for target in items],
        "total": total,
        "skip": skip,
        "limit": limit,
        "has_more": has_more,
    }


@router.get("/{user_id}", response_model=UserResponse)
def get_user_by_id(
    user_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View User", db)
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    ensure_user_in_actor_location_scope(current_user, target, db)
    return target


@router.post("", response_model=UserResponse)
def create_user(
    user: UserCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Create User",
        db,
    )
    validate_reserved_username(user.username)
    validate_username_format(user.username)

    if _find_username_conflict(db, user.username):
        raise HTTPException(
            status_code=400,
            detail="Username already exists",
        )

    if user.password.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Password is required",
        )

    validate_password_policy(
        user.password,
        username=user.username,
        full_name=user.full_name,
        email=user.email,
    )

    new_user = User(
        full_name=user.full_name.strip(),
        username=user.username.strip(),
        email=user.email.strip(),
        phone=clean_optional_text(user.phone),
        department=clean_optional_text(user.department),
        designation=clean_optional_text(user.designation),
        password_hash=hash_password(user.password),
        password_changed_at=datetime.now(timezone.utc).replace(tzinfo=None),
        password_history_json=[],
        force_password_change="Yes",
        password_never_expires="No",
        password_expiry_days=_default_expiry_days_for(False),
        status=user.status,
    )

    db.add(new_user)
    try:
        db.flush()
    except IntegrityError:
        # Two administrators submitting the same username at once must get a
        # controlled 409, not a 500 from the unique constraint.
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already exists")

    create_audit_log(
        db=db,
        module_name="User Master",
        action="Create User",
        current_user=current_user,
        entity_type="User",
        entity_id=new_user.id,
        entity_label=f"{new_user.full_name} ({new_user.username})",
        remarks="User created; password change required at first sign-in",
        request_path="/users",
        details={
            "after": _user_audit_data(new_user),
            "password_set": True,
            "force_password_change": True,
        },
    )

    db.commit()
    db.refresh(new_user)

    return new_user


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user: UserUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Edit User",
        db,
    )

    existing_user = db.query(User).filter(User.id == user_id).first()

    if not existing_user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )
    ensure_user_in_actor_location_scope(current_user, existing_user, db)
    target_is_admin = is_admin_user(existing_user, db) or _normalized_username(existing_user.username) == "admin"
    if target_is_admin and not is_admin_user(current_user, db):
        raise HTTPException(status_code=403, detail="Only an administrator can edit an administrator account")
    validate_reserved_username(user.username, existing_username=existing_user.username)
    if _normalized_username(user.username) != _normalized_username(existing_user.username):
        validate_username_format(user.username)
    if existing_user.id == current_user.id and existing_user.status == "Active" and user.status != "Active":
        raise HTTPException(status_code=403, detail="You cannot deactivate your own account")

    if _find_username_conflict(db, user.username, exclude_user_id=user_id):
        raise HTTPException(
            status_code=400,
            detail="Username already exists",
        )

    before_data = _user_audit_data(existing_user)
    password_changed = False
    supplied_password = user.password is not None and str(user.password).strip() != ""

    if supplied_password and existing_user.id == current_user.id:
        # A stolen access token must not be enough to set a new password.
        if not user.current_password or not verify_password(user.current_password, existing_user.password_hash):
            raise HTTPException(
                status_code=401,
                detail="Current password is required and must be correct to change your own password",
            )
    elif supplied_password:
        # Resetting somebody else's password is a distinct, audited privilege.
        if not is_admin_user(current_user, db) and not user_has_permission(
            current_user, "Reset User Password", db
        ):
            raise HTTPException(
                status_code=403,
                detail="Permission required: Reset User Password",
            )
        ensure_user_in_actor_location_scope(current_user, existing_user, db)

    if supplied_password:
        validate_password_policy(
            user.password,
            username=existing_user.username,
            full_name=existing_user.full_name,
            email=existing_user.email,
            history_hashes=password_history_for(existing_user),
        )

    existing_user.full_name = user.full_name.strip()
    existing_user.username = user.username.strip()
    existing_user.email = user.email.strip()
    existing_user.phone = clean_optional_text(user.phone)
    existing_user.department = clean_optional_text(user.department)
    existing_user.designation = clean_optional_text(user.designation)
    existing_user.status = user.status

    if supplied_password:
        record_new_password(
            existing_user,
            hash_password(user.password),
            changed_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        existing_user.force_password_change = "No" if existing_user.id == current_user.id else "Yes"
        existing_user.failed_login_count = 0
        existing_user.locked_until = None
        # Rotating a credential ends every existing session. The acting
        # administrator re-authenticates on their next request.
        revoke_user_sessions(existing_user)
        if existing_user.id == current_user.id:
            existing_user.force_password_change = "No"
        password_changed = True

    if target_is_admin:
        # Administrator accounts always expire; never let an edit disable it.
        existing_user.password_never_expires = "No"
        existing_user.password_expiry_days = min(
            int(existing_user.password_expiry_days or ADMIN_PASSWORD_EXPIRY_DAYS),
            ADMIN_PASSWORD_EXPIRY_DAYS,
        )
    elif user.status != "Active":
        # Deactivating an account ends its sessions immediately.
        revoke_user_sessions(existing_user)

    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already exists")

    create_audit_log(
        db=db,
        module_name="User Master",
        action="Update User",
        current_user=current_user,
        entity_type="User",
        entity_id=existing_user.id,
        entity_label=f"{existing_user.full_name} ({existing_user.username})",
        remarks="User updated",
        request_path=f"/users/{user_id}",
        details={
            "before": before_data,
            "after": _user_audit_data(existing_user),
            "password_changed": password_changed,
            "sessions_revoked": password_changed or user.status != "Active",
        },
    )

    db.commit()
    db.refresh(existing_user)

    return existing_user


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Delete User",
        db,
    )

    existing_user = db.query(User).filter(User.id == user_id).first()

    if not existing_user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )
    ensure_user_in_actor_location_scope(current_user, existing_user, db)
    if is_admin_user(existing_user, db) or _normalized_username(existing_user.username) == "admin":
        raise HTTPException(status_code=403, detail="The reserved administrator account cannot be deleted")

    if existing_user.id == current_user.id:
        raise HTTPException(
            status_code=400,
            detail="You cannot delete your own logged-in user account",
        )

    assigned_role = (
        db.query(UserRole)
        .filter(UserRole.user_id == user_id)
        .first()
    )

    if assigned_role:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete user because a role is assigned. Remove user role assignment first.",
        )

    create_audit_log(
        db=db,
        module_name="User Master",
        action="Delete User",
        current_user=current_user,
        entity_type="User",
        entity_id=existing_user.id,
        entity_label=f"{existing_user.full_name} ({existing_user.username})",
        remarks="User deleted",
        request_path=f"/users/{user_id}",
        details={
            "deleted": _user_audit_data(existing_user),
        },
    )

    db.delete(existing_user)
    db.commit()

    return {
        "message": "User deleted successfully"
    }
