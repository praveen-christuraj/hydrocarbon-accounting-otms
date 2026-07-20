from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, UserRole, Role
from app.schemas import UserCreate, UserUpdate, UserResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.security import hash_password
from app.utils.helpers import clean_optional_text
from app.utils.pagination import paginate_query

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
    result = paginate_query(query, skip, limit)
    return {
        "items": [UserResponse.model_validate(u) for u in result["items"]],
        "total": result["total"],
        "skip": result["skip"],
        "limit": result["limit"],
        "has_more": result["has_more"],
    }


@router.post("", response_model=UserResponse)
def create_user(
    user: UserCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage User",
        db,
    )

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

    new_user = User(
        full_name=user.full_name.strip(),
        username=user.username.strip(),
        email=user.email.strip(),
        phone=clean_optional_text(user.phone),
        department=clean_optional_text(user.department),
        designation=clean_optional_text(user.designation),
        password_hash=hash_password(user.password),
        password_changed_at=datetime.now(timezone.utc),
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
        "Manage User",
        db,
    )

    existing_user = db.query(User).filter(User.id == user_id).first()

    if not existing_user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

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
        existing_user.password_hash = hash_password(user.password)
        existing_user.password_changed_at = datetime.now(timezone.utc)
        existing_user.force_password_change = "Yes"
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
        "Manage User",
        db,
    )

    existing_user = db.query(User).filter(User.id == user_id).first()

    if not existing_user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

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