"""Book Data — Book Stock Management: products, fields, settings and the
Export Operations configuration the module reads.

Daily stock entries and summaries live in ``book_stock_entries``. Both routers
share the same prefix and the helpers in ``book_stock_common``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.models import (
    BookStockConfig,
    BookStockDailyEntry,
    BookStockField,
    BookStockFieldProduct,
    BookStockFieldStock,
    BookStockFieldProduction,
    BookStockSubField,
    BookStockSubFieldProduction,
    BookStockProduct,
    ExportBlock,
    ExportEntity,
    ExportEntityBlock,
    ExportLocation,
    ExportLocationEntity,
    User,
)
from app.routers.book_stock_common import (
    MODULE,
    active_product_limit,
    actor_name,
    ci,
    code,
    ensure_config_defaults,
    entity_allowed,
    field_response,
    name_maps,
    product_codes_for_field,
    product_response,
    require_any_view,
    resolve_block,
    resolve_entity,
    resolve_product,
    same,
    settings_map,
    setting_value,
    visible_entity_codes,
)
from app.schemas import (
    BookStockFieldCreate,
    BookStockSubFieldInput,
    BookStockFieldUpdate,
    BookStockProductCreate,
    BookStockSettingsUpdate,
)
from app.services.audit_service import create_audit_log
from app.services.book_stock_calculations import DEFAULT_SETTINGS, PRODUCT_LIMIT, SETTING_DESCRIPTIONS, yes_no

from app.routers.book_stock_hierarchy import LEGACY_CODE, sub_field_response, lock_stock_keys

router = APIRouter(prefix="/book-stock", tags=["Book Stock Management"])


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------

@router.get("/products")
def list_products(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_any_view(current_user, db)
    query = db.query(BookStockProduct)
    if not include_inactive:
        query = query.filter(func.lower(func.trim(BookStockProduct.status)) == "active")
    rows = query.order_by(BookStockProduct.display_order, BookStockProduct.product_name).all()
    return [product_response(row) for row in rows]


@router.post("/products")
def create_product(
    data: BookStockProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "Create Book Stock Product", db)
    existing = (
        db.query(BookStockProduct)
        .filter(ci(BookStockProduct.product_code) == code(data.product_code).casefold())
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail=f"Product code '{data.product_code}' already exists.")
    settings = settings_map(db)
    limit = active_product_limit(db)
    target_status = "Active" if str(data.status).strip().casefold() == "active" else "Inactive"
    active_count = db.query(BookStockProduct).filter(func.lower(func.trim(BookStockProduct.status)) == "active").count()
    if target_status == "Active" and active_count >= limit:
        raise HTTPException(
            status_code=400,
            detail=f"Only {limit} active products are allowed. Deactivate a product before activating another.",
        )
    product = BookStockProduct(
        product_code=data.product_code.strip().upper(),
        product_name=data.product_name.strip(),
        unit=(data.unit or setting_value(settings, "default_unit", "BBL") or "BBL").strip(),
        description=(data.description or "").strip() or None,
        display_order=int(data.display_order or 0),
        status=target_status,
        created_by=actor_name(current_user),
        updated_by=actor_name(current_user),
    )
    db.add(product)
    db.flush()
    create_audit_log(
        db, MODULE, "Create Book Stock Product", current_user,
        entity_type="BookStockProduct", entity_id=product.id, entity_label=product.product_name,
        details={"after": product_response(product)},
    )
    db.commit()
    db.refresh(product)
    return product_response(product)


@router.put("/products/{product_id}")
def update_product(
    product_id: int,
    data: BookStockProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "Edit Book Stock Product", db)
    product = db.query(BookStockProduct).filter(BookStockProduct.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Book stock product not found.")
    duplicate = (
        db.query(BookStockProduct)
        .filter(
            ci(BookStockProduct.product_code) == code(data.product_code).casefold(),
            BookStockProduct.id != product.id,
        )
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=400, detail=f"Product code '{data.product_code}' already exists.")
    target_status = "Active" if str(data.status).strip().casefold() == "active" else "Inactive"
    if target_status == "Active" and str(product.status).strip().casefold() != "active":
        active_count = db.query(BookStockProduct).filter(func.lower(func.trim(BookStockProduct.status)) == "active").count()
        if active_count >= active_product_limit(db):
            raise HTTPException(status_code=400, detail="Only two active products are allowed. Deactivate a product first.")
    if not same(product.product_code, data.product_code) and db.query(BookStockDailyEntry.id).filter(ci(BookStockDailyEntry.product_code) == code(product.product_code).casefold()).first():
        raise HTTPException(400, 'A product with stock history cannot be recoded.')
    before = product_response(product)
    product.product_code = data.product_code.strip().upper()
    product.product_name = data.product_name.strip()
    product.unit = (data.unit or product.unit or "BBL").strip()
    product.description = (data.description or "").strip() or None
    product.display_order = int(data.display_order or 0)
    product.status = target_status
    product.updated_by = actor_name(current_user)
    db.flush()
    create_audit_log(
        db, MODULE, "Edit Book Stock Product", current_user,
        entity_type="BookStockProduct", entity_id=product.id, entity_label=product.product_name,
        details={"before": before, "after": product_response(product)},
    )
    db.commit()
    db.refresh(product)
    return product_response(product)


@router.delete("/products/{product_id}")
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "Delete Book Stock Product", db)
    product = db.query(BookStockProduct).filter(BookStockProduct.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Book stock product not found.")
    before = product_response(product)
    product.status = "Inactive"
    product.updated_by = actor_name(current_user)
    used = db.query(BookStockDailyEntry).filter(ci(BookStockDailyEntry.product_code) == code(product.product_code).casefold()).count()
    db.flush()
    create_audit_log(
        db, MODULE, "Delete Book Stock Product", current_user,
        entity_type="BookStockProduct", entity_id=product.id, entity_label=product.product_name,
        remarks="Product deactivated (historical stock entries are kept)",
        details={"before": before, "after": product_response(product), "stock_entries": used},
    )
    db.commit()
    return {"detail": "Book stock product deleted (deactivated).", "id": product_id}


# ---------------------------------------------------------------------------
# Producing fields
# ---------------------------------------------------------------------------

def _validate_field_products(db: Session, product_codes: list[str]) -> list[BookStockProduct]:
    unique: dict[str, str] = {}
    for item in product_codes or []:
        if code(item):
            unique[code(item).casefold()] = item
    if not unique:
        raise HTTPException(status_code=400, detail="Select at least one product the field produces.")
    if len(unique) > PRODUCT_LIMIT:
        raise HTTPException(status_code=400, detail=f"A field can produce at most {PRODUCT_LIMIT} products.")
    return [resolve_product(db, item) for item in unique.values()]


def _sync_field_products(db: Session, field: BookStockField, products: list[BookStockProduct]) -> None:
    wanted = {code(product.product_code).casefold() for product in products}
    existing = db.query(BookStockFieldProduct).filter(BookStockFieldProduct.field_id == field.id).all()
    by_key = {code(row.product_code).casefold(): row for row in existing}
    for key, row in by_key.items():
        row.status = "Active" if key in wanted else "Inactive"
    for product in products:
        key = code(product.product_code).casefold()
        if key not in by_key:
            db.add(
                BookStockFieldProduct(
                    field_id=field.id,
                    product_code=product.product_code,
                    status="Active",
                )
            )
    db.flush()


@router.get("/fields")
def list_fields(
    entity_code: str = Query(None),
    block_code: str = Query(None),
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_any_view(current_user, db)
    codes = visible_entity_codes(current_user, db)
    query = db.query(BookStockField)
    if not include_inactive:
        query = query.filter(func.lower(func.trim(BookStockField.status)) == "active")
    if entity_code:
        query = query.filter(ci(BookStockField.entity_code) == code(entity_code).casefold())
    if block_code:
        query = query.filter(ci(BookStockField.block_code) == code(block_code).casefold())
    rows = query.order_by(BookStockField.entity_code, BookStockField.block_code, BookStockField.field_name).all()
    if codes is not None:
        rows = [row for row in rows if entity_allowed(codes, row.entity_code)]
    names = name_maps(db)
    return [field_response(row, db, names) for row in rows]


@router.post("/fields")
def create_field(
    data: BookStockFieldCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "Create Book Stock Field", db)
    codes = visible_entity_codes(current_user, db)
    entity = resolve_entity(db, data.entity_code, current_user, codes)
    block = resolve_block(db, entity, data.block_code)
    products = _validate_field_products(db, data.product_codes)
    lock_stock_keys(db, *((entity.entity_code, block.block_code, p.product_code) for p in products))
    duplicate_code = db.query(BookStockField).filter(ci(BookStockField.field_code) == code(data.field_code).casefold()).first()
    if duplicate_code:
        raise HTTPException(status_code=400, detail=f"Field code '{data.field_code}' already exists.")
    duplicate_name = (
        db.query(BookStockField)
        .filter(
            ci(BookStockField.entity_code) == code(entity.entity_code).casefold(),
            ci(BookStockField.block_code) == code(block.block_code).casefold(),
            ci(BookStockField.field_name) == code(data.field_name).casefold(),
        )
        .first()
    )
    if duplicate_name:
        raise HTTPException(status_code=400, detail=f"Field '{data.field_name}' already exists in this block.")
    field = BookStockField(
        field_code=data.field_code.strip().upper(),
        field_name=data.field_name.strip(),
        entity_code=entity.entity_code,
        block_code=block.block_code,
        description=(data.description or "").strip() or None,
        status="Active" if str(data.status).strip().casefold() == "active" else "Inactive",
        created_by=actor_name(current_user),
        updated_by=actor_name(current_user),
    )
    db.add(field)
    db.flush()
    _sync_field_products(db, field, products)
    create_audit_log(
        db, MODULE, "Create Book Stock Field", current_user,
        entity_type="BookStockField", entity_id=field.id, entity_label=field.field_name,
        details={"after": field_response(field, db)},
    )
    db.commit()
    db.refresh(field)
    return field_response(field, db)


@router.put("/fields/{field_id}")
def update_field(
    field_id: int,
    data: BookStockFieldUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "Edit Book Stock Field", db)
    field = db.query(BookStockField).filter(BookStockField.id == field_id).first()
    if not field:
        raise HTTPException(status_code=404, detail="Book stock field not found.")
    codes = visible_entity_codes(current_user, db)
    if not entity_allowed(codes, field.entity_code):
        raise HTTPException(status_code=403, detail="This field is outside your assigned location scope.")
    entity = resolve_entity(db, data.entity_code, current_user, codes)
    block = resolve_block(db, entity, data.block_code)
    products = _validate_field_products(db, data.product_codes)
    original_scope = (field.entity_code, field.block_code)
    lock_stock_keys(db, *((field.entity_code, field.block_code, p) for p in product_codes_for_field(db, field.id)),
                    *((entity.entity_code, block.block_code, p.product_code) for p in products))
    db.refresh(field)
    if (field.entity_code, field.block_code) != original_scope:
        raise HTTPException(409, 'The main field changed concurrently; reload and try again.')
    if not entity_allowed(codes, field.entity_code):
        raise HTTPException(403, 'This field is outside your assigned location scope.')
    duplicate_code = (
        db.query(BookStockField)
        .filter(ci(BookStockField.field_code) == code(data.field_code).casefold(), BookStockField.id != field.id)
        .first()
    )
    if duplicate_code:
        raise HTTPException(status_code=400, detail=f"Field code '{data.field_code}' already exists.")
    duplicate_name = (
        db.query(BookStockField)
        .filter(
            ci(BookStockField.entity_code) == code(entity.entity_code).casefold(),
            ci(BookStockField.block_code) == code(block.block_code).casefold(),
            ci(BookStockField.field_name) == code(data.field_name).casefold(),
            BookStockField.id != field.id,
        )
        .first()
    )
    if duplicate_name:
        raise HTTPException(status_code=400, detail=f"Field '{data.field_name}' already exists in this block.")
    used = (db.query(BookStockSubField.id).filter_by(field_id=field.id).first()
            or db.query(BookStockFieldProduction.id).filter(
                (BookStockFieldProduction.field_id == field.id) | (ci(BookStockFieldProduction.field_code) == code(field.field_code).casefold())).first()
            or db.query(BookStockFieldStock.id).filter(BookStockFieldStock.field_id == field.id).first())
    if used and (not same(field.field_code, data.field_code) or not same(field.entity_code, entity.entity_code)
                 or not same(field.block_code, block.block_code)):
        raise HTTPException(400, 'A main field with sub-fields or historical stock cannot be moved or recoded.')
    if db.query(BookStockFieldStock.id).filter_by(field_id=field.id).first():
        old_products = {code(p).casefold() for p in product_codes_for_field(db, field.id)}
        if old_products - {code(p.product_code).casefold() for p in products} or str(data.status).strip().casefold() != 'active':
            raise HTTPException(400, 'A main field with stock history cannot be deactivated or have products removed; its balance must remain in the block.')
    before = field_response(field, db)
    field.field_code = data.field_code.strip().upper()
    field.field_name = data.field_name.strip()
    field.entity_code = entity.entity_code
    field.block_code = block.block_code
    for sub in db.query(BookStockSubField).filter_by(field_id=field.id).all():
        sub.entity_code, sub.block_code = entity.entity_code, block.block_code
    field.description = (data.description or "").strip() or None
    field.status = "Active" if str(data.status).strip().casefold() == "active" else "Inactive"
    field.updated_by = actor_name(current_user)
    db.flush()
    _sync_field_products(db, field, products)
    create_audit_log(
        db, MODULE, "Edit Book Stock Field", current_user,
        entity_type="BookStockField", entity_id=field.id, entity_label=field.field_name,
        details={"before": before, "after": field_response(field, db)},
    )
    db.commit()
    db.refresh(field)
    return field_response(field, db)


@router.delete("/fields/{field_id}")
def delete_field(
    field_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "Delete Book Stock Field", db)
    field = db.query(BookStockField).filter(BookStockField.id == field_id).first()
    if not field:
        raise HTTPException(status_code=404, detail="Book stock field not found.")
    codes = visible_entity_codes(current_user, db)
    if not entity_allowed(codes, field.entity_code):
        raise HTTPException(status_code=403, detail="This field is outside your assigned location scope.")
    original_scope = (field.entity_code, field.block_code)
    lock_stock_keys(db, *((field.entity_code, field.block_code, p) for p in product_codes_for_field(db, field.id)))
    db.refresh(field)
    if (field.entity_code, field.block_code) != original_scope:
        raise HTTPException(409, 'The main field changed concurrently; reload and try again.')
    if not entity_allowed(codes, field.entity_code):
        raise HTTPException(403, 'This field is outside your assigned location scope.')
    if db.query(BookStockFieldStock.id).filter_by(field_id=field.id).first():
        raise HTTPException(400, 'A main field with stock history cannot be deactivated; its balance must remain in the block.')
    before = field_response(field, db)
    field.status = "Inactive"
    field.updated_by = actor_name(current_user)
    db.query(BookStockFieldProduct).filter(BookStockFieldProduct.field_id == field.id).update(
        {"status": "Inactive"}, synchronize_session=False
    )
    db.flush()
    create_audit_log(
        db, MODULE, "Delete Book Stock Field", current_user,
        entity_type="BookStockField", entity_id=field.id, entity_label=field.field_name,
        remarks="Field deactivated (historical production is kept)",
        details={"before": before, "after": field_response(field, db)},
    )
    db.commit()
    return {"detail": "Book stock field deleted (deactivated).", "id": field_id}


# ---------------------------------------------------------------------------
# General settings
# ---------------------------------------------------------------------------

@router.get("/settings")
def get_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Book Stock Settings", db)
    ensure_config_defaults(db)
    db.commit()
    rows = db.query(BookStockConfig).order_by(BookStockConfig.config_key).all()
    return [
        {
            "config_key": row.config_key,
            "config_value": row.config_value,
            "description": row.description,
            "status": row.status,
            "updated_at": row.updated_at,
        }
        for row in rows
    ]


@router.put("/settings")
def update_settings(
    data: BookStockSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "Edit Book Stock Settings", db)
    rows = ensure_config_defaults(db)
    before = {key: row.config_value for key, row in rows.items()}
    yes_no_keys = {"auto_carry_opening", "allow_negative_closing", "allow_negative_adjustment"}
    applied = []
    for item in data.settings:
        key = str(item.config_key or "").strip()
        if key not in DEFAULT_SETTINGS:
            raise HTTPException(status_code=400, detail=f"Unknown Book Stock setting '{key}'.")
        value = "" if item.config_value is None else str(item.config_value).strip()
        if key in yes_no_keys:
            value = yes_no(value, DEFAULT_SETTINGS[key])
        elif key == "max_active_products":
            value = str(PRODUCT_LIMIT)
        elif key == "default_unit":
            if not value or len(value) > 30:
                raise HTTPException(status_code=400, detail="Default unit must be between 1 and 30 characters.")
        rows[key].config_value = value
        rows[key].updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        applied.append(key)
    db.flush()
    after = {key: row.config_value for key, row in rows.items()}
    create_audit_log(
        db, MODULE, "Edit Book Stock Settings", current_user,
        entity_type="BookStockConfig", entity_label="Book Stock general settings",
        details={"before": before, "after": after, "keys": applied},
    )
    db.commit()
    return [
        {
            "config_key": row.config_key,
            "config_value": row.config_value,
            "description": row.description,
            "status": row.status,
            "updated_at": row.updated_at,
        }
        for row in db.query(BookStockConfig).order_by(BookStockConfig.config_key).all()
    ]


# ---------------------------------------------------------------------------
# Shared reference data (only what the module needs from Export Operations)
# ---------------------------------------------------------------------------

@router.get("/reference-data")
def get_reference_data(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_any_view(current_user, db)
    codes = visible_entity_codes(current_user, db)
    settings = settings_map(db)

    entities = db.query(ExportEntity).filter(func.lower(func.trim(ExportEntity.status)) == "active").all()
    links = db.query(ExportEntityBlock).filter(func.lower(func.trim(ExportEntityBlock.status)) == "active").all()
    location_links = db.query(ExportLocationEntity).filter(func.lower(func.trim(ExportLocationEntity.status)) == "active").all()
    block_rows = db.query(ExportBlock).filter(func.lower(func.trim(ExportBlock.status)) == "active").all()
    locations = {code(row.location_code).casefold(): row for row in db.query(ExportLocation).all()}

    if codes is not None:
        entities = [row for row in entities if entity_allowed(codes, row.entity_code)]
    visible = {code(row.entity_code).casefold() for row in entities}
    links = [row for row in links if code(row.entity_code).casefold() in visible]
    linked_blocks = {code(row.block_code).casefold() for row in links}
    block_rows = [row for row in block_rows if code(row.block_code).casefold() in linked_blocks]
    location_links = [row for row in location_links if code(row.entity_code).casefold() in visible]

    entity_locations: dict[str, list[str]] = {}
    for link in location_links:
        entity_locations.setdefault(code(link.entity_code).casefold(), []).append(link.location_code)
    blocks_by_entity: dict[str, list[str]] = {}
    for link in links:
        blocks_by_entity.setdefault(code(link.entity_code).casefold(), []).append(link.block_code)

    names = name_maps(db)
    fields = (
        db.query(BookStockField)
        .filter(func.lower(func.trim(BookStockField.status)) == "active")
        .order_by(BookStockField.entity_code, BookStockField.block_code, BookStockField.field_name)
        .all()
    )
    if codes is not None:
        fields = [row for row in fields if entity_allowed(codes, row.entity_code)]

    products = db.query(BookStockProduct).order_by(BookStockProduct.display_order, BookStockProduct.product_name).all()
    return {
        "products": [product_response(row) for row in products],
        "active_products": [product_response(row) for row in products if str(row.status).strip().casefold() == "active"],
        "fields": [field_response(row, db, names) for row in fields],
        "sub_fields": [sub_field_response(sub, field) for sub, field in
            db.query(BookStockSubField, BookStockField).join(BookStockField, BookStockSubField.field_id == BookStockField.id)
            .filter(func.lower(func.trim(BookStockSubField.status)) == "active").all()
            if field.id in {f.id for f in fields}],
        "entities": [
            {
                "entity_code": row.entity_code,
                "entity_name": row.entity_name,
                "location_codes": entity_locations.get(code(row.entity_code).casefold(), []),
                "block_codes": blocks_by_entity.get(code(row.entity_code).casefold(), []),
            }
            for row in sorted(entities, key=lambda item: str(item.entity_name))
        ],
        "blocks": [
            {"block_code": row.block_code, "block_name": row.block_name}
            for row in sorted(block_rows, key=lambda item: str(item.block_name))
        ],
        "entity_blocks": [
            {"entity_code": link.entity_code, "block_code": link.block_code}
            for link in links
        ],
        "locations": [
            {"location_code": row.location_code, "location_name": row.location_name}
            for row in sorted(locations.values(), key=lambda item: str(item.location_name))
        ],
        "settings": {key: setting_value(settings, key, DEFAULT_SETTINGS.get(key)) for key in DEFAULT_SETTINGS},
        "settings_list": [
            {
                "config_key": key,
                "config_value": setting_value(settings, key, DEFAULT_SETTINGS.get(key)),
                "description": SETTING_DESCRIPTIONS.get(key),
            }
            for key in DEFAULT_SETTINGS
        ],
        "product_limit": active_product_limit(db),
        "active_product_count": sum(1 for row in products if str(row.status).strip().casefold() == "active"),
    }


@router.get("/export-operations")
def get_export_configurations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    """Export Operations configuration used as the module's main criteria."""
    require_user_permission(current_user, "View Book Stock Export Operations", db)
    codes = visible_entity_codes(current_user, db)
    entities = db.query(ExportEntity).filter(func.lower(func.trim(ExportEntity.status)) == "active").all()
    if codes is not None:
        entities = [row for row in entities if entity_allowed(codes, row.entity_code)]

    links = db.query(ExportEntityBlock).filter(func.lower(func.trim(ExportEntityBlock.status)) == "active").all()
    location_links = db.query(ExportLocationEntity).filter(func.lower(func.trim(ExportLocationEntity.status)) == "active").all()
    blocks = {code(row.block_code).casefold(): row for row in db.query(ExportBlock).all()}
    locations = {code(row.location_code).casefold(): row for row in db.query(ExportLocation).all()}
    fields = db.query(BookStockField).all()
    entries = db.query(BookStockDailyEntry).all()

    rows = []
    for entity in sorted(entities, key=lambda item: str(item.entity_name)):
        key = code(entity.entity_code).casefold()
        block_rows = []
        for link in [item for item in links if code(item.entity_code).casefold() == key]:
            block = blocks.get(code(link.block_code).casefold())
            block_fields = [f for f in fields if code(f.block_code).casefold() == code(link.block_code).casefold()]
            block_entries = [
                entry for entry in entries
                if code(entry.block_code).casefold() == code(link.block_code).casefold()
                and code(entry.entity_code).casefold() == key
            ]
            block_rows.append({
                "block_code": link.block_code,
                "block_name": getattr(block, "block_name", link.block_code),
                "field_count": len(block_fields),
                "stock_entry_count": len(block_entries),
                "latest_entry_date": max((entry.entry_date.isoformat() for entry in block_entries), default=None),
            })
        location_names = [
            getattr(locations.get(code(link.location_code).casefold()), "location_name", link.location_code)
            for link in location_links
            if code(link.entity_code).casefold() == key
        ]
        rows.append({
            "entity_code": entity.entity_code,
            "entity_name": entity.entity_name,
            "location_names": location_names,
            "block_count": len(block_rows),
            "field_count": sum(block["field_count"] for block in block_rows),
            "stock_entry_count": sum(block["stock_entry_count"] for block in block_rows),
            "latest_entry_date": max((block["latest_entry_date"] for block in block_rows if block["latest_entry_date"]), default=None),
            "blocks": block_rows,
        })
    return {"entities": rows, "total": len(rows)}


