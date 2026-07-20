from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database import get_db
from app.models import Permission, Role, RolePermission, User
from app.schemas import (
    PermissionResponse,
    RolePermissionResponse,
    RolePermissionSaveRequest,
    RolePermissionItem,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log


def build_role_permission_response(role: Role, permissions_by_role: dict[int, list]):
    assigned_permissions = permissions_by_role.get(role.id, [])
    return {
        "role_id": role.id,
        "role_name": role.role_name,
        "permissions": [
            {
                "id": permission.id,
                "permission_id": permission.id,
                "permission_name": permission.permission_name,
                "module_name": permission.module_name,
                "description": permission.description,
                "status": permission.status,
            }
            for permission in assigned_permissions
        ],
    }


def load_permissions_by_role(db: Session, role_ids: list[int]) -> dict[int, list]:
    if not role_ids:
        return {}
    rows = (
        db.query(Permission, RolePermission.role_id)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id.in_(role_ids))
        .order_by(Permission.module_name, Permission.permission_name)
        .all()
    )
    result: dict[int, list] = {}
    for perm, role_id in rows:
        result.setdefault(role_id, []).append(perm)
    return result


router = APIRouter(prefix="/role-permissions", tags=["Role Permissions"])


@router.get("")
def get_all_role_permissions(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Role Permission Assignment", db)
    roles = db.query(Role).order_by(Role.id).all()
    role_ids = [r.id for r in roles]
    permissions_by_role = load_permissions_by_role(db, role_ids)
    return [
        build_role_permission_response(role, permissions_by_role)
        for role in roles
    ]


@router.get("/{role_id}", response_model=RolePermissionResponse)
def get_role_permissions(
    role_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Role Permission Assignment",
        db,
    )

    role = db.query(Role).filter(Role.id == role_id).first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    permissions_by_role = load_permissions_by_role(db, [role.id])
    return build_role_permission_response(role, permissions_by_role)


@router.post("/{role_id}", response_model=RolePermissionResponse)
def save_role_permissions(
    role_id: int,
    request: RolePermissionSaveRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Role Permission Assignment",
        db,
    )

    role = db.query(Role).filter(Role.id == role_id).first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    before_assigned_permissions = (
        db.query(Permission)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id == role_id)
        .order_by(Permission.module_name, Permission.permission_name)
        .all()
    )

    before_permission_ids = [p.id for p in before_assigned_permissions]

    before_permissions_info = [
        {
            "id": p.id,
            "permission_name": p.permission_name,
            "module_name": p.module_name,
            "status": p.status,
        }
        for p in before_assigned_permissions
    ]

    if len(request.permission_ids) != len(set(request.permission_ids)):
        raise HTTPException(
            status_code=400,
            detail="Duplicate permission IDs are not allowed",
        )

    permissions = (
        db.query(Permission)
        .filter(Permission.id.in_(request.permission_ids))
        .order_by(Permission.module_name, Permission.permission_name)
        .all()
    )

    if len(permissions) != len(request.permission_ids):
        raise HTTPException(
            status_code=400,
            detail="One or more permission IDs are invalid",
        )

    after_permission_ids = sorted(request.permission_ids)

    after_permissions_info = [
        {
            "id": p.id,
            "permission_name": p.permission_name,
            "module_name": p.module_name,
            "status": p.status,
        }
        for p in permissions
    ]

    before_set = set(before_permission_ids)
    after_set = set(after_permission_ids)

    added_permission_ids = sorted(list(after_set - before_set))
    removed_permission_ids = sorted(list(before_set - after_set))

    changed = (len(added_permission_ids) > 0) or (len(removed_permission_ids) > 0)

    db.query(RolePermission).filter(
        RolePermission.role_id == role_id
    ).delete()

    for permission_id in after_permission_ids:
        db.add(
            RolePermission(
                role_id=role_id,
                permission_id=permission_id,
            )
        )

    create_audit_log(
        db=db,
        module_name="Role Permission Assignment",
        action="Update Role Permission Assignment",
        current_user=current_user,
        entity_type="Role",
        entity_id=role.id,
        entity_label=role.role_name,
        remarks=(
            "Role permissions updated"
            if changed
            else "Role permissions saved (no change)"
        ),
        request_path=f"/role-permissions/{role_id}",
        details={
            "role": {
                "id": role.id,
                "role_name": role.role_name,
            },
            "changed": changed,
            "before_permission_ids": sorted(before_permission_ids),
            "after_permission_ids": after_permission_ids,
            "added_permission_ids": added_permission_ids,
            "removed_permission_ids": removed_permission_ids,
            "before_permissions": before_permissions_info,
            "after_permissions": after_permissions_info,
            "counts": {
                "before": len(before_permission_ids),
                "after": len(after_permission_ids),
                "added": len(added_permission_ids),
                "removed": len(removed_permission_ids),
            },
        },
    )

    db.commit()

    return build_role_permission_response(role, db)