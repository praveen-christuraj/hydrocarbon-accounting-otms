from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session
from datetime import date, time

from app.database import get_db
from app.utils.pagination import paginate_query
from app.models import Location, LocationAccountingDaySetting, User
from app.schemas import (
    LocationCreate,
    LocationResponse,
    LocationAccountingDaySettingCreate,
    LocationAccountingDaySettingResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text

router = APIRouter(prefix="/locations", tags=["Locations"])


# -------------------------
# Location CRUD
# -------------------------

@router.get("")
def get_locations(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Location", db)
    query = db.query(Location).order_by(Location.id)
    if search:
        query = query.filter(
            or_(
                Location.location_name.ilike(f"%{search}%"),
                Location.location_code.ilike(f"%{search}%"),
            )
        )
    result = paginate_query(query, skip, limit)
    return {
        "items": [LocationResponse.model_validate(l) for l in result["items"]],
        "total": result["total"],
        "skip": result["skip"],
        "limit": result["limit"],
        "has_more": result["has_more"],
    }


@router.post("", response_model=LocationResponse)
def create_location(
    location: LocationCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Location", db)

    existing_location = (
        db.query(Location)
        .filter(Location.location_code.ilike(location.location_code))
        .first()
    )

    if existing_location:
        raise HTTPException(status_code=400, detail="Location code already exists")

    if location.parent_location_code:
        parent_location = (
            db.query(Location)
            .filter(Location.location_code.ilike(location.parent_location_code))
            .first()
        )

        if not parent_location:
            raise HTTPException(status_code=400, detail="Parent location not found")

    new_location = Location(
        location_name=location.location_name,
        location_code=location.location_code,
        location_type=location.location_type,
        parent_location_code=location.parent_location_code,
        description=location.description,
        status=location.status,
    )

    db.add(new_location)
    db.flush()

    after_data = {
        "location_name": new_location.location_name,
        "location_code": new_location.location_code,
        "location_type": new_location.location_type,
        "parent_location_code": new_location.parent_location_code,
        "description": new_location.description,
        "status": new_location.status,
    }

    create_audit_log(
        db=db,
        module_name="Location Master",
        action="Create Location",
        current_user=current_user,
        entity_type="Location",
        entity_id=new_location.id,
        entity_label=f"{new_location.location_name} ({new_location.location_code})",
        remarks="Location created",
        request_path="/locations",
        details={"after": after_data},
    )

    db.commit()
    db.refresh(new_location)
    return new_location


@router.put("/{location_id}", response_model=LocationResponse)
def update_location(
    location_id: int,
    location: LocationCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Location", db)

    existing_location = db.query(Location).filter(Location.id == location_id).first()

    if not existing_location:
        raise HTTPException(status_code=404, detail="Location not found")

    duplicate_location = (
        db.query(Location)
        .filter(
            Location.location_code.ilike(location.location_code),
            Location.id != location_id,
        )
        .first()
    )

    if duplicate_location:
        raise HTTPException(status_code=400, detail="Location code already exists")

    if (
        location.parent_location_code
        and location.parent_location_code.lower() == location.location_code.lower()
    ):
        raise HTTPException(status_code=400, detail="Location cannot be its own parent")

    if location.parent_location_code:
        parent_location = (
            db.query(Location)
            .filter(Location.location_code.ilike(location.parent_location_code))
            .first()
        )

        if not parent_location:
            raise HTTPException(status_code=400, detail="Parent location not found")

    before_data = {
        "location_name": existing_location.location_name,
        "location_code": existing_location.location_code,
        "location_type": existing_location.location_type,
        "parent_location_code": existing_location.parent_location_code,
        "description": existing_location.description,
        "status": existing_location.status,
    }

    existing_location.location_name = location.location_name
    existing_location.location_code = location.location_code
    existing_location.location_type = location.location_type
    existing_location.parent_location_code = location.parent_location_code
    existing_location.description = location.description
    existing_location.status = location.status

    after_data = {
        "location_name": existing_location.location_name,
        "location_code": existing_location.location_code,
        "location_type": existing_location.location_type,
        "parent_location_code": existing_location.parent_location_code,
        "description": existing_location.description,
        "status": existing_location.status,
    }

    create_audit_log(
        db=db,
        module_name="Location Master",
        action="Update Location",
        current_user=current_user,
        entity_type="Location",
        entity_id=existing_location.id,
        entity_label=f"{existing_location.location_name} ({existing_location.location_code})",
        remarks="Location updated",
        request_path=f"/locations/{location_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing_location)
    return existing_location


@router.delete("/{location_id}")
def delete_location(
    location_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Location", db)

    existing_location = db.query(Location).filter(Location.id == location_id).first()

    if not existing_location:
        raise HTTPException(status_code=404, detail="Location not found")

    child_location = (
        db.query(Location)
        .filter(Location.parent_location_code.ilike(existing_location.location_code))
        .first()
    )

    if child_location:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete location because it is used as a parent location",
        )

    deleted_data = {
        "location_name": existing_location.location_name,
        "location_code": existing_location.location_code,
        "location_type": existing_location.location_type,
        "parent_location_code": existing_location.parent_location_code,
        "description": existing_location.description,
        "status": existing_location.status,
    }

    create_audit_log(
        db=db,
        module_name="Location Master",
        action="Delete Location",
        current_user=current_user,
        entity_type="Location",
        entity_id=existing_location.id,
        entity_label=f"{existing_location.location_name} ({existing_location.location_code})",
        remarks="Location deleted",
        request_path=f"/locations/{location_id}",
        details={"deleted": deleted_data},
    )

    db.delete(existing_location)
    db.commit()

    return {"message": "Location deleted successfully"}


# -------------------------
# Location Accounting Day Setting CRUD
# -------------------------

def build_location_accounting_day_setting_response(
    setting: LocationAccountingDaySetting,
    db: Session,
):
    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(setting.location_code))
        .first()
    )

    return {
        "id": setting.id,
        "location_code": setting.location_code,
        "location_name": location.location_name if location else "",
        "day_start_time": setting.day_start_time,
        "day_end_time": setting.day_end_time,
        "effective_from": setting.effective_from,
        "effective_to": setting.effective_to,
        "timezone_name": setting.timezone_name,
        "description": setting.description,
        "status": setting.status,
        "created_at": setting.created_at,
        "updated_at": setting.updated_at,
    }


def build_location_accounting_day_setting_audit_snapshot(
    setting: LocationAccountingDaySetting,
    db: Session,
):
    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(setting.location_code))
        .first()
    )

    return {
        "id": setting.id,
        "location_code": setting.location_code,
        "location_name": location.location_name if location else "",
        "day_start_time": setting.day_start_time.strftime("%H:%M:%S")
        if setting.day_start_time
        else None,
        "day_end_time": setting.day_end_time.strftime("%H:%M:%S")
        if setting.day_end_time
        else None,
        "effective_from": str(setting.effective_from)
        if setting.effective_from
        else None,
        "effective_to": str(setting.effective_to)
        if setting.effective_to
        else None,
        "timezone_name": setting.timezone_name,
        "description": setting.description,
        "status": setting.status,
    }


def validate_location_accounting_day_setting(
    setting: LocationAccountingDaySettingCreate,
    db: Session,
    setting_id: int | None = None,
):
    location_code = str(setting.location_code or "").strip().upper()

    if location_code == "":
        raise HTTPException(
            status_code=400,
            detail="Location is required",
        )

    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(location_code))
        .first()
    )

    if not location:
        raise HTTPException(
            status_code=400,
            detail="Location not found",
        )

    if location.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active locations can be configured",
        )

    if setting.effective_to is not None:
        if setting.effective_to < setting.effective_from:
            raise HTTPException(
                status_code=400,
                detail="Effective To cannot be earlier than Effective From",
            )

    timezone_name = str(setting.timezone_name or "").strip()

    if timezone_name == "":
        raise HTTPException(
            status_code=400,
            detail="Timezone is required",
        )

    if setting.day_start_time == setting.day_end_time:
        raise HTTPException(
            status_code=400,
            detail="Day Start Time and Day End Time cannot be same",
        )

    if setting.status == "Active":
        new_from = setting.effective_from
        new_to = setting.effective_to or date(9999, 12, 31)

        active_settings_query = db.query(LocationAccountingDaySetting).filter(
            LocationAccountingDaySetting.location_code.ilike(location_code),
            LocationAccountingDaySetting.status == "Active",
        )

        if setting_id is not None:
            active_settings_query = active_settings_query.filter(
                LocationAccountingDaySetting.id != setting_id
            )

        active_settings = active_settings_query.all()

        for existing in active_settings:
            existing_from = existing.effective_from
            existing_to = existing.effective_to or date(9999, 12, 31)

            overlaps = new_from <= existing_to and new_to >= existing_from

            if overlaps:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Another Active accounting day setting already exists "
                        "for this location within the selected effective period"
                    ),
                )

    return {
        "location_code": location_code,
        "timezone_name": timezone_name,
    }


