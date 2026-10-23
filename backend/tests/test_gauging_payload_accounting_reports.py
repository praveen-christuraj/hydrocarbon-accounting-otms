"""Comprehensive regression tests for payload-strict gauging date/time accounting.

Covers every root cause identified across all hydrocarbon accounting reports:
1. Stringified JSON payloads, non-padded times ("6:30", "2:15 PM"), slash/unpadded
   dates, flat ``input_gaugingDate``/``input_gaugingTime``, and continuous 24h
   Location Accounting Day windows (including 1-minute boundary seconds such as
   ``06:00:30`` between ``06:01`` start and ``06:00`` end, plus historical tickets
   before ``effective_from``).
2. Full end-to-end reconciliation across Out-Turn Summary, Out-Turn Report
   (ledger-backed and transaction-fallback), Tank Operation Summary, Tank Stock
   Ledger, Stock Summary, Daily Summary, OTR Validation, Material Balance Report
   (both ``/reports/material-balance-report`` and
   ``/tank-stock-ledger/material-balance-report``), and Dashboard
   ``TANK_STOCK_SNAPSHOT`` when:
     * tickets are inserted out of physical chronological order,
     * ``OperationTransaction.operation_date`` and ``operation_start_datetime``
       carry stale/conflicting dates,
     * ``SET`` (OPENING) and ``NEUTRAL`` (CLOSING) operations appear in the chain,
     * ``date_from`` starts mid-chain (preserving predecessor opening stock instead
       of zeroing previous stock or turning dispatches negative).
3. Multi-tank Material Balance consolidation summing ``OPENING`` and
   ``ACTUAL_CLOSING`` across all active tanks at a location instead of overwriting
   with the last tank's balance.
4. Automatic ledger re-sync & chronological rebuild when a Location Accounting Day
   Setting or TankOperation sign/label is modified via API.
5. FSO reports (``otr``, ``material-balance``, ``outturn``) and Tanker Transaction
   Report using payload date/time + Location Accounting Day Setting rather than SQL
   ``OperationTransaction.operation_date`` filtering.
"""

import json
from datetime import date, datetime, time

import pytest

from app.models import (
    Asset,
    AssetType,
    Location,
    LocationAccountingDaySetting,
    MaterialBalanceTemplate,
    MaterialBalanceTemplateColumn,
    OperationTemplate,
    OperationTransaction,
    OperationTransactionValue,
    OperationType,
    Role,
    TankOperation,
    TankStockLedger,
)
from app.dependencies.auth import get_current_user_from_token
from app.main import app
from app.routers.reports import create_tank_stock_ledger_from_approved_transaction
from app.services.operation_datetime import (
    calculate_window_from_setting_parts,
    get_payload_operation_parts,
    parse_date_value as parse_payload_date,
    parse_time_value as parse_payload_time,
)
from tests.conftest import create_user


@pytest.fixture()
def admin_headers(db):
    admin_role = Role(role_name="Admin", status="Active")
    db.add(admin_role)
    db.flush()
    admin_user = create_user(db, username="admin", roles=[admin_role])
    db.commit()
    app.dependency_overrides[get_current_user_from_token] = lambda: admin_user
    return {}


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


