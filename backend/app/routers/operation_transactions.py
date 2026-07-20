from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, and_
from sqlalchemy.orm import Session, aliased
import csv
import io

from app.database import get_db
from app.models import (
    Asset,
    Location,
    OperationTemplate,
    OperationTransaction,
    OperationTransactionValue,
    OperationTransactionStatusHistory,
    OperationType,
    Trip,
    TripEvent,
    TripComparison,
    ShuttleVoyage,
    TankStockLedger,
    VesselStockLedger,
    User,
)
from app.schemas import (
    OperationTransactionCreate,
    OperationTransactionResponse,
    OperationTransactionRegisterPagedResponse,
    OperationTransactionStatusUpdate,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    require_user_permission,
    get_required_permission_for_status_change,
    get_action_code_for_status_change,
    evaluate_operation_workflow_policy,
)
from app.services.audit_service import create_audit_log
from app.utils.helpers import (
    clean_optional_text,
    get_transaction_ticket_number,
    get_current_user_display_name,
    get_location_name_by_code,
    get_location_by_code,
    get_asset_by_code,
)
from app.routers.operation_tasks import (
    create_operation_approval_task_for_transaction,
    close_operation_approval_tasks_for_transaction,
)
from app.services.transaction_helpers import get_operation_type_by_code

router = APIRouter(prefix="/operation-transactions", tags=["Operation Transactions"])


# ---------------------------------------------------------------------------
# Helper functions (operation-transaction-specific)
# ---------------------------------------------------------------------------


def generate_operation_number(db: Session):
    today = datetime.now().strftime("%Y%m%d")
    prefix = f"OP-{today}"
    existing_count = db.query(OperationTransaction).filter(
        OperationTransaction.operation_number.ilike(f"{prefix}%")
    ).count()
    next_number = existing_count + 1
    return f"{prefix}-{next_number:04d}"


def format_operation_date_for_ticket(operation_date):
    if operation_date is None:
        return datetime.now().strftime("%Y%m%d")
    if isinstance(operation_date, str):
        try:
            return datetime.fromisoformat(operation_date).strftime("%Y%m%d")
        except ValueError:
            return datetime.now().strftime("%Y%m%d")
    return operation_date.strftime("%Y%m%d")


def generate_operation_ticket_number(db, location_code, asset_code, operation_date):
    ticket_date = format_operation_date_for_ticket(operation_date)
    clean_location_code = str(location_code).strip().upper()
    clean_asset_code = str(asset_code).strip().upper()
    ticket_prefix = f"{clean_location_code}-{clean_asset_code}-{ticket_date}"
    existing_tickets = (
        db.query(OperationTransaction.operation_ticket_number)
        .filter(OperationTransaction.operation_ticket_number.like(f"{ticket_prefix}-%"))
        .all()
    )
    serial_numbers = []
    for row in existing_tickets:
        existing_ticket = row[0]
        if not existing_ticket:
            continue
        try:
            serial_numbers.append(int(str(existing_ticket).split("-")[-1]))
        except ValueError:
            continue
    next_serial_number = max(serial_numbers) + 1 if serial_numbers else 1
    return f"{ticket_prefix}-{next_serial_number:03d}"


def normalize_jsonb_value(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, list):
        return [normalize_jsonb_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): normalize_jsonb_value(item_value) for key, item_value in value.items()}
    return value


def build_operation_transaction_response(
    transaction: OperationTransaction,
    db: Session,
):
    operation_type = get_operation_type_by_code(
        transaction.operation_type_code, db
    )
    asset = get_asset_by_code(transaction.primary_asset_code, db)

    return {
        "id": transaction.id,
        "operation_number": transaction.operation_number,
        "operation_template_id": transaction.operation_template_id,
        "operation_ticket_number": get_transaction_ticket_number(transaction),
        "ticket_number": get_transaction_ticket_number(transaction),
        "operation_type_code": transaction.operation_type_code,
        "operation_type_name": (
            operation_type.operation_type_name if operation_type else ""
        ),
        "primary_asset_code": transaction.primary_asset_code,
        "primary_asset_name": asset.asset_name if asset else "",
        "primary_asset_type_code": transaction.primary_asset_type_code,
        "convoy_number": transaction.convoy_number,
        "origin_location_code": transaction.origin_location_code,
        "origin_location_name": get_location_name_by_code(
            transaction.origin_location_code, db
        ),
        "destination_location_code": transaction.destination_location_code,
        "destination_location_name": get_location_name_by_code(
            transaction.destination_location_code, db
        ),
        "sender_location_code": transaction.sender_location_code,
        "sender_location_name": get_location_name_by_code(
            transaction.sender_location_code, db
        ),
        "receiver_location_code": transaction.receiver_location_code,
        "receiver_location_name": get_location_name_by_code(
            transaction.receiver_location_code, db
        ),
        "operation_date": transaction.operation_date,
        "operation_start_datetime": transaction.operation_start_datetime,
        "operation_end_datetime": transaction.operation_end_datetime,
        "product_name": transaction.product_name,
        "created_by": transaction.created_by,
        "remarks": transaction.remarks,
        "status": transaction.status,
        "created_at": transaction.created_at,
        "updated_at": transaction.updated_at,
    }


def build_operation_transaction_register_row(
    transaction: OperationTransaction,
    db: Session,
):
    operation_type = get_operation_type_by_code(
        transaction.operation_type_code, db
    )
    location = get_location_by_code(transaction.origin_location_code, db)
    primary_asset = get_asset_by_code(transaction.primary_asset_code, db)

    field_count = (
        db.query(OperationTransactionValue)
        .filter(OperationTransactionValue.transaction_id == transaction.id)
        .count()
    )

    return {
        "id": transaction.id,
        "operation_number": transaction.operation_number,
        "operation_ticket_number": get_transaction_ticket_number(transaction),
        "ticket_number": get_transaction_ticket_number(transaction),
        "operation_date": transaction.operation_date,
        "operation_type_id": operation_type.id if operation_type else None,
        "operation_type_code": transaction.operation_type_code,
        "operation_type_name": operation_type.operation_type_name
        if operation_type
        else "",
        "location_id": location.id if location else None,
        "location_name": location.location_name if location else "",
        "location_code": transaction.origin_location_code,
        "primary_asset_id": primary_asset.id if primary_asset else None,
        "primary_asset_name": primary_asset.asset_name
        if primary_asset
        else "",
        "primary_asset_code": transaction.primary_asset_code,
        "convoy_number": transaction.convoy_number,
        "status": transaction.status,
        "field_count": field_count,
        "created_at": transaction.created_at,
    }


def validate_operation_transaction(
    transaction: OperationTransactionCreate,
    db: Session,
):
    if not transaction.operation_type_code:
        raise HTTPException(
            status_code=400,
            detail="Operation type is missing in operation entry request",
        )

    if not transaction.primary_asset_code:
        raise HTTPException(
            status_code=400,
            detail="Primary asset is missing in operation entry request",
        )

    if not transaction.origin_location_code:
        raise HTTPException(
            status_code=400,
            detail="Origin location is missing in operation entry request",
        )

    operation_type = db.query(OperationType).filter(
        OperationType.operation_type_code.ilike(transaction.operation_type_code)
    ).first()

    if not operation_type:
        raise HTTPException(
            status_code=400,
            detail="Operation type not found",
        )

    if operation_type.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active operation types can be used",
        )

    asset = db.query(Asset).filter(
        Asset.asset_code.ilike(transaction.primary_asset_code)
    ).first()

    if not asset:
        raise HTTPException(
            status_code=400,
            detail="Asset not found",
        )

    if asset.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active assets can be used for operation",
        )

    if (
        asset.asset_type_code.lower()
        != operation_type.applicable_asset_type_code.lower()
    ):
        raise HTTPException(
            status_code=400,
            detail="Selected operation type is not applicable for this asset type",
        )

    origin_location = db.query(Location).filter(
        Location.location_code.ilike(transaction.origin_location_code)
    ).first()

    if not origin_location:
        raise HTTPException(
            status_code=400,
            detail="Origin location not found",
        )

    if origin_location.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active origin location can be used",
        )

    if transaction.destination_location_code:
        destination_location = db.query(Location).filter(
            Location.location_code.ilike(transaction.destination_location_code)
        ).first()

        if not destination_location:
            raise HTTPException(
                status_code=400,
                detail="Destination location not found",
            )

        if destination_location.status != "Active":
            raise HTTPException(
                status_code=400,
                detail="Only Active destination location can be used",
            )

    if operation_type.requires_sender_location == "Yes":
        if not transaction.sender_location_code:
            raise HTTPException(
                status_code=400,
                detail="Sender location is required for this operation type",
            )

    if operation_type.requires_receiver_location == "Yes":
        if not transaction.receiver_location_code:
            raise HTTPException(
                status_code=400,
                detail="Receiver location is required for this operation type",
            )

    return operation_type, asset


