from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
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
    get_user_location_codes,
    ensure_location_in_user_scope,
    require_user_permission,
)
from app.services.audit_service import create_audit_log
from app.utils.helpers import (
    clean_optional_text,
    get_transaction_ticket_number,
    get_location_name_by_code,
    get_asset_by_code,
    get_location_by_code,
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

    if not isinstance(payload_row.field_value, dict):
        return None

    return payload_row.field_value


def get_tank_gauging_payload_map(
    db: Session,
    transaction_ids,
) -> dict[int, dict]:
    """Batch version of ``get_tank_gauging_payload_for_transaction``.

    Loads every ``tank_gauging_payload`` for the given transactions in one
    query (the summary builders used to run one query per transaction).
    """
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
        if isinstance(row.field_value, dict):
            payload_map[row.transaction_id] = row.field_value

    return payload_map


def extract_tank_gauging_columns(payload: dict):
    if not payload:
        return {}

    inputs = payload.get("inputs") or {}
    calculated = payload.get("calculated") or {}

    result = {}

    for key, value in inputs.items():
        result[f"input_{key}"] = value

    for key, value in calculated.items():
        result[f"calc_{key}"] = value

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
        # Cross-location record: party rule (PERMISSION_CRITERIA_MODEL.md).
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
        "operation_date",
        "accounting_date",
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
):
    # ``location`` / ``asset`` may be prefetched (bulk) by the list builder;
    # an explicit None means "prefetched and not found" (no per-row query).
    if location is _UNSET:
        location = get_location_by_code(transaction.origin_location_code, db)
    if asset is _UNSET:
        asset = get_asset_by_code(transaction.primary_asset_code, db)

    extracted = extract_tank_gauging_columns(payload)

    row = {
        "transaction_id": transaction.id,
        "ticket_number": get_transaction_ticket_number(transaction),
        "operation_number": transaction.operation_number,
        "operation_date": transaction.operation_date,
        "accounting_date": transaction.operation_date,
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

    Bounded loading: when the caller does not supply ``date_from`` only the
    most recent ``DEFAULT_REPORT_WINDOW_DAYS`` (relative to the newest
    matching ticket) are loaded; older data is fetched by passing an
    explicit date range. Rows are paginated in SQL (default page size
    ``DEFAULT_REPORT_PAGE_SIZE``) -- pass ``unbounded=True`` only from the
    CSV export, which is an explicit request for the full filtered set.
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
        # Cross-location record: party rule (PERMISSION_CRITERIA_MODEL.md).
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

    date_from_value = parse_date_filter(date_from, "Date From")
    date_to_value = parse_date_filter(date_to, "Date To")

    default_window_applied = False
    if date_from_value is None:
        latest_date = query.with_entities(
            func.max(OperationTransaction.operation_date)
        ).scalar()
        window_start = default_window_start(latest_date)
        if window_start is not None:
            date_from_value = window_start
            default_window_applied = True

    if date_from_value:
        query = query.filter(OperationTransaction.operation_date >= date_from_value)

    if date_to_value:
        query = query.filter(OperationTransaction.operation_date <= date_to_value)

    # Only transactions that actually carry a gauging payload produce rows,
    # so paginate over exactly those (keeps total_rows honest).
    payload_query = query.join(
        OperationTransactionValue,
        and_(
            OperationTransactionValue.transaction_id == OperationTransaction.id,
            OperationTransactionValue.field_code == "tank_gauging_payload",
            OperationTransactionValue.field_value.isnot(None),
        ),
    )

    total_rows = payload_query.count()

    ordered_query = payload_query.order_by(
        OperationTransaction.operation_date.asc(),
        OperationTransaction.id.asc(),
    )

    safe_page = clamp_page(page) if page is not None else 1
    safe_page_size = clamp_limit(
        page_size, DEFAULT_REPORT_PAGE_SIZE, MAX_REPORT_PAGE_SIZE
    )

    if unbounded:
        transactions = ordered_query.all()
        safe_page = 1
        safe_page_size = total_rows
    else:
        transactions = (
            ordered_query
            .offset((safe_page - 1) * safe_page_size)
            .limit(safe_page_size)
            .all()
        )

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

    results = []
    for tx in transactions:
        payload = payload_map.get(tx.id)
        if payload:
            results.append(
                build_tank_operation_summary_row(
                    tx,
                    payload,
                    db,
                    all_columns,
                    location=locations_by_code.get(_key(tx.origin_location_code)),
                    asset=assets_by_code.get(_key(tx.primary_asset_code)),
                )
            )

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

    writer.writerow(["Tank Operation Summary"])
    writer.writerow(["Generated At", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])
    writer.writerow(["Record Count", len(rows)])
    writer.writerow([])
    writer.writerow(["Applied Filters"])
    writer.writerow(["Date From", date_from or "All"])
    writer.writerow(["Date To", date_to or "All"])
    writer.writerow(["Location Code", location_code or "All"])
    writer.writerow(["Tank Asset Code", tank_asset_code or "All"])
    writer.writerow(["Product Name", product_name or "All"])
    writer.writerow([])

    writer.writerow(columns)

    for row in rows:
        writer.writerow([row.get(col, "") for col in columns])

    output.seek(0)

    filename = f"tank-operation-summary-{datetime.now().strftime('%Y%m%d-%H%M%S')}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )