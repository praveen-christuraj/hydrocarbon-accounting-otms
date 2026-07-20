from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel

from app.database import get_db
from app.models import (
    Trip,
    TripEvent,
    TripComparison,
    OperationTransaction,
    OperationTransactionValue,
    OperationType,
    User,
)
from app.schemas import (
    TripEventCreate,
    TripEventResponse,
    TripComparisonCreate,
    TripComparisonResponse,
    ConvoyTrackerResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import (
    clean_optional_text,
    get_transaction_ticket_number,
    get_current_user_display_name,
    get_location_name_by_code,
    get_location_by_code,
    get_asset_by_code,
)
from app.config import APPROVED_TRANSACTION_STATUS
from app.services.transaction_helpers import (
    get_operation_type_by_code,
    require_approved_transaction_for_tracking,
    transaction_has_pending_correction_request,
)

router = APIRouter(prefix="/barge-trip", tags=["Barge / Trip Tracking"])


class TripStatusUpdateRequest(BaseModel):
    remarks: str | None = None


def get_trip_by_convoy_or_none(db: Session, convoy_number: str | None):
    convoy = clean_optional_text(convoy_number)
    if convoy is None:
        return None
    return db.query(Trip).filter(Trip.convoy_number.ilike(convoy)).first()


def ensure_trip_not_closed(trip: Trip | None):
    if not trip:
        return
    if str(trip.status or "").strip().upper() == "CLOSED":
        raise HTTPException(
            status_code=400,
            detail="Trip is CLOSED for this convoy. Reopen the trip to continue.",
        )


def load_multi_tank_payload(db: Session, transaction_id: int):
    row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction_id,
            OperationTransactionValue.field_code == "multi_tank_payload",
        )
        .first()
    )
    if not row or row.field_value is None:
        return None
    if isinstance(row.field_value, dict):
        return row.field_value
    try:
        return __import__("json").loads(str(row.field_value))
    except Exception:
        return None


def resolve_comparison_stages(comparison_type: str):
    t = (comparison_type or "").upper()
    left_stage = "after"
    right_stage = "before"
    if "UNLOAD_BEFORE_VS_UNLOAD_AFTER" in t:
        left_stage = "before"
        right_stage = "after"
    if "LOAD_PREV_VS_LOAD_CURRENT" in t:
        left_stage = "after"
        right_stage = "before"
    if "LOAD_AFTER_VS_UNLOAD_BEFORE" in t:
        left_stage = "after"
        right_stage = "before"
    return left_stage, right_stage


def get_payload_stage(payload: dict, stage_key: str):
    inputs = (payload.get("inputs") or {}).get(stage_key) or {}
    per_tank = (payload.get("perTank") or {}).get(stage_key) or {}
    totals = (payload.get("calculated") or {}).get(stage_key) or {}
    return {
        "inputs": inputs,
        "per_tank": per_tank,
        "totals": totals,
    }


def build_multitank_seal_checks(left_payload: dict, right_payload: dict):
    def norm(v):
        return str(v or "").strip()

    left_temp = (((left_payload.get("seals") or {}).get("after") or {}).get("temporary") or {})
    right_temp = (((right_payload.get("seals") or {}).get("before") or {}).get("temporary") or {})

    seal_fields = [
        ("C1", "sealC1"),
        ("C2", "sealC2"),
        ("M1", "sealM1"),
        ("M2", "sealM2"),
    ]

    checks = []
    for seal_name, key in seal_fields:
        sender_val = norm(left_temp.get(key))
        receiver_val = norm(right_temp.get(key))
        status = "MATCH"
        if sender_val == "" and receiver_val == "":
            status = "MISSING_BOTH"
        elif sender_val == "":
            status = "MISSING_SENDER"
        elif receiver_val == "":
            status = "MISSING_RECEIVER"
        elif sender_val != receiver_val:
            status = "MISMATCH"
        checks.append({
            "seal_name": seal_name,
            "sender": sender_val,
            "receiver": receiver_val,
            "status": status,
        })

    seal_mismatch = any(
        c["status"] in ("MISMATCH", "MISSING_SENDER", "MISSING_RECEIVER")
        for c in checks
    )
    return checks, seal_mismatch


