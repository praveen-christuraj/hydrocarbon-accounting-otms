import sqlalchemy
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    User,
    Permission,
    Role,
    RolePermission,
    UserRole,
    UserLocation,
    LocationOperationAvailability,
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
        .join(Role, Role.id == RolePermission.role_id)
        .filter(
            RolePermission.role_id.in_(user_role_ids),
            Permission.permission_name.ilike(permission_name),
            Permission.status == "Active",
            Role.status == "Active",
        )
        .first()
    )

    return permission is not None


def is_admin_user(user: User, db: Session) -> bool:
    """Return whether the authenticated user has the reserved Admin role.

    The legacy bootstrap account name remains a fallback so existing installs
    whose Admin role assignment predates the role seed retain access. New or
    changed role assignments are protected by the RBAC administration routes.
    """
    user_role_names = {
        str(role.role_name or "").strip().casefold()
        for role in (
            db.query(Role)
            .join(UserRole, UserRole.role_id == Role.id)
            .filter(UserRole.user_id == user.id, Role.status == "Active")
            .all()
        )
    }
    if "admin" in user_role_names:
        return True
    return str(user.username or "").strip().casefold() == "admin"


def is_super_admin(user: User, db: Session) -> bool:
    """Compatibility name for the application's reserved Admin capability."""
    return is_admin_user(user, db)


def is_admin_role(role_or_name) -> bool:
    """Identify the reserved bootstrap role without relying on role IDs."""
    role_name = getattr(role_or_name, "role_name", role_or_name)
    return str(role_name or "").strip().casefold() == "admin"


def require_user_permission(
    user: User,
    permission_name: str,
    db: Session,
):
    if is_admin_user(user, db):
        return user

    if not user_has_permission(user, permission_name, db):
        raise HTTPException(
            status_code=403,
            detail=f"Permission required: {permission_name}",
        )

    return user


def user_has_any_permission(
    user: User,
    permission_names,
    db: Session,
) -> bool:
    names = [str(name).strip() for name in permission_names if str(name or "").strip()]
    if not names:
        return False

    user_role_ids = get_user_role_ids(db, user)
    if not user_role_ids:
        return False

    permission = (
        db.query(Permission.id)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(Role, Role.id == RolePermission.role_id)
        .filter(
            RolePermission.role_id.in_(user_role_ids),
            sqlalchemy.or_(*[Permission.permission_name.ilike(name) for name in names]),
            Permission.status == "Active",
            Role.status == "Active",
        )
        .first()
    )

    return permission is not None


def require_any_user_permission(
    user: User,
    permission_names,
    db: Session,
):
    """Allow the request when the user holds at least one of the permissions.

    Used for shared reference lookups (for example Export Operations
    dropdowns) that several modules legitimately read.
    """
    names = [name for name in permission_names if str(name or "").strip()]
    if is_admin_user(user, db):
        return user

    if not user_has_any_permission(user, names, db):
        raise HTTPException(
            status_code=403,
            detail=f"Permission required: one of {', '.join(names)}",
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
        for row in (
            db.query(UserRole)
            .join(Role, Role.id == UserRole.role_id)
            .filter(UserRole.user_id == user.id, Role.status == "Active")
            .all()
        )
    }


def get_user_permissions(user: User, db: Session) -> set[str]:
    """Return the union of active permissions from every active role.

    The permission catalog and role assignments are read from the database on
    every request, so role or permission deactivation takes effect immediately
    and no stale permission claim is trusted from a JWT or browser.
    """
    if is_admin_user(user, db):
        return {
            str(name).strip()
            for (name,) in db.query(Permission.permission_name)
            .filter(Permission.status == "Active")
            .all()
            if str(name or "").strip()
        }

    role_ids = get_user_role_ids(db, user)
    if not role_ids:
        return set()

    rows = (
        db.query(Permission.permission_name)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(Role, Role.id == RolePermission.role_id)
        .filter(
            Role.id.in_(role_ids),
            Role.status == "Active",
            Permission.status == "Active",
        )
        .distinct()
        .all()
    )
    return {
        str(name).strip()
        for (name,) in rows
        if str(name or "").strip()
    }


