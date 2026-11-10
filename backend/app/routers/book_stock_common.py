"""Shared helpers for the Book Data — Book Stock Management routers.

Kept separate from the two routers so the master/reference endpoints and the
daily-entry/summary endpoints share exactly the same scope, validation and
response logic.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy import false, func
from sqlalchemy.orm import Session

from app.dependencies.auth import get_current_user_from_token  # noqa: F401  (re-export convenience)
from app.dependencies.permissions import (
    get_user_location_codes,
    normalize_location_code,
    require_any_user_permission,
)
from app.models import (
    BookStockConfig,
    BookStockDailyEntry,
    BookStockField,
    BookStockFieldProduct,
    BookStockFieldProduction,
    BookStockProduct,
    ExportBlock,
    ExportEntity,
    ExportEntityBlock,
    ExportLocation,
    ExportLocationEntity,
    User,
)
from app.services.audit_service import create_audit_log  # noqa: F401
from app.services.book_stock_calculations import (
    DEFAULT_SETTINGS,
    PRODUCT_LIMIT,
    SETTING_DESCRIPTIONS,
    is_yes,
    normalize_code,
    round_qty,
    yes_no,
)
from app.utils.default_permissions import BOOK_STOCK_VIEW_PERMISSIONS

MODULE = "Book Stock Management"
MAX_SUMMARY_ROWS = 20000
MAX_BULK_ROWS = 2000


def ci(column):
    return func.lower(func.trim(column))


def actor_name(user: User) -> str:
    return str(getattr(user, "full_name", None) or getattr(user, "username", None) or "")


def code(value) -> str:
    return normalize_code(value) or ""


def same(left, right) -> bool:
    return code(left).casefold() == code(right).casefold()


def require_any_view(user: User, db: Session) -> None:
    require_any_user_permission(user, BOOK_STOCK_VIEW_PERMISSIONS, db)


# ---------------------------------------------------------------------------
# Entity scope (from the Export Operations location links)
# ---------------------------------------------------------------------------

def visible_entity_codes(user: User, db: Session) -> set[str] | None:
    allowed_locations = get_user_location_codes(user, db)
    if allowed_locations is None:
        return None
    if not allowed_locations:
        return set()
    rows = (
        db.query(ExportLocationEntity.entity_code)
        .filter(
            ci(ExportLocationEntity.location_code).in_(allowed_locations),
            func.lower(func.trim(ExportLocationEntity.status)) == "active",
        )
        .all()
    )
    return {str(raw).strip() for (raw,) in rows if str(raw or "").strip()}


def entity_allowed(codes: set[str] | None, entity_code: str) -> bool:
    if codes is None:
        return True
    target = code(entity_code).casefold()
    return any(code(item).casefold() == target for item in codes)


def resolve_entity(db: Session, entity_code: str, user: User, codes: set[str] | None) -> ExportEntity:
    entity = (
        db.query(ExportEntity)
        .filter(
            ci(ExportEntity.entity_code) == code(entity_code).casefold(),
            func.lower(func.trim(ExportEntity.status)) == "active",
        )
        .first()
    )
    if not entity:
        raise HTTPException(status_code=400, detail=f"Unknown or inactive export entity '{entity_code}'.")
    if not entity_allowed(codes, entity.entity_code):
        raise HTTPException(status_code=403, detail="This entity is outside your assigned location scope.")
    return entity


def resolve_block(db: Session, entity: ExportEntity, block_code: str) -> ExportBlock:
    link = (
        db.query(ExportEntityBlock)
        .filter(
            ci(ExportEntityBlock.entity_code) == code(entity.entity_code).casefold(),
            ci(ExportEntityBlock.block_code) == code(block_code).casefold(),
            func.lower(func.trim(ExportEntityBlock.status)) == "active",
        )
        .first()
    )
    if not link:
        raise HTTPException(
            status_code=400,
            detail=f"Block '{block_code}' is not mapped to entity '{entity.entity_code}' in Export Operations.",
        )
    block = (
        db.query(ExportBlock)
        .filter(
            ci(ExportBlock.block_code) == code(block_code).casefold(),
            func.lower(func.trim(ExportBlock.status)) == "active",
        )
        .first()
    )
    if not block:
        raise HTTPException(status_code=400, detail=f"Unknown or inactive export block '{block_code}'.")
    return block


def resolve_product(db: Session, product_code: str, *, require_active: bool = True) -> BookStockProduct:
    product = (
        db.query(BookStockProduct)
        .filter(ci(BookStockProduct.product_code) == code(product_code).casefold())
        .first()
    )
    if not product:
        raise HTTPException(status_code=400, detail=f"Unknown book stock product '{product_code}'.")
    if require_active and str(product.status or "").strip().casefold() != "active":
        raise HTTPException(status_code=400, detail=f"Book stock product '{product.product_code}' is inactive.")
    return product


def resolve_field(
    db: Session,
    field_code: str,
    entity_code: str,
    block_code: str,
    *,
    require_active: bool = True,
) -> BookStockField:
    field = (
        db.query(BookStockField)
        .filter(
            ci(BookStockField.field_code) == code(field_code).casefold(),
            ci(BookStockField.entity_code) == code(entity_code).casefold(),
            ci(BookStockField.block_code) == code(block_code).casefold(),
        )
        .first()
    )
    if not field:
        raise HTTPException(status_code=400, detail=f"Field '{field_code}' is not configured for block '{block_code}'.")
    if require_active and str(field.status or "").strip().casefold() != "active":
        raise HTTPException(status_code=400, detail=f"Field '{field.field_code}' is inactive.")
    return field


def product_codes_for_field(db: Session, field_id: int) -> list[str]:
    rows = (
        db.query(BookStockFieldProduct.product_code)
        .filter(
            BookStockFieldProduct.field_id == field_id,
            func.lower(func.trim(BookStockFieldProduct.status)) == "active",
        )
        .order_by(BookStockFieldProduct.id)
        .all()
    )
    return [str(item) for (item,) in rows if item]


def field_can_produce(db: Session, field: BookStockField, product_code: str) -> bool:
    return any(same(item, product_code) for item in product_codes_for_field(db, field.id))


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

def ensure_config_defaults(db: Session) -> dict[str, BookStockConfig]:
    rows = {row.config_key: row for row in db.query(BookStockConfig).all()}
    changed = False
    for key, value in DEFAULT_SETTINGS.items():
        if key not in rows:
            row = BookStockConfig(
                config_key=key,
                config_value=value,
                description=SETTING_DESCRIPTIONS.get(key),
                status="Active",
            )
            db.add(row)
            rows[key] = row
            changed = True
    if changed:
        db.flush()
    return rows


def setting_value(rows: dict[str, BookStockConfig], key: str, default=None):
    row = rows.get(key)
    if row is None:
        return DEFAULT_SETTINGS.get(key, default)
    return row.config_value if row.config_value is not None else DEFAULT_SETTINGS.get(key, default)


def settings_map(db: Session) -> dict[str, BookStockConfig]:
    return ensure_config_defaults(db)


def active_product_limit(db: Session) -> int:
    raw = setting_value(ensure_config_defaults(db), "max_active_products", str(PRODUCT_LIMIT))
    try:
        return max(1, min(int(raw), PRODUCT_LIMIT))
    except (TypeError, ValueError):
        return PRODUCT_LIMIT


def settings_payload(db: Session) -> list[dict]:
    rows = ensure_config_defaults(db)
    return [
        {
            "config_key": key,
            "config_value": setting_value(rows, key, DEFAULT_SETTINGS.get(key)),
            "description": SETTING_DESCRIPTIONS.get(key),
            "status": rows[key].status if key in rows else "Active",
            "updated_at": rows[key].updated_at if key in rows else None,
        }
        for key in DEFAULT_SETTINGS
    ]


# ---------------------------------------------------------------------------
# Response builders
# ---------------------------------------------------------------------------

def product_response(product: BookStockProduct) -> dict:
    return {
        "id": product.id,
        "product_code": product.product_code,
        "product_name": product.product_name,
        "unit": product.unit or "",
        "description": product.description,
        "display_order": product.display_order or 0,
        "status": product.status,
        "created_by": product.created_by,
        "updated_by": product.updated_by,
        "created_at": product.created_at,
        "updated_at": product.updated_at,
    }


def name_maps(db: Session) -> dict:
    return {
        "entities": {code(row.entity_code).casefold(): row.entity_name for row in db.query(ExportEntity).all()},
        "blocks": {code(row.block_code).casefold(): row.block_name for row in db.query(ExportBlock).all()},
        "products": {code(row.product_code).casefold(): row for row in db.query(BookStockProduct).all()},
    }


def field_response(field: BookStockField, db: Session, names: dict | None = None) -> dict:
    codes = product_codes_for_field(db, field.id)
    names = names or {}
    product_rows = names.get("products") or {code(row.product_code).casefold(): row for row in db.query(BookStockProduct).all()}
    return {
        "id": field.id,
        "field_code": field.field_code,
        "field_name": field.field_name,
        "entity_code": field.entity_code,
        "block_code": field.block_code,
        "entity_name": names.get("entities", {}).get(code(field.entity_code).casefold()),
        "block_name": names.get("blocks", {}).get(code(field.block_code).casefold()),
        "product_codes": codes,
        "product_names": [
            getattr(product_rows.get(code(item).casefold()), "product_name", item) for item in codes
        ],
        "description": field.description,
        "status": field.status,
        "created_by": field.created_by,
        "updated_by": field.updated_by,
        "created_at": field.created_at,
        "updated_at": field.updated_at,
    }


def entry_lines(db: Session, entry_id: int) -> list[BookStockFieldProduction]:
    return (
        db.query(BookStockFieldProduction)
        .filter(BookStockFieldProduction.entry_id == entry_id)
        .order_by(BookStockFieldProduction.id)
        .all()
    )


def entry_response(entry: BookStockDailyEntry, db: Session, names: dict | None = None, lines=None) -> dict:
    names = names or name_maps(db)
    product = names.get("products", {}).get(code(entry.product_code).casefold())
    if lines is None:
        lines = entry_lines(db, entry.id)
    from app.routers.book_stock_hierarchy import list_field_stocks, LEGACY_CODE
    stocks = list_field_stocks(db, entry.id)
    # Present old field production under a default source, without rewriting it.
    from app.models import BookStockSubField
    def legacy_source(line):
        if stocks:
            return []
        field = db.query(BookStockField).filter(BookStockField.id == line.field_id).first() if line.field_id else None
        if field is None:
            field = db.query(BookStockField).filter(ci(BookStockField.field_code) == code(line.field_code).casefold()).first()
        sub = (db.query(BookStockSubField).filter(BookStockSubField.field_id == field.id,
               ci(BookStockSubField.sub_field_code) == LEGACY_CODE.casefold()).first()) if field else None
        return [{'sub_field_id': sub.id if sub else None, 'sub_field_code': LEGACY_CODE,
                 'sub_field_name': 'Historical production', 'production_qty': round_qty(line.production_qty)}]
    return {
        "id": entry.id,
        "entry_date": entry.entry_date,
        "entity_code": entry.entity_code,
        "block_code": entry.block_code,
        "product_code": entry.product_code,
        "entity_name": names.get("entities", {}).get(code(entry.entity_code).casefold()),
        "block_name": names.get("blocks", {}).get(code(entry.block_code).casefold()),
        "product_name": getattr(product, "product_name", None),
        "unit": getattr(product, "unit", None),
        "opening_stock": round_qty(entry.opening_stock),
        "production": round_qty(entry.production),
        "dispatch": round_qty(entry.dispatch),
        "adjustment": round_qty(entry.adjustment),
        "closing_stock": round_qty(entry.closing_stock),
        "opening_carried": entry.opening_carried or "No",
        "remarks": entry.remarks,
        "field_stocks": stocks,
        "legacy_block_entry": not bool(stocks),
        "field_productions": [
            {
                "sub_field_productions": legacy_source(line),
                "id": line.id,
                "field_id": line.field_id,
                "field_code": line.field_code,
                "field_name": line.field_name,
                "product_code": line.product_code,
                "production_qty": round_qty(line.production_qty),
            }
            for line in lines
        ],
        "created_by": entry.created_by,
        "updated_by": entry.updated_by,
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
    }


def snapshot(entry: BookStockDailyEntry, db: Session) -> dict:
    from app.routers.book_stock_hierarchy import list_field_stocks
    return {
        "field_stocks": list_field_stocks(db, entry.id),
        "id": entry.id,
        "entry_date": entry.entry_date.isoformat() if entry.entry_date else None,
        "entity_code": entry.entity_code,
        "block_code": entry.block_code,
        "product_code": entry.product_code,
        "opening_stock": round_qty(entry.opening_stock),
        "production": round_qty(entry.production),
        "dispatch": round_qty(entry.dispatch),
        "adjustment": round_qty(entry.adjustment),
        "closing_stock": round_qty(entry.closing_stock),
        "opening_carried": entry.opening_carried,
        "remarks": entry.remarks,
        "field_productions": [
            {"field_code": line.field_code, "product_code": line.product_code, "production_qty": round_qty(line.production_qty)}
            for line in entry_lines(db, entry.id)
        ],
    }


# ---------------------------------------------------------------------------
# Entry validation / persistence
# ---------------------------------------------------------------------------

def previous_entry(
    db: Session,
    entity_code: str,
    block_code: str,
    product_code: str,
    entry_date: date,
    *,
    exclude_id: int | None = None,
) -> BookStockDailyEntry | None:
    query = db.query(BookStockDailyEntry).filter(
        ci(BookStockDailyEntry.entity_code) == code(entity_code).casefold(),
        ci(BookStockDailyEntry.block_code) == code(block_code).casefold(),
        ci(BookStockDailyEntry.product_code) == code(product_code).casefold(),
        BookStockDailyEntry.entry_date < entry_date,
    )
    if exclude_id is not None:
        query = query.filter(BookStockDailyEntry.id != exclude_id)
    return query.order_by(BookStockDailyEntry.entry_date.desc(), BookStockDailyEntry.id.desc()).first()


def duplicate_entry(
    db: Session,
    entity_code: str,
    block_code: str,
    product_code: str,
    entry_date: date,
    *,
    exclude_id: int | None = None,
) -> BookStockDailyEntry | None:
    query = db.query(BookStockDailyEntry).filter(
        BookStockDailyEntry.entry_date == entry_date,
        ci(BookStockDailyEntry.entity_code) == code(entity_code).casefold(),
        ci(BookStockDailyEntry.block_code) == code(block_code).casefold(),
        ci(BookStockDailyEntry.product_code) == code(product_code).casefold(),
    )
    if exclude_id is not None:
        query = query.filter(BookStockDailyEntry.id != exclude_id)
    return query.first()


def entry_query(
    db: Session,
    current_user: User,
    *,
    entity_code: str | None = None,
    block_code: str | None = None,
    product_code: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    codes = visible_entity_codes(current_user, db)
    query = db.query(BookStockDailyEntry)
    if codes is not None:
        if not codes:
            return query.filter(false())
        query = query.filter(ci(BookStockDailyEntry.entity_code).in_([code(item).casefold() for item in codes]))
    if entity_code:
        query = query.filter(ci(BookStockDailyEntry.entity_code) == code(entity_code).casefold())
    if block_code:
        query = query.filter(ci(BookStockDailyEntry.block_code) == code(block_code).casefold())
    if product_code:
        query = query.filter(ci(BookStockDailyEntry.product_code) == code(product_code).casefold())
    if date_from:
        query = query.filter(BookStockDailyEntry.entry_date >= date_from)
    if date_to:
        query = query.filter(BookStockDailyEntry.entry_date <= date_to)
    return query


def summary_rows(db: Session, current_user: User, **filters) -> list[BookStockDailyEntry]:
    return (
        entry_query(db, current_user, **filters)
        .order_by(BookStockDailyEntry.entry_date.asc(), BookStockDailyEntry.id.asc())
        .limit(MAX_SUMMARY_ROWS)
        .all()
    )


def decorate(rows: Iterable[dict], names: dict, *, drop_date: bool = False) -> list[dict]:
    products = names.get("products", {})
    decorated = []
    for row in rows:
        product = products.get(code(row.get("product_code")).casefold())
        item = dict(row)
        item["entity_name"] = names.get("entities", {}).get(code(row.get("entity_code")).casefold())
        item["block_name"] = names.get("blocks", {}).get(code(row.get("block_code")).casefold())
        item["product_name"] = getattr(product, "product_name", None)
        item["unit"] = getattr(product, "unit", None)
        if drop_date:
            item.pop("entry_date", None)
        decorated.append(item)
    return decorated


def decorate_totals(totals: Iterable[dict], names: dict) -> list[dict]:
    products = names.get("products", {})
    result = []
    for total in totals:
        product = products.get(code(total.get("product_code")).casefold())
        result.append({
            **total,
            "product_name": getattr(product, "product_name", total.get("product_code")),
            "unit": getattr(product, "unit", ""),
        })
    return result
