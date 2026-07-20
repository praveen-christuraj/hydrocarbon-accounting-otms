from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import TankOperation, Location, User
from app.schemas import TankOperationCreate, TankOperationResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text, normalize_code

router = APIRouter(prefix="/tank-operations", tags=["Tank Operations"])

VALID_TANK_OPERATION_CATEGORIES = [
    "OPENING",
    "RECEIPT",
    "PRODUCTION",
    "DISPATCH",
    "DRAINING",
    "CLOSING",
    "ADJUSTMENT",
]

VALID_TANK_OPERATION_SIGNS = [
    "SET",
    "IN",
    "OUT",
    "NEUTRAL",
]


def build_tank_operation_response(tank_operation: TankOperation, db: Session):
    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(tank_operation.location_code))
        .first()
    )

    return {
        "id": tank_operation.id,
        "location_code": tank_operation.location_code,
        "location_name": location.location_name if location else "",
        "operation_code": tank_operation.operation_code,
        "operation_label": tank_operation.operation_label,
        "operation_category": tank_operation.operation_category,
        "operation_sign": tank_operation.operation_sign,
        "sort_order": tank_operation.sort_order,
        "description": tank_operation.description,
        "status": tank_operation.status,
        "created_at": tank_operation.created_at,
        "updated_at": tank_operation.updated_at,
    }


def build_tank_operation_audit_snapshot(tank_operation: TankOperation, db: Session):
    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(tank_operation.location_code))
        .first()
    )

    return {
        "id": tank_operation.id,
        "location_code": tank_operation.location_code,
        "location_name": location.location_name if location else "",
        "operation_code": tank_operation.operation_code,
        "operation_label": tank_operation.operation_label,
        "operation_category": tank_operation.operation_category,
        "operation_sign": tank_operation.operation_sign,
        "sort_order": tank_operation.sort_order,
        "description": tank_operation.description,
        "status": tank_operation.status,
    }


def validate_tank_operation(
    tank_operation: TankOperationCreate,
    db: Session,
    tank_operation_id: int | None = None,
):
    location_code = normalize_code(tank_operation.location_code)
    operation_code = normalize_code(tank_operation.operation_code)
    operation_label = str(tank_operation.operation_label or "").strip()
    operation_category = normalize_code(tank_operation.operation_category)
    operation_sign = normalize_code(tank_operation.operation_sign)

    if location_code == "":
        raise HTTPException(
            status_code=400,
            detail="Location is required",
        )

    if operation_code == "":
        raise HTTPException(
            status_code=400,
            detail="Operation Code is required",
        )

    if operation_label == "":
        raise HTTPException(
            status_code=400,
            detail="Operation Label is required",
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
            detail="Only Active locations can be used for Tank Operations",
        )

    if operation_category not in VALID_TANK_OPERATION_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid Operation Category. Allowed values are: "
                + ", ".join(VALID_TANK_OPERATION_CATEGORIES)
            ),
        )

    if operation_sign not in VALID_TANK_OPERATION_SIGNS:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid Operation Sign. Allowed values are: "
                + ", ".join(VALID_TANK_OPERATION_SIGNS)
            ),
        )

    duplicate_code_query = db.query(TankOperation).filter(
        TankOperation.location_code.ilike(location_code),
        TankOperation.operation_code.ilike(operation_code),
    )

    duplicate_label_query = db.query(TankOperation).filter(
        TankOperation.location_code.ilike(location_code),
        TankOperation.operation_label.ilike(operation_label),
    )

    if tank_operation_id is not None:
        duplicate_code_query = duplicate_code_query.filter(
            TankOperation.id != tank_operation_id
        )

        duplicate_label_query = duplicate_label_query.filter(
            TankOperation.id != tank_operation_id
        )

    duplicate_code = duplicate_code_query.first()

    if duplicate_code:
        raise HTTPException(
            status_code=400,
            detail="Operation Code already exists for this location",
        )

    duplicate_label = duplicate_label_query.first()

    if duplicate_label:
        raise HTTPException(
            status_code=400,
            detail="Operation Label already exists for this location",
        )

    return {
        "location_code": location_code,
        "operation_code": operation_code,
        "operation_label": operation_label,
        "operation_category": operation_category,
        "operation_sign": operation_sign,
    }


