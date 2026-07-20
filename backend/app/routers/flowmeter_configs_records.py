from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    FlowmeterConfig, FlowmeterConfigHistory, FlowmeterRecord,
    OperationTransaction, OperationTransactionValue, OperationTemplate,
    Location, Asset, AssetAssignment, User,
)
from app.schemas import (
    FlowmeterConfigCreate, FlowmeterConfigResponse,
    FlowmeterRecordCreate, FlowmeterRecordResponse,
    FlowmeterConfigHistoryResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import safe_float, clean_optional_text, get_current_user_display_name
from app.config import APPROVED_TRANSACTION_STATUS
from app.services.transaction_helpers import approved_transaction_not_on_correction_hold

router = APIRouter(prefix="/flowmeter", tags=["Flowmeter Configs & Records"])

M3_TO_BBLS_FACTOR = 6.289811


def build_flowmeter_config_response(config: FlowmeterConfig, db: Session):
    location_name = None
    asset_name = None

    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(config.location_code))
        .first()
    )
    if location:
        location_name = location.location_name

    asset = (
        db.query(Asset)
        .filter(Asset.asset_code.ilike(config.asset_code))
        .first()
    )
    if asset:
        asset_name = asset.asset_name
    meter_asset_name = None
    if str(config.meter_asset_code or "").strip():
        m_asset = (
            db.query(Asset)
            .filter(Asset.asset_code.ilike(config.meter_asset_code))
            .first()
        )
        if m_asset:
            meter_asset_name = m_asset.asset_name

    return {
        "id": config.id,
        "location_code": config.location_code,
        "location_name": location_name,
        "asset_code": config.asset_code,
        "asset_name": asset_name,
        "stream_name": config.stream_name or "Default",
        "meter_asset_code": config.meter_asset_code,
        "meter_asset_name": meter_asset_name,
        "meter_label": config.meter_label,
        "meter_factor": float(config.meter_factor or 0),
        "meter_unit": config.meter_unit,
        "calibration_date": config.calibration_date,
        "remarks": config.remarks,
        "status": config.status,
        "created_at": config.created_at,
        "updated_at": config.updated_at,
    }


def build_flowmeter_record_response(record: FlowmeterRecord, db: Session):
    location_name = None
    asset_name = None

    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(record.location_code))
        .first()
    )
    if location:
        location_name = location.location_name

    asset = (
        db.query(Asset)
        .filter(Asset.asset_code.ilike(record.asset_code))
        .first()
    )
    if asset:
        asset_name = asset.asset_name

    return {
        "id": record.id,
        "location_code": record.location_code,
        "location_name": location_name,
        "asset_code": record.asset_code,
        "asset_name": asset_name,
        "meter_label": record.meter_label,
        "reading_date": record.reading_date,
        "opening_reading": float(record.opening_reading or 0),
        "closing_reading": float(record.closing_reading or 0),
        "gross_observed": float(record.gross_observed or 0),
        "meter_factor": float(record.meter_factor or 0),
        "meter_unit": record.meter_unit,
        "net_standard": float(record.net_standard or 0),
        "net_standard_bbl": float(record.net_standard_bbl or 0),
        "remarks": record.remarks,
        "status": record.status,
        "created_by": record.created_by,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def build_flowmeter_config_history_response(row: FlowmeterConfigHistory):
    return {
        "id": row.id,
        "config_id": row.config_id,
        "location_code": row.location_code,
        "asset_code": row.asset_code,
        "stream_name": row.stream_name or "Default",
        "meter_asset_code": row.meter_asset_code,
        "meter_label": row.meter_label,
        "old_meter_factor": row.old_meter_factor,
        "new_meter_factor": row.new_meter_factor,
        "old_meter_unit": row.old_meter_unit,
        "new_meter_unit": row.new_meter_unit,
        "old_calibration_date": row.old_calibration_date,
        "new_calibration_date": row.new_calibration_date,
        "old_status": row.old_status,
        "new_status": row.new_status,
        "change_action": row.change_action,
        "changed_by": row.changed_by,
        "remarks": row.remarks,
        "changed_at": row.changed_at,
    }


def validate_flowmeter_asset(asset_code: str, db: Session):
    asset_code_clean = str(asset_code or "").strip()

    if asset_code_clean == "":
        raise HTTPException(status_code=400, detail="asset_code is required")

    asset = (
        db.query(Asset)
        .filter(Asset.asset_code.ilike(asset_code_clean))
        .first()
    )
    if not asset:
        raise HTTPException(status_code=400, detail="Asset not found")

    assignment = (
        db.query(AssetAssignment)
        .filter(
            AssetAssignment.asset_code.ilike(asset_code_clean),
            AssetAssignment.status == "Active",
        )
        .order_by(
            AssetAssignment.assignment_date.desc(),
            AssetAssignment.id.desc(),
        )
        .first()
    )

    if not assignment or not str(assignment.assignment_location_code or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Active asset assignment with location is required for flowmeter configuration",
        )

    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(assignment.assignment_location_code))
        .first()
    )
    if not location:
        raise HTTPException(status_code=400, detail="Assigned location not found")

    return location, asset


