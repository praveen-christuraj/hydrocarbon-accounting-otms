from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import MovementMapping, MovementMappingItem, MovementMappingComparison, OperationTransaction, OperationTransactionValue, Asset, User
from app.schemas import MovementMappingCreate, MovementMappingResponse, MovementMappingItemAddRequest
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import safe_float, clean_optional_text, get_transaction_ticket_number

router = APIRouter(prefix="/movement-mappings", tags=["Movement Mappings"])


def extract_transaction_quantities(db: Session, transaction: OperationTransaction):
    payload_row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction.id,
            OperationTransactionValue.field_code == "multi_tank_payload",
        )
        .first()
    )

    if payload_row and isinstance(payload_row.field_value, dict):
        net = (((payload_row.field_value or {}).get("calculated") or {}).get("net") or {})
        qty = abs(safe_float(net.get("TOV")))
        water = abs(safe_float(net.get("FW")))
        nsv = abs(safe_float(net.get("NSV")))
        return qty, water, nsv

    payload_row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction.id,
            OperationTransactionValue.field_code == "shuttle_payload",
        )
        .first()
    )

    if payload_row and isinstance(payload_row.field_value, dict):
        net = (((payload_row.field_value or {}).get("calculated") or {}).get("net") or {})
        qty = abs(safe_float(net.get("TOV")))
        water = abs(safe_float(net.get("FW")))
        nsv = abs(safe_float(net.get("NSV")))
        return qty, water, nsv

    def get_val(code):
        row = (
            db.query(OperationTransactionValue)
            .filter(
                OperationTransactionValue.transaction_id == transaction.id,
                OperationTransactionValue.field_code == code,
            )
            .first()
        )
        if not row:
            return None
        return row.field_value

    qty = safe_float(get_val("quantity_bbl") or get_val("gross_qty_bbl"))
    water = safe_float(get_val("water_bbl"))
    nsv = safe_float(get_val("nsv_bbl"))
    if qty or water or nsv:
        return abs(qty), abs(water), abs(nsv)

    net_stock = safe_float(get_val("net_stock"))
    net_water = safe_float(get_val("net_water"))
    net_nsv = safe_float(get_val("net_nsv"))
    if net_stock or net_water or net_nsv:
        return abs(net_stock), abs(net_water), abs(net_nsv)

    return 0, 0, 0


def recompute_mapping_comparison(db: Session, mapping_id: int):
    items = db.query(MovementMappingItem).filter(MovementMappingItem.mapping_id == mapping_id).all()

    source = [i for i in items if str(i.role).upper() == "SOURCE"]
    target = [i for i in items if str(i.role).upper() == "TARGET"]

    source_qty = sum(safe_float(i.qty_bbl) for i in source)
    source_water = sum(safe_float(i.water_bbl) for i in source)
    source_nsv = sum(safe_float(i.nsv_bbl) for i in source)

    target_qty = sum(safe_float(i.qty_bbl) for i in target)
    target_water = sum(safe_float(i.water_bbl) for i in target)
    target_nsv = sum(safe_float(i.nsv_bbl) for i in target)

    diff_nsv = target_nsv - source_nsv
    diff_pct = (diff_nsv / source_nsv * 100) if source_nsv else 0

    summary = {
        "source": {"qty_bbl": source_qty, "water_bbl": source_water, "nsv_bbl": source_nsv},
        "target": {"qty_bbl": target_qty, "water_bbl": target_water, "nsv_bbl": target_nsv},
        "diff": {"nsv_bbl": diff_nsv, "nsv_percent": diff_pct},
    }

    cmp_row = db.query(MovementMappingComparison).filter(MovementMappingComparison.mapping_id == mapping_id).first()
    if not cmp_row:
        cmp_row = MovementMappingComparison(mapping_id=mapping_id)
        db.add(cmp_row)

    cmp_row.source_qty_bbl = source_qty
    cmp_row.source_water_bbl = source_water
    cmp_row.source_nsv_bbl = source_nsv

    cmp_row.target_qty_bbl = target_qty
    cmp_row.target_water_bbl = target_water
    cmp_row.target_nsv_bbl = target_nsv

    cmp_row.diff_nsv_bbl = diff_nsv
    cmp_row.diff_nsv_percent = diff_pct

    cmp_row.summary_json = summary
    cmp_row.updated_at = datetime.now()

    db.flush()
    return cmp_row