def get_filtered_operation_transaction_rows(
    db: Session,
    date_from: str | None = None,
    date_to: str | None = None,
    operation_type_id: int | None = None,
    operation_type_code: str | None = None,
    location_id: int | None = None,
    location_code: str | None = None,
    asset_id: int | None = None,
    asset_code: str | None = None,
    status: str | None = None,
    search: str | None = None,
):
    query = db.query(OperationTransaction)

    if date_from:
        query = query.filter(OperationTransaction.operation_date >= date_from)

    if date_to:
        query = query.filter(OperationTransaction.operation_date <= date_to)

    resolved_operation_type_code = clean_optional_text(operation_type_code)

    if operation_type_id:
        operation_type = (
            db.query(OperationType)
            .filter(OperationType.id == operation_type_id)
            .first()
        )
        if operation_type:
            resolved_operation_type_code = operation_type.operation_type_code

    if resolved_operation_type_code:
        query = query.filter(
            OperationTransaction.operation_type_code.ilike(
                resolved_operation_type_code
            )
        )

    resolved_location_code = clean_optional_text(location_code)

    if location_id:
        location = (
            db.query(Location)
            .filter(Location.id == location_id)
            .first()
        )
        if location:
            resolved_location_code = location.location_code

    if resolved_location_code:
        query = query.filter(
            OperationTransaction.origin_location_code.ilike(
                resolved_location_code
            )
        )

    resolved_asset_code = clean_optional_text(asset_code)

    if asset_id:
        asset = (
            db.query(Asset)
            .filter(Asset.id == asset_id)
            .first()
        )
        if asset:
            resolved_asset_code = asset.asset_code

    if resolved_asset_code:
        query = query.filter(
            OperationTransaction.primary_asset_code.ilike(
                resolved_asset_code
            )
        )

    if status:
        query = query.filter(OperationTransaction.status == status)

    transactions = query.order_by(OperationTransaction.id.desc()).all()

    result = []

    for transaction in transactions:
        row = build_operation_transaction_register_row(transaction, db)

        if search:
            search_value = search.lower().strip()
            searchable_text = " ".join(
                [
                    str(row["ticket_number"] or ""),
                    str(row["operation_number"] or ""),
                    str(row["operation_type_code"] or ""),
                    str(row["operation_type_name"] or ""),
                    str(row["location_name"] or ""),
                    str(row["location_code"] or ""),
                    str(row["primary_asset_name"] or ""),
                    str(row["primary_asset_code"] or ""),
                    str(row["status"] or ""),
                ]
            ).lower()

            if search_value not in searchable_text:
                continue

        result.append(row)

    return result


# ---------------------------------------------------------------------------
# Shared utility functions (also defined in main.py; should be extracted to
# a shared module like app.services.trip_service or app.services.operation_service)
# ---------------------------------------------------------------------------

def get_trip_by_convoy_or_none(db: Session, convoy_number: str | None):
    if not convoy_number:
        return None
    return db.query(Trip).filter(Trip.convoy_number.ilike(convoy_number)).first()


def ensure_trip_not_closed(trip: Trip | None):
    if trip is None:
        return
    if str(trip.status or "").strip().upper() == "CLOSED":
        raise HTTPException(
            status_code=400,
            detail=f"Trip '{trip.convoy_number}' is already CLOSED. Cannot modify.",
        )


def ensure_shuttle_voyage_not_closed(voyage: ShuttleVoyage | None):
    if voyage is None:
        return
    if str(voyage.status or "").strip().upper() == "CLOSED":
        raise HTTPException(
            status_code=400,
            detail=f"Shuttle voyage '{voyage.voyage_number}' is already CLOSED.",
        )


def get_or_create_shuttle_voyage(
    db: Session,
    location_code: str,
    shuttle_number: str,
    shuttle_asset_code: str,
    current_user: User,
):
    if not shuttle_number:
        raise HTTPException(
            status_code=400,
            detail="Shuttle number (convoy number) is required for Shuttle Tracking.",
        )

    created_by_display = get_current_user_display_name(current_user)

    existing = (
        db.query(ShuttleVoyage)
        .filter(ShuttleVoyage.convoy_number.ilike(shuttle_number))
        .order_by(ShuttleVoyage.id.desc())
        .first()
    )

    if existing:
        return existing

    from datetime import date as date_type
    today_str = date_type.today().strftime("%Y%m%d")
    prefix = f"VOY-{today_str}"
    count = (
        db.query(ShuttleVoyage)
        .filter(ShuttleVoyage.voyage_number.ilike(f"{prefix}%"))
        .count()
    )
    voyage_number = f"{prefix}-{count + 1:04d}"

    voyage = ShuttleVoyage(
        voyage_number=voyage_number,
        convoy_number=shuttle_number,
        shuttle_asset_code=shuttle_asset_code,
        location_code=location_code,
        status="OPEN",
        created_by=created_by_display,
    )
    db.add(voyage)
    db.flush()

    create_audit_log(
        db=db,
        module_name="Shuttle Voyage",
        action="Create Shuttle Voyage",
        current_user=current_user,
        entity_type="ShuttleVoyage",
        entity_id=voyage.id,
        entity_label=voyage.voyage_number,
        operation_number=None,
        remarks="Auto-created on Shuttle Tracking ticket approval",
        request_path="/operation-transactions/{transaction_id}/status",
        details={
            "convoy_number": shuttle_number,
            "shuttle_asset_code": shuttle_asset_code,
            "location_code": location_code,
        },
    )

    return voyage


def validate_operation_status_transition(current_status, next_status):
    allowed_transitions = {
        "Draft": ["Submitted", "Cancelled"],
        "Submitted": ["Approved", "Rejected", "Draft"],
        "Rejected": ["Submitted", "Cancelled"],
        "Approved": [],
        "Cancelled": [],
    }

    if current_status not in allowed_transitions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid current status: {current_status}",
        )

    if next_status not in allowed_transitions[current_status]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot change status from {current_status} to {next_status}",
        )


def validate_multi_tank_seals_before_submit(
    db: Session,
    transaction: OperationTransaction,
    submit_remarks: str | None,
):
    template = (
        db.query(OperationTemplate)
        .filter(OperationTemplate.id == transaction.operation_template_id)
        .first()
    )

    if not template or (template.entry_layout_type or "") != "Multi-Tank Before/After":
        return None

    payload_row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction.id,
            OperationTransactionValue.field_code == "multi_tank_payload",
        )
        .first()
    )

    if payload_row is None or payload_row.field_value is None:
        raise HTTPException(
            status_code=400,
            detail="Multi-Tank payload is missing. Open Operation Entry and save the ticket before submitting.",
        )

    payload = payload_row.field_value if isinstance(payload_row.field_value, dict) else {}

    seals_after = (((payload.get("seals") or {}).get("after")) or {})
    temporary = (seals_after.get("temporary") or {})

    required_temp_keys = [
        "portManifoldSeal",
        "stbdManifoldSeal",
        "pumproomSeal",
    ]

    missing = []
    for k in required_temp_keys:
        if not str(temporary.get(k) or "").strip():
            missing.append(k)

    if missing:
        raise HTTPException(
            status_code=400,
            detail=(
                "Seal details are incomplete. Please enter AFTER temporary seals: "
                + ", ".join(missing)
            ),
        )

    tank_seals = seals_after.get("tankSeals") or {}
    mismatch_count = 0

    if isinstance(tank_seals, dict):
        for _, positions in tank_seals.items():
            if not isinstance(positions, dict):
                continue
            for _, cell in positions.items():
                if not isinstance(cell, dict):
                    continue
                master = str(cell.get("master") or "").strip()
                observed = str(cell.get("observed") or "").strip()
                if master and observed and master != observed:
                    mismatch_count += 1

    if mismatch_count > 0 and not str(submit_remarks or "").strip():
        raise HTTPException(
            status_code=400,
            detail=(
                f"Seal mismatch detected ({mismatch_count} mismatch). "
                "Please add remarks before submitting."
            ),
        )

    return {
        "required_temp_seals": required_temp_keys,
        "missing_temp_seals": missing,
        "mismatch_count": mismatch_count,
    }


