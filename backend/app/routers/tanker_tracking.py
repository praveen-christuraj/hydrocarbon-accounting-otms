from datetime import datetime, date, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    Asset,
    OperationTransaction,
    OperationTransactionValue,
    OperationType,
    TankerReceiptAcknowledgement,
    User,
    ApprovedTransactionCorrectionRequest,
)
from app.schemas import (
    TankerTransactionReportResponse,
    TankerTrackingResponse,
    TankerTrackingTicketResponse,
    TankerReceiptAcknowledgementCreate,
    TankerReceiptAcknowledgementResponse,
    TankerTrackingClosureCreate,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import (
    safe_float,
    clean_optional_text,
    get_transaction_ticket_number,
    get_location_by_code,
    get_asset_by_code,
)
from app.config import APPROVED_TRANSACTION_STATUS
from app.services.transaction_helpers import (
    approved_transaction_not_on_correction_hold,
    transaction_has_pending_correction_request,
    require_approved_transaction_for_tracking,
    get_operation_type_by_code,
    parse_date_filter,
)

router = APIRouter(prefix="/tanker-tracking", tags=["Tanker Tracking"])


def parse_json_field_value(value):
    if value is None:
        return None

    if isinstance(value, dict):
        return value

    try:
        import json
        return json.loads(str(value))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Payload extraction helpers
# ---------------------------------------------------------------------------


def get_tanker_payload_for_transaction(
    db: Session,
    transaction_id: int,
):
    payload_row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction_id,
            OperationTransactionValue.field_code == "tanker_payload",
        )
        .first()
    )

    if not payload_row:
        return None

    return parse_json_field_value(payload_row.field_value)


# ---------------------------------------------------------------------------
# Tanker Transaction Report
# ---------------------------------------------------------------------------


def build_tanker_transaction_report_row(
    transaction: OperationTransaction,
    tanker_payload: dict,
    db: Session,
):
    operation_type = get_operation_type_by_code(
        transaction.operation_type_code,
        db,
    )

    location = get_location_by_code(
        transaction.origin_location_code,
        db,
    )

    asset = get_asset_by_code(
        transaction.primary_asset_code,
        db,
    )

    inputs = tanker_payload.get("inputs") or {}
    calculated = tanker_payload.get("calculated") or {}

    def number_from_input(key: str):
        return safe_float(inputs.get(key))

    def number_from_calculated(*keys: str):
        for key in keys:
            value = calculated.get(key)
            if value is not None:
                return safe_float(value)
        return 0

    return {
        "transaction_id": transaction.id,
        "operation_number": transaction.operation_number,
        "ticket_number": get_transaction_ticket_number(transaction),

        "operation_date": transaction.operation_date,
        "operation_start_datetime": transaction.operation_start_datetime,
        "operation_end_datetime": transaction.operation_end_datetime,

        "operation_type_code": transaction.operation_type_code,
        "operation_type_name": operation_type.operation_type_name if operation_type else "",

        "location_code": transaction.origin_location_code,
        "location_name": location.location_name if location else "",

        "asset_code": transaction.primary_asset_code,
        "asset_name": asset.asset_name if asset else "",
        "asset_type_code": transaction.primary_asset_type_code,

        "convoy_number": transaction.convoy_number,
        "tanker_name": inputs.get("tankerName") or (asset.asset_name if asset else ""),
        "prime_mover_number": inputs.get("primeMoverNumber"),
        "chassis_number": inputs.get("chassisNumber"),

        "cargo": inputs.get("cargo") or transaction.product_name,
        "tanker_operation": inputs.get("operation"),
        "destination": inputs.get("destination"),
        "loading_bay": inputs.get("loadingBay"),
        "compartment": inputs.get("compartment"),

        "total_dip_cm": number_from_input("totalDipCm"),
        "water_dip_cm": number_from_input("waterDipCm"),
        "bsw_percent": number_from_input("bswPercent"),

        "tank_temperature": (
            safe_float(inputs.get("tankTemperature"))
            if inputs.get("tankTemperature") is not None
            else None
        ),
        "tank_temperature_unit": inputs.get("tankTemperatureUnit"),
        "sample_temperature": (
            safe_float(inputs.get("sampleTemperature"))
            if inputs.get("sampleTemperature") is not None
            else None
        ),
        "sample_temperature_unit": inputs.get("sampleTemperatureUnit"),

        "observed_input_type": inputs.get("observedInputType"),
        "observed_api": (
            safe_float(inputs.get("observedApi"))
            if inputs.get("observedApi") is not None
            else calculated.get("observedApi")
        ),
        "observed_density": (
            safe_float(inputs.get("observedDensity"))
            if inputs.get("observedDensity") is not None
            else calculated.get("observedDensity")
        ),
        "api60": calculated.get("api60"),
        "vcf": calculated.get("vcf"),

        "tov_bbl": number_from_calculated("tovBbl", "totalVolumeBbl", "total_volume_bbl"),
        "free_water_bbl": number_from_calculated("freeWaterBbl", "waterVolumeBbl", "water_volume_bbl"),
        "gov_bbl": number_from_calculated("govBbl", "gov_bbl"),
        "gsv_bbl": number_from_calculated("gsvBbl", "gsv_bbl"),
        "bsw_bbl": number_from_calculated("bswBbl", "bsw_vol_bbl", "bswVolumeBbl"),
        "nsv_bbl": number_from_calculated("nsvBbl", "nsv_bbl"),

        "lt_factor": calculated.get("ltFactor"),
        "lt": number_from_calculated("lt"),
        "mt": number_from_calculated("mt"),

        "seal_c1": inputs.get("sealC1"),
        "seal_c2": inputs.get("sealC2"),
        "seal_m1": inputs.get("sealM1"),
        "seal_m2": inputs.get("sealM2"),

        "remarks": inputs.get("remarks") or transaction.remarks,
        "status": transaction.status,
        "created_by": transaction.created_by,
        "created_at": transaction.created_at,
        "updated_at": transaction.updated_at,
    }