@router.get(
    "/accounting-day-settings",
    response_model=list[LocationAccountingDaySettingResponse],
)
def get_location_accounting_day_settings(
    location_code: str | None = Query(None),
    status: str | None = Query(None),
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Location Accounting Day Setting",
        db,
    )

    query = db.query(LocationAccountingDaySetting)

    cleaned_location_code = clean_optional_text(location_code)

    if cleaned_location_code:
        query = query.filter(
            LocationAccountingDaySetting.location_code.ilike(cleaned_location_code)
        )

    if status:
        query = query.filter(LocationAccountingDaySetting.status == status)

    query = query.order_by(
        LocationAccountingDaySetting.location_code,
        LocationAccountingDaySetting.effective_from.desc(),
    )

    settings = query.all()

    return [
        build_location_accounting_day_setting_response(s, db)
        for s in settings
    ]


@router.post(
    "/accounting-day-settings",
    response_model=LocationAccountingDaySettingResponse,
)
def create_location_accounting_day_setting(
    setting: LocationAccountingDaySettingCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Location Accounting Day Setting",
        db,
    )

    validated = validate_location_accounting_day_setting(setting, db)

    new_setting = LocationAccountingDaySetting(
        location_code=validated["location_code"],
        day_start_time=setting.day_start_time,
        day_end_time=setting.day_end_time,
        effective_from=setting.effective_from,
        effective_to=setting.effective_to,
        timezone_name=validated["timezone_name"],
        description=setting.description,
        status=setting.status,
    )

    db.add(new_setting)
    db.flush()

    after_snapshot = build_location_accounting_day_setting_audit_snapshot(
        new_setting, db
    )

    create_audit_log(
        db=db,
        module_name="Location Accounting Day Setting",
        action="Create Location Accounting Day Setting",
        current_user=current_user,
        entity_type="LocationAccountingDaySetting",
        entity_id=new_setting.id,
        entity_label=f"{validated['location_code']} ({new_setting.day_start_time}-{new_setting.day_end_time})",
        remarks="Accounting day setting created",
        request_path="/location-accounting-day-settings",
        details={"after": after_snapshot},
    )

    db.commit()
    db.refresh(new_setting)

    return build_location_accounting_day_setting_response(new_setting, db)