def get_transaction_value_text(db: Session, transaction_id: int, field_code: str):
    v = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction_id,
            OperationTransactionValue.field_code == field_code,
        )
        .first()
    )
    if not v:
        return None
    if v.field_value is None:
        return None
    return str(v.field_value).strip()


def resolve_barge_event_type_from_ticket(db: Session, transaction: OperationTransaction):
    stage = get_transaction_value_text(db, transaction.id, "barge_event_type")
    if stage:
        stage_u = stage.strip().upper()
        if stage_u in ["LOAD_1", "LOAD_2_TOPUP", "UNLOAD", "STS"]:
            return stage_u
    code_u = str(transaction.operation_type_code or "").upper()
    if any(k in code_u for k in ["UNLOAD", "DISCHARGE", "RECEIPT", "RECEIVE"]):
        return "UNLOAD"
    return None


def auto_create_trip_event_on_submit(
    db: Session,
    transaction: OperationTransaction,
    current_user: User,
):
    return None, None


def auto_create_barge_tracking_on_approval(
    db: Session,
    transaction: OperationTransaction,
    current_user: User,
):
    convoy = clean_optional_text(transaction.convoy_number)
    if convoy is None:
        return None, None, None

    if str(transaction.primary_asset_type_code or "").strip().upper() != "BARGE":
        return None, None, None

    if transaction.status != "Approved":
        return None, None, None

    asset_code = str(transaction.primary_asset_code or "").strip()
    if not asset_code:
        return None, None, None

    created_by_display = get_current_user_display_name(current_user)

    trip = db.query(Trip).filter(Trip.convoy_number.ilike(convoy)).first()
    if not trip:
        trip = Trip(
            convoy_number=convoy,
            primary_barge_asset_code=asset_code,
            status="OPEN",
            created_by=created_by_display,
            remarks=None,
        )
        db.add(trip)
        db.flush()

    ensure_trip_not_closed(trip)

    chosen = resolve_barge_event_type_from_ticket(db, transaction)

    if chosen is None:
        prev_load = (
            db.query(TripEvent)
            .filter(
                TripEvent.trip_id == trip.id,
                TripEvent.asset_code == asset_code,
                TripEvent.event_type.in_(["LOAD_1", "LOAD_2_TOPUP"]),
            )
            .order_by(TripEvent.sequence_no.desc(), TripEvent.id.desc())
            .first()
        )
        chosen = "LOAD_1" if not prev_load else "LOAD_2_TOPUP"

    existing = (
        db.query(TripEvent)
        .filter(TripEvent.operation_transaction_id == transaction.id)
        .first()
    )

    if existing:
        existing.event_type = chosen
        existing.location_code = clean_optional_text(transaction.origin_location_code) or existing.location_code
        existing.asset_code = asset_code
        existing.event_datetime = transaction.operation_start_datetime or existing.event_datetime
        existing.updated_at = datetime.now()
        new_event = existing
    else:
        max_seq = (
            db.query(func.max(TripEvent.sequence_no))
            .filter(TripEvent.trip_id == trip.id)
            .scalar()
        )
        seq = (max_seq or 0) + 1

        new_event = TripEvent(
            trip_id=trip.id,
            event_type=chosen,
            location_code=clean_optional_text(transaction.origin_location_code),
            asset_code=asset_code,
            operation_transaction_id=transaction.id,
            sequence_no=seq,
            event_datetime=transaction.operation_start_datetime or datetime.now(),
            created_by=created_by_display,
            remarks="Auto-created on Approval",
        )
        db.add(new_event)
        db.flush()

    new_cmp = None

    if chosen == "UNLOAD":
        latest_load = (
            db.query(TripEvent)
            .filter(
                TripEvent.trip_id == trip.id,
                TripEvent.asset_code == asset_code,
                TripEvent.event_type.in_(["LOAD_1", "LOAD_2_TOPUP"]),
                TripEvent.operation_transaction_id.isnot(None),
            )
            .order_by(TripEvent.sequence_no.desc(), TripEvent.id.desc())
            .first()
        )

        if latest_load and latest_load.operation_transaction_id:
            left_tx = (
                db.query(OperationTransaction)
                .filter(OperationTransaction.id == latest_load.operation_transaction_id)
                .first()
            )

            if left_tx and left_tx.status == "Approved":
                existing_cmp = (
                    db.query(TripComparison)
                    .filter(
                        TripComparison.trip_id == trip.id,
                        TripComparison.comparison_type == "LOAD_AFTER_vs_UNLOAD_BEFORE",
                        TripComparison.left_transaction_id == left_tx.id,
                        TripComparison.right_transaction_id == transaction.id,
                    )
                    .first()
                )

                if not existing_cmp:
                    left_payload = load_multi_tank_payload(db, left_tx.id)
                    right_payload = load_multi_tank_payload(db, transaction.id)

                    if left_payload and right_payload:
                        summary_json, per_tank_json = build_multitank_comparison_json(
                            left_tx=left_tx,
                            right_tx=transaction,
                            comparison_type="LOAD_AFTER_vs_UNLOAD_BEFORE",
                            left_payload=left_payload,
                            right_payload=right_payload,
                        )

                        new_cmp = TripComparison(
                            trip_id=trip.id,
                            comparison_type="LOAD_AFTER_vs_UNLOAD_BEFORE",
                            left_transaction_id=left_tx.id,
                            right_transaction_id=transaction.id,
                            summary_json=summary_json,
                            per_tank_json=per_tank_json,
                            created_by=created_by_display,
                            remarks="Auto-created on UNLOAD Approval",
                        )
                        db.add(new_cmp)
                        db.flush()

    return trip, new_event, new_cmp


def load_multi_tank_payload(db: Session, transaction_id: int):
    row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction_id,
            OperationTransactionValue.field_code == "multi_tank_payload",
        )
        .first()
    )
    if row is None:
        return None
    return row.field_value if isinstance(row.field_value, dict) else None


