from datetime import datetime, timedelta, date, time as datetime_time
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    Location,
    LocationAccountingDaySetting,
    MaterialBalanceTemplateColumn,
    OperationTransactionValue,
    TankStockLedger,
    User,
)
from app.utils.pagination import clamp_limit
from app.schemas import (
    TankStockLedgerResponse,
    TankStockLedgerSummaryResponse,
    TankStockLedgerDailySummaryResponse,
    MaterialBalanceDynamicReportResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    apply_location_filter,
    ensure_location_in_user_scope,
    require_user_permission,
)
from app.utils.helpers import (
    safe_float,
    clean_optional_text,
    get_location_by_code,
)
from app.services.material_balance_helpers import (
    normalize_material_balance_code_value,
    get_active_material_balance_template_for_location,
    get_active_material_balance_template_columns,
    get_movement_value_for_unit,
    get_snapshot_value_for_unit,
    should_row_match_material_balance_column,
    calculate_book_closing_from_eligible_ledger_rows,
)
from app.services.operation_datetime import (
    coerce_payload_dict,
    format_time_hhmm,
    get_active_day_setting,
    get_payload_operation_datetime,
    get_payload_operation_parts,
    parse_time_value,
    resolve_location_accounting_window,
)
from app.services.transaction_helpers import parse_date_filter

router = APIRouter(prefix="/tank-stock-ledger", tags=["Tank Stock Ledger"])


_UNSET = object()


def _effective_payload_for_ledger(
    row: TankStockLedger,
    live_payload_by_tx_id: dict[int, dict] | None = None,
) -> dict:
    if live_payload_by_tx_id and row.transaction_id in live_payload_by_tx_id:
        live = live_payload_by_tx_id[row.transaction_id]
        if live:
            return live
    return coerce_payload_dict(row.source_payload)


def hydrate_ledger_rows_from_payload(
    db: Session,
    rows: list[TankStockLedger],
) -> list[TankStockLedger]:
    """Hydrate each ``TankStockLedger`` row's gauging moment & accounting day
    directly from the live ``tank_gauging_payload`` (or ``source_payload``) +
    active ``LocationAccountingDaySetting`` before sorting or date filtering.

    Synthetic rows that carry no payload date at all keep their stored
    ``operation_date`` / ``accounting_date`` untouched.
    """
    if not rows:
        return []

    tx_ids = [r.transaction_id for r in rows if r.transaction_id]
    live_payload_by_tx_id: dict[int, dict] = {}
    if tx_ids:
        for val_row in (
            db.query(OperationTransactionValue)
            .filter(
                OperationTransactionValue.transaction_id.in_(list(dict.fromkeys(tx_ids))),
                OperationTransactionValue.field_code == "tank_gauging_payload",
            )
            .all()
        ):
            parsed = coerce_payload_dict(val_row.field_value)
            if parsed:
                live_payload_by_tx_id[val_row.transaction_id] = parsed

    setting_cache: dict = {}
    for row in rows:
        payload = _effective_payload_for_ledger(row, live_payload_by_tx_id)
        if not payload:
            continue
        if live_payload_by_tx_id.get(row.transaction_id):
            row.source_payload = payload

        gauging_date, gauging_time = get_payload_operation_parts(payload)
        if gauging_date is None:
            continue

        row.operation_date = gauging_date
        window = resolve_location_accounting_window(
            db=db,
            location_code=row.location_code,
            operation_date=gauging_date,
            operation_time=gauging_time,
            setting_cache=setting_cache,
        )
        if window is not None:
            row.accounting_date = window["accounting_date"]
            row.accounting_day_start = window["accounting_day_start"]
            row.accounting_day_end = window["accounting_day_end"]
            row.accounting_day_setting_id = window["setting_id"]
        elif row.accounting_date is None:
            row.accounting_date = gauging_date

    return rows


def get_ledger_gauging_parts(
    row: TankStockLedger,
) -> tuple[date | None, datetime_time | None, datetime | None]:
    payload = coerce_payload_dict(row.source_payload)
    if payload:
        gauging_date, gauging_time = get_payload_operation_parts(payload)
        if gauging_date is not None:
            gauging_dt = datetime.combine(
                gauging_date, gauging_time or datetime_time(0, 0)
            )
            return gauging_date, gauging_time, gauging_dt
    return None, None, None


def get_ledger_operation_datetime(row: TankStockLedger):
    """Exact chronological moment of a ledger row from its gauging payload."""
    try:
        payload_datetime = get_payload_operation_datetime(row.source_payload)
        if payload_datetime is not None:
            return payload_datetime
    except Exception:
        pass

    if row.accounting_day_start is not None:
        return row.accounting_day_start

    if row.operation_date is not None:
        return datetime.combine(row.operation_date, datetime_time(0, 0))

    return None


