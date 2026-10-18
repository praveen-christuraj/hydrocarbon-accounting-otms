from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import MovementMapping, MovementMappingItem, MovementMappingComparison, OperationTransaction, OperationTransactionValue, Asset, User
from app.schemas import (
    MovementMappingCreate,
    MovementMappingUpdate,
    MovementMappingResponse,
    MovementMappingItemAddRequest,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    apply_location_filter,
    ensure_location_in_user_scope,
    require_user_permission,
)
from app.services.audit_service import create_audit_log
from app.utils.helpers import safe_float, clean_optional_text, get_transaction_ticket_number

router = APIRouter(prefix="/movement-mappings", tags=["Movement Mappings"])
MAPPING_TYPES = {"BARGE_TO_SHUTTLE", "SHUTTLE_TO_FSO", "BARGE_TO_FSO"}


def optional_float(value):
    if value is None or str(value).strip() == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def extract_transaction_quantities(db: Session, transaction: OperationTransaction):
    """Read the movement-volume snapshots from the approved transaction.

    ``qty_bbl`` remains the existing TOV/volume measure for compatibility.
    GSV is kept separate; legacy layouts that do not supply a GSV remain NULL
    instead of being incorrectly presented as zero or as TOV.
    """
    def get_val(code):
        row = (
            db.query(OperationTransactionValue)
            .filter(
                OperationTransactionValue.transaction_id == transaction.id,
                OperationTransactionValue.field_code == code,
            )
            .first()
        )
        return row.field_value if row else None

    for field_code in ("multi_tank_payload", "shuttle_payload"):
        payload_row = (
            db.query(OperationTransactionValue)
            .filter(
                OperationTransactionValue.transaction_id == transaction.id,
                OperationTransactionValue.field_code == field_code,
            )
            .first()
        )
        payload = payload_row.field_value if payload_row else None
        if isinstance(payload, str):
            try:
                import json
                payload = json.loads(payload)
            except (TypeError, ValueError):
                payload = None
        if isinstance(payload, dict):
            calculated = payload.get("calculated") or {}
            net = calculated.get("net") or {}
            qty = abs(safe_float(net.get("TOV") or net.get("net_stock_bbl")))
            water = abs(safe_float(net.get("FW") or net.get("net_water_bbl")))
            nsv = abs(safe_float(net.get("NSV") or net.get("net_nsv_bbl")))
            gsv = optional_float(net.get("GSV") or net.get("gsv_bbl"))
            return qty, water, abs(gsv) if gsv is not None else None, nsv

    qty_value = get_val("quantity_bbl")
    if qty_value is None or str(qty_value).strip() == "":
        qty_value = get_val("gross_qty_bbl")
    if qty_value is None or str(qty_value).strip() == "":
        qty_value = get_val("tov_bbl")
    qty = abs(safe_float(qty_value))

    water_value = get_val("free_water_bbl")
    if water_value is None or str(water_value).strip() == "":
        water_value = get_val("water_bbl")
    if water_value is None or str(water_value).strip() == "":
        water_value = get_val("fw_bbl")
    water = abs(safe_float(water_value))

    gsv_value = get_val("gsv_bbl")
    if gsv_value is None or str(gsv_value).strip() == "":
        gsv_value = get_val("gross_standard_volume_bbl")
    gsv = optional_float(gsv_value)

    nsv_value = get_val("nsv_bbl")
    if nsv_value is None or str(nsv_value).strip() == "":
        nsv_value = get_val("net_nsv")
    nsv = abs(safe_float(nsv_value))

    if not (qty or water or nsv or gsv is not None):
        net_stock = safe_float(get_val("net_stock"))
        net_water = safe_float(get_val("net_water"))
        net_nsv = safe_float(get_val("net_nsv"))
        if net_stock or net_water or net_nsv:
            return abs(net_stock), abs(net_water), None, abs(net_nsv)

    return qty, water, abs(gsv) if gsv is not None else None, nsv


def sum_optional(items, key):
    """Return a complete aggregate or NULL when any ticket lacks the value."""
    values = [optional_float(getattr(item, key, None)) for item in items]
    if not values or any(value is None for value in values):
        return None
    return sum(values)


def difference_and_percent(source, target):
    if source is None or target is None:
        return None, None
    difference = target - source
    if source:
        percent = difference / source * 100
    else:
        percent = 0 if difference == 0 else None
    return difference, percent