def build_multitank_comparison_json(
    left_tx,
    right_tx,
    comparison_type: str,
    left_payload: dict,
    right_payload: dict,
):
    summary = {}
    per_tank = {}

    left_tanks = (left_payload.get("tanks") or {}) if isinstance(left_payload, dict) else {}
    right_tanks = (right_payload.get("tanks") or {}) if isinstance(right_payload, dict) else {}

    all_tank_keys = set(list(left_tanks.keys()) + list(right_tanks.keys()))

    for tank_key in sorted(all_tank_keys):
        left_tank = left_tanks.get(tank_key, {}) if isinstance(left_tanks, dict) else {}
        right_tank = right_tanks.get(tank_key, {}) if isinstance(right_tanks, dict) else {}

        left_after = (left_tank.get("after") or {}) if isinstance(left_tank, dict) else {}
        right_before = (right_tank.get("before") or {}) if isinstance(right_tank, dict) else {}

        left_ullage = left_after.get("ullage")
        right_ullage = right_before.get("ullage")
        left_temp = left_after.get("temperature")
        right_temp = right_before.get("temperature")
        left_volume = left_after.get("volume")
        right_volume = right_before.get("volume")
        left_mass = left_after.get("mass")
        right_mass = right_before.get("mass")
        left_density = left_after.get("density")
        right_density = right_before.get("density")

        try:
            ullage_diff = round(float(right_ullage or 0) - float(left_ullage or 0), 2) if left_ullage is not None and right_ullage is not None else None
        except (ValueError, TypeError):
            ullage_diff = None

        try:
            volume_diff = round(float(right_volume or 0) - float(left_volume or 0), 2) if left_volume is not None and right_volume is not None else None
        except (ValueError, TypeError):
            volume_diff = None

        try:
            mass_diff = round(float(right_mass or 0) - float(left_mass or 0), 2) if left_mass is not None and right_mass is not None else None
        except (ValueError, TypeError):
            mass_diff = None

        per_tank[tank_key] = {
            "left": {
                "ullage": normalize_jsonb_value(left_ullage),
                "temperature": normalize_jsonb_value(left_temp),
                "volume": normalize_jsonb_value(left_volume),
                "mass": normalize_jsonb_value(left_mass),
                "density": normalize_jsonb_value(left_density),
            },
            "right": {
                "ullage": normalize_jsonb_value(right_ullage),
                "temperature": normalize_jsonb_value(right_temp),
                "volume": normalize_jsonb_value(right_volume),
                "mass": normalize_jsonb_value(right_mass),
                "density": normalize_jsonb_value(right_density),
            },
            "difference": {
                "ullage": ullage_diff,
                "volume": volume_diff,
                "mass": mass_diff,
            },
        }

        # Accumulate totals for summary
        for vol_key, diff_val in [("volume", volume_diff), ("mass", mass_diff)]:
            if diff_val is not None:
                summary[vol_key] = summary.get(vol_key, 0) + diff_val

    summary = {k: round(v, 2) for k, v in summary.items()}

    return summary, per_tank


def create_tank_stock_ledger_from_approved_transaction(
    db: Session,
    transaction: OperationTransaction,
    current_user: User,
):
    template = (
        db.query(OperationTemplate)
        .filter(OperationTemplate.id == transaction.operation_template_id)
        .first()
    )

    if not template:
        return None, None, None

    if str(template.entry_layout_type or "").strip() not in [
        "Stock Movement",
        "Multi-Tank Before/After",
        "Tank Gauging",
    ]:
        return None, None, None

    payload_row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction.id,
            OperationTransactionValue.field_code == "multi_tank_payload",
        )
        .first()
    )

    if not payload_row or not payload_row.field_value:
        return None, None, None

    payload = payload_row.field_value if isinstance(payload_row.field_value, dict) else {}

    tanks = payload.get("tanks") or {}
    if not isinstance(tanks, dict):
        return None, None, None

    created_by_display = get_current_user_display_name(current_user)
    location_code = transaction.origin_location_code

    entries = []
    for tank_key, tank_data in tanks.items():
        if not isinstance(tank_data, dict):
            continue

        after_data = tank_data.get("after") or {}
        before_data = tank_data.get("before") or {}

        after_volume = after_data.get("volume")
        before_volume = before_data.get("volume")
        after_mass = after_data.get("mass")
        before_mass = before_data.get("mass")
        after_ullage = after_data.get("ullage")
        before_ullage = before_data.get("ullage")
        after_temp = after_data.get("temperature")
        before_temp = before_data.get("temperature")
        after_density = after_data.get("density")
        before_density = before_data.get("density")

        try:
            volume_change = round(float(after_volume or 0) - float(before_volume or 0), 2) if before_volume is not None and after_volume is not None else None
        except (ValueError, TypeError):
            volume_change = None

        try:
            mass_change = round(float(after_mass or 0) - float(before_mass or 0), 2) if before_mass is not None and after_mass is not None else None
        except (ValueError, TypeError):
            mass_change = None

        try:
            ullage_change = round(float(after_ullage or 0) - float(before_ullage or 0), 2) if before_ullage is not None and after_ullage is not None else None
        except (ValueError, TypeError):
            ullage_change = None

        entry = TankStockLedger(
            transaction_id=transaction.id,
            operation_number=transaction.operation_number,
            tank_number=tank_key,
            location_code=location_code,
            before_volume=before_volume,
            after_volume=after_volume,
            volume_change=volume_change,
            before_mass=before_mass,
            after_mass=after_mass,
            mass_change=mass_change,
            before_ullage=before_ullage,
            after_ullage=after_ullage,
            ullage_change=ullage_change,
            before_temperature=before_temp,
            after_temperature=after_temp,
            before_density=before_density,
            after_density=after_density,
            operation_date=transaction.operation_date,
            created_by=created_by_display,
        )
        db.add(entry)
        entries.append(entry)

    db.flush()
    return entries, location_code, tanks


def create_or_update_vessel_stock_ledger_from_approved_transaction(
    db: Session,
    transaction: OperationTransaction,
    current_user: User,
):
    template = (
        db.query(OperationTemplate)
        .filter(OperationTemplate.id == transaction.operation_template_id)
        .first()
    )

    if not template:
        return None, None

    if str(template.entry_layout_type or "").strip() not in [
        "Stock Movement",
        "Multi-Tank Before/After",
        "Vessel Cycle",
    ]:
        return None, None

    payload_row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction.id,
            OperationTransactionValue.field_code == "multi_tank_payload",
        )
        .first()
    )

    if not payload_row or not payload_row.field_value:
        return None, None

    payload = payload_row.field_value if isinstance(payload_row.field_value, dict) else {}

    tanks = payload.get("tanks") or {}
    if not isinstance(tanks, dict):
        return None, None

    created_by_display = get_current_user_display_name(current_user)
    entries = []

    for tank_key, tank_data in tanks.items():
        if not isinstance(tank_data, dict):
            continue

        after_data = tank_data.get("after") or {}
        before_data = tank_data.get("before") or {}

        after_volume = after_data.get("volume")
        before_volume = before_data.get("volume")
        after_mass = after_data.get("mass")
        before_mass = before_data.get("mass")

        try:
            volume_change = round(float(after_volume or 0) - float(before_volume or 0), 2) if before_volume is not None and after_volume is not None else None
        except (ValueError, TypeError):
            volume_change = None

        try:
            mass_change = round(float(after_mass or 0) - float(before_mass or 0), 2) if before_mass is not None and after_mass is not None else None
        except (ValueError, TypeError):
            mass_change = None

        existing = (
            db.query(VesselStockLedger)
            .filter(
                VesselStockLedger.transaction_id == transaction.id,
                VesselStockLedger.tank_number == tank_key,
            )
            .first()
        )

        if existing:
            existing.before_volume = before_volume
            existing.after_volume = after_volume
            existing.volume_change = volume_change
            existing.before_mass = before_mass
            existing.after_mass = after_mass
            existing.mass_change = mass_change
            existing.updated_at = datetime.now()
        else:
            entry = VesselStockLedger(
                transaction_id=transaction.id,
                operation_number=transaction.operation_number,
                vessel_asset_code=transaction.primary_asset_code,
                tank_number=tank_key,
                before_volume=before_volume,
                after_volume=after_volume,
                volume_change=volume_change,
                before_mass=before_mass,
                after_mass=after_mass,
                mass_change=mass_change,
                operation_date=transaction.operation_date,
                created_by=created_by_display,
            )
            db.add(entry)
            entries.append(entry)

    db.flush()
    return entries, tanks


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
def get_operation_transactions(
    date_from: str | None = None,
    date_to: str | None = None,
    operation_type_id: int | None = None,
    operation_type_code: str | None = None,
    location_id: int | None = None,
    location_code: str | None = None,
    asset_id: int | None = None,
    asset_code: str | None = None,
    status: str | None = None,
    search: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Operation Transaction",
        db,
    )

    return get_filtered_operation_transaction_rows(
        db=db,
        date_from=date_from,
        date_to=date_to,
        operation_type_id=operation_type_id,
        operation_type_code=operation_type_code,
        location_id=location_id,
        location_code=location_code,
        asset_id=asset_id,
        asset_code=asset_code,
        status=status,
        search=search,
    )