def build_tanker_transaction_report_totals(rows: list[dict]):
    return {
        "rows_count": len(rows),
        "total_tov_bbl": round(sum(safe_float(row.get("tov_bbl")) for row in rows), 3),
        "total_free_water_bbl": round(sum(safe_float(row.get("free_water_bbl")) for row in rows), 3),
        "total_gov_bbl": round(sum(safe_float(row.get("gov_bbl")) for row in rows), 3),
        "total_gsv_bbl": round(sum(safe_float(row.get("gsv_bbl")) for row in rows), 3),
        "total_bsw_bbl": round(sum(safe_float(row.get("bsw_bbl")) for row in rows), 3),
        "total_nsv_bbl": round(sum(safe_float(row.get("nsv_bbl")) for row in rows), 3),
        "total_lt": round(sum(safe_float(row.get("lt")) for row in rows), 3),
        "total_mt": round(sum(safe_float(row.get("mt")) for row in rows), 3),
    }


def get_filtered_tanker_transaction_report_rows(
    db: Session,
    date_from: str | None = None,
    date_to: str | None = None,
    location_code: str | None = None,
    asset_code: str | None = None,
    convoy_number: str | None = None,
    status: str | None = None,
    search: str | None = None,
):
    query = db.query(OperationTransaction).join(
        OperationTransactionValue,
        OperationTransactionValue.transaction_id == OperationTransaction.id,
    ).filter(
        OperationTransactionValue.field_code == "tanker_payload",
        OperationTransactionValue.field_value != None,
    )

    date_from_value = parse_date_filter(date_from, "Date From")
    date_to_value = parse_date_filter(date_to, "Date To")

    if date_from_value:
        query = query.filter(OperationTransaction.operation_date >= date_from_value)

    if date_to_value:
        query = query.filter(OperationTransaction.operation_date <= date_to_value)

    cleaned_location_code = clean_optional_text(location_code)
    cleaned_asset_code = clean_optional_text(asset_code)
    cleaned_convoy_number = clean_optional_text(convoy_number)
    cleaned_status = clean_optional_text(status)

    if cleaned_location_code:
        query = query.filter(
            OperationTransaction.origin_location_code.ilike(cleaned_location_code)
        )

    if cleaned_asset_code:
        query = query.filter(
            OperationTransaction.primary_asset_code.ilike(cleaned_asset_code)
        )

    if cleaned_convoy_number:
        query = query.filter(
            OperationTransaction.convoy_number.ilike(cleaned_convoy_number)
        )

    if cleaned_status:
        query = query.filter(OperationTransaction.status == cleaned_status)

    transactions = (
        query.order_by(
            OperationTransaction.operation_date.desc(),
            OperationTransaction.id.desc(),
        )
        .all()
    )

    rows = []

    for transaction in transactions:
        tanker_payload = get_tanker_payload_for_transaction(db, transaction.id)

        if not tanker_payload:
            continue

        row = build_tanker_transaction_report_row(
            transaction=transaction,
            tanker_payload=tanker_payload,
            db=db,
        )

        cleaned_search = clean_optional_text(search)

        if cleaned_search:
            search_value = cleaned_search.lower()

            searchable_text = " ".join(
                [
                    str(row.get("ticket_number") or ""),
                    str(row.get("operation_number") or ""),
                    str(row.get("operation_type_code") or ""),
                    str(row.get("operation_type_name") or ""),
                    str(row.get("location_code") or ""),
                    str(row.get("location_name") or ""),
                    str(row.get("asset_code") or ""),
                    str(row.get("asset_name") or ""),
                    str(row.get("convoy_number") or ""),
                    str(row.get("tanker_name") or ""),
                    str(row.get("prime_mover_number") or ""),
                    str(row.get("chassis_number") or ""),
                    str(row.get("destination") or ""),
                    str(row.get("cargo") or ""),
                    str(row.get("status") or ""),
                ]
            ).lower()

            if search_value not in searchable_text:
                continue

        rows.append(row)

    return rows