# Sub-fields inherit their main field's entity, block and product mappings.
@router.get('/sub-fields')
def list_sub_fields(include_inactive: bool = False, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user_from_token)):
    require_any_view(current_user, db)
    codes = visible_entity_codes(current_user, db)
    query = db.query(BookStockSubField, BookStockField).join(BookStockField, BookStockSubField.field_id == BookStockField.id)
    if not include_inactive:
        query = query.filter(func.lower(func.trim(BookStockSubField.status)) == 'active')
    return [sub_field_response(sub, field) for sub, field in query.order_by(BookStockField.field_name, BookStockSubField.sub_field_name).all()
            if entity_allowed(codes, field.entity_code)]


def _sub_field_parent(db, field_id, user):
    field = db.query(BookStockField).filter_by(id=field_id).first()
    if not field:
        raise HTTPException(404, 'Main field not found.')
    if not entity_allowed(visible_entity_codes(user, db), field.entity_code):
        raise HTTPException(403, 'This main field is outside your assigned location scope.')
    lock_key = (field.entity_code, field.block_code)
    lock_stock_keys(db, *((field.entity_code, field.block_code, p) for p in product_codes_for_field(db, field.id)))
    db.refresh(field)
    if (field.entity_code, field.block_code) != lock_key:
        raise HTTPException(409, 'The main field changed concurrently; reload and try again.')
    if not entity_allowed(visible_entity_codes(user, db), field.entity_code):
        raise HTTPException(403, 'This main field is outside your assigned location scope.')
    if code(field.status).casefold() != 'active':
        raise HTTPException(400, 'Main field is inactive.')
    return field