@router.get("/paged", response_model=OperationTransactionRegisterPagedResponse)
def get_operation_transactions_paged(
    date_from: str | None = None,
    date_to: str | None = None,
    operation_type_id: int | None = None,
    operation_type_code: str | None = None,
    location_id: int | None = None,
    location_code: str | None = None,
    asset_id: int | None = None,
    asset_code: str | None = None,
    status: str | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 20,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Operation Transaction", db)

    if page < 1:
        page = 1
    if page_size < 1:
        page_size = 1
    if page_size > 200:
        page_size = 200

    resolved_operation_type_code = clean_optional_text(operation_type_code)
    resolved_location_code = clean_optional_text(location_code)
    resolved_asset_code = clean_optional_text(asset_code)
    resolved_search = clean_optional_text(search)
    resolved_status = clean_optional_text(status)

    if operation_type_id:
        op = (
            db.query(OperationType)
            .filter(OperationType.id == operation_type_id)
            .first()
        )
        if op:
            resolved_operation_type_code = op.operation_type_code

    if location_id:
        loc = db.query(Location).filter(Location.id == location_id).first()
        if loc:
            resolved_location_code = loc.location_code

    if asset_id:
        ast = db.query(Asset).filter(Asset.id == asset_id).first()
        if ast:
            resolved_asset_code = ast.asset_code

    OT = aliased(OperationType)
    LOC = aliased(Location)
    AST = aliased(Asset)

    value_count_subq = (
        db.query(
            OperationTransactionValue.transaction_id.label("tx_id"),
            func.count(OperationTransactionValue.id).label("field_count"),
        )
        .group_by(OperationTransactionValue.transaction_id)
        .subquery()
    )

    base_query = (
        db.query(
            OperationTransaction.id.label("id"),
            OperationTransaction.operation_number.label("operation_number"),
            OperationTransaction.operation_ticket_number.label("operation_ticket_number"),
            OperationTransaction.convoy_number.label("convoy_number"),
            OperationTransaction.operation_date.label("operation_date"),
            OperationTransaction.operation_type_code.label("operation_type_code"),
            OperationTransaction.origin_location_code.label("origin_location_code"),
            OperationTransaction.primary_asset_code.label("primary_asset_code"),
            OperationTransaction.status.label("status"),
            OperationTransaction.created_at.label("created_at"),
            OT.id.label("operation_type_id"),
            OT.operation_type_name.label("operation_type_name"),
            LOC.id.label("location_id"),
            LOC.location_name.label("location_name"),
            AST.id.label("asset_id"),
            AST.asset_name.label("asset_name"),
            func.coalesce(value_count_subq.c.field_count, 0).label("field_count"),
        )
        .outerjoin(OT, OT.operation_type_code == OperationTransaction.operation_type_code)
        .outerjoin(LOC, LOC.location_code == OperationTransaction.origin_location_code)
        .outerjoin(AST, AST.asset_code == OperationTransaction.primary_asset_code)
        .outerjoin(value_count_subq, value_count_subq.c.tx_id == OperationTransaction.id)
    )

    if date_from:
        base_query = base_query.filter(OperationTransaction.operation_date >= date_from)

    if date_to:
        base_query = base_query.filter(OperationTransaction.operation_date <= date_to)

    if resolved_operation_type_code:
        base_query = base_query.filter(
            OperationTransaction.operation_type_code.ilike(resolved_operation_type_code)
        )

    if resolved_location_code:
        base_query = base_query.filter(
            OperationTransaction.origin_location_code.ilike(resolved_location_code)
        )

    if resolved_asset_code:
        base_query = base_query.filter(
            OperationTransaction.primary_asset_code.ilike(resolved_asset_code)
        )

    if resolved_status:
        base_query = base_query.filter(OperationTransaction.status == resolved_status)

    if resolved_search:
        s = f"%{resolved_search.lower()}%"
        base_query = base_query.filter(
            or_(
                func.lower(func.coalesce(OperationTransaction.operation_ticket_number, "")).ilike(s),
                func.lower(func.coalesce(OperationTransaction.operation_number, "")).ilike(s),
                func.lower(func.coalesce(OperationTransaction.operation_type_code, "")).ilike(s),
                func.lower(func.coalesce(OT.operation_type_name, "")).ilike(s),
                func.lower(func.coalesce(OperationTransaction.origin_location_code, "")).ilike(s),
                func.lower(func.coalesce(LOC.location_name, "")).ilike(s),
                func.lower(func.coalesce(OperationTransaction.primary_asset_code, "")).ilike(s),
                func.lower(func.coalesce(AST.asset_name, "")).ilike(s),
                func.lower(func.coalesce(OperationTransaction.status, "")).ilike(s),
            )
        )

    total_rows = base_query.count()

    count_query = (
        db.query(OperationTransaction.status, func.count(OperationTransaction.id))
        .outerjoin(OT, OT.operation_type_code == OperationTransaction.operation_type_code)
        .outerjoin(LOC, LOC.location_code == OperationTransaction.origin_location_code)
        .outerjoin(AST, AST.asset_code == OperationTransaction.primary_asset_code)
    )

    if date_from:
        count_query = count_query.filter(OperationTransaction.operation_date >= date_from)
    if date_to:
        count_query = count_query.filter(OperationTransaction.operation_date <= date_to)
    if resolved_operation_type_code:
        count_query = count_query.filter(OperationTransaction.operation_type_code.ilike(resolved_operation_type_code))
    if resolved_location_code:
        count_query = count_query.filter(OperationTransaction.origin_location_code.ilike(resolved_location_code))
    if resolved_asset_code:
        count_query = count_query.filter(OperationTransaction.primary_asset_code.ilike(resolved_asset_code))
    if resolved_search:
        s = f"%{resolved_search.lower()}%"
        count_query = count_query.filter(
            or_(
                func.lower(func.coalesce(OperationTransaction.operation_ticket_number, "")).ilike(s),
                func.lower(func.coalesce(OperationTransaction.operation_number, "")).ilike(s),
                func.lower(func.coalesce(OperationTransaction.operation_type_code, "")).ilike(s),
                func.lower(func.coalesce(OT.operation_type_name, "")).ilike(s),
                func.lower(func.coalesce(OperationTransaction.origin_location_code, "")).ilike(s),
                func.lower(func.coalesce(LOC.location_name, "")).ilike(s),
                func.lower(func.coalesce(OperationTransaction.primary_asset_code, "")).ilike(s),
                func.lower(func.coalesce(AST.asset_name, "")).ilike(s),
                func.lower(func.coalesce(OperationTransaction.status, "")).ilike(s),
            )
        )

    status_counts_raw = (
        count_query.group_by(OperationTransaction.status).all()
    )

    status_counts = [
        {"status": (row[0] or ""), "count": int(row[1] or 0)}
        for row in status_counts_raw
        if (row[0] or "").strip() != ""
    ]

    offset = (page - 1) * page_size

    rows_raw = (
        base_query.order_by(OperationTransaction.id.desc())
        .offset(offset)
        .limit(page_size + 1)
        .all()
    )

    has_more = len(rows_raw) > page_size
    rows_raw = rows_raw[:page_size]

    rows = []
    for r in rows_raw:
        ticket_number = r.operation_ticket_number or r.operation_number or ""
        rows.append(
            {
                "id": r.id,
                "ticket_number": ticket_number,
                "operation_number": r.operation_number,
                "convoy_number": r.convoy_number,
                "operation_date": r.operation_date,
                "operation_type_id": r.operation_type_id,
                "operation_type_code": r.operation_type_code,
                "operation_type_name": r.operation_type_name or "",
                "location_id": r.location_id,
                "location_code": r.origin_location_code,
                "location_name": r.location_name or "",
                "primary_asset_id": r.asset_id,
                "primary_asset_code": r.primary_asset_code,
                "primary_asset_name": r.asset_name or "",
                "status": r.status or "",
                "field_count": int(r.field_count or 0),
                "created_at": r.created_at,
            }
        )

    return {
        "rows": rows,
        "total_rows": total_rows,
        "page": page,
        "page_size": page_size,
        "has_more": has_more,
        "status_counts": status_counts,
    }


@router.get("/export/csv")
def export_operation_transactions_csv(
    date_from: str | None = None,
    date_to: str | None = None,
    operation_type_id: int | None = None,
    operation_type_code: str | None = None,
    location_id: int | None = None,
    location_code: str | None = None,
    asset_id: int | None = None,
    asset_code: str | None = None,
    status: str | None = None,
    search: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Operation Transaction",
        db,
    )

    rows = get_filtered_operation_transaction_rows(
        db=db,
        date_from=date_from,
        date_to=date_to,
        operation_type_id=operation_type_id,
        operation_type_code=operation_type_code,
        location_id=location_id,
        location_code=location_code,
        asset_id=asset_id,
        asset_code=asset_code,
        status=status,
        search=search,
    )

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow(["Operation Transaction Register"])
    writer.writerow(["Generated At", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])
    writer.writerow(["Record Count", len(rows)])
    writer.writerow([])

    writer.writerow(["Applied Filters"])
    writer.writerow(["Date From", date_from or "All"])
    writer.writerow(["Date To", date_to or "All"])
    writer.writerow(["Operation Type ID", operation_type_id or "All"])
    writer.writerow(["Operation Type Code", operation_type_code or "All"])
    writer.writerow(["Location ID", location_id or "All"])
    writer.writerow(["Location Code", location_code or "All"])
    writer.writerow(["Asset ID", asset_id or "All"])
    writer.writerow(["Asset Code", asset_code or "All"])
    writer.writerow(["Status", status or "All"])
    writer.writerow(["Search", search or ""])
    writer.writerow([])

    writer.writerow(
        [
            "Ticket Number",
            "Operation Number",
            "Operation Date",
            "Operation Type Code",
            "Operation Type Name",
            "Location Code",
            "Location Name",
            "Primary Asset Code",
            "Primary Asset Name",
            "Field Count",
            "Status",
            "Created At",
        ]
    )

    for row in rows:
        writer.writerow(
            [
                row.get("ticket_number", ""),
                row.get("operation_number", ""),
                row.get("operation_date", ""),
                row.get("operation_type_code", ""),
                row.get("operation_type_name", ""),
                row.get("location_code", ""),
                row.get("location_name", ""),
                row.get("primary_asset_code", ""),
                row.get("primary_asset_name", ""),
                row.get("field_count", ""),
                row.get("status", ""),
                row.get("created_at", ""),
            ]
        )

    output.seek(0)

    filename = f"operation-transaction-register-{datetime.now().strftime('%Y%m%d-%H%M%S')}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )


@router.post("", response_model=OperationTransactionResponse)
def create_operation_transaction(
    transaction: OperationTransactionCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Create Operation Entry",
        db,
    )

    operation_type, asset = validate_operation_transaction(transaction, db)

    created_by_display = get_current_user_display_name(current_user)

    new_transaction = OperationTransaction(
        operation_number=generate_operation_number(db),
        operation_type_code=operation_type.operation_type_code,
        primary_asset_code=asset.asset_code,
        primary_asset_type_code=asset.asset_type_code,
        convoy_number=clean_optional_text(transaction.convoy_number),
        origin_location_code=transaction.origin_location_code.strip(),
        destination_location_code=clean_optional_text(
            transaction.destination_location_code
        ),
        sender_location_code=clean_optional_text(transaction.sender_location_code),
        receiver_location_code=clean_optional_text(transaction.receiver_location_code),
        operation_date=transaction.operation_date,
        operation_start_datetime=transaction.operation_start_datetime,
        operation_end_datetime=transaction.operation_end_datetime,
        product_name=clean_optional_text(transaction.product_name),
        created_by=created_by_display,
        remarks=clean_optional_text(transaction.remarks),
        status=transaction.status or "Draft",
    )

    db.add(new_transaction)
    db.flush()

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action="Create Operation Transaction",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=new_transaction.id,
        entity_label=get_transaction_ticket_number(new_transaction),
        ticket_number=get_transaction_ticket_number(new_transaction),
        operation_number=new_transaction.operation_number,
        new_status=new_transaction.status,
        remarks="Created via /operation-transactions",
        request_path="/operation-transactions",
        details={
            "operation_type_code": new_transaction.operation_type_code,
            "primary_asset_code": new_transaction.primary_asset_code,
            "origin_location_code": new_transaction.origin_location_code,
            "destination_location_code": new_transaction.destination_location_code,
            "sender_location_code": new_transaction.sender_location_code,
            "receiver_location_code": new_transaction.receiver_location_code,
            "operation_date": str(new_transaction.operation_date),
        },
    )

    db.commit()
    db.refresh(new_transaction)

    return build_operation_transaction_response(new_transaction, db)