def get_role_permission_names(role_id: int, db: Session) -> set[str]:
    rows = (
        db.query(Permission.permission_name)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(
            RolePermission.role_id == role_id,
            Permission.status == "Active",
        )
        .all()
    )
    return {str(name).strip() for (name,) in rows if str(name or "").strip()}


def ensure_role_assignable_to_user(actor: User, role: Role, db: Session) -> None:
    """Prevent permission escalation and cross-location mutation via shared roles."""
    if is_admin_user(actor, db):
        return
    if is_admin_role(role):
        raise HTTPException(status_code=403, detail="The reserved Admin role cannot be assigned by this user")

    actor_permissions = {name.strip().casefold() for name in get_user_permissions(actor, db)}
    elevated = {
        name
        for name in get_role_permission_names(role.id, db)
        if name.strip().casefold() not in actor_permissions
    }
    if elevated:
        raise HTTPException(
            status_code=403,
            detail="Cannot assign a role with permissions you do not hold",
        )

    actor_locations = get_user_location_codes(actor, db)
    if actor_locations is not None:
        assigned_users = (
            db.query(User)
            .join(UserRole, UserRole.user_id == User.id)
            .filter(UserRole.role_id == role.id)
            .all()
        )
        if any(
            not user_is_within_actor_location_scope(actor, assigned_user, db)
            for assigned_user in assigned_users
        ):
            raise HTTPException(
                status_code=403,
                detail="This role is assigned to users outside your location scope",
            )


def ensure_role_permissions_within_actor_scope(
    actor: User,
    permission_names: set[str],
    db: Session,
) -> None:
    """Disallow privilege escalation through role-permission assignment."""
    if is_admin_user(actor, db):
        return
    actor_permissions = {name.strip().casefold() for name in get_user_permissions(actor, db)}
    elevated = {
        name for name in permission_names
        if str(name or "").strip().casefold() not in actor_permissions
    }
    if elevated:
        raise HTTPException(
            status_code=403,
            detail="Cannot grant permissions you do not hold",
        )


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


def _normalize_policy_code(value):
    text = str(value or "").strip().lower()
    return text if text else None


