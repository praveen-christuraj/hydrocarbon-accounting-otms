from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, Role, UserRole
from app.schemas import UserRoleSaveRequest, UserRoleResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log

router = APIRouter(prefix="/user-roles", tags=["User Roles"])


@router.get("", response_model=list[UserRoleResponse])
def get_user_roles(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View User Role Assignment",
        db,
    )

    assignments = (
        db.query(UserRole, User, Role)
        .join(User, User.id == UserRole.user_id)
        .join(Role, Role.id == UserRole.role_id)
        .order_by(User.full_name, User.username)
        .all()
    )

    return [
        {
            "id": assignment.id,
            "user_id": user.id,
            "full_name": user.full_name,
            "username": user.username,
            "role_id": role.id,
            "role_name": role.role_name,
        }
        for assignment, user, role in assignments
    ]


@router.post("", response_model=UserRoleResponse)
def save_user_role(
    request: UserRoleSaveRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage User Role Assignment",
        db,
    )

    user = db.query(User).filter(User.id == request.user_id).first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    if user.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active users can be assigned roles",
        )

    role = db.query(Role).filter(Role.id == request.role_id).first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    if role.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active roles can be assigned to users",
        )

    existing_assignment = (
        db.query(UserRole)
        .filter(UserRole.user_id == request.user_id)
        .first()
    )

    if existing_assignment:
        old_role = db.query(Role).filter(Role.id == existing_assignment.role_id).first()

        before_role = {
            "role_id": existing_assignment.role_id,
            "role_name": old_role.role_name if old_role else None,
        }

        after_role = {
            "role_id": role.id,
            "role_name": role.role_name,
        }

        changed = (before_role["role_id"] != after_role["role_id"])

        existing_assignment.role_id = request.role_id

        create_audit_log(
            db=db,
            module_name="User Role Assignment",
            action="Update User Role Assignment",
            current_user=current_user,
            entity_type="User",
            entity_id=user.id,
            entity_label=f"{user.full_name} ({user.username})",
            remarks="User role updated" if changed else "User role saved (no change)",
            request_path="/user-roles",
            details={
                "changed": changed,
                "assignment_id": existing_assignment.id,
                "user": {
                    "user_id": user.id,
                    "full_name": user.full_name,
                    "username": user.username,
                    "status": user.status,
                },
                "before_role": before_role,
                "after_role": after_role,
            },
        )

        db.commit()
        db.refresh(existing_assignment)

        return {
            "id": existing_assignment.id,
            "user_id": user.id,
            "full_name": user.full_name,
            "username": user.username,
            "role_id": role.id,
            "role_name": role.role_name,
        }

    new_assignment = UserRole(
        user_id=request.user_id,
        role_id=request.role_id,
    )

    db.add(new_assignment)
    db.flush()

    create_audit_log(
        db=db,
        module_name="User Role Assignment",
        action="Create User Role Assignment",
        current_user=current_user,
        entity_type="User",
        entity_id=user.id,
        entity_label=f"{user.full_name} ({user.username})",
        remarks="User role assigned",
        request_path="/user-roles",
        details={
            "assignment_id": new_assignment.id,
            "user": {
                "user_id": user.id,
                "full_name": user.full_name,
                "username": user.username,
                "status": user.status,
            },
            "assigned_role": {
                "role_id": role.id,
                "role_name": role.role_name,
            },
        },
    )

    db.commit()
    db.refresh(new_assignment)

    return {
        "id": new_assignment.id,
        "user_id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "role_id": role.id,
        "role_name": role.role_name,
    }


@router.delete("/{assignment_id}")
def delete_user_role(
    assignment_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage User Role Assignment",
        db,
    )

    assignment = db.query(UserRole).filter(UserRole.id == assignment_id).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="User role assignment not found",
        )

    user = db.query(User).filter(User.id == assignment.user_id).first()
    role = db.query(Role).filter(Role.id == assignment.role_id).first()

    create_audit_log(
        db=db,
        module_name="User Role Assignment",
        action="Delete User Role Assignment",
        current_user=current_user,
        entity_type="User",
        entity_id=assignment.user_id,
        entity_label=(
            f"{user.full_name} ({user.username})" if user else f"UserId={assignment.user_id}"
        ),
        remarks="User role assignment deleted",
        request_path=f"/user-roles/{assignment_id}",
        details={
            "assignment_id": assignment.id,
            "user": {
                "user_id": user.id if user else assignment.user_id,
                "full_name": user.full_name if user else None,
                "username": user.username if user else None,
                "status": user.status if user else None,
            },
            "removed_role": {
                "role_id": assignment.role_id,
                "role_name": role.role_name if role else None,
            },
        },
    )

    db.delete(assignment)
    db.commit()

    return {
        "message": "User role assignment deleted successfully"
    }