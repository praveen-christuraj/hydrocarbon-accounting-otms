from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    OperationTransaction,
    OperationTransactionValue,
    OperationTemplate,
    VesselOperation,
    VesselStockLedger,
    Asset,
    Location,
    User,
)
from app.schemas import VesselStockLedgerResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.utils.helpers import (
    clean_optional_text,
    safe_float,
    get_transaction_ticket_number,
    get_location_by_code,
    get_asset_by_code,
)

router = APIRouter(prefix="/vessel-stock-ledger", tags=["Vessel Stock Ledger"])


def get_value_text(db: Session, transaction_id: int, field_code: str):
    row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction_id,
            OperationTransactionValue.field_code == field_code,
        )
        .first()
    )
    if not row:
        return None
    if row.field_value is None:
        return None
    if isinstance(row.field_value, (dict, list)):
        return row.field_value
    return str(row.field_value).strip()


def create_or_update_vessel_stock_ledger_from_approved_transaction(
    db: Session,
    transaction: OperationTransaction,
    current_user: User,
):
    if transaction.status != "Approved":
        return None

    template = (
        db.query(OperationTemplate)
        .filter(OperationTemplate.id == transaction.operation_template_id)
        .first()
    )
    if not template:
        return None

    layout = str(template.entry_layout_type or "").strip()
    if layout not in ["Vessel Cycle", "Stock Movement"]:
        return None

    asset = (
        db.query(Asset)
        .filter(Asset.asset_code.ilike(transaction.primary_asset_code))
        .first()
    )
    if not asset:
        return None

    created_by = (
        f"{current_user.full_name} ({current_user.username})"
        if current_user.full_name
        else current_user.username
    )

    vessel_operation_code = get_value_text(db, transaction.id, "vessel_operation_code")
    vessel_operation_code = clean_optional_text(vessel_operation_code if isinstance(vessel_operation_code, str) else "")

    movement_reference = (
        get_value_text(db, transaction.id, "movement_reference")
        or get_value_text(db, transaction.id, "shuttle_number")
        or get_value_text(db, transaction.id, "reference_number")
    )
    movement_reference = clean_optional_text(movement_reference if isinstance(movement_reference, str) else "")

    qty_bbl = water_bbl = nsv_bbl = 0
    opening_stock = opening_water = closing_stock = closing_water = 0
    net_stock = net_water = net_nsv = 0

    if layout == "Vessel Cycle":
        qty_bbl = safe_float(get_value_text(db, transaction.id, "quantity_bbl") or get_value_text(db, transaction.id, "gross_qty_bbl"))
        water_bbl = safe_float(get_value_text(db, transaction.id, "water_bbl"))
        nsv_bbl = safe_float(get_value_text(db, transaction.id, "nsv_bbl"))
    else:
        opening_stock = safe_float(get_value_text(db, transaction.id, "opening_stock"))
        opening_water = safe_float(get_value_text(db, transaction.id, "opening_water"))
        closing_stock = safe_float(get_value_text(db, transaction.id, "closing_stock"))
        closing_water = safe_float(get_value_text(db, transaction.id, "closing_water"))

        net_stock = safe_float(get_value_text(db, transaction.id, "net_stock")) or (closing_stock - opening_stock)
        net_water = safe_float(get_value_text(db, transaction.id, "net_water")) or (closing_water - opening_water)
        net_nsv = safe_float(get_value_text(db, transaction.id, "net_nsv")) or (net_stock - net_water)

        qty_bbl = net_stock
        water_bbl = net_water
        nsv_bbl = net_nsv

    vessel_op = None
    if vessel_operation_code:
        vessel_op = (
            db.query(VesselOperation)
            .filter(
                VesselOperation.location_code.ilike(transaction.origin_location_code),
                VesselOperation.applicable_asset_type_code.ilike(asset.asset_type_code),
                VesselOperation.operation_code.ilike(vessel_operation_code),
                VesselOperation.status == "Active",
            )
            .first()
        )

    ledger = (
        db.query(VesselStockLedger)
        .filter(VesselStockLedger.transaction_id == transaction.id)
        .first()
    )

    if not ledger:
        ledger = VesselStockLedger(transaction_id=transaction.id)
        db.add(ledger)

    ledger.ticket_number = get_transaction_ticket_number(transaction)
    ledger.operation_number = transaction.operation_number
    ledger.status = transaction.status

    ledger.location_code = transaction.origin_location_code

    ledger.vessel_asset_code = asset.asset_code
    ledger.vessel_asset_name = asset.asset_name
    ledger.vessel_asset_type_code = asset.asset_type_code

    ledger.operation_date = transaction.operation_date
    ledger.product_name = transaction.product_name

    ledger.movement_reference = movement_reference

    ledger.vessel_operation_code = vessel_operation_code
    ledger.vessel_operation_label = vessel_op.operation_label if vessel_op else vessel_operation_code
    ledger.vessel_operation_category = vessel_op.operation_category if vessel_op else None
    ledger.vessel_operation_sign = vessel_op.operation_sign if vessel_op else None

    ledger.qty_bbl = qty_bbl
    ledger.water_bbl = water_bbl
    ledger.nsv_bbl = nsv_bbl

    ledger.opening_stock = opening_stock
    ledger.opening_water = opening_water
    ledger.closing_stock = closing_stock
    ledger.closing_water = closing_water
    ledger.net_stock = net_stock
    ledger.net_water = net_water
    ledger.net_nsv = net_nsv

    ledger.created_by = ledger.created_by or created_by
    ledger.updated_at = datetime.now()

    db.flush()

    return ledger


@router.get("/vessel-stock-ledger", response_model=list[VesselStockLedgerResponse])
def get_vessel_stock_ledger(
    location_code: str | None = None,
    vessel_asset_code: str | None = None,
    reference_number: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Operation Transaction", db)

    query = db.query(VesselStockLedger)

    lc = clean_optional_text(location_code)
    if lc:
        query = query.filter(VesselStockLedger.location_code.ilike(lc))

    ac = clean_optional_text(vessel_asset_code)
    if ac:
        query = query.filter(VesselStockLedger.vessel_asset_code.ilike(ac))

    ref = clean_optional_text(reference_number)
    if ref:
        query = query.filter(VesselStockLedger.movement_reference.ilike(ref))

    if clean_optional_text(date_from):
        query = query.filter(VesselStockLedger.operation_date >= date.fromisoformat(date_from))

    if clean_optional_text(date_to):
        query = query.filter(VesselStockLedger.operation_date <= date.fromisoformat(date_to))

    rows = query.order_by(VesselStockLedger.operation_date.desc(), VesselStockLedger.id.desc()).all()

    loc_map = {l.location_code: l.location_name for l in db.query(Location).all()}

    results = []
    for r in rows:
        item = r.__dict__.copy()
        item["location_name"] = loc_map.get(r.location_code, "")
        results.append(item)

    return results