@router.get(
    "/tanker-transaction-report",
    response_model=TankerTransactionReportResponse,
)
def get_tanker_transaction_report(
    date_from: str | None = None,
    date_to: str | None = None,
    location_code: str | None = None,
    asset_code: str | None = None,
    convoy_number: str | None = None,
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

    rows = get_filtered_tanker_transaction_report_rows(
        db=db,
        date_from=date_from,
        date_to=date_to,
        location_code=location_code,
        asset_code=asset_code,
        convoy_number=convoy_number,
        status=status,
        search=search,
    )

    return {
        "rows": rows,
        "totals": build_tanker_transaction_report_totals(rows),
    }


# ---------------------------------------------------------------------------
# Tanker Tracking
# ---------------------------------------------------------------------------


def get_payload_asset_value(payload: dict, section_names: list[str], keys: list[str]):
    for section_name in section_names:
        section = payload.get(section_name)

        if not isinstance(section, dict):
            continue

        for key in keys:
            value = section.get(key)
            if value is not None and str(value).strip() != "":
                return value

    return None


def detect_tanker_movement_role(transaction: OperationTransaction, operation_type: OperationType | None):
    text = " ".join(
        [
            str(transaction.operation_type_code or ""),
            str(operation_type.operation_type_name if operation_type else ""),
        ]
    ).upper()

    receiver_keywords = [
        "RECEIPT",
        "RECEIVE",
        "RECEIVED",
        "UNLOAD",
        "UNLOADING",
        "DISCHARGE",
        "DESTINATION",
    ]

    sender_keywords = [
        "LOAD",
        "LOADING",
        "DISPATCH",
        "SEND",
        "SENDER",
        "SOURCE",
    ]

    if any(keyword in text for keyword in receiver_keywords):
        return "RECEIVER"

    if any(keyword in text for keyword in sender_keywords):
        return "SENDER"

    return "UNKNOWN"


def build_tanker_tracking_ticket(
    transaction: OperationTransaction,
    tanker_payload: dict,
    db: Session,
):
    operation_type = get_operation_type_by_code(
        transaction.operation_type_code,
        db,
    )

    primary_asset = get_asset_by_code(
        transaction.primary_asset_code,
        db,
    )

    origin_location = get_location_by_code(
        transaction.origin_location_code,
        db,
    )

    destination_location = (
        get_location_by_code(transaction.destination_location_code, db)
        if transaction.destination_location_code
        else None
    )

    sender_location = (
        get_location_by_code(transaction.sender_location_code, db)
        if transaction.sender_location_code
        else None
    )

    receiver_location = (
        get_location_by_code(transaction.receiver_location_code, db)
        if transaction.receiver_location_code
        else None
    )

    inputs = tanker_payload.get("inputs") or {}
    calculated = tanker_payload.get("calculated") or {}

    prime_mover_asset_code = get_payload_asset_value(
        tanker_payload,
        ["prime_mover_asset"],
        ["asset_code", "assetCode", "prime_mover_asset_code"],
    )

    prime_mover_asset_name = get_payload_asset_value(
        tanker_payload,
        ["prime_mover_asset"],
        ["asset_name", "assetName", "prime_mover_asset_name"],
    )

    tanker_asset_code = get_payload_asset_value(
        tanker_payload,
        ["tanker_trailer_asset", "linked_tanker_asset", "tanker_asset", "asset"],
        ["asset_code", "assetCode", "tanker_asset_code"],
    )

    tanker_asset_name = get_payload_asset_value(
        tanker_payload,
        ["tanker_trailer_asset", "linked_tanker_asset", "tanker_asset", "asset"],
        ["asset_name", "assetName", "tanker_asset_name"],
    )

    tanker_chassis_number = get_payload_asset_value(
        tanker_payload,
        ["tanker_trailer_asset", "linked_tanker_asset", "tanker_asset", "asset"],
        ["serial_number", "serialNumber", "tanker_chassis_number"],
    )

    if tanker_asset_code is None:
        tanker_asset_code = transaction.primary_asset_code

    if tanker_asset_name is None:
        tanker_asset_name = primary_asset.asset_name if primary_asset else ""

    if tanker_chassis_number is None:
        tanker_chassis_number = primary_asset.serial_number if primary_asset else ""

    if prime_mover_asset_code is None:
        prime_mover_asset_code = inputs.get("primeMoverNumber")

    movement_role = detect_tanker_movement_role(transaction, operation_type)

    def number_from_input(key: str):
        return safe_float(inputs.get(key))

    def number_from_calculated(*keys: str):
        for key in keys:
            value = calculated.get(key)
            if value is not None:
                return safe_float(value)
        return 0

    return {
        "transaction_id": transaction.id,
        "ticket_number": get_transaction_ticket_number(transaction),
        "operation_number": transaction.operation_number,

        "movement_role": movement_role,

        "operation_date": transaction.operation_date,
        "operation_type_code": transaction.operation_type_code,
        "operation_type_name": operation_type.operation_type_name if operation_type else "",

        "origin_location_code": transaction.origin_location_code,
        "origin_location_name": origin_location.location_name if origin_location else "",
        "destination_location_code": transaction.destination_location_code,
        "destination_location_name": destination_location.location_name if destination_location else "",
        "sender_location_code": transaction.sender_location_code,
        "sender_location_name": sender_location.location_name if sender_location else "",
        "receiver_location_code": transaction.receiver_location_code,
        "receiver_location_name": receiver_location.location_name if receiver_location else "",

        "primary_asset_code": transaction.primary_asset_code,
        "primary_asset_name": primary_asset.asset_name if primary_asset else "",
        "primary_asset_type_code": transaction.primary_asset_type_code,

        "prime_mover_asset_code": prime_mover_asset_code,
        "prime_mover_asset_name": prime_mover_asset_name,

        "tanker_asset_code": tanker_asset_code,
        "tanker_asset_name": tanker_asset_name,
        "tanker_chassis_number": tanker_chassis_number,

        "convoy_number": transaction.convoy_number,
        "product_name": transaction.product_name,

        "compartment": inputs.get("compartment"),
        "total_dip_cm": number_from_input("totalDipCm"),
        "water_dip_cm": number_from_input("waterDipCm"),
        "bsw_percent": number_from_input("bswPercent"),

        "tank_temperature": (
            safe_float(inputs.get("tankTemperature"))
            if inputs.get("tankTemperature") is not None
            else None
        ),
        "tank_temperature_unit": inputs.get("tankTemperatureUnit"),
        "sample_temperature": (
            safe_float(inputs.get("sampleTemperature"))
            if inputs.get("sampleTemperature") is not None
            else None
        ),
        "sample_temperature_unit": inputs.get("sampleTemperatureUnit"),

        "observed_input_type": inputs.get("observedInputType"),
        "observed_api": (
            safe_float(inputs.get("observedApi"))
            if inputs.get("observedApi") is not None
            else calculated.get("observedApi")
        ),
        "observed_density": (
            safe_float(inputs.get("observedDensity"))
            if inputs.get("observedDensity") is not None
            else calculated.get("observedDensity")
        ),
        "api60": calculated.get("api60"),
        "vcf": calculated.get("vcf"),

        "tov_bbl": number_from_calculated("tovBbl", "totalVolumeBbl", "total_volume_bbl"),
        "free_water_bbl": number_from_calculated("freeWaterBbl", "waterVolumeBbl", "water_volume_bbl"),
        "gov_bbl": number_from_calculated("govBbl", "gov_bbl"),
        "gsv_bbl": number_from_calculated("gsvBbl", "gsv_bbl"),
        "bsw_bbl": number_from_calculated("bswBbl", "bsw_vol_bbl", "bswVolumeBbl"),
        "nsv_bbl": number_from_calculated("nsvBbl", "nsv_bbl"),
        "lt": number_from_calculated("lt"),
        "mt": number_from_calculated("mt"),

        "seal_c1": inputs.get("sealC1"),
        "seal_c2": inputs.get("sealC2"),
        "seal_m1": inputs.get("sealM1"),
        "seal_m2": inputs.get("sealM2"),

        "remarks": inputs.get("remarks") or transaction.remarks,
        "status": transaction.status,
        "created_by": transaction.created_by,
        "created_at": transaction.created_at,
        "updated_at": transaction.updated_at,
    }


def build_tanker_seal_checks(sender_ticket: dict | None, receiver_ticket: dict | None):
    seal_fields = [
        ("C1", "seal_c1"),
        ("C2", "seal_c2"),
        ("M1", "seal_m1"),
        ("M2", "seal_m2"),
    ]

    checks = []

    for seal_name, field_name in seal_fields:
        sender_value = None
        receiver_value = None

        if sender_ticket:
            sender_value = clean_optional_text(sender_ticket.get(field_name))

        if receiver_ticket:
            receiver_value = clean_optional_text(receiver_ticket.get(field_name))

        if not sender_value and not receiver_value:
            status = "NOT_ENTERED"
        elif sender_value and not receiver_value:
            status = "RECEIVER_MISSING"
        elif not sender_value and receiver_value:
            status = "SENDER_MISSING"
        elif str(sender_value).strip().upper() == str(receiver_value).strip().upper():
            status = "MATCHED"
        else:
            status = "MISMATCH"

        checks.append(
            {
                "seal_name": seal_name,
                "sender_value": sender_value,
                "receiver_value": receiver_value,
                "status": status,
            }
        )

    return checks


def build_tanker_quantity_comparison(sender_ticket: dict | None, receiver_ticket: dict | None):
    if not sender_ticket or not receiver_ticket:
        return None

    sender_gov = safe_float(sender_ticket.get("gov_bbl"))
    receiver_gov = safe_float(receiver_ticket.get("gov_bbl"))

    sender_gsv = safe_float(sender_ticket.get("gsv_bbl"))
    receiver_gsv = safe_float(receiver_ticket.get("gsv_bbl"))

    sender_nsv = safe_float(sender_ticket.get("nsv_bbl"))
    receiver_nsv = safe_float(receiver_ticket.get("nsv_bbl"))

    sender_lt = safe_float(sender_ticket.get("lt"))
    receiver_lt = safe_float(receiver_ticket.get("lt"))

    sender_mt = safe_float(sender_ticket.get("mt"))
    receiver_mt = safe_float(receiver_ticket.get("mt"))

    nsv_variance = receiver_nsv - sender_nsv

    if sender_nsv != 0:
        nsv_variance_percent = (nsv_variance / sender_nsv) * 100
    else:
        nsv_variance_percent = 0

    return {
        "sender_transaction_id": sender_ticket.get("transaction_id"),
        "receiver_transaction_id": receiver_ticket.get("transaction_id"),

        "sender_gov_bbl": round(sender_gov, 3),
        "receiver_gov_bbl": round(receiver_gov, 3),
        "gov_variance_bbl": round(receiver_gov - sender_gov, 3),

        "sender_gsv_bbl": round(sender_gsv, 3),
        "receiver_gsv_bbl": round(receiver_gsv, 3),
        "gsv_variance_bbl": round(receiver_gsv - sender_gsv, 3),

        "sender_nsv_bbl": round(sender_nsv, 3),
        "receiver_nsv_bbl": round(receiver_nsv, 3),
        "nsv_variance_bbl": round(nsv_variance, 3),
        "nsv_variance_percent": round(nsv_variance_percent, 4),

        "sender_lt": round(sender_lt, 3),
        "receiver_lt": round(receiver_lt, 3),
        "lt_variance": round(receiver_lt - sender_lt, 3),

        "sender_mt": round(sender_mt, 3),
        "receiver_mt": round(receiver_mt, 3),
        "mt_variance": round(receiver_mt - sender_mt, 3),
    }


def get_current_user_label(current_user: User):
    full_name = str(current_user.full_name or "").strip()
    username = str(current_user.username or "").strip()

    if full_name and username:
        return f"{full_name} ({username})"

    if full_name:
        return full_name

    return username or None


def get_tanker_acknowledgement_by_sender(
    db: Session,
    sender_transaction_id: int | None,
):
    if sender_transaction_id is None:
        return None

    return (
        db.query(TankerReceiptAcknowledgement)
        .filter(
            TankerReceiptAcknowledgement.sender_transaction_id
            == sender_transaction_id,
            TankerReceiptAcknowledgement.status.in_(["Acknowledged", "Closed"]),
        )
        .first()
    )


def build_tanker_acknowledgement_response(
    acknowledgement: TankerReceiptAcknowledgement,
    db: Session,
):
    tanker_asset = None

    if acknowledgement.tanker_asset_code:
        tanker_asset = get_asset_by_code(
            acknowledgement.tanker_asset_code,
            db,
        )

    prime_mover_asset = None

    if acknowledgement.prime_mover_asset_code:
        prime_mover_asset = get_asset_by_code(
            acknowledgement.prime_mover_asset_code,
            db,
        )

    receiver_location = None

    if acknowledgement.receiver_location_code:
        receiver_location = get_location_by_code(
            acknowledgement.receiver_location_code,
            db,
        )

    return {
        "id": acknowledgement.id,
        "sender_transaction_id": acknowledgement.sender_transaction_id,
        "convoy_number": acknowledgement.convoy_number,
        "tanker_asset_code": acknowledgement.tanker_asset_code,
        "tanker_asset_name": tanker_asset.asset_name if tanker_asset else "",
        "tanker_chassis_number": tanker_asset.serial_number
        if tanker_asset
        else "",
        "prime_mover_asset_code": acknowledgement.prime_mover_asset_code,
        "prime_mover_asset_name": prime_mover_asset.asset_name
        if prime_mover_asset
        else "",
        "receiver_location_code": acknowledgement.receiver_location_code,
        "receiver_location_name": receiver_location.location_name
        if receiver_location
        else "",
        "acknowledged_by": acknowledgement.acknowledged_by,
        "acknowledged_at": acknowledgement.acknowledged_at,
        "remarks": acknowledgement.remarks,
        "status": acknowledgement.status,
        "closed_by": acknowledgement.closed_by,
        "closed_at": acknowledgement.closed_at,
        "closure_remarks": acknowledgement.closure_remarks,
        "created_at": acknowledgement.created_at,
        "updated_at": acknowledgement.updated_at,
    }


def build_tanker_acknowledgement_audit_snapshot(
    acknowledgement: TankerReceiptAcknowledgement,
    db: Session,
):
    return build_tanker_acknowledgement_response(acknowledgement, db)


def get_tanker_tracking_group_status(
    sender_ticket: dict | None,
    receiver_tickets: list[dict],
    seal_checks: list[dict],
    quantity_comparison: dict | None,
    acknowledgement: TankerReceiptAcknowledgement | None = None,
):
    if acknowledgement and acknowledgement.status == "Closed":
        return "CLOSED"

    if not sender_ticket:
        return "NO_SENDER"

    if len(receiver_tickets) == 0:
        if acknowledgement and acknowledgement.status == "Acknowledged":
            return "ACKNOWLEDGED"

        return "PENDING_RECEIPT"

    seal_mismatch = any(
        check.get("status") in ["MISMATCH", "RECEIVER_MISSING", "SENDER_MISSING"]
        for check in seal_checks
    )

    if seal_mismatch:
        return "SEAL_MISMATCH"

    if quantity_comparison:
        nsv_variance = abs(safe_float(quantity_comparison.get("nsv_variance_bbl")))

        if nsv_variance > 0:
            return "QUANTITY_VARIANCE"

        return "MATCHED"

    return "RECEIVED"


def build_tanker_tracking_groups(tickets: list[dict], db: Session):
    grouped = {}

    for ticket in tickets:
        convoy = clean_optional_text(ticket.get("convoy_number"))

        if convoy is None:
            continue

        tanker_asset_code = clean_optional_text(ticket.get("tanker_asset_code")) or "UNKNOWN_TANKER"

        group_key = f"{convoy}::{tanker_asset_code}"

        if group_key not in grouped:
            grouped[group_key] = {
                "group_key": group_key,
                "convoy_number": convoy,
                "tanker_asset_code": ticket.get("tanker_asset_code"),
                "tanker_asset_name": ticket.get("tanker_asset_name"),
                "tanker_chassis_number": ticket.get("tanker_chassis_number"),
                "prime_mover_asset_code": ticket.get("prime_mover_asset_code"),
                "prime_mover_asset_name": ticket.get("prime_mover_asset_name"),
                "product_name": ticket.get("product_name"),
                "tickets": [],
            }

        grouped[group_key]["tickets"].append(ticket)

    current_tracking_db = db

    tracking_rows = []

    for group in grouped.values():
        sorted_tickets = sorted(
            group["tickets"],
            key=lambda item: (
                item.get("operation_date") or date.min,
                item.get("transaction_id") or 0,
            ),
        )

        sender_tickets = [
            ticket
            for ticket in sorted_tickets
            if ticket.get("movement_role") == "SENDER"
        ]

        receiver_tickets = [
            ticket
            for ticket in sorted_tickets
            if ticket.get("movement_role") == "RECEIVER"
        ]

        unknown_tickets = [
            ticket
            for ticket in sorted_tickets
            if ticket.get("movement_role") == "UNKNOWN"
        ]

        warning_messages = []

        if len(sender_tickets) == 0 and len(unknown_tickets) > 0:
            sender_ticket = unknown_tickets[0]
            warning_messages.append(
                "Sender/receiver role could not be detected from operation type. First unknown ticket is treated as sender."
            )
        elif len(sender_tickets) > 0:
            sender_ticket = sender_tickets[0]
        else:
            sender_ticket = None

        if len(sender_tickets) > 1:
            warning_messages.append(
                "Multiple sender tickets found for this convoy/tanker. First sender ticket is used for comparison."
            )

        latest_receiver_ticket = receiver_tickets[-1] if receiver_tickets else None

        seal_checks = build_tanker_seal_checks(
            sender_ticket,
            latest_receiver_ticket,
        )

        quantity_comparison = build_tanker_quantity_comparison(
            sender_ticket,
            latest_receiver_ticket,
        )

        acknowledgement = None

        if sender_ticket:
            acknowledgement = get_tanker_acknowledgement_by_sender(
                db=current_tracking_db,
                sender_transaction_id=sender_ticket.get("transaction_id"),
            )

        tracking_status = get_tanker_tracking_group_status(
            sender_ticket,
            receiver_tickets,
            seal_checks,
            quantity_comparison,
            acknowledgement,
        )

        tracking_rows.append(
            {
                "group_key": group["group_key"],
                "convoy_number": group["convoy_number"],

                "tanker_asset_code": group["tanker_asset_code"],
                "tanker_asset_name": group["tanker_asset_name"],
                "tanker_chassis_number": group["tanker_chassis_number"],

                "prime_mover_asset_code": group["prime_mover_asset_code"],
                "prime_mover_asset_name": group["prime_mover_asset_name"],

                "product_name": group["product_name"],

                "sender_ticket": sender_ticket,
                "receiver_tickets": receiver_tickets,
                "latest_receiver_ticket": latest_receiver_ticket,

                "seal_checks": seal_checks,
                "quantity_comparison": quantity_comparison,

                "acknowledgement_id": acknowledgement.id
                if acknowledgement
                else None,
                "acknowledged_by": acknowledgement.acknowledged_by
                if acknowledgement
                else None,
                "acknowledged_at": acknowledgement.acknowledged_at
                if acknowledgement
                else None,
                "acknowledgement_remarks": acknowledgement.remarks
                if acknowledgement
                else None,
                "closed_by": acknowledgement.closed_by if acknowledgement else None,
                "closed_at": acknowledgement.closed_at if acknowledgement else None,
                "closure_remarks": acknowledgement.closure_remarks if acknowledgement else None,

                "tracking_status": tracking_status,
                "warning_messages": warning_messages,
            }
        )

    return sorted(
        tracking_rows,
        key=lambda item: (
            item.get("convoy_number") or "",
            item.get("tanker_asset_code") or "",
        ),
    )


def get_tanker_tracking_rows(
    db: Session,
    date_from: str | None = None,
    date_to: str | None = None,
    convoy_number: str | None = None,
    location_code: str | None = None,
    tanker_asset_code: str | None = None,
    status: str | None = None,
    search: str | None = None,
):
    query = (
        db.query(OperationTransaction)
        .join(
            OperationTransactionValue,
            OperationTransactionValue.transaction_id == OperationTransaction.id,
        )
        .filter(
            OperationTransactionValue.field_code == "tanker_payload",
            OperationTransactionValue.field_value != None,
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
        )
    )

    date_from_value = parse_date_filter(date_from, "Date From")
    date_to_value = parse_date_filter(date_to, "Date To")

    if date_from_value:
        query = query.filter(OperationTransaction.operation_date >= date_from_value)

    if date_to_value:
        query = query.filter(OperationTransaction.operation_date <= date_to_value)

    cleaned_convoy_number = clean_optional_text(convoy_number)
    cleaned_location_code = clean_optional_text(location_code)

    if cleaned_convoy_number:
        query = query.filter(OperationTransaction.convoy_number.ilike(cleaned_convoy_number))

    if cleaned_location_code:
        query = query.filter(
            (
                OperationTransaction.origin_location_code.ilike(cleaned_location_code)
            )
            | (
                OperationTransaction.destination_location_code.ilike(cleaned_location_code)
            )
            | (
                OperationTransaction.sender_location_code.ilike(cleaned_location_code)
            )
            | (
                OperationTransaction.receiver_location_code.ilike(cleaned_location_code)
            )
        )

    transactions = (
        query.order_by(
            OperationTransaction.convoy_number.asc(),
            OperationTransaction.operation_date.asc(),
            OperationTransaction.id.asc(),
        )
        .all()
    )

    tickets = []

    cleaned_tanker_asset_code = clean_optional_text(tanker_asset_code)
    cleaned_search = clean_optional_text(search)

    for transaction in transactions:
        tanker_payload = get_tanker_payload_for_transaction(db, transaction.id)

        if not tanker_payload:
            continue

        ticket = build_tanker_tracking_ticket(
            transaction=transaction,
            tanker_payload=tanker_payload,
            db=db,
        )

        if cleaned_tanker_asset_code:
            ticket_tanker_code = clean_optional_text(ticket.get("tanker_asset_code"))

            if not ticket_tanker_code or ticket_tanker_code.lower() != cleaned_tanker_asset_code.lower():
                continue

        if cleaned_search:
            searchable_text = " ".join(
                [
                    str(ticket.get("ticket_number") or ""),
                    str(ticket.get("operation_number") or ""),
                    str(ticket.get("convoy_number") or ""),
                    str(ticket.get("primary_asset_code") or ""),
                    str(ticket.get("primary_asset_name") or ""),
                    str(ticket.get("prime_mover_asset_code") or ""),
                    str(ticket.get("prime_mover_asset_name") or ""),
                    str(ticket.get("tanker_asset_code") or ""),
                    str(ticket.get("tanker_asset_name") or ""),
                    str(ticket.get("tanker_chassis_number") or ""),
                    str(ticket.get("origin_location_code") or ""),
                    str(ticket.get("destination_location_code") or ""),
                    str(ticket.get("product_name") or ""),
                    str(ticket.get("status") or ""),
                ]
            ).lower()

            if cleaned_search.lower() not in searchable_text:
                continue

        tickets.append(ticket)

    return build_tanker_tracking_groups(tickets, db)


def build_tanker_tracking_summary(rows: list[dict]):
    pending_receipts = 0
    received_groups = 0
    compared_groups = 0
    seal_mismatch_groups = 0
    quantity_variance_groups = 0

    for row in rows:
        status = row.get("tracking_status")

        if status == "PENDING_RECEIPT":
            pending_receipts += 1

        if status in [
            "ACKNOWLEDGED",
            "RECEIVED",
            "MATCHED",
            "SEAL_MISMATCH",
            "QUANTITY_VARIANCE",
        ]:
            received_groups += 1

        if row.get("quantity_comparison") is not None:
            compared_groups += 1

        if status == "SEAL_MISMATCH":
            seal_mismatch_groups += 1

        if status == "QUANTITY_VARIANCE":
            quantity_variance_groups += 1

    return {
        "total_groups": len(rows),
        "pending_receipts": pending_receipts,
        "received_groups": received_groups,
        "compared_groups": compared_groups,
        "seal_mismatch_groups": seal_mismatch_groups,
        "quantity_variance_groups": quantity_variance_groups,
    }


@router.get(
    "",
    response_model=TankerTrackingResponse,
)
def get_tanker_tracking(
    date_from: str | None = None,
    date_to: str | None = None,
    convoy_number: str | None = None,
    location_code: str | None = None,
    tanker_asset_code: str | None = None,
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

    rows = get_tanker_tracking_rows(
        db=db,
        date_from=date_from,
        date_to=date_to,
        convoy_number=convoy_number,
        location_code=location_code,
        tanker_asset_code=tanker_asset_code,
        status=status,
        search=search,
    )

    summary = build_tanker_tracking_summary(rows)

    return {
        "rows": rows,
        **summary,
    }


@router.get(
    "/by-convoy/{convoy_number}",
    response_model=TankerTrackingResponse,
)
def get_tanker_tracking_by_convoy(
    convoy_number: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Operation Transaction",
        db,
    )

    rows = get_tanker_tracking_rows(
        db=db,
        convoy_number=convoy_number,
    )

    summary = build_tanker_tracking_summary(rows)

    return {
        "rows": rows,
        **summary,
    }


@router.get(
    "/sender-reference/{sender_transaction_id}",
    response_model=TankerTrackingTicketResponse,
)
def get_tanker_sender_reference(
    sender_transaction_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Create Operation Entry",
        db,
    )

    sender_transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == sender_transaction_id)
        .first()
    )

    if not sender_transaction:
        raise HTTPException(
            status_code=404,
            detail="Sender tanker transaction not found",
        )

    require_approved_transaction_for_tracking(
        sender_transaction,
        "receiver reference",
        db=db,
    )

    tanker_payload = get_tanker_payload_for_transaction(
        db,
        sender_transaction.id,
    )

    if not tanker_payload:
        raise HTTPException(
            status_code=400,
            detail="Selected sender transaction does not have tanker payload",
        )

    sender_ticket = build_tanker_tracking_ticket(
        transaction=sender_transaction,
        tanker_payload=tanker_payload,
        db=db,
    )

    if sender_ticket.get("movement_role") != "SENDER":
        raise HTTPException(
            status_code=400,
            detail="Selected transaction is not detected as a sender tanker transaction",
        )

    return sender_ticket