@router.get("/configs", response_model=list[FlowmeterConfigResponse])
def get_flowmeter_configs(
    location_code: str | None = None,
    asset_code: str | None = None,
    stream_name: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Flowmeter Config", db)

    q = db.query(FlowmeterConfig)

    if location_code:
        q = q.filter(FlowmeterConfig.location_code.ilike(location_code.strip()))
    if asset_code:
        q = q.filter(FlowmeterConfig.asset_code.ilike(asset_code.strip()))
    if stream_name:
        q = q.filter(FlowmeterConfig.stream_name.ilike(stream_name.strip()))

    rows = q.order_by(
        FlowmeterConfig.location_code.asc(),
        FlowmeterConfig.asset_code.asc(),
        FlowmeterConfig.stream_name.asc(),
        FlowmeterConfig.meter_label.asc(),
    ).all()

    return [build_flowmeter_config_response(r, db) for r in rows]


@router.post("/configs", response_model=FlowmeterConfigResponse)
def create_flowmeter_config(
    request: FlowmeterConfigCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Flowmeter Config", db)

    location, asset = validate_flowmeter_asset(request.asset_code, db)

    meter_label = str(request.meter_label or "").strip()
    if meter_label == "":
        raise HTTPException(status_code=400, detail="meter_label is required")
    stream_name = str(request.stream_name or "").strip() or "Default"
    meter_asset_code = clean_optional_text(request.meter_asset_code)

    meter_unit = str(request.meter_unit or "bbls").strip().lower()
    if meter_unit not in {"bbls", "m3"}:
        raise HTTPException(status_code=400, detail="meter_unit must be bbls or m3")

    meter_factor = float(request.meter_factor or 0)
    if meter_factor <= 0:
        raise HTTPException(status_code=400, detail="meter_factor must be greater than 0")

    existing = (
        db.query(FlowmeterConfig)
        .filter(
            FlowmeterConfig.location_code.ilike(location.location_code),
            FlowmeterConfig.asset_code.ilike(asset.asset_code),
            FlowmeterConfig.stream_name.ilike(stream_name),
            FlowmeterConfig.meter_asset_code.ilike(meter_asset_code) if meter_asset_code else FlowmeterConfig.meter_label.ilike(meter_label),
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Flowmeter config already exists")

    row = FlowmeterConfig(
        location_code=location.location_code,
        asset_code=asset.asset_code,
        stream_name=stream_name,
        meter_asset_code=meter_asset_code,
        meter_label=meter_label,
        meter_factor=meter_factor,
        meter_unit=meter_unit,
        calibration_date=request.calibration_date,
        remarks=clean_optional_text(request.remarks),
        status=request.status or "Active",
    )
    db.add(row)
    db.flush()

    db.add(
        FlowmeterConfigHistory(
            config_id=row.id,
            location_code=row.location_code,
            asset_code=row.asset_code,
            stream_name=row.stream_name,
            meter_asset_code=row.meter_asset_code,
            meter_label=row.meter_label,
            old_meter_factor=None,
            new_meter_factor=row.meter_factor,
            old_meter_unit=None,
            new_meter_unit=row.meter_unit,
            old_calibration_date=None,
            new_calibration_date=row.calibration_date,
            old_status=None,
            new_status=row.status,
            change_action="CREATE",
            changed_by=get_current_user_display_name(current_user),
            remarks="Initial flowmeter config",
        )
    )

    create_audit_log(
        db=db,
        module_name="Flowmeter Config",
        action="Create Flowmeter Config",
        current_user=current_user,
        entity_type="FlowmeterConfig",
        entity_id=row.id,
        entity_label=f"{row.asset_code} / {row.meter_label}",
        remarks="Flowmeter configuration created",
        request_path="/flowmeter/configs",
        details={
            "location_code": row.location_code,
            "asset_code": row.asset_code,
            "stream_name": row.stream_name,
            "meter_asset_code": row.meter_asset_code,
            "meter_label": row.meter_label,
            "meter_factor": row.meter_factor,
            "meter_unit": row.meter_unit,
            "calibration_date": str(row.calibration_date) if row.calibration_date else None,
            "status": row.status,
        },
    )

    db.commit()
    db.refresh(row)
    return build_flowmeter_config_response(row, db)


@router.put("/configs/{config_id}", response_model=FlowmeterConfigResponse)
def update_flowmeter_config(
    config_id: int,
    request: FlowmeterConfigCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Flowmeter Config", db)

    row = db.query(FlowmeterConfig).filter(FlowmeterConfig.id == config_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Flowmeter config not found")

    location, asset = validate_flowmeter_asset(request.asset_code, db)

    meter_label = str(request.meter_label or "").strip()
    if meter_label == "":
        raise HTTPException(status_code=400, detail="meter_label is required")
    stream_name = str(request.stream_name or "").strip() or "Default"
    meter_asset_code = clean_optional_text(request.meter_asset_code)

    meter_unit = str(request.meter_unit or "bbls").strip().lower()
    if meter_unit not in {"bbls", "m3"}:
        raise HTTPException(status_code=400, detail="meter_unit must be bbls or m3")

    meter_factor = float(request.meter_factor or 0)
    if meter_factor <= 0:
        raise HTTPException(status_code=400, detail="meter_factor must be greater than 0")

    duplicate = (
        db.query(FlowmeterConfig)
        .filter(
            FlowmeterConfig.location_code.ilike(location.location_code),
            FlowmeterConfig.asset_code.ilike(asset.asset_code),
            FlowmeterConfig.stream_name.ilike(stream_name),
            FlowmeterConfig.meter_asset_code.ilike(meter_asset_code) if meter_asset_code else FlowmeterConfig.meter_label.ilike(meter_label),
            FlowmeterConfig.id != config_id,
        )
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=400, detail="Flowmeter config already exists")

    old_factor = float(row.meter_factor or 0)
    old_unit = row.meter_unit
    old_calibration_date = row.calibration_date
    old_status = row.status

    row.location_code = location.location_code
    row.asset_code = asset.asset_code
    row.stream_name = stream_name
    row.meter_asset_code = meter_asset_code
    row.meter_label = meter_label
    row.meter_factor = meter_factor
    row.meter_unit = meter_unit
    row.calibration_date = request.calibration_date
    row.remarks = clean_optional_text(request.remarks)
    row.status = request.status or "Active"
    row.updated_at = datetime.now()

    db.add(
        FlowmeterConfigHistory(
            config_id=row.id,
            location_code=row.location_code,
            asset_code=row.asset_code,
            stream_name=row.stream_name,
            meter_asset_code=row.meter_asset_code,
            meter_label=row.meter_label,
            old_meter_factor=old_factor,
            new_meter_factor=row.meter_factor,
            old_meter_unit=old_unit,
            new_meter_unit=row.meter_unit,
            old_calibration_date=old_calibration_date,
            new_calibration_date=row.calibration_date,
            old_status=old_status,
            new_status=row.status,
            change_action="UPDATE",
            changed_by=get_current_user_display_name(current_user),
            remarks="Flowmeter config updated",
        )
    )

    create_audit_log(
        db=db,
        module_name="Flowmeter Config",
        action="Update Flowmeter Config",
        current_user=current_user,
        entity_type="FlowmeterConfig",
        entity_id=row.id,
        entity_label=f"{row.asset_code} / {row.meter_label}",
        remarks="Flowmeter configuration updated",
        request_path=f"/flowmeter/configs/{config_id}",
        details={
            "location_code": row.location_code,
            "asset_code": row.asset_code,
            "stream_name": row.stream_name,
            "meter_asset_code": row.meter_asset_code,
            "meter_label": row.meter_label,
            "meter_factor": row.meter_factor,
            "meter_unit": row.meter_unit,
            "calibration_date": str(row.calibration_date) if row.calibration_date else None,
            "status": row.status,
        },
    )

    db.commit()
    db.refresh(row)
    return build_flowmeter_config_response(row, db)


@router.delete("/configs/{config_id}")
def delete_flowmeter_config(
    config_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Flowmeter Config", db)

    row = db.query(FlowmeterConfig).filter(FlowmeterConfig.id == config_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Flowmeter config not found")

    create_audit_log(
        db=db,
        module_name="Flowmeter Config",
        action="Delete Flowmeter Config",
        current_user=current_user,
        entity_type="FlowmeterConfig",
        entity_id=row.id,
        entity_label=f"{row.asset_code} / {row.meter_label}",
        remarks="Flowmeter configuration deleted",
        request_path=f"/flowmeter/configs/{config_id}",
        details={
            "location_code": row.location_code,
            "asset_code": row.asset_code,
            "stream_name": row.stream_name,
            "meter_asset_code": row.meter_asset_code,
            "meter_label": row.meter_label,
        },
    )

    db.delete(row)
    db.commit()
    return {"message": "Flowmeter config deleted successfully"}


@router.get("/configs/history", response_model=list[FlowmeterConfigHistoryResponse])
def get_flowmeter_config_history(
    asset_code: str | None = None,
    stream_name: str | None = None,
    meter_label: str | None = None,
    limit: int = 1000,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Flowmeter Config", db)

    q = db.query(FlowmeterConfigHistory)
    if asset_code:
        q = q.filter(FlowmeterConfigHistory.asset_code.ilike(asset_code.strip()))
    if stream_name:
        q = q.filter(FlowmeterConfigHistory.stream_name.ilike(stream_name.strip()))
    if meter_label:
        q = q.filter(FlowmeterConfigHistory.meter_label.ilike(meter_label.strip()))

    safe_limit = min(max(limit, 1), 5000)
    rows = (
        q.order_by(FlowmeterConfigHistory.changed_at.desc(), FlowmeterConfigHistory.id.desc())
        .limit(safe_limit)
        .all()
    )
    return [build_flowmeter_config_history_response(r) for r in rows]


@router.get("/records", response_model=list[FlowmeterRecordResponse])
def get_flowmeter_records(
    location_code: str | None = None,
    asset_code: str | None = None,
    stream_name: str | None = None,
    meter_label: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 500,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Flowmeter Record", db)

    def pick_value(values_map: dict, keys: list[str], default=None):
        for key in keys:
            if key in values_map and values_map[key] not in (None, ""):
                return values_map[key]
        return default

    def to_float(value, default=0.0):
        try:
            return float(value)
        except Exception:
            return default

    q = (
        db.query(OperationTransaction)
        .join(
            OperationTemplate,
            OperationTemplate.id == OperationTransaction.operation_template_id,
        )
        .filter(
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            OperationTemplate.entry_layout_type == "Meter Reading",
        )
    )

    if location_code:
        q = q.filter(OperationTransaction.origin_location_code.ilike(location_code.strip()))
    if asset_code:
        q = q.filter(OperationTransaction.primary_asset_code.ilike(asset_code.strip()))
    if date_from:
        q = q.filter(OperationTransaction.operation_date >= date_from)
    if date_to:
        q = q.filter(OperationTransaction.operation_date <= date_to)

    safe_limit = min(max(limit, 1), 2000)
    transactions = (
        q.order_by(OperationTransaction.operation_date.desc(), OperationTransaction.id.desc())
        .limit(safe_limit)
        .all()
    )

    output_rows = []

    for transaction in transactions:
        value_rows = (
            db.query(OperationTransactionValue)
            .filter(OperationTransactionValue.transaction_id == transaction.id)
            .all()
        )
        values_map = {
            str(v.field_code or ""): v.field_value
            for v in value_rows
            if str(v.field_code or "").strip() != ""
        }

        payload = pick_value(values_map, ["flowmeter_payload", "meter_payload"], default={})
        if not isinstance(payload, dict):
            payload = {}
        payload_inputs = payload.get("inputs") if isinstance(payload.get("inputs"), dict) else {}
        payload_calc = payload.get("calculated") if isinstance(payload.get("calculated"), dict) else {}

        meters = payload_inputs.get("meters") if isinstance(payload_inputs.get("meters"), list) else []
        payload_stream_name = str(
            pick_value(payload_inputs, ["stream_name", "streamName"], default="Default") or "Default"
        ).strip() or "Default"
        if stream_name and payload_stream_name.lower() != stream_name.strip().lower():
            continue

        if meters:
            opening_reading = sum(to_float(m.get("opening_reading")) for m in meters)
            closing_reading = sum(to_float(m.get("closing_reading")) for m in meters)
            gross_observed = to_float(
                payload_calc.get("stream_gross_observed_bbl", payload_calc.get("gross_observed_bbl", 0))
            )
            net_standard = to_float(payload_calc.get("gsv_bbl", 0))
            net_standard_bbl = to_float(payload_calc.get("nsv_bbl", 0))
            meter_factor = 1.0
            meter_unit_clean = "bbls"
            meter_label_value = payload_stream_name
            if meter_label and meter_label_value.strip().lower() != meter_label.strip().lower():
                continue
        else:
            meter_label_value = pick_value(
                payload,
                ["meterLabel", "meter_label", "meterName", "meter_name"],
                default=None,
            )
            if meter_label_value is None:
                meter_label_value = pick_value(
                    values_map,
                    ["meter_label", "meter_name", "meter_stream"],
                    default="",
                )

            opening_reading = pick_value(
                payload_inputs,
                ["openingReading", "opening_reading", "openingMeterReading"],
                default=None,
            )
            if opening_reading is None:
                opening_reading = pick_value(
                    values_map,
                    ["opening_reading", "opening_meter_reading", "opening"],
                    default=0,
                )

            closing_reading = pick_value(
                payload_inputs,
                ["closingReading", "closing_reading", "closingMeterReading"],
                default=None,
            )
            if closing_reading is None:
                closing_reading = pick_value(
                    values_map,
                    ["closing_reading", "closing_meter_reading", "closing"],
                    default=0,
                )

            meter_factor = pick_value(
                payload_inputs,
                ["meterFactor", "meter_factor"],
                default=None,
            )
            if meter_factor is None:
                meter_factor = pick_value(values_map, ["meter_factor", "factor"], default=1)

            meter_unit_value = pick_value(
                payload_inputs,
                ["meterUnit", "meter_unit", "unit"],
                default=None,
            )
            if meter_unit_value is None:
                meter_unit_value = pick_value(values_map, ["meter_unit", "unit"], default="bbls")

            meter_unit_clean = str(meter_unit_value or "bbls").strip().lower()
            if meter_unit_clean not in {"bbls", "m3"}:
                meter_unit_clean = "bbls"

            gross_observed = payload_calc.get("gross_observed")
            if gross_observed is None:
                gross_observed = max(to_float(closing_reading) - to_float(opening_reading), 0) * to_float(meter_factor, 1.0)
            gross_observed = to_float(gross_observed)

            net_standard = payload_calc.get("gsv_bbl")
            if net_standard is None:
                gross_observed_bbl = payload_calc.get("gross_observed_bbl")
                if gross_observed_bbl is None:
                    gross_observed_bbl = (
                        gross_observed if meter_unit_clean == "bbls" else gross_observed * M3_TO_BBLS_FACTOR
                    )
                net_standard = to_float(gross_observed_bbl)
            net_standard = to_float(net_standard)

            net_standard_bbl = payload_calc.get("nsv_bbl")
            if net_standard_bbl is None:
                net_standard_bbl = net_standard
            net_standard_bbl = to_float(net_standard_bbl)

            if meter_label and str(meter_label_value or "").strip().lower() != meter_label.strip().lower():
                continue

        output_rows.append(
            {
                "id": transaction.id,
                "location_code": transaction.origin_location_code,
                "location_name": (
                    db.query(Location.location_name)
                    .filter(Location.location_code.ilike(transaction.origin_location_code))
                    .scalar()
                ),
                "asset_code": transaction.primary_asset_code,
                "asset_name": (
                    db.query(Asset.asset_name)
                    .filter(Asset.asset_code.ilike(transaction.primary_asset_code))
                    .scalar()
                ),
                "stream_name": payload_stream_name,
                "meter_label": str(meter_label_value or ""),
                "reading_date": transaction.operation_date,
                "opening_reading": to_float(opening_reading),
                "closing_reading": to_float(closing_reading),
                "gross_observed": gross_observed,
                "meter_factor": to_float(meter_factor, 1.0),
                "meter_unit": meter_unit_clean,
                "net_standard": net_standard,
                "net_standard_bbl": net_standard_bbl,
                "remarks": transaction.remarks,
                "status": transaction.status,
                "created_by": transaction.created_by,
                "created_at": transaction.created_at,
                "updated_at": transaction.updated_at,
            }
        )

    return output_rows


@router.post("/records", response_model=FlowmeterRecordResponse)
def create_flowmeter_record(
    request: FlowmeterRecordCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Flowmeter Record", db)
    create_audit_log(
        db=db,
        module_name="Flowmeter Record",
        action="Direct Create Blocked",
        current_user=current_user,
        entity_type="FlowmeterRecord",
        entity_id=None,
        entity_label=f"{request.asset_code} / {request.meter_label}",
        remarks="Direct flowmeter record creation blocked by policy",
        request_path="/flowmeter/records",
        details={
            "location_code": request.location_code,
            "asset_code": request.asset_code,
            "meter_label": request.meter_label,
            "reading_date": str(request.reading_date),
        },
    )
    raise HTTPException(
        status_code=400,
        detail=(
            "Direct Flowmeter Record creation is disabled. "
            "Create Flowmeter entries via Operation Entry and approve the ticket."
        ),
    )
