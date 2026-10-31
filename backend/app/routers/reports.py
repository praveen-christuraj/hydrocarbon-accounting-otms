from datetime import datetime, timedelta, date, time as datetime_time
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
import io
import openpyxl
from openpyxl.utils import get_column_letter

from app.database import get_db
from app.models import (
    Asset, Location, TankOperation,
    TankStockLedger, LocationAccountingDaySetting, MaterialBalanceTemplate,
    MaterialBalanceTemplateColumn, OperationTransaction, OperationTransactionValue,
    MovementMapping, MovementMappingItem, MovementMappingComparison, User,
    OperationTemplate,
)
from app.schemas import (
    TankStockLedgerResponse, TankStockLedgerSummaryResponse,
    TankStockLedgerDailySummaryResponse, OutTurnReportResponse,
    MaterialBalanceDynamicReportResponse, FSOOTRReportResponse,
    FSOMaterialBalanceReportResponse, FSOOutturnReportResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    apply_location_filter,
    apply_transaction_party_scope_filter,
    ensure_location_in_user_scope,
    require_user_permission,
)
from app.services.audit_service import create_audit_log
from app.utils.helpers import (
    safe_float, clean_optional_text, get_transaction_ticket_number,
    get_location_by_code, get_current_user_display_name, get_asset_by_code,
    normalize_code, normalize_entry_layout_type,
)
from app.config import APPROVED_TRANSACTION_STATUS
from app.utils.pagination import (
    DEFAULT_REPORT_PAGE_SIZE,
    MAX_REPORT_PAGE_SIZE,
    clamp_limit,
    default_window_start,
)
from app.routers.tank_stock_ledger import (
    get_filtered_tank_stock_ledger_rows,
    build_tank_stock_ledger_response,
    build_date_range,
    get_active_location_day_setting,
    compute_accounting_date,
    combine_operation_datetime,
    get_tank_stock_rows_for_daily_summary,
    get_stock_snapshot_values,
    get_ledger_operation_datetime,
    build_out_turn_report_response,
    build_tank_stock_daily_summary_rows,
    get_out_turn_report_rows,
    get_material_balance_rows_for_continuity as _shared_get_mb_rows_for_continuity,
    build_dynamic_material_balance_columns_response as _shared_build_mb_columns_response,
    build_dynamic_material_balance_tank_rows as _shared_build_mb_tank_rows,
    consolidate_dynamic_material_balance_rows_by_location as _shared_consolidate_mb_rows,
    get_tank_stock_ledger_summary as _shared_get_ledger_summary,
    validate_out_turn_report_tank_sequence as _shared_validate_otr_sequence,
)
from app.services.operation_datetime import (
    calculate_window_from_setting_parts,
    coerce_payload_dict,
    format_time_hhmm,
    get_payload_operation_date,
    get_payload_operation_datetime,
    get_payload_operation_parts,
    resolve_location_accounting_window,
    resolve_transaction_accounting,
    resolve_transaction_operation_date,
    resolve_transaction_operation_datetime,
)
from app.services.transaction_helpers import parse_date_filter
from app.services.material_balance_helpers import (
    normalize_material_balance_category,
    normalize_material_balance_code_value,
    get_active_material_balance_template_for_location,
    get_active_material_balance_template_columns,
    get_movement_value_for_unit,
    get_snapshot_value_for_unit,
    should_row_match_material_balance_column,
    get_global_internal_transfer_operation_codes,
    should_row_be_in_book_closing_formula,
    calculate_book_closing_from_eligible_ledger_rows,
)

router = APIRouter(prefix="/reports", tags=["Reports"])


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
    items = db.query(MovementMappingItem).filter(MovementMappingItem.mapping_id == mapping.id).all()

    source = [i for i in items if str(i.role).upper() == "SOURCE"]
    target = [i for i in items if str(i.role).upper() == "TARGET"]

    return {
        "id": mapping.id,
        "location_code": mapping.location_code,
        "mapping_status": mapping.mapping_status,
        "mapping_label": mapping.mapping_label,
        "source_tickets": [{"ticket_number": i.ticket_number, "ticket_label": i.ticket_label, "movement_date": i.movement_date, "operation_number": i.operation_number} for i in source],
        "target_tickets": [{"ticket_number": i.ticket_number, "ticket_label": i.ticket_label, "movement_date": i.movement_date, "operation_number": i.operation_number} for i in target],
}


def _build_out_turn_transaction_payload_map(db: Session, transaction_ids: list[int]):
    if not transaction_ids:
        return {}

    rows = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id.in_(transaction_ids),
            OperationTransactionValue.field_code.in_([
                "tank_gauging_payload",
                "multi_tank_payload",
                "net_nsv",
            ]),
        )
        .all()
    )

    payload_map = {}

    for row in rows:
        if row.transaction_id not in payload_map:
            payload_map[row.transaction_id] = {}

        if row.field_code == "net_nsv":
            payload_map[row.transaction_id][row.field_code] = row.field_value
        else:
            payload_map[row.transaction_id][row.field_code] = coerce_payload_dict(
                row.field_value
            )

    return payload_map


def _parse_operation_datetime(operation_date: date, payload: dict):
    payload_datetime = get_payload_operation_datetime(payload)
    if payload_datetime is not None:
        return payload_datetime

    return datetime.combine(operation_date, datetime_time(0, 0))


def _out_turn_accounting_date(
    db: Session | None,
    transaction: OperationTransaction,
    payload: dict,
    setting_cache: dict | None = None,
):
    """Accounting date of an out-turn row: payload moment + location setting."""
    if db is not None:
        _, _, _, accounting_date = resolve_transaction_accounting(
            db,
            transaction,
            payload=payload,
            setting_cache=setting_cache,
        )
        return accounting_date

    payload_date = get_payload_operation_date(payload)
    return payload_date or transaction.operation_date


def _resolve_tank_op_meta(
    transaction: OperationTransaction,
    inputs: dict,
    tank_ops_by_code: dict | None = None,
    tank_ops_by_id: dict | None = None,
):
    op_code = clean_optional_text(inputs.get("tankOperationCode")) or ""
    op_label = clean_optional_text(inputs.get("tankOperationLabel")) or ""
    op_cat = clean_optional_text(inputs.get("tankOperationCategory")) or ""
    op_sign = clean_optional_text(inputs.get("tankOperationSign")) or ""

    loc_key = str(transaction.origin_location_code or "").strip().lower()
    tank_op = None
    if tank_ops_by_code and op_code:
        tank_op = tank_ops_by_code.get((loc_key, op_code.lower())) or tank_ops_by_code.get(
            op_code.lower()
        )
    if tank_op is None and tank_ops_by_id:
        op_id_raw = inputs.get("tankOperationId")
        if op_id_raw not in (None, ""):
            try:
                tank_op = tank_ops_by_id.get(int(op_id_raw))
            except (TypeError, ValueError):
                tank_op = None
        if tank_op is None and getattr(transaction, "tank_operation_id", None):
            tank_op = tank_ops_by_id.get(transaction.tank_operation_id)

    if tank_op is not None:
        op_code = op_code or (tank_op.operation_code or "")
        op_label = op_label or (tank_op.operation_label or "")
        op_cat = op_cat or (tank_op.operation_category or "")
        op_sign = op_sign or (tank_op.operation_sign or "")

    return op_code, op_label, op_cat, op_sign


def _extract_out_turn_values_from_transaction(db: Session, transaction: OperationTransaction):
    template = (
        db.query(OperationTemplate)
        .filter(OperationTemplate.id == transaction.operation_template_id)
        .first()
    )

    if not template:
        return []

    layout = normalize_entry_layout_type(template.entry_layout_type)

    payload_map = _build_out_turn_transaction_payload_map(db, [transaction.id])
    payloads = payload_map.get(transaction.id, {})

    if layout == "tank gauging":
        return _extract_tank_gauging_out_turn(transaction, payloads.get("tank_gauging_payload") or {}, db=db)
    elif layout == "multi-tank before/after":
        return _extract_multi_tank_out_turn(transaction, payloads.get("multi_tank_payload") or {}, db=db)
    elif layout == "stock movement":
        return _extract_stock_movement_out_turn(transaction, payloads.get("net_nsv"), db=db)
    elif layout == "vessel cycle":
        return _extract_stock_movement_out_turn(transaction, payloads.get("net_nsv"), db=db)

    return []


def _extract_tank_gauging_out_turn(
    transaction: OperationTransaction,
    payload: dict,
    db: Session | None = None,
    setting_cache: dict | None = None,
    tank_ops_by_code: dict | None = None,
    tank_ops_by_id: dict | None = None,
):
    payload = coerce_payload_dict(payload)
    calculated = payload.get("calculated") or {}
    inputs = payload.get("inputs") or {}

    nsv = safe_float(
        calculated.get("nsvBbl")
        if calculated.get("nsvBbl") not in (None, "")
        else calculated.get("nsv")
    )
    gsv = safe_float(
        calculated.get("gsvBbl")
        if calculated.get("gsvBbl") not in (None, "")
        else calculated.get("gsv")
    )
    lt = safe_float(calculated.get("lt"))
    mt = safe_float(calculated.get("mt"))

    if nsv == 0 and gsv == 0:
        return []

    gauging_date, gauging_time = get_payload_operation_parts(
        payload, "tank_gauging_payload"
    )
    operation_datetime = _parse_operation_datetime(transaction.operation_date, payload)
    accounting_date = _out_turn_accounting_date(db, transaction, payload, setting_cache)
    op_code, op_label, op_cat, op_sign = _resolve_tank_op_meta(
        transaction, inputs, tank_ops_by_code, tank_ops_by_id
    )

    return [
        {
            "transaction_id": transaction.id,
            "ticket_number": get_transaction_ticket_number(transaction),
            "operation_number": transaction.operation_number,
            "accounting_date": accounting_date,
            "gauging_date": gauging_date or transaction.operation_date,
            "gauging_time": format_time_hhmm(gauging_time) if gauging_time else None,
            "operation_datetime": operation_datetime,
            "location_code": transaction.origin_location_code,
            "tank_asset_code": transaction.primary_asset_code,
            "product_name": transaction.product_name,
            "tank_operation_code": op_code,
            "tank_operation_label": op_label,
            "tank_operation_category": op_cat,
            "tank_operation_sign": op_sign,
            "gsv": gsv,
            "nsv": nsv,
            "lt": lt,
            "mt": mt,
            "status": transaction.status,
        }
    ]


