"""Per-role location scope (PERMISSION_CRITERIA_MODEL.md section 7.2).

Location scope is evaluated in one place - ``get_user_location_codes`` in
``app/dependencies/permissions.py`` - and is the **additive union** of the
locations assigned directly to the user and the locations of every active role
the user holds. This router manages the role side of that union:

* ``GET /role-locations``               - every role with its location codes
* ``GET /role-locations/{role_id}``     - one role
* ``PUT /role-locations/{role_id}``     - replace the role's location codes

Mutations keep the same order of checks as every other endpoint
(authentication -> permission -> location scope -> audit) and a
location-restricted administrator can only hand out locations they hold
themselves.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Location, Role, RoleLocation, User
from app.schemas import RoleLocationResponse, RoleLocationSaveRequest
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    get_user_location_codes,
    is_admin_role,
    normalize_location_code,
    require_user_permission,
)
from app.services.audit_service import create_audit_log

router = APIRouter(prefix="/role-locations", tags=["Role Locations"])

MODULE_NAME = "Role Location Assignment"


def _role_or_404(db: Session, role_id: int) -> Role:
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    return role


def _role_location_codes(db: Session, role_id: int) -> list[str]:
    return [
        row.location_code
        for row in (
            db.query(RoleLocation)
            .filter(RoleLocation.role_id == role_id)
            .order_by(RoleLocation.location_code)
            .all()
        )
    ]


def _role_status(role: Role) -> str:
    return role.status or "Active"


def _ensure_role_in_actor_scope(role: Role, current_user: User, db: Session) -> None:
    """A restricted actor cannot see a role holding locations outside their scope.

    The Admin role is unrestricted by definition, so it is never returned to a
    restricted actor - the same rule the user-location endpoints apply to users
    with all-location access.
    """
    allowed_codes = get_user_location_codes(current_user, db)
    if allowed_codes is None:
        return

    if is_admin_role(role):
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    existing_codes = {
        code
        for code in (
            normalize_location_code(raw)
            for raw in _role_location_codes(db, role.id)
        )
        if code is not None
    }
    if not existing_codes.issubset(allowed_codes):
        raise HTTPException(
            status_code=403,
            detail="Role has locations outside your own scope",
        )


@router.get("", response_model=list[RoleLocationResponse])
def get_role_locations(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Role Location Assignment", db)

    allowed_codes = get_user_location_codes(current_user, db)
    roles = db.query(Role).order_by(Role.id).all()

    results = []
    for role in roles:
        if allowed_codes is None:
            results.append(
                {
                    "role_id": role.id,
                    "role_name": role.role_name,
                    "status": _role_status(role),
                    "location_codes": _role_location_codes(db, role.id),
                }
            )
            continue

        if is_admin_role(role):
            # Unrestricted role - not visible to a location-scoped actor.
            continue

        existing_codes = [
            code
            for code in (
                normalize_location_code(raw)
                for raw in _role_location_codes(db, role.id)
            )
            if code is not None
        ]
        if not set(existing_codes).issubset(allowed_codes):
            continue

        results.append(
            {
                "role_id": role.id,
                "role_name": role.role_name,
                "status": _role_status(role),
                "location_codes": _role_location_codes(db, role.id),
            }
        )

    return results


@router.get("/{role_id}", response_model=RoleLocationResponse)
def get_role_location_detail(
    role_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Role Location Assignment", db)

    role = _role_or_404(db, role_id)
    _ensure_role_in_actor_scope(role, current_user, db)

    allowed_codes = get_user_location_codes(current_user, db)
    location_codes = _role_location_codes(db, role_id)

    if allowed_codes is not None:
        location_codes = [
            code
            for code in location_codes
            if normalize_location_code(code) in allowed_codes
        ]

    return {
        "role_id": role.id,
        "role_name": role.role_name,
        "status": _role_status(role),
        "location_codes": location_codes,
    }


@router.put("/{role_id}", response_model=RoleLocationResponse)
def save_role_locations(
    role_id: int,
    request: RoleLocationSaveRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit Role Location Assignment", db)

    role = _role_or_404(db, role_id)

    if is_admin_role(role):
        raise HTTPException(
            status_code=403,
            detail="The reserved Admin role always has unrestricted location access",
        )

    if role.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active roles can be assigned locations",
        )

    normalized_requested = [
        normalize_location_code(code) for code in request.location_codes
    ]
    if any(code is None for code in normalized_requested):
        raise HTTPException(status_code=422, detail="Location codes cannot be empty")
    if len(normalized_requested) != len(set(normalized_requested)):
        raise HTTPException(
            status_code=422, detail="Duplicate location codes are not allowed"
        )

    # Resolve and store canonical DB values (same rule as user locations).
    locations_by_code = {}
    for normalized_code in normalized_requested:
        location = (
            db.query(Location)
            .filter(func.lower(func.trim(Location.location_code)) == normalized_code)
            .first()
        )
        if not location:
            raise HTTPException(
                status_code=400, detail=f"Location code '{normalized_code}' not found"
            )
        if location.status != "Active":
            raise HTTPException(
                status_code=400,
                detail=f"Location code '{location.location_code}' is not Active",
            )
        locations_by_code[normalized_code] = location

    # Location scope: a restricted administrator may only hand out locations
    # they hold themselves, and may not touch a role that already reaches
    # outside their scope (mirrors the user-location endpoint).
    allowed_codes = get_user_location_codes(current_user, db)
    if allowed_codes is not None:
        if any(code not in allowed_codes for code in normalized_requested):
            raise HTTPException(
                status_code=403,
                detail="You cannot assign a location outside your own scope",
            )
        existing_codes = {
            code
            for code in (
                normalize_location_code(raw)
                for raw in _role_location_codes(db, role.id)
            )
            if code is not None
        }
        if any(code not in allowed_codes for code in existing_codes):
            raise HTTPException(
                status_code=403,
                detail="You cannot modify a role with locations outside your own scope",
            )

    before_codes = sorted(_role_location_codes(db, role_id))
    db.query(RoleLocation).filter(RoleLocation.role_id == role_id).delete()
    after_codes = sorted(
        location.location_code for location in locations_by_code.values()
    )
    for code in after_codes:
        db.add(RoleLocation(role_id=role_id, location_code=code))

    changed = set(before_codes) != set(after_codes)

    create_audit_log(
        db=db,
        module_name=MODULE_NAME,
        action="Update Role Location Assignment",
        current_user=current_user,
        entity_type="Role",
        entity_id=role.id,
        entity_label=role.role_name,
        remarks=(
            "Role locations updated" if changed else "Role locations saved (no change)"
        ),
        request_path=f"/role-locations/{role_id}",
        details={
            "changed": changed,
            "role": {"role_id": role.id, "role_name": role.role_name},
            "before_location_codes": before_codes,
            "after_location_codes": after_codes,
        },
    )

    db.commit()

    return {
        "role_id": role.id,
        "role_name": role.role_name,
        "status": _role_status(role),
        "location_codes": after_codes,
    }