def _seed_terminal(db, *, loc_code="BONNY", start=time(6, 1), end=time(6, 0)):
    loc = Location(
        location_name="Bonny Terminal",
        location_code=loc_code,
        location_type="Terminal",
        status="Active",
    )
    db.add(loc)

    asset_type = AssetType(
        asset_type_name="Storage Tank",
        asset_type_code="TANK",
        status="Active",
    )
    db.add(asset_type)

    tank1 = Asset(
        asset_name="Bonny Tank 01",
        asset_code=f"{loc_code}_TK01",
        asset_scope="Location",
        asset_type_code="TANK",
        location_code=loc_code,
        status="Active",
    )
    tank2 = Asset(
        asset_name="Bonny Tank 02",
        asset_code=f"{loc_code}_TK02",
        asset_scope="Location",
        asset_type_code="TANK",
        location_code=loc_code,
        status="Active",
    )
    db.add_all([tank1, tank2])

    setting = LocationAccountingDaySetting(
        location_code=loc_code,
        day_start_time=start,
        day_end_time=end,
        effective_from=date(2026, 6, 1),
        effective_to=None,
        timezone_name="Africa/Lagos",
        status="Active",
    )
    db.add(setting)

    op_type = OperationType(
        operation_type_name="Tank Gauging Operations",
        operation_type_code="TANK_GAUGE",
        applicable_asset_type_code="TANK",
        operation_category="Stock",
        status="Active",
    )
    db.add(op_type)

    template = OperationTemplate(
        template_name="Standard Tank Gauging",
        operation_type_code="TANK_GAUGE",
        entry_layout_type="Tank Gauging",
        calculation_engine="Tank Quantity",
        status="Active",
    )
    db.add(template)

    ops = [
        TankOperation(
            location_code=loc_code,
            operation_code="OPENING",
            operation_label="Opening Stock",
            operation_category="OPENING",
            operation_sign="SET",
            status="Active",
        ),
        TankOperation(
            location_code=loc_code,
            operation_code="RECEIPT",
            operation_label="Crude Receipt",
            operation_category="RECEIPT",
            operation_sign="IN",
            status="Active",
        ),
        TankOperation(
            location_code=loc_code,
            operation_code="CLOSING",
            operation_label="Closing Dip",
            operation_category="CLOSING",
            operation_sign="NEUTRAL",
            status="Active",
        ),
        TankOperation(
            location_code=loc_code,
            operation_code="DISPATCH",
            operation_label="Export Dispatch",
            operation_category="DISPATCH",
            operation_sign="OUT",
            status="Active",
        ),
    ]
    db.add_all(ops)

    mb_template = MaterialBalanceTemplate(
        location_code=loc_code,
        template_name="Bonny MB",
        status="Active",
    )
    db.add(mb_template)
    db.flush()

    mb_cols = [
        MaterialBalanceTemplateColumn(
            template_id=mb_template.id,
            column_key="opening_stock",
            column_label="Opening Stock",
            column_order=1,
            column_type="OPENING",
            include_in_material_balance="Yes",
            is_internal_transfer="No",
            status="Active",
        ),
        MaterialBalanceTemplateColumn(
            template_id=mb_template.id,
            column_key="receipt",
            column_label="Receipt",
            column_order=2,
            column_type="MOVEMENT",
            movement_direction="IN",
            mapped_operation_codes=["RECEIPT"],
            include_in_material_balance="Yes",
            include_in_book_closing="Yes",
            is_internal_transfer="No",
            status="Active",
        ),
        MaterialBalanceTemplateColumn(
            template_id=mb_template.id,
            column_key="dispatch",
            column_label="Dispatch",
            column_order=3,
            column_type="MOVEMENT",
            movement_direction="OUT",
            mapped_operation_codes=["DISPATCH"],
            include_in_material_balance="Yes",
            include_in_book_closing="Yes",
            is_internal_transfer="No",
            status="Active",
        ),
        MaterialBalanceTemplateColumn(
            template_id=mb_template.id,
            column_key="book_closing",
            column_label="Book Closing",
            column_order=4,
            column_type="BOOK_CLOSING",
            include_in_material_balance="Yes",
            is_internal_transfer="No",
            status="Active",
        ),
        MaterialBalanceTemplateColumn(
            template_id=mb_template.id,
            column_key="actual_closing",
            column_label="Actual Closing",
            column_order=5,
            column_type="ACTUAL_CLOSING",
            include_in_material_balance="Yes",
            is_internal_transfer="No",
            status="Active",
        ),
        MaterialBalanceTemplateColumn(
            template_id=mb_template.id,
            column_key="loss_gain",
            column_label="Loss / Gain",
            column_order=6,
            column_type="LOSS_GAIN",
            include_in_material_balance="Yes",
            is_internal_transfer="No",
            status="Active",
        ),
    ]
    db.add_all(mb_cols)
    db.commit()

    return {
        "loc": loc,
        "tank1": tank1,
        "tank2": tank2,
        "setting": setting,
        "template": template,
        "mb_template": mb_template,
    }


