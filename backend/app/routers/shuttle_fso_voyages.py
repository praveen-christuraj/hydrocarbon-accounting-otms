from datetime import datetime, date, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import and_, func, literal, or_
import io
import openpyxl

from app.database import get_db
from app.models import (
    OperationTransaction,
    OperationTransactionValue,
    ShuttleVoyage,
    FSOVoyage,
    Location,
    Asset,
    User,
)
from app.schemas import (
    ShuttleVoyageCloseRequest,
    ShuttleVoyageReopenRequest,
    ShuttleVoyageResponse,
    FSOVoyageCloseRequest,
    FSOVoyageReopenRequest,
    FSOVoyageResponse,
    ShuttleTrackingResponse,
    FSOTrackingResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import (
    clean_optional_text,
    get_transaction_ticket_number,
    get_current_user_label,
    get_current_user_display_name,
    get_location_by_code,
    get_asset_by_code,
    safe_float,
)
from app.config import APPROVED_TRANSACTION_STATUS
from app.services.transaction_helpers import (
    approved_transaction_not_on_correction_hold,
    parse_date_filter,
)

router = APIRouter(prefix="/shuttle-fso", tags=["Shuttle / FSO Voyages"])


def get_shuttle_voyage_by_key(db: Session, location_code: str, shuttle_number: str, shuttle_asset_code: str):
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
    if not voyage:
        return
    if str(voyage.status or "").strip().upper() == "CLOSED":
        raise HTTPException(
            status_code=400,
            detail="Shuttle voyage is CLOSED for this key. Reopen the voyage to continue.",
        )


def get_or_create_shuttle_voyage(
    db: Session,
    location_code: str,
    shuttle_number: str,
    shuttle_asset_code: str,
    current_user: User,
):
    voyage = get_shuttle_voyage_by_key(db, location_code, shuttle_number, shuttle_asset_code)
    if voyage:
        return voyage

    created_by_display = get_current_user_label(current_user)
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
    voyage = get_fso_voyage_by_key(db, location_code, shuttle_number, fso_asset_code)
    if voyage:
        return voyage

    created_by_display = get_current_user_label(current_user)
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


def get_shuttle_payload_for_transaction(db: Session, transaction_id: int):
    row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction_id,
            OperationTransactionValue.field_code == "shuttle_payload",
        )
        .first()
    )
    if not row:
        return None
    if isinstance(row.field_value, dict):
        return row.field_value
    return None


def get_fso_payload_for_transaction(db: Session, transaction_id: int):
    row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction_id,
            OperationTransactionValue.field_code == "fso_payload",
        )
        .first()
    )
    if not row:
        return None
    if isinstance(row.field_value, dict):
        return row.field_value
    return None


def _xlsx_autofit(ws):
    for col in ws.columns:
        max_length = 0
        column_letter = col[0].column_letter
        for cell in col:
            try:
                if cell.value:
                    max_length = max(max_length, len(str(cell.value)))
            except Exception:
                pass
        adjusted_width = min(max_length + 2, 50)
        ws.column_dimensions[column_letter].width = adjusted_width


# ----- Shuttle Voyage Close / Reopen -----


