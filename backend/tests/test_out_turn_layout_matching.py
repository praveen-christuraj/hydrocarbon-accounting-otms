"""
Regression tests for Out Turn Summary / Out Turn Report / Material Balance
visibility of approved Tank Gauging transactions.

Entry layout types are stored verbatim on the Operation Template, so a template
saved as "tank gauging" or " Tank Gauging " must be treated exactly like
"Tank Gauging". Previously these reports used exact, case sensitive matching
(plus an OperationType.applicable_asset_type_code == "TANK" join), so approved
transactions that showed up correctly on Tank Operation Summary were silently
dropped from Out Turn Summary, Out Turn Report and Material Balance.
"""

from datetime import date

import pytest
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles


# The models use PostgreSQL JSONB columns; the test suite runs on SQLite, which
# has no JSONB type. Render it as JSON so the schema can be created.
@compiles(JSONB, "sqlite")
def _compile_jsonb_on_sqlite(type_, compiler, **kw):  # pragma: no cover - glue
    return "JSON"


from app.models import (  # noqa: E402
    OperationTemplate,
    OperationTransaction,
    OperationTransactionValue,
    OperationType,
)
from app.routers.operation_transactions import (  # noqa: E402
    create_tank_stock_ledger_from_approved_transaction,
)
from app.routers.out_turn_summary import _get_transaction_query  # noqa: E402
from app.routers.reports import (  # noqa: E402
    get_out_turn_report_rows_from_transactions,
    is_tank_gauging_transaction,
)
from app.utils.helpers import normalize_entry_layout_type  # noqa: E402


TANK_GAUGING_PAYLOAD = {
    "inputs": {
        "tankOperationCode": "RECEIPT",
        "tankOperationLabel": "Receipt",
        "tankOperationCategory": "Receipt",
        "tankOperationSign": "IN",
        "gaugingDate": "2026-08-12",
        "gaugingTime": "08:30",
    },
    "calculated": {
        "gsvBbl": 1000.0,
        "nsvBbl": 990.0,
        "lt": 130.0,
        "mt": 132.0,
    },
}


def _seed_tank_gauging_transaction(
    db,
    entry_layout_type: str,
    applicable_asset_type_code: str = "Tank",
    template_name: str = "Tank Gauging Template",
    operation_type_code: str = "TANK_OPS",
    operation_number: str = "OP-0001",
):
    db.add(
        OperationType(
            operation_type_name="Tank Operations",
            operation_type_code=operation_type_code,
            applicable_asset_type_code=applicable_asset_type_code,
            operation_category="Stock",
            status="Active",
        )
    )

    template = OperationTemplate(
        template_name=template_name,
        operation_type_code=operation_type_code,
        entry_layout_type=entry_layout_type,
        calculation_engine="Tank Quantity",
        status="Active",
    )
    db.add(template)
    db.flush()

    transaction = OperationTransaction(
        operation_number=operation_number,
        operation_type_code=operation_type_code,
        operation_template_id=template.id,
        primary_asset_code="AGGE_TANK_01",
        primary_asset_type_code="TANK",
        origin_location_code="AGGE",
        product_name="Crude",
        operation_date=date(2026, 8, 12),
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
            field_value=TANK_GAUGING_PAYLOAD,
        )
    )
    db.flush()

    return template, transaction


@pytest.mark.parametrize(
    "raw_value,expected",
    [
        ("Tank Gauging", "tank gauging"),
        ("tank gauging", "tank gauging"),
        ("  TANK GAUGING  ", "tank gauging"),
        ("Tank  Gauging", "tank gauging"),
        (None, ""),
        ("Multi-Tank Before/After", "multi-tank before/after"),
    ],
)
def test_normalize_entry_layout_type(raw_value, expected):
    assert normalize_entry_layout_type(raw_value) == expected


@pytest.mark.parametrize(
    "entry_layout_type",
    ["Tank Gauging", "tank gauging", "  Tank Gauging  ", "TANK GAUGING"],
)
def test_out_turn_summary_query_matches_layout_case_insensitively(
    db, entry_layout_type
):
    _, transaction = _seed_tank_gauging_transaction(db, entry_layout_type)

    rows = _get_transaction_query(db).all()

    assert [row.id for row in rows] == [transaction.id]


@pytest.mark.parametrize(
    "applicable_asset_type_code",
    ["TANK", "Tank", "tank", "STORAGE_TANK"],
)
def test_out_turn_summary_query_ignores_asset_type_code_spelling(
    db, applicable_asset_type_code
):
    _, transaction = _seed_tank_gauging_transaction(
        db,
        entry_layout_type="Tank Gauging",
        applicable_asset_type_code=applicable_asset_type_code,
    )

    rows = _get_transaction_query(db).all()

    assert [row.id for row in rows] == [transaction.id]


@pytest.mark.parametrize(
    "entry_layout_type",
    ["Tank Gauging", "tank gauging", "  Tank Gauging  "],
)
def test_out_turn_report_rows_include_approved_tank_gauging(db, entry_layout_type):
    _, transaction = _seed_tank_gauging_transaction(
        db,
        entry_layout_type=entry_layout_type,
        applicable_asset_type_code="Tank",
    )

    rows = get_out_turn_report_rows_from_transactions(db)

    assert len(rows) == 1
    assert rows[0]["transaction_id"] == transaction.id
    assert rows[0]["stock_after_nsv"] == pytest.approx(990.0)
    assert rows[0]["stock_after_gsv"] == pytest.approx(1000.0)
    assert rows[0]["tank_operation_code"] == "RECEIPT"


@pytest.mark.parametrize(
    "entry_layout_type",
    ["Tank Gauging", "tank gauging", "  Tank Gauging  "],
)
def test_is_tank_gauging_transaction_is_case_insensitive(db, entry_layout_type):
    _, transaction = _seed_tank_gauging_transaction(db, entry_layout_type)

    assert is_tank_gauging_transaction(db, transaction) is True


@pytest.mark.parametrize(
    "entry_layout_type",
    ["Tank Gauging", "tank gauging", "  Tank Gauging  "],
)
def test_ledger_dispatcher_creates_tank_stock_ledger_row(
    db, entry_layout_type, monkeypatch
):
    """The Material Balance report reads TankStockLedger, so the approval-time
    dispatcher must recognise the layout regardless of casing/whitespace."""
    _, transaction = _seed_tank_gauging_transaction(db, entry_layout_type)

    called = {}

    def _fake_create_gauging_ledger(db, transaction, current_user):
        called["transaction_id"] = transaction.id
        return object()

    monkeypatch.setattr(
        "app.routers.reports.create_tank_stock_ledger_from_approved_transaction",
        _fake_create_gauging_ledger,
    )

    entries, location_code, _ = create_tank_stock_ledger_from_approved_transaction(
        db=db,
        transaction=transaction,
        current_user=None,
    )

    assert called.get("transaction_id") == transaction.id
    assert entries is not None
    assert location_code == "AGGE"


def test_non_tank_layouts_do_not_write_tank_stock_ledger(db):
    """Barge / vessel layouts stay on VesselStockLedger - unchanged behaviour."""
    _, transaction = _seed_tank_gauging_transaction(
        db,
        entry_layout_type="Multi-Tank Before/After",
        template_name="Barge Template",
        operation_type_code="BARGE_OPS",
    )

    entries, location_code, extra = create_tank_stock_ledger_from_approved_transaction(
        db=db,
        transaction=transaction,
        current_user=None,
    )

    assert (entries, location_code, extra) == (None, None, None)
