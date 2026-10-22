"""Regression tests for payload-first operation date/time accounting.

The Operation Date / Start / End metadata inputs were removed from
Operation Entry. A ticket's operation date and time are the values entered
inside its operation type payload, and every calculation/report must:

  * resolve the operation moment from the payload, never preferring the
    legacy metadata (``operation_start_datetime`` / metadata
    ``operation_date``) of tickets recorded before the removal;
  * apply the respective location's Location Accounting Day Setting to
    that payload moment to get the accounting date;
  * order chronologically by the payload date *and time*.
"""

from copy import deepcopy
from datetime import date, datetime, time
from types import SimpleNamespace

from app.models import (
    LocationAccountingDaySetting,
    OperationTemplate,
    OperationTransaction,
    OperationTransactionValue,
    OperationType,
    TankStockLedger,
    User,
)
from app.services.operation_datetime import (
    get_payload_operation_parts,
    operation_parts_from_values,
)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _setting(db, location_code="AGGE", start=time(6, 1), end=time(6, 0)):
    setting = LocationAccountingDaySetting(
        location_code=location_code,
        day_start_time=start,
        day_end_time=end,
        effective_from=date(2026, 1, 1),
        effective_to=None,
        timezone_name="Africa/Lagos",
        status="Active",
    )
    db.add(setting)
    db.flush()
    return setting


def _user(db):
    user = User(
        username="payload-date-user",
        full_name="Payload Date User",
        email="payload-date@test.com",
        password_hash="x",
        status="Active",
    )
    db.add(user)
    db.flush()
    return user


def _template(db, layout="Tank Gauging"):
    db.add(
        OperationType(
            operation_type_name="Tank Operations",
            operation_type_code="TANK_OPS",
            applicable_asset_type_code="Tank",
            operation_category="Stock",
            status="Active",
        )
    )
    template = OperationTemplate(
        template_name="Tank Gauging Template",
        operation_type_code="TANK_OPS",
        entry_layout_type=layout,
        calculation_engine="Tank Quantity",
        status="Active",
    )
    db.add(template)
    db.flush()
    return template


def _gauging_payload(gauging_date, gauging_time, nsv=990.0, gsv=1000.0):
    return {
        "inputs": {
            "tankOperationCode": "RECEIPT",
            "tankOperationLabel": "Receipt",
            "tankOperationCategory": "Receipt",
            "tankOperationSign": "IN",
            "gaugingDate": gauging_date,
            "gaugingTime": gauging_time,
        },
        "calculated": {"gsvBbl": gsv, "nsvBbl": nsv, "lt": 130.0, "mt": 132.0},
    }


def _gauging_tx(
    db,
    template,
    *,
    number,
    metadata_date,
    gauging_date,
    gauging_time,
    nsv=990.0,
    gsv=1000.0,
    metadata_start=None,
    location_code="AGGE",
    asset_code="AGGE_TANK_01",
):
    transaction = OperationTransaction(
        operation_number=number,
        operation_type_code="TANK_OPS",
        operation_template_id=template.id,
        primary_asset_code=asset_code,
        primary_asset_type_code="TANK",
        origin_location_code=location_code,
        product_name="Crude",
        operation_date=metadata_date,
        operation_start_datetime=metadata_start,
        status="Approved",
    )
    db.add(transaction)
    db.flush()
    db.add(
        OperationTransactionValue(
            transaction_id=transaction.id,
            field_code="tank_gauging_payload",
            field_name="Tank Gauging Payload",
            data_type="JSON",
            input_mode="System",
            calculation_role="Payload",
            field_value=_gauging_payload(gauging_date, gauging_time, nsv, gsv),
        )
    )
    db.flush()
    return transaction


# --------------------------------------------------------------------------
# 1. Payload extraction per layout
# --------------------------------------------------------------------------