def evaluate_operation_workflow_policy(
    db: Session,
    current_user: User,
    action_code: str,
    operation_type_code: str | None,
    operation_template_id: int | None,
    asset_type_code: str | None,
    location_code: str | None,
):
    # Administrators can never be locked out by a mis-configured policy;
    # they are the only ones who can fix the policy in the first place.
    if is_admin_user(current_user, db):
        return True, "Administrator bypass", None

    policies = (
        db.query(OperationWorkflowPolicy)
        .filter(
            OperationWorkflowPolicy.status == "Active",
            OperationWorkflowPolicy.action_code == action_code,
        )
        .order_by(OperationWorkflowPolicy.priority.asc(), OperationWorkflowPolicy.id.asc())
        .all()
    )

    ctx_operation_type = _normalize_policy_code(operation_type_code)
    ctx_asset_type = _normalize_policy_code(asset_type_code)
    ctx_location = _normalize_policy_code(location_code)

    def matches(policy: OperationWorkflowPolicy):
        policy_operation_type = _normalize_policy_code(policy.operation_type_code)
        policy_asset_type = _normalize_policy_code(policy.asset_type_code)
        policy_location = _normalize_policy_code(policy.location_code)
        if policy_operation_type and policy_operation_type != ctx_operation_type:
            return False
        if policy.operation_template_id and policy.operation_template_id != operation_template_id:
            return False
        if policy_asset_type and policy_asset_type != ctx_asset_type:
            return False
        if policy_location and policy_location != ctx_location:
            return False
        return True

    matched = [p for p in policies if matches(p)]
    if len(matched) == 0:
        return None, "No active workflow policy matched this action/context", None

    user_role_ids = {
        row.role_id
        for row in (
            db.query(UserRole)
            .join(Role, Role.id == UserRole.role_id)
            .filter(UserRole.user_id == current_user.id, Role.status == "Active")
            .all()
        )
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

    blocking = matched[0]
    return (
        False,
        (
            f"Workflow policy '{blocking.policy_name}' restricts who may perform this action, "
            "and none of your roles are listed on it. An administrator can add your role "
            "under Operation Workflow Policy."
        ),
        blocking,
    )


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

    ctx_operation_type = _normalize_policy_code(operation_type_code)
    ctx_asset_type = _normalize_policy_code(asset_type_code)
    ctx_location = _normalize_policy_code(location_code)

    for policy in policies:
        if _normalize_policy_code(policy.operation_type_code) and _normalize_policy_code(policy.operation_type_code) != ctx_operation_type:
            continue
        if policy.operation_template_id and policy.operation_template_id != operation_template_id:
            continue
        if _normalize_policy_code(policy.asset_type_code) and _normalize_policy_code(policy.asset_type_code) != ctx_asset_type:
            continue
        if _normalize_policy_code(policy.location_code) and _normalize_policy_code(policy.location_code) != ctx_location:
            continue
        return policy

    return None


def user_can_act_on_operation_task(db: Session, user: User, task):
    if is_admin_user(user, db):
        return True

    assigned_user_ids = set(task.assigned_user_ids_json or [])
    if user.id in assigned_user_ids:
        return True

    assigned_role_ids = set(task.assigned_role_ids_json or [])
    return len(assigned_role_ids.intersection(get_user_role_ids(db, user))) > 0


def build_logged_in_user_response(user: User, db: Session):
    from app.utils.password_policy import build_security_flags

    role_data = None
    roles_data = []
    permissions_data = []

    role_assignments = (
        db.query(UserRole, Role)
        .join(Role, Role.id == UserRole.role_id)
        .filter(UserRole.user_id == user.id, Role.status == "Active")
        .order_by(Role.role_name, Role.id)
        .all()
    )

    for user_role_assignment, role in role_assignments:
        role_payload = {
            "id": role.id,
            "role_name": role.role_name,
            "description": role.description,
            "status": role.status,
        }
        roles_data.append(role_payload)
        if role_data is None:
            role_data = role_payload

    # If admin user, return ALL active permissions regardless of role assignment
    if is_admin_user(user, db):
        all_permissions = (
            db.query(Permission)
            .filter(Permission.status == "Active")
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
            for permission in all_permissions
        ]
    elif roles_data:
        role_ids = [role_entry["id"] for role_entry in roles_data]
        permissions = (
            db.query(Permission)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .join(Role, Role.id == RolePermission.role_id)
            .filter(
                RolePermission.role_id.in_(role_ids),
                Permission.status == "Active",
                Role.status == "Active",
            )
            .order_by(Permission.module_name, Permission.permission_name)
            .distinct()
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

    # Gather location context (normalized so clients cannot misinterpret case variants).
    assigned_location_codes = sorted(
        {
            code
            for row in db.query(UserLocation.location_code)
            .filter(UserLocation.user_id == user.id)
            .all()
            if (code := normalize_location_code(row[0])) is not None
        }
    )
    admin_user = is_admin_user(user, db)
    all_locations_access = "Yes" if admin_user or str(user.all_locations_access or "").strip().casefold() in {"yes", "true", "1", "y"} else "No"

    return {
        "id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "email": user.email,
        "phone": user.phone,
        "department": user.department,
        "designation": user.designation,
        "status": user.status,
        "is_admin": admin_user,
        "security": build_security_flags(user),
        "role": role_data,
        "roles": roles_data,
        "permissions": permissions_data,
        "assigned_location_codes": assigned_location_codes,
        "all_locations_access": all_locations_access,
    }


def normalize_location_code(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip().casefold()
    return normalized or None


def normalize_operation_type_code(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip().casefold()
    return normalized or None


def get_user_location_codes(user: User, db: Session) -> set[str] | None:
    """
    Return assigned location codes, or None for unrestricted location access.

    The reserved Admin account is unrestricted by definition. Existing users
    with the all_locations_access flag set to a legacy truthy value are also
    treated as unrestricted. An empty set means no location data is visible.
    """
    all_access = str(user.all_locations_access or "").strip().casefold()
    if is_admin_user(user, db) or all_access in {"yes", "true", "1", "y"}:
        return None
    codes = (
        db.query(UserLocation.location_code)
        .filter(UserLocation.user_id == user.id)
        .all()
    )
    return {
        normalized_code
        for row in codes
        if (normalized_code := normalize_location_code(row[0])) is not None
    }


def user_is_within_actor_location_scope(actor: User, target: User, db: Session) -> bool:
    """Whether an actor may inspect/manage a target user by location scope.

    Unrestricted actors may manage any account. A restricted actor may manage
    users whose assigned locations are all within the actor's scope; users with
    no assignments remain manageable so they can be provisioned. Accounts with
    all-location access or the reserved Admin identity are not in a restricted
    actor's scope.
    """
    actor_codes = get_user_location_codes(actor, db)
    if actor_codes is None:
        return True
    target_codes = get_user_location_codes(target, db)
    return target_codes is not None and target_codes.issubset(actor_codes)


def ensure_user_in_actor_location_scope(actor: User, target: User, db: Session) -> None:
    if user_is_within_actor_location_scope(actor, target, db):
        return
    raise HTTPException(status_code=404, detail="User not found")


def user_has_location_access(user: User, db: Session, location_code: str | None) -> bool:
    allowed_codes = get_user_location_codes(user, db)
    if allowed_codes is None:
        return True
    normalized_location_code = normalize_location_code(location_code)
    return normalized_location_code is not None and normalized_location_code in allowed_codes


def ensure_location_in_user_scope(
    user: User,
    db: Session,
    location_code: str | None,
    field_label: str = "Location",
):
    if location_code is None or str(location_code).strip() == "":
        return
    if user_has_location_access(user, db, location_code):
        return
    raise HTTPException(
        status_code=403,
        detail=f"{field_label} is not in your assigned scope",
    )


def is_operation_type_available_for_location(
    db: Session,
    location_code: str | None,
    operation_type_code: str | None,
) -> bool:
    normalized_location_code = normalize_location_code(location_code)
    normalized_operation_type_code = normalize_operation_type_code(operation_type_code)

    if normalized_location_code is None or normalized_operation_type_code is None:
        return False

    availability = (
        db.query(LocationOperationAvailability.id)
        .filter(
            LocationOperationAvailability.status == "Active",
            sqlalchemy.func.lower(sqlalchemy.func.trim(LocationOperationAvailability.location_code))
            == normalized_location_code,
            sqlalchemy.func.lower(sqlalchemy.func.trim(LocationOperationAvailability.operation_type_code))
            == normalized_operation_type_code,
        )
        .first()
    )

    return availability is not None


def ensure_operation_type_available_for_location(
    db: Session,
    location_code: str | None,
    operation_type_code: str | None,
):
    if is_operation_type_available_for_location(db, location_code, operation_type_code):
        return
    raise HTTPException(
        status_code=403,
        detail=(
            "The selected operation type is not enabled for the selected origin location. "
            "Update Location Operation Availability before creating or editing this entry."
        ),
    )


def apply_location_filter(query, model, user: User, db: Session, column_name: str = "location_code"):
    """
    Apply location-based filtering to a SQLAlchemy query.
    - If user has all_locations_access == "Yes": no filter applied (returns query unchanged)
    - If user has assigned locations: filters to only those location codes
    - If user has no assigned locations: makes the query return zero results

    Usage:
        query = apply_location_filter(query, MyModel, current_user, db)
        query = apply_location_filter(query, MyModel, current_user, db, column_name="origin_location_code")
    """
    allowed_codes = get_user_location_codes(user, db)
    if allowed_codes is None:
        return query  # unrestricted
    if not allowed_codes:
        return query.filter(sqlalchemy.literal(False))  # no access to any location
    col = getattr(model, column_name)
    return query.filter(sqlalchemy.func.lower(sqlalchemy.func.trim(col)).in_(allowed_codes))
