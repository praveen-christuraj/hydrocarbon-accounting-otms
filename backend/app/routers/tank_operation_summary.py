from datetime import datetime, date
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import and_, func
import io
import csv

from app.database import get_db
from app.models import (
    Location,
    OperationTransaction,
    OperationTransactionValue,
    OperationTemplate,
    Asset,
    User,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    apply_transaction_party_scope_filter,
    ensure_location_in_user_scope,
    require_user_permission,
)
from app.utils.helpers import (
    clean_optional_text,
    get_transaction_ticket_number,
    get_asset_by_code,
    get_location_by_code,
)
from app.utils.spreadsheet import sanitize_spreadsheet_row
from app.services.operation_datetime import (
    coerce_payload_dict,
    format_time_hhmm,
    get_payload_operation_parts,
    resolve_transaction_accounting,
)
from app.services.transaction_helpers import parse_date_filter
from app.config import APPROVED_TRANSACTION_STATUS
from app.utils.pagination import (
    DEFAULT_REPORT_PAGE_SIZE,
    MAX_REPORT_PAGE_SIZE,
    clamp_limit,
    clamp_page,
    default_window_start,
)

router = APIRouter(prefix="/tank-operation-summary", tags=["Tank Operation Summary"])


def get_tank_gauging_payload_for_transaction(
    db: Session,
    transaction_id: int,
):
    payload_row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction_id,
            OperationTransactionValue.field_code == "tank_gauging_payload",
        )
        .first()
    )

    if payload_row is None or payload_row.field_value is None:
        return None

    parsed = coerce_payload_dict(payload_row.field_value)
    return parsed or None


def get_tank_gauging_payload_map(
    db: Session,
    transaction_ids,
) -> dict[int, dict]:
    """Batch version of ``get_tank_gauging_payload_for_transaction``."""
    ids = [tx_id for tx_id in dict.fromkeys(transaction_ids or []) if tx_id is not None]

    if not ids:
        return {}

    payload_map: dict[int, dict] = {}

    for row in (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id.in_(ids),
            OperationTransactionValue.field_code == "tank_gauging_payload",
        )
        .all()
    ):
        parsed = coerce_payload_dict(row.field_value)
        if parsed:
            payload_map[row.transaction_id] = parsed

    return payload_map


def extract_tank_gauging_columns(payload: dict):
    payload_dict = coerce_payload_dict(payload)
    if not payload_dict:
        return {}

    inputs = payload_dict.get("inputs") if isinstance(payload_dict.get("inputs"), dict) else {}
    calculated = (
        payload_dict.get("calculated")
        if isinstance(payload_dict.get("calculated"), dict)
        else {}
    )

    result = {}

    # Top-level input_/calc_ keys first, then canonical nested dicts take precedence.
    for key, value in payload_dict.items():
        if key in ("inputs", "calculated"):
            continue
        if key.startswith("input_") or key.startswith("calc_"):
            result[key] = value

    for key, value in inputs.items():
        clean_key = key if key.startswith("input_") else f"input_{key}"
        result[clean_key] = value

    for key, value in calculated.items():
        clean_key = key if key.startswith("calc_") else f"calc_{key}"
        result[clean_key] = value

    gauging_date, gauging_time = get_payload_operation_parts(
        payload_dict, "tank_gauging_payload"
    )
    if gauging_date is not None:
        result["input_gaugingDate"] = gauging_date.isoformat()
    if gauging_time is not None:
        result["input_gaugingTime"] = format_time_hhmm(gauging_time)

    return result


def get_all_possible_columns(
    db: Session,
    location_code: str | None = None,
    current_user: User | None = None,
):
    query = (
        db.query(OperationTransaction)
        .join(OperationTemplate, OperationTransaction.operation_template_id == OperationTemplate.id)
        .filter(
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            func.lower(func.trim(OperationTemplate.entry_layout_type)) == "tank gauging",
        )
    )

    if current_user is not None:
        query = apply_transaction_party_scope_filter(
            query, OperationTransaction, current_user, db
        )

    cleaned_location_code = clean_optional_text(location_code)
    if cleaned_location_code and current_user is not None:
        ensure_location_in_user_scope(
            current_user, db, cleaned_location_code, "Origin location"
        )
    if cleaned_location_code:
        query = query.filter(
            OperationTransaction.origin_location_code.ilike(cleaned_location_code)
        )

    transactions = query.limit(100).all()

    payload_map = get_tank_gauging_payload_map(db, [tx.id for tx in transactions])

    all_columns = set()

    for tx in transactions:
        payload = payload_map.get(tx.id)
        if payload:
            columns = extract_tank_gauging_columns(payload)
            all_columns.update(columns.keys())

    base_columns = [
        "transaction_id",
        "ticket_number",
        "operation_number",
        "accounting_date",
        "input_gaugingDate",
        "input_gaugingTime",
        "operation_date",
        "location_code",
        "location_name",
        "tank_asset_code",
        "tank_asset_name",
        "product_name",
        "status",
        "created_by",
        "created_at",
    ]

    sorted_extra = sorted([c for c in all_columns if c not in base_columns])

    return base_columns + sorted_extra


