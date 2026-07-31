from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_
import io
import csv

from app.database import get_db
from app.models import (
    OperationTransaction,
    OperationTransactionValue,
    OperationTemplate,
    OperationType,
    Location,
    Asset,
    User,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    apply_location_filter,
    get_user_location_codes,
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


def get_all_possible_columns(db: Session, location_code: str | None = None):
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

    if location_code:
        query = query.filter(OperationTransaction.origin_location_code.ilike(location_code))

    transactions = query.limit(100).all()

    all_columns = set()

    for tx in transactions:
        payload = get_tank_gauging_payload_for_transaction(db, tx.id)
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


def build_tank_operation_summary_row(
    transaction: OperationTransaction,
    payload: dict,
    db: Session,
    all_columns: list[str],
):
    location = get_location_by_code(transaction.origin_location_code, db)
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

    transactions = query.order_by(
        OperationTransaction.operation_date.desc(),
        OperationTransaction.id.desc(),
    ).all()

    all_columns = get_all_possible_columns(db, cleaned_location_code)

    results = []
    for tx in transactions:
        payload = get_tank_gauging_payload_for_transaction(db, tx.id)
        if payload:
            row = build_tank_operation_summary_row(tx, payload, db, all_columns)
            results.append(row)

    return results, all_columns


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

    columns = get_all_possible_columns(db, location_code)
    return {"columns": columns}


@router.get("")
def get_tank_operation_summary(
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

    rows, columns = get_filtered_tank_operation_summary_rows(
        db=db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=date_from,
        date_to=date_to,
        current_user=current_user,
    )

    return {
        "columns": columns,
        "rows": rows,
        "total_rows": len(rows),
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

    rows, columns = get_filtered_tank_operation_summary_rows(
        db=db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=date_from,
        date_to=date_to,
        current_user=current_user,
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