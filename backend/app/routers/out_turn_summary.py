from datetime import datetime, date
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    Asset,
    Location,
    OperationTransaction,
    OperationTemplate,
    OutTurnSummaryConfig,
    TankOperation,
    User,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    apply_transaction_party_scope_filter,
    require_user_permission,
)
from app.routers.tank_operation_summary import (
    extract_tank_gauging_columns,
    get_tank_gauging_payload_map,
)
from app.utils.pagination import (
    DEFAULT_REPORT_PAGE_SIZE,
    MAX_REPORT_PAGE_SIZE,
    clamp_limit,
    clamp_page,
    default_window_start,
)
from app.schemas import OutTurnSummaryConfigUpdate
from app.services.audit_service import create_audit_log
from app.services.operation_datetime import (
    format_time_hhmm,
    resolve_transaction_accounting,
)
from app.services.transaction_helpers import (
    parse_date_filter,
    approved_transaction_not_on_correction_hold,
)
from app.utils.helpers import (
    clean_optional_text,
    get_asset_by_code,
    get_location_by_code,
    get_transaction_ticket_number,
)
from app.config import APPROVED_TRANSACTION_STATUS

router = APIRouter(prefix="/out-turn-summary", tags=["Out-Turn Summary"])

CONFIG_ROW_ID = 1

BASE_COLUMNS = [
    {
        "key": "transaction_id",
        "label": "Transaction ID",
        "group": "Base",
        "enabled": True,
        "order": 0,
    },
    {
        "key": "ticket_number",
        "label": "Ticket Number",
        "group": "Base",
        "enabled": True,
        "order": 1,
    },
    {
        "key": "operation_number",
        "label": "Operation Number",
        "group": "Base",
        "enabled": True,
        "order": 2,
    },
    {
        "key": "accounting_date",
        "label": "Accounting Date",
        "group": "Base",
        "enabled": True,
        "order": 3,
    },
    {
        "key": "input_gaugingDate",
        "label": "Gauging Date",
        "group": "Input",
        "enabled": True,
        "order": 4,
    },
    {
        "key": "input_gaugingTime",
        "label": "Gauging Time",
        "group": "Input",
        "enabled": True,
        "order": 5,
    },
    {
        "key": "operation_date",
        "label": "Operation Date",
        "group": "Base",
        "enabled": True,
        "order": 6,
    },
    {
        "key": "location_code",
        "label": "Location Code",
        "group": "Base",
        "enabled": True,
        "order": 7,
    },
    {
        "key": "location_name",
        "label": "Location Name",
        "group": "Base",
        "enabled": True,
        "order": 8,
    },
    {
        "key": "tank_asset_code",
        "label": "Tank Asset Code",
        "group": "Base",
        "enabled": True,
        "order": 9,
    },
    {
        "key": "tank_asset_name",
        "label": "Tank Asset Name",
        "group": "Base",
        "enabled": True,
        "order": 10,
    },
    {
        "key": "product_name",
        "label": "Product Name",
        "group": "Base",
        "enabled": True,
        "order": 11,
    },
    {
        "key": "status",
        "label": "Status",
        "group": "Base",
        "enabled": True,
        "order": 12,
    },
    {
        "key": "created_by",
        "label": "Created By",
        "group": "Base",
        "enabled": True,
        "order": 13,
    },
    {
        "key": "created_at",
        "label": "Created At",
        "group": "Base",
        "enabled": True,
        "order": 14,
    },
]

