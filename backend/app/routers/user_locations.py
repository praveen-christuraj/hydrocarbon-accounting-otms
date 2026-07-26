from fastapi import APIRouter, Depends, HTTPException
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
from app.dependencies.permissions import require_user_permission
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

    assignments = (
        db.query(UserLocation, User)
        .join(User, User.id == UserLocation.user_id)
        .order_by(User.full_name, UserLocation.location_code)
        .all()
    )

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

    users = db.query(User).order_by(User.full_name).all()

    # Build a map: user_id -> list of location_codes
    assignments = (
        db.query(UserLocation)
        .order_by(UserLocation.user_id, UserLocation.location_code)
        .all()
    )
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
    require_user_permission(current_user, "Manage User Location Assignment", db)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active users can be assigned locations",
        )

    # Validate all location codes exist
    for code in request.location_codes:
        loc = (
            db.query(Location)
            .filter(Location.location_code == code)
            .first()
        )
        if not loc:
            raise HTTPException(
                status_code=400,
                detail=f"Location code '{code}' not found",
            )

    # Get before state for audit
    before_codes = sorted(
        row.location_code
        for row in db.query(UserLocation)
        .filter(UserLocation.user_id == user_id)
        .all()
    )

    # Replace all assignments
    db.query(UserLocation).filter(UserLocation.user_id == user_id).delete()

    for code in request.location_codes:
        db.add(UserLocation(user_id=user_id, location_code=code))

    after_codes = sorted(request.location_codes)

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
    require_user_permission(current_user, "Manage User Location Assignment", db)

    if request.all_locations_access not in ("Yes", "No"):
        raise HTTPException(
            status_code=400,
            detail="all_locations_access must be 'Yes' or 'No'",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

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
    require_user_permission(current_user, "Manage User Location Assignment", db)

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
