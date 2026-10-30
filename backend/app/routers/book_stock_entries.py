"""Government Data — Book Stock Management: daily stock entries, bulk upload,
block / entity summaries and dashboard data."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.models import BookStockDailyEntry, BookStockField, BookStockFieldProduction, BookStockProduct, User
from app.routers.book_stock_common import (
    MAX_BULK_ROWS,
    MAX_SUMMARY_ROWS,
    MODULE,
    actor_name,
    ci,
    code,
    create_entry,
    decorate,
    decorate_totals,
    duplicate_entry,
    entry_lines,
    entry_query,
    entry_response,
    entity_allowed,
    entry_totals,
    field_can_produce,
    name_maps,
    previous_entry,
    product_response,
    recalculate_carried_chain,
    require_any_view,
    resolve_block,
    resolve_entity,
    resolve_field,
    resolve_product,
    same,
    settings_map,
    setting_value,
    snapshot,
    summary_rows,
    validate_field_lines,
    visible_entity_codes,
    write_field_rows,
)
from app.schemas import (
    BookStockDailyEntryCreate,
    BookStockDailyEntryUpdate,
    BookStockFieldProductionBulkRow,
    BookStockFieldProductionInput,
)
from app.services.audit_service import create_audit_log
from app.services.book_stock_calculations import (
    aggregate_block_rows,
    aggregate_entity_day_rows,
    build_dashboard,
    is_yes,
    latest_entity_totals,
    round_qty,
    to_float,
    totals_by_product,
)

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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Book Stock Entry", db)
    codes = visible_entity_codes(current_user, db)
    entity = resolve_entity(db, entity_code, current_user, codes)
    block = resolve_block(db, entity, block_code)
    product = resolve_product(db, product_code, require_active=False)
    previous = previous_entry(db, entity.entity_code, block.block_code, product.product_code, entry_date)
    settings = settings_map(db)
    return {
        "opening_stock": round_qty(previous.closing_stock) if previous else 0.0,
        "previous_entry_date": previous.entry_date.isoformat() if previous else None,
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
    entry = create_entry(db, data, current_user)
    db.commit()
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

    before = snapshot(entry, db)
    old_key = (entry.entity_code, entry.block_code, entry.product_code)
    target_date = data.entry_date or entry.entry_date
    target_entity_code = data.entity_code or entry.entity_code
    target_block_code = data.block_code or entry.block_code
    target_product_code = data.product_code or entry.product_code

    entity = resolve_entity(db, target_entity_code, current_user, codes)
    block = resolve_block(db, entity, target_block_code)
    product = resolve_product(db, target_product_code, require_active=False)

    key_changed = (
        target_date != entry.entry_date
        or not same(entity.entity_code, entry.entity_code)
        or not same(block.block_code, entry.block_code)
        or not same(product.product_code, entry.product_code)
    )
    duplicate = duplicate_entry(
        db, entity.entity_code, block.block_code, product.product_code, target_date, exclude_id=entry.id
    )
    if duplicate:
        raise HTTPException(
            status_code=400,
            detail=(
                f"A {product.product_code} stock entry already exists for block {block.block_code} "
                f"on {target_date.isoformat()}."
            ),
        )

    if data.field_productions is None:
        if key_changed:
            field_rows: list[dict] = []
        else:
            field_rows = [
                {"field": resolve_field(db, line.field_code, entity.entity_code, block.block_code),
                 "production_qty": round_qty(line.production_qty)}
                for line in entry_lines(db, entry.id)
            ]
    else:
        field_rows = validate_field_lines(
            db, data.field_productions, entity.entity_code, block.block_code, product.product_code
        )

    opening_input = data.opening_stock if data.opening_stock is not None else (None if key_changed else entry.opening_stock)
    totals = entry_totals(
        db,
        entity_code=entity.entity_code,
        block_code=block.block_code,
        product_code=product.product_code,
        entry_date=target_date,
        opening_stock=opening_input,
        dispatch=data.dispatch if data.dispatch is not None else entry.dispatch,
        adjustment=data.adjustment if data.adjustment is not None else entry.adjustment,
        carry_opening=bool(data.carry_opening) if data.carry_opening is not None else True,
        field_rows=field_rows,
        existing=entry,
        key_changed=key_changed,
        exclude_id=entry.id,
    )

    entry.entry_date = target_date
    entry.entity_code = entity.entity_code
    entry.block_code = block.block_code
    entry.product_code = product.product_code
    entry.opening_stock = totals["opening_stock"]
    entry.production = totals["production"]
    entry.dispatch = totals["dispatch"]
    entry.adjustment = totals["adjustment"]
    entry.closing_stock = totals["closing_stock"]
    entry.opening_carried = totals["opening_carried"]
    entry.remarks = (data.remarks if data.remarks is not None else entry.remarks) or None
    entry.updated_by = actor_name(current_user)
    db.flush()

    db.query(BookStockFieldProduction).filter(BookStockFieldProduction.entry_id == entry.id).delete(synchronize_session=False)
    db.flush()
    write_field_rows(db, entry, field_rows)
    db.flush()

    recalculate_carried_chain(db, *old_key, current_user)
    if (entry.entity_code, entry.block_code, entry.product_code) != old_key:
        recalculate_carried_chain(db, entry.entity_code, entry.block_code, entry.product_code, current_user)

    create_audit_log(
        db, MODULE, "Edit Book Stock Entry", current_user,
        entity_type="BookStockDailyEntry", entity_id=entry.id,
        entity_label=f"{entry.entry_date.isoformat()} · {entry.entity_code} / {entry.block_code} / {entry.product_code}",
        remarks=entry.remarks,
        details={"before": before, "after": snapshot(entry, db), "key_changed": key_changed},
    )
    db.commit()
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
    before = snapshot(entry, db)
    label = f"{entry.entry_date.isoformat()} · {entry.entity_code} / {entry.block_code} / {entry.product_code}"
    db.query(BookStockFieldProduction).filter(BookStockFieldProduction.entry_id == entry.id).delete(synchronize_session=False)
    db.delete(entry)
    db.flush()
    recalculate_carried_chain(db, entry.entity_code, entry.block_code, entry.product_code, current_user)
    create_audit_log(
        db, MODULE, "Delete Book Stock Entry", current_user,
        entity_type="BookStockDailyEntry", entity_id=entry_id, entity_label=label,
        details={"before": before},
    )
    db.commit()
    return {"detail": "Book stock entry deleted.", "id": entry_id}


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

    results = []
    created_ids: list[int] = []
    for index, raw in enumerate(items, start=1):
        try:
            if not isinstance(raw, dict):
                raise HTTPException(status_code=400, detail="Row is not an object.")
            payload = BookStockFieldProductionBulkRow(**raw)
            lines = payload.field_productions
            if isinstance(lines, str):
                parsed = []
                for part in [piece.strip() for piece in lines.replace("\n", ";").split(";") if piece.strip()]:
                    if "=" not in part:
                        raise HTTPException(status_code=400, detail=f"Production '{part}' must use FIELD_CODE=QTY.")
                    field_code, qty = part.split("=", 1)
                    parsed.append(BookStockFieldProductionInput(field_code=field_code.strip(), production_qty=to_float(qty)))
                lines = parsed
            create_payload = BookStockDailyEntryCreate(
                entry_date=payload.entry_date,
                entity_code=payload.entity_code,
                block_code=payload.block_code,
                product_code=payload.product_code,
                opening_stock=payload.opening_stock,
                dispatch=payload.dispatch,
                adjustment=payload.adjustment,
                carry_opening=True,
                remarks=payload.remarks,
                field_productions=lines or [],
            )
            savepoint = db.begin_nested()
            try:
                entry = create_entry(db, create_payload, current_user)
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