@router.post("/shuttle-voyages/close", response_model=ShuttleVoyageResponse)
def close_shuttle_voyage(
    request: ShuttleVoyageCloseRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Shuttle Tracking", db)

    voyage = get_or_create_shuttle_voyage(
        db=db,
        location_code=request.location_code,
        shuttle_number=request.shuttle_number,
        shuttle_asset_code=request.shuttle_asset_code,
        current_user=current_user,
    )

    ensure_shuttle_voyage_not_closed(voyage)

    voyage.status = "CLOSED"
    voyage.closed_by = get_current_user_label(current_user)
    voyage.closed_at = datetime.now(timezone.utc)
    voyage.closure_remarks = clean_optional_text(request.closure_remarks)
    voyage.updated_at = datetime.now(timezone.utc)

    create_audit_log(
        db=db,
        module_name="Shuttle Tracking",
        action="Close Shuttle Voyage",
        current_user=current_user,
        entity_type="ShuttleVoyage",
        entity_id=voyage.id,
        entity_label=f"{voyage.location_code}-{voyage.shuttle_asset_code}-{voyage.shuttle_number}",
        remarks="Shuttle voyage closed",
        request_path="/shuttle-fso/shuttle-voyages/close",
        details={
            "location_code": voyage.location_code,
            "shuttle_number": voyage.shuttle_number,
            "shuttle_asset_code": voyage.shuttle_asset_code,
        },
    )

    db.commit()
    db.refresh(voyage)
    return voyage


@router.post("/shuttle-voyages/reopen", response_model=ShuttleVoyageResponse)
def reopen_shuttle_voyage(
    request: ShuttleVoyageReopenRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Shuttle Tracking", db)

    voyage = get_shuttle_voyage_by_key(
        db,
        request.location_code,
        request.shuttle_number,
        request.shuttle_asset_code,
    )

    if not voyage:
        raise HTTPException(status_code=404, detail="Shuttle voyage not found")

    voyage.status = "OPEN"
    voyage.closed_by = None
    voyage.closed_at = None
    voyage.closure_remarks = None
    voyage.updated_at = datetime.now(timezone.utc)

    if request.remarks:
        voyage.remarks = clean_optional_text(request.remarks)

    create_audit_log(
        db=db,
        module_name="Shuttle Tracking",
        action="Reopen Shuttle Voyage",
        current_user=current_user,
        entity_type="ShuttleVoyage",
        entity_id=voyage.id,
        entity_label=f"{voyage.location_code}-{voyage.shuttle_asset_code}-{voyage.shuttle_number}",
        remarks="Shuttle voyage reopened",
        request_path="/shuttle-fso/shuttle-voyages/reopen",
        details={
            "location_code": voyage.location_code,
            "shuttle_number": voyage.shuttle_number,
            "shuttle_asset_code": voyage.shuttle_asset_code,
        },
    )

    db.commit()
    db.refresh(voyage)
    return voyage


# ----- FSO Voyage Close / Reopen -----


@router.post("/fso-voyages/close", response_model=FSOVoyageResponse)
def close_fso_voyage(
    request: FSOVoyageCloseRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage FSO Tracking", db)

    voyage = get_or_create_fso_voyage(
        db=db,
        location_code=request.location_code,
        shuttle_number=request.shuttle_number,
        fso_asset_code=request.fso_asset_code,
        current_user=current_user,
    )

    ensure_fso_voyage_not_closed(voyage)

    voyage.status = "CLOSED"
    voyage.closed_by = get_current_user_label(current_user)
    voyage.closed_at = datetime.now(timezone.utc)
    voyage.closure_remarks = clean_optional_text(request.closure_remarks)
    voyage.updated_at = datetime.now(timezone.utc)

    create_audit_log(
        db=db,
        module_name="FSO Tracking",
        action="Close FSO Voyage",
        current_user=current_user,
        entity_type="FSOVoyage",
        entity_id=voyage.id,
        entity_label=f"{voyage.location_code}-{voyage.fso_asset_code}-{voyage.shuttle_number}",
        remarks="FSO voyage closed",
        request_path="/shuttle-fso/fso-voyages/close",
        details={
            "location_code": voyage.location_code,
            "shuttle_number": voyage.shuttle_number,
            "fso_asset_code": voyage.fso_asset_code,
        },
    )

    db.commit()
    db.refresh(voyage)
    return voyage


@router.post("/fso-voyages/reopen", response_model=FSOVoyageResponse)
def reopen_fso_voyage(
    request: FSOVoyageReopenRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage FSO Tracking", db)

    voyage = get_fso_voyage_by_key(
        db,
        request.location_code,
        request.shuttle_number,
        request.fso_asset_code,
    )

    if not voyage:
        raise HTTPException(status_code=404, detail="FSO voyage not found")

    voyage.status = "OPEN"
    voyage.closed_by = None
    voyage.closed_at = None
    voyage.closure_remarks = None
    voyage.updated_at = datetime.now(timezone.utc)

    if request.remarks:
        voyage.remarks = clean_optional_text(request.remarks)

    create_audit_log(
        db=db,
        module_name="FSO Tracking",
        action="Reopen FSO Voyage",
        current_user=current_user,
        entity_type="FSOVoyage",
        entity_id=voyage.id,
        entity_label=f"{voyage.location_code}-{voyage.fso_asset_code}-{voyage.shuttle_number}",
        remarks="FSO voyage reopened",
        request_path="/shuttle-fso/fso-voyages/reopen",
        details={
            "location_code": voyage.location_code,
            "shuttle_number": voyage.shuttle_number,
            "fso_asset_code": voyage.fso_asset_code,
        },
    )

    db.commit()
    db.refresh(voyage)
    return voyage


# ----- Shuttle Tracking -----


@router.get("/shuttle-tracking", response_model=ShuttleTrackingResponse)
def get_shuttle_tracking(
    date_from: str | None = None,
    date_to: str | None = None,
    location_code: str | None = None,
    shuttle_number: str | None = None,
    shuttle_asset_code: str | None = None,
    tab: str | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 20,
    include_tickets: bool = False,
    group_key: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Shuttle Tracking", db)

    def _norm(v):
        return str(v or "").strip().upper()

    def _abs_qty(net_stock, net_water):
        try:
            return abs(float(net_stock or 0.0)) + abs(float(net_water or 0.0))
        except Exception:
            return 0.0

    def _op_code(meta):
        return _norm(meta.get("vessel_operation_code"))

    def _op_label(meta):
        return _norm(meta.get("vessel_operation_label"))

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

    df = parse_date_filter(date_from, "date_from")
    dt = parse_date_filter(date_to, "date_to")

    lc = clean_optional_text(location_code)
    sn = clean_optional_text(shuttle_number)
    ac = clean_optional_text(shuttle_asset_code)

    tab_norm = (clean_optional_text(tab) or "OPEN").upper()
    search_norm = (clean_optional_text(search) or "").strip()

    page = 1 if page is None or page < 1 else page
    page_size = 20 if page_size is None or page_size < 1 else min(int(page_size), 200)
    offset_val = (page - 1) * page_size

    base_q = (
        db.query(OperationTransaction)
        .join(
            OperationTransactionValue,
            OperationTransactionValue.transaction_id == OperationTransaction.id,
        )
        .filter(
            OperationTransactionValue.field_code == "shuttle_payload",
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
        )
    )

    if df:
        base_q = base_q.filter(OperationTransaction.operation_date >= df)
    if dt:
        base_q = base_q.filter(OperationTransaction.operation_date <= dt)
    if lc:
        base_q = base_q.filter(OperationTransaction.origin_location_code.ilike(lc))
    if sn:
        base_q = base_q.filter(OperationTransaction.convoy_number.ilike(sn))
    if ac:
        base_q = base_q.filter(OperationTransaction.primary_asset_code.ilike(ac))

    if search_norm:
        like = f"%{search_norm}%"
        base_q = base_q.filter(
            or_(
                OperationTransaction.origin_location_code.ilike(like),
                OperationTransaction.convoy_number.ilike(like),
                OperationTransaction.primary_asset_code.ilike(like),
                OperationTransaction.operation_number.ilike(like),
                OperationTransaction.operation_ticket_number.ilike(like),
                OperationTransaction.product_name.ilike(like),
            )
        )

    if group_key:
        parts = [p.strip() for p in str(group_key).split("|")]
        if len(parts) == 3:
            g_loc, g_shuttle, g_asset = parts
            base_q = base_q.filter(
                OperationTransaction.origin_location_code == g_loc,
                OperationTransaction.convoy_number == g_shuttle,
                OperationTransaction.primary_asset_code == g_asset,
            )
            include_tickets = True
        else:
            raise HTTPException(status_code=400, detail="Invalid group_key format")

    voyage_status_expr = func.coalesce(ShuttleVoyage.status, literal("OPEN"))

    key_loc = OperationTransaction.origin_location_code
    key_shuttle = OperationTransaction.convoy_number
    key_asset = OperationTransaction.primary_asset_code

    group_q = (
        base_q.with_entities(
            key_loc.label("location_code"),
            key_shuttle.label("shuttle_number"),
            key_asset.label("shuttle_asset_code"),
            func.min(OperationTransaction.operation_date).label("first_date"),
            func.max(OperationTransaction.operation_date).label("last_date"),
        )
        .outerjoin(
            ShuttleVoyage,
            and_(
                ShuttleVoyage.location_code == key_loc,
                ShuttleVoyage.shuttle_number == key_shuttle,
                ShuttleVoyage.shuttle_asset_code == key_asset,
            ),
        )
        .group_by(key_loc, key_shuttle, key_asset, voyage_status_expr)
    )

    if tab_norm == "CLOSED":
        group_q = group_q.filter(voyage_status_expr == "CLOSED")
    else:
        group_q = group_q.filter(voyage_status_expr != "CLOSED")

    total_groups = group_q.count()

    group_rows = (
        group_q.order_by(func.max(OperationTransaction.operation_date).desc(), key_loc.asc())
        .offset(offset_val)
        .limit(page_size)
        .all()
    )

    if not group_rows:
        return {
            "rows": [],
            "total_groups": total_groups,
            "page": page,
            "page_size": page_size,
            "has_more": total_groups > offset_val + page_size,
        }

    keys = [
        (r.location_code, r.shuttle_number, r.shuttle_asset_code)
        for r in group_rows
    ]

    if not include_tickets:
        key_filters = []
        for (loc_code, sh_num, asset_code) in keys:
            key_filters.append(
                and_(
                    OperationTransaction.origin_location_code == loc_code,
                    OperationTransaction.convoy_number == sh_num,
                    OperationTransaction.primary_asset_code == asset_code,
                )
            )

        payload_rows = (
            db.query(
                OperationTransaction.origin_location_code,
                OperationTransaction.convoy_number,
                OperationTransaction.primary_asset_code,
                OperationTransactionValue.field_value,
            )
            .join(
                OperationTransactionValue,
                OperationTransactionValue.transaction_id == OperationTransaction.id,
            )
            .filter(
                OperationTransactionValue.field_code == "shuttle_payload",
                OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
                approved_transaction_not_on_correction_hold(db),
            )
            .filter(or_(*key_filters))
            .all()
        )

        totals_map = {}
        for (loc_code, sh_num, asset_code, field_value) in payload_rows:
            k = f"{loc_code}|{sh_num}|{asset_code}"
            if k not in totals_map:
                totals_map[k] = {"net_receipt_bbl": 0.0, "net_discharge_bbl": 0.0}
            if isinstance(field_value, dict):
                fv = field_value
                meta = fv.get("meta") or {}
                net = ((fv.get("calculated") or {}).get("net") or {})
                net_stock = float(safe_float(net.get("net_stock_bbl")))
                net_water = float(safe_float(net.get("net_water_bbl")))
                qty_bbl = _abs_qty(net_stock, net_water)
                if (_is_loading(meta) or _is_sts_in(meta) or _is_top_up(meta)) and (not _is_unloading(meta)):
                    totals_map[k]["net_receipt_bbl"] += qty_bbl
                if _is_unloading(meta) and not _is_sts_out(meta):
                    totals_map[k]["net_discharge_bbl"] += qty_bbl

        rows = []
        for (loc_code, sh_num, asset_code) in keys:
            asset = get_asset_by_code(asset_code, db)
            loc = get_location_by_code(loc_code, db)
            voyage = get_shuttle_voyage_by_key(db, loc_code, sh_num or "", asset_code)
            k = f"{loc_code}|{sh_num}|{asset_code}"
            t = totals_map.get(k, {"net_receipt_bbl": 0.0, "net_discharge_bbl": 0.0})
            rows.append({
                "group_key": k,
                "location_code": loc_code,
                "location_name": loc.location_name if loc else "",
                "shuttle_number": sh_num or "",
                "shuttle_asset_code": asset_code,
                "shuttle_asset_name": asset.asset_name if asset else "",
                "voyage_status": voyage.status if voyage else "OPEN",
                "closed_by": voyage.closed_by if voyage else None,
                "closed_at": voyage.closed_at if voyage else None,
                "closure_remarks": voyage.closure_remarks if voyage else None,
                "total_tov_bbl": 0.0,
                "total_free_water_bbl": 0.0,
                "total_nsv_bbl": 0.0,
                "net_receipt_bbl": float(t["net_receipt_bbl"]),
                "net_discharge_bbl": float(t["net_discharge_bbl"]),
                "tickets": [],
            })

        return {
            "rows": rows,
            "total_groups": total_groups,
            "page": page,
            "page_size": page_size,
            "has_more": total_groups > offset_val + page_size,
        }

    tx_q = (
        db.query(OperationTransaction)
        .join(
            OperationTransactionValue,
            OperationTransactionValue.transaction_id == OperationTransaction.id,
        )
        .filter(
            OperationTransactionValue.field_code == "shuttle_payload",
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
        )
    )

    if df:
        tx_q = tx_q.filter(OperationTransaction.operation_date >= df)
    if dt:
        tx_q = tx_q.filter(OperationTransaction.operation_date <= dt)
    if search_norm:
        like = f"%{search_norm}%"
        tx_q = tx_q.filter(
            or_(
                OperationTransaction.origin_location_code.ilike(like),
                OperationTransaction.convoy_number.ilike(like),
                OperationTransaction.primary_asset_code.ilike(like),
                OperationTransaction.operation_number.ilike(like),
                OperationTransaction.operation_ticket_number.ilike(like),
                OperationTransaction.product_name.ilike(like),
            )
        )

    key_filters = []
    for (loc_code, sh_num, asset_code) in keys:
        key_filters.append(
            and_(
                OperationTransaction.origin_location_code == loc_code,
                OperationTransaction.convoy_number == sh_num,
                OperationTransaction.primary_asset_code == asset_code,
            )
        )
    tx_q = tx_q.filter(or_(*key_filters))

    txs = (
        tx_q.order_by(OperationTransaction.operation_date.asc(), OperationTransaction.id.asc())
        .all()
    )

    grouped = {}
    for tx in txs:
        payload = get_shuttle_payload_for_transaction(db, tx.id) or {}
        meta = (payload.get("meta") or {}) if isinstance(payload, dict) else {}
        net = ((payload.get("calculated") or {}).get("net") or {}) if isinstance(payload, dict) else {}
        inputs = (payload.get("inputs") or {}) if isinstance(payload, dict) else {}

        tov_raw = float(safe_float(net.get("TOV")))
        fw_raw = float(safe_float(net.get("FW")))
        nsv_raw = float(safe_float(net.get("NSV")))

        sign = str(meta.get("vessel_operation_sign") or "").strip().upper()
        multiplier = 1.0
        if sign in ("OUT", "-"):
            multiplier = -1.0
        elif sign in ("SET", "NEUTRAL", "0"):
            multiplier = 0.0

        tov = tov_raw * multiplier
        fw = fw_raw * multiplier
        nsv = nsv_raw * multiplier

        event_time = inputs.get("event_time")
        opening_stock = float(safe_float(inputs.get("opening_stock_bbl")))
        opening_water = float(safe_float(inputs.get("opening_water_bbl")))
        closing_stock = float(safe_float(inputs.get("closing_stock_bbl")))
        closing_water = float(safe_float(inputs.get("closing_water_bbl")))
        net_stock = float(safe_float(net.get("net_stock_bbl")))
        net_water = float(safe_float(net.get("net_water_bbl")))

        barge_reference = inputs.get("barge_reference")
        remarks = inputs.get("remarks")

        key = f"{tx.origin_location_code}|{tx.convoy_number}|{tx.primary_asset_code}"
        asset = get_asset_by_code(tx.primary_asset_code, db)
        loc = get_location_by_code(tx.origin_location_code, db)

        if key not in grouped:
            voyage = get_shuttle_voyage_by_key(
                db,
                tx.origin_location_code,
                tx.convoy_number or "",
                tx.primary_asset_code,
            )
            grouped[key] = {
                "group_key": key,
                "location_code": tx.origin_location_code,
                "location_name": loc.location_name if loc else "",
                "shuttle_number": tx.convoy_number or "",
                "shuttle_asset_code": tx.primary_asset_code,
                "shuttle_asset_name": asset.asset_name if asset else "",
                "voyage_status": voyage.status if voyage else "OPEN",
                "closed_by": voyage.closed_by if voyage else None,
                "closed_at": voyage.closed_at if voyage else None,
                "closure_remarks": voyage.closure_remarks if voyage else None,
                "tickets": [],
                "total_tov_bbl": 0.0,
                "total_free_water_bbl": 0.0,
                "total_nsv_bbl": 0.0,
                "net_receipt_bbl": 0.0,
                "net_discharge_bbl": 0.0,
            }

        qty_bbl = _abs_qty(net_stock, net_water)
        if (_is_loading(meta) or _is_sts_in(meta) or _is_top_up(meta)) and (not _is_unloading(meta)):
            grouped[key]["net_receipt_bbl"] += qty_bbl
        if _is_unloading(meta) and not _is_sts_out(meta):
            grouped[key]["net_discharge_bbl"] += qty_bbl

        grouped[key]["tickets"].append({
            "transaction_id": tx.id,
            "ticket_number": get_transaction_ticket_number(tx),
            "operation_number": tx.operation_number,
            "location_code": tx.origin_location_code,
            "location_name": loc.location_name if loc else "",
            "shuttle_number": tx.convoy_number or "",
            "shuttle_asset_code": tx.primary_asset_code,
            "shuttle_asset_name": asset.asset_name if asset else "",
            "product_name": tx.product_name,
            "operation_date": tx.operation_date,
            "event_time": event_time,
            "opening_stock_bbl": opening_stock,
            "opening_water_bbl": opening_water,
            "closing_stock_bbl": closing_stock,
            "closing_water_bbl": closing_water,
            "net_stock_bbl": net_stock,
            "net_water_bbl": net_water,
            "barge_reference": barge_reference,
            "remarks": remarks,
            "vessel_operation_code": meta.get("vessel_operation_code"),
            "vessel_operation_label": meta.get("vessel_operation_label"),
            "vessel_operation_category": meta.get("vessel_operation_category"),
            "vessel_operation_sign": meta.get("vessel_operation_sign"),
            "tov_bbl": tov,
            "free_water_bbl": fw,
            "nsv_bbl": nsv,
            "status": tx.status,
            "created_by": tx.created_by,
            "created_at": tx.created_at,
            "updated_at": tx.updated_at,
        })

        grouped[key]["total_tov_bbl"] += tov
        grouped[key]["total_free_water_bbl"] += fw
        grouped[key]["total_nsv_bbl"] += nsv

    rows = []
    for (loc_code, sh_num, asset_code) in keys:
        k = f"{loc_code}|{sh_num}|{asset_code}"
        if k in grouped:
            rows.append(grouped[k])
        else:
            asset = get_asset_by_code(asset_code, db)
            loc = get_location_by_code(loc_code, db)
            voyage = get_shuttle_voyage_by_key(db, loc_code, sh_num or "", asset_code)
            rows.append({
                "group_key": k,
                "location_code": loc_code,
                "location_name": loc.location_name if loc else "",
                "shuttle_number": sh_num or "",
                "shuttle_asset_code": asset_code,
                "shuttle_asset_name": asset.asset_name if asset else "",
                "voyage_status": voyage.status if voyage else "OPEN",
                "closed_by": voyage.closed_by if voyage else None,
                "closed_at": voyage.closed_at if voyage else None,
                "closure_remarks": voyage.closure_remarks if voyage else None,
                "tickets": [],
                "total_tov_bbl": 0.0,
                "total_free_water_bbl": 0.0,
                "total_nsv_bbl": 0.0,
                "net_receipt_bbl": 0.0,
                "net_discharge_bbl": 0.0,
            })

    return {
        "rows": rows,
        "total_groups": total_groups,
        "page": page,
        "page_size": page_size,
        "has_more": total_groups > offset_val + page_size,
    }


@router.get("/shuttle-tracking/export/xlsx")
def export_shuttle_voyage_xlsx(
    group_key: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Shuttle Tracking", db)

    parts = [p.strip() for p in str(group_key).split("|")]
    if len(parts) != 3:
        raise HTTPException(
            status_code=400,
            detail="Invalid group_key format. Expected location|shuttle_number|asset_code",
        )

    loc_code, shuttle_no, asset_code = parts

    txs = (
        db.query(OperationTransaction)
        .join(
            OperationTransactionValue,
            OperationTransactionValue.transaction_id == OperationTransaction.id,
        )
        .filter(
            OperationTransactionValue.field_code == "shuttle_payload",
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
            OperationTransaction.origin_location_code == loc_code,
            OperationTransaction.convoy_number == shuttle_no,
            OperationTransaction.primary_asset_code == asset_code,
        )
        .order_by(OperationTransaction.operation_date.asc(), OperationTransaction.id.asc())
        .all()
    )

    if not txs:
        raise HTTPException(status_code=404, detail="No approved shuttle tickets found for this voyage")

    loc = get_location_by_code(loc_code, db)
    asset = get_asset_by_code(asset_code, db)

    def _sf(v):
        try:
            return float(v or 0.0)
        except Exception:
            return 0.0

    def _abs_qty(net_stock, net_water):
        return abs(_sf(net_stock)) + abs(_sf(net_water))

    receipt_total = 0.0
    discharge_total = 0.0
    last_closing_stock = 0.0
    last_closing_water = 0.0
    rows = []

    for tx in txs:
        payload = get_shuttle_payload_for_transaction(db, tx.id) or {}
        meta = (payload.get("meta") or {}) if isinstance(payload, dict) else {}
        inputs = (payload.get("inputs") or {}) if isinstance(payload, dict) else {}
        net = ((payload.get("calculated") or {}).get("net") or {}) if isinstance(payload, dict) else {}

        op_code = str(meta.get("vessel_operation_code") or "").strip().upper()
        op_label = str(meta.get("vessel_operation_label") or "").strip()
        op_sign = str(meta.get("vessel_operation_sign") or "").strip().upper()

        event_time = inputs.get("event_time") or ""
        closing_stock = _sf(inputs.get("closing_stock_bbl"))
        closing_water = _sf(inputs.get("closing_water_bbl"))

        net_stock = _sf(net.get("net_stock_bbl"))
        net_water = _sf(net.get("net_water_bbl"))
        qty = _abs_qty(net_stock, net_water)

        if op_code in ("LOADING", "STS_IN", "TOP_UP"):
            receipt_total += qty
        if op_code == "UNLOADING":
            discharge_total += qty

        last_closing_stock = closing_stock
        last_closing_water = closing_water

        rows.append({
            "date": str(tx.operation_date),
            "time": event_time,
            "operation": op_label or op_code,
            "sign": op_sign,
            "net_stock": net_stock,
            "net_water": net_water,
            "qty": qty,
            "ticket": get_transaction_ticket_number(tx),
        })

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Shuttle MTR"

    ws.append(["SHUTTLE VOYAGE MTR"])
    ws.append([f"Location: {loc_code} - {(loc.location_name if loc else '')}"])
    ws.append([f"Shuttle: {asset_code} - {(asset.asset_name if asset else '')}"])
    ws.append([f"Shuttle Number: {shuttle_no}"])
    ws.append([""])

    ws.append(["Status", "Tickets", "Net Receipt (BBL)", "Net Discharge (BBL)", "Last Closing Stock", "Last Closing Water"])
    ws.append(["Approved", len(rows), round(receipt_total, 3), round(discharge_total, 3), round(last_closing_stock, 3), round(last_closing_water, 3)])
    ws.append([""])

    ws.append(["Date", "Time", "Operation", "Sign", "Net Stock", "Net Water", "Qty (Abs S+W)", "Ticket"])
    for r in rows:
        ws.append([r["date"], r["time"], r["operation"], r["sign"], round(r["net_stock"], 3), round(r["net_water"], 3), round(r["qty"], 3), r["ticket"]])

    _xlsx_autofit(ws)

    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)

    filename = f"shuttle_mtr_{loc_code}_{asset_code}_{shuttle_no}.xlsx"
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ----- FSO Tracking -----


@router.get("/fso-tracking", response_model=FSOTrackingResponse)
def get_fso_tracking(
    tab: str | None = "OPEN",
    search: str | None = None,
    page: int = 1,
    page_size: int = 20,
    include_tickets: bool = False,
    group_key: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View FSO Tracking", db)

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

    def _sh_op_code(meta):
        return _norm((meta or {}).get("vessel_operation_code"))

    def _sh_op_label(meta):
        return _norm((meta or {}).get("vessel_operation_label"))

    def _sh_is_unloading(meta):
        code = _sh_op_code(meta)
        if code == "UNLOADING":
            return True
        label = _sh_op_label(meta)
        return ("UNLOADING" in label) or ("UNLOAD" in label)

    def _sh_is_sts_out(meta):
        code = _sh_op_code(meta)
        if code == "STS_OUT":
            return True
        label = _sh_op_label(meta)
        return "STS OUT" in label or "STS_OUT" in label

    def _build_shuttle_discharge_fallback(pairs):
        if not pairs:
            return {}
        voyage_filters = []
        for (loc_code, sh_num) in pairs:
            voyage_filters.append(
                and_(
                    ShuttleVoyage.location_code == loc_code,
                    ShuttleVoyage.shuttle_number == sh_num,
                )
            )
        voyages = (
            db.query(ShuttleVoyage)
            .filter(ShuttleVoyage.status == "CLOSED")
            .filter(or_(*voyage_filters))
            .all()
        )
        latest_voyage = {}
        for v in voyages:
            key = f"{v.location_code}|{v.shuttle_number}"
            cur = latest_voyage.get(key)
            if not cur:
                latest_voyage[key] = v
                continue
            cur_dt = cur.closed_at or datetime.min
            v_dt = v.closed_at or datetime.min
            if v_dt > cur_dt:
                latest_voyage[key] = v

        tx_filters = []
        for _, v in latest_voyage.items():
            tx_filters.append(
                and_(
                    OperationTransaction.origin_location_code == v.location_code,
                    OperationTransaction.convoy_number == v.shuttle_number,
                    OperationTransaction.primary_asset_code == v.shuttle_asset_code,
                )
            )
        if not tx_filters:
            return {}

        payloads = (
            db.query(
                OperationTransaction.origin_location_code,
                OperationTransaction.convoy_number,
                OperationTransactionValue.field_value,
            )
            .join(
                OperationTransactionValue,
                OperationTransactionValue.transaction_id == OperationTransaction.id,
            )
            .filter(
                OperationTransactionValue.field_code == "shuttle_payload",
                OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
                approved_transaction_not_on_correction_hold(db),
            )
            .filter(or_(*tx_filters))
            .all()
        )

        out = {}
        for (loc_code, sh_num, fv) in payloads:
            if not isinstance(fv, dict):
                continue
            meta = fv.get("meta") or {}
            net = ((fv.get("calculated") or {}).get("net") or {})
            net_stock = _sf(net.get("net_stock_bbl"))
            net_water = _sf(net.get("net_water_bbl"))
            qty = _abs_qty(net_stock, net_water)
            if _sh_is_unloading(meta) and (not _sh_is_sts_out(meta)):
                key = f"{loc_code}|{sh_num}"
                out[key] = float(out.get(key, 0.0)) + qty
        return out

    tab_norm = str(tab or "OPEN").strip().upper()
    page = max(int(page or 1), 1)
    page_size = min(max(int(page_size or 20), 1), 200)
    offset_val = (page - 1) * page_size

    base_q = (
        db.query(OperationTransaction)
        .join(
            OperationTransactionValue,
            OperationTransactionValue.transaction_id == OperationTransaction.id,
        )
        .filter(
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
            OperationTransactionValue.field_code == "fso_payload",
        )
    )
    base_q = base_q.filter(OperationTransaction.primary_asset_type_code.ilike("FSO"))

    if group_key:
        parts = [p.strip() for p in str(group_key).split("|")]
        if len(parts) != 3:
            raise HTTPException(status_code=400, detail="Invalid group_key format for FSO tracking")
        g_loc, g_shuttle, g_fso = parts
        base_q = base_q.filter(
            OperationTransaction.origin_location_code == g_loc,
            OperationTransaction.convoy_number == g_shuttle,
            OperationTransaction.primary_asset_code == g_fso,
        )
        include_tickets = True

    if search and str(search).strip():
        s = str(search).strip()
        base_q = base_q.filter(
            or_(
                OperationTransaction.origin_location_code.ilike(f"%{s}%"),
                OperationTransaction.primary_asset_code.ilike(f"%{s}%"),
                OperationTransaction.convoy_number.ilike(f"%{s}%"),
                OperationTransaction.ticket_number.ilike(f"%{s}%"),
            )
        )

    key_loc = OperationTransaction.origin_location_code
    key_shuttle = OperationTransaction.convoy_number
    key_asset = OperationTransaction.primary_asset_code

    voyage_status_expr = func.coalesce(FSOVoyage.status, literal("OPEN")).label("voyage_status")

    group_q = (
        base_q.with_entities(
            key_loc.label("location_code"),
            key_shuttle.label("shuttle_number"),
            key_asset.label("fso_asset_code"),
            func.min(OperationTransaction.operation_date).label("first_date"),
            func.max(OperationTransaction.operation_date).label("last_date"),
            voyage_status_expr,
        )
        .outerjoin(
            FSOVoyage,
            and_(
                FSOVoyage.location_code == key_loc,
                FSOVoyage.shuttle_number == key_shuttle,
                FSOVoyage.fso_asset_code == key_asset,
            ),
        )
        .group_by(key_loc, key_shuttle, key_asset, voyage_status_expr)
    )

    if tab_norm == "CLOSED":
        group_q = group_q.filter(voyage_status_expr == "CLOSED")
    else:
        group_q = group_q.filter(voyage_status_expr != "CLOSED")

    total_groups = group_q.count()

    group_rows = (
        group_q.order_by(func.max(OperationTransaction.operation_date).desc(), key_loc.asc())
        .offset(offset_val)
        .limit(page_size)
        .all()
    )

    if not group_rows:
        return {
            "rows": [],
            "total_groups": total_groups,
            "page": page,
            "page_size": page_size,
            "has_more": total_groups > offset_val + page_size,
        }

    keys = [(r.location_code, r.shuttle_number, r.fso_asset_code) for r in group_rows]

    if not include_tickets:
        key_filters = []
        for (loc_code, sh_num, fso_code) in keys:
            key_filters.append(
                and_(
                    OperationTransaction.origin_location_code == loc_code,
                    OperationTransaction.convoy_number == sh_num,
                    OperationTransaction.primary_asset_code == fso_code,
                )
            )

        payload_rows = (
            db.query(
                OperationTransaction.origin_location_code,
                OperationTransaction.convoy_number,
                OperationTransaction.primary_asset_code,
                OperationTransactionValue.field_value,
            )
            .join(OperationTransactionValue, OperationTransactionValue.transaction_id == OperationTransaction.id)
            .filter(
                OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
                approved_transaction_not_on_correction_hold(db),
                OperationTransactionValue.field_code == "fso_payload",
            )
            .filter(or_(*key_filters))
            .all()
        )

        def _norm_l(v):
            return str(v or "").strip().lower()

        totals_map = {}
        for (loc_code, sh_num, fso_code, fv) in payload_rows:
            k = f"{loc_code}|{sh_num}|{fso_code}"
            if k not in totals_map:
                totals_map[k] = {
                    "receipts": 0.0, "exports": 0.0, "water_in": 0.0, "water_out": 0.0,
                    "loss_gain": 0.0, "variance": 0.0, "shuttle_discharge_meta": 0.0, "fso_receipt_bbl": 0.0,
                }
            if not isinstance(fv, dict):
                continue
            meta = fv.get("meta") or {}
            op_label = meta.get("operation_label") or meta.get("operation") or ""
            op_norm = _norm_l(op_label)
            inputs = fv.get("inputs") or {}
            net = ((fv.get("calculated") or {}).get("net") or {})
            op_sign = _norm(meta.get("operation_sign"))
            net_stock = _sf(net.get("net_stock_bbl"))
            net_water = _sf(net.get("net_water_bbl"))
            vessel_qty = _sf(inputs.get("vessel_quantity_bbl") or meta.get("vessel_quantity_bbl"))
            variance = _sf(net.get("variance_bbl") or meta.get("variance_bbl"))

            qty_bbl = _abs_qty(net_stock, net_water)
            if op_sign == "IN":
                totals_map[k]["fso_receipt_bbl"] += qty_bbl
                totals_map[k]["shuttle_discharge_meta"] += _sf(meta.get("source_shuttle_discharge_bbl"))

            if op_norm == "receipt":
                totals_map[k]["receipts"] += max(net_stock, 0.0)
            elif op_norm == "export":
                totals_map[k]["exports"] += abs(net_stock)
            elif op_norm == "stock opening":
                totals_map[k]["loss_gain"] += net_stock

            if net_water > 0:
                totals_map[k]["water_in"] += net_water
            elif net_water < 0:
                totals_map[k]["water_out"] += abs(net_water)

            if op_norm != "export":
                if abs(variance) > 0:
                    totals_map[k]["variance"] += variance
                else:
                    totals_map[k]["variance"] += (abs(net_stock) - vessel_qty)

        rows = []
        shuttle_fallback = _build_shuttle_discharge_fallback(
            list({(loc_code, sh_num) for (loc_code, sh_num, _) in keys})
        )
        for r in group_rows:
            loc = db.query(Location).filter(Location.location_code.ilike(r.location_code)).first()
            fso_asset = db.query(Asset).filter(Asset.asset_code.ilike(r.fso_asset_code)).first()
            voyage = get_fso_voyage_by_key(db, r.location_code, r.shuttle_number, r.fso_asset_code)

            k = f"{r.location_code}|{r.shuttle_number}|{r.fso_asset_code}"
            t = totals_map.get(k, {
                "receipts": 0, "exports": 0, "water_in": 0, "water_out": 0,
                "loss_gain": 0, "variance": 0, "shuttle_discharge_meta": 0, "fso_receipt_bbl": 0,
            })
            net_water_val = float(t["water_in"]) - float(t["water_out"])
            shuttle_discharge_meta = float(t.get("shuttle_discharge_meta") or 0.0)
            fallback = float(shuttle_fallback.get(f"{r.location_code}|{r.shuttle_number}", 0.0))
            shuttle_discharge_bbl = shuttle_discharge_meta if shuttle_discharge_meta > 0 else fallback
            fso_receipt_bbl = float(t.get("fso_receipt_bbl") or 0.0)
            variance_bbl = fso_receipt_bbl - shuttle_discharge_bbl

            rows.append({
                "group_key": k,
                "location_code": r.location_code,
                "location_name": loc.location_name if loc else "",
                "shuttle_number": r.shuttle_number or "",
                "fso_asset_code": r.fso_asset_code or "",
                "fso_asset_name": fso_asset.asset_name if fso_asset else "",
                "voyage_status": (voyage.status if voyage else "OPEN"),
                "closed_by": (voyage.closed_by if voyage else None),
                "closed_at": (voyage.closed_at if voyage else None),
                "closure_remarks": (voyage.closure_remarks if voyage else None),
                "total_receipts_bbl": float(t["receipts"]),
                "total_exports_bbl": float(t["exports"]),
                "total_water_in_bbl": float(t["water_in"]),
                "total_water_out_bbl": float(t["water_out"]),
                "net_water_bbl": net_water_val,
                "loss_gain_bbl": float(t["loss_gain"]),
                "total_variance_bbl": float(t["variance"]),
                "shuttle_discharge_bbl": float(shuttle_discharge_bbl),
                "fso_receipt_bbl": float(fso_receipt_bbl),
                "variance_bbl": float(variance_bbl),
                "tickets": [],
            })

        return {
            "rows": rows,
            "total_groups": total_groups,
            "page": page,
            "page_size": page_size,
            "has_more": total_groups > offset_val + page_size,
        }

    key_filters = []
    for (loc_code, sh_num, fso_code) in keys:
        key_filters.append(
            and_(
                OperationTransaction.origin_location_code == loc_code,
                OperationTransaction.convoy_number == sh_num,
                OperationTransaction.primary_asset_code == fso_code,
            )
        )

    tx_rows = (
        db.query(OperationTransaction)
        .join(OperationTransactionValue, OperationTransactionValue.transaction_id == OperationTransaction.id)
        .filter(
            OperationTransactionValue.field_code == "fso_payload",
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
        )
        .filter(or_(*key_filters))
        .order_by(OperationTransaction.operation_date.asc(), OperationTransaction.id.asc())
        .all()
    )

    groups = {}
    for r in group_rows:
        k = f"{r.location_code}|{r.shuttle_number}|{r.fso_asset_code}"
        loc = db.query(Location).filter(Location.location_code.ilike(r.location_code)).first()
        fso_asset = db.query(Asset).filter(Asset.asset_code.ilike(r.fso_asset_code)).first()
        voyage = get_fso_voyage_by_key(db, r.location_code, r.shuttle_number, r.fso_asset_code)

        groups[k] = {
            "group_key": k,
            "location_code": r.location_code,
            "location_name": loc.location_name if loc else "",
            "shuttle_number": r.shuttle_number or "",
            "fso_asset_code": r.fso_asset_code or "",
            "fso_asset_name": fso_asset.asset_name if fso_asset else "",
            "voyage_status": (voyage.status if voyage else "OPEN"),
            "closed_by": (voyage.closed_by if voyage else None),
            "closed_at": (voyage.closed_at if voyage else None),
            "closure_remarks": (voyage.closure_remarks if voyage else None),
            "tickets": [],
            "total_receipts_bbl": 0.0,
            "total_exports_bbl": 0.0,
            "total_water_in_bbl": 0.0,
            "total_water_out_bbl": 0.0,
            "net_water_bbl": 0.0,
            "loss_gain_bbl": 0.0,
            "total_variance_bbl": 0.0,
            "shuttle_discharge_bbl": 0.0,
            "fso_receipt_bbl": 0.0,
            "variance_bbl": 0.0,
        }

    def _safe_float(v):
        try:
            return float(v or 0.0)
        except Exception:
            return 0.0

    def _norm_op(v):
        return str(v or "").strip().lower()

    for tx in tx_rows:
        payload = get_fso_payload_for_transaction(db, tx.id) or {}
        meta = payload.get("meta") or {}
        calcs = payload.get("calculated") or {}
        net_calc = (calcs.get("net") or {}) if isinstance(calcs, dict) else {}

        loc_code = tx.origin_location_code or ""
        sh_num = tx.convoy_number or ""
        fso_code = tx.primary_asset_code or ""
        k = f"{loc_code}|{sh_num}|{fso_code}"

        if k not in groups:
            continue

        op_label = meta.get("operation_label") or meta.get("operation") or ""
        op_norm = _norm_op(op_label)

        opening_stock = _safe_float(meta.get("opening_stock_bbl"))
        opening_water = _safe_float(meta.get("opening_water_bbl"))
        closing_stock = _safe_float(meta.get("closing_stock_bbl"))
        closing_water = _safe_float(meta.get("closing_water_bbl"))
        net_stock = _safe_float(meta.get("net_stock_bbl"))
        net_water = _safe_float(meta.get("net_water_bbl"))
        vessel_qty = _safe_float(meta.get("vessel_quantity_bbl"))
        variance = _safe_float(meta.get("variance_bbl"))

        ticket = {
            "transaction_id": tx.id,
            "ticket_number": get_transaction_ticket_number(tx),
            "operation_number": tx.operation_ticket_number or tx.operation_number,
            "location_code": loc_code,
            "location_name": groups[k]["location_name"],
            "shuttle_number": sh_num,
            "fso_asset_code": fso_code,
            "fso_asset_name": groups[k]["fso_asset_name"],
            "product_name": tx.product_name,
            "operation_date": tx.operation_date,
            "event_time": meta.get("event_time"),
            "operation_label": op_label,
            "vessel_name": meta.get("vessel_name"),
            "vessel_quantity_bbl": vessel_qty,
            "opening_stock_bbl": opening_stock,
            "opening_water_bbl": opening_water,
            "closing_stock_bbl": closing_stock,
            "closing_water_bbl": closing_water,
            "net_stock_bbl": net_stock,
            "net_water_bbl": net_water,
            "variance_bbl": variance,
            "remarks": meta.get("remarks") or tx.remarks,
            "status": tx.status,
            "created_by": tx.created_by,
            "created_at": tx.created_at,
            "updated_at": tx.updated_at,
        }

        groups[k]["tickets"].append(ticket)

        op_sign = _norm(meta.get("operation_sign"))
        qty_bbl = _abs_qty(_safe_float(net_calc.get("net_stock_bbl")), _safe_float(net_calc.get("net_water_bbl")))
        if op_sign == "IN":
            groups[k]["fso_receipt_bbl"] += qty_bbl
            groups[k]["shuttle_discharge_bbl"] += _safe_float(meta.get("source_shuttle_discharge_bbl"))

        if op_norm == "receipt":
            groups[k]["total_receipts_bbl"] += max(net_stock, 0.0)
        elif op_norm == "export":
            groups[k]["total_exports_bbl"] += abs(net_stock)
        elif op_norm == "stock opening":
            groups[k]["loss_gain_bbl"] += net_stock

        if net_water > 0:
            groups[k]["total_water_in_bbl"] += net_water
        elif net_water < 0:
            groups[k]["total_water_out_bbl"] += abs(net_water)

        if op_norm != "export":
            if abs(variance) > 0:
                groups[k]["total_variance_bbl"] += variance
            else:
                groups[k]["total_variance_bbl"] += (abs(net_stock) - vessel_qty)

    for k in groups:
        groups[k]["net_water_bbl"] = groups[k]["total_water_in_bbl"] - groups[k]["total_water_out_bbl"]

    shuttle_fallback = _build_shuttle_discharge_fallback(
        list({(r.location_code, r.shuttle_number) for r in group_rows})
    )
    for k in groups:
        loc_code = str(groups[k].get("location_code") or "").strip()
        sh_num = str(groups[k].get("shuttle_number") or "").strip()
        if float(groups[k].get("shuttle_discharge_bbl") or 0.0) <= 0.0:
            groups[k]["shuttle_discharge_bbl"] = float(shuttle_fallback.get(f"{loc_code}|{sh_num}", 0.0))
        groups[k]["variance_bbl"] = float(groups[k]["fso_receipt_bbl"]) - float(groups[k]["shuttle_discharge_bbl"])

    return {
        "rows": list(groups.values()),
        "total_groups": total_groups,
        "page": page,
        "page_size": page_size,
        "has_more": total_groups > offset_val + page_size,
    }


# ----- Shuttle Summary Helper -----


def build_shuttle_summary_rows(
    db: Session,
    date_from: date | None = None,
    date_to: date | None = None,
    location_code: str | None = None,
    shuttle_number: str | None = None,
    shuttle_asset_code: str | None = None,
    tab: str | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 20,
):
    def _norm(v):
        return str(v or "").strip().upper()

    def _abs_qty(net_stock, net_water):
        try:
            return abs(float(net_stock or 0.0)) + abs(float(net_water or 0.0))
        except Exception:
            return 0.0

    def _op_code(meta):
        return _norm(meta.get("vessel_operation_code"))

    def _op_label(meta):
        return _norm(meta.get("vessel_operation_label"))

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

    lc = clean_optional_text(location_code)
    sn = clean_optional_text(shuttle_number)
    ac = clean_optional_text(shuttle_asset_code)

    tab_norm = (clean_optional_text(tab) or "OPEN").upper()
    search_norm = (clean_optional_text(search) or "").strip()

    page = 1 if page is None or page < 1 else page
    page_size = 20 if page_size is None or page_size < 1 else min(int(page_size), 200)
    offset_val = (page - 1) * page_size

    base_q = (
        db.query(OperationTransaction)
        .join(
            OperationTransactionValue,
            OperationTransactionValue.transaction_id == OperationTransaction.id,
        )
        .filter(
            OperationTransactionValue.field_code == "shuttle_payload",
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
        )
    )

    if date_from:
        base_q = base_q.filter(OperationTransaction.operation_date >= date_from)
    if date_to:
        base_q = base_q.filter(OperationTransaction.operation_date <= date_to)
    if lc:
        base_q = base_q.filter(OperationTransaction.origin_location_code.ilike(lc))
    if sn:
        base_q = base_q.filter(OperationTransaction.convoy_number.ilike(sn))
    if ac:
        base_q = base_q.filter(OperationTransaction.primary_asset_code.ilike(ac))

    if search_norm:
        like = f"%{search_norm}%"
        base_q = base_q.filter(
            or_(
                OperationTransaction.origin_location_code.ilike(like),
                OperationTransaction.convoy_number.ilike(like),
                OperationTransaction.primary_asset_code.ilike(like),
                OperationTransaction.operation_number.ilike(like),
                OperationTransaction.operation_ticket_number.ilike(like),
                OperationTransaction.product_name.ilike(like),
            )
        )

    voyage_status_expr = func.coalesce(ShuttleVoyage.status, literal("OPEN"))

    key_loc = OperationTransaction.origin_location_code
    key_shuttle = OperationTransaction.convoy_number
    key_asset = OperationTransaction.primary_asset_code

    group_q = (
        base_q.with_entities(
            key_loc.label("location_code"),
            key_shuttle.label("shuttle_number"),
            key_asset.label("shuttle_asset_code"),
            func.min(OperationTransaction.operation_date).label("first_date"),
            func.max(OperationTransaction.operation_date).label("last_date"),
        )
        .outerjoin(
            ShuttleVoyage,
            and_(
                ShuttleVoyage.location_code == key_loc,
                ShuttleVoyage.shuttle_number == key_shuttle,
                ShuttleVoyage.shuttle_asset_code == key_asset,
            ),
        )
        .group_by(key_loc, key_shuttle, key_asset, voyage_status_expr)
    )

    if tab_norm == "CLOSED":
        group_q = group_q.filter(voyage_status_expr == "CLOSED")
    else:
        group_q = group_q.filter(voyage_status_expr != "CLOSED")

    total_groups = group_q.count()

    group_rows = (
        group_q.order_by(func.max(OperationTransaction.operation_date).desc(), key_loc.asc())
        .offset(offset_val)
        .limit(page_size)
        .all()
    )

    if not group_rows:
        return {
            "rows": [],
            "total_groups": total_groups,
            "page": page,
            "page_size": page_size,
            "has_more": total_groups > offset_val + page_size,
        }

    keys = [(r.location_code, r.shuttle_number, r.shuttle_asset_code) for r in group_rows]

    key_filters = []
    for (loc_code, sh_num, asset_code) in keys:
        key_filters.append(
            and_(
                OperationTransaction.origin_location_code == loc_code,
                OperationTransaction.convoy_number == sh_num,
                OperationTransaction.primary_asset_code == asset_code,
            )
        )

    payload_rows = (
        db.query(
            OperationTransaction.origin_location_code,
            OperationTransaction.convoy_number,
            OperationTransaction.primary_asset_code,
            OperationTransactionValue.field_value,
        )
        .join(
            OperationTransactionValue,
            OperationTransactionValue.transaction_id == OperationTransaction.id,
        )
        .filter(
            OperationTransactionValue.field_code == "shuttle_payload",
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
        )
        .filter(or_(*key_filters))
        .all()
    )

    totals_map = {}
    for (loc_code, sh_num, asset_code, field_value) in payload_rows:
        k = f"{loc_code}|{sh_num}|{asset_code}"
        if k not in totals_map:
            totals_map[k] = {"net_receipt_bbl": 0.0, "net_discharge_bbl": 0.0}

        if isinstance(field_value, dict):
            fv = field_value
            meta = fv.get("meta") or {}
            net = ((fv.get("calculated") or {}).get("net") or {})
            net_stock = float(safe_float(net.get("net_stock_bbl")))
            net_water = float(safe_float(net.get("net_water_bbl")))
            qty_bbl = _abs_qty(net_stock, net_water)
            if (_is_loading(meta) or _is_sts_in(meta) or _is_top_up(meta)) and (not _is_unloading(meta)):
                totals_map[k]["net_receipt_bbl"] += qty_bbl
            if _is_unloading(meta) and not _is_sts_out(meta):
                totals_map[k]["net_discharge_bbl"] += qty_bbl

    rows = []
    for (loc_code, sh_num, asset_code) in keys:
        asset = get_asset_by_code(asset_code, db)
        loc = get_location_by_code(loc_code, db)
        voyage = get_shuttle_voyage_by_key(db, loc_code, sh_num or "", asset_code)

        k = f"{loc_code}|{sh_num}|{asset_code}"
        t = totals_map.get(k, {"net_receipt_bbl": 0.0, "net_discharge_bbl": 0.0})

        rows.append({
            "group_key": k,
            "location_code": loc_code,
            "location_name": loc.location_name if loc else "",
            "shuttle_number": sh_num or "",
            "shuttle_asset_code": asset_code,
            "shuttle_asset_name": asset.asset_name if asset else "",
            "voyage_status": voyage.status if voyage else "OPEN",
            "closed_by": voyage.closed_by if voyage else None,
            "closed_at": voyage.closed_at if voyage else None,
            "closure_remarks": voyage.closure_remarks if voyage else None,
            "net_receipt_bbl": float(t["net_receipt_bbl"]),
            "net_discharge_bbl": float(t["net_discharge_bbl"]),
        })

    return {
        "rows": rows,
        "total_groups": total_groups,
        "page": page,
        "page_size": page_size,
        "has_more": total_groups > offset_val + page_size,
    }