def build_multitank_comparison_json(
    left_tx: OperationTransaction,
    right_tx: OperationTransaction,
    comparison_type: str,
    left_payload: dict,
    right_payload: dict,
):
    left_stage, right_stage = resolve_comparison_stages(comparison_type)
    l = get_payload_stage(left_payload, left_stage)
    r = get_payload_stage(right_payload, right_stage)

    tank_ids = set()
    tank_ids.update((left_payload.get("meta") or {}).get("tankIds") or [])
    tank_ids.update((right_payload.get("meta") or {}).get("tankIds") or [])
    tank_ids.update(list((l["per_tank"] or {}).keys()))
    tank_ids.update(list((r["per_tank"] or {}).keys()))
    tank_ids = [str(x) for x in tank_ids if str(x).strip()]
    tank_ids.sort()

    per_tank_rows = []
    for tid in tank_ids:
        lp = (l["per_tank"] or {}).get(tid) or {}
        rp = (r["per_tank"] or {}).get(tid) or {}
        per_tank_rows.append({
            "tank_id": tid,
            "left": {
                "total_dip": lp.get("totalDip", 0),
                "water_dip": lp.get("waterDip", 0),
                "tov": lp.get("tovCorrected", 0),
                "fw": lp.get("fwCorrected", 0),
            },
            "right": {
                "total_dip": rp.get("totalDip", 0),
                "water_dip": rp.get("waterDip", 0),
                "tov": rp.get("tovCorrected", 0),
                "fw": rp.get("fwCorrected", 0),
            },
            "delta": {
                "tov": (lp.get("tovCorrected", 0) or 0) - (rp.get("tovCorrected", 0) or 0),
                "fw": (lp.get("fwCorrected", 0) or 0) - (rp.get("fwCorrected", 0) or 0),
            },
        })

    def pick_totals(obj: dict):
        keys = [
            "TOV", "FW", "GOV", "GSV", "BSW", "NSV", "LT", "MT",
            "API60", "VCF", "ltFactor", "table11Method",
        ]
        return {k: obj.get(k) for k in keys if k in obj}

    left_totals = pick_totals(l["totals"] or {})
    right_totals = pick_totals(r["totals"] or {})

    def n(v):
        try:
            return float(v)
        except Exception:
            return 0.0

    delta_totals = {}
    for k in ["TOV", "FW", "GOV", "GSV", "BSW", "NSV", "LT", "MT"]:
        delta_totals[k] = n(left_totals.get(k)) - n(right_totals.get(k))

    seal_checks, seal_mismatch = build_multitank_seal_checks(left_payload, right_payload)

    summary_json = {
        "comparison_type": comparison_type,
        "asset_code": left_tx.primary_asset_code,
        "seal_checks": seal_checks,
        "seal_mismatch": seal_mismatch,
        "left": {
            "transaction_id": left_tx.id,
            "ticket_number": get_transaction_ticket_number(left_tx),
            "stage": left_stage,
            "operation_date": str(left_tx.operation_date) if left_tx.operation_date else "",
            "location_code": left_tx.origin_location_code or "",
            "inputs": l["inputs"],
            "totals": left_totals,
        },
        "right": {
            "transaction_id": right_tx.id,
            "ticket_number": get_transaction_ticket_number(right_tx),
            "stage": right_stage,
            "operation_date": str(right_tx.operation_date) if right_tx.operation_date else "",
            "location_code": right_tx.origin_location_code or "",
            "inputs": r["inputs"],
            "totals": right_totals,
        },
        "delta": {"totals": delta_totals},
        "units": {
            "dip": ((left_payload.get("meta") or {}).get("inputXUnit") or "mm"),
            "volume": ((left_payload.get("meta") or {}).get("outputUnit") or ""),
        },
    }

    per_tank_json = {"tanks": per_tank_rows}
    return summary_json, per_tank_json


