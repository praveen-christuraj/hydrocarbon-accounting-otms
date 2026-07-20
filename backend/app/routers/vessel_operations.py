from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import VesselOperation, Location, AssetType, User
from app.schemas import VesselOperationCreate, VesselOperationResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text, normalize_code

router = APIRouter(prefix="/vessel-operations", tags=["Vessel Operations"])

VALID_VESSEL_OPERATION_SIGNS = ["SET", "IN", "OUT", "NEUTRAL"]


def build_vessel_operation_response(vessel_operation: VesselOperation, db: Session):
    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(vessel_operation.location_code))
        .first()
    )

    return {
        "id": vessel_operation.id,
        "location_code": vessel_operation.location_code,
        "location_name": location.location_name if location else "",
        "applicable_asset_type_code": vessel_operation.applicable_asset_type_code,
        "operation_code": vessel_operation.operation_code,
        "operation_label": vessel_operation.operation_label,
        "operation_category": vessel_operation.operation_category,
        "operation_sign": vessel_operation.operation_sign,
        "show_in": vessel_operation.show_in,
        "sort_order": vessel_operation.sort_order,
        "description": vessel_operation.description,
        "status": vessel_operation.status,
        "created_at": vessel_operation.created_at,
        "updated_at": vessel_operation.updated_at,
    }


def validate_vessel_operation(v: VesselOperationCreate, db: Session, vessel_operation_id: int | None = None):
    location_code = normalize_code(v.location_code)
    asset_type_code = normalize_code(v.applicable_asset_type_code)
    operation_code = normalize_code(v.operation_code)

    operation_label = str(v.operation_label or "").strip()
    operation_category = normalize_code(v.operation_category)
    operation_sign = normalize_code(v.operation_sign)

    if not location_code:
        raise HTTPException(status_code=400, detail="Location is required")
    if not asset_type_code:
        raise HTTPException(status_code=400, detail="Applicable Asset Type is required")
    if not operation_code:
        raise HTTPException(status_code=400, detail="Operation Code is required")
    if not operation_label:
        raise HTTPException(status_code=400, detail="Operation Label is required")
    if not operation_category:
        raise HTTPException(status_code=400, detail="Operation Category is required")
    if operation_sign not in VALID_VESSEL_OPERATION_SIGNS:
        raise HTTPException(status_code=400, detail="Operation Sign must be SET / IN / OUT / NEUTRAL")

    show_in_raw = str(getattr(v, "show_in", "") or "").strip()
    if show_in_raw == "":
        show_in_raw = "Both"

    show_in = show_in_raw[:1].upper() + show_in_raw[1:].lower()
    if show_in not in ["Entry", "Tracking", "Both"]:
        raise HTTPException(status_code=400, detail="Show In must be Entry / Tracking / Both")

    if not db.query(Location).filter(Location.location_code.ilike(location_code)).first():
        raise HTTPException(status_code=400, detail="Location not found")

    if not db.query(AssetType).filter(AssetType.asset_type_code.ilike(asset_type_code)).first():
        raise HTTPException(status_code=400, detail="Asset Type not found")

    code_q = db.query(VesselOperation).filter(
        VesselOperation.location_code.ilike(location_code),
        VesselOperation.applicable_asset_type_code.ilike(asset_type_code),
        VesselOperation.operation_code.ilike(operation_code),
    )
    label_q = db.query(VesselOperation).filter(
        VesselOperation.location_code.ilike(location_code),
        VesselOperation.applicable_asset_type_code.ilike(asset_type_code),
        VesselOperation.operation_label.ilike(operation_label),
    )

    if vessel_operation_id:
        code_q = code_q.filter(VesselOperation.id != vessel_operation_id)
        label_q = label_q.filter(VesselOperation.id != vessel_operation_id)

    if code_q.first():
        raise HTTPException(status_code=400, detail="Operation Code already exists")
    if label_q.first():
        raise HTTPException(status_code=400, detail="Operation Label already exists")

    return {
        "location_code": location_code,
        "asset_type_code": asset_type_code,
        "operation_code": operation_code,
        "operation_label": operation_label,
        "operation_category": operation_category,
        "operation_sign": operation_sign,
        "show_in": show_in,
    }


