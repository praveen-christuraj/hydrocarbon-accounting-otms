from datetime import date

import pytest
from fastapi import HTTPException

from app.dependencies.permissions import (
    ensure_location_in_user_scope,
    ensure_operation_type_available_for_location,
)
from app.models import (
    Location,
    LocationOperationAvailability,
    OperationTransaction,
    TankStockLedger,
    UserLocation,
)
from app.routers.tank_stock_ledger import (
    get_filtered_tank_stock_ledger_rows,
    get_out_turn_report_rows,
)
from tests.conftest import create_user


@pytest.fixture
def scoped_user_with_locations(db):
    user = create_user(db, username="scope_user", password="Pass123!")
    db.add_all(
        [
            Location(location_code="AGGE", location_name="Agge", status="Active"),
            Location(location_code="LEKKI", location_name="Lekki", status="Active"),
            UserLocation(user_id=user.id, location_code="AGGE"),
        ]
    )
    db.commit()
    db.refresh(user)
    return user


def _create_transaction(db, operation_number: str, location_code: str):
    transaction = OperationTransaction(
        operation_number=operation_number,
        operation_type_code="TANK_OPS",
        primary_asset_code=f"{location_code}_TANK_01",
        primary_asset_type_code="TANK",
        origin_location_code=location_code,
        operation_date=date(2026, 8, 12),
        status="Approved",
    )
    db.add(transaction)
    db.flush()
    return transaction


def test_ensure_location_in_user_scope_blocks_unassigned_location(
    db, scoped_user_with_locations
):
    ensure_location_in_user_scope(
        scoped_user_with_locations,
        db,
        "agge",
        "Origin location",
    )

    with pytest.raises(HTTPException) as exc_info:
        ensure_location_in_user_scope(
            scoped_user_with_locations,
            db,
            "LEKKI",
            "Origin location",
        )

    assert exc_info.value.status_code == 403
    assert "assigned scope" in str(exc_info.value.detail)


def test_ensure_operation_type_available_for_location_is_case_insensitive(
    db, scoped_user_with_locations
):
    db.add(
        LocationOperationAvailability(
            location_code="AGGE",
            operation_type_code="TANK_OPS",
            status="Active",
        )
    )
    db.commit()

    ensure_operation_type_available_for_location(db, "agge", "tank_ops")

    with pytest.raises(HTTPException) as exc_info:
        ensure_operation_type_available_for_location(db, "LEKKI", "tank_ops")

    assert exc_info.value.status_code == 403
    assert "not enabled" in str(exc_info.value.detail)


def test_ledger_queries_honor_current_user_location_scope(
    db, scoped_user_with_locations
):
    tx_agge = _create_transaction(db, "OP-AGGE-001", "AGGE")
    tx_lekki = _create_transaction(db, "OP-LEKKI-001", "LEKKI")

    db.add_all(
        [
            TankStockLedger(
                transaction_id=tx_agge.id,
                ticket_number="TKT-AGGE-001",
                operation_number=tx_agge.operation_number,
                location_code="AGGE",
                tank_asset_code="AGGE_TANK_01",
                tank_asset_name="Agge Tank",
                operation_date=date(2026, 8, 12),
                accounting_date=date(2026, 8, 12),
                product_name="AGO",
                tank_operation_code="RECEIPT",
                tank_operation_label="Receipt",
                tank_operation_category="RECEIPT",
                tank_operation_sign="IN",
                running_balance_nsv_bbl=100,
                status="Active",
            ),
            TankStockLedger(
                transaction_id=tx_lekki.id,
                ticket_number="TKT-LEKKI-001",
                operation_number=tx_lekki.operation_number,
                location_code="LEKKI",
                tank_asset_code="LEKKI_TANK_01",
                tank_asset_name="Lekki Tank",
                operation_date=date(2026, 8, 12),
                accounting_date=date(2026, 8, 12),
                product_name="AGO",
                tank_operation_code="RECEIPT",
                tank_operation_label="Receipt",
                tank_operation_category="RECEIPT",
                tank_operation_sign="IN",
                running_balance_nsv_bbl=200,
                status="Active",
            ),
        ]
    )
    db.commit()

    ledger_rows = get_filtered_tank_stock_ledger_rows(
        db=db,
        current_user=scoped_user_with_locations,
    )
    out_turn_rows = get_out_turn_report_rows(
        db=db,
        current_user=scoped_user_with_locations,
    )

    assert [row.location_code for row in ledger_rows] == ["AGGE"]
    assert [row.location_code for row in out_turn_rows] == ["AGGE"]