def require_barge_tracking_ready_for_closure(trip: Trip, db: Session):
    approved_transactions = (
        db.query(OperationTransaction)
        .filter(
            OperationTransaction.convoy_number.ilike(trip.convoy_number),
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            OperationTransaction.primary_asset_type_code.ilike("BARGE"),
        )
        .all()
    )

    approved_asset_codes = {
        str(tx.primary_asset_code or "").strip()
        for tx in approved_transactions
        if str(tx.primary_asset_code or "").strip()
    }

    if len(approved_asset_codes) == 0:
        raise HTTPException(
            status_code=400,
            detail="Cannot close barge movement because no Approved barge tickets were found.",
        )

    if len(approved_transactions) < 2:
        raise HTTPException(
            status_code=400,
            detail="Cannot close barge movement before both sender and receiver transactions are Approved.",
        )

    comparisons = (
        db.query(TripComparison)
        .filter(TripComparison.trip_id == trip.id)
        .all()
    )

    compared_asset_codes = set()
    for comparison in comparisons:
        if str(comparison.comparison_type or "").strip() != "LOAD_AFTER_vs_UNLOAD_BEFORE":
            continue

        left_tx = (
            db.query(OperationTransaction)
            .filter(OperationTransaction.id == comparison.left_transaction_id)
            .first()
        )
        right_tx = (
            db.query(OperationTransaction)
            .filter(OperationTransaction.id == comparison.right_transaction_id)
            .first()
        )

        if not left_tx or not right_tx:
            continue
        if left_tx.status != APPROVED_TRANSACTION_STATUS:
            continue
        if right_tx.status != APPROVED_TRANSACTION_STATUS:
            continue
        if transaction_has_pending_correction_request(db, left_tx.id):
            continue
        if transaction_has_pending_correction_request(db, right_tx.id):
            continue
        if str(left_tx.primary_asset_code or "").strip().lower() != str(
            right_tx.primary_asset_code or ""
        ).strip().lower():
            continue

        asset_code = str(left_tx.primary_asset_code or "").strip()
        if asset_code:
            compared_asset_codes.add(asset_code)

    pending_asset_codes = sorted(list(approved_asset_codes - compared_asset_codes))
    if pending_asset_codes:
        raise HTTPException(
            status_code=400,
            detail="Cannot close convoy because comparison is pending for barge(s): " + ", ".join(pending_asset_codes),
        )


def ensure_barge_unload_comparison(
    db: Session,
    trip: Trip,
    asset_code: str,
    unload_tx: OperationTransaction,
    current_user: User,
    remarks: str | None = None,
):
    if not trip or not unload_tx:
        return None

    require_approved_transaction_for_tracking(unload_tx, "barge comparison", db=db)

    asset = str(asset_code or "").strip()
    if not asset:
        return None

    comparison_type = "LOAD_AFTER_vs_UNLOAD_BEFORE"

    latest_load_event = (
        db.query(TripEvent)
        .filter(
            TripEvent.trip_id == trip.id,
            TripEvent.asset_code == asset,
            TripEvent.event_type.in_(["LOAD_1", "LOAD_2_TOPUP"]),
            TripEvent.operation_transaction_id.isnot(None),
        )
        .order_by(TripEvent.sequence_no.desc(), TripEvent.id.desc())
        .first()
    )

    if not latest_load_event or not latest_load_event.operation_transaction_id:
        return None

    left_tx = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == latest_load_event.operation_transaction_id)
        .first()
    )

    require_approved_transaction_for_tracking(left_tx, "barge comparison", db=db)

    existing = (
        db.query(TripComparison)
        .filter(
            TripComparison.trip_id == trip.id,
            TripComparison.comparison_type == comparison_type,
            TripComparison.left_transaction_id == left_tx.id,
            TripComparison.right_transaction_id == unload_tx.id,
        )
        .first()
    )
    if existing:
        return existing

    left_payload = load_multi_tank_payload(db, left_tx.id)
    right_payload = load_multi_tank_payload(db, unload_tx.id)

    if not left_payload or not right_payload:
        return None

    summary_json, per_tank_json = build_multitank_comparison_json(
        left_tx=left_tx,
        right_tx=unload_tx,
        comparison_type=comparison_type,
        left_payload=left_payload,
        right_payload=right_payload,
    )

    created_by_display = get_current_user_display_name(current_user)

    new_cmp = TripComparison(
        trip_id=trip.id,
        comparison_type=comparison_type,
        left_transaction_id=left_tx.id,
        right_transaction_id=unload_tx.id,
        summary_json=summary_json,
        per_tank_json=per_tank_json,
        created_by=created_by_display,
        remarks=clean_optional_text(remarks) or "Auto-created on UNLOAD event tagging",
    )

    db.add(new_cmp)
    db.flush()

    create_audit_log(
        db=db,
        module_name="Barge Tracking",
        action="Auto Create Barge Comparison",
        current_user=current_user,
        entity_type="TripComparison",
        entity_id=new_cmp.id,
        entity_label=f"{trip.convoy_number} | {asset} | {comparison_type}",
        ticket_number=get_transaction_ticket_number(left_tx),
        operation_number=left_tx.operation_number,
        remarks="Auto-created from trip event tagging",
        request_path="/barge-trip/trip-events",
        details={
            "convoy_number": trip.convoy_number,
            "trip_id": trip.id,
            "asset_code": asset,
            "comparison_type": comparison_type,
            "left_transaction_id": left_tx.id,
            "right_transaction_id": unload_tx.id,
        },
    )

    return new_cmp


