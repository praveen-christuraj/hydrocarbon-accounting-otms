from datetime import date, datetime
from types import SimpleNamespace

from app.routers.reports import (
    build_dynamic_material_balance_tank_rows,
    consolidate_dynamic_material_balance_rows_by_location,
    get_material_balance_rows_for_continuity,
    rebuild_tank_stock_running_balances,
)
from app.models import OperationTransaction, TankStockLedger


def _column(key, column_type, direction=None, codes=None):
    return SimpleNamespace(
        column_key=key,
        column_type=column_type,
        movement_direction=direction,
        mapped_operation_codes=codes or [],
        excluded_operation_codes=[],
        include_in_material_balance="Yes",
        include_in_book_closing="Yes",
        is_internal_transfer="No",
    )


def _ledger_row(
    row_id,
    accounting_date,
    tank_code,
    product,
    operation_code,
    sign,
    movement_nsv,
    stock_nsv,
    gauging_date,
    gauging_time,
):
    return SimpleNamespace(
        id=row_id,
        location_code="UTP",
        tank_asset_code=tank_code,
        tank_asset_name="Tank One",
        product_name=product,
        accounting_date=accounting_date,
        accounting_day_start=None,
        operation_date=date.fromisoformat(gauging_date),
        tank_operation_code=operation_code,
        tank_operation_category="MOVEMENT",
        tank_operation_sign=sign,
        movement_gsv_bbl=movement_nsv,
        movement_nsv_bbl=movement_nsv,
        movement_lt=movement_nsv,
        movement_mt=movement_nsv,
        stock_gsv_bbl=stock_nsv,
        stock_nsv_bbl=stock_nsv,
        stock_lt=stock_nsv,
        stock_mt=stock_nsv,
        running_balance_gsv_bbl=stock_nsv,
        running_balance_nsv_bbl=stock_nsv,
        running_balance_lt=stock_nsv,
        running_balance_mt=stock_nsv,
        ticket_number=f"TKT-{row_id}",
        source_payload={
            "inputs": {
                "gaugingDate": gauging_date,
                "gaugingTime": gauging_time,
            }
        },
    )


def test_material_balance_has_one_accounting_date_and_sums_only_movements(db):
    columns = [
        _column("OPENING", "OPENING"),
        _column("RECEIPTS", "MOVEMENT", "IN", ["REC_OP"]),
        _column("DISPATCHES", "MOVEMENT", "OUT", ["DISP_OP"]),
        _column("BOOK", "BOOK_CLOSING"),
        _column("CLOSING", "ACTUAL_CLOSING"),
        _column("LOSS_GAIN", "LOSS_GAIN"),
    ]
    accounting_date = date(2026, 10, 20)
    rows = [
        _ledger_row(
            1, date(2026, 10, 19), "TANK-1", "Crude A", "OPEN", "NEUTRAL",
            0, 100, "2026-10-19", "23:00:00",
        ),
        _ledger_row(
            2, date(2026, 10, 19), "TANK-1", "Crude B", "OPEN", "NEUTRAL",
            0, 110, "2026-10-20", "05:00:00",
        ),
        _ledger_row(
            3, accounting_date, "TANK-1", "Crude A", "REC_OP", "IN",
            10, 110, "2026-10-20", "23:00:00",
        ),
        # 05:00 on the following calendar morning still belongs to the same
        # persisted location accounting day window.
        _ledger_row(
            4, accounting_date, "TANK-1", "Crude B", "DISP_OP", "OUT",
            4, 106, "2026-10-21", "05:00:00",
        ),
    ]

    tank_rows = build_dynamic_material_balance_tank_rows(
        db=db,
        ledger_rows=rows,
        columns=columns,
        date_from_value=accounting_date,
        date_to_value=accounting_date,
        unit_key="nsv",
    )
    report_rows = consolidate_dynamic_material_balance_rows_by_location(
        tank_rows=tank_rows,
        columns=columns,
    )

    assert len(report_rows) == 1
    report = report_rows[0]
    assert report["accounting_date"] == accounting_date
    assert report["tank_asset_code"] == "TANK-1"
    assert report["product_name"] == "Crude B"
    assert report["rows_count"] == 2
    assert report["values"] == {
        "OPENING": 110.0,
        "RECEIPTS": 10.0,
        "DISPATCHES": 4.0,
        "BOOK": 116.0,
        "CLOSING": 106.0,
        "LOSS_GAIN": -10.0,
    }


def test_material_balance_product_is_reference_only(db):
    accounting_date = date(2026, 10, 20)
    for index, product_name in enumerate(("Crude A", "Crude B"), start=1):
        transaction = OperationTransaction(
            operation_number=f"MB-PRODUCT-{index}",
            operation_type_code="TANK_OPS",
            primary_asset_code="TANK-1",
            primary_asset_type_code="TANK",
            origin_location_code="UTP",
            operation_date=accounting_date,
            product_name=product_name,
            status="Approved",
        )
        db.add(transaction)
        db.flush()
        db.add(
            TankStockLedger(
                transaction_id=transaction.id,
                ticket_number=f"MB-TKT-{index}",
                operation_number=transaction.operation_number,
                location_code="UTP",
                tank_asset_code="TANK-1",
                operation_date=accounting_date,
                product_name=product_name,
                accounting_date=accounting_date,
                accounting_day_start=datetime(2026, 10, 20, 6 + index),
                accounting_day_end=datetime(2026, 10, 21, 6),
                accounting_day_setting_id=999,
                tank_operation_code="REC_OP",
                tank_operation_label="Receipt",
                tank_operation_category="RECEIPT",
                tank_operation_sign="IN",
                movement_nsv_bbl=index,
                stock_nsv_bbl=100 + index,
                status="Active",
            )
        )
    db.commit()

    rows = get_material_balance_rows_for_continuity(
        db=db,
        location_code="UTP",
        tank_asset_code="TANK-1",
        product_name="Crude A",
        date_to_value=accounting_date,
    )

    assert [row.product_name for row in rows] == ["Crude A", "Crude B"]

    rebuild_tank_stock_running_balances(
        db=db,
        location_code="UTP",
        tank_asset_code="TANK-1",
        product_name="Crude A",
    )

    assert rows[1].previous_stock_nsv_bbl == 101
    assert rows[1].movement_nsv_bbl == 1