def build_tank_stock_ledger_response(
    ledger: TankStockLedger,
    db: Session,
    location=_UNSET,
):
    if location is _UNSET:
        location = get_location_by_code(ledger.location_code, db)

    gauging_date, gauging_time, gauging_datetime = get_ledger_gauging_parts(ledger)
    effective_gauging_date = gauging_date or ledger.operation_date
    effective_gauging_dt = gauging_datetime or get_ledger_operation_datetime(ledger)

    return {
        "id": ledger.id,
        "transaction_id": ledger.transaction_id,
        "ticket_number": ledger.ticket_number,
        "operation_number": ledger.operation_number,
        "location_code": ledger.location_code,
        "location_name": location.location_name if location else "",
        "tank_asset_code": ledger.tank_asset_code,
        "tank_asset_name": ledger.tank_asset_name,
        "operation_date": effective_gauging_date,
        "gauging_date": effective_gauging_date,
        "gauging_time": format_time_hhmm(gauging_time) if gauging_time else None,
        "gauging_datetime": effective_gauging_dt,
        "product_name": ledger.product_name,
        "accounting_date": ledger.accounting_date,
        "accounting_day_start": ledger.accounting_day_start,
        "accounting_day_end": ledger.accounting_day_end,
        "accounting_day_setting_id": ledger.accounting_day_setting_id,
        "tank_operation_code": ledger.tank_operation_code,
        "tank_operation_label": ledger.tank_operation_label,
        "tank_operation_category": ledger.tank_operation_category,
        "tank_operation_sign": ledger.tank_operation_sign,
        "movement_gsv_bbl": ledger.movement_gsv_bbl or 0,
        "movement_nsv_bbl": ledger.movement_nsv_bbl or 0,
        "movement_lt": ledger.movement_lt or 0,
        "movement_mt": ledger.movement_mt or 0,
        "stock_gsv_bbl": ledger.stock_gsv_bbl or 0,
        "stock_nsv_bbl": ledger.stock_nsv_bbl or 0,
        "stock_lt": ledger.stock_lt or 0,
        "stock_mt": ledger.stock_mt or 0,
        "previous_stock_gsv_bbl": ledger.previous_stock_gsv_bbl or 0,
        "previous_stock_nsv_bbl": ledger.previous_stock_nsv_bbl or 0,
        "previous_stock_lt": ledger.previous_stock_lt or 0,
        "previous_stock_mt": ledger.previous_stock_mt or 0,
        "running_balance_gsv_bbl": ledger.running_balance_gsv_bbl or 0,
        "running_balance_nsv_bbl": ledger.running_balance_nsv_bbl or 0,
        "running_balance_lt": ledger.running_balance_lt or 0,
        "running_balance_mt": ledger.running_balance_mt or 0,
        "status": ledger.status,
        "created_by": ledger.created_by,
        "remarks": ledger.remarks,
        "created_at": ledger.created_at,
        "updated_at": ledger.updated_at,
    }


def get_filtered_tank_stock_ledger_rows(
    db: Session,
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = None,
    current_user: User | None = None,
):
    date_from_value = parse_date_filter(date_from, "Date From")
    date_to_value = parse_date_filter(date_to, "Date To")

    query = db.query(TankStockLedger)

    if current_user is not None:
        query = apply_location_filter(query, TankStockLedger, current_user, db)

    cleaned_location_code = clean_optional_text(location_code)
    if cleaned_location_code and current_user is not None:
        ensure_location_in_user_scope(current_user, db, cleaned_location_code, "Location")
    cleaned_tank_asset_code = clean_optional_text(tank_asset_code)
    cleaned_product_name = clean_optional_text(product_name)
    cleaned_status = clean_optional_text(status)

    if cleaned_location_code:
        query = query.filter(
            TankStockLedger.location_code.ilike(cleaned_location_code)
        )

    if cleaned_tank_asset_code:
        query = query.filter(
            TankStockLedger.tank_asset_code.ilike(cleaned_tank_asset_code)
        )

    if cleaned_product_name:
        query = query.filter(
            TankStockLedger.product_name.ilike(cleaned_product_name)
        )

    if cleaned_status:
        query = query.filter(TankStockLedger.status == cleaned_status)

    rows = hydrate_ledger_rows_from_payload(db, query.all())

    if date_from_value is not None:
        rows = [
            row
            for row in rows
            if row.accounting_date is not None and row.accounting_date >= date_from_value
        ]
    if date_to_value is not None:
        rows = [
            row
            for row in rows
            if row.accounting_date is not None and row.accounting_date <= date_to_value
        ]

    return sorted(
        rows,
        key=lambda row: (
            row.location_code or "",
            row.tank_asset_code or "",
            row.accounting_date or date.min,
            get_ledger_operation_datetime(row) or datetime.min,
            row.id,
        ),
    )


def build_date_range(start_date: date, end_date: date):
    if end_date < start_date:
        raise HTTPException(
            status_code=400,
            detail="Date To cannot be earlier than Date From",
        )

    dates = []
    current_date = start_date

    while current_date <= end_date:
        dates.append(current_date)
        current_date = current_date + timedelta(days=1)

    return dates


def get_active_location_day_setting(
    db: Session,
    location_code: str,
    on_date: date,
    setting_cache: dict | None = None,
) -> LocationAccountingDaySetting | None:
    return get_active_day_setting(
        db=db,
        location_code=location_code,
        on_date=on_date,
        setting_cache=setting_cache,
    )


def compute_accounting_date(
    op_date: date,
    event_time: str | datetime_time | None,
    day_start_time: datetime_time | None,
):
    if not event_time or day_start_time is None:
        return op_date

    parsed_time = parse_time_value(event_time)
    if parsed_time is None:
        return op_date

    return op_date - timedelta(days=1) if parsed_time < day_start_time else op_date


def combine_operation_datetime(op_date: date, event_time: str | None, tz_name: str):
    try:
        parsed_time = parse_time_value(event_time)
        if parsed_time is None:
            return None
        dt = datetime.combine(op_date, parsed_time)
        return dt.replace(tzinfo=ZoneInfo(tz_name))
    except Exception:
        return None


