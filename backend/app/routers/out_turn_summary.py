from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    OperationTransaction,
    OperationTransactionValue,
    OperationTemplate,
    OperationType,
    OutTurnSummaryConfig,
    User,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    apply_location_filter,
    require_user_permission,
)
from app.routers.tank_operation_summary import (
    extract_tank_gauging_columns,
    get_tank_gauging_payload_for_transaction,
)
from app.schemas import OutTurnSummaryConfigUpdate
from app.services.audit_service import create_audit_log
from app.services.transaction_helpers import parse_date_filter
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
        "key": "operation_date",
        "label": "Operation Date",
        "group": "Base",
        "enabled": True,
        "order": 3,
    },
    {
        "key": "accounting_date",
        "label": "Accounting Date",
        "group": "Base",
        "enabled": True,
        "order": 4,
    },
    {
        "key": "location_code",
        "label": "Location Code",
        "group": "Base",
        "enabled": True,
        "order": 5,
    },
    {
        "key": "location_name",
        "label": "Location Name",
        "group": "Base",
        "enabled": True,
        "order": 6,
    },
    {
        "key": "tank_asset_code",
        "label": "Tank Asset Code",
        "group": "Base",
        "enabled": True,
        "order": 7,
    },
    {
        "key": "tank_asset_name",
        "label": "Tank Asset Name",
        "group": "Base",
        "enabled": True,
        "order": 8,
    },
    {
        "key": "product_name",
        "label": "Product Name",
        "group": "Base",
        "enabled": True,
        "order": 9,
    },
    {
        "key": "status",
        "label": "Status",
        "group": "Base",
        "enabled": True,
        "order": 10,
    },
    {
        "key": "created_by",
        "label": "Created By",
        "group": "Base",
        "enabled": True,
        "order": 11,
    },
    {
        "key": "created_at",
        "label": "Created At",
        "group": "Base",
        "enabled": True,
        "order": 12,
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
    query = (
        db.query(OperationTransaction)
        .join(OperationTemplate, OperationTransaction.operation_template_id == OperationTemplate.id)
        .join(OperationType, OperationTemplate.operation_type_code == OperationType.operation_type_code)
        .filter(
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            OperationType.applicable_asset_type_code == "TANK",
            OperationTemplate.entry_layout_type == "Tank Gauging",
        )
    )

    if current_user is not None:
        query = apply_location_filter(
            query, OperationTransaction, current_user, db, column_name="origin_location_code"
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

    date_from_value = parse_date_filter(date_from, "Date From")
    date_to_value = parse_date_filter(date_to, "Date To")

    if date_from_value:
        query = query.filter(OperationTransaction.operation_date >= date_from_value)

    if date_to_value:
        query = query.filter(OperationTransaction.operation_date <= date_to_value)

    return query


def _extract_payload_columns(payload: dict) -> dict:
    return extract_tank_gauging_columns(payload)


def _build_all_column_definitions(db: Session, location_code: str | None = None):
    definitions = list(BASE_COLUMNS)

    query = _get_transaction_query(db, location_code=location_code)
    transactions = query.limit(100).all()

    input_keys = set()
    calc_keys = set()

    for tx in transactions:
        payload = get_tank_gauging_payload_for_transaction(db, tx.id)
        if not payload:
            continue

        columns = _extract_payload_columns(payload)

        for key in columns.keys():
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

    definitions.extend(COMPUTED_COLUMNS)

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
    config = _get_saved_config(db)

    if config is None or not config.columns_json:
        return available_definitions

    available_map = {item["key"]: item for item in available_definitions}
    configured = []

    for item in config.columns_json:
        if not isinstance(item, dict) or "key" not in item:
            continue

        key = item.get("key")
        source = available_map.get(key)

        if source is None:
            continue

        configured.append(
            {
                "key": key,
                "label": item.get("label") or source["label"],
                "group": item.get("group") or source["group"],
                "enabled": bool(item.get("enabled", True)),
                "order": int(item.get("order") or len(configured)),
            }
        )

    known_keys = {item["key"] for item in configured}

    for item in available_definitions:
        if item["key"] not in known_keys:
            configured.append(
                {
                    "key": item["key"],
                    "label": item["label"],
                    "group": item["group"],
                    "enabled": item["enabled"],
                    "order": item["order"],
                }
            )

    configured.sort(key=lambda item: item["order"])

    return configured


def _build_row(
    db: Session,
    transaction: OperationTransaction,
    payload: dict,
    sequence: int,
    previous: dict,
):
    location = get_location_by_code(transaction.origin_location_code, db)
    asset = get_asset_by_code(transaction.primary_asset_code, db)

    extracted = _extract_payload_columns(payload)

    current_nsv = safe_float(extracted.get("calc_nsvBbl"))
    current_gsv = safe_float(extracted.get("calc_gsvBbl"))
    current_lt = safe_float(extracted.get("calc_lt"))
    current_mt = safe_float(extracted.get("calc_mt"))

    previous_nsv = safe_float(previous.get("nsv"))
    previous_gsv = safe_float(previous.get("gsv"))
    previous_lt = safe_float(previous.get("lt"))
    previous_mt = safe_float(previous.get("mt"))

    signed_net_nsv = current_nsv - previous_nsv
    signed_net_gsv = current_gsv - previous_gsv
    signed_net_lt = current_lt - previous_lt
    signed_net_mt = current_mt - previous_mt

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

    for key, value in extracted.items():
        row[key] = value

    row.update(
        {
            "sequence": sequence,
            "previous_nsv": previous_nsv,
            "previous_gsv": previous_gsv,
            "previous_lt": previous_lt,
            "previous_mt": previous_mt,
            "signed_net_nsv": signed_net_nsv,
            "signed_net_gsv": signed_net_gsv,
            "signed_net_lt": signed_net_lt,
            "signed_net_mt": signed_net_mt,
            "net_receipt_nsv": max(signed_net_nsv, 0),
            "net_receipt_gsv": max(signed_net_gsv, 0),
            "net_receipt_lt": max(signed_net_lt, 0),
            "net_receipt_mt": max(signed_net_mt, 0),
            "net_dispatch_nsv": max(-signed_net_nsv, 0),
            "net_dispatch_gsv": max(-signed_net_gsv, 0),
            "net_dispatch_lt": max(-signed_net_lt, 0),
            "net_dispatch_mt": max(-signed_net_mt, 0),
        }
    )

    return row


def get_out_turn_summary_rows(
    db: Session,
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: User | None = None,
):
    query = _get_transaction_query(
        db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=date_from,
        date_to=date_to,
        current_user=current_user,
    )

    transactions = query.order_by(
        OperationTransaction.operation_date.asc(),
        OperationTransaction.id.asc(),
    ).all()

    grouped = {}

    for tx in transactions:
        key = (
            tx.origin_location_code or "",
            tx.primary_asset_code or "",
            tx.product_name or "",
        )

        if key not in grouped:
            grouped[key] = []

        grouped[key].append(tx)

    rows = []

    for group_key in sorted(grouped.keys()):
        previous = {"nsv": 0.0, "gsv": 0.0, "lt": 0.0, "mt": 0.0}
        sequence = 0

        for tx in grouped[group_key]:
            payload = get_tank_gauging_payload_for_transaction(db, tx.id)

            if not payload:
                continue

            row = _build_row(
                db,
                tx,
                payload,
                sequence=sequence,
                previous=previous,
            )

            rows.append(row)

            extracted = _extract_payload_columns(payload)

            previous = {
                "nsv": safe_float(extracted.get("calc_nsvBbl")),
                "gsv": safe_float(extracted.get("calc_gsvBbl")),
                "lt": safe_float(extracted.get("calc_lt")),
                "mt": safe_float(extracted.get("calc_mt")),
            }

            sequence += 1

    return rows


def build_available_columns_response(db: Session, location_code: str | None = None):
    definitions = _build_all_column_definitions(db, location_code)
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

    return build_available_columns_response(db, location_code)


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

    return {
        "columns": config.columns_json or [],
    }


@router.put("/config")
def update_out_turn_summary_config(
    payload: OutTurnSummaryConfigUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Out-Turn Summary",
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

    return {
        "columns": config.columns_json,
    }


@router.get("")
def get_out_turn_summary(
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
        "View Out-Turn Summary",
        db,
    )

    rows = get_out_turn_summary_rows(
        db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=date_from,
        date_to=date_to,
        current_user=current_user,
    )

    column_response = build_available_columns_response(db, location_code)

    return {
        "columns": column_response["columns"],
        "available_columns": column_response["available_columns"],
        "rows": rows,
        "total_rows": len(rows),
    }