COMPUTED_COLUMNS = [
    {
        "key": "sequence",
        "label": "Sequence",
        "group": "Computed",
        "enabled": True,
        "order": 100,
    },
    {
        "key": "previous_nsv",
        "label": "Previous NSV",
        "group": "Computed",
        "enabled": True,
        "order": 101,
    },
    {
        "key": "previous_gsv",
        "label": "Previous GSV",
        "group": "Computed",
        "enabled": True,
        "order": 102,
    },
    {
        "key": "previous_lt",
        "label": "Previous LT",
        "group": "Computed",
        "enabled": True,
        "order": 103,
    },
    {
        "key": "previous_mt",
        "label": "Previous MT",
        "group": "Computed",
        "enabled": True,
        "order": 104,
    },
    {
        "key": "signed_net_nsv",
        "label": "Signed Net NSV",
        "group": "Computed",
        "enabled": True,
        "order": 105,
    },
    {
        "key": "signed_net_gsv",
        "label": "Signed Net GSV",
        "group": "Computed",
        "enabled": True,
        "order": 106,
    },
    {
        "key": "signed_net_lt",
        "label": "Signed Net LT",
        "group": "Computed",
        "enabled": True,
        "order": 107,
    },
    {
        "key": "signed_net_mt",
        "label": "Signed Net MT",
        "group": "Computed",
        "enabled": True,
        "order": 108,
    },
    {
        "key": "net_receipt_nsv",
        "label": "Net Receipt NSV",
        "group": "Computed",
        "enabled": True,
        "order": 109,
    },
    {
        "key": "net_receipt_gsv",
        "label": "Net Receipt GSV",
        "group": "Computed",
        "enabled": True,
        "order": 110,
    },
    {
        "key": "net_receipt_lt",
        "label": "Net Receipt LT",
        "group": "Computed",
        "enabled": True,
        "order": 111,
    },
    {
        "key": "net_receipt_mt",
        "label": "Net Receipt MT",
        "group": "Computed",
        "enabled": True,
        "order": 112,
    },
    {
        "key": "net_dispatch_nsv",
        "label": "Net Dispatch NSV",
        "group": "Computed",
        "enabled": True,
        "order": 113,
    },
    {
        "key": "net_dispatch_gsv",
        "label": "Net Dispatch GSV",
        "group": "Computed",
        "enabled": True,
        "order": 114,
    },
    {
        "key": "net_dispatch_lt",
        "label": "Net Dispatch LT",
        "group": "Computed",
        "enabled": True,
        "order": 115,
    },
    {
        "key": "net_dispatch_mt",
        "label": "Net Dispatch MT",
        "group": "Computed",
        "enabled": True,
        "order": 116,
    },
]

COLUMN_GROUPS = ["Base", "Input", "Calculated", "Computed"]