@router.get(
    "/acknowledgements",
    response_model=list[TankerReceiptAcknowledgementResponse],
)
def get_tanker_receipt_acknowledgements(
    convoy_number: str | None = None,
    tanker_asset_code: str | None = None,
    receiver_location_code: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Operation Transaction",
        db,
    )

    query = db.query(TankerReceiptAcknowledgement)

    cleaned_convoy_number = clean_optional_text(convoy_number)

    if cleaned_convoy_number:
        query = query.filter(
            TankerReceiptAcknowledgement.convoy_number.ilike(
                cleaned_convoy_number
            )
        )

    cleaned_tanker_asset_code = clean_optional_text(tanker_asset_code)

    if cleaned_tanker_asset_code:
        query = query.filter(
            TankerReceiptAcknowledgement.tanker_asset_code.ilike(
                cleaned_tanker_asset_code
            )
        )

    cleaned_receiver_location_code = clean_optional_text(receiver_location_code)

    if cleaned_receiver_location_code:
        query = query.filter(
            TankerReceiptAcknowledgement.receiver_location_code.ilike(
                cleaned_receiver_location_code
            )
        )

    acknowledgements = (
        query.order_by(
            TankerReceiptAcknowledgement.acknowledged_at.desc(),
            TankerReceiptAcknowledgement.id.desc(),
        )
        .all()
    )

    return [
        build_tanker_acknowledgement_response(acknowledgement, db)
        for acknowledgement in acknowledgements
    ]