@router.put("/{transaction_id}", response_model=OperationTransactionResponse)
def update_operation_transaction(
    transaction_id: int,
    transaction: OperationTransactionCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Create Operation Entry",
        db,
    )

    existing_transaction = db.query(OperationTransaction).filter(
        OperationTransaction.id == transaction_id
    ).first()

    if not existing_transaction:
        raise HTTPException(
            status_code=404,
            detail="Operation transaction not found",
        )

    if existing_transaction.status not in ["Draft", "Rejected"]:
        raise HTTPException(
            status_code=400,
            detail=(
                "Only Draft or Rejected operation transactions can be edited."
            ),
        )

    before_data = {
        "operation_type_code": existing_transaction.operation_type_code,
        "primary_asset_code": existing_transaction.primary_asset_code,
        "convoy_number": existing_transaction.convoy_number,
        "origin_location_code": existing_transaction.origin_location_code,
        "destination_location_code": existing_transaction.destination_location_code,
        "sender_location_code": existing_transaction.sender_location_code,
        "receiver_location_code": existing_transaction.receiver_location_code,
        "operation_date": str(existing_transaction.operation_date),
        "product_name": existing_transaction.product_name,
        "remarks": existing_transaction.remarks,
        "status": existing_transaction.status,
        "created_by": existing_transaction.created_by,
    }

    operation_type, asset = validate_operation_transaction(transaction, db)

    existing_transaction.operation_type_code = operation_type.operation_type_code
    existing_transaction.primary_asset_code = asset.asset_code
    existing_transaction.primary_asset_type_code = asset.asset_type_code
    existing_transaction.convoy_number = clean_optional_text(transaction.convoy_number)
    existing_transaction.origin_location_code = transaction.origin_location_code.strip()
    existing_transaction.destination_location_code = clean_optional_text(
        transaction.destination_location_code
    )
    existing_transaction.sender_location_code = clean_optional_text(
        transaction.sender_location_code
    )
    existing_transaction.receiver_location_code = clean_optional_text(
        transaction.receiver_location_code
    )
    existing_transaction.operation_date = transaction.operation_date
    existing_transaction.operation_start_datetime = transaction.operation_start_datetime
    existing_transaction.operation_end_datetime = transaction.operation_end_datetime
    existing_transaction.product_name = clean_optional_text(transaction.product_name)

    existing_transaction.remarks = clean_optional_text(transaction.remarks)
    existing_transaction.updated_at = datetime.now()

    after_data = {
        "operation_type_code": existing_transaction.operation_type_code,
        "primary_asset_code": existing_transaction.primary_asset_code,
        "convoy_number": existing_transaction.convoy_number,
        "origin_location_code": existing_transaction.origin_location_code,
        "destination_location_code": existing_transaction.destination_location_code,
        "sender_location_code": existing_transaction.sender_location_code,
        "receiver_location_code": existing_transaction.receiver_location_code,
        "operation_date": str(existing_transaction.operation_date),
        "product_name": existing_transaction.product_name,
        "remarks": existing_transaction.remarks,
        "status": existing_transaction.status,
        "created_by": existing_transaction.created_by,
    }

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action="Update Operation Transaction",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=existing_transaction.id,
        entity_label=get_transaction_ticket_number(existing_transaction),
        ticket_number=get_transaction_ticket_number(existing_transaction),
        operation_number=existing_transaction.operation_number,
        old_status=existing_transaction.status,
        new_status=existing_transaction.status,
        remarks="Updated via /operation-transactions",
        request_path=f"/operation-transactions/{transaction_id}",
        details={
            "before": before_data,
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(existing_transaction)

    return build_operation_transaction_response(existing_transaction, db)


@router.delete("/{transaction_id}")
def delete_operation_transaction(
    transaction_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Cancel Operation Transaction",
        db,
    )

    existing_transaction = db.query(OperationTransaction).filter(
        OperationTransaction.id == transaction_id
    ).first()

    if not existing_transaction:
        raise HTTPException(
            status_code=404,
            detail="Operation transaction not found",
        )

    if existing_transaction.status not in ["Draft", "Rejected"]:
        raise HTTPException(
            status_code=400,
            detail=(
                "Only Draft or Rejected operation transactions can be cancelled. "
                "Submitted tickets must be recalled to Draft before cancelling. "
                "Approved and Cancelled tickets are locked."
            ),
        )

    old_status = existing_transaction.status

    changed_by = (
        f"{current_user.full_name} ({current_user.username})"
        if current_user.full_name
        else current_user.username
    )

    existing_transaction.status = "Cancelled"
    existing_transaction.updated_at = datetime.now()

    existing_remarks = existing_transaction.remarks or ""

    existing_transaction.remarks = (
        f"{existing_remarks}\n"
        f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
        f"Cancelled by {changed_by}"
    ).strip()

    history = OperationTransactionStatusHistory(
        transaction_id=existing_transaction.id,
        old_status=old_status,
        new_status="Cancelled",
        changed_by=changed_by,
        remarks="Cancelled from Operation Transaction Register",
        changed_at=datetime.now(),
    )

    db.add(history)

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action="Cancel Operation Transaction",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=existing_transaction.id,
        entity_label=get_transaction_ticket_number(existing_transaction),
        ticket_number=get_transaction_ticket_number(existing_transaction),
        operation_number=existing_transaction.operation_number,
        old_status=old_status,
        new_status="Cancelled",
        remarks="Cancelled from Operation Transaction Register",
        request_path=f"/operation-transactions/{transaction_id}",
        details={
            "operation_type_code": existing_transaction.operation_type_code,
            "operation_template_id": existing_transaction.operation_template_id,
            "primary_asset_code": existing_transaction.primary_asset_code,
            "origin_location_code": existing_transaction.origin_location_code,
            "operation_date": str(existing_transaction.operation_date),
        },
    )

    db.commit()
    db.refresh(existing_transaction)

    return {
        "message": "Operation transaction cancelled successfully"
    }