def get_tank_stock_rows_for_daily_summary(
    db: Session,
    location_code: str | None,
    tank_asset_code: str | None,
    product_name: str | None,
    date_to_value: date,
    status: str | None = "Active",
    current_user: User | None = None,
):
    query = db.query(TankStockLedger)

    if current_user is not None:
        query = apply_location_filter(query, TankStockLedger, current_user, db)

    cleaned_status = clean_optional_text(status)
    if cleaned_status:
        query = query.filter(TankStockLedger.status == cleaned_status)

    cleaned_location_code = clean_optional_text(location_code)
    if cleaned_location_code and current_user is not None:
        ensure_location_in_user_scope(current_user, db, cleaned_location_code, "Location")
    cleaned_tank_asset_code = clean_optional_text(tank_asset_code)
    if cleaned_location_code:
        query = query.filter(
            TankStockLedger.location_code.ilike(cleaned_location_code)
        )

    if cleaned_tank_asset_code:
        query = query.filter(
            TankStockLedger.tank_asset_code.ilike(cleaned_tank_asset_code)
        )

    rows = hydrate_ledger_rows_from_payload(db, query.all())
    rows = [
        row
        for row in rows
        if row.accounting_date is not None and row.accounting_date <= date_to_value
    ]

    return sorted(
        rows,
        key=lambda row: (
            row.location_code or "",
            row.tank_asset_code or "",
            row.accounting_date or date.min,
            get_ledger_operation_datetime(row) or datetime.min,
            row.id,
        ),
    )


def get_stock_snapshot_values(row: TankStockLedger):
    stock_gsv = safe_float(row.stock_gsv_bbl)
    stock_nsv = safe_float(row.stock_nsv_bbl)
    stock_lt = safe_float(row.stock_lt)
    stock_mt = safe_float(row.stock_mt)

    if stock_gsv == 0 and stock_nsv == 0:
        stock_gsv = safe_float(row.running_balance_gsv_bbl)
        stock_nsv = safe_float(row.running_balance_nsv_bbl)
        stock_lt = safe_float(row.running_balance_lt)
        stock_mt = safe_float(row.running_balance_mt)

    return {
        "gsv": stock_gsv,
        "nsv": stock_nsv,
        "lt": stock_lt,
        "mt": stock_mt,
    }


def build_out_turn_report_response(
    row: TankStockLedger,
    db: Session,
):
    from app.services.stock_ledger_helpers import build_out_turn_report_response_from_values

    stock_snapshot = get_stock_snapshot_values(row)
    gauging_date, gauging_time, gauging_dt = get_ledger_gauging_parts(row)
    operation_datetime = gauging_dt or get_ledger_operation_datetime(row)

    return build_out_turn_report_response_from_values(
        params={
            "ledger_id": row.id,
            "transaction_id": row.transaction_id,
            "ticket_number": row.ticket_number,
            "operation_number": row.operation_number,
            "accounting_date": row.accounting_date,
            "gauging_date": gauging_date or row.operation_date,
            "gauging_time": format_time_hhmm(gauging_time) if gauging_time else None,
            "operation_datetime": operation_datetime,
            "location_code": row.location_code,
            "tank_asset_code": row.tank_asset_code,
            "tank_asset_name": row.tank_asset_name,
            "product_name": row.product_name,
            "tank_operation_code": row.tank_operation_code,
            "tank_operation_label": row.tank_operation_label,
            "tank_operation_category": row.tank_operation_category,
            "tank_operation_sign": row.tank_operation_sign,
            "previous_gsv": row.previous_stock_gsv_bbl,
            "previous_nsv": row.previous_stock_nsv_bbl,
            "previous_lt": row.previous_stock_lt,
            "previous_mt": row.previous_stock_mt,
            "stock_after_gsv": stock_snapshot["gsv"],
            "stock_after_nsv": stock_snapshot["nsv"],
            "stock_after_lt": stock_snapshot["lt"],
            "stock_after_mt": stock_snapshot["mt"],
            "status": row.status,
            "remarks": row.remarks,
        },
        db=db,
    )


def get_out_turn_report_rows(
    db: Session,
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = "Active",
    current_user: User | None = None,
):
    date_from_value = parse_date_filter(date_from, "Date From")
    date_to_value = parse_date_filter(date_to, "Date To")

    query = db.query(TankStockLedger)

    if current_user is not None:
        query = apply_location_filter(query, TankStockLedger, current_user, db)

    cleaned_location_code = clean_optional_text(location_code)
    if cleaned_location_code and current_user is not None:
        ensure_location_in_user_scope(current_user, db, cleaned_location_code, "Location")
    cleaned_tank_asset_code = clean_optional_text(tank_asset_code)
    cleaned_status = clean_optional_text(status)

    if cleaned_status:
        query = query.filter(TankStockLedger.status == cleaned_status)

    if cleaned_location_code:
        query = query.filter(
            TankStockLedger.location_code.ilike(cleaned_location_code)
        )

    if cleaned_tank_asset_code:
        query = query.filter(
            TankStockLedger.tank_asset_code.ilike(cleaned_tank_asset_code)
        )

    rows = hydrate_ledger_rows_from_payload(db, query.all())

    if date_from_value:
        rows = [
            row
            for row in rows
            if row.accounting_date is not None and row.accounting_date >= date_from_value
        ]

    if date_to_value:
        rows = [
            row
            for row in rows
            if row.accounting_date is not None and row.accounting_date <= date_to_value
        ]

    rows = sorted(
        rows,
        key=lambda row: (
            row.accounting_date or date.min,
            get_ledger_operation_datetime(row) or datetime.min,
            row.location_code or "",
            row.tank_asset_code or "",
            row.id,
        ),
    )

    return rows


