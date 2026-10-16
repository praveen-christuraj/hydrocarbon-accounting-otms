from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import OperationType, TrackingModuleConfig, User
from app.schemas import TrackingModuleConfigCreate, TrackingModuleConfigResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.services.tracking_config import (
    TRACKING_MODULES,
    invalidate_tracking_config_cache,
    tracking_catalog,
    validate_config_payload,
)
from app.utils.helpers import clean_optional_text, get_current_user_display_name

router = APIRouter(
    prefix="/tracking-module-configs",
    tags=["Tracking Module Configuration"],
)

# NOTE: routes are registered with "" (not "/") - see location_operation_availability.py.


def _serialize(row: TrackingModuleConfig, operation_type: OperationType | None):
    return {
        "id": row.id,
        "module_code": row.module_code,
        "module_label": TRACKING_MODULES.get(row.module_code, row.module_code),
        "operation_type_code": row.operation_type_code,
        "operation_type_name": operation_type.operation_type_name if operation_type else "",
        "applicable_asset_type_code": operation_type.applicable_asset_type_code if operation_type else None,
        "movement_role": row.movement_role,
        "tracking_stage": row.tracking_stage,
        "status": row.status,
        "remarks": row.remarks,
        "created_by": row.created_by,
        "updated_by": row.updated_by,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _operation_type_lookup(db: Session):
    return {
        str(op.operation_type_code or "").strip().lower(): op
        for op in db.query(OperationType).all()
    }


def _snapshot(row: TrackingModuleConfig):
    return {
        "id": row.id,
        "module_code": row.module_code,
        "operation_type_code": row.operation_type_code,
        "movement_role": row.movement_role,
        "tracking_stage": row.tracking_stage,
        "status": row.status,
        "remarks": row.remarks,
    }


@router.get("/catalog")
def get_tracking_module_catalog(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """
    Modules, roles, stages and the Operation Type Master with the tracking
    mappings of each operation type. Lets the admin see which operation types
    of the system are not yet mapped to any tracking module.
    """
    require_user_permission(current_user, "View Tracking Module Configuration", db)

    rows = db.query(TrackingModuleConfig).order_by(
        TrackingModuleConfig.module_code.asc(),
        TrackingModuleConfig.operation_type_code.asc(),
    ).all()
    mappings_by_op: dict[str, list] = {}
    for row in rows:
        mappings_by_op.setdefault(str(row.operation_type_code or "").strip().lower(), []).append({
            "id": row.id,
            "module_code": row.module_code,
            "movement_role": row.movement_role,
            "tracking_stage": row.tracking_stage,
            "status": row.status,
        })

    operation_types = [
        {
            "operation_type_code": op.operation_type_code,
            "operation_type_name": op.operation_type_name,
            "applicable_asset_type_code": op.applicable_asset_type_code,
            "status": op.status,
            "mappings": mappings_by_op.get(str(op.operation_type_code or "").strip().lower(), []),
        }
        for op in db.query(OperationType).order_by(OperationType.operation_type_name.asc()).all()
    ]

    return {
        **tracking_catalog(),
        "operation_types": operation_types,
    }


@router.get("", response_model=list[TrackingModuleConfigResponse])
def list_tracking_module_configs(
    module_code: str | None = None,
    status: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Tracking Module Configuration", db)

    query = db.query(TrackingModuleConfig)
    module_clean = clean_optional_text(module_code)
    if module_clean:
        query = query.filter(TrackingModuleConfig.module_code == module_clean.upper())
    status_clean = clean_optional_text(status)
    if status_clean:
        query = query.filter(TrackingModuleConfig.status == status_clean)

    rows = query.order_by(
        TrackingModuleConfig.module_code.asc(),
        TrackingModuleConfig.id.asc(),
    ).all()

    operation_types = _operation_type_lookup(db)
    return [
        _serialize(row, operation_types.get(str(row.operation_type_code or "").strip().lower()))
        for row in rows
    ]


@router.post("", response_model=TrackingModuleConfigResponse)
def create_tracking_module_config(
    payload: TrackingModuleConfigCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Tracking Module Configuration", db)

    cleaned = validate_config_payload(
        db=db,
        module_code=payload.module_code,
        operation_type_code=payload.operation_type_code,
        movement_role=payload.movement_role,
        tracking_stage=payload.tracking_stage,
        status=payload.status,
    )

    row = TrackingModuleConfig(
        module_code=cleaned["module_code"],
        operation_type_code=cleaned["operation_type_code"],
        movement_role=cleaned["movement_role"],
        tracking_stage=cleaned["tracking_stage"],
        status=cleaned["status"],
        remarks=clean_optional_text(payload.remarks),
        created_by=get_current_user_display_name(current_user),
        updated_by=get_current_user_display_name(current_user),
        created_at=datetime.now(),
        updated_at=datetime.now(),
    )
    db.add(row)
    db.flush()

    create_audit_log(
        db=db,
        module_name="Tracking Module Configuration",
        action="Create Tracking Module Configuration",
        current_user=current_user,
        entity_type="TrackingModuleConfig",
        entity_id=row.id,
        entity_label=f"{TRACKING_MODULES.get(row.module_code, row.module_code)} | {row.operation_type_code}",
        remarks="Operation type mapped to tracking module",
        request_path="/tracking-module-configs",
        details={"after": _snapshot(row)},
    )

    db.commit()
    invalidate_tracking_config_cache(db)
    db.refresh(row)

    operation_types = _operation_type_lookup(db)
    return _serialize(row, operation_types.get(str(row.operation_type_code or "").strip().lower()))


@router.put("/{config_id}", response_model=TrackingModuleConfigResponse)
def update_tracking_module_config(
    config_id: int,
    payload: TrackingModuleConfigCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit Tracking Module Configuration", db)

    row = db.query(TrackingModuleConfig).filter(TrackingModuleConfig.id == config_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Tracking module configuration not found")

    before = _snapshot(row)

    cleaned = validate_config_payload(
        db=db,
        module_code=payload.module_code,
        operation_type_code=payload.operation_type_code,
        movement_role=payload.movement_role,
        tracking_stage=payload.tracking_stage,
        status=payload.status,
        exclude_id=config_id,
    )

    row.module_code = cleaned["module_code"]
    row.operation_type_code = cleaned["operation_type_code"]
    row.movement_role = cleaned["movement_role"]
    row.tracking_stage = cleaned["tracking_stage"]
    row.status = cleaned["status"]
    row.remarks = clean_optional_text(payload.remarks)
    row.updated_by = get_current_user_display_name(current_user)
    row.updated_at = datetime.now()
    db.flush()

    create_audit_log(
        db=db,
        module_name="Tracking Module Configuration",
        action="Update Tracking Module Configuration",
        current_user=current_user,
        entity_type="TrackingModuleConfig",
        entity_id=row.id,
        entity_label=f"{TRACKING_MODULES.get(row.module_code, row.module_code)} | {row.operation_type_code}",
        new_status=row.status,
        old_status=before.get("status"),
        remarks="Tracking module configuration updated",
        request_path=f"/tracking-module-configs/{config_id}",
        details={"before": before, "after": _snapshot(row)},
    )

    db.commit()
    invalidate_tracking_config_cache(db)
    db.refresh(row)

    operation_types = _operation_type_lookup(db)
    return _serialize(row, operation_types.get(str(row.operation_type_code or "").strip().lower()))


@router.delete("/{config_id}")
def delete_tracking_module_config(
    config_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Delete Tracking Module Configuration", db)

    row = db.query(TrackingModuleConfig).filter(TrackingModuleConfig.id == config_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Tracking module configuration not found")

    before = _snapshot(row)

    create_audit_log(
        db=db,
        module_name="Tracking Module Configuration",
        action="Delete Tracking Module Configuration",
        current_user=current_user,
        entity_type="TrackingModuleConfig",
        entity_id=row.id,
        entity_label=f"{TRACKING_MODULES.get(row.module_code, row.module_code)} | {row.operation_type_code}",
        remarks="Tracking module configuration deleted",
        request_path=f"/tracking-module-configs/{config_id}",
        details={"before": before},
    )

    db.delete(row)
    db.commit()
    invalidate_tracking_config_cache(db)

    return {"message": "Tracking module configuration deleted", "id": config_id}
