"""
Shared helper module for trip/tracking operations.

Consolidates functions that were duplicated across:
  - barge_trip_tracking.py
  - operation_transactions.py
  - shuttle_fso_voyages.py
  - operation_entries.py

All functions preserve their original behavior. Where two different
implementations existed (e.g. build_multitank_comparison_json) the
canonical v2 implementation from barge_trip_tracking.py is used, and
the v1 implementation is kept under a versioned name.
"""

from datetime import datetime
from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models import (
    Trip,
    TripEvent,
    TripComparison,
    TripEventCreate,
    OperationTransaction,
    OperationTransactionValue,
    ShuttleVoyage,
    FSOVoyage,
    User,
)
from app.utils.helpers import (
    clean_optional_text,
    get_transaction_ticket_number,
    get_current_user_display_name,
    get_location_name_by_code,
    get_asset_by_code,
)
from app.services.audit_service import create_audit_log
from app.services.transaction_helpers import (
    require_approved_transaction_for_tracking,
    transaction_has_pending_correction_request,
)
from app.config import APPROVED_TRANSACTION_STATUS


# ---------------------------------------------------------------------------
# Shared shuttle/FSO helpers
# ---------------------------------------------------------------------------

def _sf(v):
    try:
        return float(v or 0.0)
    except Exception:
        return 0.0


def _abs_qty(net_stock, net_water):
    try:
        return abs(float(net_stock or 0.0)) + abs(float(net_water or 0.0))
    except Exception:
        return 0.0


def _norm(v):
    return str(v or "").strip().upper()


def _norm_op(v):
    return str(v or "").strip().lower()


def _op_code(meta):
    return _norm((meta or {}).get("vessel_operation_code"))


def _op_label(meta):
    return _norm((meta or {}).get("vessel_operation_label"))


def _is_loading(meta):
    code = _op_code(meta)
    if code == "LOADING":
        return True
    label = _op_label(meta)
    return ("LOADING" in label) and ("UNLOADING" not in label)


def _is_sts_in(meta):
    code = _op_code(meta)
    if code == "STS_IN":
        return True
    label = _op_label(meta)
    return "STS IN" in label or "STS_IN" in label


def _is_sts_out(meta):
    code = _op_code(meta)
    if code == "STS_OUT":
        return True
    label = _op_label(meta)
    return "STS OUT" in label or "STS_OUT" in label


def _is_unloading(meta):
    code = _op_code(meta)
    if code == "UNLOADING":
        return True
    label = _op_label(meta)
    return ("UNLOADING" in label) or ("UNLOAD" in label)


def _is_top_up(meta):
    code = _op_code(meta)
    if code == "TOP_UP":
        return True
    label = _op_label(meta)
    return ("TOP UP" in label) or ("TOP-UP" in label) or ("TOP_UP" in label)


# ---------------------------------------------------------------------------
# Trip helpers (barge)
# ---------------------------------------------------------------------------

def get_trip_by_convoy_or_none(db: Session, convoy_number: str | None):
    """Look up a Trip by convoy number. Returns None if not found."""
    if not convoy_number:
        return None
    return db.query(Trip).filter(Trip.convoy_number.ilike(clean_optional_text(convoy_number) or "")).first()


def ensure_trip_not_closed(trip: Trip | None):
    """Raise HTTPException if the trip is CLOSED."""
    if trip is None:
        return
    if str(trip.status or "").strip().upper() == "CLOSED":
        raise HTTPException(
            status_code=400,
            detail="Trip is CLOSED for this convoy. Reopen the trip to continue.",
        )


# ---------------------------------------------------------------------------
# Shuttle / FSO voyage helpers
# ---------------------------------------------------------------------------

def get_shuttle_voyage_by_key(db: Session, location_code: str, shuttle_number: str, shuttle_asset_code: str):
    """Look up a ShuttleVoyage by its composite key."""
    lc = clean_optional_text(location_code)
    sn = clean_optional_text(shuttle_number)
    ac = clean_optional_text(shuttle_asset_code)
    if not lc or not sn or not ac:
        return None
    return (
        db.query(ShuttleVoyage)
        .filter(
            ShuttleVoyage.location_code.ilike(lc),
            ShuttleVoyage.shuttle_number.ilike(sn),
            ShuttleVoyage.shuttle_asset_code.ilike(ac),
        )
        .first()
    )


def ensure_shuttle_voyage_not_closed(voyage: ShuttleVoyage | None):
    """Raise HTTPException if the shuttle voyage is CLOSED."""
    if not voyage:
        return
    if str(voyage.status or "").strip().upper() == "CLOSED":
        raise HTTPException(
            status_code=400,
            detail="Shuttle voyage is CLOSED for this key. Reopen the voyage to continue.",
        )