def _validate_sub_field(db, data, field, exclude_id=None):
    sub_code, name = code(data.sub_field_code), code(data.sub_field_name)
    if not sub_code or not name or sub_code.casefold() == LEGACY_CODE.casefold():
        raise HTTPException(400, 'Valid sub-field code and name are required; the legacy code is reserved.')
    query = db.query(BookStockSubField).filter(BookStockSubField.field_id == field.id,
        ci(BookStockSubField.sub_field_code) == sub_code.casefold())
    if exclude_id:
        query = query.filter(BookStockSubField.id != exclude_id)
    if query.first():
        raise HTTPException(400, 'Sub-field code already exists within this main field.')
    if code(data.status).casefold() not in ('active', 'inactive'):
        raise HTTPException(400, 'Status must be Active or Inactive.')


@router.post('/sub-fields')
def create_sub_field(data: BookStockSubFieldInput, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, 'Create Book Stock Field', db)
    field = _sub_field_parent(db, data.field_id, current_user)
    _validate_sub_field(db, data, field)
    sub = BookStockSubField(field_id=field.id, sub_field_code=code(data.sub_field_code).upper(),
        sub_field_name=code(data.sub_field_name), entity_code=field.entity_code, block_code=field.block_code, description=code(data.description) or None,
        status='Active' if code(data.status).casefold() == 'active' else 'Inactive',
        created_by=actor_name(current_user), updated_by=actor_name(current_user))
    db.add(sub); db.flush()
    create_audit_log(db, MODULE, 'Create Book Stock Sub-Field', current_user,
        entity_type='BookStockSubField', entity_id=sub.id, entity_label=sub.sub_field_name,
        details={'after': {k: v for k, v in sub_field_response(sub, field).items() if k not in ('created_at', 'updated_at')}})
    db.commit(); db.refresh(sub)
    return sub_field_response(sub, field)


