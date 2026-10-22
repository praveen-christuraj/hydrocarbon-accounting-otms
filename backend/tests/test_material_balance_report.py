from datetime import date
from types import SimpleNamespace

from app.routers.reports import (
    build_dynamic_material_balance_tank_rows,
    consolidate_dynamic_material_balance_rows_by_location,
)


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