def safe_float(value):
    try:
        if value is None or value == "":
            return 0.0
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _get_transaction_query(
    db: Session,
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: User | None = None,
):
    """Query approved, non-hold Tank Gauging transactions.

    NOTE: Date filtering is intentionally NEVER applied against
    ``OperationTransaction.operation_date`` in SQL because gauging dates and
    times live inside the payload and shift across calendar boundaries under
    each location's Accounting Day Setting. Validate ``date_from``/``date_to``
    format here so invalid input still raises HTTP 400 consistently.
    """
    parse_date_filter(date_from, "Date From")
    parse_date_filter(date_to, "Date To")

    query = (
        db.query(OperationTransaction)
        .join(OperationTemplate, OperationTransaction.operation_template_id == OperationTemplate.id)
        .filter(
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
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

    return query


def _extract_payload_columns(payload: dict) -> dict:
    return extract_tank_gauging_columns(payload)


def _extract_stock_volumes(extracted: dict) -> dict:
    return {
        "nsv": safe_float(
            extracted.get("calc_nsvBbl")
            if extracted.get("calc_nsvBbl") not in (None, "")
            else extracted.get("calc_nsv")
        ),
        "gsv": safe_float(
            extracted.get("calc_gsvBbl")
            if extracted.get("calc_gsvBbl") not in (None, "")
            else extracted.get("calc_gsv")
        ),
        "lt": safe_float(extracted.get("calc_lt")),
        "mt": safe_float(extracted.get("calc_mt")),
    }


def _resolve_tank_operation_sign(
    transaction: OperationTransaction,
    extracted: dict,
    tank_ops_by_code: dict,
    tank_ops_by_id: dict,
) -> str:
    tank_op = None
    loc_key = str(transaction.origin_location_code or "").strip().lower()
    op_code = str(extracted.get("input_tankOperationCode") or "").strip().lower()
    if op_code:
        tank_op = tank_ops_by_code.get((loc_key, op_code)) or tank_ops_by_code.get(
            op_code
        )

    op_id_raw = extracted.get("input_tankOperationId")
    if tank_op is None and op_id_raw not in (None, ""):
        try:
            tank_op = tank_ops_by_id.get(int(op_id_raw))
        except (TypeError, ValueError):
            tank_op = None

    if tank_op is None and getattr(transaction, "tank_operation_id", None):
        tank_op = tank_ops_by_id.get(transaction.tank_operation_id)

    if tank_op is not None and tank_op.operation_sign:
        return str(tank_op.operation_sign).strip().upper()

    payload_sign = str(extracted.get("input_tankOperationSign") or "").strip().upper()
    return payload_sign


def _compute_signed_movements(signed_net: dict, sign: str) -> tuple[dict, dict]:
    """Compute sign-aware ``(net_receipt, net_dispatch)`` dictionaries.

    Matches ``TankStockLedger``, ``DailySummary``, ``OutTurnReport``, and
    ``MaterialBalance``:
      - ``SET`` (Opening stock) / ``NEUTRAL`` (Closing / static before-dip):
        reference tank snapshot only -> 0 receipt, 0 dispatch.
      - ``IN``: ``net_receipt = max(signed_net, 0)``, ``net_dispatch = 0``.
      - ``OUT``: ``net_dispatch = max(-signed_net, 0)``, ``net_receipt = 0``.
      - Blank sign (legacy/minimal payload with no tank operation metadata):
        positive deltas count as receipt, negative deltas as dispatch.
    """
    zero = {"nsv": 0.0, "gsv": 0.0, "lt": 0.0, "mt": 0.0}
    if sign in ("SET", "NEUTRAL"):
        return dict(zero), dict(zero)
    if sign == "IN":
        return {k: max(v, 0.0) for k, v in signed_net.items()}, dict(zero)
    if sign == "OUT":
        return dict(zero), {k: max(-v, 0.0) for k, v in signed_net.items()}
    return (
        {k: max(v, 0.0) for k, v in signed_net.items()},
        {k: max(-v, 0.0) for k, v in signed_net.items()},
    )


def _build_all_column_definitions(
    db: Session,
    location_code: str | None = None,
    current_user: User | None = None,
):
    definitions = [dict(col) for col in BASE_COLUMNS]
    existing_keys = {col["key"] for col in definitions}

    query = _get_transaction_query(
        db,
        location_code=location_code,
        current_user=current_user,
    )
    transactions = query.limit(100).all()

    payload_map = get_tank_gauging_payload_map(db, [tx.id for tx in transactions])

    input_keys = set()
    calc_keys = set()

    for tx in transactions:
        payload = payload_map.get(tx.id)
        if not payload:
            continue

        columns = _extract_payload_columns(payload)

        for key in columns.keys():
            if key in existing_keys:
                continue
            if key.startswith("input_"):
                input_keys.add(key)
            elif key.startswith("calc_"):
                calc_keys.add(key)

    for key in sorted(input_keys):
        definitions.append(
            {
                "key": key,
                "label": key.replace("input_", "", 1).replace("_", " ").title(),
                "group": "Input",
                "enabled": True,
                "order": len(definitions) + 1,
            }
        )

    for key in sorted(calc_keys):
        definitions.append(
            {
                "key": key,
                "label": key.replace("calc_", "", 1).replace("_", " ").title(),
                "group": "Calculated",
                "enabled": True,
                "order": len(definitions) + 1,
            }
        )

    for col in COMPUTED_COLUMNS:
        definitions.append(dict(col))

    return definitions


def _get_saved_config(db: Session):
    return db.query(OutTurnSummaryConfig).filter(OutTurnSummaryConfig.id == CONFIG_ROW_ID).first()


def _get_or_create_config(db: Session):
    config = _get_saved_config(db)

    if config is None:
        config = OutTurnSummaryConfig(
            id=CONFIG_ROW_ID,
            columns_json=[],
        )
        db.add(config)
        db.commit()
        db.refresh(config)

    return config


def _load_configured_columns(db: Session, available_definitions: list[dict]):
    """Merge saved column configuration with currently available columns."""
    config = _get_saved_config(db)

    if config is None or not config.columns_json:
        return available_definitions

    available_map = {item["key"]: item for item in available_definitions}
    configured = []

    for item in config.columns_json:
        if not isinstance(item, dict) or "key" not in item:
            continue

        key = item.get("key")
        source = available_map.get(key) or {}

        configured.append(
            {
                "key": key,
                "label": item.get("label") or source.get("label") or key,
                "group": item.get("group") or source.get("group") or "Base",
                "enabled": bool(item.get("enabled", True)),
                "order": int(
                    item.get("order")
                    if item.get("order") is not None
                    else len(configured)
                ),
            }
        )

    known_keys = {item["key"] for item in configured}
    next_order = max([item["order"] for item in configured] or [0]) + 1

    for item in available_definitions:
        if item["key"] in known_keys:
            continue

        configured.append(
            {
                "key": item["key"],
                "label": item["label"],
                "group": item["group"],
                "enabled": False,
                "order": next_order,
            }
        )
        next_order += 1

    configured.sort(key=lambda item: item["order"])

    return configured


def _standard_available_definitions(db: Session, current_user: User | None):
    return _build_all_column_definitions(db, None, current_user=current_user)


_UNSET = object()


def _build_row(
    db: Session,
    transaction: OperationTransaction,
    payload: dict,
    sequence: int,
    previous: dict,
    location=_UNSET,
    asset=_UNSET,
    resolved=_UNSET,
    tank_ops_by_code=None,
    tank_ops_by_id=None,
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

    extracted = _extract_payload_columns(payload)
    current = _extract_stock_volumes(extracted)

    previous_nsv = safe_float(previous.get("nsv"))
    previous_gsv = safe_float(previous.get("gsv"))
    previous_lt = safe_float(previous.get("lt"))
    previous_mt = safe_float(previous.get("mt"))

    signed_net = {
        "nsv": current["nsv"] - previous_nsv,
        "gsv": current["gsv"] - previous_gsv,
        "lt": current["lt"] - previous_lt,
        "mt": current["mt"] - previous_mt,
    }

    if tank_ops_by_code is None or tank_ops_by_id is None:
        all_tank_ops = db.query(TankOperation).all()
        tank_ops_by_code = {}
        for op in all_tank_ops:
            c = str(op.operation_code or "").strip().lower()
            loc = str(op.location_code or "").strip().lower()
            tank_ops_by_code[(loc, c)] = op
            tank_ops_by_code.setdefault(c, op)
        tank_ops_by_id = {op.id: op for op in all_tank_ops}

    sign = _resolve_tank_operation_sign(
        transaction, extracted, tank_ops_by_code, tank_ops_by_id
    )
    net_receipt, net_dispatch = _compute_signed_movements(signed_net, sign)

    effective_gauging_date = operation_date or transaction.operation_date
    effective_accounting_date = (
        accounting_date or effective_gauging_date or transaction.operation_date
    )

    row = {
        "transaction_id": transaction.id,
        "ticket_number": get_transaction_ticket_number(transaction),
        "operation_number": transaction.operation_number,
        "accounting_date": effective_accounting_date,
        "gauging_date": effective_gauging_date,
        "gauging_time": format_time_hhmm(operation_time) if operation_time else "",
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

    for key, value in extracted.items():
        row[key] = value

    if "input_gaugingDate" not in row or not row["input_gaugingDate"]:
        row["input_gaugingDate"] = (
            effective_gauging_date.isoformat() if effective_gauging_date else ""
        )
    if "input_gaugingTime" not in row or row["input_gaugingTime"] is None:
        row["input_gaugingTime"] = (
            format_time_hhmm(operation_time) if operation_time else ""
        )

    row.update(
        {
            "sequence": sequence,
            "previous_nsv": previous_nsv,
            "previous_gsv": previous_gsv,
            "previous_lt": previous_lt,
            "previous_mt": previous_mt,
            "signed_net_nsv": signed_net["nsv"],
            "signed_net_gsv": signed_net["gsv"],
            "signed_net_lt": signed_net["lt"],
            "signed_net_mt": signed_net["mt"],
            "net_receipt_nsv": net_receipt["nsv"],
            "net_receipt_gsv": net_receipt["gsv"],
            "net_receipt_lt": net_receipt["lt"],
            "net_receipt_mt": net_receipt["mt"],
            "net_dispatch_nsv": net_dispatch["nsv"],
            "net_dispatch_gsv": net_dispatch["gsv"],
            "net_dispatch_lt": net_dispatch["lt"],
            "net_dispatch_mt": net_dispatch["mt"],
        }
    )

    return row


def resolve_out_turn_date_window(
    db: Session,
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: User | None = None,
):
    """Resolve effective ``date_from`` strictly from payload accounting dates."""
    explicit = parse_date_filter(date_from, "Date From")
    explicit_to = parse_date_filter(date_to, "Date To")

    if explicit is not None:
        return explicit.isoformat(), False

    transactions = _get_transaction_query(
        db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        current_user=current_user,
    ).all()

    if not transactions:
        return None, False

    payload_map = get_tank_gauging_payload_map(db, [tx.id for tx in transactions])
    setting_cache = {}
    candidate_dates = []
    for tx in transactions:
        payload = payload_map.get(tx.id)
        if not payload:
            continue
        op_date, _op_time, _op_dt, acc_date = resolve_transaction_accounting(
            db,
            tx,
            payload=payload,
            field_code="tank_gauging_payload",
            setting_cache=setting_cache,
        )
        eff_acc = acc_date or op_date or tx.operation_date
        if eff_acc is None:
            continue
        if explicit_to is not None and eff_acc > explicit_to:
            continue
        candidate_dates.append(eff_acc)

    latest_date = max(candidate_dates) if candidate_dates else None
    window_start = default_window_start(latest_date)

    if window_start is None:
        return None, False

    return window_start.isoformat(), True


def _build_out_turn_summary_result(
    db: Session,
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: User | None = None,
):
    """Build full chronological chains per tank from payload gauging date/time,
    then slice rows strictly by resolved ``accounting_date``.
    """
    explicit_date_from = parse_date_filter(date_from, "Date From")
    explicit_date_to = parse_date_filter(date_to, "Date To")

    # Load all approved non-hold Tank Gauging tickets for the requested
    # location / tank (product is filtered on output rows so an intermediate
    # product rename never drops a tank snapshot from the chain).
    all_transactions = (
        _get_transaction_query(
            db,
            location_code=location_code,
            tank_asset_code=tank_asset_code,
            current_user=current_user,
        )
        .order_by(OperationTransaction.id.asc())
        .all()
    )

    if not all_transactions:
        effective_from_iso = (
            explicit_date_from.isoformat() if explicit_date_from is not None else None
        )
        return [], effective_from_iso, False

    payload_map = get_tank_gauging_payload_map(db, [tx.id for tx in all_transactions])

    setting_cache = {}
    resolved_by_tx = {}
    candidate_acc_dates = []
    for tx in all_transactions:
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
        resolved_by_tx[tx.id] = resolved
        eff_acc = resolved[3] or resolved[0] or tx.operation_date
        if eff_acc is not None and (explicit_date_to is None or eff_acc <= explicit_date_to):
            candidate_acc_dates.append(eff_acc)

    default_window_applied = False
    window_from = explicit_date_from
    if window_from is None and candidate_acc_dates:
        window_start = default_window_start(max(candidate_acc_dates))
        if window_start is not None:
            window_from = window_start
            default_window_applied = True

    def _tx_sort_key(tx):
        _op_date, _op_time, operation_datetime, _acc_date = resolved_by_tx[tx.id]
        return (operation_datetime or datetime.min, tx.id)

    grouped: dict[tuple[str, str], list] = {}
    for tx in all_transactions:
        if tx.id not in resolved_by_tx:
            continue
        key = (
            tx.origin_location_code or "",
            tx.primary_asset_code or "",
        )
        grouped.setdefault(key, []).append(tx)

    def _key(code):
        return str(code or "").strip().lower()

    locations_by_code = {
        _key(row.location_code): row for row in db.query(Location).all()
    }
    assets_by_code = {
        _key(row.asset_code): row for row in db.query(Asset).all()
    }
    all_tank_ops = db.query(TankOperation).all()
    tank_ops_by_code = {}
    for op in all_tank_ops:
        c = str(op.operation_code or "").strip().lower()
        loc = str(op.location_code or "").strip().lower()
        tank_ops_by_code[(loc, c)] = op
        tank_ops_by_code.setdefault(c, op)
    tank_ops_by_id = {op.id: op for op in all_tank_ops}

    rows = []

    for group_key in sorted(grouped.keys()):
        group_transactions = sorted(grouped[group_key], key=_tx_sort_key)
        previous = {"nsv": 0.0, "gsv": 0.0, "lt": 0.0, "mt": 0.0}
        sequence = 0

        for tx in group_transactions:
            payload = payload_map.get(tx.id)
            if not payload:
                continue

            resolved = resolved_by_tx[tx.id]
            eff_acc = resolved[3] or resolved[0] or tx.operation_date
            extracted = _extract_payload_columns(payload)
            current = _extract_stock_volumes(extracted)

            in_window = (
                (window_from is None or (eff_acc or date.min) >= window_from)
                and (explicit_date_to is None or (eff_acc or date.max) <= explicit_date_to)
            )

            if in_window:
                row = _build_row(
                    db,
                    tx,
                    payload,
                    sequence=sequence,
                    previous=previous,
                    location=locations_by_code.get(_key(tx.origin_location_code)),
                    asset=assets_by_code.get(_key(tx.primary_asset_code)),
                    resolved=resolved,
                    tank_ops_by_code=tank_ops_by_code,
                    tank_ops_by_id=tank_ops_by_id,
                )
                rows.append(row)

            previous = current
            sequence += 1

    cleaned_product_name = clean_optional_text(product_name)
    if cleaned_product_name:
        product_key = cleaned_product_name.casefold()
        rows = [
            row
            for row in rows
            if str(row.get("product_name") or "").casefold() == product_key
        ]

    effective_from_iso = window_from.isoformat() if window_from is not None else None
    return rows, effective_from_iso, default_window_applied


def get_out_turn_summary_rows(
    db: Session,
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: User | None = None,
):
    rows, _eff_from, _window_applied = _build_out_turn_summary_result(
        db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=date_from,
        date_to=date_to,
        current_user=current_user,
    )
    return rows


def build_available_columns_response(
    db: Session,
    location_code: str | None = None,
    current_user: User | None = None,
):
    definitions = _standard_available_definitions(db, current_user=current_user)
    configured = _load_configured_columns(db, definitions)

    return {
        "columns": configured,
        "available_columns": definitions,
    }


@router.get("/columns")
def get_out_turn_summary_columns(
    location_code: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Out-Turn Summary",
        db,
    )

    return build_available_columns_response(
        db,
        location_code,
        current_user=current_user,
    )


@router.get("/config")
def get_out_turn_summary_config(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Out-Turn Summary",
        db,
    )

    config = _get_or_create_config(db)

    if not config.columns_json:
        return {"columns": []}

    definitions = _standard_available_definitions(db, current_user=current_user)

    return {
        "columns": _load_configured_columns(db, definitions),
    }


@router.put("/config")
def update_out_turn_summary_config(
    payload: OutTurnSummaryConfigUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Edit Out-Turn Summary",
        db,
    )

    config = _get_or_create_config(db)

    config.columns_json = [
        {
            "key": item.key,
            "label": item.label,
            "group": item.group,
            "enabled": item.enabled,
            "order": item.order,
        }
        for item in payload.columns
    ]

    config.updated_by = current_user.username
    config.updated_at = datetime.now()

    db.commit()
    db.refresh(config)

    create_audit_log(
        db=db,
        module_name="Out-Turn Summary",
        action="Update Column Configuration",
        current_user=current_user,
        entity_type="OutTurnSummaryConfig",
        entity_id=config.id,
        entity_label="Out-Turn Summary Column Configuration",
        remarks="Updated Out-Turn Summary column configuration",
        request_path="/out-turn-summary/config",
        details={
            "column_count": len(config.columns_json),
            "updated_by": current_user.username,
        },
    )

    db.commit()

    definitions = _standard_available_definitions(db, current_user=current_user)

    return {
        "columns": _load_configured_columns(db, definitions),
    }


@router.get("")
def get_out_turn_summary(
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
        "View Out-Turn Summary",
        db,
    )

    all_rows, effective_date_from, default_window_applied = _build_out_turn_summary_result(
        db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=date_from,
        date_to=date_to,
        current_user=current_user,
    )

    safe_page = clamp_page(page)
    safe_page_size = clamp_limit(
        page_size, DEFAULT_REPORT_PAGE_SIZE, MAX_REPORT_PAGE_SIZE
    )
    total_rows = len(all_rows)
    start = (safe_page - 1) * safe_page_size
    rows = all_rows[start : start + safe_page_size]

    column_response = build_available_columns_response(
        db,
        location_code,
        current_user=current_user,
    )

    return {
        "columns": column_response["columns"],
        "available_columns": column_response["available_columns"],
        "rows": rows,
        "total_rows": total_rows,
        "page": safe_page,
        "page_size": safe_page_size,
        "has_more": (safe_page * safe_page_size) < total_rows,
        "default_window_applied": default_window_applied,
        "date_from": effective_date_from,
        "date_to": date_to,
    }