def build_tank_stock_daily_summary_rows(
    db: Session,
    ledger_rows: list[TankStockLedger],
    date_from_value: date,
    date_to_value: date,
):
    date_range = build_date_range(date_from_value, date_to_value)

    grouped_rows = {}

    for row in ledger_rows:
        key = (row.location_code, row.tank_asset_code)

        if key not in grouped_rows:
            grouped_rows[key] = []

        grouped_rows[key].append(row)

    daily_summary_rows = []

    for key, rows in grouped_rows.items():
        location_code, tank_asset_code = key

        location = get_location_by_code(location_code, db)

        sorted_rows = sorted(
            rows,
            key=lambda row: (
                get_ledger_operation_datetime(row) or datetime.min,
                row.id,
            ),
        )

        tank_asset_name = ""
        product_name_value = ""
        if sorted_rows:
            tank_asset_name = sorted_rows[-1].tank_asset_name or ""
            product_name_value = sorted_rows[-1].product_name or ""

        previous_closing_gsv = 0
        previous_closing_nsv = 0
        previous_closing_lt = 0
        previous_closing_mt = 0

        rows_before_period = [
            row
            for row in sorted_rows
            if row.accounting_date is not None
            and row.accounting_date < date_from_value
        ]

        if rows_before_period:
            last_before_period = rows_before_period[-1]
            previous_snapshot = get_stock_snapshot_values(last_before_period)

            previous_closing_gsv = previous_snapshot["gsv"]
            previous_closing_nsv = previous_snapshot["nsv"]
            previous_closing_lt = previous_snapshot["lt"]
            previous_closing_mt = previous_snapshot["mt"]

        for accounting_date_value in date_range:
            day_rows = [
                row
                for row in sorted_rows
                if row.accounting_date == accounting_date_value
            ]

            day_rows = sorted(
                day_rows,
                key=lambda row: (
                    get_ledger_operation_datetime(row) or datetime.min,
                    row.id,
                ),
            )

            opening_gsv = previous_closing_gsv
            opening_nsv = previous_closing_nsv
            opening_lt = previous_closing_lt
            opening_mt = previous_closing_mt

            opening_rows = [
                row
                for row in day_rows
                if str(row.tank_operation_category or "").upper() == "OPENING"
            ]

            if opening_rows:
                opening_snapshot = get_stock_snapshot_values(opening_rows[-1])

                opening_gsv = opening_snapshot["gsv"]
                opening_nsv = opening_snapshot["nsv"]
                opening_lt = opening_snapshot["lt"]
                opening_mt = opening_snapshot["mt"]

            total_in_gsv = 0
            total_in_nsv = 0
            total_in_lt = 0
            total_in_mt = 0

            total_out_gsv = 0
            total_out_nsv = 0
            total_out_lt = 0
            total_out_mt = 0

            for row in day_rows:
                sign = str(row.tank_operation_sign or "").upper()

                if sign == "IN":
                    total_in_gsv += safe_float(row.movement_gsv_bbl)
                    total_in_nsv += safe_float(row.movement_nsv_bbl)
                    total_in_lt += safe_float(row.movement_lt)
                    total_in_mt += safe_float(row.movement_mt)

                elif sign == "OUT":
                    total_out_gsv += safe_float(row.movement_gsv_bbl)
                    total_out_nsv += safe_float(row.movement_nsv_bbl)
                    total_out_lt += safe_float(row.movement_lt)
                    total_out_mt += safe_float(row.movement_mt)

            book_closing_gsv = opening_gsv + total_in_gsv - total_out_gsv
            book_closing_nsv = opening_nsv + total_in_nsv - total_out_nsv
            book_closing_lt = opening_lt + total_in_lt - total_out_lt
            book_closing_mt = opening_mt + total_in_mt - total_out_mt

            actual_closing_gsv = book_closing_gsv
            actual_closing_nsv = book_closing_nsv
            actual_closing_lt = book_closing_lt
            actual_closing_mt = book_closing_mt

            last_ticket_number = None

            if day_rows:
                closing_rows = [
                    row
                    for row in day_rows
                    if str(row.tank_operation_category or "").upper()
                    == "CLOSING"
                ]

                if closing_rows:
                    closing_source_row = closing_rows[-1]
                else:
                    closing_source_row = day_rows[-1]

                closing_snapshot = get_stock_snapshot_values(closing_source_row)

                actual_closing_gsv = closing_snapshot["gsv"]
                actual_closing_nsv = closing_snapshot["nsv"]
                actual_closing_lt = closing_snapshot["lt"]
                actual_closing_mt = closing_snapshot["mt"]
                last_ticket_number = closing_source_row.ticket_number

            else:
                actual_closing_gsv = opening_gsv
                actual_closing_nsv = opening_nsv
                actual_closing_lt = opening_lt
                actual_closing_mt = opening_mt

                book_closing_gsv = opening_gsv
                book_closing_nsv = opening_nsv
                book_closing_lt = opening_lt
                book_closing_mt = opening_mt

            loss_gain_gsv = actual_closing_gsv - book_closing_gsv
            loss_gain_nsv = actual_closing_nsv - book_closing_nsv
            loss_gain_lt = actual_closing_lt - book_closing_lt
            loss_gain_mt = actual_closing_mt - book_closing_mt

            daily_summary_rows.append(
                {
                    "accounting_date": accounting_date_value,
                    "location_code": location_code,
                    "location_name": location.location_name if location else "",
                    "tank_asset_code": tank_asset_code,
                    "tank_asset_name": tank_asset_name,
                    "product_name": product_name_value or None,
                    "opening_gsv_bbl": round(opening_gsv, 3),
                    "opening_nsv_bbl": round(opening_nsv, 3),
                    "opening_lt": round(opening_lt, 3),
                    "opening_mt": round(opening_mt, 3),
                    "total_in_gsv_bbl": round(total_in_gsv, 3),
                    "total_in_nsv_bbl": round(total_in_nsv, 3),
                    "total_in_lt": round(total_in_lt, 3),
                    "total_in_mt": round(total_in_mt, 3),
                    "total_out_gsv_bbl": round(total_out_gsv, 3),
                    "total_out_nsv_bbl": round(total_out_nsv, 3),
                    "total_out_lt": round(total_out_lt, 3),
                    "total_out_mt": round(total_out_mt, 3),
                    "book_closing_gsv_bbl": round(book_closing_gsv, 3),
                    "book_closing_nsv_bbl": round(book_closing_nsv, 3),
                    "book_closing_lt": round(book_closing_lt, 3),
                    "book_closing_mt": round(book_closing_mt, 3),
                    "actual_closing_gsv_bbl": round(actual_closing_gsv, 3),
                    "actual_closing_nsv_bbl": round(actual_closing_nsv, 3),
                    "actual_closing_lt": round(actual_closing_lt, 3),
                    "actual_closing_mt": round(actual_closing_mt, 3),
                    "loss_gain_gsv_bbl": round(loss_gain_gsv, 3),
                    "loss_gain_nsv_bbl": round(loss_gain_nsv, 3),
                    "loss_gain_lt": round(loss_gain_lt, 3),
                    "loss_gain_mt": round(loss_gain_mt, 3),
                    "rows_count": len(day_rows),
                    "last_ticket_number": last_ticket_number,
                }
            )

            previous_closing_gsv = actual_closing_gsv
            previous_closing_nsv = actual_closing_nsv
            previous_closing_lt = actual_closing_lt
            previous_closing_mt = actual_closing_mt

    return sorted(
        daily_summary_rows,
        key=lambda row: (
            row["accounting_date"],
            row["location_code"],
            row["tank_asset_code"],
        ),
    )


def add_volume_values(target: dict, prefix: str, row: TankStockLedger):
    from app.services.stock_ledger_helpers import add_volume_values_from_values

    add_volume_values_from_values(
        target=target,
        prefix=prefix,
        movement_gsv=row.movement_gsv_bbl,
        movement_nsv=row.movement_nsv_bbl,
        movement_lt=row.movement_lt,
        movement_mt=row.movement_mt,
    )


def get_material_balance_rows_for_continuity(
    db: Session,
    location_code: str | None,
    tank_asset_code: str | None,
    product_name: str | None,
    date_to_value: date,
    status: str | None = "Active",
):
    query = db.query(TankStockLedger)

    cleaned_location_code = clean_optional_text(location_code)
    cleaned_tank_asset_code = clean_optional_text(tank_asset_code)
    cleaned_status = clean_optional_text(status)

    if cleaned_status:
        query = query.filter(TankStockLedger.status == cleaned_status)

    if cleaned_location_code:
        query = query.filter(
            TankStockLedger.location_code.ilike(cleaned_location_code)
        )

    if cleaned_tank_asset_code:
        query = query.filter(
            TankStockLedger.tank_asset_code.ilike(cleaned_tank_asset_code)
        )

    rows = hydrate_ledger_rows_from_payload(db, query.all())
    rows = [
        row
        for row in rows
        if row.accounting_date is not None and row.accounting_date <= date_to_value
    ]

    return sorted(
        rows,
        key=lambda row: (
            row.location_code or "",
            row.tank_asset_code or "",
            row.accounting_date or date.min,
            get_ledger_operation_datetime(row) or datetime.min,
            row.id,
        ),
    )


def build_dynamic_material_balance_columns_response(
    columns: list[MaterialBalanceTemplateColumn],
):
    return [
        {
            "column_key": column.column_key,
            "column_label": column.column_label,
            "column_order": column.column_order,
            "column_type": column.column_type,
            "movement_direction": column.movement_direction,
            "include_in_material_balance": column.include_in_material_balance,
            "include_in_book_closing": column.include_in_book_closing,
            "is_internal_transfer": column.is_internal_transfer,
        }
        for column in columns
    ]


