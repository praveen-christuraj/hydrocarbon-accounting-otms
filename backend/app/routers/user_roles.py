from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, Role, UserRole
from app.schemas import (
    UserRoleSaveRequest,
    UserRolesReplaceRequest,
    UserRoleResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    ensure_role_assignable_to_user,
    ensure_user_in_actor_location_scope,
    get_user_location_codes,
    is_admin_role,
    is_admin_user,
    require_user_permission,
    user_is_within_actor_location_scope,
)
from app.services.audit_service import create_audit_log

router = APIRouter(prefix="/user-roles", tags=["User Roles"])


def _serialize_assignment(assignment: UserRole, user: User, role: Role):
    return {
        "id": assignment.id,
        "user_id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "role_id": role.id,
        "role_name": role.role_name,
    }


def _resolve_active_roles(db: Session, role_ids: list[int]) -> list[Role]:
    if len(role_ids) != len(set(role_ids)):
        raise HTTPException(status_code=422, detail="Duplicate role IDs are not allowed")
    if not role_ids:
        return []
    roles = (
        db.query(Role)
        .filter(Role.id.in_(role_ids), Role.status == "Active")
        .order_by(Role.id)
        .all()
    )
    if len(roles) != len(role_ids):
        raise HTTPException(status_code=422, detail="One or more roles are invalid or inactive")
    if any(is_admin_role(role) for role in roles):
        raise HTTPException(
            status_code=403,
            detail="The reserved Admin role is managed by system provisioning",
        )
    return roles


def _replace_roles(
    db: Session,
    actor: User,
    user: User,
    roles: list[Role],
    *,
    request_path: str,
):
    if user.status != "Active":
        raise HTTPException(status_code=400, detail="Only Active users can be assigned roles")
    if is_admin_user(user, db):
        raise HTTPException(status_code=403, detail="The reserved administrator account cannot be reassigned")

    existing_rows = (
        db.query(UserRole, Role)
        .join(Role, Role.id == UserRole.role_id)
        .filter(UserRole.user_id == user.id)
        .order_by(Role.role_name, Role.id)
        .all()
    )
    existing_by_id = {role.id: (assignment, role) for assignment, role in existing_rows}
    desired_by_id = {role.id: role for role in roles}

    # A role administrator may only change roles whose active capabilities they
    # themselves hold. This prevents an assignment endpoint becoming an
    # indirect way to grant or remove somebody else's elevated access.
    for _, existing_role in existing_rows:
        ensure_role_assignable_to_user(actor, existing_role, db)
    for role in roles:
        ensure_role_assignable_to_user(actor, role, db)

    if set(existing_by_id) == set(desired_by_id):
        return [
            _serialize_assignment(assignment, user, role)
            for assignment, role in existing_rows
        ], False

    before = [
        {"role_id": role.id, "role_name": role.role_name}
        for _, role in existing_rows
    ]

    for assignment, _ in existing_rows:
        db.delete(assignment)
    db.flush()

    created = []
    for role in roles:
        assignment = UserRole(user_id=user.id, role_id=role.id)
        db.add(assignment)
        created.append((assignment, role))
    db.flush()

    after = [{"role_id": role.id, "role_name": role.role_name} for role in roles]
    create_audit_log(
        db=db,
        module_name="User Role Assignment",
        action="Update User Role Assignment",
        current_user=actor,
        entity_type="User",
        entity_id=user.id,
        entity_label=f"{user.full_name} ({user.username})",
        remarks="User roles updated",
        request_path=request_path,
        details={
            "changed": True,
            "user": {
                "user_id": user.id,
                "full_name": user.full_name,
                "username": user.username,
                "status": user.status,
            },
            "before_roles": before,
            "after_roles": after,
        },
    )
    return [_serialize_assignment(assignment, user, role) for assignment, role in created], True


@router.get("", response_model=list[UserRoleResponse])
def get_user_roles(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View User Role Assignment", db)
    assignments = (
        db.query(UserRole, User, Role)
        .join(User, User.id == UserRole.user_id)
        .join(Role, Role.id == UserRole.role_id)
        .order_by(User.full_name, User.username, Role.role_name, Role.id)
        .all()
    )
    if get_user_location_codes(current_user, db) is not None:
        assignments = [
            (assignment, user, role)
            for assignment, user, role in assignments
            if user_is_within_actor_location_scope(current_user, user, db)
        ]
    return [
        _serialize_assignment(assignment, user, role)
        for assignment, user, role in assignments
    ]


@router.post("", response_model=UserRoleResponse)
def save_user_role(
    request: UserRoleSaveRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Legacy-compatible endpoint: set a user's role list to one role.

    Older clients used POST /user-roles with one role_id and expected it to
    replace the prior assignment. Keep that contract; multi-role clients use
    PUT /user-roles/{user_id} instead.
    """
    require_user_permission(current_user, "Edit User Role Assignment", db)
    user = db.query(User).filter(User.id == request.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    ensure_user_in_actor_location_scope(current_user, user, db)
    roles = _resolve_active_roles(db, [request.role_id])
    results, changed = _replace_roles(
        db, current_user, user, roles, request_path="/user-roles"
    )
    if changed:
        db.commit()
        assignment_id = results[0]["id"] if results else None
        if assignment_id is not None:
            assignment = db.query(UserRole).filter(UserRole.id == assignment_id).first()
            if assignment:
                db.refresh(assignment)
    return results[0]


@router.put("/{user_id}", response_model=list[UserRoleResponse])
def replace_user_roles(
    user_id: int,
    request: UserRolesReplaceRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Atomically replace a user's roles after validating every requested role."""
    require_user_permission(current_user, "Edit User Role Assignment", db)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    ensure_user_in_actor_location_scope(current_user, user, db)
    roles = _resolve_active_roles(db, request.role_ids)
    results, changed = _replace_roles(
        db, current_user, user, roles, request_path=f"/user-roles/{user_id}"
    )
    if changed:
        db.commit()
        for item in results:
            assignment = db.query(UserRole).filter(UserRole.id == item["id"]).first()
            if assignment:
                db.refresh(assignment)
    return results


@router.delete("/{assignment_id}")
def delete_user_role(
    assignment_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Delete User Role Assignment", db)
    assignment = db.query(UserRole).filter(UserRole.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="User role assignment not found")

    user = db.query(User).filter(User.id == assignment.user_id).first()
    role = db.query(Role).filter(Role.id == assignment.role_id).first()
    if user:
        ensure_user_in_actor_location_scope(current_user, user, db)
    if user and is_admin_user(user, db):
        raise HTTPException(status_code=403, detail="The reserved administrator account cannot be reassigned")
    if role and is_admin_role(role):
        raise HTTPException(status_code=403, detail="The reserved Admin role cannot be unassigned")
    if role:
        ensure_role_assignable_to_user(current_user, role, db)

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
    return {"message": "User role assignment deleted successfully"}