def get_or_create_shuttle_voyage_v1(
    db: Session,
    location_code: str,
    shuttle_number: str,
    shuttle_asset_code: str,
    current_user: User,
):
    """
    Version 1: Used by shuttle_fso_voyages.py.
    Creates ShuttleVoyage with location_code, shuttle_number, shuttle_asset_code as the key.
    """
    voyage = get_shuttle_voyage_by_key(db, location_code, shuttle_number, shuttle_asset_code)
    if voyage:
        return voyage

    created_by_display = get_current_user_display_name(current_user)
    voyage = ShuttleVoyage(
        location_code=str(location_code).strip(),
        shuttle_number=str(shuttle_number).strip(),
        shuttle_asset_code=str(shuttle_asset_code).strip(),
        status="OPEN",
        created_by=created_by_display,
        remarks=None,
    )
    db.add(voyage)
    db.flush()
    return voyage


def get_fso_voyage_by_key(db: Session, location_code: str, shuttle_number: str, fso_asset_code: str):
    """Look up an FSOVoyage by its composite key."""
    lc = clean_optional_text(location_code)
    sn = clean_optional_text(shuttle_number)
    ac = clean_optional_text(fso_asset_code)
    if not lc or not sn or not ac:
        return None
    return (
        db.query(FSOVoyage)
        .filter(
            FSOVoyage.location_code.ilike(lc),
            FSOVoyage.shuttle_number.ilike(sn),
            FSOVoyage.fso_asset_code.ilike(ac),
        )
        .first()
    )


def ensure_fso_voyage_not_closed(voyage: FSOVoyage | None):
    """Raise HTTPException if the FSO voyage is CLOSED."""
    if not voyage:
        return
    if str(voyage.status or "").strip().upper() == "CLOSED":
        raise HTTPException(
            status_code=400,
            detail="FSO voyage is CLOSED for this key. Reopen the voyage to continue.",
        )


def get_or_create_fso_voyage(
    db: Session,
    location_code: str,
    shuttle_number: str,
    fso_asset_code: str,
    current_user: User,
):
    """Look up or create an FSOVoyage."""
    voyage = get_fso_voyage_by_key(db, location_code, shuttle_number, fso_asset_code)
    if voyage:
        return voyage

    created_by_display = get_current_user_display_name(current_user)
    voyage = FSOVoyage(
        location_code=str(location_code).strip(),
        shuttle_number=str(shuttle_number).strip(),
        fso_asset_code=str(fso_asset_code).strip(),
        status="OPEN",
        created_by=created_by_display,
        remarks=None,
    )
    db.add(voyage)
    db.flush()
    return voyage


def get_or_create_shuttle_voyage_v2(
    db: Session,
    convoy_number: str,
    shuttle_asset_code: str,
    location_code: str,
    current_user: User,
):
    """
    Version 2: Used by operation_transactions.py.
    Creates ShuttleVoyage with voyage_number, convoy_number fields.
    This version is triggered on ticket approval for shuttle tracking.
    """
    if not convoy_number:
        raise HTTPException(
            status_code=400,
            detail="Shuttle number (convoy number) is required for Shuttle Tracking.",
        )

    created_by_display = get_current_user_display_name(current_user)

    existing = (
        db.query(ShuttleVoyage)
        .filter(ShuttleVoyage.convoy_number.ilike(convoy_number))
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
        convoy_number=convoy_number,
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
            "convoy_number": convoy_number,
            "shuttle_asset_code": shuttle_asset_code,
            "location_code": location_code,
        },
    )

    return voyage


# ---------------------------------------------------------------------------
# Multi-tank payload extraction (v2 — canonical version from barge_trip_tracking.py)
# ---------------------------------------------------------------------------

def load_multi_tank_payload(db: Session, transaction_id: int):
    """
    Load multi_tank_payload from operation_transaction_values.
    Handles both dict and JSON string stored values.
    """
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
        import json
        return json.loads(str(row.field_value))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Multi-tank comparison (v2 — canonical version from barge_trip_tracking.py)
# ---------------------------------------------------------------------------

def resolve_comparison_stages(comparison_type: str):
    """Determine which stage is 'left' and 'right' based on comparison type."""
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
    """Extract inputs, per_tank, and totals for a given stage from the payload."""
    inputs = (payload.get("inputs") or {}).get(stage_key) or {}
    per_tank = (payload.get("perTank") or {}).get(stage_key) or {}
    totals = (payload.get("calculated") or {}).get(stage_key) or {}
    return {
        "inputs": inputs,
        "per_tank": per_tank,
        "totals": totals,
    }


def build_multitank_seal_checks(left_payload: dict, right_payload: dict):
    """Compare temporary seals between left (after) and right (before) payloads."""
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


def build_multitank_comparison_json_v2(
    left_tx: OperationTransaction,
    right_tx: OperationTransaction,
    comparison_type: str,
    left_payload: dict,
    right_payload: dict,
):
    """
    Version 2: Full barge MTR comparison using perTank/calculated/inputs structure.
    Used by barge_trip_tracking.py.
    """
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


# ---------------------------------------------------------------------------
# Barge closure readiness check
# ---------------------------------------------------------------------------

def require_barge_tracking_ready_for_closure(trip: Trip, db: Session):
    """Validate that all barges in a convoy have comparisons before allowing closure."""
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
    """Auto-create a barge comparison when an UNLOAD event is tagged."""
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

    summary_json, per_tank_json = build_multitank_comparison_json_v2(
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