def _extract_multi_tank_out_turn(
    transaction: OperationTransaction,
    payload: dict,
    db: Session | None = None,
    setting_cache: dict | None = None,
    tank_ops_by_code: dict | None = None,
    tank_ops_by_id: dict | None = None,
):
    payload = coerce_payload_dict(payload)
    per_tank_after = ((payload.get("perTank") or {}).get("after") or {})
    inputs = payload.get("inputs") or {}

    if not per_tank_after:
        return []

    gauging_date, gauging_time = get_payload_operation_parts(
        payload, "multi_tank_payload"
    )
    operation_datetime = _parse_operation_datetime(transaction.operation_date, payload)
    accounting_date = _out_turn_accounting_date(db, transaction, payload, setting_cache)
    op_code, op_label, op_cat, op_sign = _resolve_tank_op_meta(
        transaction, inputs, tank_ops_by_code, tank_ops_by_id
    )

    results = []

    for tank_key, tank_data in per_tank_after.items():
        if not isinstance(tank_data, dict):
            continue

        nsv = safe_float(tank_data.get("NSV"))
        gsv = safe_float(tank_data.get("GSV"))
        lt = safe_float(tank_data.get("LT"))
        mt = safe_float(tank_data.get("MT"))

        if nsv == 0 and gsv == 0:
            continue

        results.append(
            {
                "transaction_id": transaction.id,
                "ticket_number": get_transaction_ticket_number(transaction),
                "operation_number": transaction.operation_number,
                "accounting_date": accounting_date,
                "gauging_date": gauging_date or transaction.operation_date,
                "gauging_time": format_time_hhmm(gauging_time) if gauging_time else None,
                "operation_datetime": operation_datetime,
                "location_code": transaction.origin_location_code,
                "tank_asset_code": tank_key,
                "product_name": transaction.product_name,
                "tank_operation_code": op_code,
                "tank_operation_label": op_label,
                "tank_operation_category": op_cat,
                "tank_operation_sign": op_sign,
                "gsv": gsv,
                "nsv": nsv,
                "lt": lt,
                "mt": mt,
                "status": transaction.status,
            }
        )

    return results


def _extract_stock_movement_out_turn(
    transaction: OperationTransaction,
    net_nsv_value,
    db: Session | None = None,
    setting_cache: dict | None = None,
):
    nsv = safe_float(net_nsv_value)

    if nsv == 0:
        return []

    operation_datetime = transaction.operation_start_datetime
    if operation_datetime is None:
        operation_datetime = datetime.combine(transaction.operation_date, datetime_time(0, 0))

    accounting_date = transaction.operation_date
    if db is not None:
        _, _, _, resolved_accounting_date = resolve_transaction_accounting(
            db,
            transaction,
            setting_cache=setting_cache,
        )
        accounting_date = resolved_accounting_date or accounting_date

    return [
        {
            "transaction_id": transaction.id,
            "ticket_number": get_transaction_ticket_number(transaction),
            "operation_number": transaction.operation_number,
            "accounting_date": accounting_date,
            "gauging_date": transaction.operation_date,
            "gauging_time": None,
            "operation_datetime": operation_datetime,
            "location_code": transaction.origin_location_code,
            "tank_asset_code": transaction.primary_asset_code,
            "product_name": transaction.product_name,
            "tank_operation_code": "",
            "tank_operation_label": "",
            "tank_operation_category": "",
            "tank_operation_sign": "",
            "gsv": 0,
            "nsv": nsv,
            "lt": 0,
            "mt": 0,
            "status": transaction.status,
        }
    ]


