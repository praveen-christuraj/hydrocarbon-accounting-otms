"""
Regression tests for the FSO / Shuttle payload operation date.

The Operation Date input was removed from the Operation Entry metadata section;
each asset-specific payload now carries its own date (tank gauging date,
tanker transaction date, multi-tank before/after dates). The FSO and Shuttle
payloads used to store only ``event_time``.

These tests lock down the database side of the change:

  * a legacy FSO / Shuttle payload without ``inputs.operation_date`` is
    completed from the ticket's own ``operation_transactions.operation_date``;
  * a payload that already has a date is never overwritten;
  * payloads of other layouts (tank, tanker, ...) are not touched;
  * the backfill is idempotent and leaves the ticket date unchanged.
"""

from datetime import date

from app.models import OperationTransaction, OperationTransactionValue


def _add_transaction(db, *, number, operation_date, convoy="SH-DATE-1"):
    transaction = OperationTransaction(
        operation_number=number,
        operation_type_code="FSO_LOAD",
        primary_asset_code="FSO_01",
        primary_asset_type_code="FSO",
        convoy_number=convoy,
        origin_location_code="AGGE",
        operation_date=operation_date,
        status="Approved",
    )
    db.add(transaction)
    db.flush()
    return transaction


def _add_payload(db, transaction, field_code, payload):
    db.add(
        OperationTransactionValue(
            transaction_id=transaction.id,
            field_code=field_code,
            field_name=field_code,
            field_group="System",
            data_type="JSON",
            field_value=payload,
        )
    )


def _payload_of(db, transaction_id, field_code):
    db.expire_all()
    row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction_id,
            OperationTransactionValue.field_code == field_code,
        )
        .first()
    )
    return row.field_value


def test_backfill_adds_missing_payload_operation_date(db):
    from app.utils.db_migrations import ensure_fso_shuttle_payload_operation_date

    fso_without_date = _add_transaction(
        db, number="FSO-DATE-1", operation_date=date(2026, 10, 5)
    )
    _add_payload(
        db,
        fso_without_date,
        "fso_payload",
        {
            "meta": {"schema": "fso_payload_v2", "operation_code": "FSO_RECEIPT"},
            "inputs": {
                "event_time": "08:30",
                "opening_stock_bbl": 100.0,
                "closing_stock_bbl": 150.0,
            },
            "calculated": {"net": {"net_stock_bbl": 50.0}},
        },
    )

    shuttle_with_date = _add_transaction(
        db, number="FSO-DATE-2", operation_date=date(2026, 10, 6), convoy="SH-DATE-2"
    )
    _add_payload(
        db,
        shuttle_with_date,
        "shuttle_payload",
        {
            "meta": {"schema": "shuttle_payload_v2"},
            "inputs": {"operation_date": "2026-09-30", "event_time": "10:15"},
            "calculated": {"net": {"net_stock_bbl": 10.0}},
        },
    )

    shuttle_without_date = _add_transaction(
        db, number="FSO-DATE-3", operation_date=date(2026, 10, 7), convoy="SH-DATE-3"
    )
    _add_payload(
        db,
        shuttle_without_date,
        "shuttle_payload",
        {
            "meta": {"schema": "shuttle_payload_v2"},
            "inputs": {"event_time": "11:45"},
        },
    )

    # A tank payload must not be completed by this migration.
    tank_transaction = _add_transaction(
        db, number="FSO-DATE-4", operation_date=date(2026, 10, 8), convoy="SH-DATE-4"
    )
    _add_payload(
        db,
        tank_transaction,
        "tank_gauging_payload",
        {"inputs": {"gaugingDate": "2026-10-08"}},
    )

    db.commit()

    ensure_fso_shuttle_payload_operation_date()

    fso_payload = _payload_of(db, fso_without_date.id, "fso_payload")
    assert fso_payload["inputs"]["operation_date"] == "2026-10-05"
    # Nothing else in the payload changes.
    assert fso_payload["inputs"]["event_time"] == "08:30"
    assert fso_payload["inputs"]["closing_stock_bbl"] == 150.0
    assert fso_payload["meta"]["operation_code"] == "FSO_RECEIPT"
    assert fso_payload["calculated"]["net"]["net_stock_bbl"] == 50.0

    existing_date_payload = _payload_of(db, shuttle_with_date.id, "shuttle_payload")
    assert existing_date_payload["inputs"]["operation_date"] == "2026-09-30"

    completed_shuttle = _payload_of(db, shuttle_without_date.id, "shuttle_payload")
    assert completed_shuttle["inputs"]["operation_date"] == "2026-10-07"
    assert completed_shuttle["inputs"]["event_time"] == "11:45"

    tank_payload = _payload_of(db, tank_transaction.id, "tank_gauging_payload")
    assert "operation_date" not in tank_payload["inputs"]

    # The ticket date is authoritative and must not change.
    db.expire_all()
    ticket_dates = {
        row.operation_number: row.operation_date
        for row in db.query(OperationTransaction)
        .filter(OperationTransaction.operation_number.like("FSO-DATE-%"))
        .all()
    }
    assert ticket_dates == {
        "FSO-DATE-1": date(2026, 10, 5),
        "FSO-DATE-2": date(2026, 10, 6),
        "FSO-DATE-3": date(2026, 10, 7),
        "FSO-DATE-4": date(2026, 10, 8),
    }

    # Idempotent: a second start-up run changes nothing.
    ensure_fso_shuttle_payload_operation_date()

    assert _payload_of(db, fso_without_date.id, "fso_payload") == fso_payload
    assert (
        _payload_of(db, shuttle_with_date.id, "shuttle_payload")
        == existing_date_payload
    )


def test_backfill_skips_payloads_without_inputs_object(db):
    from app.utils.db_migrations import ensure_fso_shuttle_payload_operation_date

    transaction = _add_transaction(
        db, number="FSO-DATE-EMPTY", operation_date=date(2026, 10, 9)
    )

    # Blank payload field (never filled in) - stored as an empty value.
    _add_payload(db, transaction, "fso_payload", None)

    # Unexpected payload shape - must be left exactly as it is.
    corrupt = _add_transaction(
        db, number="FSO-DATE-CORRUPT", operation_date=date(2026, 10, 10), convoy="SH-X"
    )
    db.add(
        OperationTransactionValue(
            transaction_id=corrupt.id,
            field_code="shuttle_payload",
            field_name="shuttle_payload",
            field_group="System",
            data_type="JSON",
            field_value="not-a-json-object",
        )
    )

    db.commit()

    ensure_fso_shuttle_payload_operation_date()

    assert _payload_of(db, transaction.id, "fso_payload") is None
    assert _payload_of(db, corrupt.id, "shuttle_payload") == "not-a-json-object"
