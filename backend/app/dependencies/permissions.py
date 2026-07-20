from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    User,
    Permission,
    Role,
    RolePermission,
    UserRole,
    OperationWorkflowPolicy,
    OperationWorkflowPolicyRole,
    OperationWorkflowPolicyUser,
)


def user_has_permission(
    user: User,
    permission_name: str,
    db: Session,
):
    user_role_ids = get_user_role_ids(db, user)
    if not user_role_ids:
        return False

    permission = (
        db.query(Permission)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(
            RolePermission.role_id.in_(user_role_ids),
            Permission.permission_name == permission_name,
            Permission.status == "Active",
        )
        .first()
    )

    return permission is not None


def require_user_permission(
    user: User,
    permission_name: str,
    db: Session,
):
    admin_role_names = {"admin"}
    user_role_names = {
        str(r.role_name or "").lower()
        for r in (
            db.query(Role)
            .join(UserRole, UserRole.role_id == Role.id)
            .filter(UserRole.user_id == user.id)
            .all()
        )
        if str(r.role_name or "").strip() != ""
    }

    if user_role_names.intersection(admin_role_names):
        return user

    if not user_has_permission(user, permission_name, db):
        raise HTTPException(
            status_code=403,
            detail=f"Permission required: {permission_name}",
        )

    return user


def get_role_ids_with_permission(db: Session, permission_name: str):
    rows = (
        db.query(Role.id)
        .join(RolePermission, RolePermission.role_id == Role.id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .filter(
            Permission.permission_name.ilike(permission_name),
            Permission.status == "Active",
            Role.status == "Active",
        )
        .all()
    )
    return [row[0] for row in rows]


def get_user_role_ids(db: Session, user: User):
    return {
        row.role_id
        for row in db.query(UserRole).filter(UserRole.user_id == user.id).all()
    }


def get_required_permission_for_status_change(next_status: str):
    status_permission_map = {
        "Draft": "Submit Operation Transaction",
        "Submitted": "Submit Operation Transaction",
        "Approved": "Approve Operation Transaction",
        "Rejected": "Reject Operation Transaction",
        "Cancelled": "Cancel Operation Transaction",
    }

    return status_permission_map.get(next_status)


def get_action_code_for_status_change(next_status: str):
    status_action_map = {
        "Draft": "RECALL",
        "Submitted": "SUBMIT",
        "Approved": "APPROVE",
        "Rejected": "REJECT",
        "Cancelled": "CANCEL",
    }
    return status_action_map.get(next_status)


def evaluate_operation_workflow_policy(
    db: Session,
    current_user: User,
    action_code: str,
    operation_type_code: str | None,
    operation_template_id: int | None,
    asset_type_code: str | None,
    location_code: str | None,
):
    policies = (
        db.query(OperationWorkflowPolicy)
        .filter(
            OperationWorkflowPolicy.status == "Active",
            OperationWorkflowPolicy.action_code == action_code,
        )
        .order_by(OperationWorkflowPolicy.priority.asc(), OperationWorkflowPolicy.id.asc())
        .all()
    )

    def matches(policy: OperationWorkflowPolicy):
        if policy.operation_type_code and policy.operation_type_code != operation_type_code:
            return False
        if policy.operation_template_id and policy.operation_template_id != operation_template_id:
            return False
        if policy.asset_type_code and policy.asset_type_code != asset_type_code:
            return False
        if policy.location_code and policy.location_code != location_code:
            return False
        return True

    matched = [p for p in policies if matches(p)]
    if len(matched) == 0:
        return None, "No active workflow policy matched this action/context", None

    user_role_ids = {
        row.role_id
        for row in db.query(UserRole).filter(UserRole.user_id == current_user.id).all()
    }

    for policy in matched:
        direct_user = (
            db.query(OperationWorkflowPolicyUser)
            .filter(
                OperationWorkflowPolicyUser.policy_id == policy.id,
                OperationWorkflowPolicyUser.user_id == current_user.id,
            )
            .first()
        )
        if direct_user:
            if str(direct_user.mode or "ALLOW").upper() == "DENY":
                return False, "Denied by user override in workflow policy", policy
            return True, "Allowed by user override in workflow policy", policy

        allowed_role_ids = {
            row.role_id
            for row in db.query(OperationWorkflowPolicyRole).filter(
                OperationWorkflowPolicyRole.policy_id == policy.id
            ).all()
        }
        if allowed_role_ids.intersection(user_role_ids):
            return True, "Allowed by role in workflow policy", policy

    return False, "No matching role/user allowance in matched workflow policies", matched[0]


def find_matching_operation_workflow_policy(
    db: Session,
    action_code: str,
    operation_type_code: str | None,
    operation_template_id: int | None,
    asset_type_code: str | None,
    location_code: str | None,
):
    policies = (
        db.query(OperationWorkflowPolicy)
        .filter(
            OperationWorkflowPolicy.status == "Active",
            OperationWorkflowPolicy.action_code == action_code,
        )
        .order_by(OperationWorkflowPolicy.priority.asc(), OperationWorkflowPolicy.id.asc())
        .all()
    )

    for policy in policies:
        if policy.operation_type_code and policy.operation_type_code != operation_type_code:
            continue
        if policy.operation_template_id and policy.operation_template_id != operation_template_id:
            continue
        if policy.asset_type_code and policy.asset_type_code != asset_type_code:
            continue
        if policy.location_code and policy.location_code != location_code:
            continue
        return policy

    return None


def user_can_act_on_operation_task(db: Session, user: User, task):
    role_names = {
        str(r.role_name or "").lower()
        for r in (
            db.query(Role)
            .join(UserRole, UserRole.role_id == Role.id)
            .filter(UserRole.user_id == user.id)
            .all()
        )
    }
    if "admin" in role_names:
        return True

    assigned_user_ids = set(task.assigned_user_ids_json or [])
    if user.id in assigned_user_ids:
        return True

    assigned_role_ids = set(task.assigned_role_ids_json or [])
    return len(assigned_role_ids.intersection(get_user_role_ids(db, user))) > 0


def build_logged_in_user_response(user: User, db: Session):
    from app.utils.password_policy import build_security_flags

    user_role_assignment = (
        db.query(UserRole)
        .join(Role, Role.id == UserRole.role_id)
        .filter(UserRole.user_id == user.id)
        .first()
    )

    role_data = None
    permissions_data = []

    if user_role_assignment:
        role = db.query(Role).filter(Role.id == user_role_assignment.role_id).first()

        if role:
            role_data = {
                "id": role.id,
                "role_name": role.role_name,
                "description": role.description,
                "status": role.status,
            }

            permissions = (
                db.query(Permission)
                .join(RolePermission, RolePermission.permission_id == Permission.id)
                .filter(RolePermission.role_id == role.id)
                .order_by(Permission.module_name, Permission.permission_name)
                .all()
            )

            permissions_data = [
                {
                    "id": permission.id,
                    "permission_name": permission.permission_name,
                    "module_name": permission.module_name,
                    "description": permission.description,
                    "status": permission.status,
                }
                for permission in permissions
            ]

    return {
        "id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "email": user.email,
        "phone": user.phone,
        "department": user.department,
        "designation": user.designation,
        "status": user.status,
        "security": build_security_flags(user),
        "role": role_data,
        "permissions": permissions_data,
    }
