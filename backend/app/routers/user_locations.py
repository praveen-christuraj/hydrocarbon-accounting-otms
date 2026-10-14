from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import false, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Location, User, UserLocation
from app.schemas import (
    UserAllLocationsUpdateRequest,
    UserLocationItem,
    UserLocationResponse,
    UserLocationSaveRequest,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    ensure_user_in_actor_location_scope,
    get_user_location_codes,
    is_admin_user,
    normalize_location_code,
    require_user_permission,
    user_is_within_actor_location_scope,
)
from app.services.audit_service import create_audit_log

router = APIRouter(prefix="/user-locations", tags=["User Locations"])


def get_location_name(db: Session, location_code: str) -> str:
    loc = (
        db.query(Location)
        .filter(Location.location_code == location_code)
        .first()
    )
    return loc.location_name if loc else location_code


@router.get("", response_model=list[UserLocationItem])
def get_user_locations(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View User Location Assignment", db)

    assignments_query = db.query(UserLocation, User).join(User, User.id == UserLocation.user_id)
    allowed_codes = get_user_location_codes(current_user, db)
    if allowed_codes is not None:
        if not allowed_codes:
            assignments_query = assignments_query.filter(false())
        else:
            assignments_query = assignments_query.filter(
                func.lower(func.trim(UserLocation.location_code)).in_(allowed_codes)
            )
    assignments = assignments_query.order_by(User.full_name, UserLocation.location_code).all()
    if allowed_codes is not None:
        assignments = [
            (assignment, user)
            for assignment, user in assignments
            if (target_codes := get_user_location_codes(user, db)) is not None
            and target_codes.issubset(allowed_codes)
        ]

    return [
        {
            "id": assignment.id,
            "user_id": user.id,
            "full_name": user.full_name,
            "username": user.username,
            "location_code": assignment.location_code,
            "location_name": get_location_name(db, assignment.location_code),
            "created_at": assignment.created_at,
        }
        for assignment, user in assignments
    ]


@router.get("/users", response_model=list[UserLocationResponse])
def get_all_user_location_summaries(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Returns a summary per user: user info + all assigned location codes + all_locations_access flag."""
    require_user_permission(current_user, "View User Location Assignment", db)

    allowed_codes = get_user_location_codes(current_user, db)
    assignments_query = db.query(UserLocation)
    if allowed_codes is not None:
        if not allowed_codes:
            assignments_query = assignments_query.filter(false())
        else:
            assignments_query = assignments_query.filter(
                func.lower(func.trim(UserLocation.location_code)).in_(allowed_codes)
            )
    assignments = assignments_query.order_by(UserLocation.user_id, UserLocation.location_code).all()
    visible_user_ids = {assignment.user_id for assignment in assignments}
    users = db.query(User).order_by(User.full_name).all()
    if allowed_codes is not None:
        users = [
            user
            for user in users
            if user_is_within_actor_location_scope(current_user, user, db)
            and (
                user.id in visible_user_ids
                or get_user_location_codes(user, db) == set()
            )
            and (user.id in visible_user_ids or user.status == "Active")
        ]

    # Build a map: user_id -> list of location_codes visible to this actor.
    user_location_map: dict[int, list[str]] = {}
    for a in assignments:
        user_location_map.setdefault(a.user_id, []).append(a.location_code)

    return [
        {
            "user_id": u.id,
            "full_name": u.full_name,
            "username": u.username,
            "all_locations_access": u.all_locations_access or "No",
            "location_codes": user_location_map.get(u.id, []),
        }
        for u in users
    ]


@router.get("/{user_id}", response_model=UserLocationResponse)
def get_user_location_detail(
    user_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View User Location Assignment", db)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    ensure_user_in_actor_location_scope(current_user, user, db)
    allowed_codes = get_user_location_codes(current_user, db)

    location_query = db.query(UserLocation).filter(UserLocation.user_id == user_id)
    if allowed_codes is not None:
        location_query = location_query.filter(
            func.lower(func.trim(UserLocation.location_code)).in_(allowed_codes)
        )
    location_codes = [
        row.location_code
        for row in location_query.order_by(UserLocation.location_code).all()
    ]

    return {
        "user_id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "all_locations_access": user.all_locations_access or "No",
        "location_codes": location_codes,
    }


@router.put("/{user_id}", response_model=UserLocationResponse)
def save_user_locations(
    user_id: int,
    request: UserLocationSaveRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit User Location Assignment", db)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active users can be assigned locations",
        )
    if is_admin_user(user, db):
        raise HTTPException(status_code=403, detail="The reserved administrator's location assignments cannot be changed")

    allowed_codes = get_user_location_codes(current_user, db)
    if allowed_codes is not None and str(user.all_locations_access or "").strip().casefold() in {"yes", "true", "1", "y"}:
        raise HTTPException(status_code=403, detail="You cannot modify a user with unrestricted location access")

    normalized_requested = [normalize_location_code(code) for code in request.location_codes]
    if any(code is None for code in normalized_requested):
        raise HTTPException(status_code=422, detail="Location codes cannot be empty")
    if len(normalized_requested) != len(set(normalized_requested)):
        raise HTTPException(status_code=422, detail="Duplicate location codes are not allowed")

    # Resolve and store canonical DB values; avoid creating case variants of
    # the same assignment while preserving the database's existing code style.
    locations_by_code = {}
    for normalized_code in normalized_requested:
        location = (
            db.query(Location)
            .filter(func.lower(func.trim(Location.location_code)) == normalized_code)
            .first()
        )
        if not location:
            raise HTTPException(status_code=400, detail=f"Location code '{normalized_code}' not found")
        if location.status != "Active":
            raise HTTPException(status_code=400, detail=f"Location code '{location.location_code}' is not Active")
        locations_by_code[normalized_code] = location

    if allowed_codes is not None:
        if any(code not in allowed_codes for code in normalized_requested):
            raise HTTPException(status_code=403, detail="You cannot assign a location outside your own scope")
        existing_codes = {
            code
            for row in db.query(UserLocation.location_code).filter(UserLocation.user_id == user_id).all()
            if (code := normalize_location_code(row[0])) is not None
        }
        if any(code not in allowed_codes for code in existing_codes):
            raise HTTPException(status_code=403, detail="You cannot modify a user with locations outside your own scope")

    # Get before state for audit
    before_codes = sorted(
        row.location_code
        for row in db.query(UserLocation)
        .filter(UserLocation.user_id == user_id)
        .all()
    )

    # Replace all assignments using canonical location codes.
    db.query(UserLocation).filter(UserLocation.user_id == user_id).delete()
    after_codes = sorted(location.location_code for location in locations_by_code.values())
    for code in after_codes:
        db.add(UserLocation(user_id=user_id, location_code=code))

    changed = set(before_codes) != set(after_codes)

    create_audit_log(
        db=db,
        module_name="User Location Assignment",
        action="Update User Location Assignment",
        current_user=current_user,
        entity_type="User",
        entity_id=user.id,
        entity_label=f"{user.full_name} ({user.username})",
        remarks="User locations updated" if changed else "User locations saved (no change)",
        request_path=f"/user-locations/{user_id}",
        details={
            "changed": changed,
            "user": {
                "user_id": user.id,
                "full_name": user.full_name,
                "username": user.username,
            },
            "before_location_codes": before_codes,
            "after_location_codes": after_codes,
        },
    )

    db.commit()

    return {
        "user_id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "all_locations_access": user.all_locations_access or "No",
        "location_codes": after_codes,
    }


@router.put("/{user_id}/all-locations-access", response_model=UserLocationResponse)
def update_user_all_locations_access(
    user_id: int,
    request: UserAllLocationsUpdateRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit User Location Assignment", db)

    if request.all_locations_access not in ("Yes", "No"):
        raise HTTPException(
            status_code=400,
            detail="all_locations_access must be 'Yes' or 'No'",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if is_admin_user(user, db):
        raise HTTPException(status_code=403, detail="The reserved administrator's location access cannot be changed")
    allowed_codes = get_user_location_codes(current_user, db)
    if allowed_codes is not None:
        ensure_user_in_actor_location_scope(current_user, user, db)
    if request.all_locations_access == "Yes" and allowed_codes is not None:
        raise HTTPException(status_code=403, detail="Only an unrestricted location administrator can grant all-location access")
    if str(user.all_locations_access or "").strip().casefold() in {"yes", "true", "1", "y"} and allowed_codes is not None:
        raise HTTPException(status_code=403, detail="You cannot modify a user who already has unrestricted location access")

    before_value = user.all_locations_access or "No"
    user.all_locations_access = request.all_locations_access

    if before_value != request.all_locations_access:
        create_audit_log(
            db=db,
            module_name="User Location Assignment",
            action="Update User All Locations Access",
            current_user=current_user,
            entity_type="User",
            entity_id=user.id,
            entity_label=f"{user.full_name} ({user.username})",
            remarks=f"All locations access changed: {before_value} → {request.all_locations_access}",
            request_path=f"/user-locations/{user_id}/all-locations-access",
            details={
                "user": {
                    "user_id": user.id,
                    "full_name": user.full_name,
                    "username": user.username,
                },
                "before": before_value,
                "after": request.all_locations_access,
            },
        )

    db.commit()
    db.refresh(user)

    location_codes = [
        row.location_code
        for row in db.query(UserLocation)
        .filter(UserLocation.user_id == user_id)
        .order_by(UserLocation.location_code)
        .all()
    ]

    return {
        "user_id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "all_locations_access": user.all_locations_access,
        "location_codes": location_codes,
    }


@router.delete("/{assignment_id}")
def delete_user_location(
    assignment_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Delete User Location Assignment", db)

    assignment = (
        db.query(UserLocation)
        .filter(UserLocation.id == assignment_id)
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="User location assignment not found",
        )

    user = db.query(User).filter(User.id == assignment.user_id).first()
    if user:
        ensure_user_in_actor_location_scope(current_user, user, db)
    if user and is_admin_user(user, db):
        raise HTTPException(status_code=403, detail="The reserved administrator's location assignments cannot be changed")
    allowed_codes = get_user_location_codes(current_user, db)
    if allowed_codes is not None:
        assignment_code = normalize_location_code(assignment.location_code)
        if assignment_code not in allowed_codes:
            raise HTTPException(status_code=403, detail="Location is outside your assigned scope")
        if user and str(user.all_locations_access or "").strip().casefold() in {"yes", "true", "1", "y"}:
            raise HTTPException(status_code=403, detail="You cannot change a user with unrestricted location access")

    create_audit_log(
        db=db,
        module_name="User Location Assignment",
        action="Delete User Location Assignment",
        current_user=current_user,
        entity_type="User",
        entity_id=assignment.user_id,
        entity_label=(
            f"{user.full_name} ({user.username})"
            if user
            else f"UserId={assignment.user_id}"
        ),
        remarks=f"Location '{assignment.location_code}' removed from user",
        request_path=f"/user-locations/{assignment_id}",
        details={
            "assignment_id": assignment.id,
            "user": {
                "user_id": user.id if user else assignment.user_id,
                "full_name": user.full_name if user else None,
                "username": user.username if user else None,
            },
            "removed_location_code": assignment.location_code,
        },
    )

    db.delete(assignment)
    db.commit()

    return {"message": "User location assignment deleted successfully"}