@router.put('/sub-fields/{sub_id}')
def update_sub_field(sub_id: int, data: BookStockSubFieldInput, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, 'Edit Book Stock Field', db)
    sub = db.query(BookStockSubField).filter_by(id=sub_id).first()
    if not sub:
        raise HTTPException(404, 'Sub-field not found.')
    field = _sub_field_parent(db, sub.field_id, current_user)
    if sub.sub_field_code == LEGACY_CODE:
        raise HTTPException(400, 'The historical production source cannot be changed.')
    if sub.field_id != data.field_id:
        raise HTTPException(400, 'A sub-field cannot be moved to another main field.')
    _validate_sub_field(db, data, field, sub.id)
    before = {k: v for k, v in sub_field_response(sub, field).items() if k not in ('created_at', 'updated_at')}
    sub.sub_field_code, sub.sub_field_name = code(data.sub_field_code).upper(), code(data.sub_field_name)
    sub.description = code(data.description) or None
    sub.status = 'Active' if code(data.status).casefold() == 'active' else 'Inactive'
    sub.updated_by = actor_name(current_user)
    db.flush()
    create_audit_log(db, MODULE, 'Edit Book Stock Sub-Field', current_user,
        entity_type='BookStockSubField', entity_id=sub.id, entity_label=sub.sub_field_name,
        details={'before': before, 'after': {k: v for k, v in sub_field_response(sub, field).items() if k not in ('created_at', 'updated_at')}})
    db.commit(); db.refresh(sub)
    return sub_field_response(sub, field)


@router.delete('/sub-fields/{sub_id}')
def delete_sub_field(sub_id: int, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, 'Delete Book Stock Field', db)
    sub = db.query(BookStockSubField).filter_by(id=sub_id).first()
    if not sub:
        raise HTTPException(404, 'Sub-field not found.')
    field = _sub_field_parent(db, sub.field_id, current_user)
    if sub.sub_field_code == LEGACY_CODE:
        raise HTTPException(400, 'The historical production source cannot be changed.')
    before = {k: v for k, v in sub_field_response(sub, field).items() if k not in ('created_at', 'updated_at')}
    sub.status, sub.updated_by = 'Inactive', actor_name(current_user)
    db.flush()
    create_audit_log(db, MODULE, 'Delete Book Stock Sub-Field', current_user,
        entity_type='BookStockSubField', entity_id=sub.id, entity_label=sub.sub_field_name,
        details={'before': before, 'after': {k: v for k, v in sub_field_response(sub, field).items() if k not in ('created_at', 'updated_at')}})
    db.commit()
    return {'id': sub_id, 'detail': 'Sub-field deactivated; historical production is retained.'}