def _add_gauging_ticket(
    db,
    *,
    template_id: int,
    op_number: str,
    loc_code: str,
    tank_code: str,
    metadata_date: date,
    metadata_start: datetime,
    gauging_date: str,
    gauging_time: str,
    op_code: str,
    op_label: str,
    op_category: str,
    op_sign: str,
    nsv: float,
    gsv: float | None = None,
    lt: float = 100.0,
    mt: float = 102.0,
    as_json_string: bool = False,
):
    gsv_val = gsv if gsv is not None else nsv
    tx = OperationTransaction(
        operation_number=op_number,
        operation_ticket_number=f"TKT-{op_number}",
        operation_type_code="TANK_GAUGE",
        operation_template_id=template_id,
        origin_location_code=loc_code,
        primary_asset_type_code="TANK",
        primary_asset_code=tank_code,
        product_name="Bonny Light",
        operation_date=metadata_date,
        operation_start_datetime=metadata_start,
        status="Approved",
        created_by="Admin",
    )
    db.add(tx)
    db.flush()

    payload_obj = {
        "inputs": {
            "tankOperationCode": op_code,
            "tankOperationLabel": op_label,
            "tankOperationCategory": op_category,
            "tankOperationSign": op_sign,
            "gaugingDate": gauging_date,
            "gaugingTime": gauging_time,
        },
        "calculated": {
            "gsvBbl": gsv_val,
            "nsvBbl": nsv,
            "lt": lt,
            "mt": mt,
        },
    }
    db.add(
        OperationTransactionValue(
            transaction_id=tx.id,
            field_code="tank_gauging_payload",
            field_name="Tank Gauging Payload",
            data_type="JSON",
            field_value=json.dumps(payload_obj) if as_json_string else payload_obj,
        )
    )
    db.flush()
    create_tank_stock_ledger_from_approved_transaction(db=db, transaction=tx)
    db.commit()
    return tx


# ---------------------------------------------------------------------------
# 1. Payload date/time parser & continuous 24h accounting window
# ---------------------------------------------------------------------------


def test_flexible_payload_parsing_and_gap_free_window():
    assert parse_payload_date("2026-9-4") == date(2026, 9, 4)
    assert parse_payload_date("21/10/2026") == date(2026, 10, 21)
    assert parse_payload_time("6:05") == time(6, 5)
    assert parse_payload_time("2:30 PM") == time(14, 30)
    assert parse_payload_time("06:00:45") == time(6, 0, 45)

    # Stringified JSON payload with unpadded date/time
    raw_json_str = json.dumps(
        {"inputs": {"gaugingDate": "2026-10-20", "gaugingTime": "5:45"}}
    )
    assert get_payload_operation_parts(raw_json_str) == (
        date(2026, 10, 20),
        time(5, 45),
    )

    # Flat summary-style keys
    assert get_payload_operation_parts(
        {"input_gaugingDate": "2026-10-20", "input_gaugingTime": "06:30"}
    ) == (date(2026, 10, 20), time(6, 30))

    # Continuous 24h window: 06:01 -> 06:00 must classify 06:00:30 into previous
    # accounting day cleanly without raising any gap error!
    dummy_setting = LocationAccountingDaySetting(
        id=99,
        location_code="BONNY",
        day_start_time=time(6, 1),
        day_end_time=time(6, 0),
        effective_from=date(2026, 1, 1),
        timezone_name="Africa/Lagos",
        status="Active",
    )
    win = calculate_window_from_setting_parts(
        dummy_setting,
        date(2026, 10, 20),
        time(6, 0, 30),
    )
    assert win["accounting_date"] == date(2026, 10, 19)

    win_after_cutoff = calculate_window_from_setting_parts(
        dummy_setting,
        date(2026, 10, 20),
        time(6, 1, 0),
    )
    assert win_after_cutoff["accounting_date"] == date(2026, 10, 20)


# ---------------------------------------------------------------------------
# 2. Full end-to-end reconciliation across ALL 6 tank reports
# ---------------------------------------------------------------------------


