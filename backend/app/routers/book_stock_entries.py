"""Book Data — Book Stock Management: daily stock entries, bulk upload,
block / entity summaries and dashboard data."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.models import BookStockDailyEntry, BookStockField, BookStockFieldProduction, BookStockFieldStock, BookStockSubFieldProduction, BookStockProduct, User
from app.routers.book_stock_common import (
    MAX_BULK_ROWS,
    MAX_SUMMARY_ROWS,
    MODULE,
    actor_name,
    ci,
    code,
    decorate,
    decorate_totals,
    entry_query,
    entry_response,
    entity_allowed,
    field_can_produce,
    name_maps,
    previous_entry,
    product_response,
    resolve_block,
    resolve_entity,
    resolve_product,
    same,
    settings_map,
    setting_value,
    snapshot,
    summary_rows,
    visible_entity_codes,
)
from app.schemas import (
    BookStockDailyEntryCreate,
    BookStockDailyEntryUpdate,
)
from app.services.audit_service import create_audit_log
from app.services.book_stock_calculations import (
    aggregate_block_rows,
    aggregate_entity_day_rows,
    build_dashboard,
    is_yes,
    latest_entity_totals,
    round_qty,
    totals_by_product,
)

from app.routers.book_stock_hierarchy import (save_hierarchy_entry, previous_field_stock,
    recalculate_field_chain, lock_stock_keys, last_legacy_entry)

router = APIRouter(prefix="/book-stock", tags=["Book Stock Management"])


# ---------------------------------------------------------------------------
# Daily entries
# ---------------------------------------------------------------------------

@router.get("/daily-entries/opening")
def get_opening_suggestion(
    entity_code: str = Query(...),
    block_code: str = Query(...),
    product_code: str = Query(...),
    entry_date: date = Query(...),
    field_id: int = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Book Stock Entry", db)
    codes = visible_entity_codes(current_user, db)
    entity = resolve_entity(db, entity_code, current_user, codes)
    block = resolve_block(db, entity, block_code)
    product = resolve_product(db, product_code, require_active=False)
    previous = previous_entry(db, entity.entity_code, block.block_code, product.product_code, entry_date)
    if field_id is not None:
        field = db.query(BookStockField).filter_by(id=field_id).first()
        if not field or not same(field.entity_code, entity.entity_code) or not same(field.block_code, block.block_code):
            raise HTTPException(400, 'Main field does not belong to this entity and block.')
        if not field_can_produce(db, field, product.product_code):
            raise HTTPException(400, 'Main field is not configured for this product.')
        previous_field = previous_field_stock(db, field.id, entity.entity_code, block.block_code, product.product_code, entry_date)
        legacy_block_previous = last_legacy_entry(db, entity.entity_code, block.block_code, product.product_code, before=entry_date) is not None
        previous = previous_field[0] if previous_field else None
        previous_date = previous_field[1] if previous_field else None
    else:
        legacy_block_previous = False
        previous_date = previous.entry_date if previous else None
    settings = settings_map(db)
    return {
        "legacy_block_previous": legacy_block_previous and previous is None,
        "opening_stock": round_qty(previous.closing_stock) if previous else 0.0,
        "previous_entry_date": previous_date.isoformat() if previous_date else None,
        "previous_closing_stock": round_qty(previous.closing_stock) if previous else None,
        "auto_carry_enabled": is_yes(setting_value(settings, "auto_carry_opening", "Yes")),
        "allow_negative_closing": is_yes(setting_value(settings, "allow_negative_closing", "Yes")),
        "entity_code": entity.entity_code,
        "block_code": block.block_code,
        "product_code": product.product_code,
        "product_name": product.product_name,
        "unit": product.unit,
    }


@router.get("/daily-entries")
def list_daily_entries(
    entity_code: str = Query(None),
    block_code: str = Query(None),
    product_code: str = Query(None),
    date_from: date = Query(None),
    date_to: date = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Book Stock Entry", db)
    limit = min(max(int(limit or 200), 1), MAX_SUMMARY_ROWS)
    query = entry_query(
        db, current_user,
        entity_code=entity_code, block_code=block_code, product_code=product_code,
        date_from=date_from, date_to=date_to,
    )
    total = query.count()
    rows = (
        query.order_by(
            BookStockDailyEntry.entry_date.desc(),
            BookStockDailyEntry.entity_code,
            BookStockDailyEntry.block_code,
            BookStockDailyEntry.product_code,
        )
        .offset(skip)
        .limit(limit)
        .all()
    )
    names = name_maps(db)
    return {
        "items": [entry_response(row, db, names) for row in rows],
        "total": total,
        "skip": skip,
        "limit": limit,
        "has_more": skip + limit < total,
    }


@router.get("/daily-entries/{entry_id}")
def get_daily_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Book Stock Entry", db)
    entry = db.query(BookStockDailyEntry).filter(BookStockDailyEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Book stock entry not found.")
    if not entity_allowed(visible_entity_codes(current_user, db), entry.entity_code):
        raise HTTPException(status_code=404, detail="Book stock entry not found.")
    return entry_response(entry, db)


@router.post("/daily-entries")
def create_daily_entry(
    data: BookStockDailyEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "Create Book Stock Entry", db)
    try:
        entry = save_hierarchy_entry(db, data, current_user)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(entry)
    return entry_response(entry, db)


@router.put("/daily-entries/{entry_id}")
def update_daily_entry(
    entry_id: int,
    data: BookStockDailyEntryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "Edit Book Stock Entry", db)
    entry = db.query(BookStockDailyEntry).filter(BookStockDailyEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Book stock entry not found.")
    codes = visible_entity_codes(current_user, db)
    if not entity_allowed(codes, entry.entity_code):
        raise HTTPException(status_code=403, detail="This stock entry is outside your assigned location scope.")

    if (data.opening_stock is not None or data.dispatch is not None or data.adjustment is not None
            or data.field_productions is not None or data.carry_opening is not None):
        raise HTTPException(400, 'Block-level inputs are no longer accepted; enter values per main field.')
    if not data.field_stocks:
        raise HTTPException(400, 'Field stock rows are required to update this entry.')
    payload = BookStockDailyEntryCreate(
        entry_date=data.entry_date or entry.entry_date,
        entity_code=data.entity_code or entry.entity_code,
        block_code=data.block_code or entry.block_code,
        product_code=data.product_code or entry.product_code,
        remarks=data.remarks if data.remarks is not None else entry.remarks,
        field_stocks=data.field_stocks,
    )
    try:
        entry = save_hierarchy_entry(db, payload, current_user, entry)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(entry)
    return entry_response(entry, db)


@router.delete("/daily-entries/{entry_id}")
def delete_daily_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "Delete Book Stock Entry", db)
    entry = db.query(BookStockDailyEntry).filter(BookStockDailyEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Book stock entry not found.")
    if not entity_allowed(visible_entity_codes(current_user, db), entry.entity_code):
        raise HTTPException(status_code=403, detail="This stock entry is outside your assigned location scope.")
    lock_key = (entry.entity_code, entry.block_code, entry.product_code)
    lock_stock_keys(db, lock_key)
    db.refresh(entry)
    if tuple(code(v).casefold() for v in (entry.entity_code, entry.block_code, entry.product_code)) != tuple(code(v).casefold() for v in lock_key):
        raise HTTPException(409, 'The entry changed concurrently; reload and try again.')
    before = snapshot(entry, db)
    label = f"{entry.entry_date.isoformat()} · {entry.entity_code} / {entry.block_code} / {entry.product_code}"
    field_stocks = db.query(BookStockFieldStock).filter_by(entry_id=entry.id).all()
    for stock in field_stocks:
        db.query(BookStockSubFieldProduction).filter_by(field_stock_id=stock.id).delete(synchronize_session=False)
        db.delete(stock)
    db.query(BookStockFieldProduction).filter(BookStockFieldProduction.entry_id == entry.id).delete(synchronize_session=False)
    db.delete(entry)
    db.flush()
    try:
        recalculate_field_chain(db, entry.entity_code, entry.block_code, entry.product_code, current_user)
    except Exception:
        db.rollback()
        raise
    create_audit_log(
        db, MODULE, "Delete Book Stock Entry", current_user,
        entity_type="BookStockDailyEntry", entity_id=entry_id, entity_label=label,
        details={"before": before},
    )
    db.commit()
    return {"detail": "Book stock entry permanently deleted.", "id": entry_id}


@router.post("/daily-entries/bulk-upload")
def bulk_upload_daily_entries(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    """Create many daily entries with per-row partial success.

    A malformed row is reported on its own (with the server's message) so the
    ImportDialog can offer the file back for correction; valid rows are saved
    and audited exactly like a single entry.
    """
    require_user_permission(current_user, "Create Book Stock Entry", db)
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=400, detail="No rows were supplied.")
    if len(items) > MAX_BULK_ROWS:
        raise HTTPException(status_code=400, detail=f"A maximum of {MAX_BULK_ROWS} rows can be uploaded at once.")

    # Lock all keys in sorted order before processing rows, so concurrent bulk
    # imports cannot deadlock by presenting blocks in opposite orders.
    lock_stock_keys(db, *((item.get('entity_code'), item.get('block_code'), item.get('product_code'))
                           for item in items if isinstance(item, dict)))
    results = []
    created_ids: list[int] = []
    for index, raw in enumerate(items, start=1):
        try:
            if not isinstance(raw, dict):
                raise HTTPException(status_code=400, detail="Row is not an object.")
            import json
            normalized = dict(raw)
            if isinstance(normalized.get('field_stocks'), str):
                try:
                    normalized['field_stocks'] = json.loads(normalized['field_stocks'])
                except (ValueError, TypeError):
                    raise HTTPException(400, 'Field stocks must be a JSON array.')
            create_payload = BookStockDailyEntryCreate(**normalized)
            savepoint = db.begin_nested()
            try:
                entry = save_hierarchy_entry(db, create_payload, current_user)
                savepoint.commit()
            except Exception:
                savepoint.rollback()
                raise
            db.flush()
            created_ids.append(entry.id)
            results.append({
                "row": index,
                "status": "imported",
                "id": entry.id,
                "message": f"Saved {entry.entry_date.isoformat()} {entry.block_code} {entry.product_code}",
            })
        except HTTPException as exc:
            results.append({"row": index, "status": "failed", "message": str(exc.detail)})
        except Exception as exc:  # noqa: BLE001 - report the row, not the whole file
            results.append({"row": index, "status": "failed", "message": str(exc)})
    db.commit()
    imported = sum(1 for row in results if row["status"] == "imported")
    return {
        "results": results,
        "imported": imported,
        "failed": len(results) - imported,
        "total": len(results),
        "ids": created_ids,
    }


# ---------------------------------------------------------------------------
# Summaries / visualisations
# ---------------------------------------------------------------------------

def _summary_names(db: Session) -> dict:
    return name_maps(db)


@router.get("/block-summary")
def get_block_summary(
    entity_code: str = Query(None),
    block_code: str = Query(None),
    product_code: str = Query(None),
    date_from: date = Query(None),
    date_to: date = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Book Stock Report", db)
    rows = summary_rows(
        db, current_user,
        entity_code=entity_code, block_code=block_code, product_code=product_code,
        date_from=date_from, date_to=date_to,
    )
    names = _summary_names(db)
    block_rows = aggregate_block_rows(rows)
    return {
        "items": [
            entry_response(row, db, names, lines=[]) for row in rows
        ],
        "block_totals": decorate(block_rows, names, drop_date=False),
        "totals_by_product": decorate_totals(totals_by_product(rows), names),
        "products": [product_response(row) for row in db.query(BookStockProduct).all()],
        "date_from": min((row.entry_date for row in rows), default=None),
        "date_to": max((row.entry_date for row in rows), default=None),
        "entry_count": len(rows),
    }


@router.get("/entity-summary")
def get_entity_summary(
    entity_code: str = Query(None),
    block_code: str = Query(None),
    product_code: str = Query(None),
    date_from: date = Query(None),
    date_to: date = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Book Stock Report", db)
    rows = summary_rows(
        db, current_user,
        entity_code=entity_code, block_code=block_code, product_code=product_code,
        date_from=date_from, date_to=date_to,
    )
    names = _summary_names(db)
    return {
        "items": decorate(aggregate_entity_day_rows(rows), names),
        "latest": decorate(latest_entity_totals(rows), names),
        "block_totals": decorate(aggregate_block_rows(rows), names, drop_date=True),
        "totals_by_product": decorate_totals(totals_by_product(rows), names),
        "products": [product_response(row) for row in db.query(BookStockProduct).all()],
        "date_from": min((row.entry_date for row in rows), default=None),
        "date_to": max((row.entry_date for row in rows), default=None),
        "entry_count": len(rows),
    }


@router.get("/dashboard")
def get_dashboard(
    entity_code: str = Query(None),
    block_code: str = Query(None),
    product_code: str = Query(None),
    date_from: date = Query(None),
    date_to: date = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Book Stock Dashboard", db)
    rows = summary_rows(
        db, current_user,
        entity_code=entity_code, block_code=block_code, product_code=product_code,
        date_from=date_from, date_to=date_to,
    )
    names = _summary_names(db)
    products = [product_response(row) for row in db.query(BookStockProduct).all()]
    dashboard = build_dashboard(rows, products)
    dashboard["totals_by_product"] = decorate_totals(dashboard["totals_by_product"], names)
    dashboard["entity_totals"] = decorate(dashboard["entity_totals"], names)
    dashboard["block_totals"] = decorate(dashboard["block_totals"], names, drop_date=True)
    dashboard["daily_trend"] = decorate(dashboard["daily_trend"], names)
    dashboard["products"] = products
    dashboard["date_from"] = min((row.entry_date for row in rows), default=None)
    dashboard["date_to"] = max((row.entry_date for row in rows), default=None)
    dashboard["entry_count"] = len(rows)
    return dashboard