@router.post("/backfill-ticket-numbers")
def backfill_operation_transaction_ticket_numbers(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Operation Template",
        db,
    )

    transactions = (
        db.query(OperationTransaction)
        .filter(
            (OperationTransaction.operation_ticket_number == None)
            | (OperationTransaction.operation_ticket_number == "")
        )
        .order_by(
            OperationTransaction.operation_date.asc(),
            OperationTransaction.origin_location_code.asc(),
            OperationTransaction.primary_asset_code.asc(),
            OperationTransaction.id.asc(),
        )
        .all()
    )

    total_candidates = len(transactions)
    updated_count = 0
    skipped_count = 0
    examples = []

    for transaction in transactions:
        if not transaction.origin_location_code or not transaction.primary_asset_code:
            skipped_count += 1
            continue

        old_ticket = transaction.operation_ticket_number

        ticket_number = generate_operation_ticket_number(
            db=db,
            location_code=transaction.origin_location_code,
            asset_code=transaction.primary_asset_code,
            operation_date=transaction.operation_date,
        )

        transaction.operation_ticket_number = ticket_number
        updated_count += 1

        if len(examples) < 10:
            examples.append(
                {
                    "transaction_id": transaction.id,
                    "operation_number": transaction.operation_number,
                    "old_ticket_number": old_ticket,
                    "new_ticket_number": ticket_number,
                    "origin_location_code": transaction.origin_location_code,
                    "primary_asset_code": transaction.primary_asset_code,
                    "operation_date": str(transaction.operation_date),
                }
            )

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action="Backfill Ticket Numbers",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=None,
        entity_label="Backfill Ticket Numbers",
        remarks="Backfilled missing operation ticket numbers",
        request_path="/operation-transactions/backfill-ticket-numbers",
        details={
            "total_candidates": total_candidates,
            "updated_count": updated_count,
            "skipped_count": skipped_count,
            "examples": examples,
        },
    )

    db.commit()

    return {
        "message": "Backfill completed",
        "total_candidates": total_candidates,
        "updated_count": updated_count,
        "skipped_count": skipped_count,
    }


@router.get("/{transaction_id}")
def get_operation_transaction_detail(
    transaction_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Operation Transaction",
        db,
    )

    transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == transaction_id)
        .first()
    )

    if transaction is None:
        raise HTTPException(status_code=404, detail="Operation transaction not found")

    operation_type = get_operation_type_by_code(transaction.operation_type_code, db)
    location = get_location_by_code(transaction.origin_location_code, db)
    primary_asset = get_asset_by_code(transaction.primary_asset_code, db)

    values = (
        db.query(OperationTransactionValue)
        .filter(OperationTransactionValue.transaction_id == transaction.id)
        .order_by(OperationTransactionValue.sort_order.asc(), OperationTransactionValue.id.asc())
        .all()
    )

    field_values = [
        {
            "id": value.id,
            "field_code": value.field_code,
            "field_name": value.field_name,
            "field_group": value.field_group,
            "data_type": value.data_type,
            "unit": value.unit,
            "input_mode": value.input_mode,
            "calculation_role": value.calculation_role,
            "field_value": value.field_value,
            "sort_order": value.sort_order,
        }
        for value in values
    ]

    return {
        "id": transaction.id,
        "operation_number": transaction.operation_number,
        "operation_ticket_number": get_transaction_ticket_number(transaction),
        "ticket_number": get_transaction_ticket_number(transaction),
        "operation_date": transaction.operation_date,
        "operation_type_code": transaction.operation_type_code,
        "operation_type_name": operation_type.operation_type_name if operation_type else "",
        "location_name": location.location_name if location else "",
        "location_code": transaction.origin_location_code,
        "primary_asset_name": primary_asset.asset_name if primary_asset else "",
        "primary_asset_code": transaction.primary_asset_code,
        "convoy_number": transaction.convoy_number,
        "status": transaction.status,
        "created_by": transaction.created_by,
        "created_at": transaction.created_at,
        "updated_at": transaction.updated_at,
        "field_values": field_values,
    }