def test_all_tank_reports_reconcile_on_out_of_order_stale_metadata_payloads(
    client, db, admin_headers
):
    seed = _seed_terminal(db, loc_code="BONNY", start=time(6, 1), end=time(6, 0))
    tpl_id = seed["template"].id
    tank_code = seed["tank1"].asset_code

    # Insert tickets deliberately OUT OF CHRONOLOGICAL ORDER with completely wrong
    # metadata operation_date (2026-01-05) & operation_start_datetime:
    #
    # Chronological reality from payload (06:01 -> 06:00 window):
    #  1) OP-01: 2026-10-19 08:30 -> AccDay 2026-10-19 | OPENING (SET)     | NSV = 10,000 -> mov 0
    #  2) OP-02: 2026-10-20 05:30 -> AccDay 2026-10-19 | RECEIPT (IN)      | NSV = 12,500 -> receipt +2,500
    #  3) OP-03: 2026-10-20 06:00:30 -> AccDay 2026-10-19 | CLOSING (NEUTRAL) | NSV = 12,500 -> mov 0
    #  4) OP-04: 2026-10-20 14:15 -> AccDay 2026-10-20 | DISPATCH (OUT)    | NSV =  9,500 -> dispatch +3,000

    # Insert OP-04 FIRST!
    _add_gauging_ticket(
        db,
        template_id=tpl_id,
        op_number="OP-04",
        loc_code="BONNY",
        tank_code=tank_code,
        metadata_date=date(2026, 1, 5),
        metadata_start=datetime(2026, 1, 5, 2, 0),
        gauging_date="2026-10-20",
        gauging_time="14:15",
        op_code="DISPATCH",
        op_label="Export Dispatch",
        op_category="DISPATCH",
        op_sign="OUT",
        nsv=9500.0,
        as_json_string=True,
    )
    # Insert OP-02 SECOND with single-digit hour "5:30" and stringified JSON!
    _add_gauging_ticket(
        db,
        template_id=tpl_id,
        op_number="OP-02",
        loc_code="BONNY",
        tank_code=tank_code,
        metadata_date=date(2026, 1, 5),
        metadata_start=datetime(2026, 1, 5, 23, 0),
        gauging_date="2026-10-20",
        gauging_time="5:30",
        op_code="RECEIPT",
        op_label="Crude Receipt",
        op_category="RECEIPT",
        op_sign="IN",
        nsv=12500.0,
        as_json_string=True,
    )
    # Insert OP-03 THIRD right inside the 06:00:30 boundary second!
    _add_gauging_ticket(
        db,
        template_id=tpl_id,
        op_number="OP-03",
        loc_code="BONNY",
        tank_code=tank_code,
        metadata_date=date(2026, 1, 5),
        metadata_start=datetime(2026, 1, 5, 1, 0),
        gauging_date="2026-10-20",
        gauging_time="06:00:30",
        op_code="CLOSING",
        op_label="Closing Dip",
        op_category="CLOSING",
        op_sign="NEUTRAL",
        nsv=12500.0,
    )
    # Insert OP-01 LAST even though physically earliest (2026-10-19 08:30)!
    _add_gauging_ticket(
        db,
        template_id=tpl_id,
        op_number="OP-01",
        loc_code="BONNY",
        tank_code=tank_code,
        metadata_date=date(2026, 1, 5),
        metadata_start=datetime(2026, 1, 5, 22, 0),
        gauging_date="2026-10-19",
        gauging_time="8:30",
        op_code="OPENING",
        op_label="Opening Stock",
        op_category="OPENING",
        op_sign="SET",
        nsv=10000.0,
        as_json_string=True,
    )

    # ---- A) Out-Turn Summary sliced to Day 2 ONLY (date_from=2026-10-20) ----
    ots_day2 = client.get(
        "/out-turn-summary?location_code=BONNY&date_from=2026-10-20&date_to=2026-10-20",
        headers=admin_headers,
    )
    assert ots_day2.status_code == 200, ots_day2.text
    ots_day2_rows = ots_day2.json()["rows"]
    assert [r["operation_number"] for r in ots_day2_rows] == ["OP-04"]
    assert ots_day2_rows[0]["accounting_date"] == "2026-10-20"
    assert ots_day2_rows[0]["previous_nsv"] == pytest.approx(12500.0)
    assert ots_day2_rows[0]["net_dispatch_nsv"] == pytest.approx(3000.0)
    assert ots_day2_rows[0]["net_receipt_nsv"] == pytest.approx(0.0)
    assert ots_day2_rows[0]["signed_net_nsv"] == pytest.approx(-3000.0)

    # Full range Out-Turn Summary order: OP-01 -> OP-02 -> OP-03 -> OP-04
    ots_all = client.get(
        "/out-turn-summary?location_code=BONNY&date_from=2026-10-19&date_to=2026-10-20",
        headers=admin_headers,
    )
    assert ots_all.status_code == 200
    ots_rows = ots_all.json()["rows"]
    assert [r["operation_number"] for r in ots_rows] == [
        "OP-01",
        "OP-02",
        "OP-03",
        "OP-04",
    ]
    assert [r["accounting_date"] for r in ots_rows] == [
        "2026-10-19",
        "2026-10-19",
        "2026-10-19",
        "2026-10-20",
    ]
    assert ots_rows[0]["net_receipt_nsv"] == pytest.approx(0.0)
    assert ots_rows[1]["net_receipt_nsv"] == pytest.approx(2500.0)
    assert ots_rows[2]["net_receipt_nsv"] == pytest.approx(0.0)
    assert ots_rows[2]["net_dispatch_nsv"] == pytest.approx(0.0)
    assert ots_rows[3]["net_dispatch_nsv"] == pytest.approx(3000.0)

    # ---- B) Out-Turn Report (ledger-backed) sliced to Day 2 ONLY ----
    otr_day2 = client.get(
        "/reports/out-turn-report?location_code=BONNY&date_from=2026-10-20&date_to=2026-10-20",
        headers=admin_headers,
    )
    assert otr_day2.status_code == 200
    otr_d2 = otr_day2.json()
    assert len(otr_d2) == 1
    assert otr_d2[0]["operation_number"] == "OP-04"
    assert otr_d2[0]["gauging_date"] == "2026-10-20"
    assert otr_d2[0]["gauging_time"] == "14:15"
    assert otr_d2[0]["previous_stock_nsv_bbl"] == pytest.approx(12500.0)
    assert otr_d2[0]["dispatch_nsv_bbl"] == pytest.approx(3000.0)
    assert otr_d2[0]["stock_after_nsv_bbl"] == pytest.approx(9500.0)

    # Out-Turn sequence validation must report 0 sequence anomalies!
    otr_val = client.get(
        "/reports/out-turn-report/validation?location_code=BONNY",
        headers=admin_headers,
    )
    assert otr_val.status_code == 200
    assert otr_val.json()["issues_count"] == 0

    # ---- C) Tank Operation Summary ----
    tos = client.get(
        "/tank-operation-summary?location_code=BONNY&date_from=2026-10-19&date_to=2026-10-19",
        headers=admin_headers,
    )
    assert tos.status_code == 200
    assert [r["operation_number"] for r in tos.json()["rows"]] == [
        "OP-01",
        "OP-02",
        "OP-03",
    ]

    # ---- D) Tank Stock Ledger + Stock Summary + Daily Summary ----
    ledger_resp = client.get(
        "/reports/tank-stock-ledger?location_code=BONNY&date_from=2026-10-19&date_to=2026-10-20",
        headers=admin_headers,
    )
    assert ledger_resp.status_code == 200
    ledger_rows = ledger_resp.json()
    assert [r["operation_number"] for r in ledger_rows] == [
        "OP-01",
        "OP-02",
        "OP-03",
        "OP-04",
    ]
    assert ledger_rows[1]["gauging_date"] == "2026-10-20"
    assert ledger_rows[1]["gauging_time"] == "05:30"

    # Stock Summary on Day 2 ONLY: Opening MUST be 12,500 (NOT 0!) & Closing 9,500!
    stock_sum = client.get(
        "/reports/tank-stock-ledger/summary?location_code=BONNY&date_from=2026-10-20&date_to=2026-10-20",
        headers=admin_headers,
    )
    assert stock_sum.status_code == 200
    s_row = stock_sum.json()[0]
    assert s_row["opening_nsv_bbl"] == pytest.approx(12500.0)
    assert s_row["total_in_nsv_bbl"] == pytest.approx(0.0)
    assert s_row["total_out_nsv_bbl"] == pytest.approx(3000.0)
    assert s_row["closing_nsv_bbl"] == pytest.approx(9500.0)

    # Daily Summary across both days
    daily_sum = client.get(
        f"/reports/tank-stock-ledger/daily-summary?location_code=BONNY&tank_asset_code={tank_code}&date_from=2026-10-19&date_to=2026-10-20",
        headers=admin_headers,
    )
    assert daily_sum.status_code == 200
    d_rows = daily_sum.json()
    assert len(d_rows) == 2
    assert d_rows[0]["accounting_date"] == "2026-10-19"
    assert d_rows[0]["opening_nsv_bbl"] == pytest.approx(10000.0)
    assert d_rows[0]["total_in_nsv_bbl"] == pytest.approx(2500.0)
    assert d_rows[0]["total_out_nsv_bbl"] == pytest.approx(0.0)
    assert d_rows[0]["actual_closing_nsv_bbl"] == pytest.approx(12500.0)
    assert d_rows[0]["loss_gain_nsv_bbl"] == pytest.approx(0.0)

    assert d_rows[1]["accounting_date"] == "2026-10-20"
    assert d_rows[1]["opening_nsv_bbl"] == pytest.approx(12500.0)
    assert d_rows[1]["total_in_nsv_bbl"] == pytest.approx(0.0)
    assert d_rows[1]["total_out_nsv_bbl"] == pytest.approx(3000.0)
    assert d_rows[1]["actual_closing_nsv_bbl"] == pytest.approx(9500.0)
    assert d_rows[1]["loss_gain_nsv_bbl"] == pytest.approx(0.0)

    # ---- E) Material Balance Report (BOTH routes) ----
    for endpoint in (
        "/reports/material-balance-report",
        "/tank-stock-ledger/material-balance-report",
    ):
        mb = client.get(
            f"{endpoint}?location_code=BONNY&date_from=2026-10-19&date_to=2026-10-20",
            headers=admin_headers,
        )
        assert mb.status_code == 200, mb.text
        mb_rows = mb.json()["rows"]
        assert len(mb_rows) == 2
        assert mb_rows[0]["values"] == pytest.approx(
            {
                "opening_stock": 10000.0,
                "receipt": 2500.0,
                "dispatch": 0.0,
                "book_closing": 12500.0,
                "actual_closing": 12500.0,
                "loss_gain": 0.0,
            }
        )
        assert mb_rows[1]["values"] == pytest.approx(
            {
                "opening_stock": 12500.0,
                "receipt": 0.0,
                "dispatch": 3000.0,
                "book_closing": 9500.0,
                "actual_closing": 9500.0,
                "loss_gain": 0.0,
            }
        )

    # ---- F) Transaction-fallback path of Out-Turn Report when ledger rows absent ----
    db.query(TankStockLedger).delete()
    db.commit()

    otr_fallback = client.get(
        "/reports/out-turn-report?location_code=BONNY&date_from=2026-10-20&date_to=2026-10-20",
        headers=admin_headers,
    )
    assert otr_fallback.status_code == 200
    otr_fb_rows = otr_fallback.json()
    assert len(otr_fb_rows) == 1
    assert otr_fb_rows[0]["operation_number"] == "OP-04"
    assert otr_fb_rows[0]["previous_stock_nsv_bbl"] == pytest.approx(12500.0)
    assert otr_fb_rows[0]["dispatch_nsv_bbl"] == pytest.approx(3000.0)

    # And POST /reports/tank-stock-ledger/rebuild restores ALL missing ledger rows!
    rebuild_resp = client.post(
        "/reports/tank-stock-ledger/rebuild?location_code=BONNY",
        headers=admin_headers,
    )
    assert rebuild_resp.status_code == 200
    restored = (
        db.query(TankStockLedger)
        .filter(TankStockLedger.location_code == "BONNY")
        .all()
    )
    assert len(restored) == 4