def test_payload_parts_per_layout():
    assert get_payload_operation_parts(
        {"inputs": {"gaugingDate": "2026-10-21", "gaugingTime": "02:00"}},
        "tank_gauging_payload",
    ) == (date(2026, 10, 21), time(2, 0))

    assert get_payload_operation_parts(
        {
            "inputs": {
                "tankerTransactionDate": "2026-10-21",
                "tankerTransactionTime": "03:15",
            }
        },
        "tanker_payload",
    ) == (date(2026, 10, 21), time(3, 15))

    # Multi-tank resolves to the BEFORE gauging first, matching the
    # frontend operation-date resolver.
    assert get_payload_operation_parts(
        {
            "inputs": {
                "before": {"date": "2026-10-20", "time": "23:30"},
                "after": {"date": "2026-10-21", "time": "01:15"},
            }
        },
        "multi_tank_payload",
    ) == (date(2026, 10, 20), time(23, 30))

    assert get_payload_operation_parts(
        {"inputs": {"reading_date": "2026-10-21", "event_time": "04:45"}},
        "flowmeter_payload",
    ) == (date(2026, 10, 21), time(4, 45))

    assert get_payload_operation_parts(
        {"inputs": {"operation_date": "2026-10-21", "event_time": "05:30"}},
        "fso_payload",
    ) == (date(2026, 10, 21), time(5, 30))

    # A date without a time still resolves the date (time stays None so
    # accounting logic can apply the "no time entered" rule).
    assert get_payload_operation_parts(
        {"inputs": {"operation_date": "2026-10-21"}}, "shuttle_payload"
    ) == (date(2026, 10, 21), None)

    # Values-level resolution honours payload priority.
    parts = operation_parts_from_values(
        [
            {
                "field_code": "tank_gauging_payload",
                "field_value": {
                    "inputs": {"gaugingDate": "2026-10-21", "gaugingTime": "02:00"}
                },
            }
        ]
    )
    assert parts == (date(2026, 10, 21), time(2, 0))


def test_accounting_datetime_prefers_payload_over_metadata_start():
    from app.routers.reports import resolve_transaction_datetime_for_accounting_day

    transaction = SimpleNamespace(
        operation_start_datetime=datetime(2026, 10, 25, 10, 0),
        operation_date=date(2026, 10, 25),
    )
    payload = {"inputs": {"gaugingDate": "2026-10-21", "gaugingTime": "02:00"}}

    assert resolve_transaction_datetime_for_accounting_day(transaction, payload) == (
        datetime(2026, 10, 21, 2, 0)
    )

    # Legacy fallback only when the payload has no complete date/time.
    assert resolve_transaction_datetime_for_accounting_day(
        transaction, {"inputs": {}}
    ) == datetime(2026, 10, 25, 10, 0)


def test_write_path_derives_operation_date_from_payload():
    from app.routers.operation_entries import apply_payload_operation_date

    entry = SimpleNamespace(
        transaction=SimpleNamespace(operation_date=date(2026, 10, 25))
    )
    apply_payload_operation_date(
        entry,
        {
            "tank_gauging_payload": {
                "inputs": {"gaugingDate": "2026-10-21", "gaugingTime": "02:00"}
            }
        },
    )
    assert entry.transaction.operation_date == date(2026, 10, 21)

    # No payload date anywhere: the submitted metadata date is kept.
    entry = SimpleNamespace(
        transaction=SimpleNamespace(operation_date=date(2026, 10, 25))
    )
    apply_payload_operation_date(entry, {"remarks": "no dates here"})
    assert entry.transaction.operation_date == date(2026, 10, 25)


# --------------------------------------------------------------------------
# 2. Tank Stock Ledger creation (material balance source)
# --------------------------------------------------------------------------


def test_ledger_creation_uses_payload_moment_and_location_setting(db):
    from app.routers.reports import (
        create_tank_stock_ledger_from_approved_transaction,
    )

    _setting(db)  # AGGE accounting day: 06:01 -> 06:00 next day
    template = _template(db)
    user = _user(db)

    # Metadata says 2026-10-25 10:00; the gauging actually happened
    # 2026-10-21 02:00 - before the 06:01 day start, so it belongs to
    # accounting date 2026-10-20.
    transaction = _gauging_tx(
        db,
        template,
        number="PAYLOAD-LEDGER-1",
        metadata_date=date(2026, 10, 25),
        metadata_start=datetime(2026, 10, 25, 10, 0),
        gauging_date="2026-10-21",
        gauging_time="02:00",
    )
    db.commit()

    ledger = create_tank_stock_ledger_from_approved_transaction(
        db, transaction, user
    )
    db.commit()

    assert ledger is not None
    assert ledger.operation_date == date(2026, 10, 21)
    assert ledger.accounting_date == date(2026, 10, 20)
    assert ledger.accounting_day_start == datetime(2026, 10, 20, 6, 1)
    assert ledger.accounting_day_end == datetime(2026, 10, 21, 6, 0)


# --------------------------------------------------------------------------
# 3. Transaction-based summaries
# --------------------------------------------------------------------------


