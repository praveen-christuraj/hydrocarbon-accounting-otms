from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, UserRole, Role
from app.schemas import UserCreate, UserUpdate, UserResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    ensure_user_in_actor_location_scope,
    get_user_location_codes,
    is_admin_user,
    require_user_permission,
    user_is_within_actor_location_scope,
)
from app.services.audit_service import create_audit_log
from app.utils.security import hash_password
from app.utils.helpers import clean_optional_text
from app.utils.password_policy import validate_password_policy
from app.utils.pagination import paginate_query

router = APIRouter(prefix="/users", tags=["Users"])

RESERVED_USERNAMES = {"admin", "administrator", "root", "system", "superuser"}


def validate_reserved_username(username: str, *, existing_username: str | None = None) -> None:
    normalized = str(username or "").strip().casefold()
    existing = str(existing_username or "").strip().casefold()
    if normalized in RESERVED_USERNAMES and normalized != existing:
        raise HTTPException(status_code=400, detail="This username is reserved and cannot be used")


@router.get("")
def get_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None),
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View User", db)
    query = db.query(User).order_by(User.id)
    if search:
        query = query.filter(
            or_(
                User.full_name.ilike(f"%{search}%"),
                User.username.ilike(f"%{search}%"),
                User.email.ilike(f"%{search}%"),
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

    existing_user = (
        db.query(User)
        .filter(User.username.ilike(user.username))
        .first()
    )

    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Username already exists",
        )

    if user.password.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Password is required",
        )

    validate_password_policy(user.password, username=user.username)

    new_user = User(
        full_name=user.full_name.strip(),
        username=user.username.strip(),
        email=user.email.strip(),
        phone=clean_optional_text(user.phone),
        department=clean_optional_text(user.department),
        designation=clean_optional_text(user.designation),
        password_hash=hash_password(user.password),
        password_changed_at=datetime.now(timezone.utc).replace(tzinfo=None),
        force_password_change="Yes",
        status=user.status,
    )

    db.add(new_user)
    db.flush()

    after_data = {
        "full_name": new_user.full_name,
        "username": new_user.username,
        "email": new_user.email,
        "phone": new_user.phone,
        "department": new_user.department,
        "designation": new_user.designation,
        "status": new_user.status,
    }

    create_audit_log(
        db=db,
        module_name="User Master",
        action="Create User",
        current_user=current_user,
        entity_type="User",
        entity_id=new_user.id,
        entity_label=f"{new_user.full_name} ({new_user.username})",
        remarks="User created",
        request_path="/users",
        details={
            "after": after_data,
            "password_set": True,
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
    if is_admin_user(existing_user, db) and not is_admin_user(current_user, db):
        raise HTTPException(status_code=403, detail="Only an administrator can edit an administrator account")
    validate_reserved_username(user.username, existing_username=existing_user.username)
    if existing_user.id == current_user.id and existing_user.status == "Active" and user.status != "Active":
        raise HTTPException(status_code=403, detail="You cannot deactivate your own account")

    duplicate_user = (
        db.query(User)
        .filter(
            User.username.ilike(user.username),
            User.id != user_id,
        )
        .first()
    )

    if duplicate_user:
        raise HTTPException(
            status_code=400,
            detail="Username already exists",
        )

    before_data = {
        "full_name": existing_user.full_name,
        "username": existing_user.username,
        "email": existing_user.email,
        "phone": existing_user.phone,
        "department": existing_user.department,
        "designation": existing_user.designation,
        "status": existing_user.status,
    }

    password_changed = False

    existing_user.full_name = user.full_name.strip()
    existing_user.username = user.username.strip()
    existing_user.email = user.email.strip()
    existing_user.phone = clean_optional_text(user.phone)
    existing_user.department = clean_optional_text(user.department)
    existing_user.designation = clean_optional_text(user.designation)
    existing_user.status = user.status

    if user.password is not None and user.password.strip() != "":
        validate_password_policy(user.password, username=existing_user.username)
        existing_user.password_hash = hash_password(user.password)
        existing_user.password_changed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        existing_user.force_password_change = "No" if existing_user.id == current_user.id else "Yes"
        existing_user.failed_login_count = 0
        existing_user.locked_until = None
        password_changed = True

    after_data = {
        "full_name": existing_user.full_name,
        "username": existing_user.username,
        "email": existing_user.email,
        "phone": existing_user.phone,
        "department": existing_user.department,
        "designation": existing_user.designation,
        "status": existing_user.status,
    }

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
            "after": after_data,
            "password_changed": password_changed,
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
    if is_admin_user(existing_user, db):
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

    deleted_data = {
        "full_name": existing_user.full_name,
        "username": existing_user.username,
        "email": existing_user.email,
        "phone": existing_user.phone,
        "department": existing_user.department,
        "designation": existing_user.designation,
        "status": existing_user.status,
    }

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
            "deleted": deleted_data,
        },
    )

    db.delete(existing_user)
    db.commit()

    return {
        "message": "User deleted successfully"
    }