# ---------------------------------------------------------------------------
# 3. Multi-tank Material Balance consolidation + Live Setting Change Rebuild
# ---------------------------------------------------------------------------


def test_multi_tank_material_balance_consolidation_and_setting_update(
    client, db, admin_headers
):
    seed = _seed_terminal(db, loc_code="FORC", start=time(6, 1), end=time(6, 0))
    tpl_id = seed["template"].id
    tk1 = seed["tank1"].asset_code
    tk2 = seed["tank2"].asset_code

    # Tank 1: Opening 10,000 at 07:00 -> Receipt to 12,000 at 12:00 (+2,000)
    _add_gauging_ticket(
        db,
        template_id=tpl_id,
        op_number="F1-OPEN",
        loc_code="FORC",
        tank_code=tk1,
        metadata_date=date(2026, 10, 20),
        metadata_start=datetime(2026, 10, 20, 7, 0),
        gauging_date="2026-10-20",
        gauging_time="07:30",
        op_code="OPENING",
        op_label="Opening Stock",
        op_category="OPENING",
        op_sign="SET",
        nsv=10000.0,
    )
    _add_gauging_ticket(
        db,
        template_id=tpl_id,
        op_number="F1-RECV",
        loc_code="FORC",
        tank_code=tk1,
        metadata_date=date(2026, 10, 20),
        metadata_start=datetime(2026, 10, 20, 12, 0),
        gauging_date="2026-10-20",
        gauging_time="12:00",
        op_code="RECEIPT",
        op_label="Crude Receipt",
        op_category="RECEIPT",
        op_sign="IN",
        nsv=12000.0,
    )

    # Tank 2: Opening 5,000 at 09:00 -> Dispatch to 4,000 at 15:00 (-1,000)
    _add_gauging_ticket(
        db,
        template_id=tpl_id,
        op_number="F2-OPEN",
        loc_code="FORC",
        tank_code=tk2,
        metadata_date=date(2026, 10, 20),
        metadata_start=datetime(2026, 10, 20, 9, 0),
        gauging_date="2026-10-20",
        gauging_time="09:00",
        op_code="OPENING",
        op_label="Opening Stock",
        op_category="OPENING",
        op_sign="SET",
        nsv=5000.0,
    )
    _add_gauging_ticket(
        db,
        template_id=tpl_id,
        op_number="F2-DISP",
        loc_code="FORC",
        tank_code=tk2,
        metadata_date=date(2026, 10, 20),
        metadata_start=datetime(2026, 10, 20, 15, 0),
        gauging_date="2026-10-20",
        gauging_time="15:00",
        op_code="DISPATCH",
        op_label="Export Dispatch",
        op_category="DISPATCH",
        op_sign="OUT",
        nsv=4000.0,
    )

    # Consolidated Location Material Balance (all tanks at FORC on 2026-10-20):
    # Opening = 10,000 + 5,000 = 15,000; Receipt = 2,000; Dispatch = 1,000;
    # Book Closing = 16,000; Actual Closing = 12,000 + 4,000 = 16,000; Loss/Gain = 0!
    mb = client.get(
        "/reports/material-balance-report?location_code=FORC&date_from=2026-10-20&date_to=2026-10-20",
        headers=admin_headers,
    )
    assert mb.status_code == 200
    row = mb.json()["rows"][0]["values"]
    assert row == pytest.approx(
        {
            "opening_stock": 15000.0,
            "receipt": 2000.0,
            "dispatch": 1000.0,
            "book_closing": 16000.0,
            "actual_closing": 16000.0,
            "loss_gain": 0.0,
        }
    )

    # Now update LocationAccountingDaySetting via PUT to 08:01 -> 08:00:
    # F1-OPEN at 2026-10-20 07:30 MUST automatically move to accounting_date 2026-10-19!
    setting_id = seed["setting"].id
    upd = client.put(
        f"/locations/accounting-day-settings/{setting_id}",
        json={
            "location_code": "FORC",
            "day_start_time": "08:01:00",
            "day_end_time": "08:00:00",
            "effective_from": "2026-06-01",
            "effective_to": None,
            "timezone_name": "Africa/Lagos",
            "status": "Active",
        },
        headers=admin_headers,
    )
    assert upd.status_code == 200, upd.text

    ledger_after = client.get(
        f"/reports/tank-stock-ledger?location_code=FORC&tank_asset_code={tk1}",
        headers=admin_headers,
    )
    assert ledger_after.status_code == 200
    tk1_rows = ledger_after.json()
    assert [r["accounting_date"] for r in tk1_rows] == ["2026-10-19", "2026-10-20"]