@router.put(
    "/accounting-day-settings/{setting_id}",
    response_model=LocationAccountingDaySettingResponse,
)
def update_location_accounting_day_setting(
    setting_id: int,
    setting: LocationAccountingDaySettingCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Location Accounting Day Setting",
        db,
    )

    existing_setting = (
        db.query(LocationAccountingDaySetting)
        .filter(LocationAccountingDaySetting.id == setting_id)
        .first()
    )

    if not existing_setting:
        raise HTTPException(status_code=404, detail="Setting not found")

    validated = validate_location_accounting_day_setting(setting, db, setting_id)

    before_snapshot = build_location_accounting_day_setting_audit_snapshot(
        existing_setting, db
    )

    existing_setting.location_code = validated["location_code"]
    existing_setting.day_start_time = setting.day_start_time
    existing_setting.day_end_time = setting.day_end_time
    existing_setting.effective_from = setting.effective_from
    existing_setting.effective_to = setting.effective_to
    existing_setting.timezone_name = validated["timezone_name"]
    existing_setting.description = setting.description
    existing_setting.status = setting.status

    after_snapshot = build_location_accounting_day_setting_audit_snapshot(
        existing_setting, db
    )

    create_audit_log(
        db=db,
        module_name="Location Accounting Day Setting",
        action="Update Location Accounting Day Setting",
        current_user=current_user,
        entity_type="LocationAccountingDaySetting",
        entity_id=existing_setting.id,
        entity_label=f"{validated['location_code']} ({existing_setting.day_start_time}-{existing_setting.day_end_time})",
        remarks="Accounting day setting updated",
        request_path=f"/accounting-day-settings/{setting_id}",
        details={"before": before_snapshot, "after": after_snapshot},
    )

    db.commit()
    db.refresh(existing_setting)

    return build_location_accounting_day_setting_response(existing_setting, db)


@router.delete("/accounting-day-settings/{setting_id}")
def delete_location_accounting_day_setting(
    setting_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Location Accounting Day Setting",
        db,
    )

    existing_setting = (
        db.query(LocationAccountingDaySetting)
        .filter(LocationAccountingDaySetting.id == setting_id)
        .first()
    )

    if not existing_setting:
        raise HTTPException(status_code=404, detail="Setting not found")

    snapshot = build_location_accounting_day_setting_audit_snapshot(
        existing_setting, db
    )

    create_audit_log(
        db=db,
        module_name="Location Accounting Day Setting",
        action="Delete Location Accounting Day Setting",
        current_user=current_user,
        entity_type="LocationAccountingDaySetting",
        entity_id=existing_setting.id,
        entity_label=f"{existing_setting.location_code} ({existing_setting.day_start_time}-{existing_setting.day_end_time})",
        remarks="Accounting day setting deleted",
        request_path=f"/accounting-day-settings/{setting_id}",
        details={"deleted": snapshot},
    )

    db.delete(existing_setting)
    db.commit()

    return {"message": "Accounting day setting deleted successfully"}