def recompute_mapping_comparison(db: Session, mapping_id: int):
    items = db.query(MovementMappingItem).filter(MovementMappingItem.mapping_id == mapping_id).all()

    source = [item for item in items if str(item.role).upper() == "SOURCE"]
    target = [item for item in items if str(item.role).upper() == "TARGET"]

    source_qty = sum(safe_float(item.qty_bbl) for item in source)
    source_gsv = sum_optional(source, "gsv_bbl")
    source_water = sum(safe_float(item.water_bbl) for item in source)
    source_nsv = sum(safe_float(item.nsv_bbl) for item in source)

    target_qty = sum(safe_float(item.qty_bbl) for item in target)
    target_gsv = sum_optional(target, "gsv_bbl")
    target_water = sum(safe_float(item.water_bbl) for item in target)
    target_nsv = sum(safe_float(item.nsv_bbl) for item in target)

    diff_nsv, diff_nsv_percent = difference_and_percent(source_nsv, target_nsv)
    diff_qty, diff_qty_percent = difference_and_percent(source_qty, target_qty)
    diff_gsv, diff_gsv_percent = difference_and_percent(source_gsv, target_gsv)
    diff_water, diff_water_percent = difference_and_percent(source_water, target_water)

    summary = {
        "source": {
            "qty_bbl": source_qty,
            "gsv_bbl": source_gsv,
            "water_bbl": source_water,
            "nsv_bbl": source_nsv,
        },
        "target": {
            "qty_bbl": target_qty,
            "gsv_bbl": target_gsv,
            "water_bbl": target_water,
            "nsv_bbl": target_nsv,
        },
        "diff": {
            "qty_bbl": diff_qty,
            "qty_percent": diff_qty_percent,
            "gsv_bbl": diff_gsv,
            "gsv_percent": diff_gsv_percent,
            "water_bbl": diff_water,
            "water_percent": diff_water_percent,
            "nsv_bbl": diff_nsv,
            "nsv_percent": diff_nsv_percent,
        },
    }

    cmp_row = db.query(MovementMappingComparison).filter(MovementMappingComparison.mapping_id == mapping_id).first()
    if not cmp_row:
        cmp_row = MovementMappingComparison(mapping_id=mapping_id)
        db.add(cmp_row)

    cmp_row.source_qty_bbl = source_qty
    cmp_row.source_gsv_bbl = source_gsv
    cmp_row.source_water_bbl = source_water
    cmp_row.source_nsv_bbl = source_nsv

    cmp_row.target_qty_bbl = target_qty
    cmp_row.target_gsv_bbl = target_gsv
    cmp_row.target_water_bbl = target_water
    cmp_row.target_nsv_bbl = target_nsv

    cmp_row.diff_nsv_bbl = diff_nsv
    cmp_row.diff_nsv_percent = diff_nsv_percent
    cmp_row.summary_json = summary
    cmp_row.updated_at = datetime.now()

    db.flush()
    return cmp_row


def build_mapping_comparison_response(cmp_row):
    if not cmp_row:
        return None

    source_qty = optional_float(cmp_row.source_qty_bbl) or 0
    target_qty = optional_float(cmp_row.target_qty_bbl) or 0
    source_water = optional_float(cmp_row.source_water_bbl) or 0
    target_water = optional_float(cmp_row.target_water_bbl) or 0
    source_gsv = optional_float(cmp_row.source_gsv_bbl)
    target_gsv = optional_float(cmp_row.target_gsv_bbl)
    diff_qty, diff_qty_percent = difference_and_percent(source_qty, target_qty)
    diff_gsv, diff_gsv_percent = difference_and_percent(source_gsv, target_gsv)
    diff_water, diff_water_percent = difference_and_percent(source_water, target_water)

    return {
        "id": cmp_row.id,
        "mapping_id": cmp_row.mapping_id,
        "source_qty_bbl": source_qty,
        "source_gsv_bbl": source_gsv,
        "source_water_bbl": source_water,
        "source_nsv_bbl": cmp_row.source_nsv_bbl,
        "target_qty_bbl": target_qty,
        "target_gsv_bbl": target_gsv,
        "target_water_bbl": target_water,
        "target_nsv_bbl": cmp_row.target_nsv_bbl,
        "diff_qty_bbl": diff_qty,
        "diff_qty_percent": diff_qty_percent,
        "diff_gsv_bbl": diff_gsv,
        "diff_gsv_percent": diff_gsv_percent,
        "diff_water_bbl": diff_water,
        "diff_water_percent": diff_water_percent,
        "diff_nsv_bbl": cmp_row.diff_nsv_bbl,
        "diff_nsv_percent": cmp_row.diff_nsv_percent,
        "summary_json": cmp_row.summary_json,
        "created_at": cmp_row.created_at,
        "updated_at": cmp_row.updated_at,
    }