_UNSET = object()


def build_tank_operation_summary_row(
    transaction: OperationTransaction,
    payload: dict,
    db: Session,
    all_columns: list[str],
    location=_UNSET,
    asset=_UNSET,
    resolved=_UNSET,
):
    if location is _UNSET:
        location = get_location_by_code(transaction.origin_location_code, db)
    if asset is _UNSET:
        asset = get_asset_by_code(transaction.primary_asset_code, db)

    if resolved is _UNSET:
        resolved = resolve_transaction_accounting(
            db, transaction, payload=payload, field_code="tank_gauging_payload"
        )
    operation_date, operation_time, _operation_datetime, accounting_date = resolved

    extracted = extract_tank_gauging_columns(payload)
    effective_gauging_date = operation_date or transaction.operation_date
    effective_accounting_date = (
        accounting_date or effective_gauging_date or transaction.operation_date
    )

    row = {
        "transaction_id": transaction.id,
        "ticket_number": get_transaction_ticket_number(transaction),
        "operation_number": transaction.operation_number,
        "accounting_date": effective_accounting_date,
        "input_gaugingDate": extracted.get("input_gaugingDate")
        or (effective_gauging_date.isoformat() if effective_gauging_date else ""),
        "input_gaugingTime": extracted.get("input_gaugingTime")
        or (format_time_hhmm(operation_time) if operation_time else ""),
        "operation_date": effective_gauging_date,
        "location_code": transaction.origin_location_code,
        "location_name": location.location_name if location else "",
        "tank_asset_code": transaction.primary_asset_code,
        "tank_asset_name": asset.asset_name if asset else "",
        "product_name": transaction.product_name,
        "status": transaction.status,
        "created_by": transaction.created_by,
        "created_at": transaction.created_at,
    }

    for col in all_columns:
        if col not in row:
            row[col] = extracted.get(col, "")

    return row


