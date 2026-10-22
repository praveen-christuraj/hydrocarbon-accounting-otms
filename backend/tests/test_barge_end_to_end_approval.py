"""
End-to-end regression test for the real Barge Tracking flow reported broken
by the product owner ("approved barge transactions are not getting listed in
the barge tracking page"):

  1. Seed master data (locations, barge asset type/asset, operation type,
     Multi-Tank template with multi_tank_payload + barge_event_type fields).
  2. Location-scoped operator creates a barge LOAD ticket via
     POST /operation-entries (exactly what the Operation Entry page sends).
  3. Operator submits it (PATCH /status -> Submitted, review_confirmed).
  4. Approver approves it (PATCH /status -> Approved, review_confirmed).
  5. GET /barge-trip/voyages - the convoy MUST appear under OPEN voyages,
     for the sending side AND for a receiver scoped only to the destination
     terminal.
"""

from datetime import date

from app.models import (
    Asset,
    AssetType,
    Location,
    LocationOperationAvailability,
    OperationTemplate,
    OperationTemplateField,
    OperationTransaction,
    OperationType,
    Permission,
    Role,
    RolePermission,
    User,
    UserLocation,
    UserRole,
)
from tests.conftest import create_user

PASSWORD = "StrongPass123!"

MULTI_TANK_PAYLOAD = {
    "meta": {"assetCode": "BARGE_01", "tankIds": ["T1"]},
    "inputs": {
        "before": {
            "tankTemp": "28",
            "sampleTemp": "27",
            "bswPct": "0.5",
            "obsMode": "Observed Density",
            "obsDensity": "0.85",
            "dips": {"T1": {"total": "100", "water": "5"}},
        },
        "after": {
            "tankTemp": "28",
            "sampleTemp": "27",
            "bswPct": "0.5",
            "obsMode": "Observed Density",
            "obsDensity": "0.85",
            "dips": {"T1": {"total": "300", "water": "5"}},
        },
    },
    "seals": {
        "after": {
            "temporary": {
                "portManifoldSeal": "PM-001",
                "stbdManifoldSeal": "SM-001",
                "pumproomSeal": "PR-001",
            },
            "tankSeals": {},
        }
    },
}