def build_mapping_response(db: Session, mapping: MovementMapping):
    items = db.query(MovementMappingItem).filter(MovementMappingItem.mapping_id == mapping.id).order_by(MovementMappingItem.id.asc()).all()
    cmp_row = db.query(MovementMappingComparison).filter(MovementMappingComparison.mapping_id == mapping.id).first()

    return {
        "id": mapping.id,
        "mapping_type": mapping.mapping_type,
        "location_code": mapping.location_code,
        "reference_number": mapping.reference_number,
        "product_name": mapping.product_name,
        "status": mapping.status,
        "remarks": mapping.remarks,
        "created_by": mapping.created_by,
        "closed_by": mapping.closed_by,
        "closed_at": mapping.closed_at,
        "created_at": mapping.created_at,
        "updated_at": mapping.updated_at,
        "items": items,
        "comparison": cmp_row,
    }


def normalize_code(value: str):
    if not value:
        return ""
    return value.strip().upper()


@router.get("", response_model=list[MovementMappingResponse])
def list_movement_mappings(
    mapping_type: str | None = None,
    location_code: str | None = None,
    reference_number: str | None = None,
    status: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Movement Mapping", db)

    q = db.query(MovementMapping)

    if clean_optional_text(mapping_type):
        q = q.filter(MovementMapping.mapping_type.ilike(mapping_type))

    if clean_optional_text(location_code):
        q = q.filter(MovementMapping.location_code.ilike(location_code))

    if clean_optional_text(reference_number):
        q = q.filter(MovementMapping.reference_number.ilike(reference_number))

    if clean_optional_text(status):
        q = q.filter(MovementMapping.status.ilike(status))

    rows = q.order_by(MovementMapping.created_at.desc(), MovementMapping.id.desc()).all()
    return [build_mapping_response(db, r) for r in rows]


@router.get("/{mapping_id}", response_model=MovementMappingResponse)
def get_movement_mapping(
    mapping_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Movement Mapping", db)

    m = db.query(MovementMapping).filter(MovementMapping.id == mapping_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapping not found")

    return build_mapping_response(db, m)


@router.post("", response_model=MovementMappingResponse)
def create_movement_mapping(
    request: MovementMappingCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Movement Mapping", db)

    created_by = (
        f"{current_user.full_name} ({current_user.username})"
        if current_user.full_name
        else current_user.username
    )

    m = MovementMapping(
        mapping_type=normalize_code(request.mapping_type),
        location_code=normalize_code(request.location_code),
        reference_number=str(request.reference_number or "").strip(),
        product_name=clean_optional_text(request.product_name),
        remarks=clean_optional_text(request.remarks),
        status="OPEN",
        created_by=created_by,
        updated_at=datetime.now(),
    )

    db.add(m)
    create_audit_log(
        db=db,
        module_name="Operations",
        action="Create Movement Mapping",
        current_user=current_user,
        entity_type="MovementMapping",
        entity_id=None,
        entity_label=f"{m.mapping_type} | {m.location_code} | {m.reference_number}",
        remarks="Movement mapping created",
        request_path="/movement-mappings",
        details={
            "mapping_type": m.mapping_type,
            "location_code": m.location_code,
            "reference_number": m.reference_number,
            "product_name": m.product_name,
            "status": m.status,
        },
    )
    db.commit()
    db.refresh(m)

    return build_mapping_response(db, m)


@router.post("/{mapping_id}/items", response_model=MovementMappingResponse)
def add_mapping_items(
    mapping_id: int,
    request: MovementMappingItemAddRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Movement Mapping", db)

    mapping = db.query(MovementMapping).filter(MovementMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")

    if str(mapping.status).upper() == "CLOSED":
        raise HTTPException(status_code=400, detail="Mapping is CLOSED")

    role = normalize_code(request.role)
    if role not in ["SOURCE", "TARGET"]:
        raise HTTPException(status_code=400, detail="role must be SOURCE or TARGET")

    added_transaction_ids = []
    skipped_transaction_ids = []
    for tid in request.transaction_ids:
        tx = db.query(OperationTransaction).filter(OperationTransaction.id == tid).first()
        if not tx:
            raise HTTPException(status_code=404, detail=f"Transaction {tid} not found")

        if tx.status != "Approved":
            raise HTTPException(status_code=400, detail=f"Only Approved transactions can be mapped (ticket {tid})")

        exists = db.query(MovementMappingItem).filter(
            MovementMappingItem.mapping_id == mapping_id,
            MovementMappingItem.transaction_id == tid,
        ).first()
        if exists:
            skipped_transaction_ids.append(tid)
            continue

        qty, water, nsv = extract_transaction_quantities(db, tx)

        asset_type_code = None
        asset = db.query(Asset).filter(Asset.asset_code.ilike(tx.primary_asset_code)).first()
        if asset:
            asset_type_code = asset.asset_type_code

        item = MovementMappingItem(
            mapping_id=mapping_id,
            transaction_id=tid,
            role=role,
            asset_code=tx.primary_asset_code,
            asset_type_code=asset_type_code,
            ticket_number=get_transaction_ticket_number(tx),
            operation_date=tx.operation_date,
            qty_bbl=qty,
            water_bbl=water,
            nsv_bbl=nsv,
        )
        db.add(item)
        added_transaction_ids.append(tid)

    db.flush()
    recompute_mapping_comparison(db, mapping_id)

    mapping.updated_at = datetime.now()
    create_audit_log(
        db=db,
        module_name="Operations",
        action="Add Movement Mapping Items",
        current_user=current_user,
        entity_type="MovementMapping",
        entity_id=mapping.id,
        entity_label=f"{mapping.mapping_type} | {mapping.location_code} | {mapping.reference_number}",
        remarks="Movement mapping items added",
        request_path=f"/movement-mappings/{mapping_id}/items",
        details={
            "role": role,
            "requested_transaction_ids": request.transaction_ids,
            "added_transaction_ids": added_transaction_ids,
            "skipped_existing_transaction_ids": skipped_transaction_ids,
        },
    )
    db.commit()
    db.refresh(mapping)

    return build_mapping_response(db, mapping)


@router.delete("/{mapping_id}/items/{item_id}", response_model=MovementMappingResponse)
def remove_mapping_item(
    mapping_id: int,
    item_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Movement Mapping", db)

    mapping = db.query(MovementMapping).filter(MovementMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")

    if str(mapping.status).upper() == "CLOSED":
        raise HTTPException(status_code=400, detail="Mapping is CLOSED")

    item = db.query(MovementMappingItem).filter(
        MovementMappingItem.id == item_id,
        MovementMappingItem.mapping_id == mapping_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    db.delete(item)
    db.flush()

    recompute_mapping_comparison(db, mapping_id)

    mapping.updated_at = datetime.now()
    create_audit_log(
        db=db,
        module_name="Operations",
        action="Remove Movement Mapping Item",
        current_user=current_user,
        entity_type="MovementMapping",
        entity_id=mapping.id,
        entity_label=f"{mapping.mapping_type} | {mapping.location_code} | {mapping.reference_number}",
        remarks="Movement mapping item removed",
        request_path=f"/movement-mappings/{mapping_id}/items/{item_id}",
        details={
            "removed_item_id": item_id,
            "removed_transaction_id": item.transaction_id,
            "removed_role": item.role,
            "removed_ticket_number": item.ticket_number,
        },
    )
    db.commit()
    db.refresh(mapping)

    return build_mapping_response(db, mapping)


@router.post("/{mapping_id}/close", response_model=MovementMappingResponse)
def close_mapping(
    mapping_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Movement Mapping", db)

    mapping = db.query(MovementMapping).filter(MovementMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")

    if str(mapping.status).upper() == "CLOSED":
        return build_mapping_response(db, mapping)

    mapping.status = "CLOSED"
    mapping.closed_by = (
        f"{current_user.full_name} ({current_user.username})"
        if current_user.full_name
        else current_user.username
    )
    mapping.closed_at = datetime.now()
    mapping.updated_at = datetime.now()

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Close Movement Mapping",
        current_user=current_user,
        entity_type="MovementMapping",
        entity_id=mapping.id,
        entity_label=f"{mapping.mapping_type} | {mapping.location_code} | {mapping.reference_number}",
        old_status="OPEN",
        new_status="CLOSED",
        remarks="Movement mapping closed",
        request_path=f"/movement-mappings/{mapping_id}/close",
        details={
            "mapping_type": mapping.mapping_type,
            "location_code": mapping.location_code,
            "reference_number": mapping.reference_number,
            "closed_by": mapping.closed_by,
            "closed_at": mapping.closed_at.isoformat() if mapping.closed_at else None,
        },
    )

    db.commit()
    db.refresh(mapping)

    return build_mapping_response(db, mapping)
