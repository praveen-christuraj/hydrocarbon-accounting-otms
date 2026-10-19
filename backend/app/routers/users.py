from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import PASSWORD_EXPIRY_DAYS_DEFAULT
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
from app.services.user_security_service import close_password_reset_requests
from app.utils.password_policy import remember_password_hash, validate_password_policy
from app.utils.security import generate_security_stamp, hash_password
from app.utils.helpers import clean_optional_text
from app.utils.pagination import paginate_query
from app.utils.time import utcnow

router = APIRouter(prefix="/users", tags=["Users"])


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
    if str(user.username or "").strip().casefold() == "admin" and not is_admin_user(current_user, db):
        raise HTTPException(status_code=403, detail="The reserved administrator username cannot be created by this user")

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

    # Build the candidate first so the policy can reject passwords that
    # contain the user's own username / name (identity check).
    candidate = User(
        full_name=user.full_name.strip(),
        username=user.username.strip(),
        email=user.email.strip(),
    )
    validate_password_policy(user.password, user=candidate)

    new_user = User(
        full_name=candidate.full_name,
        username=candidate.username,
        email=candidate.email,
        phone=clean_optional_text(user.phone),
        department=clean_optional_text(user.department),
        designation=clean_optional_text(user.designation),
        password_hash=hash_password(user.password),
        password_changed_at=utcnow(),
        force_password_change="Yes",
        password_never_expires="No",
        password_expiry_days=PASSWORD_EXPIRY_DAYS_DEFAULT,
        security_stamp=generate_security_stamp(),
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
    if str(user.username or "").strip().casefold() == "admin" and not is_admin_user(current_user, db):
        raise HTTPException(status_code=403, detail="The reserved administrator username cannot be assigned")
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

    if user.password is not None and str(user.password).strip() != "":
        # Changing another user's password is a dedicated security capability,
        # not a side effect of editing their profile. Self-service password
        # changes must go through /auth/change-password so the current password
        # is verified.
        if existing_user.id == current_user.id:
            raise HTTPException(
                status_code=400,
                detail="Use Profile & Security to change your own password (current password verification is required)",
            )
        require_user_permission(current_user, "Reset User Password", db)
        validate_password_policy(user.password, user=existing_user)
        remember_password_hash(existing_user, existing_user.password_hash)
        existing_user.password_hash = hash_password(user.password)
        existing_user.password_changed_at = utcnow()
        existing_user.force_password_change = "Yes"
        existing_user.failed_login_count = 0
        existing_user.locked_until = None
        existing_user.locked_reason = None
        existing_user.locked_by_user_id = None
        existing_user.security_stamp = generate_security_stamp()
        close_password_reset_requests(
            db,
            current_user,
            existing_user,
            approved=True,
            notes="Password reset from User Master",
            request_path=f"/users/{user_id}",
        )
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
        module_name="User Security" if password_changed else "User Master",
        action="Admin Reset User Password" if password_changed else "Update User",
        current_user=current_user,
        entity_type="User",
        entity_id=existing_user.id,
        entity_label=f"{existing_user.full_name} ({existing_user.username})",
        remarks="Password reset from User Master" if password_changed else "User updated",
        request_path=f"/users/{user_id}",
        details={
            "before": before_data,
            "after": after_data,
            "password_changed": password_changed,
            "sessions_revoked": password_changed,
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