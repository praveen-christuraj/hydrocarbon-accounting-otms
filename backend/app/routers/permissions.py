from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Permission, RolePermission, Role, User
from app.schemas import PermissionCreate, PermissionResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.default_permissions import STANDARD_PERMISSIONS
from app.utils.helpers import clean_optional_text
from app.utils.pagination import paginate_query

router = APIRouter(prefix="/permissions", tags=["Permissions"])


@router.get("")
def get_permissions(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None),
    module_name: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Permission", db)
    query = db.query(Permission).order_by(Permission.id)
    if search:
        query = query.filter(Permission.permission_name.ilike(f"%{search}%"))
    if module_name:
        query = query.filter(Permission.module_name.ilike(f"%{module_name}%"))
    result = paginate_query(query, skip, limit)
    return {
        "items": [PermissionResponse.model_validate(p) for p in result["items"]],
        "total": result["total"],
        "skip": result["skip"],
        "limit": result["limit"],
        "has_more": result["has_more"],
    }


@router.post("", response_model=PermissionResponse)
def create_permission(
    permission: PermissionCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Permission",
        db,
    )

    existing_permission = (
        db.query(Permission)
        .filter(
            Permission.permission_name.ilike(permission.permission_name),
            Permission.module_name.ilike(permission.module_name),
        )
        .first()
    )

    if existing_permission:
        raise HTTPException(
            status_code=400,
            detail="Permission already exists for this module",
        )

    new_permission = Permission(
        permission_name=permission.permission_name.strip(),
        module_name=permission.module_name.strip(),
        description=clean_optional_text(permission.description),
        status=permission.status,
    )

    db.add(new_permission)
    db.flush()

    after_data = {
        "permission_name": new_permission.permission_name,
        "module_name": new_permission.module_name,
        "description": new_permission.description,
        "status": new_permission.status,
    }

    create_audit_log(
        db=db,
        module_name="Permission Master",
        action="Create Permission",
        current_user=current_user,
        entity_type="Permission",
        entity_id=new_permission.id,
        entity_label=f"{new_permission.module_name} - {new_permission.permission_name}",
        remarks="Permission created",
        request_path="/permissions",
        details={
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(new_permission)

    return new_permission


@router.put("/{permission_id}", response_model=PermissionResponse)
def update_permission(
    permission_id: int,
    permission: PermissionCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Permission",
        db,
    )

    existing_permission = (
        db.query(Permission)
        .filter(Permission.id == permission_id)
        .first()
    )

    if not existing_permission:
        raise HTTPException(
            status_code=404,
            detail="Permission not found",
        )

    duplicate_permission = (
        db.query(Permission)
        .filter(
            Permission.permission_name.ilike(permission.permission_name),
            Permission.module_name.ilike(permission.module_name),
            Permission.id != permission_id,
        )
        .first()
    )

    if duplicate_permission:
        raise HTTPException(
            status_code=400,
            detail="Permission already exists for this module",
        )

    before_data = {
        "permission_name": existing_permission.permission_name,
        "module_name": existing_permission.module_name,
        "description": existing_permission.description,
        "status": existing_permission.status,
    }

    existing_permission.permission_name = permission.permission_name.strip()
    existing_permission.module_name = permission.module_name.strip()
    existing_permission.description = clean_optional_text(permission.description)
    existing_permission.status = permission.status

    after_data = {
        "permission_name": existing_permission.permission_name,
        "module_name": existing_permission.module_name,
        "description": existing_permission.description,
        "status": existing_permission.status,
    }

    create_audit_log(
        db=db,
        module_name="Permission Master",
        action="Update Permission",
        current_user=current_user,
        entity_type="Permission",
        entity_id=existing_permission.id,
        entity_label=f"{existing_permission.module_name} - {existing_permission.permission_name}",
        remarks="Permission updated",
        request_path=f"/permissions/{permission_id}",
        details={
            "before": before_data,
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(existing_permission)

    return existing_permission


@router.delete("/{permission_id}")
def delete_permission(
    permission_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Permission",
        db,
    )

    existing_permission = (
        db.query(Permission)
        .filter(Permission.id == permission_id)
        .first()
    )

    if not existing_permission:
        raise HTTPException(
            status_code=404,
            detail="Permission not found",
        )

    role_permission = (
        db.query(RolePermission)
        .filter(RolePermission.permission_id == permission_id)
        .first()
    )

    if role_permission:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete permission because it is assigned to roles",
        )

    deleted_data = {
        "permission_name": existing_permission.permission_name,
        "module_name": existing_permission.module_name,
        "description": existing_permission.description,
        "status": existing_permission.status,
    }

    create_audit_log(
        db=db,
        module_name="Permission Master",
        action="Delete Permission",
        current_user=current_user,
        entity_type="Permission",
        entity_id=existing_permission.id,
        entity_label=f"{existing_permission.module_name} - {existing_permission.permission_name}",
        remarks="Permission deleted",
        request_path=f"/permissions/{permission_id}",
        details={
            "deleted": deleted_data,
        },
    )

    db.delete(existing_permission)
    db.commit()

    return {
        "message": "Permission deleted successfully"
    }


@router.post("/seed-standard")
def seed_standard_permissions(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Permission",
        db,
    )

    standard_permissions = STANDARD_PERMISSIONS

    created_count = 0
    existing_count = 0

    for permission_data in standard_permissions:
        existing_permission = (
            db.query(Permission)
            .filter(
                Permission.permission_name.ilike(permission_data["permission_name"]),
                Permission.module_name.ilike(permission_data["module_name"]),
            )
            .first()
        )

        if existing_permission:
            existing_count += 1
            continue

        new_permission = Permission(
            permission_name=permission_data["permission_name"],
            module_name=permission_data["module_name"],
            description=permission_data["description"],
            status="Active",
        )

        db.add(new_permission)
        created_count += 1

    create_audit_log(
        db=db,
        module_name="Permission Master",
        action="Seed Standard Permissions",
        current_user=current_user,
        entity_type="Permission",
        entity_id=None,
        entity_label="Standard Permission Seed",
        remarks="Seeded standard permissions",
        request_path="/permissions/seed-standard",
        details={
            "created_count": created_count,
            "existing_count": existing_count,
            "total_standard_permissions": len(standard_permissions),
        },
    )

    db.commit()

    return {
        "message": "Standard permissions seed completed",
        "created_count": created_count,
        "existing_count": existing_count,
        "total_standard_permissions": len(standard_permissions),
    }