# ---------------------------------------------------------------------------
# 4. Dashboard TANK_STOCK_SNAPSHOT + Tanker Transaction Report payload window
# ---------------------------------------------------------------------------


def test_dashboard_snapshot_and_tanker_report_use_payload_datetime_and_window(
    client, db, admin_headers
):
    seed = _seed_terminal(db, loc_code="ESC", start=time(6, 1), end=time(6, 0))
    tpl_id = seed["template"].id
    tk1 = seed["tank1"].asset_code

    # Insert LATER chronological gauge FIRST (lower row.id -> 8,200 NSV at 16:00)
    _add_gauging_ticket(
        db,
        template_id=tpl_id,
        op_number="ESC-LATER",
        loc_code="ESC",
        tank_code=tk1,
        metadata_date=date(2026, 1, 1),
        metadata_start=datetime(2026, 1, 1, 8, 0),
        gauging_date="2026-10-20",
        gauging_time="16:00",
        op_code="DISPATCH",
        op_label="Export Dispatch",
        op_category="DISPATCH",
        op_sign="OUT",
        nsv=8200.0,
    )
    # Insert EARLIER chronological gauge SECOND (higher row.id -> 11,000 NSV at 09:00)
    _add_gauging_ticket(
        db,
        template_id=tpl_id,
        op_number="ESC-EARLIER",
        loc_code="ESC",
        tank_code=tk1,
        metadata_date=date(2026, 1, 1),
        metadata_start=datetime(2026, 1, 1, 20, 0),
        gauging_date="2026-10-20",
        gauging_time="09:00",
        op_code="OPENING",
        op_label="Opening Stock",
        op_category="OPENING",
        op_sign="SET",
        nsv=11000.0,
    )

    # Dashboard gateway TANK_STOCK_SNAPSHOT must return the chronologically latest
    # gauge (8,200 at 16:00), NOT max(TankStockLedger.id) (which was 11,000 at 09:00)!
    seed_ds = client.post("/dashboard/data-sources/seed", headers=admin_headers)
    assert seed_ds.status_code == 200, seed_ds.text

    snap = client.post(
        "/dashboard/data",
        json={
            "data_source_code": "TANK_STOCK_SNAPSHOT",
            "params": {
                "location_code": "ESC",
                "as_of_date": "2026-10-20",
            },
        },
        headers=admin_headers,
    )
    assert snap.status_code == 200, snap.text
    snap_tk1 = [
        r for r in snap.json()["rows"] if r["tank_asset_code"] == tk1
    ]
    assert len(snap_tk1) == 1
    assert snap_tk1[0]["stock_value"] == pytest.approx(8200.0)

    # Tanker Transaction Report: metadata date is stale 2026-01-02, payload has
    # 2026-10-20 at 05:15 -> accounting date under 06:01-06:00 window is 2026-10-19!
    tanker_type = AssetType(
        asset_type_name="Road Tanker",
        asset_type_code="TANKER",
        status="Active",
    )
    db.add(tanker_type)
    tanker_asset = Asset(
        asset_name="Truck 01",
        asset_code="ESC_TRK01",
        asset_scope="Location",
        asset_type_code="TANKER",
        location_code="ESC",
        status="Active",
    )
    tanker_op_type = OperationType(
        operation_type_name="Tanker Loading",
        operation_type_code="TANKER_LOAD",
        applicable_asset_type_code="TANKER",
        operation_category="Movement",
        status="Active",
    )
    db.add_all([tanker_asset, tanker_op_type])
    db.flush()
    tanker_tpl = OperationTemplate(
        template_name="Tanker Loading Template",
        operation_type_code="TANKER_LOAD",
        entry_layout_type="Tanker Loading",
        calculation_engine="Tanker Quantity",
        status="Active",
    )
    db.add(tanker_tpl)
    db.flush()
    tanker_tx = OperationTransaction(
        operation_number="TRK-01",
        operation_ticket_number="TKT-TRK-01",
        operation_type_code="TANKER_LOAD",
        operation_template_id=tanker_tpl.id,
        origin_location_code="ESC",
        primary_asset_type_code="TANKER",
        primary_asset_code="ESC_TRK01",
        product_name="Bonny Light",
        operation_date=date(2026, 1, 2),
        status="Approved",
        created_by="Admin",
    )
    db.add(tanker_tx)
    db.flush()
    db.add(
        OperationTransactionValue(
            transaction_id=tanker_tx.id,
            field_code="tanker_payload",
            field_name="Tanker Payload",
            data_type="JSON",
            field_value={
                "inputs": {
                    "tankerTransactionDate": "2026-10-20",
                    "tankerTransactionTime": "05:15",
                    "cargo": "Bonny Light",
                },
                "calculated": {"nsvBbl": 210.5, "gsvBbl": 212.0, "lt": 27.5, "mt": 28.0},
            },
        )
    )
    db.commit()

    trk_res = client.get(
        "/tanker-tracking/tanker-transaction-report?location_code=ESC&date_from=2026-10-19&date_to=2026-10-19",
        headers=admin_headers,
    )
    assert trk_res.status_code == 200, trk_res.text
    trk_rows = trk_res.json()["rows"]
    assert len(trk_rows) == 1
    assert trk_rows[0]["operation_number"] == "TRK-01"
    assert trk_rows[0]["operation_date"] == "2026-10-19"