@router.get("", response_model=list[VesselOperationResponse])
def get_vessel_operations(
    location_code: str | None = None,
    applicable_asset_type_code: str | None = None,
    status: str | None = None,
    show_in: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Vessel Operation", db)

    q = db.query(VesselOperation)

    lc = clean_optional_text(location_code)
    if lc:
        q = q.filter(VesselOperation.location_code.ilike(lc))

    at = clean_optional_text(applicable_asset_type_code)
    if at:
        q = q.filter(VesselOperation.applicable_asset_type_code.ilike(at))

    st = clean_optional_text(status)
    if st:
        q = q.filter(VesselOperation.status == st)

    si = clean_optional_text(show_in)
    if si:
        normalized = si[:1].upper() + si[1:].lower()
        if normalized == "Entry":
            q = q.filter(VesselOperation.show_in.in_(["Entry", "Both"]))
        elif normalized == "Tracking":
            q = q.filter(VesselOperation.show_in.in_(["Tracking", "Both"]))
        elif normalized == "Both":
            q = q.filter(VesselOperation.show_in == "Both")

    rows = q.order_by(
        VesselOperation.location_code.asc(),
        VesselOperation.applicable_asset_type_code.asc(),
        VesselOperation.sort_order.asc(),
        VesselOperation.operation_label.asc(),
    ).all()

    return [build_vessel_operation_response(r, db) for r in rows]


@router.post("", response_model=VesselOperationResponse)
def create_vessel_operation(
    vessel_operation: VesselOperationCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Vessel Operation", db)

    d = validate_vessel_operation(vessel_operation, db)

    row = VesselOperation(
        location_code=d["location_code"],
        applicable_asset_type_code=d["asset_type_code"],
        operation_code=d["operation_code"],
        operation_label=d["operation_label"],
        operation_category=d["operation_category"],
        operation_sign=d["operation_sign"],
        show_in=d["show_in"],
        sort_order=vessel_operation.sort_order or 1,
        description=clean_optional_text(vessel_operation.description),
        status=vessel_operation.status or "Active",
    )

    db.add(row)
    create_audit_log(
        db=db,
        module_name="Operations",
        action="Create Vessel Operation",
        current_user=current_user,
        entity_type="VesselOperation",
        entity_id=None,
        entity_label=f"{row.operation_label} ({row.operation_code})",
        remarks="Vessel operation created",
        request_path="/vessel-operations",
        details={
            "location_code": row.location_code,
            "applicable_asset_type_code": row.applicable_asset_type_code,
            "operation_code": row.operation_code,
            "operation_label": row.operation_label,
            "operation_category": row.operation_category,
            "operation_sign": row.operation_sign,
            "show_in": row.show_in,
            "sort_order": row.sort_order,
            "status": row.status,
        },
    )
    db.commit()
    db.refresh(row)
    return build_vessel_operation_response(row, db)


@router.put("/{vessel_operation_id}", response_model=VesselOperationResponse)
def update_vessel_operation(
    vessel_operation_id: int,
    vessel_operation: VesselOperationCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Vessel Operation", db)

    existing = db.query(VesselOperation).filter(VesselOperation.id == vessel_operation_id).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Vessel operation not found")

    d = validate_vessel_operation(vessel_operation, db, vessel_operation_id)
    before_data = {
        "location_code": existing.location_code,
        "applicable_asset_type_code": existing.applicable_asset_type_code,
        "operation_code": existing.operation_code,
        "operation_label": existing.operation_label,
        "operation_category": existing.operation_category,
        "operation_sign": existing.operation_sign,
        "show_in": existing.show_in,
        "sort_order": existing.sort_order,
        "status": existing.status,
    }

    existing.location_code = d["location_code"]
    existing.applicable_asset_type_code = d["asset_type_code"]
    existing.operation_code = d["operation_code"]
    existing.operation_label = d["operation_label"]
    existing.operation_category = d["operation_category"]
    existing.operation_sign = d["operation_sign"]
    existing.show_in = d["show_in"]
    existing.sort_order = vessel_operation.sort_order or 1
    existing.description = clean_optional_text(vessel_operation.description)
    existing.status = vessel_operation.status or "Active"
    existing.updated_at = datetime.now()

    after_data = {
        "location_code": existing.location_code,
        "applicable_asset_type_code": existing.applicable_asset_type_code,
        "operation_code": existing.operation_code,
        "operation_label": existing.operation_label,
        "operation_category": existing.operation_category,
        "operation_sign": existing.operation_sign,
        "show_in": existing.show_in,
        "sort_order": existing.sort_order,
        "status": existing.status,
    }

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Update Vessel Operation",
        current_user=current_user,
        entity_type="VesselOperation",
        entity_id=existing.id,
        entity_label=f"{existing.operation_label} ({existing.operation_code})",
        remarks="Vessel operation updated",
        request_path=f"/vessel-operations/{vessel_operation_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing)
    return build_vessel_operation_response(existing, db)


@router.delete("/{vessel_operation_id}")
def delete_vessel_operation(
    vessel_operation_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Vessel Operation", db)

    existing = db.query(VesselOperation).filter(VesselOperation.id == vessel_operation_id).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Vessel operation not found")

    deleted_data = {
        "location_code": existing.location_code,
        "applicable_asset_type_code": existing.applicable_asset_type_code,
        "operation_code": existing.operation_code,
        "operation_label": existing.operation_label,
        "operation_category": existing.operation_category,
        "operation_sign": existing.operation_sign,
        "show_in": existing.show_in,
        "sort_order": existing.sort_order,
        "status": existing.status,
    }

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Delete Vessel Operation",
        current_user=current_user,
        entity_type="VesselOperation",
        entity_id=existing.id,
        entity_label=f"{existing.operation_label} ({existing.operation_code})",
        remarks="Vessel operation deleted",
        request_path=f"/vessel-operations/{vessel_operation_id}",
        details={"deleted": deleted_data},
    )

    db.delete(existing)
    db.commit()
    return {"message": "Vessel operation deleted successfully"}