def build_dynamic_material_balance_tank_rows(
    db: Session,
    ledger_rows: list[TankStockLedger],
    columns: list[MaterialBalanceTemplateColumn],
    date_from_value: date,
    date_to_value: date,
    unit_key: str = "nsv",
):
    date_range = build_date_range(date_from_value, date_to_value)

    grouped_rows = {}

    for row in ledger_rows:
        key = (
            row.location_code,
            row.tank_asset_code,
        )

        if key not in grouped_rows:
            grouped_rows[key] = []

        grouped_rows[key].append(row)

    report_rows = []

    for key, rows in grouped_rows.items():
        location_code, tank_asset_code = key
        location = get_location_by_code(location_code, db)

        sorted_rows = sorted(
            rows,
            key=lambda row: (
                get_ledger_operation_datetime(row) or datetime.min,
                row.id,
            ),
        )

        tank_asset_name = ""
        product_name_value = ""

        if sorted_rows:
            tank_asset_name = sorted_rows[-1].tank_asset_name or ""
            product_name_value = sorted_rows[-1].product_name or ""

        previous_closing_snapshot = {
            "gsv": 0,
            "nsv": 0,
            "lt": 0,
            "mt": 0,
        }

        rows_before_period = [
            row
            for row in sorted_rows
            if row.accounting_date is not None
            and row.accounting_date < date_from_value
        ]

        if rows_before_period:
            previous_closing_snapshot = get_stock_snapshot_values(
                rows_before_period[-1]
            )

        for accounting_date_value in date_range:
            day_rows = [
                row
                for row in sorted_rows
                if row.accounting_date == accounting_date_value
            ]

            day_rows = sorted(
                day_rows,
                key=lambda row: (
                    get_ledger_operation_datetime(row) or datetime.min,
                    row.id,
                ),
            )

            opening_value = get_snapshot_value_for_unit(
                previous_closing_snapshot,
                unit_key,
            )

            explicit_opening_rows = [
                row
                for row in day_rows
                if normalize_material_balance_code_value(
                    row.tank_operation_category
                )
                == "OPENING"
            ]

            if explicit_opening_rows:
                opening_snapshot = get_stock_snapshot_values(
                    explicit_opening_rows[-1]
                )
                opening_value = get_snapshot_value_for_unit(
                    opening_snapshot,
                    unit_key,
                )

            values = {}

            book_closing_value = opening_value
            actual_closing_value = opening_value
            last_ticket_number = None

            for column in columns:
                column_key = column.column_key
                column_type = normalize_material_balance_code_value(
                    column.column_type
                )

                if column_type == "OPENING":
                    values[column_key] = round(opening_value, 3)
                    continue

                if column_type == "MOVEMENT":
                    movement_total = 0

                    for row in day_rows:
                        if should_row_match_material_balance_column(row, column):
                            movement_total += get_movement_value_for_unit(
                                row,
                                unit_key,
                            )

                    values[column_key] = round(movement_total, 3)
                    continue

                if column_type in ["INFO", "FORMULA"]:
                    values[column_key] = 0
                    continue

            book_closing_calculation = calculate_book_closing_from_eligible_ledger_rows(
                opening_value=opening_value,
                day_rows=day_rows,
                columns=columns,
                unit_key=unit_key,
            )

            book_closing_value = book_closing_calculation["book_closing_value"]

            if day_rows:
                explicit_closing_rows = [
                    row
                    for row in day_rows
                    if normalize_material_balance_code_value(
                        row.tank_operation_category
                    )
                    == "CLOSING"
                ]

                if explicit_closing_rows:
                    closing_source_row = explicit_closing_rows[-1]
                else:
                    closing_source_row = day_rows[-1]

                actual_closing_snapshot = get_stock_snapshot_values(
                    closing_source_row
                )

                actual_closing_value = get_snapshot_value_for_unit(
                    actual_closing_snapshot,
                    unit_key,
                )

                last_ticket_number = closing_source_row.ticket_number
            else:
                actual_closing_snapshot = previous_closing_snapshot
                actual_closing_value = opening_value

            loss_gain_value = actual_closing_value - book_closing_value

            for column in columns:
                column_key = column.column_key
                column_type = normalize_material_balance_code_value(
                    column.column_type
                )

                if column_type == "BOOK_CLOSING":
                    values[column_key] = round(book_closing_value, 3)

                elif column_type == "ACTUAL_CLOSING":
                    values[column_key] = round(actual_closing_value, 3)

                elif column_type == "LOSS_GAIN":
                    values[column_key] = round(loss_gain_value, 3)

            report_rows.append(
                {
                    "accounting_date": accounting_date_value,
                    "location_code": location_code,
                    "location_name": location.location_name if location else "",
                    "tank_asset_code": tank_asset_code,
                    "tank_asset_name": tank_asset_name,
                    "product_name": product_name_value or None,
                    "values": values,
                    "rows_count": len(day_rows),
                    "last_ticket_number": last_ticket_number,
                    "_opening_value": opening_value,
                    "_actual_closing_value": actual_closing_value,
                    "_first_operation_datetime": (
                        get_ledger_operation_datetime(day_rows[0])
                        if day_rows
                        else None
                    ),
                    "_last_operation_datetime": (
                        get_ledger_operation_datetime(day_rows[-1])
                        if day_rows
                        else None
                    ),
                }
            )

            previous_closing_snapshot = {
                "gsv": actual_closing_snapshot.get("gsv", actual_closing_value),
                "nsv": actual_closing_snapshot.get("nsv", actual_closing_value),
                "lt": actual_closing_snapshot.get("lt", 0),
                "mt": actual_closing_snapshot.get("mt", 0),
            }

    return sorted(
        report_rows,
        key=lambda row: (
            row["accounting_date"],
            row["location_code"],
            row["tank_asset_code"] or "",
            row["product_name"] or "",
        ),
    )