def build_mapping_response(db: Session, mapping: MovementMapping):
    items = (
        db.query(MovementMappingItem)
        .filter(MovementMappingItem.mapping_id == mapping.id)
        .order_by(MovementMappingItem.id.asc())
        .all()
    )
    cmp_row = (
        db.query(MovementMappingComparison)
        .filter(MovementMappingComparison.mapping_id == mapping.id)
        .first()
    )

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
        "archived_at": mapping.archived_at,
        "archived_by": mapping.archived_by,
        "created_at": mapping.created_at,
        "updated_at": mapping.updated_at,
        "items": items,
        "comparison": build_mapping_comparison_response(cmp_row),
    }


def normalize_code(value: str):
    if not value:
        return ""
    return value.strip().upper()


def validate_mapping_type(value: str):
    mapping_type = normalize_code(value)
    if mapping_type not in MAPPING_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"mapping_type must be one of: {', '.join(sorted(MAPPING_TYPES))}",
        )
    return mapping_type


def current_user_display(current_user: User):
    return (
        f"{current_user.full_name} ({current_user.username})"
        if current_user.full_name
        else current_user.username
    )


def ensure_movement_mapping_scope(mapping: MovementMapping, current_user: User, db: Session):
    ensure_location_in_user_scope(current_user, db, mapping.location_code, "Mapping location")


def ensure_transaction_scope(transaction: OperationTransaction, current_user: User, db: Session):
    ensure_location_in_user_scope(current_user, db, transaction.origin_location_code, "Transaction origin location")
    ensure_location_in_user_scope(current_user, db, transaction.destination_location_code, "Transaction destination location")
    ensure_location_in_user_scope(current_user, db, transaction.sender_location_code, "Transaction sender location")
    ensure_location_in_user_scope(current_user, db, transaction.receiver_location_code, "Transaction receiver location")


def ensure_mapping_items_scope(mapping: MovementMapping, current_user: User, db: Session):
    ensure_movement_mapping_scope(mapping, current_user, db)
    items = db.query(MovementMappingItem).filter(
        MovementMappingItem.mapping_id == mapping.id
    ).all()
    transaction_ids = [item.transaction_id for item in items]
    if not transaction_ids:
        return
    transactions = db.query(OperationTransaction).filter(
        OperationTransaction.id.in_(transaction_ids)
    ).all()
    for transaction in transactions:
        ensure_transaction_scope(transaction, current_user, db)