def get_out_turn_report_rows_from_transactions(
    db: Session,
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: User | None = None,
):
    from app.services.transaction_helpers import approved_transaction_not_on_correction_hold

    date_from_value = parse_date_filter(date_from, "Date From")
    date_to_value = parse_date_filter(date_to, "Date To")

    query = (
        db.query(OperationTransaction)
        .join(OperationTemplate, OperationTransaction.operation_template_id == OperationTemplate.id)
        .filter(
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
            func.lower(func.trim(OperationTemplate.entry_layout_type)).in_([
                "tank gauging",
                "multi-tank before/after",
                "stock movement",
                "vessel cycle",
            ]),
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
        query = query.filter(
            OperationTransaction.origin_location_code.ilike(cleaned_location_code)
        )

    if cleaned_tank_asset_code:
        query = query.filter(
            OperationTransaction.primary_asset_code.ilike(cleaned_tank_asset_code)
        )

    transactions = query.order_by(OperationTransaction.id.asc()).all()
    if not transactions:
        return []

    payload_map = _build_out_turn_transaction_payload_map(
        db, [tx.id for tx in transactions]
    )
    all_tank_ops = db.query(TankOperation).all()
    tank_ops_by_code = {}
    for op in all_tank_ops:
        c = str(op.operation_code or "").strip().lower()
        loc = str(op.location_code or "").strip().lower()
        tank_ops_by_code[(loc, c)] = op
        tank_ops_by_code.setdefault(c, op)
    tank_ops_by_id = {op.id: op for op in all_tank_ops}

    template_cache = {}
    setting_cache = {}
    extracted_rows = []

    for tx in transactions:
        if tx.operation_template_id is None:
            continue

        if tx.operation_template_id not in template_cache:
            template_cache[tx.operation_template_id] = (
                db.query(OperationTemplate)
                .filter(OperationTemplate.id == tx.operation_template_id)
                .first()
            )

        template = template_cache[tx.operation_template_id]
        if not template:
            continue

        payloads = payload_map.get(tx.id, {})
        entry_layout = normalize_entry_layout_type(template.entry_layout_type)

        if entry_layout == "tank gauging":
            extracted_rows.extend(
                _extract_tank_gauging_out_turn(
                    tx,
                    payloads.get("tank_gauging_payload") or {},
                    db=db,
                    setting_cache=setting_cache,
                    tank_ops_by_code=tank_ops_by_code,
                    tank_ops_by_id=tank_ops_by_id,
                )
            )
        elif entry_layout == "multi-tank before/after":
            extracted_rows.extend(
                _extract_multi_tank_out_turn(
                    tx,
                    payloads.get("multi_tank_payload") or {},
                    db=db,
                    setting_cache=setting_cache,
                    tank_ops_by_code=tank_ops_by_code,
                    tank_ops_by_id=tank_ops_by_id,
                )
            )
        elif entry_layout in ("stock movement", "vessel cycle"):
            extracted_rows.extend(
                _extract_stock_movement_out_turn(
                    tx,
                    payloads.get("net_nsv"),
                    db=db,
                    setting_cache=setting_cache,
                )
            )

    if not extracted_rows:
        return []

    window_from = date_from_value
    if window_from is None:
        candidate_dates = [
            row["accounting_date"]
            for row in extracted_rows
            if row.get("accounting_date") is not None
            and (date_to_value is None or row["accounting_date"] <= date_to_value)
        ]
        if candidate_dates:
            window_from = default_window_start(max(candidate_dates))

    grouped_rows = {}
    for row in extracted_rows:
        key = (row["location_code"], row["tank_asset_code"])
        grouped_rows.setdefault(key, []).append(row)

    per_tank_rows = []

    for _key, group_rows in grouped_rows.items():
        # Chronological ordering per tank strictly by payload gauging datetime,
        # NEVER pre-grouped by accounting_date or dropped before window_from.
        sorted_group = sorted(
            group_rows,
            key=lambda item: (
                item["operation_datetime"] or datetime.min,
                item["transaction_id"],
            ),
        )

        previous_gsv = 0.0
        previous_nsv = 0.0
        previous_lt = 0.0
        previous_mt = 0.0
        sequence = 0

        for item in sorted_group:
            current_gsv = safe_float(item["gsv"])
            current_nsv = safe_float(item["nsv"])
            current_lt = safe_float(item["lt"])
            current_mt = safe_float(item["mt"])

            per_tank_rows.append(
                {
                    "sequence": sequence,
                    "location_code": item["location_code"],
                    "tank_asset_code": item["tank_asset_code"],
                    "product_name": item["product_name"],
                    "transaction_id": item["transaction_id"],
                    "ticket_number": item["ticket_number"],
                    "operation_number": item["operation_number"],
                    "accounting_date": item["accounting_date"],
                    "gauging_date": item.get("gauging_date"),
                    "gauging_time": item.get("gauging_time"),
                    "operation_datetime": item["operation_datetime"],
                    "tank_operation_code": item["tank_operation_code"],
                    "tank_operation_label": item["tank_operation_label"],
                    "tank_operation_category": item["tank_operation_category"],
                    "tank_operation_sign": item["tank_operation_sign"],
                    "previous_gsv": previous_gsv,
                    "previous_nsv": previous_nsv,
                    "previous_lt": previous_lt,
                    "previous_mt": previous_mt,
                    "stock_after_gsv": current_gsv,
                    "stock_after_nsv": current_nsv,
                    "stock_after_lt": current_lt,
                    "stock_after_mt": current_mt,
                    "signed_net_gsv": current_gsv - previous_gsv,
                    "signed_net_nsv": current_nsv - previous_nsv,
                    "signed_net_lt": current_lt - previous_lt,
                    "signed_net_mt": current_mt - previous_mt,
                    "status": item["status"],
                }
            )

            previous_gsv = current_gsv
            previous_nsv = current_nsv
            previous_lt = current_lt
            previous_mt = current_mt
            sequence += 1

    per_tank_rows.sort(
        key=lambda r: (
            r["accounting_date"] or date.min,
            r["operation_datetime"] or datetime.min,
            r["location_code"] or "",
            r["tank_asset_code"] or "",
            r["transaction_id"] or 0,
        )
    )

    if window_from is not None or date_to_value is not None:
        per_tank_rows = [
            row
            for row in per_tank_rows
            if (
                window_from is None
                or (row["accounting_date"] or date.min) >= window_from
            )
            and (
                date_to_value is None
                or (row["accounting_date"] or date.max) <= date_to_value
            )
        ]

    if cleaned_product_name:
        product_key = cleaned_product_name.casefold()
        per_tank_rows = [
            row
            for row in per_tank_rows
            if str(row.get("product_name") or "").casefold() == product_key
        ]

    return per_tank_rows


_UNSET = object()


def build_out_turn_report_response_from_transaction(
    row: dict,
    db: Session,
    tank_asset_name=_UNSET,
    location_name=_UNSET,
):
    from app.services.stock_ledger_helpers import build_out_turn_report_response_from_values

    return build_out_turn_report_response_from_values(
        params={
            "ledger_id": row.get("transaction_id", 0) * 1000000 + (row.get("sequence") or 0),
            "transaction_id": row.get("transaction_id"),
            "ticket_number": row.get("ticket_number") or "",
            "operation_number": row.get("operation_number") or "",
            "accounting_date": row.get("accounting_date"),
            "operation_datetime": row.get("operation_datetime"),
            "location_code": row.get("location_code") or "",
            # Explicit None = prefetched-but-missing (pass "" so the shared
            # builder uses it verbatim); omitted = look the name up there.
            "location_name": None if location_name is _UNSET else (location_name or ""),
            "tank_asset_code": row.get("tank_asset_code") or "",
            "tank_asset_name": getattr(get_asset_by_code(row.get("tank_asset_code") or "", db), "asset_name", "")
            if tank_asset_name is _UNSET
            else (tank_asset_name or ""),
            "product_name": row.get("product_name") or "",
            "tank_operation_code": row.get("tank_operation_code") or "",
            "tank_operation_label": row.get("tank_operation_label") or "",
            "tank_operation_category": row.get("tank_operation_category") or "",
            "tank_operation_sign": row.get("tank_operation_sign") or "",
            "previous_gsv": row.get("previous_gsv") or 0,
            "previous_nsv": row.get("previous_nsv") or 0,
            "previous_lt": row.get("previous_lt") or 0,
            "previous_mt": row.get("previous_mt") or 0,
            "stock_after_gsv": row.get("stock_after_gsv") or 0,
            "stock_after_nsv": row.get("stock_after_nsv") or 0,
            "stock_after_lt": row.get("stock_after_lt") or 0,
            "stock_after_mt": row.get("stock_after_mt") or 0,
            "signed_net_gsv": row.get("signed_net_gsv"),
            "signed_net_nsv": row.get("signed_net_nsv"),
            "signed_net_lt": row.get("signed_net_lt"),
            "signed_net_mt": row.get("signed_net_mt"),
            "status": "Approved",
            "remarks": None,
        },
        db=db,
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

    cleaned_status = clean_optional_text(status)

def get_material_balance_rows_for_continuity(
    db: Session,
    location_code: str | None,
    tank_asset_code: str | None,
    product_name: str | None,
    date_to_value: date,
    status: str | None = "Active",
):
    return _shared_get_mb_rows_for_continuity(
        db=db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_to_value=date_to_value,
        status=status,
    )


def build_material_balance_report_rows(
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

    material_balance_rows = []

    for key, rows in grouped_rows.items():
        location_code, tank_asset_code = key

        location = get_location_by_code(location_code, db)

        sorted_rows = sorted(
            rows,
            key=lambda row: (
                row.accounting_date or date.min,
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
                if normalize_material_balance_category(
                    row.tank_operation_category
                )
                == "OPENING"
            ]

            if opening_rows:
                opening_snapshot = get_stock_snapshot_values(opening_rows[-1])

                opening_gsv = opening_snapshot["gsv"]
                opening_nsv = opening_snapshot["nsv"]
                opening_lt = opening_snapshot["lt"]
                opening_mt = opening_snapshot["mt"]

            buckets = {
                "receipt_gsv": 0,
                "receipt_nsv": 0,
                "receipt_lt": 0,
                "receipt_mt": 0,
                "production_gsv": 0,
                "production_nsv": 0,
                "production_lt": 0,
                "production_mt": 0,
                "dispatch_gsv": 0,
                "dispatch_nsv": 0,
                "dispatch_lt": 0,
                "dispatch_mt": 0,
                "draining_gsv": 0,
                "draining_nsv": 0,
                "draining_lt": 0,
                "draining_mt": 0,
                "other_in_gsv": 0,
                "other_in_nsv": 0,
                "other_in_lt": 0,
                "other_in_mt": 0,
                "other_out_gsv": 0,
                "other_out_nsv": 0,
                "other_out_lt": 0,
                "other_out_mt": 0,
            }

            for row in day_rows:
                sign = str(row.tank_operation_sign or "").upper()
                category = normalize_material_balance_category(
                    row.tank_operation_category
                )

                if sign == "IN":
                    if category == "RECEIPT":
                        add_volume_values(buckets, "receipt", row)
                    elif category == "PRODUCTION":
                        add_volume_values(buckets, "production", row)
                    else:
                        add_volume_values(buckets, "other_in", row)

                elif sign == "OUT":
                    if category == "DISPATCH":
                        add_volume_values(buckets, "dispatch", row)
                    elif category == "DRAINING":
                        add_volume_values(buckets, "draining", row)
                    else:
                        add_volume_values(buckets, "other_out", row)

            total_in_gsv = (
                buckets["receipt_gsv"]
                + buckets["production_gsv"]
                + buckets["other_in_gsv"]
            )
            total_in_nsv = (
                buckets["receipt_nsv"]
                + buckets["production_nsv"]
                + buckets["other_in_nsv"]
            )
            total_in_lt = (
                buckets["receipt_lt"]
                + buckets["production_lt"]
                + buckets["other_in_lt"]
            )
            total_in_mt = (
                buckets["receipt_mt"]
                + buckets["production_mt"]
                + buckets["other_in_mt"]
            )

            total_out_gsv = (
                buckets["dispatch_gsv"]
                + buckets["draining_gsv"]
                + buckets["other_out_gsv"]
            )
            total_out_nsv = (
                buckets["dispatch_nsv"]
                + buckets["draining_nsv"]
                + buckets["other_out_nsv"]
            )
            total_out_lt = (
                buckets["dispatch_lt"]
                + buckets["draining_lt"]
                + buckets["other_out_lt"]
            )
            total_out_mt = (
                buckets["dispatch_mt"]
                + buckets["draining_mt"]
                + buckets["other_out_mt"]
            )

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
                    if normalize_material_balance_category(
                        row.tank_operation_category
                    )
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

            material_balance_rows.append(
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
                    "receipt_gsv_bbl": round(buckets["receipt_gsv"], 3),
                    "receipt_nsv_bbl": round(buckets["receipt_nsv"], 3),
                    "receipt_lt": round(buckets["receipt_lt"], 3),
                    "receipt_mt": round(buckets["receipt_mt"], 3),
                    "production_gsv_bbl": round(buckets["production_gsv"], 3),
                    "production_nsv_bbl": round(buckets["production_nsv"], 3),
                    "production_lt": round(buckets["production_lt"], 3),
                    "production_mt": round(buckets["production_mt"], 3),
                    "dispatch_gsv_bbl": round(buckets["dispatch_gsv"], 3),
                    "dispatch_nsv_bbl": round(buckets["dispatch_nsv"], 3),
                    "dispatch_lt": round(buckets["dispatch_lt"], 3),
                    "dispatch_mt": round(buckets["dispatch_mt"], 3),
                    "draining_gsv_bbl": round(buckets["draining_gsv"], 3),
                    "draining_nsv_bbl": round(buckets["draining_nsv"], 3),
                    "draining_lt": round(buckets["draining_lt"], 3),
                    "draining_mt": round(buckets["draining_mt"], 3),
                    "other_in_gsv_bbl": round(buckets["other_in_gsv"], 3),
                    "other_in_nsv_bbl": round(buckets["other_in_nsv"], 3),
                    "other_in_lt": round(buckets["other_in_lt"], 3),
                    "other_in_mt": round(buckets["other_in_mt"], 3),
                    "other_out_gsv_bbl": round(buckets["other_out_gsv"], 3),
                    "other_out_nsv_bbl": round(buckets["other_out_nsv"], 3),
                    "other_out_lt": round(buckets["other_out_lt"], 3),
                    "other_out_mt": round(buckets["other_out_mt"], 3),
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
        material_balance_rows,
        key=lambda row: (
            row["accounting_date"],
            row["location_code"],
            row["tank_asset_code"] or "",
        ),
    )


def consolidate_material_balance_rows_by_location(
    tank_wise_rows: list[dict],
):
    consolidated_map = {}

    for row in tank_wise_rows:
        key = (row["accounting_date"], row["location_code"])

        if key not in consolidated_map:
            consolidated_map[key] = {
                "accounting_date": row["accounting_date"],
                "location_code": row["location_code"],
                "location_name": row["location_name"],
                "tank_asset_code": None,
                "tank_asset_name": "All Tanks",
                "product_name": None,
                "opening_gsv_bbl": 0,
                "opening_nsv_bbl": 0,
                "opening_lt": 0,
                "opening_mt": 0,
                "receipt_gsv_bbl": 0,
                "receipt_nsv_bbl": 0,
                "receipt_lt": 0,
                "receipt_mt": 0,
                "production_gsv_bbl": 0,
                "production_nsv_bbl": 0,
                "production_lt": 0,
                "production_mt": 0,
                "dispatch_gsv_bbl": 0,
                "dispatch_nsv_bbl": 0,
                "dispatch_lt": 0,
                "dispatch_mt": 0,
                "draining_gsv_bbl": 0,
                "draining_nsv_bbl": 0,
                "draining_lt": 0,
                "draining_mt": 0,
                "other_in_gsv_bbl": 0,
                "other_in_nsv_bbl": 0,
                "other_in_lt": 0,
                "other_in_mt": 0,
                "other_out_gsv_bbl": 0,
                "other_out_nsv_bbl": 0,
                "other_out_lt": 0,
                "other_out_mt": 0,
                "total_in_gsv_bbl": 0,
                "total_in_nsv_bbl": 0,
                "total_in_lt": 0,
                "total_in_mt": 0,
                "total_out_gsv_bbl": 0,
                "total_out_nsv_bbl": 0,
                "total_out_lt": 0,
                "total_out_mt": 0,
                "book_closing_gsv_bbl": 0,
                "book_closing_nsv_bbl": 0,
                "book_closing_lt": 0,
                "book_closing_mt": 0,
                "actual_closing_gsv_bbl": 0,
                "actual_closing_nsv_bbl": 0,
                "actual_closing_lt": 0,
                "actual_closing_mt": 0,
                "loss_gain_gsv_bbl": 0,
                "loss_gain_nsv_bbl": 0,
                "loss_gain_lt": 0,
                "loss_gain_mt": 0,
                "rows_count": 0,
                "last_ticket_number": None,
            }

        target = consolidated_map[key]

        numeric_fields = [
            "opening_gsv_bbl",
            "opening_nsv_bbl",
            "opening_lt",
            "opening_mt",
            "receipt_gsv_bbl",
            "receipt_nsv_bbl",
            "receipt_lt",
            "receipt_mt",
            "production_gsv_bbl",
            "production_nsv_bbl",
            "production_lt",
            "production_mt",
            "dispatch_gsv_bbl",
            "dispatch_nsv_bbl",
            "dispatch_lt",
            "dispatch_mt",
            "draining_gsv_bbl",
            "draining_nsv_bbl",
            "draining_lt",
            "draining_mt",
            "other_in_gsv_bbl",
            "other_in_nsv_bbl",
            "other_in_lt",
            "other_in_mt",
            "other_out_gsv_bbl",
            "other_out_nsv_bbl",
            "other_out_lt",
            "other_out_mt",
            "total_in_gsv_bbl",
            "total_in_nsv_bbl",
            "total_in_lt",
            "total_in_mt",
            "total_out_gsv_bbl",
            "total_out_nsv_bbl",
            "total_out_lt",
            "total_out_mt",
            "book_closing_gsv_bbl",
            "book_closing_nsv_bbl",
            "book_closing_lt",
            "book_closing_mt",
            "actual_closing_gsv_bbl",
            "actual_closing_nsv_bbl",
            "actual_closing_lt",
            "actual_closing_mt",
            "loss_gain_gsv_bbl",
            "loss_gain_nsv_bbl",
            "loss_gain_lt",
            "loss_gain_mt",
        ]

        for field in numeric_fields:
            target[field] += safe_float(row.get(field))

        target["rows_count"] += int(row.get("rows_count") or 0)

        if row.get("last_ticket_number"):
            target["last_ticket_number"] = row.get("last_ticket_number")

    consolidated_rows = []

    for row in consolidated_map.values():
        for key, value in list(row.items()):
            if isinstance(value, float):
                row[key] = round(value, 3)

        consolidated_rows.append(row)

    return sorted(
        consolidated_rows,
        key=lambda row: (
            row["accounting_date"],
            row["location_code"],
        ),
    )


def build_dynamic_material_balance_columns_response(
    columns: list[MaterialBalanceTemplateColumn],
):
    return _shared_build_mb_columns_response(columns)


def build_dynamic_material_balance_tank_rows(
    db: Session,
    ledger_rows: list[TankStockLedger],
    columns: list[MaterialBalanceTemplateColumn],
    date_from_value: date,
    date_to_value: date,
    unit_key: str = "nsv",
):
    return _shared_build_mb_tank_rows(
        db=db,
        ledger_rows=ledger_rows,
        columns=columns,
        date_from_value=date_from_value,
        date_to_value=date_to_value,
        unit_key=unit_key,
    )


def consolidate_dynamic_material_balance_rows_by_location(
    tank_rows: list[dict],
    columns: list[MaterialBalanceTemplateColumn],
):
    return _shared_consolidate_mb_rows(tank_rows=tank_rows, columns=columns)


@router.get(
    "/tank-stock-ledger",
    response_model=list[TankStockLedgerResponse],
)
def get_tank_stock_ledger(
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

    return [
        build_tank_stock_ledger_response(row, db)
        for row in ledger_rows
    ]


@router.get(
    "/tank-stock-ledger/summary",
    response_model=list[TankStockLedgerSummaryResponse],
)
def get_tank_stock_ledger_summary(
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    return _shared_get_ledger_summary(
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=date_from,
        date_to=date_to,
        status="Active",
        current_user=current_user,
        db=db,
    )


@router.get(
    "/tank-stock-ledger/daily-summary",
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


@router.get(
    "/out-turn-report",
    response_model=list[OutTurnReportResponse],
)
def get_out_turn_report(
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Out-Turn Report",
        db,
    )

    rows = get_out_turn_report_rows_from_transactions(
        db=db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=date_from,
        date_to=date_to,
        current_user=current_user,
    )

    # Bounded payload (rows are already limited to the recent window when
    # no date range is given); explicit exports pass their own handling.
    rows = rows[: clamp_limit(limit, DEFAULT_REPORT_PAGE_SIZE, MAX_REPORT_PAGE_SIZE)]

    def _key(code):
        return str(code or "").strip().lower()

    asset_names = {
        _key(row.asset_code): row.asset_name for row in db.query(Asset).all()
    }
    location_names = {
        _key(row.location_code): row.location_name
        for row in db.query(Location).all()
    }

    return [
        build_out_turn_report_response_from_transaction(
            row,
            db,
            tank_asset_name=asset_names.get(_key(row.get("tank_asset_code"))),
            location_name=location_names.get(_key(row.get("location_code"))),
        )
        for row in rows
    ]


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
    return _shared_validate_otr_sequence(
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=date_from,
        date_to=date_to,
        current_user=current_user,
        db=db,
    )


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
    status: str | None = "Active",
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
    ensure_location_in_user_scope(
        current_user, db, cleaned_location_code, "Location"
    )

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
        # Product is reference data and must not narrow material-balance rows.
        product_name=None,
        date_to_value=date_to_value,
        status=status,
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


def build_fso_otr_report(
    db: Session,
    location_code: str,
    fso_asset_code: str,
    date_from: date,
    date_to: date,
    shuttle_number: str | None = None,
):
    from app.services.transaction_helpers import approved_transaction_not_on_correction_hold

    loc_code = clean_optional_text(location_code)
    asset_code = clean_optional_text(fso_asset_code)
    sn = clean_optional_text(shuttle_number)

    q = (
        db.query(OperationTransaction, OperationTransactionValue)
        .join(OperationTransactionValue, OperationTransactionValue.transaction_id == OperationTransaction.id)
        .filter(
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
            OperationTransaction.origin_location_code == loc_code,
            OperationTransaction.primary_asset_code == asset_code,
            OperationTransactionValue.field_code == "fso_payload",
        )
        .order_by(OperationTransaction.id.asc())
    )
    if sn:
        q = q.filter(OperationTransaction.convoy_number == sn)

    totals = {
        "receipt": 0.0,
        "export": 0.0,
        "movement": 0.0,
        "variance": 0.0,
        "compare_variance": 0.0,
    }

    setting_cache = {}
    sortable_rows = []

    for tx, val in q.all():
        payload = coerce_payload_dict(val.field_value)
        meta = payload.get("meta") or {}
        inputs = payload.get("inputs") or {}
        net = ((payload.get("calculated") or {}).get("net") or {})

        event_time = inputs.get("event_time")
        op_label = str(meta.get("operation_label") or "").strip() or "FSO"
        op_sign = str(meta.get("operation_sign") or "").strip().upper()

        net_stock = float(safe_float(net.get("net_stock_bbl")))
        net_water = float(safe_float(net.get("net_water_bbl")))
        movement_qty = abs(net_stock) + abs(net_water)

        vessel_qty = float(safe_float(inputs.get("vessel_quantity_bbl")))
        variance = movement_qty - vessel_qty if op_sign == "IN" else 0.0

        src_discharge = float(safe_float(meta.get("source_shuttle_discharge_bbl")))
        compare_var = movement_qty - src_discharge if op_sign == "IN" and src_discharge > 0 else 0.0

        p_date, p_time = get_payload_operation_parts(payload, "fso_payload")
        payload_operation_date = p_date or tx.operation_date
        window = resolve_location_accounting_window(
            db,
            location_code=loc_code,
            operation_date=payload_operation_date,
            operation_time=p_time,
            setting_cache=setting_cache,
        )
        acc_date = window["accounting_date"] if window else payload_operation_date
        if not date_from <= acc_date <= date_to:
            continue

        payload_dt = datetime.combine(
            payload_operation_date, p_time or datetime_time(0, 0)
        )

        row = {
            "transaction_id": tx.id,
            "ticket_number": get_transaction_ticket_number(tx),
            "accounting_date": acc_date,
            "operation_date": payload_operation_date,
            "event_time": event_time,
            "location_code": loc_code,
            "fso_asset_code": asset_code,
            "shuttle_number": inputs.get("shuttle_number") or meta.get("shuttle_number") or tx.convoy_number,
            "operation_label": op_label,
            "operation_sign": op_sign,
            "vessel_name": inputs.get("vessel_name"),
            "vessel_quantity_bbl": vessel_qty,
            "opening_stock_bbl": float(safe_float(inputs.get("opening_stock_bbl"))),
            "opening_water_bbl": float(safe_float(inputs.get("opening_water_bbl"))),
            "closing_stock_bbl": float(safe_float(inputs.get("closing_stock_bbl"))),
            "closing_water_bbl": float(safe_float(inputs.get("closing_water_bbl"))),
            "net_stock_bbl": net_stock,
            "net_water_bbl": net_water,
            "movement_qty_bbl": movement_qty,
            "variance_bbl": variance,
            "source_shuttle_discharge_bbl": src_discharge,
            "compare_variance_bbl": compare_var,
            "remarks": inputs.get("remarks"),
        }
        sortable_rows.append((acc_date, payload_dt, tx.id, row))

        totals["movement"] += movement_qty
        totals["variance"] += variance
        totals["compare_variance"] += compare_var
        if op_sign == "IN":
            totals["receipt"] += movement_qty
        elif op_sign == "OUT":
            totals["export"] += movement_qty

    sortable_rows.sort(key=lambda item: (item[0], item[1], item[2]))
    rows = [item[3] for item in sortable_rows]

    return rows, totals


def build_fso_material_balance(
    db: Session,
    location_code: str,
    fso_asset_code: str,
    date_from: date,
    date_to: date,
):
    from app.services.transaction_helpers import approved_transaction_not_on_correction_hold

    loc_code = clean_optional_text(location_code)
    asset_code = clean_optional_text(fso_asset_code)

    q = (
        db.query(OperationTransaction, OperationTransactionValue)
        .join(OperationTransactionValue, OperationTransactionValue.transaction_id == OperationTransaction.id)
        .filter(
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
            OperationTransaction.origin_location_code == loc_code,
            OperationTransaction.primary_asset_code == asset_code,
            OperationTransactionValue.field_code == "fso_payload",
        )
        .order_by(OperationTransaction.id.asc())
    )

    setting_cache = {}
    buckets = {}
    for tx, val in q.all():
        payload = coerce_payload_dict(val.field_value)
        meta = payload.get("meta") or {}
        inputs = payload.get("inputs") or {}
        net = ((payload.get("calculated") or {}).get("net") or {})

        p_date, p_time = get_payload_operation_parts(payload, "fso_payload")
        payload_operation_date = p_date or tx.operation_date
        window = resolve_location_accounting_window(
            db,
            location_code=loc_code,
            operation_date=payload_operation_date,
            operation_time=p_time,
            setting_cache=setting_cache,
        )
        acc_date = window["accounting_date"] if window else payload_operation_date
        if acc_date > date_to:
            continue

        payload_dt = datetime.combine(
            payload_operation_date, p_time or datetime_time(0, 0)
        )
        buckets.setdefault(acc_date, []).append((payload_dt, tx, meta, inputs, net))

    pre_dates = sorted([d for d in buckets.keys() if d < date_from])
    prev_physical_close = None
    for pre_date in pre_dates:
        pre_items = sorted(buckets[pre_date], key=lambda item: (item[0], item[1].id))
        prev_physical_close = float(safe_float(pre_items[-1][3].get("closing_stock_bbl")))

    dates = sorted([d for d in buckets.keys() if date_from <= d <= date_to])
    rows = []

    for acc_date in dates:
        items = sorted(buckets[acc_date], key=lambda item: (item[0], item[1].id))

        if prev_physical_close is None:
            opening = float(safe_float(items[0][3].get("opening_stock_bbl")))
        else:
            opening = prev_physical_close

        receipt = 0.0
        export = 0.0

        for _payload_dt, tx, meta, inputs, net in items:
            op_sign = str(meta.get("operation_sign") or "").strip().upper()
            net_stock = float(safe_float(net.get("net_stock_bbl")))
            net_water = float(safe_float(net.get("net_water_bbl")))
            qty = abs(net_stock) + abs(net_water)

            if op_sign == "IN":
                receipt += qty
            elif op_sign == "OUT":
                export += qty

        book_close = opening + receipt - export

        last_inputs = items[-1][3]
        physical_close = float(safe_float(last_inputs.get("closing_stock_bbl")))
        physical_close_water = float(safe_float(last_inputs.get("closing_water_bbl")))
        loss_gain = physical_close - book_close

        rows.append(
            {
                "accounting_date": acc_date,
                "opening_stock_bbl": opening,
                "receipt_bbl": receipt,
                "export_bbl": export,
                "book_closing_bbl": book_close,
                "physical_closing_bbl": physical_close,
                "physical_closing_water_bbl": physical_close_water,
                "loss_gain_bbl": loss_gain,
            }
        )

        prev_physical_close = physical_close

    return rows


def build_fso_outturn_report(
    db: Session,
    location_code: str,
    fso_asset_code: str,
    date_from: date,
    date_to: date,
):
    from app.services.transaction_helpers import approved_transaction_not_on_correction_hold

    loc_code = clean_optional_text(location_code)
    asset_code = clean_optional_text(fso_asset_code)

    q = (
        db.query(OperationTransaction, OperationTransactionValue)
        .join(OperationTransactionValue, OperationTransactionValue.transaction_id == OperationTransaction.id)
        .filter(
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
            OperationTransaction.origin_location_code == loc_code,
            OperationTransaction.primary_asset_code == asset_code,
            OperationTransactionValue.field_code == "fso_payload",
        )
        .order_by(OperationTransaction.id.asc())
    )

    def _sf(v):
        try:
            return float(v or 0.0)
        except Exception:
            return 0.0

    def _abs_qty(net_stock, net_water):
        return abs(_sf(net_stock)) + abs(_sf(net_water))

    setting_cache = {}
    buckets = {}
    for tx, val in q.all():
        payload = coerce_payload_dict(val.field_value)
        meta = payload.get("meta") or {}
        inputs = payload.get("inputs") or {}
        net = ((payload.get("calculated") or {}).get("net") or {})

        p_date, p_time = get_payload_operation_parts(payload, "fso_payload")
        payload_operation_date = p_date or tx.operation_date
        window = resolve_location_accounting_window(
            db,
            location_code=loc_code,
            operation_date=payload_operation_date,
            operation_time=p_time,
            setting_cache=setting_cache,
        )
        acc_date = window["accounting_date"] if window else payload_operation_date
        if not date_from <= acc_date <= date_to:
            continue

        shuttle_no = (
            inputs.get("shuttle_number")
            or meta.get("shuttle_number")
            or tx.convoy_number
            or ""
        ).strip()
        if shuttle_no == "":
            continue

        key = (acc_date, shuttle_no)
        buckets.setdefault(key, {"receipt": 0.0, "discharge": 0.0})

        op_sign = str(meta.get("operation_sign") or "").strip().upper()

        net_stock = net.get("net_stock_bbl")
        net_water = net.get("net_water_bbl")
        qty = _abs_qty(net_stock, net_water)

        if op_sign == "IN":
            buckets[key]["receipt"] += qty

        src = meta.get("source_shuttle_discharge_bbl")
        if src is not None:
            buckets[key]["discharge"] = max(buckets[key]["discharge"], _sf(src))

    rows = []
    totals = {"discharge": 0.0, "receipt": 0.0, "variance": 0.0}

    for (acc_date, shuttle_no) in sorted(buckets.keys()):
        discharge = float(buckets[(acc_date, shuttle_no)]["discharge"])
        receipt = float(buckets[(acc_date, shuttle_no)]["receipt"])
        # FSO variance = FSO receipt - shuttle discharge.
        variance = receipt - discharge
        pct = (variance / discharge * 100.0) if discharge != 0 else 0.0

        rows.append(
            {
                "accounting_date": acc_date,
                "shuttle_number": shuttle_no,
                "shuttle_discharge_bbl": discharge,
                "fso_receipt_bbl": receipt,
                "variance_bbl": variance,
                "variance_pct": pct,
            }
        )

        totals["discharge"] += discharge
        totals["receipt"] += receipt
        totals["variance"] += variance

    totals_pct = (totals["variance"] / totals["discharge"] * 100.0) if totals["discharge"] != 0 else 0.0
    return rows, totals, totals_pct


def _xlsx_autofit(ws):
    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            v = "" if cell.value is None else str(cell.value)
            max_len = max(max_len, len(v))
        ws.column_dimensions[col_letter].width = min(max(10, max_len + 2), 45)


@router.get("/fso/otr", response_model=FSOOTRReportResponse)
def get_fso_otr_report(
    location_code: str,
    fso_asset_code: str,
    date_from: str,
    date_to: str,
    shuttle_number: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View FSO Tracking", db)
    ensure_location_in_user_scope(current_user, db, location_code, "Location")
    df = parse_date_filter(date_from, "date_from")
    dt = parse_date_filter(date_to, "date_to")

    rows, totals = build_fso_otr_report(db, location_code, fso_asset_code, df, dt, shuttle_number)
    return {
        "rows": rows,
        "total_receipt_bbl": totals["receipt"],
        "total_export_bbl": totals["export"],
        "total_movement_bbl": totals["movement"],
        "total_variance_bbl": totals["variance"],
        "total_compare_variance_bbl": totals["compare_variance"],
    }


@router.get("/fso/material-balance", response_model=FSOMaterialBalanceReportResponse)
def get_fso_material_balance_report(
    location_code: str,
    fso_asset_code: str,
    date_from: str,
    date_to: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View FSO Tracking", db)
    ensure_location_in_user_scope(current_user, db, location_code, "Location")
    df = parse_date_filter(date_from, "date_from")
    dt = parse_date_filter(date_to, "date_to")
    rows = build_fso_material_balance(db, location_code, fso_asset_code, df, dt)
    return {"rows": rows}


@router.get("/fso/outturn", response_model=FSOOutturnReportResponse)
def fso_report_outturn(
    location_code: str,
    fso_asset_code: str,
    date_from: str,
    date_to: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View FSO Tracking", db)
    ensure_location_in_user_scope(current_user, db, location_code, "Location")
    df = parse_date_filter(date_from, "date_from")
    dt = parse_date_filter(date_to, "date_to")

    rows, totals, totals_pct = build_fso_outturn_report(db, location_code, fso_asset_code, df, dt)
    return {
        "rows": rows,
        "total_shuttle_discharge_bbl": totals["discharge"],
        "total_fso_receipt_bbl": totals["receipt"],
        "total_variance_bbl": totals["variance"],
        "total_variance_pct": totals_pct,
    }


@router.get("/fso/otr/export/xlsx")
def fso_report_otr_xlsx(
    location_code: str,
    fso_asset_code: str,
    date_from: str,
    date_to: str,
    shuttle_number: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View FSO Tracking", db)
    ensure_location_in_user_scope(current_user, db, location_code, "Location")
    df = parse_date_filter(date_from, "date_from")
    dt = parse_date_filter(date_to, "date_to")
    rows, totals = build_fso_otr_report(db, location_code, fso_asset_code, df, dt, shuttle_number)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "FSO OTR"

    headers = [
        "Ticket", "Acc Date", "Op Date", "Time", "Operation", "Sign",
        "Shuttle", "Vessel", "Vessel Qty",
        "Open Stock", "Open Water", "Close Stock", "Close Water",
        "Net Stock", "Net Water", "Move Qty",
        "Variance", "Shuttle Discharge", "Compare Var", "Remarks",
    ]
    append_sanitized_row(ws, headers)

    for r in rows:
        append_sanitized_row(ws, [
            r["ticket_number"],
            str(r["accounting_date"]),
            str(r["operation_date"]),
            r.get("event_time") or "",
            r["operation_label"],
            r["operation_sign"],
            r.get("shuttle_number") or "",
            r.get("vessel_name") or "",
            round(float(r["vessel_quantity_bbl"]), 3),
            round(float(r["opening_stock_bbl"]), 3),
            round(float(r["opening_water_bbl"]), 3),
            round(float(r["closing_stock_bbl"]), 3),
            round(float(r["closing_water_bbl"]), 3),
            round(float(r["net_stock_bbl"]), 3),
            round(float(r["net_water_bbl"]), 3),
            round(float(r["movement_qty_bbl"]), 3),
            round(float(r["variance_bbl"]), 3),
            round(float(r["source_shuttle_discharge_bbl"]), 3),
            round(float(r["compare_variance_bbl"]), 3),
            r.get("remarks") or "",
        ])

    ws2 = wb.create_sheet("Totals")
    append_sanitized_row(ws2, ["Total Receipt", totals["receipt"]])
    append_sanitized_row(ws2, ["Total Export", totals["export"]])
    append_sanitized_row(ws2, ["Total Movement", totals["movement"]])
    append_sanitized_row(ws2, ["Total Variance", totals["variance"]])
    append_sanitized_row(ws2, ["Total Compare Variance", totals["compare_variance"]])

    _xlsx_autofit(ws)
    _xlsx_autofit(ws2)

    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)

    filename = f"fso_otr_{location_code}_{fso_asset_code}_{date_from}_{date_to}.xlsx"
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/fso/outturn/export/xlsx")
def fso_report_outturn_xlsx(
    location_code: str,
    fso_asset_code: str,
    date_from: str,
    date_to: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View FSO Tracking", db)
    ensure_location_in_user_scope(current_user, db, location_code, "Location")
    df = parse_date_filter(date_from, "date_from")
    dt = parse_date_filter(date_to, "date_to")

    rows, totals, totals_pct = build_fso_outturn_report(db, location_code, fso_asset_code, df, dt)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "FSO Outturn"

    headers = ["Acc Date", "Shuttle Number", "Shuttle Discharge", "FSO Receipt", "Variance", "Variance %"]
    append_sanitized_row(ws, headers)

    for r in rows:
        append_sanitized_row(ws, [
            str(r["accounting_date"]),
            r["shuttle_number"],
            round(float(r["shuttle_discharge_bbl"]), 3),
            round(float(r["fso_receipt_bbl"]), 3),
            round(float(r["variance_bbl"]), 3),
            round(float(r["variance_pct"]), 3),
        ])

    ws2 = wb.create_sheet("Totals")
    append_sanitized_row(ws2, ["Total Shuttle Discharge", totals["discharge"]])
    append_sanitized_row(ws2, ["Total FSO Receipt", totals["receipt"]])
    append_sanitized_row(ws2, ["Total Variance", totals["variance"]])
    append_sanitized_row(ws2, ["Total Variance %", totals_pct])

    _xlsx_autofit(ws)
    _xlsx_autofit(ws2)

    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)

    filename = f"fso_outturn_{location_code}_{fso_asset_code}_{date_from}_{date_to}.xlsx"
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/fso/material-balance/export/xlsx")
def fso_report_mb_xlsx(
    location_code: str,
    fso_asset_code: str,
    date_from: str,
    date_to: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View FSO Tracking", db)
    ensure_location_in_user_scope(current_user, db, location_code, "Location")
    df = parse_date_filter(date_from, "date_from")
    dt = parse_date_filter(date_to, "date_to")
    rows = build_fso_material_balance(db, location_code, fso_asset_code, df, dt)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "FSO Material Balance"

    headers = [
        "Acc Date", "Opening", "Receipt", "Export",
        "Book Closing", "Physical Closing", "Closing Water", "Loss/Gain",
    ]
    append_sanitized_row(ws, headers)

    for r in rows:
        append_sanitized_row(ws, [
            str(r["accounting_date"]),
            round(float(r["opening_stock_bbl"]), 3),
            round(float(r["receipt_bbl"]), 3),
            round(float(r["export_bbl"]), 3),
            round(float(r["book_closing_bbl"]), 3),
            round(float(r["physical_closing_bbl"]), 3),
            round(float(r["physical_closing_water_bbl"]), 3),
            round(float(r["loss_gain_bbl"]), 3),
        ])

    _xlsx_autofit(ws)

    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)

    filename = f"fso_mb_{location_code}_{fso_asset_code}_{date_from}_{date_to}.xlsx"
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/tank-stock-ledger/rebuild")
def rebuild_tank_stock_ledger(
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Rebuild Tank Stock Ledger",
        db,
    )

    cleaned_location_code = clean_optional_text(location_code)
    cleaned_tank_asset_code = clean_optional_text(tank_asset_code)
    if cleaned_location_code:
        ensure_location_in_user_scope(
            current_user, db, cleaned_location_code, "Location"
        )

    sync_result = sync_and_rebuild_location_tank_stock_ledger(
        db=db,
        location_code=cleaned_location_code,
        tank_asset_code=cleaned_tank_asset_code,
        current_user=current_user,
    )

    create_audit_log(
        db=db,
        module_name="Tank Stock Ledger",
        action="Rebuild Tank Stock Ledger",
        current_user=current_user,
        entity_type="TankStockLedger",
        entity_id=None,
        entity_label="Tank Stock Ledger Rebuild",
        remarks="Synced payloads, accounting windows, and rebuilt chronological tank running balances",
        request_path="/tank-stock-ledger/rebuild",
        details={
            "location_code": cleaned_location_code,
            "tank_asset_code": cleaned_tank_asset_code,
            "product_name": None,
            "groups_rebuilt": sync_result["groups_rebuilt"],
            "rows_scanned": sync_result["rows_scanned"],
            "rows_created": sync_result["rows_created"],
        },
    )

    db.commit()

    return {
        "message": "Tank Stock Ledger rebuilt successfully",
        "groups_rebuilt": sync_result["groups_rebuilt"],
        "rows_scanned": sync_result["rows_scanned"],
        "rows_created": sync_result["rows_created"],
    }


def normalize_jsonb_value(value):
    if value is None:
        return None

    if isinstance(value, datetime):
        return value.isoformat()

    if hasattr(value, "isoformat"):
        return value.isoformat()

    if isinstance(value, list):
        return [
            normalize_jsonb_value(item)
            for item in value
        ]

    if isinstance(value, dict):
        return {
            str(key): normalize_jsonb_value(item_value)
            for key, item_value in value.items()
        }

    return value


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


def parse_payload_gauging_datetime(payload: dict):
    payload_dict = coerce_payload_dict(payload)
    payload_date, payload_time = get_payload_operation_parts(
        payload_dict, "tank_gauging_payload"
    )
    if payload_date is None:
        return None
    return datetime.combine(payload_date, payload_time or datetime_time(0, 0))


def resolve_transaction_datetime_for_accounting_day(
    transaction: OperationTransaction,
    payload: dict,
):
    payload_date, payload_time = get_payload_operation_parts(payload)

    if payload_date is not None:
        return datetime.combine(payload_date, payload_time or datetime_time(0, 0))

    if transaction is not None and transaction.operation_start_datetime is not None:
        return transaction.operation_start_datetime

    if transaction is not None and transaction.operation_date is not None:
        return datetime.combine(transaction.operation_date, datetime_time(0, 0))

    raise HTTPException(
        status_code=400,
        detail=(
            "Tank Gauging Date/Time is required to calculate the Location Accounting Day."
        ),
    )


def calculate_accounting_window_from_setting(
    setting: LocationAccountingDaySetting,
    transaction_datetime: datetime,
):
    window = calculate_window_from_setting_parts(
        setting=setting,
        operation_date=transaction_datetime.date(),
        operation_time=transaction_datetime.time(),
    )
    return {
        "accounting_date": window["accounting_date"],
        "accounting_day_start": window["accounting_day_start"],
        "accounting_day_end": window["accounting_day_end"],
    }


def get_location_accounting_day_for_transaction(
    db: Session,
    location_code: str,
    transaction_datetime: datetime,
):
    cleaned_location_code = clean_optional_text(location_code)

    if not cleaned_location_code:
        raise HTTPException(
            status_code=400,
            detail="Location is required to calculate accounting day",
        )

    window = resolve_location_accounting_window(
        db=db,
        location_code=cleaned_location_code,
        operation_date=transaction_datetime.date(),
        operation_time=transaction_datetime.time(),
    )

    if window is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "No Active Location Accounting Day Setting found for "
                f"{cleaned_location_code}. Configure it before approving "
                "Tank Gauging tickets."
            ),
        )

    return {
        "setting_id": window["setting_id"],
        "accounting_date": window["accounting_date"],
        "accounting_day_start": window["accounting_day_start"],
        "accounting_day_end": window["accounting_day_end"],
    }


def get_ledger_sort_datetime(ledger: TankStockLedger):
    # Chronological order is the payload operation moment (see
    # ``get_ledger_operation_datetime``); the accounting-day window start
    # is identical for every row of a day and must not order rows.
    return get_ledger_operation_datetime(ledger) or datetime.min


def get_previous_active_ledger_row(
    db: Session,
    location_code: str,
    tank_asset_code: str,
    product_name: str | None,
    transaction_datetime: datetime,
    exclude_ledger_id: int | None = None,
):
    query = db.query(TankStockLedger).filter(
        TankStockLedger.status == "Active",
        TankStockLedger.location_code.ilike(location_code),
        TankStockLedger.tank_asset_code.ilike(tank_asset_code),
    )

    if exclude_ledger_id is not None:
        query = query.filter(TankStockLedger.id != exclude_ledger_id)

    candidate_rows = query.all()

    previous_rows = []

    for row in candidate_rows:
        row_datetime = get_ledger_operation_datetime(row)

        if row_datetime is None:
            row_datetime = datetime.combine(row.operation_date, datetime_time(0, 0))

        if row_datetime < transaction_datetime:
            previous_rows.append((row_datetime, row.id, row))

    if not previous_rows:
        return None

    previous_rows.sort(key=lambda item: (item[0], item[1]))

    return previous_rows[-1][2]


def calculate_stock_movement_from_snapshot(
    operation_sign: str,
    current_gsv_bbl: float,
    current_nsv_bbl: float,
    current_lt: float,
    current_mt: float,
    previous_ledger: TankStockLedger | None,
):
    sign = str(operation_sign or "").upper()

    previous_gsv_bbl = 0
    previous_nsv_bbl = 0
    previous_lt = 0
    previous_mt = 0

    if previous_ledger is not None:
        previous_gsv_bbl = safe_float(
            previous_ledger.stock_gsv_bbl
            if previous_ledger.stock_gsv_bbl is not None
            else previous_ledger.running_balance_gsv_bbl
        )
        previous_nsv_bbl = safe_float(
            previous_ledger.stock_nsv_bbl
            if previous_ledger.stock_nsv_bbl is not None
            else previous_ledger.running_balance_nsv_bbl
        )
        previous_lt = safe_float(
            previous_ledger.stock_lt
            if previous_ledger.stock_lt is not None
            else previous_ledger.running_balance_lt
        )
        previous_mt = safe_float(
            previous_ledger.stock_mt
            if previous_ledger.stock_mt is not None
            else previous_ledger.running_balance_mt
        )

    if sign == "SET":
        movement_gsv_bbl = current_gsv_bbl
        movement_nsv_bbl = current_nsv_bbl
        movement_lt = current_lt
        movement_mt = current_mt

    elif sign == "IN":
        movement_gsv_bbl = max(current_gsv_bbl - previous_gsv_bbl, 0)
        movement_nsv_bbl = max(current_nsv_bbl - previous_nsv_bbl, 0)
        movement_lt = max(current_lt - previous_lt, 0)
        movement_mt = max(current_mt - previous_mt, 0)

    elif sign == "OUT":
        movement_gsv_bbl = max(previous_gsv_bbl - current_gsv_bbl, 0)
        movement_nsv_bbl = max(previous_nsv_bbl - current_nsv_bbl, 0)
        movement_lt = max(previous_lt - current_lt, 0)
        movement_mt = max(previous_mt - current_mt, 0)

    elif sign == "NEUTRAL":
        movement_gsv_bbl = 0
        movement_nsv_bbl = 0
        movement_lt = 0
        movement_mt = 0

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid Tank Operation Sign: {operation_sign}",
        )

    return {
        "previous_gsv_bbl": previous_gsv_bbl,
        "previous_nsv_bbl": previous_nsv_bbl,
        "previous_lt": previous_lt,
        "previous_mt": previous_mt,
        "movement_gsv_bbl": movement_gsv_bbl,
        "movement_nsv_bbl": movement_nsv_bbl,
        "movement_lt": movement_lt,
        "movement_mt": movement_mt,
    }


def is_tank_gauging_transaction(
    db: Session,
    transaction: OperationTransaction,
):
    if transaction.operation_template_id is None:
        return False

    template = (
        db.query(OperationTemplate)
        .filter(OperationTemplate.id == transaction.operation_template_id)
        .first()
    )

    if not template:
        return False

    entry_layout_type = normalize_entry_layout_type(template.entry_layout_type)
    calculation_engine = str(template.calculation_engine or "").strip().lower()

    if entry_layout_type == "tank gauging":
        return True

    if calculation_engine == "tank quantity":
        return True

    payload = get_tank_gauging_payload_for_transaction(
        db=db,
        transaction_id=transaction.id,
    )

    return payload is not None


def rebuild_tank_stock_running_balances(
    db: Session,
    location_code: str,
    tank_asset_code: str,
    product_name: str | None,
):
    query = db.query(TankStockLedger).filter(
        TankStockLedger.location_code.ilike(location_code),
        TankStockLedger.tank_asset_code.ilike(tank_asset_code),
        TankStockLedger.status == "Active",
    )

    ledger_rows = query.all()
    if not ledger_rows:
        return

    tx_ids = [row.transaction_id for row in ledger_rows if row.transaction_id]
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

    tank_ops_by_code = {}
    for op in db.query(TankOperation).all():
        c = str(op.operation_code or "").strip().lower()
        loc = str(op.location_code or "").strip().lower()
        tank_ops_by_code[(loc, c)] = op
        tank_ops_by_code.setdefault(c, op)

    setting_cache = {}
    sortable_rows = []

    for row in ledger_rows:
        live_payload = live_payload_by_tx_id.get(row.transaction_id)
        if live_payload:
            row.source_payload = normalize_jsonb_value(live_payload)
            payload = live_payload
        else:
            payload = coerce_payload_dict(row.source_payload)

        if payload:
            inputs = payload.get("inputs") or {}
            op_code = clean_optional_text(inputs.get("tankOperationCode"))
            loc_key = str(row.location_code or "").strip().lower()
            master_op = None
            if op_code:
                master_op = tank_ops_by_code.get(
                    (loc_key, op_code.lower())
                ) or tank_ops_by_code.get(op_code.lower())
            if master_op is not None:
                row.tank_operation_code = master_op.operation_code
                row.tank_operation_label = master_op.operation_label
                row.tank_operation_category = master_op.operation_category
                row.tank_operation_sign = master_op.operation_sign

            gauging_date, gauging_time = get_payload_operation_parts(payload)
            if gauging_date is not None:
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

        row_datetime = get_ledger_operation_datetime(row)
        if row_datetime is None:
            row_datetime = datetime.combine(row.operation_date, datetime_time(0, 0))

        sortable_rows.append((row_datetime, row.id, row))

    sortable_rows.sort(key=lambda item: (item[0], item[1]))

    previous_row = None

    for _row_datetime, _row_id, row in sortable_rows:
        current_gsv_bbl = safe_float(row.stock_gsv_bbl)
        current_nsv_bbl = safe_float(row.stock_nsv_bbl)
        current_lt = safe_float(row.stock_lt)
        current_mt = safe_float(row.stock_mt)

        if current_gsv_bbl == 0 and current_nsv_bbl == 0:
            current_gsv_bbl = safe_float(row.running_balance_gsv_bbl)
            current_nsv_bbl = safe_float(row.running_balance_nsv_bbl)
            current_lt = safe_float(row.running_balance_lt)
            current_mt = safe_float(row.running_balance_mt)

            row.stock_gsv_bbl = current_gsv_bbl
            row.stock_nsv_bbl = current_nsv_bbl
            row.stock_lt = current_lt
            row.stock_mt = current_mt

        movement = calculate_stock_movement_from_snapshot(
            operation_sign=row.tank_operation_sign,
            current_gsv_bbl=current_gsv_bbl,
            current_nsv_bbl=current_nsv_bbl,
            current_lt=current_lt,
            current_mt=current_mt,
            previous_ledger=previous_row,
        )

        row.previous_stock_gsv_bbl = movement["previous_gsv_bbl"]
        row.previous_stock_nsv_bbl = movement["previous_nsv_bbl"]
        row.previous_stock_lt = movement["previous_lt"]
        row.previous_stock_mt = movement["previous_mt"]

        row.movement_gsv_bbl = movement["movement_gsv_bbl"]
        row.movement_nsv_bbl = movement["movement_nsv_bbl"]
        row.movement_lt = movement["movement_lt"]
        row.movement_mt = movement["movement_mt"]

        row.running_balance_gsv_bbl = current_gsv_bbl
        row.running_balance_nsv_bbl = current_nsv_bbl
        row.running_balance_lt = current_lt
        row.running_balance_mt = current_mt

        row.updated_at = datetime.now()

        previous_row = row

    db.flush()


def sync_and_rebuild_location_tank_stock_ledger(
    db: Session,
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    current_user: User | None = None,
):
    from app.services.transaction_helpers import approved_transaction_not_on_correction_hold

    cleaned_location_code = clean_optional_text(location_code)
    cleaned_tank_asset_code = clean_optional_text(tank_asset_code)

    tx_query = (
        db.query(OperationTransaction)
        .join(OperationTemplate, OperationTransaction.operation_template_id == OperationTemplate.id)
        .filter(
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
            func.lower(func.trim(OperationTemplate.entry_layout_type)) == "tank gauging",
        )
    )
    if current_user is not None:
        tx_query = apply_transaction_party_scope_filter(
            tx_query, OperationTransaction, current_user, db
        )
    if cleaned_location_code:
        tx_query = tx_query.filter(
            OperationTransaction.origin_location_code.ilike(cleaned_location_code)
        )
    if cleaned_tank_asset_code:
        tx_query = tx_query.filter(
            OperationTransaction.primary_asset_code.ilike(cleaned_tank_asset_code)
        )

    approved_txs = tx_query.order_by(OperationTransaction.id.asc()).all()
    existing_tx_ids = {
        row[0]
        for row in db.query(TankStockLedger.transaction_id)
        .filter(TankStockLedger.status.in_(["Active", "Correction Hold"]))
        .all()
    }

    rows_created = 0
    for tx in approved_txs:
        if tx.id in existing_tx_ids:
            continue
        try:
            created = create_tank_stock_ledger_from_approved_transaction(
                db=db,
                transaction=tx,
                current_user=current_user,
                rebuild_after_insert=False,
            )
            if created is not None:
                rows_created += 1
                existing_tx_ids.add(tx.id)
        except HTTPException:
            continue

    ledger_query = db.query(TankStockLedger).filter(TankStockLedger.status == "Active")
    if current_user is not None:
        ledger_query = apply_location_filter(
            ledger_query, TankStockLedger, current_user, db
        )
    if cleaned_location_code:
        ledger_query = ledger_query.filter(
            TankStockLedger.location_code.ilike(cleaned_location_code)
        )
    if cleaned_tank_asset_code:
        ledger_query = ledger_query.filter(
            TankStockLedger.tank_asset_code.ilike(cleaned_tank_asset_code)
        )

    rows = ledger_query.all()
    group_keys = {(row.location_code, row.tank_asset_code) for row in rows}

    for loc, tank in sorted(group_keys):
        rebuild_tank_stock_running_balances(
            db=db,
            location_code=loc,
            tank_asset_code=tank,
            product_name=None,
        )

    return {
        "groups_rebuilt": len(group_keys),
        "rows_scanned": len(rows),
        "rows_created": rows_created,
    }


def create_tank_stock_ledger_from_approved_transaction(
    db: Session,
    transaction: OperationTransaction,
    current_user: User | None = None,
    rebuild_after_insert: bool = True,
):
    if transaction.status != "Approved":
        return None

    if not is_tank_gauging_transaction(db, transaction):
        return None

    existing_ledger = (
        db.query(TankStockLedger)
        .filter(
            TankStockLedger.transaction_id == transaction.id,
            TankStockLedger.status.in_(["Active", "Correction Hold"]),
        )
        .first()
    )

    if existing_ledger:
        return existing_ledger

    payload = get_tank_gauging_payload_for_transaction(
        db=db,
        transaction_id=transaction.id,
    )

    if payload is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Tank Gauging payload is missing. Open Operation Entry, "
                "save the tank gauging ticket, then approve again."
            ),
        )

    inputs = payload.get("inputs") or {}
    calculated = payload.get("calculated") or {}
    payload_asset = payload.get("asset") or {}

    transaction_datetime = resolve_transaction_datetime_for_accounting_day(
        transaction=transaction,
        payload=payload,
    )

    accounting_day = get_location_accounting_day_for_transaction(
        db=db,
        location_code=transaction.origin_location_code,
        transaction_datetime=transaction_datetime,
    )

    tank_ops_all = db.query(TankOperation).all()
    tank_ops_by_code = {}
    for op in tank_ops_all:
        c = str(op.operation_code or "").strip().lower()
        loc = str(op.location_code or "").strip().lower()
        tank_ops_by_code[(loc, c)] = op
        tank_ops_by_code.setdefault(c, op)
    tank_ops_by_id = {op.id: op for op in tank_ops_all}

    (
        tank_operation_code,
        tank_operation_label,
        tank_operation_category,
        tank_operation_sign,
    ) = _resolve_tank_op_meta(
        transaction,
        inputs,
        tank_ops_by_code=tank_ops_by_code,
        tank_ops_by_id=tank_ops_by_id,
    )

    if not tank_operation_code:
        raise HTTPException(
            status_code=400,
            detail=(
                "Tank Operation is missing in Tank Gauging payload. "
                "Open the ticket, select Tank Operation, save, then approve."
            ),
        )

    if not tank_operation_label:
        raise HTTPException(
            status_code=400,
            detail="Tank Operation Label is missing in Tank Gauging payload.",
        )

    if not tank_operation_category:
        raise HTTPException(
            status_code=400,
            detail="Tank Operation Category is missing in Tank Gauging payload.",
        )

    if not tank_operation_sign:
        raise HTTPException(
            status_code=400,
            detail="Tank Operation Sign is missing in Tank Gauging payload.",
        )

    current_stock_gsv_bbl = safe_float(
        calculated.get("gsvBbl")
        if calculated.get("gsvBbl") not in (None, "")
        else calculated.get("gsv")
    )
    current_stock_nsv_bbl = safe_float(
        calculated.get("nsvBbl")
        if calculated.get("nsvBbl") not in (None, "")
        else calculated.get("nsv")
    )
    current_stock_lt = safe_float(calculated.get("lt"))
    current_stock_mt = safe_float(calculated.get("mt"))

    if current_stock_nsv_bbl == 0 and current_stock_gsv_bbl == 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "Calculated tank quantity is missing or zero. "
                "Open the ticket, verify Tank Gauging calculations, save, then approve."
            ),
        )

    tank_asset = get_asset_by_code(transaction.primary_asset_code, db)

    if tank_asset:
        tank_asset_name = tank_asset.asset_name
    else:
        tank_asset_name = clean_optional_text(
            payload_asset.get("asset_name")
        ) or ""

    created_by_display = (
        get_current_user_display_name(current_user)
        if current_user is not None
        else (transaction.created_by or "System")
    )

    new_ledger = TankStockLedger(
        transaction_id=transaction.id,
        ticket_number=get_transaction_ticket_number(transaction),
        operation_number=transaction.operation_number,
        location_code=transaction.origin_location_code,
        tank_asset_code=transaction.primary_asset_code,
        tank_asset_name=tank_asset_name,
        operation_date=(
            resolve_transaction_operation_date(transaction, payload=payload)
            or transaction.operation_date
        ),
        product_name=clean_optional_text(transaction.product_name),
        accounting_date=accounting_day["accounting_date"],
        accounting_day_start=accounting_day["accounting_day_start"],
        accounting_day_end=accounting_day["accounting_day_end"],
        accounting_day_setting_id=accounting_day["setting_id"],
        tank_operation_code=tank_operation_code,
        tank_operation_label=tank_operation_label,
        tank_operation_category=tank_operation_category,
        tank_operation_sign=tank_operation_sign,
        movement_gsv_bbl=0,
        movement_nsv_bbl=0,
        movement_lt=0,
        movement_mt=0,
        stock_gsv_bbl=current_stock_gsv_bbl,
        stock_nsv_bbl=current_stock_nsv_bbl,
        stock_lt=current_stock_lt,
        stock_mt=current_stock_mt,
        previous_stock_gsv_bbl=0,
        previous_stock_nsv_bbl=0,
        previous_stock_lt=0,
        previous_stock_mt=0,
        running_balance_gsv_bbl=current_stock_gsv_bbl,
        running_balance_nsv_bbl=current_stock_nsv_bbl,
        running_balance_lt=current_stock_lt,
        running_balance_mt=current_stock_mt,
        source_payload=normalize_jsonb_value(payload),
        status="Active",
        created_by=created_by_display,
        remarks="Auto-created when Tank Gauging ticket was approved",
    )

    db.add(new_ledger)
    db.flush()

    if rebuild_after_insert:
        rebuild_tank_stock_running_balances(
            db=db,
            location_code=new_ledger.location_code,
            tank_asset_code=new_ledger.tank_asset_code,
            product_name=new_ledger.product_name,
        )
        db.flush()

    create_audit_log(
        db=db,
        module_name="Tank Stock Ledger",
        action="Create Tank Stock Ledger Entry",
        current_user=current_user,
        entity_type="TankStockLedger",
        entity_id=new_ledger.id,
        entity_label=(
            f"{new_ledger.ticket_number} | "
            f"{new_ledger.tank_asset_code} | "
            f"{new_ledger.tank_operation_label}"
        ),
        ticket_number=new_ledger.ticket_number,
        operation_number=new_ledger.operation_number,
        remarks="Auto-created on Tank Gauging approval",
        request_path="/operation-transactions/{id}/status",
        details={
            "transaction_id": transaction.id,
            "location_code": new_ledger.location_code,
            "tank_asset_code": new_ledger.tank_asset_code,
            "operation_date": str(new_ledger.operation_date),
            "transaction_datetime": transaction_datetime.isoformat(),
            "accounting_date": str(new_ledger.accounting_date),
            "accounting_day_start": (
                new_ledger.accounting_day_start.isoformat()
                if new_ledger.accounting_day_start
                else None
            ),
            "accounting_day_end": (
                new_ledger.accounting_day_end.isoformat()
                if new_ledger.accounting_day_end
                else None
            ),
            "accounting_day_setting_id": new_ledger.accounting_day_setting_id,
            "product_name": new_ledger.product_name,
            "tank_operation_code": new_ledger.tank_operation_code,
            "tank_operation_label": new_ledger.tank_operation_label,
            "tank_operation_category": new_ledger.tank_operation_category,
            "tank_operation_sign": new_ledger.tank_operation_sign,
            "stock_gsv_bbl": new_ledger.stock_gsv_bbl,
            "stock_nsv_bbl": new_ledger.stock_nsv_bbl,
            "stock_lt": new_ledger.stock_lt,
            "stock_mt": new_ledger.stock_mt,
            "previous_stock_gsv_bbl": new_ledger.previous_stock_gsv_bbl,
            "previous_stock_nsv_bbl": new_ledger.previous_stock_nsv_bbl,
            "previous_stock_lt": new_ledger.previous_stock_lt,
            "previous_stock_mt": new_ledger.previous_stock_mt,
            "movement_gsv_bbl": new_ledger.movement_gsv_bbl,
            "movement_nsv_bbl": new_ledger.movement_nsv_bbl,
            "movement_lt": new_ledger.movement_lt,
            "movement_mt": new_ledger.movement_mt,
            "running_balance_gsv_bbl": new_ledger.running_balance_gsv_bbl,
            "running_balance_nsv_bbl": new_ledger.running_balance_nsv_bbl,
            "running_balance_lt": new_ledger.running_balance_lt,
            "running_balance_mt": new_ledger.running_balance_mt,
        },
    )

    return new_ledger
from app.utils.spreadsheet import append_sanitized_row