@router.patch("/{transaction_id}/status")
def update_operation_transaction_status(
    transaction_id: int,
    status_update: OperationTransactionStatusUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == transaction_id)
        .first()
    )

    if transaction is None:
        raise HTTPException(
            status_code=404,
            detail="Operation transaction not found",
        )

    trip = None
    if str(transaction.primary_asset_type_code or "").strip().upper() == "BARGE":
        trip = get_trip_by_convoy_or_none(db, transaction.convoy_number)
        ensure_trip_not_closed(trip)

    next_status = clean_optional_text(status_update.status)

    if next_status is None:
        raise HTTPException(
            status_code=400,
            detail="Status is required",
        )

    allowed_statuses = ["Draft", "Submitted", "Approved", "Rejected", "Cancelled"]

    if next_status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Invalid transaction status",
        )

    required_permission = get_required_permission_for_status_change(next_status)

    if required_permission:
        require_user_permission(current_user, required_permission, db)

    action_code = get_action_code_for_status_change(next_status)
    if action_code:
        policy_allowed, policy_reason, matched_policy = evaluate_operation_workflow_policy(
            db=db,
            current_user=current_user,
            action_code=action_code,
            operation_type_code=clean_optional_text(transaction.operation_type_code),
            operation_template_id=transaction.operation_template_id,
            asset_type_code=clean_optional_text(transaction.primary_asset_type_code),
            location_code=clean_optional_text(transaction.origin_location_code),
        )
        if policy_allowed is False:
            raise HTTPException(
                status_code=403,
                detail=f"Workflow policy denied action: {policy_reason}",
            )

    validate_operation_status_transition(transaction.status, next_status)

    old_status = transaction.status
    changed_by = (
        f"{current_user.full_name} ({current_user.username})"
        if current_user.full_name
        else current_user.username
    )
    
    status_remarks = clean_optional_text(status_update.remarks)

    review_confirmed = bool(getattr(status_update, "review_confirmed", False))

    if next_status in ["Submitted", "Approved"] and not review_confirmed:
        raise HTTPException(
            status_code=400,
            detail="Review confirmation is required for Submit/Approve.",
        )
    if review_confirmed:
        require_user_permission(current_user, "Review Operation Transaction", db)
        review_allowed, review_reason, _ = evaluate_operation_workflow_policy(
            db=db,
            current_user=current_user,
            action_code="REVIEW",
            operation_type_code=clean_optional_text(transaction.operation_type_code),
            operation_template_id=transaction.operation_template_id,
            asset_type_code=clean_optional_text(transaction.primary_asset_type_code),
            location_code=clean_optional_text(transaction.origin_location_code),
        )
        if review_allowed is False:
            raise HTTPException(status_code=403, detail=f"Workflow policy denied action: {review_reason}")

    seal_validation_details = None
    if next_status == "Submitted":
        seal_validation_details = validate_multi_tank_seals_before_submit(
            db=db,
            transaction=transaction,
            submit_remarks=status_remarks,
        )

    if next_status in ["Submitted", "Approved"] and review_confirmed:
        status_remarks = (status_remarks or "").strip()
        status_remarks = (status_remarks + "\n[REVIEW CONFIRMED]").strip()

    transaction.status = next_status
    transaction.updated_at = datetime.now()

    if next_status == "Approved":
        template = None
        if transaction.operation_template_id:
            template = (
                db.query(OperationTemplate)
                .filter(OperationTemplate.id == transaction.operation_template_id)
                .first()
            )

        if template and str(template.entry_layout_type or "").strip() == "Shuttle Tracking":
            voyage = get_or_create_shuttle_voyage(
                db=db,
                location_code=transaction.origin_location_code,
                shuttle_number=transaction.convoy_number or "",
                shuttle_asset_code=transaction.primary_asset_code,
                current_user=current_user,
            )
            ensure_shuttle_voyage_not_closed(voyage)

        auto_create_barge_tracking_on_approval(
            db=db,
            transaction=transaction,
            current_user=current_user,
        )

        create_tank_stock_ledger_from_approved_transaction(
            db=db,
            transaction=transaction,
            current_user=current_user,
        )

        create_or_update_vessel_stock_ledger_from_approved_transaction(
            db=db,
            transaction=transaction,
            current_user=current_user,
        )

    if status_remarks:
        existing_remarks = transaction.remarks or ""
        transaction.remarks = (
            f"{existing_remarks}\n"
            f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
            f"{changed_by} changed status from {old_status} to {next_status}: "
            f"{status_remarks}"
        ).strip()

    history = OperationTransactionStatusHistory(
        transaction_id=transaction.id,
        old_status=old_status,
        new_status=next_status,
        changed_by=changed_by,
        remarks=status_remarks,
        changed_at=datetime.now(),
    )

    db.add(history)

    if next_status == "Submitted":
        task = create_operation_approval_task_for_transaction(
            db=db,
            transaction=transaction,
            current_user=current_user,
        )
        create_audit_log(
            db=db,
            module_name="Operation Task",
            action="Create Approval Task",
            current_user=current_user,
            entity_type="OperationTask",
            entity_id=task.id,
            entity_label=task.task_number,
            ticket_number=get_transaction_ticket_number(transaction),
            operation_number=transaction.operation_number,
            new_status=task.status,
            remarks="Approval task created on transaction submission",
            request_path=f"/operation-transactions/{transaction_id}/status",
            details={
                "transaction_id": transaction.id,
                "assigned_policy_id": task.assigned_policy_id,
                "assigned_role_ids": task.assigned_role_ids_json,
                "assigned_user_ids": task.assigned_user_ids_json,
            },
        )
    elif next_status == "Approved":
        close_operation_approval_tasks_for_transaction(
            db=db,
            transaction=transaction,
            current_user=current_user,
            task_status="Approved",
            action_taken="Approved",
            notes=status_remarks,
        )
    elif next_status == "Rejected":
        close_operation_approval_tasks_for_transaction(
            db=db,
            transaction=transaction,
            current_user=current_user,
            task_status="Rejected",
            action_taken="Rejected",
            notes=status_remarks,
        )
    elif next_status == "Draft":
        close_operation_approval_tasks_for_transaction(
            db=db,
            transaction=transaction,
            current_user=current_user,
            task_status="Cancelled",
            action_taken="Recalled",
            notes=status_remarks,
        )
    elif next_status == "Cancelled":
        close_operation_approval_tasks_for_transaction(
            db=db,
            transaction=transaction,
            current_user=current_user,
            task_status="Cancelled",
            action_taken="Cancelled",
            notes=status_remarks,
        )

    action_name = f"Change Status to {next_status}"

    if next_status == "Submitted":
        action_name = "Submit Operation Transaction"
    elif next_status == "Approved":
        action_name = "Approve Operation Transaction"
    elif next_status == "Rejected":
        action_name = "Reject Operation Transaction"
    elif next_status == "Draft":
        action_name = "Recall Operation Transaction"
    elif next_status == "Cancelled":
        action_name = "Cancel Operation Transaction"

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action=action_name,
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=transaction.id,
        entity_label=get_transaction_ticket_number(transaction),
        ticket_number=get_transaction_ticket_number(transaction),
        operation_number=transaction.operation_number,
        old_status=old_status,
        new_status=next_status,
        remarks=status_remarks or "",
        request_path=f"/operation-transactions/{transaction_id}/status",
        details={
            "operation_type_code": transaction.operation_type_code,
            "operation_template_id": transaction.operation_template_id,
            "primary_asset_code": transaction.primary_asset_code,
            "origin_location_code": transaction.origin_location_code,
            "operation_date": str(transaction.operation_date),
            "workflow_action_code": action_code,
            "workflow_policy_id": matched_policy.id if 'matched_policy' in locals() and matched_policy else None,
            "workflow_policy_name": matched_policy.policy_name if 'matched_policy' in locals() and matched_policy else None,
            "seal_validation": seal_validation_details,
            "review_confirmed": review_confirmed,
            "reviewed_by": changed_by if review_confirmed else None,
            "reviewed_at": datetime.now().isoformat() if review_confirmed else None,
        },
    )

    db.commit()
    db.refresh(transaction)

    return {
        "message": f"Transaction status changed to {next_status}",
        "transaction": build_operation_transaction_response(transaction, db),
    }


@router.get("/{transaction_id}/status-history")
def get_operation_transaction_status_history(
    transaction_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Operation Transaction",
        db,
    )

    transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == transaction_id)
        .first()
    )

    if transaction is None:
        raise HTTPException(
            status_code=404,
            detail="Operation transaction not found",
        )

    history = (
        db.query(OperationTransactionStatusHistory)
        .filter(OperationTransactionStatusHistory.transaction_id == transaction_id)
        .order_by(OperationTransactionStatusHistory.changed_at.asc())
        .all()
    )

    return [
        {
            "id": item.id,
            "transaction_id": item.transaction_id,
            "old_status": item.old_status,
            "new_status": item.new_status,
            "changed_by": item.changed_by,
            "remarks": item.remarks,
            "changed_at": item.changed_at,
        }
        for item in history
    ]
