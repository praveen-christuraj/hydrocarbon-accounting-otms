from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    Location,
    LocationOperationAvailability,
    OperationType,
    User,
)
from app.schemas import (
    LocationOperationAvailabilityCreate,
    LocationOperationAvailabilityResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text

router = APIRouter(prefix="/location-operation-availability", tags=["Location Operation Availability"])


def build_location_operation_availability_response(
    availability: LocationOperationAvailability,
    db: Session,
):
    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(availability.location_code))
        .first()
    )

    operation_type = (
        db.query(OperationType)
        .filter(
            OperationType.operation_type_code.ilike(
                availability.operation_type_code
            )
        )
        .first()
    )

    return {
        "id": availability.id,
        "location_code": availability.location_code,
        "location_name": location.location_name if location else "",
        "operation_type_code": availability.operation_type_code,
        "operation_type_name": (
            operation_type.operation_type_name if operation_type else ""
        ),
        "status": availability.status,
        "remarks": availability.remarks,
        "created_at": availability.created_at,
        "updated_at": availability.updated_at,
    }


def build_location_operation_availability_audit_snapshot(
    availability: LocationOperationAvailability,
    db: Session,
):
    location = db.query(Location).filter(
        Location.location_code.ilike(availability.location_code)
    ).first()

    operation_type = db.query(OperationType).filter(
        OperationType.operation_type_code.ilike(availability.operation_type_code)
    ).first()

    return {
        "id": availability.id,
        "location_code": availability.location_code,
        "location_name": location.location_name if location else "",
        "operation_type_code": availability.operation_type_code,
        "operation_type_name": operation_type.operation_type_name if operation_type else "",
        "status": availability.status,
        "remarks": availability.remarks,
    }


def validate_location_operation_availability(
    availability: LocationOperationAvailabilityCreate,
    db: Session,
    availability_id: int | None = None,
):
    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(availability.location_code))
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

    operation_type = (
        db.query(OperationType)
        .filter(
            OperationType.operation_type_code.ilike(
                availability.operation_type_code
            )
        )
        .first()
    )

    if not operation_type:
        raise HTTPException(
            status_code=400,
            detail="Operation type not found",
        )

    if operation_type.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active operation types can be configured",
        )

    duplicate_query = db.query(LocationOperationAvailability).filter(
        LocationOperationAvailability.location_code.ilike(
            availability.location_code
        ),
        LocationOperationAvailability.operation_type_code.ilike(
            availability.operation_type_code
        ),
    )

    if availability_id is not None:
        duplicate_query = duplicate_query.filter(
            LocationOperationAvailability.id != availability_id
        )

    duplicate = duplicate_query.first()

    if duplicate:
        raise HTTPException(
            status_code=400,
            detail="This operation type is already configured for this location",
        )


@router.get(
    "/",
    response_model=list[LocationOperationAvailabilityResponse],
)
def get_location_operation_availability(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Location Operation Availability",
        db,
    )

    availability_records = (
        db.query(LocationOperationAvailability)
        .order_by(LocationOperationAvailability.id)
        .all()
    )

    return [
        build_location_operation_availability_response(record, db)
        for record in availability_records
    ]


@router.post(
    "/",
    response_model=LocationOperationAvailabilityResponse,
)
def create_location_operation_availability(
    availability: LocationOperationAvailabilityCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Location Operation Availability",
        db,
    )

    validate_location_operation_availability(availability, db)

    new_record = LocationOperationAvailability(
        location_code=availability.location_code.strip(),
        operation_type_code=availability.operation_type_code.strip(),
        status=availability.status,
        remarks=clean_optional_text(availability.remarks),
    )

    db.add(new_record)
    db.flush()

    after_data = build_location_operation_availability_audit_snapshot(new_record, db)

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Create Location Operation Availability",
        current_user=current_user,
        entity_type="LocationOperationAvailability",
        entity_id=new_record.id,
        entity_label=f"{after_data.get('location_code')} - {after_data.get('operation_type_code')}",
        remarks="Location operation availability created",
        request_path="/location-operation-availability",
        details={"after": after_data},
    )

    db.commit()
    db.refresh(new_record)

    return build_location_operation_availability_response(new_record, db)


@router.put(
    "/{availability_id}",
    response_model=LocationOperationAvailabilityResponse,
)
def update_location_operation_availability(
    availability_id: int,
    availability: LocationOperationAvailabilityCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Location Operation Availability",
        db,
    )

    existing_record = (
        db.query(LocationOperationAvailability)
        .filter(LocationOperationAvailability.id == availability_id)
        .first()
    )

    if not existing_record:
        raise HTTPException(
            status_code=404,
            detail="Location operation availability not found",
        )

    before_data = build_location_operation_availability_audit_snapshot(
        existing_record, db
    )

    validate_location_operation_availability(
        availability,
        db,
        availability_id,
    )

    existing_record.location_code = availability.location_code.strip()
    existing_record.operation_type_code = availability.operation_type_code.strip()
    existing_record.status = availability.status
    existing_record.remarks = clean_optional_text(availability.remarks)

    db.flush()

    after_data = build_location_operation_availability_audit_snapshot(
        existing_record, db
    )

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Update Location Operation Availability",
        current_user=current_user,
        entity_type="LocationOperationAvailability",
        entity_id=existing_record.id,
        entity_label=f"{after_data.get('location_code')} - {after_data.get('operation_type_code')}",
        remarks="Location operation availability updated",
        request_path=f"/location-operation-availability/{availability_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing_record)

    return build_location_operation_availability_response(existing_record, db)


@router.delete("/{availability_id}")
def delete_location_operation_availability(
    availability_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Location Operation Availability",
        db,
    )

    existing_record = (
        db.query(LocationOperationAvailability)
        .filter(LocationOperationAvailability.id == availability_id)
        .first()
    )

    if not existing_record:
        raise HTTPException(
            status_code=404,
            detail="Location operation availability not found",
        )

    deleted_data = build_location_operation_availability_audit_snapshot(
        existing_record, db
    )

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Delete Location Operation Availability",
        current_user=current_user,
        entity_type="LocationOperationAvailability",
        entity_id=existing_record.id,
        entity_label=f"{deleted_data.get('location_code')} - {deleted_data.get('operation_type_code')}",
        remarks="Location operation availability deleted",
        request_path=f"/location-operation-availability/{availability_id}",
        details={"deleted": deleted_data},
    )

    db.delete(existing_record)
    db.commit()

    return {"message": "Location operation availability deleted successfully"}