@router.get("/convoy-tracker", response_model=ConvoyTrackerResponse)
def get_convoy_tracker(
    convoy_number: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Operation Transaction", db)

    convoy = clean_optional_text(convoy_number)
    if convoy is None:
        raise HTTPException(status_code=400, detail="convoy_number is required")

    transactions = (
        db.query(OperationTransaction)
        .filter(
            OperationTransaction.convoy_number.ilike(convoy),
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
        )
        .order_by(OperationTransaction.operation_date.asc(), OperationTransaction.id.asc())
        .all()
    )

    asset_map = {}
    for tx in transactions:
        asset_code = tx.primary_asset_code
        asset = get_asset_by_code(asset_code, db)
        if asset_code not in asset_map:
            asset_map[asset_code] = {
                "asset_code": asset_code,
                "asset_name": asset.asset_name if asset else "",
                "tickets": [],
            }
        op_type = get_operation_type_by_code(tx.operation_type_code, db)
        asset_map[asset_code]["tickets"].append({
            "transaction_id": tx.id,
            "ticket_number": get_transaction_ticket_number(tx),
            "operation_type_code": tx.operation_type_code,
            "operation_type_name": op_type.operation_type_name if op_type else "",
            "operation_date": tx.operation_date,
            "origin_location_code": tx.origin_location_code,
            "origin_location_name": get_location_name_by_code(tx.origin_location_code, db),
            "destination_location_code": tx.destination_location_code,
            "destination_location_name": get_location_name_by_code(tx.destination_location_code, db),
            "status": tx.status,
        })

    return {
        "convoy_number": convoy,
        "total_tickets": len(transactions),
        "assets": list(asset_map.values()),
    }


@router.get("/barge-tracking", response_model=ConvoyTrackerResponse)
def get_barge_tracking(
    convoy_number: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    return get_convoy_tracker(
        convoy_number=convoy_number,
        current_user=current_user,
        db=db,
    )


@router.post("/trip-events", response_model=TripEventResponse)
def create_trip_event(
    request: TripEventCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Operation Entry", db)

    convoy = clean_optional_text(request.convoy_number)
    if convoy is None:
        raise HTTPException(status_code=400, detail="convoy_number is required")

    asset_code = clean_optional_text(request.asset_code)
    if asset_code is None:
        raise HTTPException(status_code=400, detail="asset_code is required")

    tx = None
    if request.operation_transaction_id is not None:
        tx = (
            db.query(OperationTransaction)
            .filter(OperationTransaction.id == request.operation_transaction_id)
            .first()
        )
        if not tx:
            raise HTTPException(status_code=404, detail="Operation transaction not found")

        if str(tx.primary_asset_code or "").strip().lower() != asset_code.lower():
            raise HTTPException(
                status_code=400,
                detail="asset_code does not match the operation ticket primary_asset_code",
            )

        require_approved_transaction_for_tracking(tx, "barge timeline event", db=db)

        if clean_optional_text(tx.convoy_number) is None:
            tx.convoy_number = convoy
            db.flush()
        elif str(tx.convoy_number).strip().lower() != convoy.lower():
            raise HTTPException(
                status_code=400,
                detail="Ticket convoy_number does not match request convoy_number",
            )

        existing_event_for_ticket = (
            db.query(TripEvent)
            .filter(TripEvent.operation_transaction_id == tx.id)
            .first()
        )
        if existing_event_for_ticket:
            existing_event_for_ticket.event_type = (
                clean_optional_text(request.event_type)
                or existing_event_for_ticket.event_type
            )
            existing_event_for_ticket.location_code = (
                clean_optional_text(request.location_code)
                or existing_event_for_ticket.location_code
            )
            existing_event_for_ticket.asset_code = asset_code
            existing_event_for_ticket.event_datetime = (
                request.event_datetime
                or existing_event_for_ticket.event_datetime
            )
            cleaned_remarks = clean_optional_text(request.remarks)
            if cleaned_remarks:
                existing_event_for_ticket.remarks = cleaned_remarks
            existing_event_for_ticket.updated_at = datetime.now()
            db.commit()
            db.refresh(existing_event_for_ticket)

            if tx and str(existing_event_for_ticket.event_type or "").strip().upper() == "UNLOAD":
                trip_for_cmp = db.query(Trip).filter(Trip.convoy_number.ilike(convoy)).first()
                if trip_for_cmp:
                    ensure_trip_not_closed(trip_for_cmp)
                    ensure_barge_unload_comparison(
                        db=db,
                        trip=trip_for_cmp,
                        asset_code=asset_code,
                        unload_tx=tx,
                        current_user=current_user,
                        remarks="Backfilled from Fix Timeline",
                    )
                    db.commit()

            return {
                "id": existing_event_for_ticket.id,
                "trip_id": existing_event_for_ticket.trip_id,
                "convoy_number": convoy,
                "event_type": existing_event_for_ticket.event_type,
                "location_code": existing_event_for_ticket.location_code,
                "asset_code": existing_event_for_ticket.asset_code,
                "operation_transaction_id": existing_event_for_ticket.operation_transaction_id,
                "sequence_no": existing_event_for_ticket.sequence_no,
                "event_datetime": existing_event_for_ticket.event_datetime,
                "created_by": existing_event_for_ticket.created_by,
                "remarks": existing_event_for_ticket.remarks,
                "created_at": existing_event_for_ticket.created_at,
                "updated_at": existing_event_for_ticket.updated_at,
            }

    trip = db.query(Trip).filter(Trip.convoy_number.ilike(convoy)).first()
    created_by_display = get_current_user_display_name(current_user)

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

    if request.sequence_no is None:
        max_seq = (
            db.query(func.max(TripEvent.sequence_no))
            .filter(TripEvent.trip_id == trip.id)
            .scalar()
        )
        sequence_no = (max_seq or 0) + 1
    else:
        sequence_no = int(request.sequence_no)

    event_type = clean_optional_text(request.event_type)
    if event_type is None:
        raise HTTPException(status_code=400, detail="event_type is required")

    location_code = clean_optional_text(request.location_code)
    if location_code is None and tx is not None:
        location_code = clean_optional_text(tx.origin_location_code)
    if location_code is None:
        raise HTTPException(
            status_code=400,
            detail="location_code is required when operation_transaction_id is not provided",
        )

    event_datetime = (
        request.event_datetime
        or (tx.operation_start_datetime if tx else None)
        or datetime.now()
    )

    op_tx_id = tx.id if tx else None

    new_event = TripEvent(
        trip_id=trip.id,
        event_type=event_type.upper(),
        location_code=location_code,
        asset_code=asset_code,
        operation_transaction_id=op_tx_id,
        sequence_no=sequence_no,
        event_datetime=event_datetime,
        created_by=created_by_display,
        remarks=clean_optional_text(request.remarks),
    )

    try:
        db.add(new_event)
        db.flush()
    except IntegrityError:
        db.rollback()
        if op_tx_id is not None:
            existing = (
                db.query(TripEvent)
                .filter(TripEvent.operation_transaction_id == op_tx_id)
                .first()
            )
            if existing:
                existing.event_type = event_type.upper()
                existing.location_code = location_code
                existing.asset_code = asset_code
                existing.event_datetime = event_datetime
                cleaned_remarks = clean_optional_text(request.remarks)
                if cleaned_remarks:
                    existing.remarks = cleaned_remarks
                existing.updated_at = datetime.now()
                db.commit()
                db.refresh(existing)
                return {
                    "id": existing.id,
                    "trip_id": existing.trip_id,
                    "convoy_number": convoy,
                    "event_type": existing.event_type,
                    "location_code": existing.location_code,
                    "asset_code": existing.asset_code,
                    "operation_transaction_id": existing.operation_transaction_id,
                    "sequence_no": existing.sequence_no,
                    "event_datetime": existing.event_datetime,
                    "created_by": existing.created_by,
                    "remarks": existing.remarks,
                    "created_at": existing.created_at,
                    "updated_at": existing.updated_at,
                }
        raise HTTPException(
            status_code=500,
            detail="Failed to create/update trip event due to duplicate operation_transaction_id",
        )

    create_audit_log(
        db=db,
        module_name="Barge Tracking",
        action="Create Trip Event",
        current_user=current_user,
        entity_type="TripEvent",
        entity_id=new_event.id,
        entity_label=f"{convoy} | {new_event.event_type} | {asset_code}",
        ticket_number=(get_transaction_ticket_number(tx) if tx else None),
        operation_number=(tx.operation_number if tx else None),
        remarks="Trip event created",
        request_path="/barge-trip/trip-events",
        details={
            "convoy_number": convoy,
            "trip_id": trip.id,
            "event_type": new_event.event_type,
            "asset_code": asset_code,
            "location_code": location_code,
            "operation_transaction_id": op_tx_id,
            "sequence_no": sequence_no,
        },
    )

    if tx and str(new_event.event_type or "").strip().upper() == "UNLOAD":
        ensure_barge_unload_comparison(
            db=db,
            trip=trip,
            asset_code=asset_code,
            unload_tx=tx,
            current_user=current_user,
            remarks="Auto-created from trip event creation",
        )

    db.commit()
    db.refresh(new_event)

    return {
        "id": new_event.id,
        "trip_id": new_event.trip_id,
        "convoy_number": convoy,
        "event_type": new_event.event_type,
        "location_code": new_event.location_code,
        "asset_code": new_event.asset_code,
        "operation_transaction_id": new_event.operation_transaction_id,
        "sequence_no": new_event.sequence_no,
        "event_datetime": new_event.event_datetime,
        "created_by": new_event.created_by,
        "remarks": new_event.remarks,
        "created_at": new_event.created_at,
        "updated_at": new_event.updated_at,
    }


@router.get("/trips/by-convoy/{convoy_number}")
def get_trip_timeline_by_convoy(
    convoy_number: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Operation Transaction", db)

    convoy = clean_optional_text(convoy_number)
    if convoy is None:
        raise HTTPException(status_code=400, detail="convoy_number is required")

    trip = db.query(Trip).filter(Trip.convoy_number.ilike(convoy)).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found for this convoy number")

    events = (
        db.query(TripEvent)
        .filter(TripEvent.trip_id == trip.id)
        .order_by(TripEvent.sequence_no.asc(), TripEvent.id.asc())
        .all()
    )

    comparisons = (
        db.query(TripComparison)
        .filter(TripComparison.trip_id == trip.id)
        .order_by(TripComparison.id.asc())
        .all()
    )

    event_rows = []
    for ev in events:
        tx = db.query(OperationTransaction).filter(OperationTransaction.id == ev.operation_transaction_id).first()
        asset = get_asset_by_code(ev.asset_code, db)
        event_rows.append({
            "id": ev.id,
            "trip_id": ev.trip_id,
            "convoy_number": convoy,
            "event_type": ev.event_type,
            "sequence_no": ev.sequence_no,
            "event_datetime": ev.event_datetime,
            "location_code": ev.location_code,
            "location_name": get_location_name_by_code(ev.location_code, db),
            "asset_code": ev.asset_code,
            "asset_name": asset.asset_name if asset else "",
            "operation_transaction_id": ev.operation_transaction_id,
            "ticket_number": get_transaction_ticket_number(tx) if tx else "",
            "ticket_status": tx.status if tx else "",
        })

    comparison_rows = []
    did_backfill = False

    for cmp in comparisons:
        left_tx = (
            db.query(OperationTransaction)
            .filter(OperationTransaction.id == cmp.left_transaction_id)
            .first()
        )
        right_tx = (
            db.query(OperationTransaction)
            .filter(OperationTransaction.id == cmp.right_transaction_id)
            .first()
        )

        if (cmp.summary_json is None or cmp.per_tank_json is None) and left_tx and right_tx:
            left_payload = load_multi_tank_payload(db, left_tx.id)
            right_payload = load_multi_tank_payload(db, right_tx.id)
            if left_payload and right_payload:
                auto_summary, auto_per_tank = build_multitank_comparison_json(
                    left_tx=left_tx,
                    right_tx=right_tx,
                    comparison_type=cmp.comparison_type,
                    left_payload=left_payload,
                    right_payload=right_payload,
                )
                if cmp.summary_json is None:
                    cmp.summary_json = auto_summary
                if cmp.per_tank_json is None:
                    cmp.per_tank_json = auto_per_tank
                did_backfill = True

        asset_code = (left_tx.primary_asset_code if left_tx else "") or (
            right_tx.primary_asset_code if right_tx else ""
        )
        asset = get_asset_by_code(asset_code, db) if asset_code else None

        comparison_rows.append({
            "id": cmp.id,
            "trip_id": cmp.trip_id,
            "convoy_number": convoy,
            "comparison_type": cmp.comparison_type,
            "asset_code": asset_code,
            "asset_name": asset.asset_name if asset else "",
            "left_transaction_id": cmp.left_transaction_id,
            "left_ticket_number": get_transaction_ticket_number(left_tx) if left_tx else "",
            "right_transaction_id": cmp.right_transaction_id,
            "right_ticket_number": get_transaction_ticket_number(right_tx) if right_tx else "",
            "summary_json": cmp.summary_json,
            "per_tank_json": cmp.per_tank_json,
            "created_by": cmp.created_by,
            "remarks": cmp.remarks,
            "created_at": cmp.created_at,
            "updated_at": cmp.updated_at,
        })

    if did_backfill:
        db.commit()

    return {
        "trip": {
            "id": trip.id,
            "convoy_number": trip.convoy_number,
            "primary_barge_asset_code": trip.primary_barge_asset_code,
            "status": trip.status,
            "created_by": trip.created_by,
            "remarks": trip.remarks,
            "created_at": trip.created_at,
            "updated_at": trip.updated_at,
        },
        "events": event_rows,
        "comparisons": comparison_rows,
    }


@router.post("/trip-comparisons", response_model=TripComparisonResponse)
def create_trip_comparison(
    request: TripComparisonCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Operation Entry", db)

    convoy = clean_optional_text(request.convoy_number)
    if convoy is None:
        raise HTTPException(status_code=400, detail="convoy_number is required")

    trip = db.query(Trip).filter(Trip.convoy_number.ilike(convoy)).first()
    created_by_display = get_current_user_display_name(current_user)

    if not trip:
        trip = Trip(
            convoy_number=convoy,
            primary_barge_asset_code=None,
            status="OPEN",
            created_by=created_by_display,
            remarks=None,
        )
        db.add(trip)
        db.flush()

    ensure_trip_not_closed(trip)

    left_tx = db.query(OperationTransaction).filter(OperationTransaction.id == request.left_transaction_id).first()
    right_tx = db.query(OperationTransaction).filter(OperationTransaction.id == request.right_transaction_id).first()

    if not left_tx or not right_tx:
        raise HTTPException(status_code=404, detail="Left or Right transaction not found")

    require_approved_transaction_for_tracking(left_tx, "barge sender/receiver comparison", db=db)
    require_approved_transaction_for_tracking(right_tx, "barge sender/receiver comparison", db=db)

    if clean_optional_text(left_tx.convoy_number) is None:
        left_tx.convoy_number = convoy
    if clean_optional_text(right_tx.convoy_number) is None:
        right_tx.convoy_number = convoy

    if str(left_tx.convoy_number).strip().lower() != convoy.lower() or str(right_tx.convoy_number).strip().lower() != convoy.lower():
        raise HTTPException(status_code=400, detail="Both tickets must belong to the same convoy_number")

    comparison_type = clean_optional_text(request.comparison_type)
    if comparison_type is None:
        raise HTTPException(status_code=400, detail="comparison_type is required")

    summary_json = request.summary_json
    per_tank_json = request.per_tank_json
    left_payload = None
    right_payload = None

    if summary_json is None or per_tank_json is None:
        left_payload = load_multi_tank_payload(db, left_tx.id)
        right_payload = load_multi_tank_payload(db, right_tx.id)
        if left_payload and right_payload:
            auto_summary, auto_per_tank = build_multitank_comparison_json(
                left_tx=left_tx,
                right_tx=right_tx,
                comparison_type=comparison_type,
                left_payload=left_payload,
                right_payload=right_payload,
            )
            if summary_json is None:
                summary_json = auto_summary
            if per_tank_json is None:
                per_tank_json = auto_per_tank

    if summary_json is None or per_tank_json is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unable to auto-build comparison data. "
                "Ensure BOTH tickets are Multi-Tank tickets and contain field_code 'multi_tank_payload'. "
                f"left_ticket_id={left_tx.id} has_payload={bool(left_payload)} | "
                f"right_ticket_id={right_tx.id} has_payload={bool(right_payload)}"
            ),
        )

    new_cmp = TripComparison(
        trip_id=trip.id,
        comparison_type=comparison_type,
        left_transaction_id=left_tx.id,
        right_transaction_id=right_tx.id,
        summary_json=summary_json,
        per_tank_json=per_tank_json,
        created_by=created_by_display,
        remarks=clean_optional_text(request.remarks),
    )

    db.add(new_cmp)
    db.flush()

    create_audit_log(
        db=db,
        module_name="Barge Tracking",
        action="Create Barge Comparison",
        current_user=current_user,
        entity_type="TripComparison",
        entity_id=new_cmp.id,
        entity_label=f"{convoy} | {comparison_type}",
        ticket_number=get_transaction_ticket_number(left_tx),
        operation_number=left_tx.operation_number,
        remarks="Barge comparison created",
        request_path="/barge-trip/trip-comparisons",
        details={
            "convoy_number": convoy,
            "trip_id": trip.id,
            "comparison_type": comparison_type,
            "left_transaction_id": left_tx.id,
            "left_ticket_number": get_transaction_ticket_number(left_tx),
            "right_transaction_id": right_tx.id,
            "right_ticket_number": get_transaction_ticket_number(right_tx),
        },
    )

    db.commit()
    db.refresh(new_cmp)

    return {
        "id": new_cmp.id,
        "trip_id": new_cmp.trip_id,
        "convoy_number": convoy,
        "comparison_type": new_cmp.comparison_type,
        "left_transaction_id": new_cmp.left_transaction_id,
        "right_transaction_id": new_cmp.right_transaction_id,
        "summary_json": new_cmp.summary_json,
        "per_tank_json": new_cmp.per_tank_json,
        "created_by": new_cmp.created_by,
        "remarks": new_cmp.remarks,
        "created_at": new_cmp.created_at,
        "updated_at": new_cmp.updated_at,
    }


@router.post("/trips/{trip_id}/close")
def close_trip(
    trip_id: int,
    request: TripStatusUpdateRequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Operation Entry", db)

    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    if str(trip.status or "").upper() == "CLOSED":
        return {"message": "Barge movement already CLOSED", "trip_id": trip.id, "status": trip.status}

    require_barge_tracking_ready_for_closure(trip, db)

    before_status = trip.status
    trip.status = "CLOSED"
    trip.updated_at = datetime.now()

    closure_remarks = clean_optional_text(request.remarks) if request else None
    if closure_remarks:
        trip.remarks = f"{trip.remarks or ''}\n[Barge Movement Closed] {closure_remarks}".strip()

    create_audit_log(
        db=db,
        module_name="Barge Tracking",
        action="Close Barge Movement",
        current_user=current_user,
        entity_type="Trip",
        entity_id=trip.id,
        entity_label=trip.convoy_number,
        remarks="Barge movement closed after comparison review",
        request_path=f"/barge-trip/trips/{trip_id}/close",
        details={
            "convoy_number": trip.convoy_number,
            "before_status": before_status,
            "after_status": trip.status,
            "closure_remarks": closure_remarks,
        },
    )

    db.commit()
    db.refresh(trip)

    return {"message": "Barge movement CLOSED", "trip_id": trip.id, "status": trip.status}


@router.post("/trips/{trip_id}/reopen")
def reopen_trip(
    trip_id: int,
    request: TripStatusUpdateRequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Operation Entry", db)

    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    if str(trip.status or "").upper() == "OPEN":
        return {"message": "Barge movement already OPEN", "trip_id": trip.id, "status": trip.status}

    before_status = trip.status
    trip.status = "OPEN"
    trip.updated_at = datetime.now()

    reopen_remarks = clean_optional_text(request.remarks) if request else None
    if reopen_remarks:
        trip.remarks = f"{trip.remarks or ''}\n[Barge Movement Reopened] {reopen_remarks}".strip()

    create_audit_log(
        db=db,
        module_name="Barge Tracking",
        action="Reopen Barge Movement",
        current_user=current_user,
        entity_type="Trip",
        entity_id=trip.id,
        entity_label=trip.convoy_number,
        remarks="Barge movement reopened manually",
        request_path=f"/barge-trip/trips/{trip_id}/reopen",
        details={
            "convoy_number": trip.convoy_number,
            "before_status": before_status,
            "after_status": trip.status,
            "reopen_remarks": reopen_remarks,
        },
    )

    db.commit()
    db.refresh(trip)

    return {"message": "Barge movement OPEN", "trip_id": trip.id, "status": trip.status}