def consolidate_dynamic_material_balance_rows_by_location(
    tank_rows: list[dict],
    columns: list[MaterialBalanceTemplateColumn],
):
    """Consolidate per-tank daily material-balance rows to one row per
    ``(accounting_date, location_code)``.

    Summing each distinct tank's opening and actual closing stock across the
    facility ensures multi-tank locations balance identically to the sum of
    their individual tank material balances while keeping single-tank queries
    exact.
    """
    consolidated_map = {}

    for row in tank_rows:
        key = (
            row["accounting_date"],
            row["location_code"],
        )

        if key not in consolidated_map:
            consolidated_map[key] = {
                "accounting_date": row["accounting_date"],
                "location_code": row["location_code"],
                "location_name": row["location_name"],
                "tank_asset_code": None,
                "tank_asset_name": "All Tanks",
                "product_name": None,
                "values": {},
                "rows_count": 0,
                "last_ticket_number": None,
                "_tank_asset_codes": set(),
                "_tank_asset_names": set(),
                "_product_names": set(),
                "_opening_value": 0.0,
                "_actual_closing_value": 0.0,
                "_closing_datetime": None,
            }

            for column in columns:
                consolidated_map[key]["values"][column.column_key] = 0

        target = consolidated_map[key]

        tank_asset_code = clean_optional_text(row.get("tank_asset_code"))
        tank_asset_name = clean_optional_text(row.get("tank_asset_name"))
        product_name = clean_optional_text(row.get("product_name"))
        if tank_asset_code:
            target["_tank_asset_codes"].add(tank_asset_code)
        if tank_asset_name:
            target["_tank_asset_names"].add(tank_asset_name)
        if product_name:
            target["_product_names"].add(product_name)

        for column in columns:
            if normalize_material_balance_code_value(column.column_type) != "MOVEMENT":
                continue
            column_key = column.column_key
            target["values"][column_key] = safe_float(
                target["values"].get(column_key)
            ) + safe_float(row["values"].get(column_key))

        target["_opening_value"] += safe_float(row.get("_opening_value"))
        target["_actual_closing_value"] += safe_float(
            row.get("_actual_closing_value")
        )

        last_operation_datetime = row.get("_last_operation_datetime")
        if last_operation_datetime is not None and (
            target["_closing_datetime"] is None
            or last_operation_datetime >= target["_closing_datetime"]
        ):
            target["_closing_datetime"] = last_operation_datetime
            if row.get("last_ticket_number"):
                target["last_ticket_number"] = row.get("last_ticket_number")
        elif target["last_ticket_number"] is None and row.get("last_ticket_number"):
            target["last_ticket_number"] = row.get("last_ticket_number")

        target["rows_count"] += int(row.get("rows_count") or 0)

    consolidated_rows = []

    for row in consolidated_map.values():
        opening_value = safe_float(row.pop("_opening_value"))
        actual_closing_value = safe_float(row.pop("_actual_closing_value"))
        row.pop("_closing_datetime", None)

        tank_asset_codes = sorted(row.pop("_tank_asset_codes"))
        tank_asset_names = sorted(row.pop("_tank_asset_names"))
        product_names = sorted(row.pop("_product_names"))
        if len(tank_asset_codes) == 1:
            row["tank_asset_code"] = tank_asset_codes[0]
            row["tank_asset_name"] = (
                tank_asset_names[0] if len(tank_asset_names) == 1 else ""
            )
        row["product_name"] = product_names[0] if len(product_names) == 1 else None

        eligible_in_total = 0
        eligible_out_total = 0
        for column in columns:
            column_key = column.column_key
            column_type = normalize_material_balance_code_value(column.column_type)
            if column_type == "OPENING":
                row["values"][column_key] = opening_value
            elif column_type == "MOVEMENT":
                movement_value = safe_float(row["values"].get(column_key))
                include_in_material_balance = (
                    normalize_material_balance_code_value(
                        column.include_in_material_balance
                    )
                    == "YES"
                )
                include_in_book_closing = (
                    normalize_material_balance_code_value(
                        column.include_in_book_closing
                    )
                    == "YES"
                )
                is_internal_transfer = (
                    normalize_material_balance_code_value(column.is_internal_transfer)
                    == "YES"
                )
                if (
                    include_in_material_balance
                    and include_in_book_closing
                    and not is_internal_transfer
                ):
                    direction = normalize_material_balance_code_value(
                        column.movement_direction
                    )
                    if direction == "IN":
                        eligible_in_total += movement_value
                    elif direction == "OUT":
                        eligible_out_total += movement_value

        book_closing_value = opening_value + eligible_in_total - eligible_out_total
        loss_gain_value = actual_closing_value - book_closing_value

        for column in columns:
            column_key = column.column_key
            column_type = normalize_material_balance_code_value(column.column_type)
            if column_type == "BOOK_CLOSING":
                row["values"][column_key] = book_closing_value
            elif column_type == "ACTUAL_CLOSING":
                row["values"][column_key] = actual_closing_value
            elif column_type == "LOSS_GAIN":
                row["values"][column_key] = loss_gain_value
            row["values"][column_key] = round(
                safe_float(row["values"].get(column_key)),
                3,
            )

        consolidated_rows.append(row)

    return sorted(
        consolidated_rows,
        key=lambda row: (
            row["accounting_date"],
            row["location_code"],
        ),
    )


@router.get("", response_model=list[TankStockLedgerResponse])
def get_tank_stock_ledger(
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = "Active",
    limit: int | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Tank Stock Ledger",
        db,
    )

    ledger_rows = get_filtered_tank_stock_ledger_rows(
        db=db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=date_from,
        date_to=date_to,
        status=status,
        current_user=current_user,
    )

    if limit is not None:
        ledger_rows = ledger_rows[: clamp_limit(limit)]

    locations_by_code = {
        str(row.location_code or "").strip().lower(): row
        for row in db.query(Location).all()
    }

    return [
        build_tank_stock_ledger_response(
            row,
            db,
            location=locations_by_code.get(
                str(row.location_code or "").strip().lower()
            ),
        )
        for row in ledger_rows
    ]


@router.get(
    "/summary",
    response_model=list[TankStockLedgerSummaryResponse],
)
def get_tank_stock_ledger_summary(
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = "Active",
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Tank Stock Ledger",
        db,
    )

    ledger_rows = get_filtered_tank_stock_ledger_rows(
        db=db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=date_from,
        date_to=date_to,
        status=status,
        current_user=current_user,
    )

    summary_map = {}

    for row in ledger_rows:
        key = (
            row.location_code,
            row.tank_asset_code,
            row.product_name or "",
        )

        is_first_row_for_tank = key not in summary_map
        if is_first_row_for_tank:
            location = get_location_by_code(row.location_code, db)

            summary_map[key] = {
                "location_code": row.location_code,
                "location_name": location.location_name if location else "",
                "tank_asset_code": row.tank_asset_code,
                "tank_asset_name": row.tank_asset_name,
                "product_name": row.product_name,
                "opening_nsv_bbl": 0,
                "total_in_nsv_bbl": 0,
                "total_out_nsv_bbl": 0,
                "closing_nsv_bbl": 0,
                "opening_lt": 0,
                "total_in_lt": 0,
                "total_out_lt": 0,
                "closing_lt": 0,
                "opening_mt": 0,
                "total_in_mt": 0,
                "total_out_mt": 0,
                "closing_mt": 0,
            }

        summary = summary_map[key]

        sign = str(row.tank_operation_sign or "").upper()
        category = str(row.tank_operation_category or "").upper()

        movement_nsv = safe_float(row.movement_nsv_bbl)
        movement_lt = safe_float(row.movement_lt)
        movement_mt = safe_float(row.movement_mt)

        if is_first_row_for_tank:
            if category == "OPENING" or sign == "SET":
                snapshot = get_stock_snapshot_values(row)
                summary["opening_nsv_bbl"] = snapshot["nsv"]
                summary["opening_lt"] = snapshot["lt"]
                summary["opening_mt"] = snapshot["mt"]
            else:
                summary["opening_nsv_bbl"] = safe_float(row.previous_stock_nsv_bbl)
                summary["opening_lt"] = safe_float(row.previous_stock_lt)
                summary["opening_mt"] = safe_float(row.previous_stock_mt)

        if sign == "IN":
            summary["total_in_nsv_bbl"] += movement_nsv
            summary["total_in_lt"] += movement_lt
            summary["total_in_mt"] += movement_mt

        elif sign == "OUT":
            summary["total_out_nsv_bbl"] += movement_nsv
            summary["total_out_lt"] += movement_lt
            summary["total_out_mt"] += movement_mt

        closing_snapshot = get_stock_snapshot_values(row)
        summary["closing_nsv_bbl"] = closing_snapshot["nsv"]
        summary["closing_lt"] = closing_snapshot["lt"]
        summary["closing_mt"] = closing_snapshot["mt"]

    return list(summary_map.values())


