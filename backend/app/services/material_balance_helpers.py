from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.models import (
    MaterialBalanceTemplate,
    MaterialBalanceTemplateColumn,
    TankStockLedger,
)
from app.utils.helpers import safe_float


def normalize_material_balance_category(value: str | None):
    text = str(value or "").strip().upper()
    if "RECEIPT" in text:
        return "RECEIPT"
    if "PRODUCTION" in text:
        return "PRODUCTION"
    if "DISPATCH" in text:
        return "DISPATCH"
    if "DRAIN" in text:
        return "DRAINING"
    if "OPENING" in text:
        return "OPENING"
    if "CLOSING" in text:
        return "CLOSING"
    return text or "OTHER"


def normalize_material_balance_code_value(value):
    return str(value or "").strip().upper()


def get_active_material_balance_template_for_location(
    db: Session,
    location_code: str,
):
    template = (
        db.query(MaterialBalanceTemplate)
        .filter(
            MaterialBalanceTemplate.location_code.ilike(location_code),
            MaterialBalanceTemplate.status == "Active",
        )
        .order_by(MaterialBalanceTemplate.id.desc())
        .first()
    )
    if not template:
        raise HTTPException(
            status_code=400,
            detail=(
                "No Active Material Balance Template found for this location. "
                "Please configure Material Balance Template first."
            ),
        )
    return template


def get_active_material_balance_template_columns(
    db: Session,
    template_id: int,
):
    columns = (
        db.query(MaterialBalanceTemplateColumn)
        .filter(
            MaterialBalanceTemplateColumn.template_id == template_id,
            MaterialBalanceTemplateColumn.status == "Active",
        )
        .order_by(
            MaterialBalanceTemplateColumn.column_order.asc(),
            MaterialBalanceTemplateColumn.id.asc(),
        )
        .all()
    )
    if not columns:
        raise HTTPException(
            status_code=400,
            detail="No Active columns configured for this Material Balance Template.",
        )
    return columns


def get_movement_value_for_unit(row: TankStockLedger, unit_key: str = "nsv"):
    if unit_key == "gsv":
        return safe_float(row.movement_gsv_bbl)
    if unit_key == "lt":
        return safe_float(row.movement_lt)
    if unit_key == "mt":
        return safe_float(row.movement_mt)
    return safe_float(row.movement_nsv_bbl)


def get_snapshot_value_for_unit(snapshot: dict, unit_key: str = "nsv"):
    unit_key = str(unit_key or "nsv").strip().lower()
    if unit_key == "gsv":
        return safe_float(snapshot.get("gsv"))
    if unit_key == "lt":
        return safe_float(snapshot.get("lt"))
    if unit_key == "mt":
        return safe_float(snapshot.get("mt"))
    return safe_float(snapshot.get("nsv"))


def should_row_match_material_balance_column(
    row: TankStockLedger,
    column: MaterialBalanceTemplateColumn,
):
    if normalize_material_balance_code_value(column.column_type) != "MOVEMENT":
        return False
    row_operation_code = normalize_material_balance_code_value(row.tank_operation_code)
    row_sign = normalize_material_balance_code_value(row.tank_operation_sign)
    column_direction = normalize_material_balance_code_value(column.movement_direction)
    mapped_operation_codes = {
        normalize_material_balance_code_value(code)
        for code in (column.mapped_operation_codes or [])
    }
    excluded_operation_codes = {
        normalize_material_balance_code_value(code)
        for code in (column.excluded_operation_codes or [])
    }
    if row_operation_code in excluded_operation_codes:
        return False
    if mapped_operation_codes and row_operation_code not in mapped_operation_codes:
        return False
    if column_direction and row_sign != column_direction:
        return False
    return True


def get_global_internal_transfer_operation_codes(
    columns: list[MaterialBalanceTemplateColumn],
):
    internal_codes = set()
    for column in columns:
        is_internal_transfer = (
            normalize_material_balance_code_value(column.is_internal_transfer) == "YES"
        )
        include_in_material_balance = (
            normalize_material_balance_code_value(column.include_in_material_balance) == "YES"
        )
        include_in_book_closing = (
            normalize_material_balance_code_value(column.include_in_book_closing) == "YES"
        )
        if is_internal_transfer:
            for code in column.mapped_operation_codes or []:
                internal_codes.add(normalize_material_balance_code_value(code))
        if (
            normalize_material_balance_code_value(column.column_type) == "MOVEMENT"
            and not include_in_material_balance
            and not include_in_book_closing
        ):
            for code in column.mapped_operation_codes or []:
                internal_codes.add(normalize_material_balance_code_value(code))
    return internal_codes


def should_row_be_in_book_closing_formula(
    row: TankStockLedger,
    columns: list[MaterialBalanceTemplateColumn],
    global_internal_transfer_codes: set[str],
):
    row_operation_code = normalize_material_balance_code_value(row.tank_operation_code)
    row_sign = normalize_material_balance_code_value(row.tank_operation_sign)
    if row_sign not in ["IN", "OUT"]:
        return False
    if row_operation_code in global_internal_transfer_codes:
        return False
    for column in columns:
        column_type = normalize_material_balance_code_value(column.column_type)
        if column_type != "MOVEMENT":
            continue
        include_in_material_balance = (
            normalize_material_balance_code_value(column.include_in_material_balance) == "YES"
        )
        include_in_book_closing = (
            normalize_material_balance_code_value(column.include_in_book_closing) == "YES"
        )
        is_internal_transfer = (
            normalize_material_balance_code_value(column.is_internal_transfer) == "YES"
        )
        if not include_in_material_balance:
            continue
        if not include_in_book_closing:
            continue
        if is_internal_transfer:
            continue
        if should_row_match_material_balance_column(row, column):
            return True
    return False


def calculate_book_closing_from_eligible_ledger_rows(
    opening_value: float,
    day_rows: list[TankStockLedger],
    columns: list[MaterialBalanceTemplateColumn],
    unit_key: str,
):
    global_internal_transfer_codes = get_global_internal_transfer_operation_codes(columns)
    eligible_in_total = 0
    eligible_out_total = 0
    included_ledger_ids = set()
    for row in day_rows:
        if row.id in included_ledger_ids:
            continue
        if not should_row_be_in_book_closing_formula(
            row=row,
            columns=columns,
            global_internal_transfer_codes=global_internal_transfer_codes,
        ):
            continue
        movement_value = get_movement_value_for_unit(row, unit_key)
        row_sign = normalize_material_balance_code_value(row.tank_operation_sign)
        if row_sign == "IN":
            eligible_in_total += movement_value
            included_ledger_ids.add(row.id)
        elif row_sign == "OUT":
            eligible_out_total += movement_value
            included_ledger_ids.add(row.id)
    book_closing_value = opening_value + eligible_in_total - eligible_out_total
    return {
        "book_closing_value": book_closing_value,
        "eligible_in_total": eligible_in_total,
        "eligible_out_total": eligible_out_total,
        "included_ledger_ids": sorted(list(included_ledger_ids)),
    }
