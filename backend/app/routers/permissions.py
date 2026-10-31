from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Location, Permission, RolePermission, Role, User
from app.schemas import PermissionCreate, PermissionResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import is_admin_user, require_user_permission
from app.services.audit_service import create_audit_log
from app.services.permission_catalog import apply_permission_catalog
from app.utils.default_permissions import ACTION_ORDER, STANDARD_PERMISSIONS, get_permission_catalog
from app.utils.helpers import clean_optional_text, escape_like
from app.utils.pagination import paginate_query

STANDARD_PERMISSION_NAMES = {
    row["permission_name"].strip().casefold() for row in STANDARD_PERMISSIONS
}


def is_standard_permission_name(permission_name: str | None) -> bool:
    return str(permission_name or "").strip().casefold() in STANDARD_PERMISSION_NAMES


def find_permission_by_name(db: Session, permission_name: str, exclude_id: int | None = None):
    """Permission checks match by name, so names must be unique across modules."""
    query = db.query(Permission).filter(
        func.lower(func.trim(Permission.permission_name)) == permission_name.strip().lower()
    )
    if exclude_id is not None:
        query = query.filter(Permission.id != exclude_id)
    return query.first()


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
        query = query.filter(Permission.permission_name.ilike(f"%{escape_like(search)}%", escape="\\"))
    if module_name:
        query = query.filter(Permission.module_name.ilike(f"%{escape_like(module_name)}%", escape="\\"))
    result = paginate_query(query, skip, limit)
    return {
        "items": [PermissionResponse.model_validate(p) for p in result["items"]],
        "total": result["total"],
        "skip": result["skip"],
        "limit": result["limit"],
        "has_more": result["has_more"],
    }


@router.get("/catalog")
def get_standard_permission_catalog(
    current_user: User = Depends(get_current_user_from_token),
):
    """Module-wise CRUD structure of the standard permissions.

    Static metadata (no role or user data): categories follow the navigation
    menu, each module lists its permissions with the CRUD action they map to.
    """
    return {
        "actions": ACTION_ORDER,
        "categories": get_permission_catalog(),
        "total_standard_permissions": len(STANDARD_PERMISSIONS),
    }


@router.post("", response_model=PermissionResponse)
def create_permission(
    permission: PermissionCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Create Permission",
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

    same_name = find_permission_by_name(db, permission.permission_name)
    if same_name:
        raise HTTPException(
            status_code=400,
            detail=f"A permission named '{same_name.permission_name}' already exists in module '{same_name.module_name}'",
        )
    if is_standard_permission_name(permission.permission_name):
        raise HTTPException(
            status_code=400,
            detail="This is a standard permission. Use Sync Standard Permissions to restore it.",
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
        "Edit Permission",
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

    if is_standard_permission_name(existing_permission.permission_name):
        identity_changed = (
            existing_permission.permission_name.strip() != permission.permission_name.strip()
            or existing_permission.module_name.strip() != permission.module_name.strip()
            or (existing_permission.description or None) != clean_optional_text(permission.description)
        )
        if identity_changed:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Standard permissions are maintained by the system catalog. "
                    "Only their status can be changed."
                ),
            )
    else:
        same_name = find_permission_by_name(db, permission.permission_name, exclude_id=permission_id)
        if same_name:
            raise HTTPException(
                status_code=400,
                detail=f"A permission named '{same_name.permission_name}' already exists in module '{same_name.module_name}'",
            )
        if is_standard_permission_name(permission.permission_name):
            raise HTTPException(
                status_code=400,
                detail="A custom permission cannot use the name of a standard permission.",
            )

    access_key_changed = (
        existing_permission.permission_name.strip().casefold() != permission.permission_name.strip().casefold()
        or existing_permission.module_name.strip().casefold() != permission.module_name.strip().casefold()
        or existing_permission.status != permission.status
    )
    if access_key_changed and not is_admin_user(current_user, db):
        raise HTTPException(
            status_code=403,
            detail="Only an administrator may rename, move, or deactivate a permission",
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
        "Delete Permission",
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

    if is_standard_permission_name(existing_permission.permission_name):
        raise HTTPException(
            status_code=400,
            detail="Standard permissions cannot be deleted. Set the status to Inactive instead.",
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
        "Create Permission",
        db,
    )

    result = apply_permission_catalog(db)
    migration = result["migration"]

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
            "created_count": result["created_count"],
            "updated_count": result["updated_count"],
            "existing_count": result["existing_count"],
            "total_standard_permissions": result["total_standard_permissions"],
            "legacy_permissions_removed": migration["legacy_permissions_removed"],
            "role_permissions_granted": migration["role_permissions_granted"],
        },
    )

    db.commit()

    return {
        "message": "Standard permissions seed completed",
        "created_count": result["created_count"],
        "updated_count": result["updated_count"],
        "existing_count": result["existing_count"],
        "total_standard_permissions": result["total_standard_permissions"],
        "legacy_permissions_removed": migration["legacy_permissions_removed"],
        "role_permissions_granted": migration["role_permissions_granted"],
    }


# ---------------------------------------------------------------------------
# Access decision diagnostics ("why can this user see this?")
# ---------------------------------------------------------------------------
# Read-only composition of the four criteria of PERMISSION_CRITERIA_MODEL.md
# for one user and (optionally) one operation ticket. It changes nothing: the
# endpoint only evaluates the same helpers the enforcement path uses, so the
# panel can never disagree with the API - it explains it.