def _make_user(db, client, username, permissions, all_locations=True, locations=None):
    role = Role(role_name=f"{username}_role", status="Active")
    db.add(role)
    db.flush()

    for permission_name in permissions:
        permission = (
            db.query(Permission)
            .filter(Permission.permission_name == permission_name)
            .first()
        )
        if permission is None:
            permission = Permission(
                permission_name=permission_name,
                module_name="Test",
                status="Active",
            )
            db.add(permission)
            db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=permission.id))

    user = create_user(db, username, PASSWORD, roles=[role])
    user.all_locations_access = "Yes" if all_locations else "No"
    if locations:
        for code in locations:
            db.add(UserLocation(user_id=user.id, location_code=code))
    db.commit()

    login = client.post("/auth/login", json={"username": username, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}, user


def _seed_master_data(db):
    db.add_all(
        [
            Location(location_code="AGGE", location_name="Agge", location_type="Terminal", status="Active"),
            Location(location_code="UTP", location_name="Utapate", location_type="Terminal", status="Active"),
            AssetType(asset_type_code="BARGE", asset_type_name="Barge", status="Active"),
        ]
    )
    db.flush()

    db.add(
        Asset(
            asset_code="BARGE_01",
            asset_name="Barge One",
            asset_type_code="BARGE",
            asset_scope="Global",
            status="Active",
        )
    )
    db.flush()

    db.add(
        OperationType(
            operation_type_code="BARGE_LOAD",
            operation_type_name="Barge Loading",
            applicable_asset_type_code="BARGE",
            operation_category="Movement",
            requires_sender_location="No",
            requires_receiver_location="No",
            status="Active",
        )
    )
    db.flush()

    db.add_all(
        [
            LocationOperationAvailability(
                location_code="AGGE", operation_type_code="BARGE_LOAD", status="Active"
            ),
            LocationOperationAvailability(
                location_code="UTP", operation_type_code="BARGE_LOAD", status="Active"
            ),
        ]
    )

    template = OperationTemplate(
        template_name="Barge Multi-Tank",
        operation_type_code="BARGE_LOAD",
        entry_layout_type="Multi-Tank Before/After",
        calculation_engine="Multi-Tank Quantity",
        status="Active",
    )
    db.add(template)
    db.flush()

    db.add_all(
        [
            OperationTemplateField(
                template_id=template.id,
                field_name="Multi Tank Payload",
                field_code="multi_tank_payload",
                field_group="Barge",
                data_type="JSON",
                input_mode="Manual",
                calculation_role="Input",
                is_required="No",
                sort_order=1,
                status="Active",
            ),
            OperationTemplateField(
                template_id=template.id,
                field_name="Barge Movement Stage",
                field_code="barge_event_type",
                field_group="Barge Tracking",
                data_type="Text",
                input_mode="Manual",
                calculation_role="Input",
                is_required="No",
                sort_order=2,
                status="Active",
            ),
        ]
    )
    db.commit()
    return template


def test_barge_e2e_entry_submit_approve_lists_open_voyage(client, db):
    template = _seed_master_data(db)

    operator_headers, operator = _make_user(
        db,
        client,
        "brg_operator",
        [
            "Create Operation Entry",
            "Submit Operation Transaction",
            "Review Operation Transaction",
            "View Operation Transaction",
            "View Barge Tracking",
        ],
        all_locations=False,
        locations=["AGGE", "UTP"],
    )

    approver_headers, approver = _make_user(
        db,
        client,
        "brg_approver",
        [
            "Approve Operation Transaction",
            "Review Operation Transaction",
            "View Operation Transaction",
            "View Barge Tracking",
        ],
        all_locations=True,
    )

    # --- exactly the payload the Operation Entry page sends -----------------
    entry_payload = {
        "operation_template_id": template.id,
        "transaction": {
            "operation_type_code": "BARGE_LOAD",
            "primary_asset_code": "BARGE_01",
            "convoy_number": "CNV-E2E-001",
            "origin_location_code": "AGGE",
            "destination_location_code": "UTP",
            "sender_location_code": None,
            "receiver_location_code": None,
            "operation_date": "2026-10-10",
            "operation_start_datetime": None,
            "operation_end_datetime": None,
            "product_name": "Crude Oil",
            "created_by": None,
            "remarks": None,
            "status": "Draft",
        },
        "values": [
            {"field_code": "multi_tank_payload", "field_value": MULTI_TANK_PAYLOAD},
            {"field_code": "barge_event_type", "field_value": "LOAD_1"},
        ],
    }

    created = client.post("/operation-entries", json=entry_payload, headers=operator_headers)
    assert created.status_code == 200, created.text
    tx_id = created.json()["transaction"]["id"]

    # --- submit --------------------------------------------------------------
    submitted = client.patch(
        f"/operation-transactions/{tx_id}/status",
        json={"status": "Submitted", "remarks": "ready", "review_confirmed": True},
        headers=operator_headers,
    )
    assert submitted.status_code == 200, submitted.text

    # --- approve -------------------------------------------------------------
    approved = client.patch(
        f"/operation-transactions/{tx_id}/status",
        json={"status": "Approved", "remarks": "ok", "review_confirmed": True},
        headers=approver_headers,
    )
    assert approved.status_code == 200, approved.text

    # --- barge voyages: must now appear under OPEN ---------------------------
    voyages = client.get("/barge-trip/voyages?tab=OPEN", headers=operator_headers)
    assert voyages.status_code == 200, voyages.text
    data = voyages.json()
    convoys = [row["convoy_number"] for row in data["rows"]]
    print("\nOPEN VOYAGES (operator, scoped to AGGE):", convoys, "counts:", data["open_count"], data["closed_count"])
    assert "CNV-E2E-001" in convoys, f"Convoy missing from OPEN voyages: {convoys}"

    voyages_admin = client.get("/barge-trip/voyages?tab=OPEN", headers=approver_headers)
    data_admin = voyages_admin.json()
    convoys_admin = [row["convoy_number"] for row in data_admin["rows"]]
    print("OPEN VOYAGES (approver, all locations):", convoys_admin)
    assert "CNV-E2E-001" in convoys_admin

    # A receiver scoped ONLY to the destination terminal must see the voyage
    # as soon as the load ticket is approved (destination UTP is in scope).
    receiver_headers, _ = _make_user(
        db,
        client,
        "utp_receiver",
        ["View Barge Tracking"],
        all_locations=False,
        locations=["UTP"],
    )
    receiver_voyages = client.get(
        "/barge-trip/voyages?tab=OPEN", headers=receiver_headers
    )
    assert receiver_voyages.status_code == 200, receiver_voyages.text
    receiver_convoys = [
        row["convoy_number"] for row in receiver_voyages.json()["rows"]
    ]
    print("OPEN VOYAGES (receiver, scoped to UTP):", receiver_convoys)
    assert "CNV-E2E-001" in receiver_convoys

    # ... and the receiver must be able to open the convoy tracker + timeline.
    tracker = client.get(
        "/barge-trip/convoy-tracker?convoy_number=CNV-E2E-001",
        headers=receiver_headers,
    )
    assert tracker.status_code == 200, tracker.text
    assert tracker.json()["total_tickets"] == 1

    # --- timeline by convoy ---------------------------------------------------
    timeline = client.get("/barge-trip/trips/by-convoy/CNV-E2E-001", headers=operator_headers)
    assert timeline.status_code == 200, timeline.text
    print("TIMELINE:", timeline.json()["trip"]["status"], [e["event_type"] for e in timeline.json()["events"]])


def test_receiver_scope_can_come_from_related_ticket_in_same_barge_movement(client, db):
    _seed_master_data(db)
    sender = OperationTransaction(
        operation_number="OP-BARGE-SENDER-LEGACY",
        operation_ticket_number="TKT-BARGE-SENDER-LEGACY",
        operation_type_code="BARGE_LOAD",
        primary_asset_code="BARGE_01",
        primary_asset_type_code="BARGE",
        convoy_number="CNV-RELATED-RECEIVER",
        origin_location_code="AGGE",
        sender_location_code="AGGE",
        operation_date=date(2026, 10, 20),
        product_name="Crude Oil",
        status="Approved",
    )
    receiver = OperationTransaction(
        operation_number="OP-BARGE-RECEIVER-DRAFT",
        operation_ticket_number="TKT-BARGE-RECEIVER-DRAFT",
        operation_type_code="BARGE_LOAD",
        primary_asset_code="BARGE_01",
        primary_asset_type_code="BARGE",
        convoy_number="CNV-RELATED-RECEIVER",
        origin_location_code="UTP",
        receiver_location_code="UTP",
        operation_date=date(2026, 10, 21),
        product_name="Crude Oil",
        status="Draft",
    )
    db.add_all([sender, receiver])
    db.commit()

    receiver_headers, _ = _make_user(
        db,
        client,
        "related_ticket_receiver",
        ["View Barge Tracking"],
        all_locations=False,
        locations=["UTP"],
    )

    voyages = client.get("/barge-trip/voyages?tab=OPEN", headers=receiver_headers)
    assert voyages.status_code == 200, voyages.text
    assert "CNV-RELATED-RECEIVER" in [
        row["convoy_number"] for row in voyages.json()["rows"]
    ]

    tracker = client.get(
        "/barge-trip/convoy-tracker?convoy_number=CNV-RELATED-RECEIVER",
        headers=receiver_headers,
    )
    assert tracker.status_code == 200, tracker.text
    assert tracker.json()["total_tickets"] == 1

    timeline = client.get(
        "/barge-trip/trips/by-convoy/CNV-RELATED-RECEIVER",
        headers=receiver_headers,
    )
    assert timeline.status_code == 200, timeline.text