@router.post(
    "/acknowledge",
    response_model=TankerReceiptAcknowledgementResponse,
)
def acknowledge_tanker_receipt(
    request: TankerReceiptAcknowledgementCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Create Operation Entry",
        db,
    )

    sender_transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == request.sender_transaction_id)
        .first()
    )

    if not sender_transaction:
        raise HTTPException(
            status_code=404,
            detail="Sender tanker transaction not found",
        )

    require_approved_transaction_for_tracking(
        sender_transaction,
        "receiver acknowledgement",
        db=db,
    )

    tanker_payload = get_tanker_payload_for_transaction(
        db,
        sender_transaction.id,
    )

    if not tanker_payload:
        raise HTTPException(
            status_code=400,
            detail="Selected sender transaction does not have tanker payload",
        )

    existing_acknowledgement = get_tanker_acknowledgement_by_sender(
        db,
        sender_transaction.id,
    )

    if existing_acknowledgement:
        raise HTTPException(
            status_code=400,
            detail="This tanker sender transaction is already acknowledged",
        )

    if clean_optional_text(sender_transaction.convoy_number) is None:
        raise HTTPException(
            status_code=400,
            detail="Sender tanker transaction does not have convoy number",
        )

    sender_ticket = build_tanker_tracking_ticket(
        transaction=sender_transaction,
        tanker_payload=tanker_payload,
        db=db,
    )

    receiver_location_code = clean_optional_text(
        request.receiver_location_code
    )

    if receiver_location_code:
        receiver_location = get_location_by_code(receiver_location_code, db)

        if not receiver_location:
            raise HTTPException(
                status_code=400,
                detail="Receiver location not found",
            )

        if receiver_location.status != "Active":
            raise HTTPException(
                status_code=400,
                detail="Only Active receiver location can acknowledge receipt",
            )

    new_acknowledgement = TankerReceiptAcknowledgement(
        sender_transaction_id=sender_transaction.id,
        convoy_number=sender_transaction.convoy_number,
        tanker_asset_code=sender_ticket.get("tanker_asset_code"),
        prime_mover_asset_code=sender_ticket.get("prime_mover_asset_code"),
        receiver_location_code=receiver_location_code,
        acknowledged_by=get_current_user_label(current_user),
        acknowledged_at=datetime.now(timezone.utc),
        remarks=clean_optional_text(request.remarks),
        status="Acknowledged",
    )

    db.add(new_acknowledgement)
    db.flush()

    after_data = build_tanker_acknowledgement_audit_snapshot(
        new_acknowledgement,
        db,
    )

    create_audit_log(
        db=db,
        module_name="Tanker Tracking",
        action="Acknowledge Tanker Receipt",
        current_user=current_user,
        entity_type="TankerReceiptAcknowledgement",
        entity_id=new_acknowledgement.id,
        entity_label=(
            f"{new_acknowledgement.convoy_number} - "
            f"{new_acknowledgement.tanker_asset_code or ''}"
        ),
        ticket_number=get_transaction_ticket_number(sender_transaction),
        operation_number=sender_transaction.operation_number,
        remarks="Tanker receipt acknowledged",
        request_path="/tanker-tracking/acknowledge",
        details={
            "after": after_data,
            "sender_transaction": {
                "id": sender_transaction.id,
                "ticket_number": get_transaction_ticket_number(
                    sender_transaction
                ),
                "operation_number": sender_transaction.operation_number,
                "convoy_number": sender_transaction.convoy_number,
            },
        },
    )

    db.commit()
    db.refresh(new_acknowledgement)

    return build_tanker_acknowledgement_response(
        new_acknowledgement,
        db,
    )