def test_tank_operation_summary_accounting_date_from_payload(db):
    from app.routers.tank_operation_summary import (
        get_filtered_tank_operation_summary_rows,
    )

    _setting(db)
    template = _template(db)
    _gauging_tx(
        db,
        template,
        number="PAYLOAD-SUMMARY-1",
        metadata_date=date(2026, 10, 21),
        gauging_date="2026-10-21",
        gauging_time="02:00",
    )
    db.commit()

    rows, _columns, meta = get_filtered_tank_operation_summary_rows(
        db=db,
        location_code="AGGE",
        date_from="2026-10-20",
        date_to="2026-10-20",
    )

    assert meta["total_rows"] == 1
    assert len(rows) == 1
    assert rows[0]["operation_date"] == date(2026, 10, 21)
    assert rows[0]["accounting_date"] == date(2026, 10, 20)


def test_out_turn_summary_chronological_by_gauging_time(db):
    from app.routers.out_turn_summary import get_out_turn_summary_rows

    template = _template(db)
    # Entered first (lower id) but gauged later in the day.
    _gauging_tx(
        db,
        template,
        number="PAYLOAD-OT-LATE",
        metadata_date=date(2026, 10, 21),
        gauging_date="2026-10-21",
        gauging_time="14:00",
        nsv=1000.0,
        gsv=1010.0,
    )
    # Entered second (higher id) but gauged earlier in the day.
    _gauging_tx(
        db,
        template,
        number="PAYLOAD-OT-EARLY",
        metadata_date=date(2026, 10, 21),
        gauging_date="2026-10-21",
        gauging_time="08:00",
        nsv=900.0,
        gsv=910.0,
    )
    db.commit()

    rows = get_out_turn_summary_rows(
        db, location_code="AGGE", date_from="2026-10-21", date_to="2026-10-21"
    )

    assert [row["operation_number"] for row in rows] == [
        "PAYLOAD-OT-EARLY",
        "PAYLOAD-OT-LATE",
    ]
    assert rows[0]["previous_nsv"] == 0
    assert rows[1]["previous_nsv"] == 900
    assert rows[1]["signed_net_nsv"] == 100


def test_out_turn_report_from_transactions_accounting_shift(db):
    from app.routers.reports import get_out_turn_report_rows_from_transactions

    _setting(db)
    template = _template(db)
    _gauging_tx(
        db,
        template,
        number="PAYLOAD-OTR-1",
        metadata_date=date(2026, 10, 21),
        metadata_start=datetime(2026, 10, 25, 10, 0),
        gauging_date="2026-10-21",
        gauging_time="02:00",
    )
    db.commit()

    rows = get_out_turn_report_rows_from_transactions(
        db,
        location_code="AGGE",
        date_from="2026-10-20",
        date_to="2026-10-20",
    )

    assert len(rows) == 1
    assert rows[0]["accounting_date"] == date(2026, 10, 20)
    assert rows[0]["operation_datetime"] == datetime(2026, 10, 21, 2, 0)


# --------------------------------------------------------------------------
# 4. Ledger-based reports: within-day chronology
# --------------------------------------------------------------------------


def test_daily_summary_closing_uses_latest_gauging_time(db):
    from app.routers.tank_stock_ledger import build_tank_stock_daily_summary_rows

    def ledger_row(row_id, gauging_time, stock_nsv):
        return SimpleNamespace(
            id=row_id,
            location_code="AGGE",
            tank_asset_code="AGGE_TANK_01",
            tank_asset_name="Tank 01",
            product_name="Crude",
            accounting_date=date(2026, 10, 20),
            # Same window start for the whole accounting day - ordering by
            # it (the old behaviour) silently fell back to row id.
            accounting_day_start=datetime(2026, 10, 20, 6, 1),
            operation_date=date(2026, 10, 20),
            tank_operation_code="RECEIPT",
            tank_operation_category="Receipt",
            tank_operation_sign="IN",
            movement_gsv_bbl=0,
            movement_nsv_bbl=0,
            movement_lt=0,
            movement_mt=0,
            stock_gsv_bbl=stock_nsv,
            stock_nsv_bbl=stock_nsv,
            stock_lt=0,
            stock_mt=0,
            running_balance_gsv_bbl=stock_nsv,
            running_balance_nsv_bbl=stock_nsv,
            running_balance_lt=0,
            running_balance_mt=0,
            ticket_number=f"TKT-{row_id}",
            source_payload={
                "inputs": {
                    "gaugingDate": "2026-10-20",
                    "gaugingTime": gauging_time,
                }
            },
        )

    rows = build_tank_stock_daily_summary_rows(
        db=db,
        ledger_rows=[
            ledger_row(1, "16:00", 1000.0),  # lower id, later gauging
            ledger_row(2, "08:00", 900.0),  # higher id, earlier gauging
        ],
        date_from_value=date(2026, 10, 20),
        date_to_value=date(2026, 10, 20),
    )

    assert len(rows) == 1
    assert rows[0]["actual_closing_nsv_bbl"] == 1000.0
    assert rows[0]["last_ticket_number"] == "TKT-1"