@router.get(
    "/daily-summary",
    response_model=list[TankStockLedgerDailySummaryResponse],
)
def get_tank_stock_ledger_daily_summary(
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = "Active",
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Tank Stock Ledger",
        db,
    )

    date_from_value = parse_date_filter(date_from, "Date From")
    date_to_value = parse_date_filter(date_to, "Date To")

    if date_from_value is None or date_to_value is None:
        raise HTTPException(
            status_code=400,
            detail="Date From and Date To are required for daily summary",
        )

    ledger_rows = get_tank_stock_rows_for_daily_summary(
        db=db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_to_value=date_to_value,
        status=status,
        current_user=current_user,
    )

    return build_tank_stock_daily_summary_rows(
        db=db,
        ledger_rows=ledger_rows,
        date_from_value=date_from_value,
        date_to_value=date_to_value,
    )


@router.get("/out-turn-report/validation")
def validate_out_turn_report_tank_sequence(
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
        "View Out-Turn Report",
        db,
    )

    date_from_value = parse_date_filter(date_from, "Date From")
    date_to_value = parse_date_filter(date_to, "Date To")

    continuity_rows = get_out_turn_report_rows(
        db=db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=None,
        date_to=date_to,
        status="Active",
        current_user=current_user,
    )

    visible_rows = []
    for row in continuity_rows:
        if date_from_value and row.accounting_date and row.accounting_date < date_from_value:
            continue
        if date_to_value and row.accounting_date and row.accounting_date > date_to_value:
            continue
        visible_rows.append(row)

    grouped_rows = {}
    for row in continuity_rows:
        key = (row.location_code, row.tank_asset_code)
        grouped_rows.setdefault(key, []).append(row)

    visible_ledger_ids = {row.id for row in visible_rows}

    issues = []

    for key, group_rows in grouped_rows.items():
        location, tank = key

        sorted_group_rows = sorted(
            group_rows,
            key=lambda row: (
                get_ledger_operation_datetime(row) or datetime.min,
                row.id,
            ),
        )

        previous_row = None

        for row in sorted_group_rows:
            if previous_row is None:
                expected_previous_nsv = 0
            else:
                previous_snapshot = get_stock_snapshot_values(previous_row)
                expected_previous_nsv = previous_snapshot["nsv"]

            if row.id in visible_ledger_ids:
                actual_previous_nsv = safe_float(row.previous_stock_nsv_bbl)

                if round(actual_previous_nsv, 3) != round(expected_previous_nsv, 3):
                    issues.append(
                        {
                            "ledger_id": row.id,
                            "ticket_number": row.ticket_number,
                            "location_code": location,
                            "tank_asset_code": tank,
                            "product_name": row.product_name,
                            "expected_previous_nsv_bbl": round(
                                expected_previous_nsv,
                                3,
                            ),
                            "actual_previous_nsv_bbl": round(
                                actual_previous_nsv,
                                3,
                            ),
                            "message": (
                                "Previous stock does not match previous row "
                                "of the same tank sequence. Run ledger rebuild."
                            ),
                        }
                    )

            previous_row = row

    return {
        "rows_checked": len(visible_rows),
        "groups_checked": len(grouped_rows),
        "issues_count": len(issues),
        "issues": issues,
    }


@router.get(
    "/material-balance-report",
    response_model=MaterialBalanceDynamicReportResponse,
)
def get_material_balance_report(
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    unit: str | None = "nsv",
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Material Balance Report",
        db,
    )

    cleaned_location_code = clean_optional_text(location_code)

    if not cleaned_location_code:
        raise HTTPException(
            status_code=400,
            detail="Location is required for configurable Material Balance Report",
        )
    ensure_location_in_user_scope(current_user, db, cleaned_location_code, "Location")

    date_from_value = parse_date_filter(date_from, "Date From")
    date_to_value = parse_date_filter(date_to, "Date To")

    if date_from_value is None or date_to_value is None:
        raise HTTPException(
            status_code=400,
            detail="Date From and Date To are required for Material Balance Report",
        )

    unit_key = normalize_material_balance_code_value(unit).lower()

    if unit_key not in ["gsv", "nsv", "lt", "mt"]:
        raise HTTPException(
            status_code=400,
            detail="Unit must be one of: gsv, nsv, lt, mt",
        )

    template = get_active_material_balance_template_for_location(
        db=db,
        location_code=cleaned_location_code,
    )

    columns = get_active_material_balance_template_columns(
        db=db,
        template_id=template.id,
    )

    ledger_rows = get_material_balance_rows_for_continuity(
        db=db,
        location_code=cleaned_location_code,
        tank_asset_code=tank_asset_code,
        product_name=None,
        date_to_value=date_to_value,
    )

    tank_rows = build_dynamic_material_balance_tank_rows(
        db=db,
        ledger_rows=ledger_rows,
        columns=columns,
        date_from_value=date_from_value,
        date_to_value=date_to_value,
        unit_key=unit_key,
    )

    report_rows = consolidate_dynamic_material_balance_rows_by_location(
        tank_rows=tank_rows,
        columns=columns,
    )

    return {
        "template": {
            "id": template.id,
            "location_code": template.location_code,
            "template_name": template.template_name,
        },
        "columns": build_dynamic_material_balance_columns_response(columns),
        "rows": report_rows,
    }
