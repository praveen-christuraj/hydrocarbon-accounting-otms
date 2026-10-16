"""
Tanker Tracking follows Tracking Module Configuration: when the TANKER module is
configured, only approved tickets of the configured operation types are tracked.
"""

from datetime import date

from app.models import (
    AssetType,
    Location,
    OperationTransaction,
    OperationType,
)
from tests.test_barge_end_to_end_approval import _make_user

CONFIG_PERMS = [
    "Create Tracking Module Configuration",
    "View Tracking Module Configuration",
]
TANKER_VIEW_PERMS = ["View Tanker Tracking"]


def _ticket(db, number, op_code):
    db.add(
        OperationTransaction(
            operation_number=number,
            operation_type_code=op_code,
            primary_asset_code="TRK_01",
            primary_asset_type_code="TANKER",
            origin_location_code="AGGE",
            destination_location_code="UTP",
            convoy_number="CNV-TNK-1",
            operation_date=date(2026, 10, 10),
            product_name="Gasoil",
            status="Approved",
        )
    )


def _seed(db):
    db.add_all([
        Location(location_code="AGGE", location_name="Agge", location_type="Terminal", status="Active"),
        Location(location_code="UTP", location_name="Utapate", location_type="Terminal", status="Active"),
        AssetType(asset_type_code="TANKER", asset_type_name="Tanker", status="Active"),
    ])
    db.flush()
    db.add_all([
        OperationType(
            operation_type_code="TANKER_LOAD",
            operation_type_name="Tanker Loading",
            applicable_asset_type_code="TANKER",
            operation_category="Movement",
            requires_sender_location="No",
            requires_receiver_location="No",
            status="Active",
        ),
        OperationType(
            operation_type_code="TANKER_OTHER",
            operation_type_name="Tanker Other",
            applicable_asset_type_code="TANKER",
            operation_category="Movement",
            requires_sender_location="No",
            requires_receiver_location="No",
            status="Active",
        ),
    ])
    db.flush()
    _ticket(db, "OPN-TNK-LOAD-1", "TANKER_LOAD")
    _ticket(db, "OPN-TNK-OTHER-1", "TANKER_OTHER")
    db.commit()


def test_tanker_tracking_lists_only_configured_operation_types(client, db):
    _seed(db)
    admin_headers, _ = _make_user(
        db, client, "tnk_admin", CONFIG_PERMS + TANKER_VIEW_PERMS, all_locations=True
    )

    # no configuration yet: legacy rule, both tanker tickets are visible
    legacy = client.get("/tanker-tracking", headers=admin_headers)
    assert legacy.status_code == 200, legacy.text
    assert "OPN-TNK-LOAD-1" in legacy.text
    assert "OPN-TNK-OTHER-1" in legacy.text

    config = client.post(
        "/tracking-module-configs",
        json={
            "module_code": "TANKER",
            "operation_type_code": "TANKER_LOAD",
            "movement_role": "SENDER",
            "status": "Active",
        },
        headers=admin_headers,
    )
    assert config.status_code == 200, config.text

    configured = client.get("/tanker-tracking", headers=admin_headers)
    assert configured.status_code == 200, configured.text
    assert "OPN-TNK-LOAD-1" in configured.text
    assert "OPN-TNK-OTHER-1" not in configured.text