# --------------------------------------------------------------------------
# 5. FSO reports
# --------------------------------------------------------------------------


def test_fso_report_uses_payload_operation_date(db):
    from app.routers.reports import build_fso_otr_report

    _setting(db)

    transaction = OperationTransaction(
        operation_number="PAYLOAD-FSO-1",
        operation_type_code="FSO_LOAD",
        primary_asset_code="FSO_01",
        primary_asset_type_code="FSO",
        convoy_number="SH-1",
        origin_location_code="AGGE",
        # Metadata date would account this on 2026-10-19 (02:00 < 06:01);
        # the payload date accounts it on 2026-10-20.
        operation_date=date(2026, 10, 20),
        status="Approved",
    )
    db.add(transaction)
    db.flush()
    db.add(
        OperationTransactionValue(
            transaction_id=transaction.id,
            field_code="fso_payload",
            field_name="fso_payload",
            data_type="JSON",
            input_mode="System",
            field_value={
                "meta": {"operation_label": "Receipt", "operation_sign": "IN"},
                "inputs": {
                    "operation_date": "2026-10-21",
                    "event_time": "02:00",
                    "opening_stock_bbl": 100.0,
                    "opening_water_bbl": 0.0,
                    "closing_stock_bbl": 150.0,
                    "closing_water_bbl": 0.0,
                    "vessel_quantity_bbl": 50.0,
                },
                "calculated": {"net": {"net_stock_bbl": 50.0, "net_water_bbl": 0.0}},
            },
        )
    )
    db.commit()

    rows, _totals = build_fso_otr_report(
        db, "AGGE", "FSO_01", date(2026, 10, 20), date(2026, 10, 20)
    )

    assert len(rows) == 1
    assert rows[0]["operation_date"] == date(2026, 10, 21)
    assert rows[0]["accounting_date"] == date(2026, 10, 20)


# --------------------------------------------------------------------------
# 6. Start-up backfill for previous entries
# --------------------------------------------------------------------------


def test_backfill_aligns_transaction_and_ledger_dates(db):
    from app.utils.db_migrations import ensure_payload_operation_dates

    _setting(db)
    template = _template(db)
    transaction = _gauging_tx(
        db,
        template,
        number="PAYLOAD-BACKFILL-1",
        metadata_date=date(2026, 10, 25),
        metadata_start=datetime(2026, 10, 25, 10, 0),
        gauging_date="2026-10-21",
        gauging_time="02:00",
    )

    payload = _gauging_payload("2026-10-21", "02:00")
    ledger = TankStockLedger(
        transaction_id=transaction.id,
        ticket_number="TKT-BACKFILL-1",
        operation_number="PAYLOAD-BACKFILL-1",
        location_code="AGGE",
        tank_asset_code="AGGE_TANK_01",
        tank_asset_name="Tank 01",
        operation_date=date(2026, 10, 25),
        accounting_date=date(2026, 10, 25),
        accounting_day_start=datetime(2026, 10, 25, 6, 1),
        accounting_day_end=datetime(2026, 10, 26, 6, 0),
        tank_operation_code="RECEIPT",
        tank_operation_label="Receipt",
        tank_operation_category="Receipt",
        tank_operation_sign="SET",
        stock_gsv_bbl=1000.0,
        stock_nsv_bbl=990.0,
        stock_lt=130.0,
        stock_mt=132.0,
        running_balance_gsv_bbl=1000.0,
        running_balance_nsv_bbl=990.0,
        running_balance_lt=130.0,
        running_balance_mt=132.0,
        source_payload=deepcopy(payload),
        status="Active",
    )
    db.add(ledger)
    db.commit()

    ensure_payload_operation_dates()
    # Idempotent: a second run must leave exactly the same values.
    ensure_payload_operation_dates()

    db.expire_all()
    refreshed_tx = db.query(OperationTransaction).filter_by(
        operation_number="PAYLOAD-BACKFILL-1"
    ).one()
    refreshed_ledger = db.query(TankStockLedger).filter_by(
        operation_number="PAYLOAD-BACKFILL-1"
    ).one()

    assert refreshed_tx.operation_date == date(2026, 10, 21)
    assert refreshed_ledger.operation_date == date(2026, 10, 21)
    assert refreshed_ledger.accounting_date == date(2026, 10, 20)
    assert refreshed_ledger.accounting_day_start == datetime(2026, 10, 20, 6, 1)
    assert refreshed_ledger.accounting_day_end == datetime(2026, 10, 21, 6, 0)
    assert refreshed_ledger.accounting_day_setting_id is not None