@router.get("", response_model=list[MovementMappingResponse])
def list_movement_mappings(
    mapping_type: str | None = None,
    location_code: str | None = None,
    reference_number: str | None = None,
    status: str | None = None,
    archived: bool = False,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Movement Mapping", db)

    q = apply_location_filter(db.query(MovementMapping), MovementMapping, current_user, db)
    q = q.filter(
        MovementMapping.archived_at.isnot(None)
        if archived
        else MovementMapping.archived_at.is_(None)
    )

    if clean_optional_text(mapping_type):
        q = q.filter(MovementMapping.mapping_type.ilike(mapping_type))

    if clean_optional_text(location_code):
        ensure_location_in_user_scope(current_user, db, location_code, "Mapping location")
        q = q.filter(MovementMapping.location_code.ilike(location_code.strip()))

    if clean_optional_text(reference_number):
        q = q.filter(MovementMapping.reference_number.ilike(reference_number))

    if clean_optional_text(status):
        q = q.filter(MovementMapping.status.ilike(status))

    rows = q.order_by(MovementMapping.created_at.desc(), MovementMapping.id.desc()).all()
    for row in rows:
        ensure_mapping_items_scope(row, current_user, db)
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
    ensure_mapping_items_scope(m, current_user, db)

    return build_mapping_response(db, m)


@router.post("", response_model=MovementMappingResponse)
def create_movement_mapping(
    request: MovementMappingCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Movement Mapping", db)
    location_code = normalize_code(clean_optional_text(request.location_code))
    reference_number = str(request.reference_number or "").strip()
    mapping_type = validate_mapping_type(request.mapping_type)
    if not location_code:
        raise HTTPException(status_code=400, detail="location_code is required")
    if not reference_number:
        raise HTTPException(status_code=400, detail="reference_number is required")
    ensure_location_in_user_scope(current_user, db, location_code, "Mapping location")

    duplicate = db.query(MovementMapping).filter(
        MovementMapping.mapping_type == mapping_type,
        MovementMapping.location_code.ilike(location_code),
        MovementMapping.reference_number.ilike(reference_number),
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail=(
                "A mapping already exists for this type, location and reference. "
                f"Open mapping #{duplicate.id} or restore it if it was deleted."
            ),
        )

    created_by = current_user_display(current_user)

    m = MovementMapping(
        mapping_type=mapping_type,
        location_code=location_code,
        reference_number=reference_number,
        product_name=clean_optional_text(request.product_name),
        remarks=clean_optional_text(request.remarks),
        status="OPEN",
        created_by=created_by,
        updated_at=datetime.now(),
    )

    db.add(m)
    db.flush()
    create_audit_log(
        db=db,
        module_name="Operations",
        action="Create Movement Mapping",
        current_user=current_user,
        entity_type="MovementMapping",
        entity_id=m.id,
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


@router.patch("/{mapping_id}", response_model=MovementMappingResponse)
def update_movement_mapping(
    mapping_id: int,
    request: MovementMappingUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit Movement Mapping", db)

    mapping = db.query(MovementMapping).filter(MovementMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")
    ensure_mapping_items_scope(mapping, current_user, db)
    if mapping.archived_at:
        raise HTTPException(status_code=400, detail="Restore this deleted mapping before editing it")
    if str(mapping.status).upper() == "CLOSED":
        raise HTTPException(status_code=400, detail="Closed mappings are read-only")

    changes = request.model_dump(exclude_unset=True)
    if not changes:
        return build_mapping_response(db, mapping)

    old_values = {
        "mapping_type": mapping.mapping_type,
        "location_code": mapping.location_code,
        "reference_number": mapping.reference_number,
        "product_name": mapping.product_name,
        "remarks": mapping.remarks,
    }
    items_exist = db.query(MovementMappingItem.id).filter(
        MovementMappingItem.mapping_id == mapping_id
    ).first() is not None

    new_type = mapping.mapping_type
    if "mapping_type" in changes:
        if not changes["mapping_type"]:
            raise HTTPException(status_code=400, detail="mapping_type cannot be blank")
        new_type = validate_mapping_type(changes["mapping_type"])

    new_location = mapping.location_code
    if "location_code" in changes:
        new_location = normalize_code(clean_optional_text(changes["location_code"]))
        if not new_location:
            raise HTTPException(status_code=400, detail="location_code cannot be blank")
        ensure_location_in_user_scope(current_user, db, new_location, "Mapping location")

    new_reference = mapping.reference_number
    if "reference_number" in changes:
        new_reference = str(changes["reference_number"] or "").strip()
        if not new_reference:
            raise HTTPException(status_code=400, detail="reference_number cannot be blank")

    if items_exist and (
        new_type != mapping.mapping_type or new_location != mapping.location_code
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "Mapping type and location cannot be changed after tickets are attached. "
                "Remove the tickets first, then edit these fields."
            ),
        )

    duplicate = db.query(MovementMapping).filter(
        MovementMapping.id != mapping_id,
        MovementMapping.mapping_type == new_type,
        MovementMapping.location_code.ilike(new_location),
        MovementMapping.reference_number.ilike(new_reference),
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail=f"This type/location/reference is already used by mapping #{duplicate.id}.",
        )

    mapping.mapping_type = new_type
    mapping.location_code = new_location
    mapping.reference_number = new_reference
    if "product_name" in changes:
        mapping.product_name = clean_optional_text(changes["product_name"])
    if "remarks" in changes:
        mapping.remarks = clean_optional_text(changes["remarks"])
    mapping.updated_at = datetime.now()

    try:
        db.flush()
        create_audit_log(
            db=db,
            module_name="Operations",
            action="Edit Movement Mapping",
            current_user=current_user,
            entity_type="MovementMapping",
            entity_id=mapping.id,
            entity_label=f"{mapping.mapping_type} | {mapping.location_code} | {mapping.reference_number}",
            remarks="Movement mapping details edited",
            request_path=f"/movement-mappings/{mapping_id}",
            details={
                "before": old_values,
                "after": {
                    "mapping_type": mapping.mapping_type,
                    "location_code": mapping.location_code,
                    "reference_number": mapping.reference_number,
                    "product_name": mapping.product_name,
                    "remarks": mapping.remarks,
                },
            },
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A mapping with these details already exists")

    db.refresh(mapping)
    return build_mapping_response(db, mapping)


@router.delete("/{mapping_id}", response_model=MovementMappingResponse)
def archive_movement_mapping(
    mapping_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Soft-delete a mapping without deleting linked tickets or comparisons."""
    require_user_permission(current_user, "Edit Movement Mapping", db)

    mapping = db.query(MovementMapping).filter(MovementMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")
    ensure_mapping_items_scope(mapping, current_user, db)
    if mapping.archived_at:
        return build_mapping_response(db, mapping)

    mapping.archived_at = datetime.now()
    mapping.archived_by = current_user_display(current_user)
    mapping.updated_at = datetime.now()
    create_audit_log(
        db=db,
        module_name="Operations",
        action="Delete Movement Mapping (Archived)",
        current_user=current_user,
        entity_type="MovementMapping",
        entity_id=mapping.id,
        entity_label=f"{mapping.mapping_type} | {mapping.location_code} | {mapping.reference_number}",
        old_status=mapping.status,
        new_status="Deleted",
        remarks="Mapping removed from active lists; linked transactions and comparison history retained",
        request_path=f"/movement-mappings/{mapping_id}",
        details={
            "mapping_type": mapping.mapping_type,
            "location_code": mapping.location_code,
            "reference_number": mapping.reference_number,
            "archived_by": mapping.archived_by,
            "archived_at": mapping.archived_at.isoformat(),
            "preserved_item_count": db.query(MovementMappingItem.id).filter(
                MovementMappingItem.mapping_id == mapping_id
            ).count(),
        },
    )
    db.commit()
    db.refresh(mapping)
    return build_mapping_response(db, mapping)


@router.post("/{mapping_id}/restore", response_model=MovementMappingResponse)
def restore_movement_mapping(
    mapping_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit Movement Mapping", db)

    mapping = db.query(MovementMapping).filter(MovementMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")
    ensure_mapping_items_scope(mapping, current_user, db)
    if not mapping.archived_at:
        return build_mapping_response(db, mapping)

    mapping.archived_at = None
    mapping.archived_by = None
    mapping.updated_at = datetime.now()
    create_audit_log(
        db=db,
        module_name="Operations",
        action="Restore Deleted Movement Mapping",
        current_user=current_user,
        entity_type="MovementMapping",
        entity_id=mapping.id,
        entity_label=f"{mapping.mapping_type} | {mapping.location_code} | {mapping.reference_number}",
        new_status=mapping.status,
        remarks="Archived movement mapping restored with original tickets and comparison",
        request_path=f"/movement-mappings/{mapping_id}/restore",
        details={"mapping_type": mapping.mapping_type, "location_code": mapping.location_code, "reference_number": mapping.reference_number},
    )
    db.commit()
    db.refresh(mapping)
    return build_mapping_response(db, mapping)


@router.post("/{mapping_id}/items", response_model=MovementMappingResponse)
def add_mapping_items(
    mapping_id: int,
    request: MovementMappingItemAddRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit Movement Mapping", db)

    mapping = db.query(MovementMapping).filter(MovementMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")
    ensure_mapping_items_scope(mapping, current_user, db)

    if mapping.archived_at:
        raise HTTPException(status_code=400, detail="Restore this deleted mapping before editing it")
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
        ensure_transaction_scope(tx, current_user, db)

        if tx.status != "Approved":
            raise HTTPException(status_code=400, detail=f"Only Approved transactions can be mapped (ticket {tid})")

        exists = db.query(MovementMappingItem).filter(
            MovementMappingItem.mapping_id == mapping_id,
            MovementMappingItem.transaction_id == tid,
        ).first()
        if exists:
            skipped_transaction_ids.append(tid)
            continue

        qty, water, gsv, nsv = extract_transaction_quantities(db, tx)

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
            gsv_bbl=gsv,
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
    require_user_permission(current_user, "Edit Movement Mapping", db)

    mapping = db.query(MovementMapping).filter(MovementMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")
    ensure_mapping_items_scope(mapping, current_user, db)

    if mapping.archived_at:
        raise HTTPException(status_code=400, detail="Restore this deleted mapping before editing it")
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
    require_user_permission(current_user, "Close Movement Mapping", db)

    mapping = db.query(MovementMapping).filter(MovementMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")
    ensure_mapping_items_scope(mapping, current_user, db)
    if mapping.archived_at:
        raise HTTPException(status_code=400, detail="Restore this deleted mapping before closing it")

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