def get_filtered_tank_operation_summary_rows(
    db: Session,
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: User | None = None,
    page: int | None = None,
    page_size: int | None = None,
    unbounded: bool = False,
):
    """Summary rows + column list + pagination/window metadata.

    Resolves every approved Tank Gauging ticket strictly from its payload
    gauging date & time + origin Location Accounting Day Setting, filters on
    the resolved accounting date (never on ``OperationTransaction.operation_date``),
    orders chronologically by ``(accounting_date, gauging_datetime, id)``, and
    paginates cleanly.
    """
    query = (
        db.query(OperationTransaction)
        .join(OperationTemplate, OperationTransaction.operation_template_id == OperationTemplate.id)
        .filter(
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            func.lower(func.trim(OperationTemplate.entry_layout_type)) == "tank gauging",
        )
    )

    if current_user is not None:
        query = apply_transaction_party_scope_filter(
            query, OperationTransaction, current_user, db
        )

    cleaned_location_code = clean_optional_text(location_code)
    cleaned_tank_asset_code = clean_optional_text(tank_asset_code)
    cleaned_product_name = clean_optional_text(product_name)

    if cleaned_location_code:
        if current_user is not None:
            ensure_location_in_user_scope(
                current_user, db, cleaned_location_code, "Origin location"
            )
        query = query.filter(
            OperationTransaction.origin_location_code.ilike(cleaned_location_code)
        )

    if cleaned_tank_asset_code:
        query = query.filter(
            OperationTransaction.primary_asset_code.ilike(cleaned_tank_asset_code)
        )

    if cleaned_product_name:
        query = query.filter(
            OperationTransaction.product_name.ilike(cleaned_product_name)
        )

    explicit_date_from = parse_date_filter(date_from, "Date From")
    date_from_value = explicit_date_from
    date_to_value = parse_date_filter(date_to, "Date To")

    payload_query = query.join(
        OperationTransactionValue,
        and_(
            OperationTransactionValue.transaction_id == OperationTransaction.id,
            OperationTransactionValue.field_code == "tank_gauging_payload",
            OperationTransactionValue.field_value.isnot(None),
        ),
    )

    transactions = payload_query.order_by(OperationTransaction.id.asc()).all()

    all_columns = get_all_possible_columns(
        db,
        cleaned_location_code,
        current_user=current_user,
    )

    payload_map = get_tank_gauging_payload_map(db, [tx.id for tx in transactions])

    def _key(code):
        return str(code or "").strip().lower()

    locations_by_code = {
        _key(row.location_code): row for row in db.query(Location).all()
    }
    assets_by_code = {
        _key(row.asset_code): row for row in db.query(Asset).all()
    }

    setting_cache = {}
    resolved_items = []
    for tx in transactions:
        payload = payload_map.get(tx.id)
        if not payload:
            continue

        resolved = resolve_transaction_accounting(
            db,
            tx,
            payload=payload,
            field_code="tank_gauging_payload",
            setting_cache=setting_cache,
        )
        op_date, _op_time, operation_datetime, accounting_date = resolved
        effective_accounting_date = accounting_date or op_date or tx.operation_date

        if date_to_value is not None and (effective_accounting_date or date.max) > date_to_value:
            continue

        resolved_items.append((tx, payload, resolved, effective_accounting_date, operation_datetime))

    default_window_applied = False
    if date_from_value is None and resolved_items:
        latest_accounting_date = max(
            (item[3] for item in resolved_items if item[3] is not None),
            default=None,
        )
        window_start = default_window_start(latest_accounting_date)
        if window_start is not None:
            date_from_value = window_start
            default_window_applied = True

    sortable_results = []
    for tx, payload, resolved, effective_accounting_date, operation_datetime in resolved_items:
        if date_from_value is not None and (effective_accounting_date or date.min) < date_from_value:
            continue

        row = build_tank_operation_summary_row(
            tx,
            payload,
            db,
            all_columns,
            location=locations_by_code.get(_key(tx.origin_location_code)),
            asset=assets_by_code.get(_key(tx.primary_asset_code)),
            resolved=resolved,
        )
        sortable_results.append(
            (
                effective_accounting_date or date.min,
                operation_datetime or datetime.min,
                tx.id,
                row,
            )
        )

    sortable_results.sort(key=lambda item: (item[0], item[1], item[2]))

    total_rows = len(sortable_results)

    safe_page = clamp_page(page) if page is not None else 1
    safe_page_size = clamp_limit(
        page_size, DEFAULT_REPORT_PAGE_SIZE, MAX_REPORT_PAGE_SIZE
    )

    if unbounded:
        safe_page = 1
        safe_page_size = total_rows
        page_items = sortable_results
    else:
        start = (safe_page - 1) * safe_page_size
        page_items = sortable_results[start : start + safe_page_size]

    results = [item[3] for item in page_items]

    meta = {
        "total_rows": total_rows,
        "page": safe_page,
        "page_size": safe_page_size,
        "has_more": (safe_page * safe_page_size) < total_rows,
        "default_window_applied": default_window_applied,
        "date_from": date_from_value.isoformat() if date_from_value else None,
        "date_to": date_to_value.isoformat() if date_to_value else None,
    }

    return results, all_columns, meta


@router.get("/columns")
def get_tank_operation_summary_columns(
    location_code: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Tank Operation Summary",
        db,
    )

    columns = get_all_possible_columns(db, location_code, current_user=current_user)
    return {"columns": columns}


@router.get("")
def get_tank_operation_summary(
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    page: int = 1,
    page_size: int | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Tank Operation Summary",
        db,
    )

    rows, columns, meta = get_filtered_tank_operation_summary_rows(
        db=db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=date_from,
        date_to=date_to,
        current_user=current_user,
        page=page,
        page_size=page_size,
    )

    return {
        "columns": columns,
        "rows": rows,
        **meta,
    }


@router.get("/export/csv")
def export_tank_operation_summary_csv(
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Tank Operation Summary",
        db,
    )

    rows, columns, _meta = get_filtered_tank_operation_summary_rows(
        db=db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=date_from,
        date_to=date_to,
        current_user=current_user,
        unbounded=True,
    )

    output = io.StringIO()
    writer = csv.writer(output)
    write_row = lambda values: writer.writerow(sanitize_spreadsheet_row(values))

    write_row(["Tank Operation Summary"])
    write_row(["Generated At", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])
    write_row(["Record Count", len(rows)])
    write_row([])
    write_row(["Applied Filters"])
    write_row(["Date From", date_from or "All"])
    write_row(["Date To", date_to or "All"])
    write_row(["Location Code", location_code or "All"])
    write_row(["Tank Asset Code", tank_asset_code or "All"])
    write_row(["Product Name", product_name or "All"])
    write_row([])

    write_row(columns)

    for row in rows:
        write_row([row.get(col, "") for col in columns])

    output.seek(0)

    filename = f"tank-operation-summary-{datetime.now().strftime('%Y%m%d-%H%M%S')}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )
