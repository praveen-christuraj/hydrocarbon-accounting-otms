from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Role, User, UserRole, RolePermission
from app.schemas import RoleCreate, RoleResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text
from app.utils.pagination import paginate_query

router = APIRouter(prefix="/roles", tags=["Roles"])


@router.get("")
def get_roles(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None),
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Role", db)
    query = db.query(Role).order_by(Role.id)
    if search:
        query = query.filter(Role.role_name.ilike(f"%{search}%"))
    result = paginate_query(query, skip, limit)
    return {
        "items": [RoleResponse.model_validate(r) for r in result["items"]],
        "total": result["total"],
        "skip": result["skip"],
        "limit": result["limit"],
        "has_more": result["has_more"],
    }


@router.post("", response_model=RoleResponse)
def create_role(
    role: RoleCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Role",
        db,
    )

    existing_role = (
        db.query(Role)
        .filter(Role.role_name.ilike(role.role_name))
        .first()
    )

    if existing_role:
        raise HTTPException(
            status_code=400,
            detail="Role name already exists",
        )

    new_role = Role(
        role_name=role.role_name.strip(),
        description=clean_optional_text(role.description),
        status=role.status,
    )

    db.add(new_role)
    db.flush()

    role_data = {
        "role_name": new_role.role_name,
        "description": new_role.description,
        "status": new_role.status,
    }

    create_audit_log(
        db=db,
        module_name="Role Master",
        action="Create Role",
        current_user=current_user,
        entity_type="Role",
        entity_id=new_role.id,
        entity_label=new_role.role_name,
        remarks="Role created",
        request_path="/roles",
        details={
            "after": role_data,
        },
    )

    db.commit()
    db.refresh(new_role)

    return new_role


@router.put("/{role_id}", response_model=RoleResponse)
def update_role(
    role_id: int,
    role: RoleCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Role",
        db,
    )

    existing_role = db.query(Role).filter(Role.id == role_id).first()

    if not existing_role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    duplicate_role = (
        db.query(Role)
        .filter(
            Role.role_name.ilike(role.role_name),
            Role.id != role_id,
        )
        .first()
    )

    if duplicate_role:
        raise HTTPException(
            status_code=400,
            detail="Role name already exists",
        )

    old_role_data = {
        "role_name": existing_role.role_name,
        "description": existing_role.description,
        "status": existing_role.status,
    }

    existing_role.role_name = role.role_name.strip()
    existing_role.description = clean_optional_text(role.description)
    existing_role.status = role.status

    new_role_data = {
        "role_name": existing_role.role_name,
        "description": existing_role.description,
        "status": existing_role.status,
    }

    create_audit_log(
        db=db,
        module_name="Role Master",
        action="Update Role",
        current_user=current_user,
        entity_type="Role",
        entity_id=existing_role.id,
        entity_label=existing_role.role_name,
        remarks="Role updated",
        request_path=f"/roles/{role_id}",
        details={
            "before": old_role_data,
            "after": new_role_data,
        },
    )

    db.commit()
    db.refresh(existing_role)

    return existing_role


@router.delete("/{role_id}")
def delete_role(
    role_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Role",
        db,
    )

    existing_role = db.query(Role).filter(Role.id == role_id).first()

    if not existing_role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    user_role = db.query(UserRole).filter(UserRole.role_id == role_id).first()

    if user_role:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete role because it is assigned to users",
        )

    role_permission = (
        db.query(RolePermission)
        .filter(RolePermission.role_id == role_id)
        .first()
    )

    if role_permission:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete role because permissions are assigned to it",
        )

    deleted_role_data = {
        "role_name": existing_role.role_name,
        "description": existing_role.description,
        "status": existing_role.status,
    }

    create_audit_log(
        db=db,
        module_name="Role Master",
        action="Delete Role",
        current_user=current_user,
        entity_type="Role",
        entity_id=existing_role.id,
        entity_label=existing_role.role_name,
        remarks="Role deleted",
        request_path=f"/roles/{role_id}",
        details={
            "deleted": deleted_role_data,
        },
    )

    db.delete(existing_role)
    db.commit()

    return {
        "message": "Role deleted successfully"
    }