@router.get("", response_model=list[TankOperationResponse])
def get_tank_operations(
    location_code: str | None = None,
    status: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Tank Operation",
        db,
    )

    query = db.query(TankOperation)

    cleaned_location_code = clean_optional_text(location_code)

    if cleaned_location_code:
        query = query.filter(
            TankOperation.location_code.ilike(cleaned_location_code)
        )

    cleaned_status = clean_optional_text(status)

    if cleaned_status:
        query = query.filter(TankOperation.status == cleaned_status)

    tank_operations = (
        query.order_by(
            TankOperation.location_code.asc(),
            TankOperation.sort_order.asc(),
            TankOperation.operation_label.asc(),
        )
        .all()
    )

    return [
        build_tank_operation_response(tank_operation, db)
        for tank_operation in tank_operations
    ]


@router.post("", response_model=TankOperationResponse)
def create_tank_operation(
    tank_operation: TankOperationCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Tank Operation",
        db,
    )

    validated_data = validate_tank_operation(tank_operation, db)

    new_tank_operation = TankOperation(
        location_code=validated_data["location_code"],
        operation_code=validated_data["operation_code"],
        operation_label=validated_data["operation_label"],
        operation_category=validated_data["operation_category"],
        operation_sign=validated_data["operation_sign"],
        sort_order=tank_operation.sort_order or 1,
        description=clean_optional_text(tank_operation.description),
        status=tank_operation.status,
    )

    db.add(new_tank_operation)
    db.flush()

    after_data = build_tank_operation_audit_snapshot(new_tank_operation, db)

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Create Tank Operation",
        current_user=current_user,
        entity_type="TankOperation",
        entity_id=new_tank_operation.id,
        entity_label=(
            f"{new_tank_operation.location_code} - "
            f"{new_tank_operation.operation_label}"
        ),
        remarks="Tank operation created",
        request_path="/tank-operations",
        details={
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(new_tank_operation)

    return build_tank_operation_response(new_tank_operation, db)


@router.put("/{tank_operation_id}", response_model=TankOperationResponse)
def update_tank_operation(
    tank_operation_id: int,
    tank_operation: TankOperationCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Tank Operation",
        db,
    )

    existing_tank_operation = (
        db.query(TankOperation)
        .filter(TankOperation.id == tank_operation_id)
        .first()
    )

    if not existing_tank_operation:
        raise HTTPException(
            status_code=404,
            detail="Tank Operation not found",
        )

    before_data = build_tank_operation_audit_snapshot(
        existing_tank_operation,
        db,
    )

    validated_data = validate_tank_operation(
        tank_operation,
        db,
        tank_operation_id,
    )

    existing_tank_operation.location_code = validated_data["location_code"]
    existing_tank_operation.operation_code = validated_data["operation_code"]
    existing_tank_operation.operation_label = validated_data["operation_label"]
    existing_tank_operation.operation_category = validated_data[
        "operation_category"
    ]
    existing_tank_operation.operation_sign = validated_data["operation_sign"]
    existing_tank_operation.sort_order = tank_operation.sort_order or 1
    existing_tank_operation.description = clean_optional_text(
        tank_operation.description
    )
    existing_tank_operation.status = tank_operation.status
    existing_tank_operation.updated_at = datetime.now()

    db.flush()

    after_data = build_tank_operation_audit_snapshot(
        existing_tank_operation,
        db,
    )

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Update Tank Operation",
        current_user=current_user,
        entity_type="TankOperation",
        entity_id=existing_tank_operation.id,
        entity_label=(
            f"{existing_tank_operation.location_code} - "
            f"{existing_tank_operation.operation_label}"
        ),
        remarks="Tank operation updated",
        request_path=f"/tank-operations/{tank_operation_id}",
        details={
            "before": before_data,
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(existing_tank_operation)

    return build_tank_operation_response(existing_tank_operation, db)


@router.delete("/{tank_operation_id}")
def delete_tank_operation(
    tank_operation_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Tank Operation",
        db,
    )

    existing_tank_operation = (
        db.query(TankOperation)
        .filter(TankOperation.id == tank_operation_id)
        .first()
    )

    if not existing_tank_operation:
        raise HTTPException(
            status_code=404,
            detail="Tank Operation not found",
        )

    deleted_data = build_tank_operation_audit_snapshot(
        existing_tank_operation,
        db,
    )

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Delete Tank Operation",
        current_user=current_user,
        entity_type="TankOperation",
        entity_id=existing_tank_operation.id,
        entity_label=(
            f"{existing_tank_operation.location_code} - "
            f"{existing_tank_operation.operation_label}"
        ),
        remarks="Tank operation deleted",
        request_path=f"/tank-operations/{tank_operation_id}",
        details={
            "deleted": deleted_data,
        },
    )

    db.delete(existing_tank_operation)
    db.commit()

    return {
        "message": "Tank operation deleted successfully"
    }