WORKFLOW_ACTION_CODES = [
    "CREATE_ENTRY",
    "EDIT_ENTRY",
    "SUBMIT",
    "APPROVE",
    "REJECT",
    "CANCEL",
    "REVOKE_APPROVAL",
]


@router.get("/access-diagnostic")
def get_access_diagnostic(
    user_id: int = Query(..., description="User whose access is explained"),
    transaction_id: int | None = Query(
        None, description="Optional operation ticket to evaluate the party rule against"
    ),
    action_code: str | None = Query(
        None, description="Optional workflow action code (CREATE_ENTRY, APPROVE, ...)"
    ),
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Access Summary", db)

    target_user = db.query(User).filter(User.id == user_id).first()
    if target_user is None:
        raise HTTPException(status_code=404, detail="User not found")

    from app.dependencies.permissions import (
        TRANSACTION_PARTY_LOCATION_FIELDS,
        evaluate_operation_workflow_policy,
        get_user_location_codes,
        get_user_permissions,
        get_user_role_ids,
        is_operation_type_available_for_location,
        normalize_location_code,
    )
    from app.models import OperationTransaction

    role_ids = set(get_user_role_ids(db, target_user) or [])
    role_names = []
    if role_ids:
        role_names = [
            role.role_name
            for role in db.query(Role).filter(Role.id.in_(role_ids)).order_by(Role.role_name).all()
        ]

    effective_codes = get_user_location_codes(target_user, db)
    assigned_location_codes = None
    if effective_codes is not None:
        # The engine stores normalized (lower-case) codes; show the location
        # master's spelling when it is known so the panel is easy to read.
        stored_codes = {
            str(row.location_code or "").strip().lower(): row.location_code
            for row in db.query(Location).all()
        }
        assigned_location_codes = sorted(
            stored_codes.get(code, code) for code in effective_codes
        )

    criteria = {
        "permission": {
            "is_admin": is_admin_user(target_user, db),
            "roles": role_names,
            "permissions": sorted(get_user_permissions(target_user, db)),
        },
        "location_scope": {
            "all_locations_access": str(target_user.all_locations_access or "").strip().lower()
            in ("yes", "true", "1"),
            "assigned_location_codes": assigned_location_codes,
            "unrestricted": effective_codes is None,
        },
        "operation_availability": None,
        "workflow_policy": None,
    }

    record = None
    resolved_action_code = None

    if transaction_id is not None:
        transaction = (
            db.query(OperationTransaction)
            .filter(OperationTransaction.id == transaction_id)
            .first()
        )
        if transaction is None:
            raise HTTPException(status_code=404, detail="Operation ticket not found")

        party_locations = []
        for field_name in TRANSACTION_PARTY_LOCATION_FIELDS:
            raw_code = getattr(transaction, field_name, None)
            normalized = normalize_location_code(raw_code)
            if normalized is None:
                continue
            party_locations.append(
                {
                    "field": field_name,
                    "location_code": normalized,
                    "in_scope": effective_codes is None or normalized in effective_codes,
                }
            )

        in_scope_codes = [row["location_code"] for row in party_locations if row["in_scope"]]
        if effective_codes is None:
            visible = True
            reason = "Unrestricted location access (all locations)."
        elif not party_locations:
            visible = True
            reason = "Ticket has no populated location (legacy row) - visible to every user."
        elif in_scope_codes:
            visible = True
            reason = (
                "Party rule: at least one party location is inside the assigned scope "
                f"({', '.join(in_scope_codes)})."
            )
        else:
            visible = False
            reason = (
                "Party rule: none of the ticket's party locations (origin, destination, "
                "sender, receiver) is inside the assigned scope."
            )

        criteria["operation_availability"] = {
            "location_code": transaction.origin_location_code,
            "operation_type_code": transaction.operation_type_code,
            "available": is_operation_type_available_for_location(
                db, transaction.origin_location_code, transaction.operation_type_code
            ),
        }

        resolved_action_code = clean_optional_text(action_code)
        if resolved_action_code is not None:
            allowed, policy_reason, policy = evaluate_operation_workflow_policy(
                db=db,
                current_user=target_user,
                action_code=resolved_action_code.upper(),
                operation_type_code=transaction.operation_type_code,
                operation_template_id=transaction.operation_template_id,
                asset_type_code=transaction.primary_asset_type_code,
                location_code=transaction.origin_location_code,
            )
            criteria["workflow_policy"] = {
                "action_code": resolved_action_code.upper(),
                "allowed": allowed,
                "reason": policy_reason,
                "policy_id": getattr(policy, "id", None),
            }

        record = {
            "kind": "ticket",
            "transaction_id": transaction.id,
            "ticket_number": transaction.operation_ticket_number,
            "operation_number": transaction.operation_number,
            "status": transaction.status,
            "origin_location_code": transaction.origin_location_code,
            "destination_location_code": transaction.destination_location_code,
            "sender_location_code": transaction.sender_location_code,
            "receiver_location_code": transaction.receiver_location_code,
            "party_locations": party_locations,
            "visible": visible,
            "reason": reason,
        }

    return {
        "user": {
            "id": target_user.id,
            "username": target_user.username,
            "full_name": target_user.full_name,
            "status": target_user.status,
        },
        "criteria": criteria,
        "record": record,
        "workflow_action_codes": WORKFLOW_ACTION_CODES,
    }
