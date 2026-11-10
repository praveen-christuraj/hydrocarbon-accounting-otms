"""Field-level stock sheets and sub-field masters.

The original block sheets remain the reporting roll-up.  Legacy sheets have no
field balances and are never silently allocated or rewritten.
"""

from math import isfinite
from hashlib import sha256

from fastapi import HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.models import (
    BookStockDailyEntry,
    BookStockField,
    BookStockFieldProduction,
    BookStockFieldStock,
    BookStockSubField,
    BookStockSubFieldProduction,
)
from app.routers.book_stock_common import (
    MODULE,
    actor_name,
    ci,
    code,
    duplicate_entry,
    entity_allowed,
    field_can_produce,
    resolve_block,
    resolve_entity,
    resolve_product,
    settings_map,
    setting_value,
    snapshot,
    visible_entity_codes,
)
from app.services.audit_service import create_audit_log
from app.services.book_stock_calculations import (
    compute_closing_stock,
    is_yes,
    round_qty,
)

LEGACY_CODE = "__LEGACY__"


def lock_stock_keys(db, *keys):
    """Serialize writes and carry-forward for the same block/product on Postgres."""
    if db.bind.dialect.name != "postgresql":
        return
    normalized = sorted(
        {tuple(code(part).casefold() for part in key) for key in keys if key}
    )
    for key in normalized:
        digest = sha256(("book-stock:" + "\x1f".join(key)).encode()).digest()
        lock_id = int.from_bytes(digest[:8], "big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_id})


def backfill_legacy_subfields(db: Session):
    """Create one reserved source for each identifiable historical field.

    Existing production and stock rows are never changed. The source is exposed
    as a virtual line on legacy sheets; old block balances cannot be allocated.
    """
    fields = db.query(BookStockField).all()
    historical = (
        db.query(BookStockFieldProduction.field_id, BookStockFieldProduction.field_code)
        .outerjoin(
            BookStockFieldStock,
            BookStockFieldProduction.entry_id == BookStockFieldStock.entry_id,
        )
        .filter(BookStockFieldStock.id.is_(None))
        .distinct()
        .all()
    )
    historical_ids = {field_id for field_id, _ in historical if field_id is not None}
    historical_codes = {
        code(field_code).casefold()
        for field_id, field_code in historical
        if field_id is None
    }
    for field in fields:
        if (
            field.id not in historical_ids
            and code(field.field_code).casefold() not in historical_codes
        ):
            continue
        existing = (
            db.query(BookStockSubField)
            .filter(
                BookStockSubField.field_id == field.id,
                ci(BookStockSubField.sub_field_code) == LEGACY_CODE.casefold(),
            )
            .first()
        )
        if not existing:
            # Multiple application workers may start concurrently.
            db.execute(
                text("""INSERT INTO book_stock_sub_fields
                (field_id, sub_field_code, sub_field_name, entity_code, block_code, status, description)
                VALUES (:field_id, :sub_code, :name, :entity, :block, 'Inactive', :description)
                ON CONFLICT (field_id, sub_field_code) DO NOTHING"""),
                {
                    "field_id": field.id,
                    "sub_code": LEGACY_CODE,
                    "name": "Historical production",
                    "entity": field.entity_code,
                    "block": field.block_code,
                    "description": "Reserved for historical field production.",
                },
            )
    db.flush()


def sub_field_response(sub, field):
    return {
        "id": sub.id,
        "field_id": sub.field_id,
        "field_code": field.field_code,
        "field_name": field.field_name,
        "entity_code": field.entity_code,
        "block_code": field.block_code,
        "sub_field_code": sub.sub_field_code,
        "sub_field_name": sub.sub_field_name,
        "description": sub.description,
        "status": sub.status,
        "created_at": sub.created_at,
        "updated_at": sub.updated_at,
    }


def list_field_stocks(db, entry_id):
    stocks = (
        db.query(BookStockFieldStock)
        .filter_by(entry_id=entry_id)
        .order_by(BookStockFieldStock.id)
        .all()
    )
    result = []
    for stock in stocks:
        lines = (
            db.query(BookStockSubFieldProduction)
            .filter_by(field_stock_id=stock.id)
            .order_by(BookStockSubFieldProduction.id)
            .all()
        )
        result.append(
            {
                "id": stock.id,
                "field_id": stock.field_id,
                "field_code": stock.field_code,
                "field_name": stock.field_name,
                "opening_stock": round_qty(stock.opening_stock),
                "production": round_qty(stock.production),
                "dispatch": round_qty(stock.dispatch),
                "adjustment": round_qty(stock.adjustment),
                "closing_stock": round_qty(stock.closing_stock),
                "opening_carried": stock.opening_carried,
                "sub_field_productions": [
                    {
                        "id": line.id,
                        "sub_field_id": line.sub_field_id,
                        "sub_field_code": line.sub_field_code,
                        "sub_field_name": line.sub_field_name,
                        "production_qty": round_qty(line.production_qty),
                    }
                    for line in lines
                ],
            }
        )
    return result


def previous_field_stock(
    db, field_id, entity_code, block_code, product_code, entry_date, exclude_id=None
):
    q = (
        db.query(BookStockFieldStock, BookStockDailyEntry.entry_date)
        .join(
            BookStockDailyEntry, BookStockFieldStock.entry_id == BookStockDailyEntry.id
        )
        .filter(
            BookStockFieldStock.field_id == field_id,
            ci(BookStockDailyEntry.entity_code) == code(entity_code).casefold(),
            ci(BookStockDailyEntry.block_code) == code(block_code).casefold(),
            ci(BookStockDailyEntry.product_code) == code(product_code).casefold(),
            BookStockDailyEntry.entry_date < entry_date,
        )
    )
    if exclude_id is not None:
        q = q.filter(BookStockDailyEntry.id != exclude_id)
    return q.order_by(
        BookStockDailyEntry.entry_date.desc(), BookStockDailyEntry.id.desc()
    ).first()


def _rollup(entry, stocks):
    for col in (
        "opening_stock",
        "production",
        "dispatch",
        "adjustment",
        "closing_stock",
    ):
        total = round_qty(sum(getattr(s, col) for s in stocks))
        if not isfinite(total):
            raise HTTPException(
                400,
                f"Block {col.replace('_', ' ')} exceeds the supported numeric range.",
            )
        setattr(entry, col, total)
    entry.opening_carried = (
        "Yes" if stocks and all(s.opening_carried == "Yes" for s in stocks) else "No"
    )


def recalculate_field_chain(db, entity_code, block_code, product_code, user):
    settings = settings_map(db)
    allow_negative = is_yes(setting_value(settings, "allow_negative_closing", "Yes"))
    rows = (
        db.query(BookStockDailyEntry)
        .filter(
            ci(BookStockDailyEntry.entity_code) == code(entity_code).casefold(),
            ci(BookStockDailyEntry.block_code) == code(block_code).casefold(),
            ci(BookStockDailyEntry.product_code) == code(product_code).casefold(),
        )
        .order_by(BookStockDailyEntry.entry_date, BookStockDailyEntry.id)
        .all()
    )
    previous = {}
    legacy = last_legacy_entry(db, entity_code, block_code, product_code)
    for entry in rows:
        stocks = (
            db.query(BookStockFieldStock)
            .filter_by(entry_id=entry.id)
            .order_by(BookStockFieldStock.id)
            .all()
        )
        if not stocks:  # historical block-level entry: do not fabricate field balances
            continue
        before = list_field_stocks(db, entry.id)
        for stock in stocks:
            old_opening = round_qty(stock.opening_stock)
            old_closing = round_qty(stock.closing_stock)
            if stock.opening_carried == "Yes":
                if legacy and stock.field_id not in previous:
                    raise HTTPException(
                        400,
                        f"Main field {stock.field_code} needs an explicit opening after the historical block-level sheet; update the next entry before deleting or moving its starting balance.",
                    )
                stock.opening_stock = round_qty(previous.get(stock.field_id, 0))
            stock.closing_stock = compute_closing_stock(
                stock.opening_stock, stock.production, stock.dispatch, stock.adjustment
            )
            if (
                not allow_negative
                and stock.closing_stock < 0
                and (
                    old_opening != round_qty(stock.opening_stock)
                    or old_closing != stock.closing_stock
                )
            ):
                raise HTTPException(
                    400,
                    f"Carrying stock forward would make main field {stock.field_code} negative on {entry.entry_date}.",
                )
            previous[stock.field_id] = stock.closing_stock
        _rollup(entry, stocks)
        db.flush()
        after = list_field_stocks(db, entry.id)
        if before != after:
            entry.updated_by = actor_name(user)
            create_audit_log(
                db,
                MODULE,
                "Recalculate Book Stock Entry",
                user,
                entity_type="BookStockDailyEntry",
                entity_id=entry.id,
                entity_label=f"{entry.entry_date} · {entry.entity_code} / {entry.block_code} / {entry.product_code}",
                details={
                    "before": before,
                    "after": after,
                    "trigger": "Field opening roll-forward",
                },
            )


def last_legacy_entry(db, entity_code, block_code, product_code, before=None):
    query = (
        db.query(BookStockDailyEntry)
        .outerjoin(
            BookStockFieldStock, BookStockFieldStock.entry_id == BookStockDailyEntry.id
        )
        .filter(
            ci(BookStockDailyEntry.entity_code) == code(entity_code).casefold(),
            ci(BookStockDailyEntry.block_code) == code(block_code).casefold(),
            ci(BookStockDailyEntry.product_code) == code(product_code).casefold(),
            BookStockFieldStock.id.is_(None),
        )
    )
    if before is not None:
        query = query.filter(BookStockDailyEntry.entry_date < before)
    return query.order_by(BookStockDailyEntry.entry_date.desc()).first()


def save_hierarchy_entry(db, payload, user, entry=None):
    codes = visible_entity_codes(user, db)
    if entry is not None and not entity_allowed(codes, entry.entity_code):
        raise HTTPException(
            403, "This stock entry is outside your assigned location scope."
        )
    entity = resolve_entity(db, payload.entity_code, user, codes)
    block = resolve_block(db, entity, payload.block_code)
    product = resolve_product(db, payload.product_code, require_active=entry is None)
    old_lock_key = (
        (entry.entity_code, entry.block_code, entry.product_code) if entry else None
    )
    lock_stock_keys(
        db, old_lock_key, (entity.entity_code, block.block_code, product.product_code)
    )
    if entry:
        db.refresh(entry)
        if tuple(
            code(v).casefold()
            for v in (entry.entity_code, entry.block_code, entry.product_code)
        ) != tuple(code(v).casefold() for v in old_lock_key):
            raise HTTPException(
                409, "The entry changed concurrently; reload and try again."
            )
        if tuple(code(v).casefold() for v in old_lock_key) != tuple(
            code(v).casefold()
            for v in (entity.entity_code, block.block_code, product.product_code)
        ):
            raise HTTPException(
                400, "An entry cannot be moved to another entity, block or product."
            )
    if (
        "carry_opening" in payload.model_fields_set
        or payload.opening_stock is not None
        or payload.dispatch != 0
        or payload.adjustment != 0
        or payload.field_productions
    ):
        raise HTTPException(
            400,
            "Block-level stock inputs are no longer accepted; enter values per main field.",
        )
    duplicate = duplicate_entry(
        db,
        entity.entity_code,
        block.block_code,
        product.product_code,
        payload.entry_date,
        exclude_id=entry.id if entry else None,
    )
    if duplicate:
        raise HTTPException(
            400,
            "A stock entry already exists for this date, entity, block and product.",
        )
    # There is no defensible field-level carry across an unallocated legacy
    # block sheet. Force an explicit cutover after the last historical sheet.
    last_legacy = last_legacy_entry(
        db, entity.entity_code, block.block_code, product.product_code
    )
    if last_legacy and payload.entry_date <= last_legacy.entry_date:
        raise HTTPException(
            400,
            "Field-level entries must start after the last historical block-level entry.",
        )
    if not payload.field_stocks:
        raise HTTPException(
            400, "Enter stock and sub-field production for each main field."
        )
    fields = (
        db.query(BookStockField)
        .filter(
            ci(BookStockField.entity_code) == code(entity.entity_code).casefold(),
            ci(BookStockField.block_code) == code(block.block_code).casefold(),
            func.lower(func.trim(BookStockField.status)) == "active",
        )
        .all()
    )
    eligible = {
        f.id: f for f in fields if field_can_produce(db, f, product.product_code)
    }
    supplied = [line.field_id for line in payload.field_stocks]
    if (
        len(set(supplied)) != len(supplied)
        or set(supplied) != set(eligible)
        or not eligible
    ):
        raise HTTPException(
            400,
            "Provide exactly one stock row for every active main field producing this product in the block.",
        )
    settings = settings_map(db)
    auto = is_yes(setting_value(settings, "auto_carry_opening", "Yes"))
    allow_negative = is_yes(setting_value(settings, "allow_negative_closing", "Yes"))
    allow_adjustment = is_yes(
        setting_value(settings, "allow_negative_adjustment", "Yes")
    )
    prepared = []
    for line in payload.field_stocks:
        field = eligible[line.field_id]
        if line.adjustment < 0 and not allow_adjustment:
            raise HTTPException(
                400, "Negative adjustments are disabled in Book Stock settings."
            )
        subs = (
            db.query(BookStockSubField)
            .filter(
                BookStockSubField.field_id == field.id,
                func.lower(func.trim(BookStockSubField.status)) == "active",
            )
            .all()
        )
        valid = {s.id: s for s in subs}
        # Historical source lines remain editable even after a sub-field is
        # deactivated. They must not disappear on a later correction.
        if entry is not None:
            old_lines = (
                db.query(BookStockSubField)
                .join(
                    BookStockSubFieldProduction,
                    BookStockSubFieldProduction.sub_field_id == BookStockSubField.id,
                )
                .join(
                    BookStockFieldStock,
                    BookStockSubFieldProduction.field_stock_id
                    == BookStockFieldStock.id,
                )
                .filter(
                    BookStockFieldStock.entry_id == entry.id,
                    BookStockFieldStock.field_id == field.id,
                )
                .all()
            )
            valid.update({s.id: s for s in old_lines})
        ids = [s.sub_field_id for s in line.sub_field_productions]
        if not valid or len(ids) != len(set(ids)) or set(ids) != set(valid):
            raise HTTPException(
                400,
                f"Provide exactly one production value for each active sub-field of {field.field_code}.",
            )
        previous = previous_field_stock(
            db,
            field.id,
            entity.entity_code,
            block.block_code,
            product.product_code,
            payload.entry_date,
            entry.id if entry else None,
        )
        old_stock = (
            db.query(BookStockFieldStock)
            .filter_by(entry_id=entry.id, field_id=field.id)
            .first()
            if entry
            else None
        )
        carried = (
            line.opening_stock is None
            and line.carry_opening
            and (auto or (old_stock is not None and old_stock.opening_carried == "Yes"))
        )
        if last_legacy and previous is None and line.opening_stock is None:
            raise HTTPException(
                400,
                f"Enter an explicit opening for {field.field_code}; historical block stock cannot be automatically allocated.",
            )
        opening = round_qty(
            previous[0].closing_stock
            if previous and carried
            else (line.opening_stock or 0)
        )
        production = round_qty(
            sum(round_qty(s.production_qty) for s in line.sub_field_productions)
        )
        closing = compute_closing_stock(
            opening, production, round_qty(line.dispatch), round_qty(line.adjustment)
        )
        if not all(isfinite(v) for v in (opening, production, closing)):
            raise HTTPException(400, "Quantities must be finite.")
        if not allow_negative and closing < 0:
            raise HTTPException(
                400,
                f"Closing stock for main field {field.field_code} would be negative.",
            )
        prepared.append((field, line, valid, opening, production, closing, carried))

    old_key = (
        (entry.entity_code, entry.block_code, entry.product_code) if entry else None
    )
    if entry is not None:
        if not db.query(BookStockFieldStock.id).filter_by(entry_id=entry.id).first():
            raise HTTPException(
                400,
                "Historical block-level entries cannot be edited as field-level stock. Historical balances have not been allocated.",
            )
        before = snapshot(entry, db)
        old_stocks = db.query(BookStockFieldStock).filter_by(entry_id=entry.id).all()
        for old in old_stocks:
            db.query(BookStockSubFieldProduction).filter_by(
                field_stock_id=old.id
            ).delete(synchronize_session=False)
            db.delete(old)
        db.query(BookStockFieldProduction).filter_by(entry_id=entry.id).delete(
            synchronize_session=False
        )
        db.flush()
    else:
        before = None
        entry = BookStockDailyEntry(
            created_by=actor_name(user),
            entry_date=payload.entry_date,
            entity_code=entity.entity_code,
            block_code=block.block_code,
            product_code=product.product_code,
        )
        db.add(entry)
        db.flush()
    entry.entry_date = payload.entry_date
    entry.entity_code, entry.block_code, entry.product_code = (
        entity.entity_code,
        block.block_code,
        product.product_code,
    )
    entry.remarks, entry.updated_by = (
        payload.remarks or ""
    ).strip() or None, actor_name(user)
    stocks = []
    for field, line, subs, opening, production, closing, carried in prepared:
        stock = BookStockFieldStock(
            entry_id=entry.id,
            field_id=field.id,
            field_code=field.field_code,
            field_name=field.field_name,
            entry_date=entry.entry_date,
            entity_code=entry.entity_code,
            block_code=entry.block_code,
            product_code=entry.product_code,
            opening_stock=opening,
            production=production,
            dispatch=round_qty(line.dispatch),
            adjustment=round_qty(line.adjustment),
            closing_stock=closing,
            opening_carried="Yes" if carried else "No",
        )
        db.add(stock)
        db.flush()
        stocks.append(stock)
        for source in line.sub_field_productions:
            sub = subs[source.sub_field_id]
            db.add(
                BookStockSubFieldProduction(
                    field_stock_id=stock.id,
                    sub_field_id=sub.id,
                    field_id=field.id,
                    field_code=field.field_code,
                    field_name=field.field_name,
                    sub_field_code=sub.sub_field_code,
                    sub_field_name=sub.sub_field_name,
                    entry_date=entry.entry_date,
                    entity_code=entry.entity_code,
                    block_code=entry.block_code,
                    product_code=entry.product_code,
                    production_qty=round_qty(source.production_qty),
                )
            )
        # Preserve the existing field-production reporting interface.
        db.add(
            BookStockFieldProduction(
                entry_id=entry.id,
                field_id=field.id,
                field_code=field.field_code,
                field_name=field.field_name,
                entity_code=entry.entity_code,
                block_code=entry.block_code,
                product_code=entry.product_code,
                production_qty=production,
            )
        )
    _rollup(entry, stocks)
    db.flush()
    if old_key:
        recalculate_field_chain(db, *old_key, user)
    new_key = (entry.entity_code, entry.block_code, entry.product_code)
    if not old_key or old_key != new_key:
        recalculate_field_chain(db, *new_key, user)
    db.flush()
    create_audit_log(
        db,
        MODULE,
        "Edit Book Stock Entry" if before is not None else "Create Book Stock Entry",
        user,
        entity_type="BookStockDailyEntry",
        entity_id=entry.id,
        entity_label=f"{entry.entry_date} · {entry.entity_code} / {entry.block_code} / {entry.product_code}",
        remarks=entry.remarks,
        details={"before": before, "after": snapshot(entry, db)},
    )
    return entry