@router.post(
    "/acknowledgements/{acknowledgement_id}/revoke",
    response_model=TankerReceiptAcknowledgementResponse,
)
def revoke_tanker_receipt_acknowledgement(
    acknowledgement_id: int,
    remarks: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Create Operation Entry",
        db,
    )

    acknowledgement = (
        db.query(TankerReceiptAcknowledgement)
        .filter(TankerReceiptAcknowledgement.id == acknowledgement_id)
        .first()
    )

    if not acknowledgement:
        raise HTTPException(
            status_code=404,
            detail="Tanker receipt acknowledgement not found",
        )

    if acknowledgement.status == "Revoked":
        raise HTTPException(
            status_code=400,
            detail="This tanker receipt acknowledgement is already revoked",
        )

    before_data = build_tanker_acknowledgement_audit_snapshot(
        acknowledgement,
        db,
    )

    acknowledgement.status = "Revoked"

    cleaned_remarks = clean_optional_text(remarks)

    if cleaned_remarks:
        acknowledgement.remarks = (
            f"{acknowledgement.remarks or ''}\nRevoke Remarks: {cleaned_remarks}"
        ).strip()

    acknowledgement.updated_at = datetime.now(timezone.utc)

    db.flush()

    after_data = build_tanker_acknowledgement_audit_snapshot(
        acknowledgement,
        db,
    )

    sender_transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == acknowledgement.sender_transaction_id)
        .first()
    )

    create_audit_log(
        db=db,
        module_name="Tanker Tracking",
        action="Revoke Tanker Receipt Acknowledgement",
        current_user=current_user,
        entity_type="TankerReceiptAcknowledgement",
        entity_id=acknowledgement.id,
        entity_label=(
            f"{acknowledgement.convoy_number} - "
            f"{acknowledgement.tanker_asset_code or ''}"
        ),
        ticket_number=(
            get_transaction_ticket_number(sender_transaction)
            if sender_transaction
            else None
        ),
        operation_number=(
            sender_transaction.operation_number
            if sender_transaction
            else None
        ),
        remarks="Tanker receipt acknowledgement revoked",
        request_path=(
            f"/tanker-tracking/acknowledgements/"
            f"{acknowledgement_id}/revoke"
        ),
        details={
            "before": before_data,
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(acknowledgement)

    return build_tanker_acknowledgement_response(
        acknowledgement,
        db,
    )


@router.post(
    "/close",
    response_model=TankerReceiptAcknowledgementResponse,
)
def close_tanker_tracking_movement(
    request: TankerTrackingClosureCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Create Operation Entry",
        db,
    )

    acknowledgement = (
        db.query(TankerReceiptAcknowledgement)
        .filter(TankerReceiptAcknowledgement.id == request.acknowledgement_id)
        .first()
    )

    if not acknowledgement:
        raise HTTPException(
            status_code=404,
            detail="Tanker acknowledgement not found",
        )

    if acknowledgement.status == "Revoked":
        raise HTTPException(
            status_code=400,
            detail="Revoked tanker acknowledgement cannot be closed",
        )

    if acknowledgement.status == "Closed":
        raise HTTPException(
            status_code=400,
            detail="This tanker movement is already closed",
        )

    sender_transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == acknowledgement.sender_transaction_id)
        .first()
    )

    if not sender_transaction:
        raise HTTPException(
            status_code=404,
            detail="Sender transaction not found",
        )

    require_approved_transaction_for_tracking(
        sender_transaction,
        "tanker movement closure",
        db=db,
    )

    tracking_rows = get_tanker_tracking_rows(
        db=db,
        convoy_number=acknowledgement.convoy_number,
        tanker_asset_code=acknowledgement.tanker_asset_code,
    )

    target_row = None

    for row in tracking_rows:
        if row.get("acknowledgement_id") == acknowledgement.id:
            target_row = row
            break

    if not target_row:
        raise HTTPException(
            status_code=400,
            detail="Unable to find tanker tracking row for this acknowledgement",
        )

    if not target_row.get("latest_receiver_ticket"):
        raise HTTPException(
            status_code=400,
            detail="Cannot close tanker movement before receiver ticket is Approved",
        )

    if not target_row.get("quantity_comparison"):
        raise HTTPException(
            status_code=400,
            detail="Cannot close tanker movement before quantity comparison is available",
        )

    before_data = build_tanker_acknowledgement_audit_snapshot(
        acknowledgement,
        db,
    )

    acknowledgement.status = "Closed"
    acknowledgement.closed_by = get_current_user_label(current_user)
    acknowledgement.closed_at = datetime.now(timezone.utc)
    acknowledgement.closure_remarks = clean_optional_text(request.closure_remarks)
    acknowledgement.updated_at = datetime.now(timezone.utc)

    db.flush()

    after_data = build_tanker_acknowledgement_audit_snapshot(
        acknowledgement,
        db,
    )

    create_audit_log(
        db=db,
        module_name="Tanker Tracking",
        action="Close Tanker Movement",
        current_user=current_user,
        entity_type="TankerReceiptAcknowledgement",
        entity_id=acknowledgement.id,
        entity_label=(
            f"{acknowledgement.convoy_number} - "
            f"{acknowledgement.tanker_asset_code or ''}"
        ),
        ticket_number=get_transaction_ticket_number(sender_transaction),
        operation_number=sender_transaction.operation_number,
        remarks="Tanker movement closed after comparison",
        request_path="/tanker-tracking/close",
        details={
            "before": before_data,
            "after": after_data,
            "comparison": target_row.get("quantity_comparison"),
            "tracking_status_before_close": target_row.get("tracking_status"),
        },
    )

    db.commit()
    db.refresh(acknowledgement)

    return build_tanker_acknowledgement_response(
        acknowledgement,
        db,
    )
